/**
 * ERP · Commercial : historique des échanges (façon « chatter » Odoo), activités planifiées, pipeline,
 * objectifs des commerciaux et indicateurs. Regroupements par mois faits en JavaScript (MySQL = SQLite).
 */
const { isoDay, isoTime, toDate: parseDate } = require('../lib/http');
const { STAGE_PROBABILITY, PIPELINE_STAGES, WON_STAGES, ACTIVITY_KINDS, LOST_REASONS, activityState } = require('../lib/domain');
const { totals } = require('./sales');
const { scheduleStatus } = require('./schedule');

const STAGE_LABELS = {
  prospection: 'Prospection', visite: 'Visite', decision: 'Décision', choix_bien: 'Choix du bien', paiement: 'Paiement',
  contrat: 'Contrat', notaire: 'Notaire', livraison: 'Livraison', sav: 'SAV', perdu: 'Perdu',
};
const monthKey = v => { const d = parseDate(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthRange = month => {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
};
const insertedId = r => (typeof r === 'object' ? r.id : r);

/** Droit « Voir les prospects de toute l'équipe » (Rôles & privilèges). */
const seesAllLeads = user => (user.permissions || []).some(p => p === '*' || p === 'leads:all');

/** Sans ce droit, on ne voit que ses prospects et ceux qui ne sont pas encore attribués (même règle que le dashboard). */
function scopeLeads(q, user, alias = 'ld') {
  if (!seesAllLeads(user)) q.where(b => b.where(`${alias}.assigned_to`, user.id).orWhereNull(`${alias}.assigned_to`));
  return q;
}

/** Inscrit un événement dans l'historique d'un prospect (journal automatique ou note). */
async function logActivity(trx, leadId, { kind, summary, note = null, userId = null }) {
  const [id] = await trx('lead_activities').insert({
    lead_id: leadId, kind, summary, note, done_at: new Date(), created_by: userId, assigned_to: userId,
  });
  return insertedId(id);
}

/** Changement d'étape : « perdu » exige un motif ; quitter « perdu » efface le motif. Journalisé. */
async function changeStage(db, lead, { stage, lost_reason = null, lost_note = null }, userId) {
  return db.transaction(async trx => {
    const patch = { stage, updated_at: new Date() };
    if (stage === 'perdu') {
      patch.lost_reason = lost_reason; patch.lost_note = lost_note; patch.lost_at = new Date();
    } else if (lead.stage === 'perdu') {
      patch.lost_reason = null; patch.lost_note = null; patch.lost_at = null;
    }
    await trx('leads').where({ id: lead.id }).update(patch);
    const summary = stage === 'perdu'
      ? `Classé perdu : ${LOST_REASONS[lost_reason] || lost_reason}`
      : `Étape : ${STAGE_LABELS[lead.stage]} → ${STAGE_LABELS[stage]}`;
    await logActivity(trx, lead.id, { kind: 'etape', summary, note: stage === 'perdu' ? lost_note : null, userId });
    // Un prospect perdu n'a plus d'activités à faire
    if (stage === 'perdu') await trx('lead_activities').where({ lead_id: lead.id }).whereNull('done_at').del();
    return trx('leads').where({ id: lead.id }).first();
  });
}

const serializeActivity = a => ({
  ...a, due_at: isoTime(a.due_at), done_at: isoTime(a.done_at), created_at: isoTime(a.created_at),
  label: ACTIVITY_KINDS[a.kind] || (a.kind === 'etape' ? 'Étape' : 'Journal'), state: a.done_at ? 'fait' : activityState(a.due_at),
});

/**
 * Historique complet d'un prospect, du plus récent au plus ancien : notes et activités réalisées,
 * changements d'étape, rendez-vous, options, dossiers, versements, messages de l'espace client, réclamations.
 */
async function leadHistory(db, leadId) {
  const [acts, appts, options, sales, contacts, clientMsgs, tickets] = await Promise.all([
    db('lead_activities as a').leftJoin('users as u', 'u.id', 'a.created_by').where('a.lead_id', leadId).whereNotNull('a.done_at')
      .select('a.*', 'u.name as user_name'),
    db('appointments as a').leftJoin('users as u', 'u.id', 'a.assigned_to').where('a.lead_id', leadId).select('a.*', 'u.name as user_name'),
    db('lot_options as o').join('lots as l', 'l.id', 'o.lot_id').where('o.lead_id', leadId).select('o.*', 'l.code as lot_code'),
    db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id').where('s.lead_id', leadId)
      .select('s.*', 'l.code as lot_code', 'p.name as project_name'),
    db('contact_messages').where({ lead_id: leadId }),
    db('client_messages').where({ lead_id: leadId }).orderBy('id', 'desc').limit(30),
    db.schema.hasTable('sav_tickets').then(has => (has ? db('sav_tickets').where({ lead_id: leadId }) : [])),
  ]);
  const payments = sales.length ? await db('payments').whereIn('sale_id', sales.map(s => s.id)) : [];
  const APPT = { visite: 'Visite sur site', appel: 'Appel', bureau: 'Rendez-vous au bureau', visio: 'Visio' };
  const APPT_ST = { demande: 'demandé', confirme: 'confirmé', effectue: 'effectué', annule: 'annulé', absent: 'absent' };
  const items = [
    ...acts.map(a => ({ at: a.done_at, type: a.kind === 'etape' ? 'etape' : a.kind === 'note' ? 'note' : 'activite', kind: a.kind, title: a.summary || ACTIVITY_KINDS[a.kind], body: [a.note, a.outcome].filter(Boolean).join('\n') || null, user: a.user_name })),
    ...appts.map(a => ({ at: a.starts_at, type: 'rdv', kind: a.kind, title: `${APPT[a.kind] || 'Rendez-vous'} — ${APPT_ST[a.status] || a.status}`, body: a.notes, user: a.user_name })),
    ...options.map(o => ({ at: o.created_at, type: 'option', title: `Option sur le lot ${o.lot_code} (${o.state})`, body: null })),
    ...sales.map(s => ({ at: s.created_at, type: 'vente', title: `Dossier ouvert — ${s.project_name}, lot ${s.lot_code}${s.vefa ? ' (VEFA)' : ''}`, body: `Prix convenu : ${Number(s.price_fcfa).toLocaleString('fr-FR')} FCFA` })),
    ...payments.map(p => ({ at: p.paid_at, type: 'paiement', title: `Versement de ${Number(p.amount_fcfa).toLocaleString('fr-FR')} FCFA`, body: p.reference || null })),
    ...contacts.map(c => ({ at: c.created_at, type: 'message', title: `Message du site${c.subject ? ` : ${c.subject}` : ''}`, body: c.message })),
    ...clientMsgs.map(m => ({ at: m.created_at, type: 'espace_client', title: m.sender === 'client' ? 'Message du client (espace client)' : 'Message envoyé dans l’espace client', body: m.body })),
    ...tickets.map(t => ({ at: t.created_at, type: 'sav', title: `Réclamation ${t.ref} : ${t.title}`, body: null })),
  ];
  return items.map(i => ({ ...i, at: isoTime(i.at) })).filter(i => i.at).sort((a, b) => b.at.localeCompare(a.at));
}

/** Cartes du pipeline : étape, montant attendu, prochaine activité, commercial. */
async function pipeline(db, user, { project_id, assigned_to, q, include_lost } = {}) {
  const stages = include_lost ? [...PIPELINE_STAGES, 'perdu'] : PIPELINE_STAGES;
  const query = scopeLeads(db('leads as ld'), user)
    .leftJoin('projects as p', 'p.id', 'ld.project_id').leftJoin('lots as l', 'l.id', 'ld.lot_id').leftJoin('users as u', 'u.id', 'ld.assigned_to')
    .whereIn('ld.stage', stages);
  if (project_id) query.where('ld.project_id', Number(project_id));
  if (assigned_to) query.where('ld.assigned_to', Number(assigned_to));
  if (q) {
    const s = `%${String(q).trim()}%`;
    query.where(b => b.where('ld.name', 'like', s).orWhere('ld.phone', 'like', s).orWhere('ld.email', 'like', s).orWhere('ld.client_code', 'like', s));
  }
  const rows = await query.select('ld.id', 'ld.name', 'ld.phone', 'ld.stage', 'ld.priority', 'ld.kind', 'ld.expected_revenue_fcfa', 'ld.is_diaspora',
    'ld.lost_reason', 'ld.updated_at', 'ld.client_code', 'ld.assigned_to', 'p.name as project_name', 'l.code as lot_code', 'l.price_fcfa as lot_price', 'u.name as assigned_name')
    .orderBy([{ column: 'ld.priority', order: 'desc' }, { column: 'ld.updated_at', order: 'desc' }]).limit(1000);
  const ids = rows.map(r => r.id);
  const next = ids.length ? await db('lead_activities').whereIn('lead_id', ids).whereNull('done_at').orderBy('due_at').select('lead_id', 'kind', 'summary', 'due_at') : [];
  const nextBy = {};
  for (const a of next) if (!nextBy[a.lead_id]) nextBy[a.lead_id] = a;
  return rows.map(r => {
    const expected = Number(r.expected_revenue_fcfa || r.lot_price || 0);
    const n = nextBy[r.id];
    return {
      ...r, expected_revenue_fcfa: expected || null, probability: STAGE_PROBABILITY[r.stage], weighted_fcfa: Math.round((expected * STAGE_PROBABILITY[r.stage]) / 100),
      next_activity: n ? { kind: n.kind, summary: n.summary, due_at: isoTime(n.due_at), state: activityState(n.due_at) } : null,
    };
  });
}

/** Réalisé d'un commercial (ou de toute l'équipe si userId est nul) sur une période. */
async function achieved(db, { from, to, userId = null }) {
  // Les dates sont filtrées en JavaScript : SQLite les range tantôt en texte, tantôt en millisecondes
  const inRange = v => { const d = parseDate(v); return d && d >= from && d < to; };
  const byUser = q => (userId ? q.where('ld.assigned_to', userId) : q);
  const [sales, appts, pays, leads] = await Promise.all([
    byUser(db('sales as s').join('leads as ld', 'ld.id', 's.lead_id').whereNot('s.status', 'desiste')).select('s.price_fcfa', 's.created_at as d'),
    db('appointments').where('status', 'effectue').modify(q => { if (userId) q.where('assigned_to', userId); }).select('starts_at as d'),
    byUser(db('payments as p').join('sales as s', 's.id', 'p.sale_id').join('leads as ld', 'ld.id', 's.lead_id')).select('p.amount_fcfa', 'p.paid_at as d'),
    byUser(db('leads as ld')).select('ld.stage', 'ld.created_at as d'),
  ]);
  const sold = sales.filter(r => inRange(r.d));
  const fresh = leads.filter(r => inRange(r.d));
  const won = fresh.filter(r => [...WON_STAGES, 'paiement'].includes(r.stage)).length;
  return {
    ca_fcfa: sold.reduce((s, r) => s + Number(r.price_fcfa), 0),
    ventes: sold.length,
    rdv: appts.filter(r => inRange(r.d)).length,
    encaissements_fcfa: pays.filter(r => inRange(r.d)).reduce((s, r) => s + Number(r.amount_fcfa), 0),
    nouveaux_prospects: fresh.length,
    conversion_pct: fresh.length ? Math.round((won / fresh.length) * 1000) / 10 : null,
  };
}

/** Commerciaux : comptes actifs ayant le droit de gérer des prospects (rôles créés compris). */
async function sellers(db) {
  const roles = db('role_permissions').where({ permission: 'leads:write' }).select('role');
  return db('users').where({ active: true }).where(q => q.whereIn('role', roles).orWhereIn('role', ['commercial', 'super_admin'])).orderBy('name').select('id', 'name', 'role');
}

/** Objectifs du mois et réalisé, par commercial. */
async function targetsReport(db, month) {
  const { from, to } = monthRange(month);
  const [people, targets] = await Promise.all([sellers(db), db('sales_targets').where({ month })]);
  const tBy = Object.fromEntries(targets.map(t => [t.user_id, t]));
  const rows = [];
  for (const u of people) {
    const t = tBy[u.id] || {};
    const done = await achieved(db, { from, to, userId: u.id });
    const target = { ca_fcfa: t.ca_fcfa == null ? null : Number(t.ca_fcfa), ventes: t.ventes ?? null, rdv: t.rdv ?? null, encaissements_fcfa: t.encaissements_fcfa == null ? null : Number(t.encaissements_fcfa) };
    const pct = k => (target[k] ? Math.round((done[k] / target[k]) * 1000) / 10 : null);
    rows.push({ user_id: u.id, name: u.name, role: u.role, target, done, pct: { ca_fcfa: pct('ca_fcfa'), ventes: pct('ventes'), rdv: pct('rdv'), encaissements_fcfa: pct('encaissements_fcfa') } });
  }
  return { month, rows };
}

/** Tableau de bord commercial : mois en cours, 12 mois glissants, pipeline, retards de paiement. */
async function dashboard(db, user, now = new Date()) {
  const month = monthKey(now);
  const { from, to } = monthRange(month);
  const prev = monthRange(monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  const mineOnly = seesAllLeads(user) ? null : user.id;
  const [cur, before, cards, team] = await Promise.all([
    achieved(db, { from, to, userId: mineOnly }),
    achieved(db, { from: prev.from, to: prev.to, userId: mineOnly }),
    pipeline(db, user),
    targetsReport(db, month),
  ]);
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const series = [];
  for (let i = 0; i < 12; i++) series.push({ month: monthKey(new Date(start.getFullYear(), start.getMonth() + i, 1)), ca: 0, ventes: 0, encaissements: 0 });
  const byKey = Object.fromEntries(series.map(s => [s.month, s]));
  const [sales, pays, sources, lost] = await Promise.all([
    db('sales').whereNot('status', 'desiste').where('created_at', '>=', start).select('created_at', 'price_fcfa'),
    db('payments').where('paid_at', '>=', start).select('paid_at', 'amount_fcfa'),
    scopeLeads(db('leads as ld'), user).where('ld.created_at', '>=', start).select('ld.source').count({ n: '*' }).groupBy('ld.source'),
    scopeLeads(db('leads as ld'), user).where('ld.stage', 'perdu').whereNotNull('ld.lost_reason').select('ld.lost_reason').count({ n: '*' }).groupBy('ld.lost_reason'),
  ]);
  sales.forEach(s => { const m = byKey[monthKey(s.created_at)]; if (m) { m.ca += Number(s.price_fcfa); m.ventes += 1; } });
  pays.forEach(p => { const m = byKey[monthKey(p.paid_at)]; if (m) m.encaissements += Number(p.amount_fcfa); });

  const stages = PIPELINE_STAGES.map(st => {
    const c = cards.filter(x => x.stage === st);
    return { stage: st, label: STAGE_LABELS[st], n: c.length, value_fcfa: c.reduce((s, x) => s + (x.expected_revenue_fcfa || 0), 0), weighted_fcfa: c.reduce((s, x) => s + x.weighted_fcfa, 0) };
  });
  const lateActs = await scopeLeads(db('lead_activities as a').join('leads as ld', 'ld.id', 'a.lead_id'), user)
    .whereNull('a.done_at').where('a.due_at', '<', new Date(now.getFullYear(), now.getMonth(), now.getDate())).count({ n: '*' });

  // Appels de fonds VEFA en retard (échéance dépassée et non couverte par les versements)
  const vefaSales = await db('sales').where({ vefa: true }).whereIn('status', ['en_cours', 'solde']);
  let lateCalls = 0, lateCallsFcfa = 0;
  for (const s of vefaSales) {
    const st = await scheduleStatus(db, s, await totals(db, s));
    lateCalls += st.overdue_count; lateCallsFcfa += st.overdue_fcfa;
  }
  return {
    month, current: cur, previous: before, series, stages,
    pipeline_value_fcfa: stages.reduce((s, x) => s + x.value_fcfa, 0),
    pipeline_weighted_fcfa: stages.reduce((s, x) => s + x.weighted_fcfa, 0),
    open_leads: cards.length,
    late_activities: Number(lateActs[0].n),
    late_fund_calls: { n: lateCalls, amount_fcfa: lateCallsFcfa },
    sources: Object.fromEntries(sources.map(s => [s.source, Number(s.n)])),
    lost_reasons: Object.fromEntries(lost.map(l => [l.lost_reason, Number(l.n)])),
    team: team.rows,
  };
}

module.exports = { STAGE_LABELS, seesAllLeads, scopeLeads, logActivity, changeStage, serializeActivity, leadHistory, pipeline, achieved, sellers, targetsReport, dashboard, monthKey, monthRange, isoDay };
