/**
 * ERP · Chantiers (choix du client du 24/10, docs/cadrage-chantiers.md). Plusieurs chantiers par programme : zone
 * couverte, conducteur de travaux, phases (Gantt), tâches (Kanban), budget par poste. Le conducteur nommé gère son
 * chantier sans autre droit ; chantiers:write gère tous les chantiers ; chantiers:read et la Direction consultent.
 * Règles dans lib/domain.js (WORKSITE_*, TASK_STATUSES, phaseState, worksiteProgress…).
 */
const { HttpError, json, isoDay, isoTime } = require('../lib/http');
const {
  WORKSITE_STATUSES, WORKSITE_OPEN, WORKSITE_ZONES, TASK_STATUSES, PHASE_STATES, SITE_STAGES, SITE_STAGE_LABELS,
  lotInZone, phaseState, worksiteProgress, phaseRefusal, CHANTIER_SETTINGS, budgetAlertLevel, TMA_STATUSES, NEED_STATUSES, SAV_CATEGORIES,
} = require('../lib/domain');
const { computePayslip } = require('../lib/paie');
const { splitVat } = require('../lib/compta');
const { notify, employeeUser, inform } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const today = () => new Date().toISOString().slice(0, 10);
const fr = d => (d ? d.split('-').reverse().join('/') : '');

/** Lecture de tous les chantiers : chantiers:read, chantiers:write, validation en direction, Vue Direction. */
const seesAll = v => ['chantiers:read', 'chantiers:write', 'chantiers:direction', 'direction:read'].some(p => v.can(p));
const canSee = (w, v) => seesAll(v) || Number(w.manager_id) === Number(v.user.id);
const canManage = (w, v) => v.can('chantiers:write') || Number(w.manager_id) === Number(v.user.id);

/** Référence annuelle : CH-2026-0001. */
async function nextReference(trx, date) {
  const p = `CH-${date.slice(0, 4)}-`;
  const last = await trx('worksites').where('reference', 'like', `${p}%`).orderBy('reference', 'desc').first('reference');
  return `${p}${String(last ? Number(last.reference.slice(p.length)) + 1 : 1).padStart(4, '0')}`;
}

const worksiteQuery = db => db('worksites as w').join('projects as p', 'p.id', 'w.project_id').leftJoin('users as u', 'u.id', 'w.manager_id')
  .select('w.*', 'p.name as project_name', 'u.name as manager_name');

const serializePhase = (p, day = today()) => {
  const row = {
    id: p.id, worksite_id: p.worksite_id, stage: p.stage || null, stage_label: p.stage ? SITE_STAGE_LABELS[p.stage] : null, label: p.label,
    planned_start: isoDay(p.planned_start), planned_end: isoDay(p.planned_end), actual_start: isoDay(p.actual_start), actual_end: isoDay(p.actual_end),
    progress_pct: p.actual_end ? 100 : Number(p.progress_pct) || 0, depends_on_id: p.depends_on_id || null, sort: p.sort, notes: p.notes || null,
  };
  const s = phaseState(row, day);
  return { ...row, state: s.state, state_label: PHASE_STATES[s.state], late_days: s.late_days };
};

const serializeTask = t => ({
  id: t.id, worksite_id: t.worksite_id, phase_id: t.phase_id || null, phase_label: t.phase_label || null, title: t.title, description: t.description || null,
  status: t.status, status_label: TASK_STATUSES[t.status], milestone: !!t.milestone, employee_id: t.employee_id || null,
  employee_name: t.employee_last ? `${t.employee_last} ${t.employee_first}` : null, supplier_id: t.supplier_id || null, supplier_name: t.supplier_name || null,
  team: t.team || null, start_on: isoDay(t.start_on), due_on: isoDay(t.due_on), done_on: isoDay(t.done_on), sort: t.sort,
  late: t.status !== 'fait' && !!t.due_on && today() > isoDay(t.due_on),
});

const serializeBudget = (b, labels = {}) => ({
  id: b.id, category: b.category, category_label: labels[b.category] || b.category, label: b.label, phase_id: b.phase_id || null,
  amount_fcfa: Number(b.amount_fcfa), notes: b.notes || null, sort: b.sort,
});

/** Libellé de la zone : « Tout le programme », « Îlots A, B », « Bât. A, Bât. B », « 12 lots ». */
function zoneLabel(w, buildings = []) {
  const zone = json(w.zone, []) || [];
  if (w.zone_kind === 'ilots') return zone.length ? `Îlot${zone.length > 1 ? 's' : ''} ${zone.join(', ')}` : 'Aucun îlot';
  if (w.zone_kind === 'batiments') {
    const codes = zone.map(id => buildings.find(b => Number(b.id) === Number(id))?.code).filter(Boolean);
    return codes.length ? codes.join(', ') : 'Aucun bâtiment';
  }
  if (w.zone_kind === 'lots') return `${zone.length} lot${zone.length > 1 ? 's' : ''}`;
  return WORKSITE_ZONES.programme;
}

function serializeWorksite(w, { phases = [], budget = 0, buildings = [] } = {}) {
  const ph = phases.map(p => (p.state ? p : serializePhase(p)));
  const late = ph.filter(p => p.state === 'en_retard');
  return {
    id: w.id, reference: w.reference, project_id: w.project_id, project_name: w.project_name, name: w.name,
    zone_kind: w.zone_kind, zone: json(w.zone, []) || [], zone_label: zoneLabel(w, buildings),
    manager_id: w.manager_id || null, manager_name: w.manager_name || null, status: w.status, status_label: WORKSITE_STATUSES[w.status],
    planned_start: isoDay(w.planned_start), planned_end: isoDay(w.planned_end), actual_start: isoDay(w.actual_start), actual_end: isoDay(w.actual_end),
    description: w.description || null, progress_pct: worksiteProgress(ph), phases_count: ph.length,
    late_phases: late.length, late_days: late.reduce((m, p) => Math.max(m, p.late_days), 0), budget_fcfa: budget,
    created_at: isoTime(w.created_at), updated_at: isoTime(w.updated_at),
  };
}

async function loadWorksite(db, id) {
  const w = await worksiteQuery(db).where('w.id', id).first();
  if (!w) throw new HttpError(404, 'Chantier introuvable.');
  return w;
}
async function visibleWorksite(db, id, v) {
  const w = await loadWorksite(db, id);
  if (!canSee(w, v)) throw new HttpError(404, 'Chantier introuvable.');
  return w;
}
async function managedWorksite(db, id, v) {
  const w = await visibleWorksite(db, id, v);
  if (!canManage(w, v)) throw new HttpError(403, 'Seuls le conducteur du chantier et les gestionnaires des chantiers le modifient.');
  return w;
}

// ─── Liste et fiche ───────────────────────────────────────────────────────

async function list(db, v, { status = 'ouverts', projectId = null, q = '' } = {}) {
  const query = worksiteQuery(db).orderBy([{ column: 'p.name' }, { column: 'w.reference' }]);
  if (status === 'ouverts') query.whereIn('w.status', WORKSITE_OPEN);
  else if (status) query.where('w.status', status);
  if (projectId) query.where('w.project_id', projectId);
  if (q) query.where(b => b.where('w.name', 'like', `%${q}%`).orWhere('w.reference', 'like', `%${q}%`).orWhere('p.name', 'like', `%${q}%`));
  if (!seesAll(v)) query.where('w.manager_id', v.user.id);
  const rows = await query;
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [phases, budgets, buildings, spent] = await Promise.all([
    db('worksite_phases').whereIn('worksite_id', ids),
    db('worksite_budget_lines').whereIn('worksite_id', ids).groupBy('worksite_id').select('worksite_id').sum({ total: 'amount_fcfa' }),
    db('buildings').whereIn('project_id', [...new Set(rows.map(r => r.project_id))]).select('id', 'code'),
    spentByWorksite(db, ids),
  ]);
  const day = today();
  return rows.map(w => {
    const out = serializeWorksite(w, {
      phases: phases.filter(p => p.worksite_id === w.id).map(p => serializePhase(p, day)),
      budget: Number(budgets.find(b => b.worksite_id === w.id)?.total || 0), buildings,
    });
    out.spent_fcfa = spent[w.id] || 0;
    out.consumed_pct = out.budget_fcfa ? Math.round((out.spent_fcfa / out.budget_fcfa) * 100) : null;
    return out;
  });
}

/** Lots de la zone du chantier (code, îlot, statut) : le lot vendu se voit, pas son prix. */
async function zoneLots(db, w) {
  const lots = await db('lots').where({ project_id: w.project_id }).select('id', 'code', 'ilot', 'building_id', 'status', 'project_id');
  const ws = { ...w, zone: json(w.zone, []) || [] };
  return lots.filter(l => lotInZone(ws, l));
}

async function detail(db, w, v) {
  const day = today();
  const [phases, tasks, budget, buildings, lots, postes] = await Promise.all([
    db('worksite_phases').where({ worksite_id: w.id }).orderBy(['sort', 'id']),
    db('worksite_tasks as t').leftJoin('worksite_phases as ph', 'ph.id', 't.phase_id').leftJoin('employees as e', 'e.id', 't.employee_id')
      .leftJoin('suppliers as s', 's.id', 't.supplier_id').where('t.worksite_id', w.id).orderBy([{ column: 't.sort' }, { column: 't.id' }])
      .select('t.*', 'ph.label as phase_label', 'e.last_name as employee_last', 'e.first_name as employee_first', 's.name as supplier_name'),
    db('worksite_budget_lines').where({ worksite_id: w.id }).orderBy(['sort', 'id']),
    db('buildings').where({ project_id: w.project_id }).select('id', 'code', 'ilot'),
    zoneLots(db, w),
    listItems(db, 'poste', { all: true }),
  ]);
  const ph = phases.map(p => serializePhase(p, day));
  const labels = Object.fromEntries(postes.map(p => [p.code, p.label]));
  const lines = budget.map(b => serializeBudget(b, labels));
  // Postes de la liste réglable (Chantiers › Réglages), dans son ordre ; un poste désactivé reste s'il est utilisé
  const byCategory = postes.map(p => ({ category: p.code, label: p.label, amount_fcfa: lines.filter(l => l.category === p.code).reduce((t, l) => t + l.amount_fcfa, 0) }));
  const sold = lots.filter(l => ['reserve', 'vendu'].includes(l.status)).length;
  const cost = await costs(db, w.id);
  const budgetTotal = lines.reduce((t, l) => t + l.amount_fcfa, 0);
  for (const c of byCategory) c.spent_fcfa = cost.by_category[c.category] || 0;
  const shown = byCategory.filter(c => c.amount_fcfa || c.spent_fcfa || postes.find(p => p.code === c.category)?.active);
  return {
    ...serializeWorksite(w, { phases: ph, budget: lines.reduce((t, l) => t + l.amount_fcfa, 0), buildings }),
    can_manage: canManage(w, v), phases: ph, tasks: tasks.map(serializeTask), budget_lines: lines, budget_by_category: shown,
    lots: { total: lots.length, sold, codes: lots.slice(0, 60).map(l => l.code) },
    costs: cost, spent_fcfa: cost.total, consumed_pct: budgetTotal ? Math.round((cost.total / budgetTotal) * 100) : null,
  };
}

// ─── Création, modification ───────────────────────────────────────────────

/** Contrôle la zone : îlots du programme, bâtiments ou lots du programme. */
async function checkZone(db, projectId, kind, zone) {
  const list = Array.isArray(zone) ? zone : [];
  if (kind === 'programme') return [];
  if (!list.length) throw new HttpError(400, 'Choisissez au moins un élément de la zone du chantier.');
  if (kind === 'ilots') {
    const ilots = (await db('lots').where({ project_id: projectId }).whereNotNull('ilot').distinct('ilot')).map(r => String(r.ilot));
    const bad = list.map(String).filter(i => !ilots.includes(i));
    if (bad.length) throw new HttpError(400, `Îlot inconnu dans ce programme : ${bad.join(', ')}.`);
    return [...new Set(list.map(String))];
  }
  const table = kind === 'batiments' ? 'buildings' : 'lots';
  const ids = [...new Set(list.map(Number))];
  const found = await db(table).where({ project_id: projectId }).whereIn('id', ids).count({ n: '*' }).first();
  if (Number(found.n) !== ids.length) throw new HttpError(400, kind === 'batiments' ? 'Bâtiment hors du programme.' : 'Lot hors du programme.');
  return ids;
}

function checkDates(d) {
  if (d.planned_start && d.planned_end && d.planned_end < d.planned_start) throw new HttpError(400, 'La fin prévue précède le début prévu.');
  if (d.actual_start && d.actual_end && d.actual_end < d.actual_start) throw new HttpError(400, 'La fin réelle précède le début réel.');
}

/** Nomination du conducteur : cloche et e-mail au compte nommé. */
async function announceManager(db, w, userId) {
  if (!w.manager_id || Number(w.manager_id) === Number(userId)) return;
  await notify(db, {
    to: w.manager_id, module: 'chantiers', event: 'chantier.conducteur', priority: 'action', email: true,
    title: `Vous êtes nommé conducteur du chantier ${w.reference}`, body: `${w.name} — ${w.project_name}`,
    link: `/chantiers/${w.id}`, key: `chantier:${w.id}:conducteur:${w.manager_id}`,
  });
}

async function create(db, data, user) {
  const project = await db('projects').where({ id: data.project_id }).first('id');
  if (!project) throw new HttpError(400, 'Programme introuvable.');
  checkDates(data);
  const zone = await checkZone(db, data.project_id, data.zone_kind || 'programme', data.zone);
  const id = await db.transaction(async trx => {
    const reference = await nextReference(trx, data.planned_start || today());
    const [row] = await trx('worksites').insert({
      reference, project_id: data.project_id, name: data.name, zone_kind: data.zone_kind || 'programme', zone: JSON.stringify(zone),
      manager_id: data.manager_id || null, status: data.status || 'preparation', planned_start: data.planned_start || null, planned_end: data.planned_end || null,
      actual_start: data.actual_start || null, actual_end: data.actual_end || null, description: data.description || null, created_by: user.id,
    });
    const wid = insertedId(row);
    // Phases de départ : étapes du journal de chantier choisies dans le formulaire
    const stages = (data.stages || []).filter(s => SITE_STAGES.includes(s)).sort((a, b) => SITE_STAGES.indexOf(a) - SITE_STAGES.indexOf(b));
    if (stages.length) await trx('worksite_phases').insert(stages.map((stage, i) => ({ worksite_id: wid, stage, label: SITE_STAGE_LABELS[stage], sort: i + 1 })));
    return wid;
  });
  const w = await loadWorksite(db, id);
  await announceManager(db, w, user.id);
  await inform(db, 'chantier.cree', {
    except: user.id, key: `chantier:${w.id}:cree`, link: `/chantiers/${w.id}`,
    title: `Nouveau chantier : ${w.reference} — ${w.name}`, body: `${w.project_name}${w.manager_name ? ` · conducteur : ${w.manager_name}` : ''}`,
  });
  return w;
}

async function update(db, w, data, user) {
  const next = { ...w, ...data };
  checkDates({
    planned_start: isoDay(next.planned_start), planned_end: isoDay(next.planned_end), actual_start: isoDay(next.actual_start), actual_end: isoDay(next.actual_end),
  });
  const row = { ...data, updated_at: new Date() };
  if (data.zone_kind !== undefined || data.zone !== undefined) {
    row.zone = JSON.stringify(await checkZone(db, w.project_id, next.zone_kind, data.zone !== undefined ? data.zone : json(w.zone, [])));
  }
  delete row.project_id; // un chantier ne change pas de programme
  await db('worksites').where({ id: w.id }).update(row);
  const after = await loadWorksite(db, w.id);
  if (data.manager_id && Number(data.manager_id) !== Number(w.manager_id)) await announceManager(db, after, user.id);
  return after;
}

async function remove(db, w) {
  // Un chantier qui porte déjà du travail se clôt ; seul un chantier vide se supprime
  const used = await db('worksite_tasks').where({ worksite_id: w.id }).first('id') || (await db('worksite_phases').where({ worksite_id: w.id }).where('progress_pct', '>', 0).first('id'));
  if (used) throw new HttpError(409, 'Ce chantier a déjà des tâches ou de l’avancement : passez-le « Clos » pour garder son historique.');
  await db('worksites').where({ id: w.id }).del();
}

// ─── Phases ───────────────────────────────────────────────────────────────

async function savePhase(db, w, data, phaseId = null) {
  const others = await db('worksite_phases').where({ worksite_id: w.id }).select('id', 'depends_on_id', 'sort');
  let current = null;
  if (phaseId) {
    current = await db('worksite_phases').where({ id: phaseId, worksite_id: w.id }).first();
    if (!current) throw new HttpError(404, 'Phase introuvable.');
  }
  const p = { ...(current ? serializePhase(current) : {}), ...data, id: phaseId };
  if (p.stage && !SITE_STAGES.includes(p.stage)) throw new HttpError(400, 'Étape de chantier inconnue.');
  const refusal = phaseRefusal(p, others.filter(o => o.id !== phaseId));
  if (refusal) throw new HttpError(400, refusal);
  // 100 % sans fin réelle : la phase se termine aujourd'hui ; une fin réelle vaut 100 %
  const row = { ...data };
  if (row.actual_end) row.progress_pct = 100;
  if (row.progress_pct === 100 && !p.actual_end) { row.actual_end = today(); if (!p.actual_start) row.actual_start = row.actual_end; }
  if (row.progress_pct > 0 && !p.actual_start && !row.actual_start) row.actual_start = today();
  if (phaseId) {
    await db('worksite_phases').where({ id: phaseId }).update({ ...row, updated_at: new Date() });
    return phaseId;
  }
  const sort = others.reduce((m, o) => Math.max(m, o.sort), 0) + 1;
  const [r] = await db('worksite_phases').insert({ worksite_id: w.id, label: data.label || SITE_STAGE_LABELS[data.stage], sort, ...row });
  return insertedId(r);
}

async function deletePhase(db, w, phaseId) {
  const p = await db('worksite_phases').where({ id: phaseId, worksite_id: w.id }).first();
  if (!p) throw new HttpError(404, 'Phase introuvable.');
  await db.transaction(async trx => {
    // Les phases qui suivaient celle-ci reprennent sa propre phase précédente
    await trx('worksite_phases').where({ worksite_id: w.id, depends_on_id: phaseId }).update({ depends_on_id: p.depends_on_id || null });
    await trx('worksite_phases').where({ id: phaseId }).del();
  });
}

async function reorderPhases(db, w, ids) {
  const own = (await db('worksite_phases').where({ worksite_id: w.id }).select('id')).map(r => r.id);
  if (ids.length !== own.length || ids.some(id => !own.includes(id))) throw new HttpError(400, 'Ordre des phases incomplet.');
  await db.transaction(async trx => { for (const [i, id] of ids.entries()) await trx('worksite_phases').where({ id }).update({ sort: i + 1 }); });
}

// ─── Tâches ───────────────────────────────────────────────────────────────

async function checkTaskLinks(db, w, data) {
  if (data.phase_id && !(await db('worksite_phases').where({ id: data.phase_id, worksite_id: w.id }).first('id'))) throw new HttpError(400, 'Phase hors du chantier.');
  if (data.start_on && data.due_on && data.due_on < data.start_on) throw new HttpError(400, 'L’échéance précède le début.');
}

/** Une tâche confiée à un employé relié à un compte le prévient (cloche). */
async function announceTask(db, w, task, userId) {
  if (!task.employee_id) return;
  const u = await employeeUser(db, task.employee_id);
  if (!u || u.id === userId) return;
  await notify(db, {
    to: u.id, module: 'chantiers', event: 'chantier.tache', title: `Tâche confiée : ${task.title}`,
    body: `${w.reference} — ${w.name}${task.due_on ? ` · échéance le ${fr(isoDay(task.due_on))}` : ''}`,
    link: `/chantiers/${w.id}?onglet=taches`, key: `chantier-tache:${task.id}:${task.employee_id}`,
  });
}

async function saveTask(db, w, data, user, taskId = null) {
  let current = null;
  if (taskId) {
    current = await db('worksite_tasks').where({ id: taskId, worksite_id: w.id }).first();
    if (!current) throw new HttpError(404, 'Tâche introuvable.');
  }
  const next = { ...(current || {}), ...data };
  await checkTaskLinks(db, w, { phase_id: next.phase_id, start_on: isoDay(next.start_on), due_on: isoDay(next.due_on) });
  const row = { ...data };
  if (data.status) row.done_on = data.status === 'fait' ? (current?.done_on && current.status === 'fait' ? current.done_on : data.done_on || today()) : null;
  let id = taskId;
  if (taskId) await db('worksite_tasks').where({ id: taskId }).update({ ...row, updated_at: new Date() });
  else {
    const max = await db('worksite_tasks').where({ worksite_id: w.id }).max({ m: 'sort' }).first();
    const [r] = await db('worksite_tasks').insert({ worksite_id: w.id, status: 'a_faire', ...row, sort: Number(max?.m || 0) + 1, created_by: user.id });
    id = insertedId(r);
  }
  const task = await db('worksite_tasks').where({ id }).first();
  if (task.employee_id && Number(task.employee_id) !== Number(current?.employee_id)) await announceTask(db, w, task, user.id);
  return id;
}

async function deleteTask(db, w, taskId) {
  const n = await db('worksite_tasks').where({ id: taskId, worksite_id: w.id }).del();
  if (!n) throw new HttpError(404, 'Tâche introuvable.');
}

// ─── Budget ───────────────────────────────────────────────────────────────

async function saveBudgetLine(db, w, data, lineId = null) {
  const current = lineId ? await db('worksite_budget_lines').where({ id: lineId, worksite_id: w.id }).first('category') : null;
  if (data.category !== undefined) await checkListCode(db, 'poste', data.category, current?.category);
  if (data.phase_id && !(await db('worksite_phases').where({ id: data.phase_id, worksite_id: w.id }).first('id'))) throw new HttpError(400, 'Phase hors du chantier.');
  if (lineId) {
    const n = await db('worksite_budget_lines').where({ id: lineId, worksite_id: w.id }).update({ ...data, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Ligne de budget introuvable.');
    return lineId;
  }
  const max = await db('worksite_budget_lines').where({ worksite_id: w.id }).max({ m: 'sort' }).first();
  const [r] = await db('worksite_budget_lines').insert({ worksite_id: w.id, ...data, sort: Number(max?.m || 0) + 1 });
  return insertedId(r);
}

async function deleteBudgetLine(db, w, lineId) {
  const n = await db('worksite_budget_lines').where({ id: lineId, worksite_id: w.id }).del();
  if (!n) throw new HttpError(404, 'Ligne de budget introuvable.');
}

// ─── Imputation au chantier (achats, parc, pointages) ─────────────────────

/**
 * Programme et chantier d'une imputation : le chantier fixe le programme ; un programme seul reste possible
 * (frais du programme sans chantier précis). Refus si le chantier n'appartient pas au programme indiqué.
 */
async function resolveSite(db, { project_id = null, worksite_id = null }) {
  if (!worksite_id) return { project_id: project_id || null, worksite_id: null };
  const w = await db('worksites').where({ id: worksite_id }).first('id', 'project_id');
  if (!w) throw new HttpError(400, 'Chantier introuvable.');
  if (project_id && Number(project_id) !== Number(w.project_id)) throw new HttpError(400, 'Ce chantier n’appartient pas au programme choisi.');
  return { project_id: w.project_id, worksite_id: w.id };
}

/** Programmes et leurs chantiers non clos, pour les listes « Lieu / chantier » des autres modules. */
async function places(db) {
  const [projects, worksites] = await Promise.all([
    db('projects').orderBy('name').select('id', 'name'),
    db('worksites').whereNot('status', 'clos').orderBy('reference').select('id', 'reference', 'name', 'project_id'),
  ]);
  return projects.map(p => ({ id: p.id, name: p.name, worksites: worksites.filter(w => w.project_id === p.id).map(w => ({ id: w.id, reference: w.reference, name: w.name })) }));
}

// ─── Réglages ─────────────────────────────────────────────────────────────

async function settings(db) {
  const rows = await db('app_settings').whereIn('key', Object.keys(CHANTIER_SETTINGS)).select('key', 'value');
  const out = Object.fromEntries(Object.entries(CHANTIER_SETTINGS).map(([k, x]) => [k, x.default]));
  for (const r of rows) {
    const def = CHANTIER_SETTINGS[r.key];
    if (def.options) { if (def.options[r.value]) out[r.key] = r.value; } // choix dans une liste
    else if (r.value != null && r.value !== '' && Number.isFinite(Number(r.value))) out[r.key] = Number(r.value);
  }
  return out;
}
async function saveSettings(db, values) {
  await require('./settings').saveSettings(db, values);
  return settings(db);
}

// ─── Coûts réels ──────────────────────────────────────────────────────────

/** Coût d'une heure de chantier : taux saisi sur la fiche, sinon coût mensuel employeur de la paie ÷ heures du mois. */
function hourlyCost(e, payroll, monthlyHours) {
  if (e.site_hourly_rate != null && Number(e.site_hourly_rate) > 0) return { rate: Number(e.site_hourly_rate), source: 'fiche' };
  if (!Number(e.base_salary)) return { rate: 0, source: 'aucun' };
  return { rate: Math.round(computePayslip(e, {}, payroll).employer_cost / monthlyHours), source: 'salaire' };
}

const hoursOf = a => (a.check_in && a.check_out ? Math.max(0, (new Date(a.check_out) - new Date(a.check_in)) / 3600000) : 0);
const htOf = (amount, rate) => splitVat(Number(amount), Number(rate) || 0).ht;

/** Factures d'achat du chantier, hors celles nées d'une dépense du Parc (comptées avec le Parc) et hors annulées. */
const purchasesQuery = (db, ids) => db('purchase_invoices as i').join('suppliers as s', 's.id', 'i.supplier_id').whereIn('i.worksite_id', ids)
  .whereNot('i.status', 'annulee').whereNotIn('i.id', db('asset_costs').whereNotNull('purchase_invoice_id').select('purchase_invoice_id'));

/** Main-d'œuvre pointée : heures par employé et par chantier, valorisées au coût horaire. */
async function laborRows(db, ids) {
  const rows = await db('hr_attendances as a').join('employees as e', 'e.id', 'a.employee_id').whereIn('a.worksite_id', ids).whereNotNull('a.check_out')
    .select('a.worksite_id', 'a.check_in', 'a.check_out', 'e.*', 'e.id as employee_id');
  if (!rows.length) return [];
  const [payroll, s] = await Promise.all([require('./paie').getSettings(db), settings(db)]);
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.worksite_id}:${r.employee_id}`;
    if (!groups.has(k)) groups.set(k, { worksite_id: r.worksite_id, employee_id: r.employee_id, name: `${r.last_name} ${r.first_name}`, job_title: r.job_title, hours: 0, ...hourlyCost(r, payroll, s.chantier_monthly_hours) });
    groups.get(k).hours += hoursOf(r);
  }
  return [...groups.values()].map(g => ({ ...g, hours: Math.round(g.hours * 10) / 10, amount_fcfa: Math.round(g.hours * g.rate) }));
}

/** Total des coûts réels par chantier (liste des chantiers, alertes de budget). */
async function spentByWorksite(db, ids) {
  if (!ids.length) return {};
  const out = Object.fromEntries(ids.map(id => [id, 0]));
  const [purchases, parc, labor] = await Promise.all([
    purchasesQuery(db, ids).groupBy('i.worksite_id').select('i.worksite_id').sum({ t: 'i.amount_ht' }),
    db('asset_costs').whereIn('worksite_id', ids).whereNull('rejected_at').select('worksite_id', 'amount', 'vat_rate'),
    laborRows(db, ids),
  ]);
  for (const r of purchases) out[r.worksite_id] += Number(r.t) || 0;
  for (const r of parc) out[r.worksite_id] += htOf(r.amount, r.vat_rate);
  for (const r of labor) out[r.worksite_id] += r.amount_fcfa;
  return out;
}

/** Détail des coûts réels d'un chantier, par poste du budget et par source. */
async function costs(db, worksiteId) {
  const [purchases, parc, labor, paid] = await Promise.all([
    purchasesQuery(db, [worksiteId]).orderBy('i.date', 'desc')
      .select('i.id', 'i.number', 'i.date', 'i.label', 'i.amount_ht', 'i.status', 'i.worksite_category', 's.name as supplier_name'),
    db('asset_costs as c').join('assets as a', 'a.id', 'c.asset_id').where('c.worksite_id', worksiteId).whereNull('c.rejected_at').orderBy('c.date', 'desc')
      .select('c.id', 'c.date', 'c.kind', 'c.amount', 'c.vat_rate', 'c.label', 'a.id as asset_id', 'a.code', 'a.name'),
    laborRows(db, [worksiteId]),
    purchasesQuery(db, [worksiteId]).join('purchase_payments as pp', 'pp.invoice_id', 'i.id').sum({ t: 'pp.amount' }).first(),
  ]);
  const by = Object.fromEntries((await listItems(db, 'poste', { all: true })).map(p => [p.code, 0]));
  const p = purchases.map(r => ({
    id: r.id, number: r.number, date: isoDay(r.date), label: r.label, supplier_name: r.supplier_name, status: r.status,
    category: r.worksite_category || 'materiaux', amount_fcfa: Number(r.amount_ht),
  }));
  for (const r of p) by[r.category] = (by[r.category] || 0) + r.amount_fcfa;
  const a = parc.map(r => ({ id: r.id, date: isoDay(r.date), kind: r.kind, label: r.label, asset_id: r.asset_id, asset: `${r.code} ${r.name}`, amount_fcfa: htOf(r.amount, r.vat_rate) }));
  by.engins = (by.engins || 0) + a.reduce((t, r) => t + r.amount_fcfa, 0);
  by.main_oeuvre = (by.main_oeuvre || 0) + labor.reduce((t, r) => t + r.amount_fcfa, 0);
  return {
    by_category: by, total: Object.values(by).reduce((t, v) => t + v, 0), purchases: p, parc: a,
    labor: labor.map(({ worksite_id, ...r }) => r), paid_fcfa: Number(paid?.t) || 0,
    drafts_fcfa: p.filter(r => r.status === 'brouillon').reduce((t, r) => t + r.amount_fcfa, 0),
  };
}

/**
 * Alerte de budget (tâche horaire) : une fois au seuil réglé, une fois au dépassement, au conducteur et à la
 * Direction (validation en direction des chantiers, Vue Direction).
 */
async function tick(db) {
  const open = await worksiteQuery(db).whereIn('w.status', WORKSITE_OPEN);
  if (!open.length) return 0;
  const ids = open.map(w => w.id);
  const [budgets, spent, s] = await Promise.all([
    db('worksite_budget_lines').whereIn('worksite_id', ids).groupBy('worksite_id').select('worksite_id').sum({ total: 'amount_fcfa' }),
    spentByWorksite(db, ids), settings(db),
  ]);
  let n = 0;
  for (const w of open) {
    const budget = Number(budgets.find(b => b.worksite_id === w.id)?.total || 0);
    const level = budgetAlertLevel(spent[w.id] || 0, budget, s.chantier_budget_alert_pct);
    if (!level) continue;
    const pct = Math.round(((spent[w.id] || 0) / budget) * 100);
    const title = level === 'depasse' ? `Budget dépassé : ${w.reference} (${pct} %)` : `Budget consommé à ${pct} % : ${w.reference}`;
    // Le conducteur et les services du circuit (Direction générale, exploitation, Comptabilité par défaut)
    n += await inform(db, 'budget.depasse', {
      direct: [w.manager_id], priority: level === 'depasse' ? 'urgent' : 'action', title, links: { compta: '/compta' },
      body: `${w.name} — ${w.project_name}`, link: `/chantiers/${w.id}?onglet=budget`, key: `chantier-budget:${w.id}:${level}`, email: level === 'depasse',
    });
  }
  return n;
}

// ─── Listes réglables (Chantiers › Réglages) : postes du budget, météo du journal ──

const LIST_KINDS = { poste: 'Postes du budget', meteo: 'Météo du journal', unite: 'Unités des besoins en matériaux' };
// Où chaque liste est utilisée (un élément utilisé se désactive au lieu d'être supprimé)
const LIST_USES = { poste: [['worksite_budget_lines', 'category'], ['purchase_invoices', 'worksite_category']], meteo: [['worksite_journal', 'weather']], unite: [['worksite_needs', 'unit']] };

async function listItems(db, kind, { all = false } = {}) {
  const q = db('worksite_ref_items').where({ kind }).orderBy([{ column: 'sort' }, { column: 'id' }]);
  if (!all) q.where({ active: true });
  return (await q).map(r => ({ id: r.id, code: r.code, label: r.label, system: !!r.system, active: !!r.active, sort: r.sort }));
}

/** Refus d'un code inconnu ou désactivé (sauf s'il est déjà celui de la pièce). */
async function checkListCode(db, kind, code, current = null) {
  if (code == null || code === current) return;
  if (!(await db('worksite_ref_items').where({ kind, code, active: true }).first('id'))) {
    throw new HttpError(400, `${kind === 'poste' ? 'Poste du budget' : 'Météo'} inconnu ou désactivé (Chantiers › Réglages).`);
  }
}

// Doublon de libellé, accents compris (lower() de SQLite ne connaît pas les lettres accentuées)
const sameLabel = async (db, kind, label, exceptId = 0) => (await db('worksite_ref_items').where({ kind }).whereNot({ id: exceptId }).select('label'))
  .some(r => r.label.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr'));
const slug = label => String(label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'element';

async function addListItem(db, kind, label) {
  if (await sameLabel(db, kind, label)) throw new HttpError(409, 'Cet élément existe déjà.');
  let code = slug(label);
  for (let i = 2; await db('worksite_ref_items').where({ kind, code }).first(); i++) code = `${slug(label).slice(0, 20)}_${i}`;
  const max = await db('worksite_ref_items').where({ kind }).max({ m: 'sort' }).first();
  await db('worksite_ref_items').insert({ kind, code, label, sort: Number(max?.m || 0) + 1 });
}

async function updateListItem(db, id, data) {
  const item = await db('worksite_ref_items').where({ id }).first();
  if (!item) throw new HttpError(404, 'Élément introuvable.');
  if (data.active === false && item.system) throw new HttpError(409, 'Ce poste sert au calcul des coûts réels : il se renomme mais ne se désactive pas.');
  if (data.label && await sameLabel(db, item.kind, data.label, id)) throw new HttpError(409, 'Cet élément existe déjà.');
  await db('worksite_ref_items').where({ id }).update({ ...data, updated_at: new Date() });
  return item.kind;
}

async function removeListItem(db, id) {
  const item = await db('worksite_ref_items').where({ id }).first();
  if (!item) throw new HttpError(404, 'Élément introuvable.');
  if (item.system) throw new HttpError(409, 'Ce poste sert au calcul des coûts réels : il ne se supprime pas.');
  for (const [table, column] of LIST_USES[item.kind]) {
    if (await db(table).where(column, item.code).first()) throw new HttpError(409, 'Cet élément est déjà utilisé : désactivez-le pour qu’il ne soit plus proposé.');
  }
  await db('worksite_ref_items').where({ id }).del();
  return item.kind;
}

async function reorderList(db, kind, ids) {
  const own = (await db('worksite_ref_items').where({ kind }).select('id')).map(r => r.id);
  if (ids.length !== own.length || ids.some(id => !own.includes(id))) throw new HttpError(400, 'Ordre incomplet.');
  await db.transaction(async trx => { for (const [i, id] of ids.entries()) await trx('worksite_ref_items').where({ id }).update({ sort: i }); });
}

// ─── Références et pastilles ──────────────────────────────────────────────

async function refs(db) {
  const [projects, users, employees, suppliers, postes, meteo, unites, articles] = await Promise.all([
    // (articles : catalogue Achats & stocks, proposé pour les besoins en matériaux)
    db('projects').orderBy('name').select('id', 'name'),
    db('users').where({ active: true }).orderBy('name').select('id', 'name', 'role'),
    db('employees').where({ active: true }).orderBy(['last_name', 'first_name']).select('id', 'last_name', 'first_name', 'job_title'),
    db('suppliers').where({ active: true }).orderBy('name').select('id', 'name', 'kind'),
    listItems(db, 'poste', { all: true }), listItems(db, 'meteo', { all: true }), listItems(db, 'unite', { all: true }),
    db('appro_articles').where({ active: true }).orderBy('label').select('id', 'code', 'label', 'unit'),
  ]);
  return {
    statuses: WORKSITE_STATUSES, zones: WORKSITE_ZONES, task_statuses: TASK_STATUSES, phase_states: PHASE_STATES,
    // Listes réglables : choix proposés (actifs) et libellés de tout ce qui est enregistré
    budget_categories: Object.fromEntries(postes.filter(p => p.active).map(p => [p.code, p.label])), budget_labels: Object.fromEntries(postes.map(p => [p.code, p.label])),
    weather: Object.fromEntries(meteo.filter(p => p.active).map(p => [p.code, p.label])), weather_labels: Object.fromEntries(meteo.map(p => [p.code, p.label])),
    units: Object.fromEntries(unites.filter(p => p.active).map(p => [p.code, p.label])), unit_labels: Object.fromEntries(unites.map(p => [p.code, p.label])),
    articles, tma_statuses: TMA_STATUSES, need_statuses: NEED_STATUSES, sav_categories: SAV_CATEGORIES,
    lists: { poste: postes, meteo, unite: unites },
    stages: SITE_STAGES.map(k => ({ key: k, label: SITE_STAGE_LABELS[k] })), projects, users,
    employees: employees.map(e => ({ id: e.id, label: `${e.last_name} ${e.first_name}`, job_title: e.job_title || null })), suppliers,
  };
}

/** Îlots, bâtiments et lots d'un programme (choix de la zone d'un chantier). */
async function programme(db, projectId) {
  const [lots, buildings] = await Promise.all([
    db('lots').where({ project_id: projectId }).select('id', 'code', 'ilot', 'building_id', 'status'),
    db('buildings').where({ project_id: projectId }).orderBy('code').select('id', 'code', 'name', 'ilot'),
  ]);
  const ilots = [...new Set(lots.map(l => l.ilot).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  return { ilots, buildings, lots: lots.sort((a, b) => String(a.code).localeCompare(String(b.code), 'fr', { numeric: true })) };
}

/** Pastilles du menu : chantiers ouverts du compte (conducteur), phases en retard des chantiers visibles. */
async function badges(db, v) {
  const open = await db('worksites').whereIn('status', WORKSITE_OPEN).select('id', 'manager_id');
  const visible = open.filter(w => canSee(w, v));
  const phases = visible.length ? await db('worksite_phases').whereIn('worksite_id', visible.map(w => w.id)) : [];
  const day = today();
  const toDeclare = v.can('chantiers:direction') ? Number((await db('stage_declarations').where({ status: 'signalee' }).count({ n: '*' }).first()).n) : 0;
  const toValidate = v.can('chantiers:direction') ? Number((await db('worksite_situations').where({ status: 'verifiee' }).count({ n: '*' }).first()).n) : 0;
  return {
    to_declare: toDeclare,
    situations_to_validate: toValidate,
    // Lot 5 : TMA à chiffrer sur les chantiers du compte (les besoins sont traités par les Achats)
    tma_to_quote: visible.length ? Number((await db('worksite_changes').where({ status: 'demandee' }).whereIn('worksite_id', visible.filter(w => canManage(w, v)).map(w => w.id)).count({ n: '*' }).first()).n) : 0,
    mine: open.filter(w => Number(w.manager_id) === Number(v.user.id)).length,
    open: visible.length,
    late_phases: phases.filter(p => serializePhase(p, day).state === 'en_retard').length,
  };
}

module.exports = {
  seesAll, canSee, canManage, loadWorksite, visibleWorksite, managedWorksite, list, detail, create, update, remove,
  savePhase, deletePhase, reorderPhases, saveTask, deleteTask, saveBudgetLine, deleteBudgetLine, refs, programme, badges, zoneLots, serializeWorksite,
  resolveSite, places, settings, saveSettings, hourlyCost, costs, spentByWorksite, tick,
  LIST_KINDS, listItems, checkListCode, addListItem, updateListItem, removeListItem, reorderList,
};
