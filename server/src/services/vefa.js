/**
 * Appels de fonds VEFA : chaque dossier VEFA reçoit la suite des appels du plan de son programme ; un appel
 * passe « appelé » quand l'étape correspondante du chantier est constatée (point de chantier publié ou constat
 * manuel), avec une échéance de paiement. Les plafonds légaux sont contrôlés dans lib/domain (checkVefaPlan).
 */
const { HttpError, json, isoDay } = require('../lib/http');
const {
  DEFAULT_VEFA_PLAN, VEFA_DUE_DAYS, SITE_STAGES, SITE_STAGE_LABELS, checkVefaPlan, splitVefaAmounts, milestoneReached,
} = require('../lib/domain');

const ACTIVE = ['en_cours', 'solde'];
const addDays = (dateStr, n) => { const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fcfa = n => `${Number(n).toLocaleString('fr-FR').replace(/ /g, ' ')} FCFA`;
const frDate = s => new Date(`${s}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Plan du programme, ou plan par défaut s'il n'a pas été réglé. */
async function getPlan(db, projectId) {
  const row = await db('vefa_plans').where({ project_id: projectId }).first();
  if (!row) return { project_id: projectId, milestones: DEFAULT_VEFA_PLAN, due_days: VEFA_DUE_DAYS, custom: false };
  return { project_id: projectId, milestones: json(row.milestones, DEFAULT_VEFA_PLAN), due_days: row.due_days, custom: true, updated_at: row.updated_at };
}

async function savePlan(db, projectId, { milestones, due_days }, userId) {
  const errors = checkVefaPlan(milestones);
  if (errors.length) throw new HttpError(400, errors.join(' '));
  const row = { project_id: projectId, milestones: JSON.stringify(milestones), due_days, updated_by: userId, updated_at: new Date() };
  if (await db('vefa_plans').where({ project_id: projectId }).first()) await db('vefa_plans').where({ project_id: projectId }).update(row);
  else await db('vefa_plans').insert(row);
  return getPlan(db, projectId);
}

/** Étape la plus avancée déclarée au journal de chantier pour ce lot (projet entier, son îlot ou le lot). */
async function siteStageFor(trx, lot) {
  const rows = await trx('site_updates').where({ project_id: lot.project_id })
    .where(q => q.where(b => b.whereNull('ilot').whereNull('lot_id')).orWhere(b => b.where('ilot', lot.ilot || '').whereNull('lot_id')).orWhere('lot_id', lot.id))
    .select('stage');
  return rows.map(r => r.stage).sort((a, b) => SITE_STAGES.indexOf(b) - SITE_STAGES.indexOf(a))[0] || null;
}

/** Message dans l'espace client annonçant les appels de fonds émis. */
async function notifyClient(trx, sale, calls, userId) {
  if (!calls.length) return;
  const lines = calls.map(c => `• ${c.label} (${Number(c.pct)} %) : ${fcfa(c.amount_fcfa)}, à régler avant le ${frDate(c.due_date)}.`);
  const total = calls.reduce((s, c) => s + Number(c.amount_fcfa), 0);
  await trx('client_messages').insert({
    lead_id: sale.lead_id, sale_id: sale.id, sender: 'equipe', user_id: userId || null,
    body: `Appel de fonds — ${calls.length > 1 ? 'les étapes suivantes sont atteintes' : 'une étape du chantier est atteinte'} :\n${lines.join('\n')}${calls.length > 1 ? `\nTotal : ${fcfa(total)}.` : ''}\nLe détail figure dans « Paiements ».`,
  });
}

/**
 * Émet les appels « à venir » dont l'étape est atteinte. `reached(stage)` dit si l'étape d'un appel est constatée.
 * Renvoie les appels émis.
 */
async function emitCalls(trx, sale, reached, { date, siteUpdateId = null, userId = null, notify = true }) {
  const project = await trx('lots').where({ id: sale.lot_id }).first('project_id');
  const plan = await getPlan(trx, project.project_id);
  const pending = await trx('fund_calls').where({ sale_id: sale.id, status: 'a_venir' }).orderBy('seq');
  const emitted = [];
  for (const c of pending) {
    if (!reached(c.stage)) continue;
    const row = { status: 'appele', called_at: date, due_date: addDays(date, plan.due_days), site_update_id: siteUpdateId, called_by: userId, updated_at: new Date() };
    await trx('fund_calls').where({ id: c.id }).update(row);
    emitted.push({ ...c, ...row });
  }
  if (notify) await notifyClient(trx, sale, emitted, userId);
  return emitted;
}

/**
 * Crée les appels d'un dossier VEFA (s'il n'en a pas) ou met à jour leurs montants (prix modifié).
 * L'appel « signature » part dès la date de signature (à défaut, de réservation) ; les étapes déjà
 * dépassées sur le chantier sont appelées aussitôt.
 */
async function ensureCalls(trx, sale, { userId = null } = {}) {
  const existing = await trx('fund_calls').where({ sale_id: sale.id }).orderBy('seq');
  if (existing.length) {
    const amounts = splitVefaAmounts(sale.price_fcfa, existing.map(c => ({ pct: Number(c.pct) })));
    for (const [i, c] of existing.entries()) {
      if (Number(c.amount_fcfa) !== amounts[i].amount_fcfa) await trx('fund_calls').where({ id: c.id }).update({ amount_fcfa: amounts[i].amount_fcfa, updated_at: new Date() });
    }
    return;
  }
  const lot = await trx('lots').where({ id: sale.lot_id }).first();
  const plan = await getPlan(trx, lot.project_id);
  const calls = splitVefaAmounts(sale.price_fcfa, plan.milestones);
  await trx('fund_calls').insert(calls.map((m, i) => ({
    sale_id: sale.id, seq: i + 1, stage: m.stage, label: m.label || SITE_STAGE_LABELS[m.stage] || 'Signature', pct: m.pct, amount_fcfa: m.amount_fcfa,
  })));
  const start = isoDay(sale.signed_at || sale.reserved_at) || isoDay(new Date());
  const siteStage = await siteStageFor(trx, lot);
  await emitCalls(trx, sale, stage => stage === 'signature' || (siteStage && milestoneReached(stage, siteStage)), { date: start, userId, notify: false });
}

/** Dossiers VEFA actifs concernés par un point de chantier ou un constat (projet, îlot, bâtiment ou lot). */
function scopedSales(trx, { projectId, ilot = null, lotId = null, buildingId = null }) {
  const q = trx('sales as s').join('lots as l', 'l.id', 's.lot_id')
    .where('l.project_id', projectId).where('s.vefa', true).whereIn('s.status', ACTIVE).select('s.*');
  if (lotId) q.where('l.id', lotId);
  else if (buildingId) q.where('l.building_id', buildingId);
  else if (ilot) q.where('l.ilot', ilot);
  return q;
}

/** Point de chantier publié : les étapes achevées (le chantier est passé à la suivante) sont appelées. */
async function onSiteUpdate(db, update, userId) {
  return db.transaction(async trx => {
    const sales = await scopedSales(trx, { projectId: update.project_id, ilot: update.ilot, lotId: update.lot_id });
    const date = isoDay(update.published_at) || isoDay(new Date());
    let n = 0;
    for (const sale of sales) {
      n += (await emitCalls(trx, sale, stage => milestoneReached(stage, update.stage), { date, siteUpdateId: update.id, userId })).length;
    }
    return n;
  });
}

/** Constat manuel (attestation de l'architecte / du maître d'œuvre) : l'étape et les précédentes sont achevées. */
async function recordMilestone(db, { projectId, ilot, buildingId, lotId, stage, date, userId }) {
  if (!SITE_STAGES.includes(stage)) throw new HttpError(400, 'Étape de chantier inconnue.');
  return db.transaction(async trx => {
    const sales = await scopedSales(trx, { projectId, ilot, buildingId, lotId });
    const upTo = SITE_STAGES.indexOf(stage);
    const out = [];
    for (const sale of sales) {
      const emitted = await emitCalls(trx, sale, s => s !== 'signature' && SITE_STAGES.indexOf(s) <= upTo, { date, userId });
      out.push(...emitted.map(c => ({ ...c, sale_id: sale.id })));
    }
    return { sales: sales.length, calls: out.length, amount_fcfa: out.reduce((s, c) => s + Number(c.amount_fcfa), 0) };
  });
}

/** Lignes d'échéancier d'un dossier VEFA (appels émis) et liste complète des appels. */
async function vefaLines(db, sale) {
  const calls = await db('fund_calls').where({ sale_id: sale.id }).orderBy('seq');
  const all = calls.map(c => ({
    id: c.id, seq: c.seq, stage: c.stage, label: c.label, pct: Number(c.pct), amount_fcfa: Number(c.amount_fcfa),
    status: c.status, called_at: isoDay(c.called_at), due_date: isoDay(c.due_date),
  }));
  const lines = all.filter(c => c.status === 'appele').map(c => ({ id: c.id, seq: c.seq, kind: 'appel_fonds', label: c.label, due_date: c.due_date, amount_fcfa: c.amount_fcfa }));
  return { lines, calls: all };
}

module.exports = { getPlan, savePlan, ensureCalls, onSiteUpdate, recordMilestone, vefaLines, scopedSales };
