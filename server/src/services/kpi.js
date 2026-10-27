/**
 * ERP · RH › Référentiel KPI (demande du client du 27/10, docs/cadrage-kpi-referentiels.md) : indicateurs du
 * référentiel, modèles d'objectifs d'un service ou d'un poste, application d'un modèle (objectifs de l'année créés pour
 * chaque employé concerné, rien d'écrasé sans le dire), objectifs collectifs des services, et cibles mensuelles du
 * Commercial › Objectifs, devenues des objectifs mensuels des fiches du personnel (une seule source).
 * Priorité : objectif ajusté à la main (employé) > modèle du poste > modèle du service.
 */
const { HttpError, isoDay } = require('../lib/http');
const { OBJECTIVE_METRICS, PERIOD_COUNT, SALES_TARGET_METRICS, periodRange, periodLabel } = require('../lib/rh');
const { DEPARTMENTS } = require('../lib/paie');
const { notify } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ─── Indicateurs du référentiel ─────────────────────────────
function serializeKpi(k, usage = {}) {
  const m = OBJECTIVE_METRICS[k.metric] || OBJECTIVE_METRICS.manuel;
  return {
    ...k, active: !!k.active, auto: k.metric !== 'manuel', unit: m.unit || null, lower: !!m.lower, cumul: !!m.cumul, needs: m.needs || null,
    service_only: m.level === 'service', computed_label: k.metric === 'manuel' ? null : m.label,
    objectives: usage.objectives || 0, collective: usage.collective || 0, templates: usage.templates || 0,
  };
}

async function listKpis(db) {
  const [rows, obj, col, lines] = await Promise.all([
    db('hr_kpis').orderBy(['sort', 'name']),
    db('hr_objectives').whereNotNull('kpi_id').groupBy('kpi_id').select('kpi_id').count({ n: '*' }),
    db('hr_department_objectives').whereNotNull('kpi_id').groupBy('kpi_id').select('kpi_id').count({ n: '*' }),
    db('hr_kpi_template_lines').groupBy('kpi_id').select('kpi_id').count({ n: '*' }),
  ]);
  const n = (list, id) => Number(list.find(x => x.kpi_id === id)?.n || 0);
  return rows.map(k => serializeKpi(k, { objectives: n(obj, k.id), collective: n(col, k.id), templates: n(lines, k.id) }));
}

async function getKpi(db, id) {
  const k = await db('hr_kpis').where({ id }).first();
  if (!k) throw new HttpError(404, 'Indicateur introuvable.');
  return k;
}

/** Contrôles d'un indicateur : nom unique (accents et majuscules compris), un seul indicateur par calcul, niveau, seuils. */
async function checkKpi(db, data, current = null) {
  const next = { ...(current || {}), ...data };
  const same = (await db('hr_kpis').whereNot('id', current?.id || 0).select('id', 'name', 'metric'));
  if (same.some(k => fold(k.name) === fold(next.name))) throw new HttpError(409, `Un indicateur « ${next.name} » existe déjà.`);
  if (next.metric !== 'manuel') {
    if (!OBJECTIVE_METRICS[next.metric]) throw new HttpError(400, 'Calcul inconnu.');
    const other = same.find(k => k.metric === next.metric);
    if (other) throw new HttpError(409, `Ce calcul est déjà l’indicateur « ${other.name} » : modifiez-le plutôt.`);
    if (OBJECTIVE_METRICS[next.metric].level === 'service' && next.level !== 'service') throw new HttpError(400, 'Cet indicateur se mesure sur le service entier : niveau « Service seulement ».');
  }
  if (Number(next.warn_pct) > Number(next.ok_pct)) throw new HttpError(400, 'Le seuil d’alerte ne dépasse pas le seuil d’atteinte.');
  if (current && data.metric && data.metric !== current.metric) {
    const used = await db('hr_objectives').where({ kpi_id: current.id }).first() || await db('hr_department_objectives').where({ kpi_id: current.id }).first()
      || await db('hr_kpi_template_lines').where({ kpi_id: current.id }).first();
    if (used) throw new HttpError(409, 'Indicateur déjà utilisé (objectifs ou modèles) : son calcul ne change plus (créez-en un autre).');
  }
}

async function createKpi(db, data) {
  await checkKpi(db, data);
  const last = await db('hr_kpis').max({ s: 'sort' }).first();
  const [id] = await db('hr_kpis').insert({ ...data, sort: Number(last?.s || 0) + 10 });
  return getKpi(db, insertedId(id));
}

async function updateKpi(db, k, data) {
  await checkKpi(db, data, k);
  await db('hr_kpis').where({ id: k.id }).update({ ...data, updated_at: new Date() });
  return getKpi(db, k.id);
}

// ─── Modèles d'objectifs ────────────────────────────────────
async function templateLines(db, templateIds) {
  if (!templateIds.length) return [];
  return (await db('hr_kpi_template_lines as l').join('hr_kpis as k', 'k.id', 'l.kpi_id').whereIn('l.template_id', templateIds)
    .orderBy(['l.template_id', 'l.sort', 'l.id']).select('l.*', 'k.name as kpi_name', 'k.metric', 'k.active as kpi_active'))
    .map(l => ({ ...l, target_value: l.target_value == null ? null : Number(l.target_value), kpi_active: !!l.kpi_active, unit: (OBJECTIVE_METRICS[l.metric] || {}).unit || null }));
}

/** Modèles de chaque service et de chaque poste actif (vides compris), avec l'effectif concerné. */
async function listTemplates(db) {
  const [templates, positions, staff] = await Promise.all([
    db('hr_kpi_templates'), db('hr_positions').where({ active: true }).orderBy('title'),
    db('employees').where({ active: true }).select('department', 'position_id'),
  ]);
  const lines = await templateLines(db, templates.map(t => t.id));
  const of = t => (t ? { id: t.id, updated_at: t.updated_at, lines: lines.filter(l => l.template_id === t.id) } : { id: null, lines: [] });
  return {
    services: Object.entries(DEPARTMENTS).map(([key, label]) => ({
      scope: 'service', department: key, label, headcount: staff.filter(e => e.department === key).length,
      ...of(templates.find(t => t.scope === 'service' && t.department === key)),
    })),
    postes: positions.map(p => ({
      scope: 'poste', position_id: p.id, label: p.title, department: p.department, headcount: staff.filter(e => e.position_id === p.id).length,
      ...of(templates.find(t => t.scope === 'poste' && t.position_id === p.id)),
    })),
  };
}

/** Enregistre les lignes du modèle d'un service ou d'un poste (aucune ligne : modèle supprimé). */
async function saveTemplate(db, { scope, department = null, position_id = null, lines }, user) {
  if (scope === 'service' && !DEPARTMENTS[department]) throw new HttpError(400, 'Service inconnu.');
  if (scope === 'poste' && !(await db('hr_positions').where({ id: position_id }).first())) throw new HttpError(404, 'Poste introuvable.');
  const kpis = Object.fromEntries((await db('hr_kpis').whereIn('id', lines.map(l => l.kpi_id).concat(0))).map(k => [k.id, k]));
  const seen = new Set();
  for (const l of lines) {
    const k = kpis[l.kpi_id];
    if (!k) throw new HttpError(404, 'Indicateur introuvable.');
    if (!k.active) throw new HttpError(400, `« ${k.name} » est archivé.`);
    if (k.level === 'service') throw new HttpError(400, `« ${k.name} » se mesure sur le service entier : fixez-le en objectif collectif du service.`);
    if (k.metric !== 'manuel' && l.target_value == null) throw new HttpError(400, `Indiquez la cible de « ${k.name} ».`);
    const key = `${l.kpi_id}|${l.period}`;
    if (seen.has(key)) throw new HttpError(409, `« ${k.name} » figure deux fois avec le même découpage.`);
    seen.add(key);
  }
  const where = scope === 'service' ? { scope, department } : { scope, position_id };
  return db.transaction(async trx => {
    let t = await trx('hr_kpi_templates').where(where).first();
    if (!lines.length) {
      if (t) await trx('hr_kpi_templates').where({ id: t.id }).del();
      return null;
    }
    if (t) await trx('hr_kpi_templates').where({ id: t.id }).update({ updated_by: user.id, updated_at: new Date() });
    else t = { id: insertedId((await trx('hr_kpi_templates').insert({ ...where, updated_by: user.id }))[0]) };
    await trx('hr_kpi_template_lines').where({ template_id: t.id }).del();
    await trx('hr_kpi_template_lines').insert(lines.map((l, i) => ({
      template_id: t.id, kpi_id: l.kpi_id, period: l.period, weight: l.weight, sort: i,
      target_value: kpis[l.kpi_id].metric === 'manuel' ? null : l.target_value,
    })));
    return t.id;
  });
}

/** Lignes qui s'appliquent à un employé : modèle de son service, remplacé ligne à ligne par celui de son poste. */
async function effectiveLines(db, e) {
  const templates = await db('hr_kpi_templates').where(q => q.where({ scope: 'service', department: e.department }).orWhere(b => b.where({ scope: 'poste' }).where('position_id', e.position_id || 0)));
  const lines = await templateLines(db, templates.map(t => t.id));
  const scopeOf = id => templates.find(t => t.id === id).scope;
  const out = new Map();
  for (const l of lines.filter(x => scopeOf(x.template_id) === 'service')) out.set(`${l.kpi_id}|${l.period}`, { ...l, from: 'service' });
  for (const l of lines.filter(x => scopeOf(x.template_id) === 'poste')) out.set(`${l.kpi_id}|${l.period}`, { ...l, from: 'poste' });
  return [...out.values()].filter(l => l.kpi_active);
}

/**
 * Objectifs à créer pour un employé et une année. Année en cours : à partir de la période en cours (un mois ou un
 * trimestre écoulé n'est pas créé après coup) ; jamais avant l'embauche ni après la sortie.
 */
function planFor(e, lines, year, now = new Date()) {
  const today = isoDay(now);
  const start = [year === now.getUTCFullYear() ? today : `${year}-01-01`, e.hire_date || `${year}-01-01`].sort().pop();
  const plan = [], skipped = [];
  for (const l of lines) {
    const m = OBJECTIVE_METRICS[l.metric] || OBJECTIVE_METRICS.manuel;
    if (m.needs === 'user' && !e.user_id) { skipped.push({ employee_id: e.id, kpi: l.kpi_name, reason: 'fiche non reliée à un compte du dashboard' }); continue; }
    if (m.needs === 'project' && !e.project_id) { skipped.push({ employee_id: e.id, kpi: l.kpi_name, reason: 'employé non affecté à un programme' }); continue; }
    for (let i = 1; i <= PERIOD_COUNT[l.period]; i++) {
      const index = l.period === 'annee' ? null : i;
      const r = periodRange(year, l.period, index);
      if (r.to < start || (e.end_date && r.from > e.end_date)) continue;
      plan.push({
        kpi_id: l.kpi_id, metric: l.metric, period: l.period, period_index: index, target_value: l.target_value, weight: l.weight, template_id: l.template_id,
        title: l.period === 'annee' ? l.kpi_name : `${l.kpi_name} — ${periodLabel(year, l.period, index)}`, due_date: r.to, from: l.from,
      });
    }
  }
  return { plan, skipped };
}

/**
 * Applique les modèles à des employés pour une année. `dryRun` : seulement le décompte (aperçu avant confirmation).
 * Un objectif déjà présent pour le même indicateur et la même période est mis à jour s'il vient d'un modèle et n'a pas
 * été ajusté à la main ; sinon il est conservé tel quel.
 */
async function apply(db, { employees, year, user = null, dryRun = false, now = new Date() }) {
  const out = { year, employees: 0, created: 0, updated: 0, unchanged: 0, kept: 0, skipped: [], people: [] };
  for (const e of employees) {
    const lines = await effectiveLines(db, e);
    if (!lines.length) continue;
    const { plan, skipped } = planFor(e, lines, year, now);
    out.skipped.push(...skipped.map(s => ({ ...s, name: `${e.last_name} ${e.first_name}` })));
    if (!plan.length) continue;
    out.employees++;
    const existing = await db('hr_objectives').where({ employee_id: e.id, year }).whereIn('kpi_id', [...new Set(plan.map(p => p.kpi_id))]);
    let created = 0;
    for (const p of plan) {
      const o = existing.find(x => x.kpi_id === p.kpi_id && (x.period || 'annee') === p.period && (x.period_index ?? null) === p.period_index);
      if (o) {
        if (o.source !== 'modele' || o.adjusted) { out.kept++; continue; }
        const target = p.target_value == null ? null : Number(p.target_value);
        if ((o.target_value == null ? null : Number(o.target_value)) === target && o.weight === p.weight) { out.unchanged++; continue; }
        out.updated++;
        if (!dryRun) await db('hr_objectives').where({ id: o.id }).update({ target_value: target, weight: p.weight, template_id: p.template_id, updated_at: new Date() });
        continue;
      }
      created++;
      if (!dryRun) {
        await db('hr_objectives').insert({
          employee_id: e.id, year, period: p.period, period_index: p.period_index, kpi_id: p.kpi_id, metric: p.metric, title: p.title.slice(0, 200),
          target_value: p.target_value, weight: p.weight, due_date: p.due_date, source: 'modele', template_id: p.template_id, created_by: user?.id || null,
        });
      }
    }
    out.created += created;
    out.people.push({ employee_id: e.id, name: `${e.last_name} ${e.first_name}`, created });
    if (!dryRun && created && e.user_id) {
      await notify(db, {
        to: e.user_id, except: user?.id, module: 'rh', event: 'objectifs.fixes', title: `Vos objectifs ${year} sont fixés`,
        body: `${created} objectif(s) ajouté(s) d’après le modèle de votre ${plan.some(p => p.from === 'poste') ? 'poste' : 'service'}.`,
        link: '/rh/moi', priority: 'info', key: `objectifs:${e.id}:${year}:${isoDay(now)}`,
      });
    }
  }
  return out;
}

/** Employés concernés par un modèle (service ou poste), ou tous ceux qui ont un modèle. */
async function employeesFor(db, { scope = null, department = null, position_id = null } = {}) {
  const q = db('employees').where({ active: true }).orderBy(['last_name', 'first_name']);
  if (scope === 'service') q.where({ department });
  if (scope === 'poste') q.where({ position_id });
  return (await q).map(require('./rh').normEmployee);
}

/** Nouvel arrivant, changement de poste ou de service : les modèles s'appliquent pour l'année en cours (sans bloquer). */
async function applyForEmployee(db, employeeId, { user = null, now = new Date() } = {}) {
  try {
    const e = require('./rh').normEmployee(await db('employees').where({ id: employeeId }).first());
    if (!e?.active) return null;
    return await apply(db, { employees: [e], year: now.getUTCFullYear(), user, now });
  } catch (err) {
    console.error('[kpi] modèles non appliqués à la fiche', employeeId, err.message);
    return null;
  }
}

// ─── Objectifs collectifs des services ──────────────────────
/** Indicateur d'un objectif (individuel ou collectif) : actif, de bon niveau ; calcul repris de l'indicateur. */
async function kpiFor(db, kpiId, level) {
  const k = await getKpi(db, kpiId);
  if (!k.active) throw new HttpError(400, `« ${k.name} » est archivé.`);
  if (level === 'individuel' && k.level === 'service') throw new HttpError(400, `« ${k.name} » se mesure sur le service entier : fixez-le en objectif collectif du service.`);
  if (level === 'service' && k.level === 'individuel') throw new HttpError(400, `« ${k.name} » est réservé aux objectifs des employés.`);
  return k;
}

/** Période d'un objectif : découpage connu et numéro dans les bornes. */
function checkPeriod(period = 'annee', index = null) {
  if (!PERIOD_COUNT[period]) throw new HttpError(400, 'Découpage : année, trimestre ou mois.');
  if (period === 'annee') return null;
  if (!(Number.isInteger(index) && index >= 1 && index <= PERIOD_COUNT[period])) throw new HttpError(400, period === 'mois' ? 'Choisissez le mois.' : 'Choisissez le trimestre.');
  return index;
}

// ─── Cibles mensuelles du Commercial › Objectifs ────────────
const monthParts = month => month.split('-').map(Number);

/** Cibles du mois de chaque commercial, lues dans les objectifs mensuels de sa fiche du personnel. */
async function salesTargets(db, month, users) {
  const [year, m] = monthParts(month);
  const employees = await db('employees').whereIn('user_id', users.map(u => u.id).concat(0)).select('id', 'user_id');
  const rows = await db('hr_objectives').whereIn('employee_id', employees.map(e => e.id).concat(0))
    .where({ year, period: 'mois', period_index: m }).whereIn('metric', SALES_TARGET_METRICS).whereNot('status', 'abandonne').orderBy('id');
  const out = {};
  for (const u of users) {
    const e = employees.find(x => x.user_id === u.id);
    const target = Object.fromEntries(SALES_TARGET_METRICS.map(k => [k, null]));
    if (e) for (const o of rows.filter(x => x.employee_id === e.id)) target[o.metric] = o.target_value == null ? null : Number(o.target_value);
    out[u.id] = { employee_id: e?.id || null, target };
  }
  return out;
}

/**
 * Fixe les cibles du mois d'un commercial (Commercial › Objectifs) : objectifs mensuels de sa fiche, marqués « ajustés »
 * (un modèle réappliqué ne les écrase pas). Champ absent : inchangé ; vide : cible retirée.
 */
async function setSalesTarget(db, { month, user_id, ...fields }, user) {
  const e = await db('employees').where({ user_id }).first();
  if (!e) throw new HttpError(409, 'Ce compte n’a pas de fiche du personnel : créez-la (RH › Personnel) pour lui fixer des objectifs.');
  const [year, m] = monthParts(month);
  const r = periodRange(year, 'mois', m);
  const kpis = Object.fromEntries((await db('hr_kpis').whereIn('metric', SALES_TARGET_METRICS)).map(k => [k.metric, k]));
  await db.transaction(async trx => {
    for (const metric of SALES_TARGET_METRICS) {
      if (fields[metric] === undefined) continue;
      const where = { employee_id: e.id, year, period: 'mois', period_index: m, metric };
      const o = await trx('hr_objectives').where(where).whereNot('status', 'abandonne').orderBy('id').first();
      if (fields[metric] == null) { if (o) await trx('hr_objectives').where({ id: o.id }).del(); continue; }
      if (o) await trx('hr_objectives').where({ id: o.id }).update({ target_value: fields[metric], adjusted: true, updated_at: new Date() });
      else {
        await trx('hr_objectives').insert({
          ...where, kpi_id: kpis[metric]?.id || null, title: `${kpis[metric]?.name || OBJECTIVE_METRICS[metric].label} — ${periodLabel(year, 'mois', m)}`,
          target_value: fields[metric], weight: 1, due_date: r.to, source: 'commercial', adjusted: true, created_by: user.id,
        });
      }
    }
  });
}

module.exports = {
  listKpis, getKpi, createKpi, updateKpi, serializeKpi, listTemplates, saveTemplate, effectiveLines, planFor, apply, employeesFor, applyForEmployee,
  kpiFor, checkPeriod, salesTargets, setSalesTarget,
};
