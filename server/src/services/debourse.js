/**
 * Déboursé sec (ERP › Chantiers, docs/cadrage-debourse-sec.md) : référentiels (ressources, ouvrages, modèles de bâtiment),
 * estimations aux prix figés et report au budget d'un chantier. Règles de calcul : lib/debourse.js.
 */
const { HttpError, isoTime } = require('../lib/http');
const { NATURES, LOTS, PARAMS, BASES, bases, estimate, checkParams } = require('../lib/debourse');
const chantiers = require('./chantiers');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const num = v => (v == null ? null : Number(v));
const round4 = n => Math.round(Number(n) * 10000) / 10000;

// ─── Référentiels ─────────────────────────────────────────────────────────

/** Dernier prix d'achat connu d'un article (lignes de bons de commande), proposé à côté du prix du référentiel. */
async function lastPurchasePrices(db) {
  const rows = await db('appro_order_lines as l').join('appro_orders as o', 'o.id', 'l.order_id').whereNotNull('l.article_id').whereNotNull('l.unit_price_fcfa')
    .whereNot('o.status', 'brouillon').orderBy('o.id', 'desc').select('l.article_id', 'l.unit_price_fcfa', 'o.reference', 'o.created_at');
  const out = {};
  for (const r of rows) if (!out[r.article_id]) out[r.article_id] = { price: Number(r.unit_price_fcfa), reference: r.reference, at: isoTime(r.created_at) };
  return out;
}

async function resources(db, { all = true } = {}) {
  const q = db('debourse_resources as r').leftJoin('appro_articles as a', 'a.id', 'r.article_id').orderBy([{ column: 'r.sort' }, { column: 'r.label' }])
    .select('r.*', 'a.label as article_label', 'a.code as article_code');
  if (!all) q.where('r.active', true);
  const [rows, last] = await Promise.all([q, lastPurchasePrices(db).catch(() => ({}))]);
  return rows.map(r => ({
    id: r.id, code: r.code, nature: r.nature, label: r.label, unit: r.unit, unit_price: Number(r.unit_price_fcfa), loss_pct: Number(r.loss_pct),
    article_id: r.article_id || null, article_label: r.article_label ? `${r.article_code} — ${r.article_label}` : null, last_purchase: r.article_id ? last[r.article_id] || null : null,
    price_checked: !!r.price_checked, active: !!r.active, sort: r.sort,
  }));
}

async function works(db, { all = true } = {}) {
  const q = db('debourse_works').orderBy([{ column: 'sort' }, { column: 'label' }]);
  if (!all) q.where({ active: true });
  const [rows, items, res] = await Promise.all([q, db('debourse_work_items'), resources(db)]);
  const byId = Object.fromEntries(res.map(r => [r.id, r]));
  return rows.map(w => {
    const composition = items.filter(i => i.work_id === w.id).map(i => ({ resource_id: i.resource_id, quantity: Number(i.quantity), resource: byId[i.resource_id] }))
      .sort((a, b) => Object.keys(NATURES).indexOf(a.resource?.nature) - Object.keys(NATURES).indexOf(b.resource?.nature));
    const unit = require('../lib/debourse').unitCost(composition.map(c => ({ nature: c.resource.nature, quantity: c.quantity, unit_price: c.resource.unit_price, loss_pct: c.resource.loss_pct })));
    return { id: w.id, code: w.code, lot: w.lot, lot_label: LOTS[w.lot]?.label || w.lot, label: w.label, unit: w.unit, active: !!w.active, sort: w.sort,
      composition: composition.map(c => ({ resource_id: c.resource_id, quantity: c.quantity })), unit_cost: Math.round(unit.total) };
  });
}

async function models(db, { all = true } = {}) {
  const q = db('debourse_models as m').leftJoin('ref_items as t', 't.id', 'm.property_type_id').orderBy([{ column: 'm.sort' }, { column: 'm.label' }])
    .select('m.*', 't.label as property_type_label');
  if (!all) q.where('m.active', true);
  const [rows, lines] = await Promise.all([q, db('debourse_model_lines').orderBy(['model_id', 'sort'])]);
  return rows.map(m => ({
    id: m.id, label: m.label, property_type_id: m.property_type_id || null, property_type_label: m.property_type_label || null, description: m.description || null,
    params: json(m.params, {}), with_roof: !!m.with_roof, active: !!m.active, sort: m.sort,
    lines: lines.filter(l => l.model_id === m.id).map(l => ({ work_id: l.work_id, base: l.base, ratio: Number(l.ratio) })),
  }));
}

/** Tout ce que l'écran du déboursé sec affiche : référentiels, listes, taux par défaut. */
async function refs(db) {
  const [res, wks, mdl, units, types, settings, articles] = await Promise.all([
    resources(db), works(db), models(db), chantiers.listItems(db, 'unite', { all: true }),
    db('ref_items').where({ kind: 'type_bien', archived: false }).orderBy(['sort', 'label']).select('id', 'label'),
    chantiers.settings(db), db('appro_articles').where({ active: true }).orderBy('label').select('id', 'code', 'label', 'unit'),
  ]);
  return {
    natures: NATURES, lots: LOTS, params: PARAMS, bases: BASES, resources: res, works: wks, models: mdl, units, property_types: types, articles,
    rates: { site_pct: settings.debourse_site_pct, contingency_pct: settings.debourse_contingency_pct },
  };
}

async function checkUnit(db, unit) {
  if (!(await db('worksite_ref_items').where({ kind: 'unite', code: unit }).first('id'))) throw new HttpError(400, 'Unité inconnue (Chantiers › Réglages › Unités).');
}
async function uniqueCode(db, table, code, id = null) {
  if (await db(table).whereRaw('lower(code) = ?', [String(code).toLowerCase()]).whereNot({ id: id || 0 }).first('id')) throw new HttpError(409, 'Ce code existe déjà.');
}
const nextSort = async (db, table) => Number((await db(table).max({ m: 'sort' }).first())?.m || 0) + 1;

async function saveResource(db, data, id = null) {
  if (id && !(await db('debourse_resources').where({ id }).first('id'))) throw new HttpError(404, 'Ressource introuvable.');
  if (data.code !== undefined) await uniqueCode(db, 'debourse_resources', data.code, id);
  if (data.unit !== undefined) await checkUnit(db, data.unit);
  if (data.article_id && !(await db('appro_articles').where({ id: data.article_id }).first('id'))) throw new HttpError(400, 'Article du catalogue introuvable.');
  const row = { ...data };
  if (row.unit_price !== undefined) { row.unit_price_fcfa = row.unit_price; delete row.unit_price; }
  if (id) await db('debourse_resources').where({ id }).update({ ...row, updated_at: new Date() });
  else id = insertedId((await db('debourse_resources').insert({ ...row, sort: await nextSort(db, 'debourse_resources') }))[0]);
  return id;
}
/** Une ressource utilisée dans un ouvrage se désactive ; seule une ressource jamais utilisée se supprime. */
async function removeResource(db, id) {
  if (await db('debourse_work_items').where({ resource_id: id }).first('id')) throw new HttpError(409, 'Ressource utilisée dans un ouvrage : retirez-la des ouvrages ou désactivez-la.');
  if (!(await db('debourse_resources').where({ id }).del())) throw new HttpError(404, 'Ressource introuvable.');
}

async function saveWork(db, data, id = null) {
  if (id && !(await db('debourse_works').where({ id }).first('id'))) throw new HttpError(404, 'Ouvrage introuvable.');
  if (data.code !== undefined) await uniqueCode(db, 'debourse_works', data.code, id);
  if (data.unit !== undefined) await checkUnit(db, data.unit);
  const { composition, ...row } = data;
  if (composition) {
    const ids = composition.map(c => c.resource_id);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Une ressource ne figure qu’une fois dans la composition.');
    if (ids.length && (await db('debourse_resources').whereIn('id', ids).count({ n: '*' }).first()).n != ids.length) throw new HttpError(400, 'Ressource introuvable dans la composition.');
  }
  return db.transaction(async trx => {
    if (id) { if (Object.keys(row).length) await trx('debourse_works').where({ id }).update({ ...row, updated_at: new Date() }); }
    else id = insertedId((await trx('debourse_works').insert({ ...row, sort: await nextSort(trx, 'debourse_works') }))[0]);
    if (composition) {
      await trx('debourse_work_items').where({ work_id: id }).del();
      for (const c of composition) await trx('debourse_work_items').insert({ work_id: id, resource_id: c.resource_id, quantity: c.quantity });
    }
    return id;
  });
}
async function removeWork(db, id) {
  if (await db('debourse_model_lines').where({ work_id: id }).first('id')) throw new HttpError(409, 'Ouvrage utilisé dans un modèle : retirez-le du modèle ou désactivez-le.');
  if (!(await db('debourse_works').where({ id }).del())) throw new HttpError(404, 'Ouvrage introuvable.');
}

async function saveModel(db, data, id = null) {
  if (id && !(await db('debourse_models').where({ id }).first('id'))) throw new HttpError(404, 'Modèle introuvable.');
  if (data.params) { const errors = checkParams(data.params); if (errors.length) throw new HttpError(400, errors[0]); }
  if (data.property_type_id && !(await db('ref_items').where({ id: data.property_type_id, kind: 'type_bien' }).first('id'))) throw new HttpError(400, 'Type de bien inconnu (Paramètres du dashboard).');
  const { lines, ...row } = data;
  if (row.params) row.params = JSON.stringify(row.params);
  if (lines) {
    const ids = [...new Set(lines.map(l => l.work_id))];
    if (ids.length && (await db('debourse_works').whereIn('id', ids).count({ n: '*' }).first()).n != ids.length) throw new HttpError(400, 'Ouvrage introuvable dans le modèle.');
  }
  return db.transaction(async trx => {
    if (id) { if (Object.keys(row).length) await trx('debourse_models').where({ id }).update({ ...row, updated_at: new Date() }); }
    else id = insertedId((await trx('debourse_models').insert({ ...row, sort: await nextSort(trx, 'debourse_models') }))[0]);
    if (lines) {
      await trx('debourse_model_lines').where({ model_id: id }).del();
      for (const [i, l] of lines.entries()) await trx('debourse_model_lines').insert({ model_id: id, work_id: l.work_id, base: l.base, ratio: l.ratio, sort: i + 1 });
    }
    return id;
  });
}
async function removeModel(db, id) {
  if (!(await db('debourse_models').where({ id }).del())) throw new HttpError(404, 'Modèle introuvable.');
}

// ─── Estimations ──────────────────────────────────────────────────────────

/** Composition d'un ouvrage aux prix actuels du référentiel (figée dans l'estimation). */
async function compositionOf(db, workIds) {
  const rows = await db('debourse_work_items as i').join('debourse_resources as r', 'r.id', 'i.resource_id').whereIn('i.work_id', workIds)
    .select('i.work_id', 'i.quantity', 'r.id as resource_id', 'r.code', 'r.label', 'r.nature', 'r.unit', 'r.unit_price_fcfa', 'r.loss_pct', 'r.price_checked');
  const out = {};
  for (const r of rows) (out[r.work_id] ||= []).push({ resource_id: r.resource_id, code: r.code, label: r.label, nature: r.nature, unit: r.unit, quantity: Number(r.quantity), unit_price: Number(r.unit_price_fcfa), loss_pct: Number(r.loss_pct), price_checked: !!r.price_checked });
  return out;
}

/** Lignes d'une estimation tirées d'un modèle : quantité calculée = ratio × base ; composition aux prix du jour. */
async function linesFromModel(db, modelId, params) {
  const model = (await models(db)).find(m => m.id === modelId);
  if (!model) throw new HttpError(400, 'Modèle introuvable.');
  const wks = Object.fromEntries((await db('debourse_works').whereIn('id', model.lines.map(l => l.work_id))).map(w => [w.id, w]));
  const comp = await compositionOf(db, Object.keys(wks).map(Number));
  const b = bases(params);
  return { model, lines: model.lines.map((l, i) => ({
    key: `m${i + 1}`, work_id: l.work_id, work_code: wks[l.work_id].code, lot: wks[l.work_id].lot, label: wks[l.work_id].label, unit: wks[l.work_id].unit,
    base: l.base, ratio: l.ratio, auto_quantity: round4(l.ratio * (b[l.base] ?? 0)), quantity: null, composition: comp[l.work_id] || [],
  })) };
}

/** Quantités recalculées quand les paramètres changent ; une quantité saisie (métré) est gardée. */
function requantify(lines, params) {
  const b = bases(params);
  return lines.map(l => (l.base ? { ...l, auto_quantity: round4(l.ratio * (b[l.base] ?? 0)) } : l));
}

const LINKS = async (db, data) => {
  if (data.worksite_id) {
    const w = await db('worksites').where({ id: data.worksite_id }).first('project_id');
    if (!w) throw new HttpError(400, 'Chantier introuvable.');
    data.project_id = w.project_id;
  } else if (data.project_id && !(await db('projects').where({ id: data.project_id }).first('id'))) throw new HttpError(400, 'Programme introuvable.');
  if (data.property_type_id && !(await db('ref_items').where({ id: data.property_type_id, kind: 'type_bien' }).first('id'))) throw new HttpError(400, 'Type de bien inconnu.');
};

const estimateQuery = db => db('debourse_estimates as e').leftJoin('projects as p', 'p.id', 'e.project_id').leftJoin('worksites as w', 'w.id', 'e.worksite_id')
  .leftJoin('ref_items as t', 't.id', 'e.property_type_id').leftJoin('users as u', 'u.id', 'e.created_by').leftJoin('debourse_models as m', 'm.id', 'e.model_id')
  .leftJoin('worksites as bw', 'bw.id', 'e.budget_worksite_id')
  .select('e.*', 'p.name as project_name', 'w.reference as worksite_reference', 'w.name as worksite_name', 't.label as property_type_label', 'u.name as created_by_name',
    'm.label as model_label', 'bw.reference as budget_worksite_reference');

/** Estimation lue : paramètres, lignes, et le calcul complet (lib/debourse.estimate). */
function serializeEstimate(e, { detail = true } = {}) {
  const params = json(e.params, {}), lines = json(e.lines, []);
  const calc = estimate({ lines: lines.map(l => ({ ...l, quantity: l.quantity ?? l.auto_quantity })), units: e.units, withRoof: !!e.with_roof, rates: { site_pct: Number(e.site_pct), contingency_pct: Number(e.contingency_pct) }, params });
  const head = {
    id: e.id, reference: e.reference, label: e.label, model_id: e.model_id || null, model_label: e.model_label || null, property_type_id: e.property_type_id || null,
    property_type_label: e.property_type_label || null, project_id: e.project_id || null, project_name: e.project_name || null, worksite_id: e.worksite_id || null,
    worksite_label: e.worksite_reference ? `${e.worksite_reference} — ${e.worksite_name}` : null, units: e.units, with_roof: !!e.with_roof,
    site_pct: Number(e.site_pct), contingency_pct: Number(e.contingency_pct), params, priced_at: isoTime(e.priced_at), notes: e.notes || null,
    budget_worksite_id: e.budget_worksite_id || null, budget_worksite_reference: e.budget_worksite_reference || null, budget_at: isoTime(e.budget_at),
    created_by_name: e.created_by_name || null, created_at: isoTime(e.created_at), updated_at: isoTime(e.updated_at),
    dry_cost: calc.dry_cost, cost_price: calc.cost_price, per_m2: calc.per_m2, per_housing: calc.per_housing,
    unchecked_prices: lines.some(l => l.composition.some(c => !c.price_checked)),
  };
  if (!detail) return head;
  return { ...head, calc, lines: lines.map((l, i) => ({ ...l, ...calc.lines.find(c => c.key === l.key) && { total: calc.lines.find(c => c.key === l.key).total, unit_cost: calc.lines.find(c => c.key === l.key).unit_cost }, index: i })) };
}

async function listEstimates(db, { worksite_id = null, project_id = null } = {}) {
  const q = estimateQuery(db).orderBy('e.id', 'desc');
  if (worksite_id) q.where('e.worksite_id', worksite_id);
  if (project_id) q.where('e.project_id', project_id);
  return (await q).map(e => serializeEstimate(e, { detail: false }));
}
async function getEstimate(db, id) {
  const e = await estimateQuery(db).where('e.id', id).first();
  if (!e) throw new HttpError(404, 'Estimation introuvable.');
  return serializeEstimate(e);
}

async function nextReference(trx) {
  const p = `EST-${new Date().getUTCFullYear()}-`;
  const last = await trx('debourse_estimates').where('reference', 'like', `${p}%`).orderBy('reference', 'desc').first('reference');
  return `${p}${String(Number(last?.reference.slice(p.length) || 0) + 1).padStart(4, '0')}`;
}

/** Calcul sans enregistrer (aperçu pendant la saisie). */
async function preview(db, { model_id, params, units = 1, with_roof = null, site_pct = null, contingency_pct = null }) {
  const errors = checkParams(params);
  if (errors.length) throw new HttpError(400, errors[0]);
  const s = await chantiers.settings(db);
  const { model, lines } = await linesFromModel(db, model_id, params);
  return serializeEstimate({ id: null, reference: null, label: model.label, model_id, model_label: model.label, params: JSON.stringify(params), lines: JSON.stringify(lines), units,
    with_roof: with_roof ?? model.with_roof, site_pct: site_pct ?? s.debourse_site_pct, contingency_pct: contingency_pct ?? s.debourse_contingency_pct, priced_at: new Date() });
}

async function createEstimate(db, data, user) {
  const errors = checkParams(data.params);
  if (errors.length) throw new HttpError(400, errors[0]);
  await LINKS(db, data);
  const s = await chantiers.settings(db);
  const { model, lines } = await linesFromModel(db, data.model_id, data.params);
  const id = await db.transaction(async trx => insertedId((await trx('debourse_estimates').insert({
    reference: await nextReference(trx), label: data.label || model.label, model_id: model.id, property_type_id: data.property_type_id ?? model.property_type_id,
    project_id: data.project_id || null, worksite_id: data.worksite_id || null, params: JSON.stringify(data.params), units: data.units || 1,
    with_roof: data.with_roof ?? model.with_roof, site_pct: data.site_pct ?? s.debourse_site_pct, contingency_pct: data.contingency_pct ?? s.debourse_contingency_pct,
    lines: JSON.stringify(lines), priced_at: new Date(), notes: data.notes || null, created_by: user.id, updated_by: user.id,
  }))[0]));
  return getEstimate(db, id);
}

/**
 * Modification : libellé, rattachement, paramètres (quantités calculées mises à jour, métrés saisis gardés), bâtiments identiques,
 * toiture, taux, quantité d'une ligne (null : revenir au calcul), lignes retirées ou ajoutées (ouvrage du référentiel, métré saisi).
 */
async function updateEstimate(db, id, data, user) {
  const e = await db('debourse_estimates').where({ id }).first();
  if (!e) throw new HttpError(404, 'Estimation introuvable.');
  const row = {};
  for (const k of ['label', 'units', 'with_roof', 'site_pct', 'contingency_pct', 'notes', 'property_type_id']) if (data[k] !== undefined) row[k] = data[k];
  if (data.worksite_id !== undefined || data.project_id !== undefined) {
    const links = { worksite_id: data.worksite_id ?? null, project_id: data.project_id ?? null };
    await LINKS(db, links);
    Object.assign(row, links);
  }
  let lines = json(e.lines, []);
  let params = json(e.params, {});
  if (data.params) {
    const errors = checkParams(data.params);
    if (errors.length) throw new HttpError(400, errors[0]);
    params = data.params; row.params = JSON.stringify(params);
    lines = requantify(lines, params);
  }
  for (const q of data.quantities || []) {
    const l = lines.find(x => x.key === q.key);
    if (!l) throw new HttpError(400, 'Ligne de l’estimation introuvable.');
    if (!l.base && q.quantity == null) throw new HttpError(400, `${l.label} : ouvrage ajouté, saisissez sa quantité.`);
    l.quantity = q.quantity;
  }
  if (data.remove?.length) lines = lines.filter(l => !data.remove.includes(l.key));
  for (const add of data.add || []) {
    const w = await db('debourse_works').where({ id: add.work_id }).first();
    if (!w) throw new HttpError(400, 'Ouvrage introuvable.');
    const comp = await compositionOf(db, [w.id]);
    const n = Math.max(0, ...lines.map(l => Number(String(l.key).replace(/^\D+/, '')) || 0)) + 1;
    lines.push({ key: `a${n}`, work_id: w.id, work_code: w.code, lot: w.lot, label: w.label, unit: w.unit, base: null, ratio: null, auto_quantity: 0, quantity: add.quantity, composition: comp[w.id] || [] });
  }
  if (data.quantities || data.remove || data.add || data.params) row.lines = JSON.stringify(lines);
  await db('debourse_estimates').where({ id }).update({ ...row, updated_by: user.id, updated_at: new Date() });
  return getEstimate(db, id);
}

/** Recalcul aux prix actuels du référentiel (les quantités ne changent pas). */
async function repriceEstimate(db, id, user) {
  const e = await db('debourse_estimates').where({ id }).first();
  if (!e) throw new HttpError(404, 'Estimation introuvable.');
  const lines = json(e.lines, []);
  const comp = await compositionOf(db, [...new Set(lines.map(l => l.work_id))]);
  const next = lines.map(l => ({ ...l, composition: comp[l.work_id] || l.composition }));
  await db('debourse_estimates').where({ id }).update({ lines: JSON.stringify(next), priced_at: new Date(), updated_by: user.id, updated_at: new Date() });
  return getEstimate(db, id);
}

async function removeEstimate(db, id) {
  if (!(await db('debourse_estimates').where({ id }).del())) throw new HttpError(404, 'Estimation introuvable.');
}

const BUDGET_LABELS = { materiau: 'Matériaux', main_oeuvre: 'Main-d’œuvre', materiel: 'Engins et matériel' };

/**
 * Report au budget d'un chantier : une ligne par nature (postes Matériaux, Main-d'œuvre, Engins et matériel) et, pour le coût
 * de revient, les frais de chantier et les aléas (poste Frais de chantier). Les lignes déjà reportées depuis cette estimation
 * sur ce chantier sont remplacées (pas de doublon) ; les autres lignes du budget ne bougent pas.
 */
async function toBudget(db, id, w, { withCosts = true } = {}) {
  const est = await getEstimate(db, id);
  const tag = `[${est.reference}]`;
  const lines = [
    ...Object.entries(NATURES).map(([n, d]) => ({ category: d.poste, label: `Déboursé sec ${tag} — ${BUDGET_LABELS[n]}`, amount_fcfa: est.calc.natures[n] })),
    ...(withCosts ? [
      { category: 'frais', label: `Frais de chantier ${tag} (${est.site_pct} % du déboursé sec)`, amount_fcfa: est.calc.site_costs },
      { category: 'frais', label: `Aléas ${tag} (${est.contingency_pct} % du déboursé sec)`, amount_fcfa: est.calc.contingency },
    ] : []),
  ].filter(l => l.amount_fcfa > 0);
  await db('worksite_budget_lines').where({ worksite_id: w.id }).where('label', 'like', `%${tag}%`).del();
  for (const l of lines) await chantiers.saveBudgetLine(db, w, { ...l, notes: `Estimation ${est.reference} « ${est.label} » du ${est.priced_at.slice(0, 10).split('-').reverse().join('/')} (prix figés à cette date)` });
  await db('debourse_estimates').where({ id }).update({ budget_worksite_id: w.id, budget_at: new Date() });
  return { lines: lines.length, total: lines.reduce((t, l) => t + l.amount_fcfa, 0) };
}

module.exports = {
  refs, resources, works, models, saveResource, removeResource, saveWork, removeWork, saveModel, removeModel,
  preview, listEstimates, getEstimate, createEstimate, updateEstimate, repriceEstimate, removeEstimate, toBudget, serializeEstimate,
};
