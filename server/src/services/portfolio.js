/**
 * Portefeuille commercial : historique daté des attributions de prospects et de leurs issues (règles dans
 * lib/domain.js : portfolioState, portfolioDiff, portfolioCounts), compteurs par commercial et par période,
 * listes de prospects importées et leur bilan.
 * Chaque écriture sur un prospect appelle syncLead (date et auteur exacts) ; reconcile rattrape au besoin les
 * changements faits par un autre chemin, avec la meilleure date connue (date de perte, du dossier…).
 * Les dates sont regroupées en JavaScript : SQLite les range tantôt en texte, tantôt en millisecondes.
 */
const { toDate, isoDay, isoTime, HttpError } = require('../lib/http');
const { portfolioState, replayPortfolio, portfolioDiff, portfolioCounts, PORTFOLIO_EVENTS, PORTFOLIO_REASONS, CLIENT_STAGES } = require('../lib/domain');
const { buckets, GRANULARITIES } = require('./performance');

const seesAllLeads = user => (user.permissions || []).some(p => p === '*' || p === 'leads:all');
const insertedId = r => (typeof r === 'object' ? r.id : r);
const byTime = (a, b) => (toDate(a.at) - toDate(b.at)) || (a.id - b.id);

async function insertEvents(trx, lead, list, { at, by, importId }) {
  if (!list.length) return [];
  const rows = list.map((e, i) => ({
    lead_id: lead.id, lead_name: lead.name, user_id: e.user_id || null, kind: e.kind, reason: e.reason || null,
    // un écart d'une milliseconde garde l'ordre (retrait avant attribution, attribution avant conversion)
    at: new Date((e.at ? toDate(e.at) : at).getTime() + i), import_id: importId || null, created_by: by || null,
  }));
  await trx('lead_portfolio_events').insert(rows);
  return rows;
}

/**
 * Met l'historique d'un prospect en accord avec son état en base. `reason` : motif d'une nouvelle attribution
 * (creation, import, attribution) ; un changement de commercial est toujours un transfert.
 */
async function syncLead(trx, leadId, { by = null, at = new Date(), reason = 'attribution', importId = null } = {}) {
  const lead = await trx('leads').where({ id: leadId }).first('id', 'name', 'assigned_to', 'client_code', 'stage');
  if (!lead) return [];
  // Arrivé au paiement (ou au-delà) : la personne devient client, quel que soit le chemin (admin, ERP, import)
  if (!lead.client_code && CLIENT_STAGES.includes(lead.stage)) {
    lead.client_code = await require('./sales').nextClientCode(trx);
    await trx('leads').where({ id: leadId }).update({ client_code: lead.client_code });
  }
  const [sales, events] = await Promise.all([
    trx('sales').where({ lead_id: leadId }).select('status'),
    trx('lead_portfolio_events').where({ lead_id: leadId }).select('id', 'kind', 'user_id', 'at'),
  ]);
  const prev = replayPortfolio(events.sort(byTime));
  return insertEvents(trx, lead, portfolioDiff(prev, portfolioState(lead, sales), reason), { at, by, importId });
}

/** Avant la suppression d'un prospect : il compte en perte pour son commercial (l'historique est gardé). */
async function recordDeletion(trx, lead, by = null) {
  const events = await trx('lead_portfolio_events').where({ lead_id: lead.id }).select('id', 'kind', 'user_id', 'at');
  const prev = replayPortfolio(events.sort(byTime));
  if (!lead.assigned_to && !prev.owner) return; // jamais attribué : il ne comptait pour personne
  const list = [];
  if (!prev.lost) list.push({ kind: 'suppression', user_id: lead.assigned_to || prev.owner });
  await insertEvents(trx, lead, list, { at: new Date(), by });
}

/**
 * Rattrapage : compare tous les prospects à leur historique et inscrit les écarts, datés au mieux (perte : date
 * de perte ; conversion : premier dossier ; désistement : dernier dossier ; attribution : dernière modification).
 * Un prospect disparu sans trace compte en suppression.
 */
async function reconcile(db, now = new Date()) {
  const [leads, sales, events] = await Promise.all([
    db('leads').select('id', 'name', 'assigned_to', 'client_code', 'stage', 'lost_at', 'created_at', 'updated_at'),
    db('sales').select('lead_id', 'status', 'created_at', 'updated_at'),
    db('lead_portfolio_events').select('id', 'lead_id', 'lead_name', 'kind', 'user_id', 'at'),
  ]);
  const salesBy = {}, eventsBy = {};
  for (const s of sales) (salesBy[s.lead_id] = salesBy[s.lead_id] || []).push(s);
  for (const e of events) (eventsBy[e.lead_id] = eventsBy[e.lead_id] || []).push(e);
  const rows = [];
  const push = (lead, e, at) => rows.push({ lead_id: lead.id, lead_name: lead.name, user_id: e.user_id || null, kind: e.kind, reason: e.reason || null, at });
  for (const l of leads) {
    const ss = salesBy[l.id] || [];
    const evs = (eventsBy[l.id] || []).sort(byTime);
    const prev = replayPortfolio(evs);
    const diff = portfolioDiff(prev, portfolioState(l, ss), prev.known ? 'attribution' : 'creation');
    if (!diff.length) continue;
    const changed = toDate(l.updated_at) || toDate(l.created_at) || now;
    const dates = ss.map(s => toDate(s.created_at)).filter(Boolean).sort((a, b) => a - b);
    const ends = ss.map(s => toDate(s.updated_at)).filter(Boolean).sort((a, b) => b - a);
    diff.forEach((e, i) => {
      let at = changed;
      if (e.kind === 'client') at = (prev.desiste ? dates[dates.length - 1] : dates[0]) || changed;
      else if (e.kind === 'desistement') at = ends[0] || changed;
      else if (e.kind === 'perte') at = toDate(l.lost_at) || changed;
      push(l, e, new Date(at.getTime() + i));
    });
  }
  const alive = new Set(leads.map(l => l.id));
  for (const [leadId, evs] of Object.entries(eventsBy)) {
    if (alive.has(Number(leadId))) continue;
    const prev = replayPortfolio(evs.sort(byTime));
    if (prev.deleted || prev.lost || !prev.owner) continue;
    push({ id: Number(leadId), name: evs[0].lead_name }, { kind: 'suppression', user_id: prev.owner }, now);
  }
  for (let i = 0; i < rows.length; i += 200) await db('lead_portfolio_events').insert(rows.slice(i, i + 200));
  return rows.length;
}

/** Commerciaux à afficher : comptes ayant le droit de gérer des prospects, plus ceux qui ont un historique. */
async function people(db, ids = []) {
  const roles = db('role_permissions').where({ permission: 'leads:write' }).select('role');
  const users = await db('users').where(q => q.where({ active: true }).where(b => b.whereIn('role', roles).orWhereIn('role', ['commercial', 'super_admin', 'resp_exploitation'])))
    .orWhereIn('id', ids).orderBy('name').select('id', 'name', 'role', 'active');
  return users;
}

/**
 * Compteurs par commercial : sur la période [from, to] découpée en semaines, mois ou années ; cumul du net
 * période après période ; portefeuille actuel (prospects en cours et clients actifs attribués aujourd'hui).
 * Sans le droit « voir les prospects de toute l'équipe », un commercial ne voit que ses propres chiffres.
 */
async function stats(db, user, { granularity = 'mois', from, to, userId = null } = {}) {
  if (!GRANULARITIES.includes(granularity)) granularity = 'mois';
  await reconcile(db);
  const today = isoDay(new Date());
  to = to || today;
  from = from || `${to.slice(0, 4)}-01-01`;
  if (from > to) throw new HttpError(400, 'La date de début doit précéder la date de fin.');
  const periods = buckets(granularity, from, to);
  const only = seesAllLeads(user) ? (userId ? Number(userId) : null) : user.id;
  const lo = new Date(`${periods[0]?.from || from}T00:00:00Z`);
  const hi = new Date(new Date(`${periods[periods.length - 1]?.to || to}T00:00:00Z`).getTime() + 86400000);

  const events = (await db('lead_portfolio_events').modify(q => { if (only) q.where('user_id', only); }).select('kind', 'user_id', 'at'))
    .map(e => ({ ...e, at: toDate(e.at) })).filter(e => e.at);
  const inPeriod = (p, e) => e.at >= new Date(`${p.from}T00:00:00Z`) && e.at < new Date(new Date(`${p.to}T00:00:00Z`).getTime() + 86400000);
  const [leads, sales] = await Promise.all([
    db('leads').modify(q => { if (only) q.where('assigned_to', only); }).select('id', 'assigned_to', 'client_code', 'stage'),
    db('sales').select('lead_id', 'status'),
  ]);
  const salesBy = {};
  for (const s of sales) (salesBy[s.lead_id] = salesBy[s.lead_id] || []).push(s);
  const current = uid => {
    const mine = leads.filter(l => (l.assigned_to || null) === uid).map(l => portfolioState(l, salesBy[l.id] || []));
    return { prospects: mine.filter(s => !s.client && !s.desiste && !s.lost).length, clients: mine.filter(s => s.client).length };
  };

  const ids = [...new Set(events.map(e => e.user_id).filter(Boolean))];
  const team = only ? (await db('users').where({ id: only }).select('id', 'name', 'role', 'active')) : await people(db, ids);
  const rows = team.map(u => {
    const mine = events.filter(e => e.user_id === u.id);
    const before = portfolioCounts(mine.filter(e => e.at < lo));
    let cumP = before.prospects.net, cumC = before.clients.net;
    const series = periods.map(p => {
      const c = portfolioCounts(mine.filter(e => inPeriod(p, e)));
      cumP += c.prospects.net; cumC += c.clients.net;
      return { key: p.key, label: p.label, title: p.title, from: p.from, to: p.to, ...c, cumul: { prospects: cumP, clients: cumC } };
    });
    return {
      user_id: u.id, name: u.name, role: u.role, active: !!u.active,
      total: portfolioCounts(mine.filter(e => e.at >= lo && e.at < hi)), series, current: current(u.id),
    };
  }).filter(r => r.active || r.total.prospects.brut || r.total.clients.brut || r.current.prospects || r.current.clients);

  // Équipe : somme des commerciaux, chaque période
  const sum = list => list.reduce((a, c) => ({
    prospects: { brut: a.prospects.brut + c.prospects.brut, transferes: a.prospects.transferes + c.prospects.transferes, pertes: a.prospects.pertes + c.prospects.pertes, net: a.prospects.net + c.prospects.net },
    clients: { brut: a.clients.brut + c.clients.brut, desistes: a.clients.desistes + c.clients.desistes, net: a.clients.net + c.clients.net },
  }), { prospects: { brut: 0, transferes: 0, pertes: 0, net: 0 }, clients: { brut: 0, desistes: 0, net: 0 } });
  const teamSeries = periods.map((p, i) => ({ key: p.key, label: p.label, title: p.title, ...sum(rows.map(r => r.series[i])) }));
  const unassigned = only ? null : leads.filter(l => !l.assigned_to).map(l => portfolioState(l, salesBy[l.id] || [])).filter(s => !s.client && !s.desiste && !s.lost).length;
  return { granularity, from, to, periods, rows, team: { total: sum(rows.map(r => r.total)), series: teamSeries }, unassigned, mine_only: !seesAllLeads(user) };
}

/** Historique du portefeuille d'un prospect (fiche prospect). */
async function leadHistory(db, leadId) {
  const rows = await db('lead_portfolio_events as e').leftJoin('users as u', 'u.id', 'e.user_id').leftJoin('users as b', 'b.id', 'e.created_by')
    .where('e.lead_id', leadId).select('e.id', 'e.kind', 'e.reason', 'e.at', 'e.user_id', 'u.name as user_name', 'b.name as by_name');
  return rows.sort(byTime).map(r => ({ ...r, at: isoTime(r.at), label: PORTFOLIO_EVENTS[r.kind], reason_label: PORTFOLIO_REASONS[r.reason] || null }));
}

/** Attribution (ou retrait) d'un ou plusieurs prospects à un commercial, par le responsable. */
async function assign(db, ids, userId, by) {
  if (userId) {
    const u = await db('users').where({ id: userId, active: true }).first('id');
    if (!u) throw new HttpError(400, 'Commercial introuvable ou désactivé.');
  }
  let changed = 0;
  await db.transaction(async trx => {
    for (const id of ids) {
      const lead = await trx('leads').where({ id }).first('id', 'assigned_to');
      if (!lead || (lead.assigned_to || null) === (userId || null)) continue;
      await trx('leads').where({ id }).update({ assigned_to: userId || null, updated_at: new Date() });
      await syncLead(trx, id, { by });
      changed += 1;
    }
  });
  return changed;
}

// ─── Listes importées ──────────────────────────────────────────

async function createImport(db, { name, filename, mode, assigned_to, user }) {
  const [id] = await db('lead_imports').insert({ name, filename: filename || null, mode, assigned_to: assigned_to || null, created_by: user.id });
  return insertedId(id);
}

/** Bilan d'une ou de toutes les listes : doublons déduits, puis issue des nouveaux prospects. */
async function importReports(db, user, id = null) {
  const imports = await db('lead_imports as i').leftJoin('users as a', 'a.id', 'i.assigned_to').leftJoin('users as c', 'c.id', 'i.created_by')
    .modify(q => { if (id) q.where('i.id', id); if (!seesAllLeads(user)) q.where(b => b.where('i.assigned_to', user.id).orWhere('i.created_by', user.id)); })
    .orderBy('i.id', 'desc').select('i.*', 'a.name as assigned_name', 'c.name as created_by_name');
  if (!imports.length) return [];
  const items = await db('lead_import_items as it').leftJoin('leads as ld', 'ld.id', 'it.lead_id')
    .whereIn('it.import_id', imports.map(i => i.id))
    .select('it.import_id', 'it.lead_id', 'it.duplicate', 'it.line', 'ld.id as alive', 'ld.name', 'ld.phone', 'ld.email', 'ld.stage', 'ld.client_code', 'ld.assigned_to');
  const sales = await db('sales').whereIn('lead_id', items.map(i => i.lead_id)).select('lead_id', 'status');
  const salesBy = {};
  for (const s of sales) (salesBy[s.lead_id] = salesBy[s.lead_id] || []).push(s);
  return imports.map(i => {
    const mine = items.filter(it => it.import_id === i.id);
    const fresh = mine.filter(it => !it.duplicate);
    const outcome = it => {
      if (!it.alive) return 'supprime';
      const s = portfolioState(it, salesBy[it.lead_id] || []);
      return s.client ? 'client' : s.desiste ? 'desiste' : s.lost ? 'perdu' : 'en_cours';
    };
    const count = k => fresh.filter(it => outcome(it) === k).length;
    const bilan = {
      lignes: i.rows_total, nouveaux: fresh.length, doublons: mine.length - fresh.length, erreurs: i.error_count,
      en_cours: count('en_cours'), clients: count('client'), perdus: count('perdu') + count('supprime') + count('desiste'),
    };
    bilan.conversion_pct = fresh.length ? Math.round((bilan.clients / fresh.length) * 1000) / 10 : null;
    const out = { ...i, created_at: isoTime(i.created_at), updated_at: isoTime(i.updated_at), bilan };
    if (id) out.items = [...mine].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)).map(it => ({ lead_id: it.lead_id, line: it.line, duplicate: !!it.duplicate, name: it.name, phone: it.phone, email: it.email, stage: it.stage, outcome: outcome(it) }));
    return out;
  });
}

module.exports = { syncLead, recordDeletion, reconcile, stats, leadHistory, assign, createImport, importReports, seesAllLeads };
