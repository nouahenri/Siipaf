/**
 * ERP · RH › Postes (RH › Réglages) et changement de poste daté. Un changement porte le nouveau poste et son service,
 * la catégorie, le salaire de base (droit paie:employees), le responsable direct, l'équipe rattachée et le rôle du
 * compte (droit users:write) ; il s'applique à sa date d'effet (tout de suite, ou par la tâche horaire si elle est
 * future) et laisse un événement daté dans la carrière.
 */
const { HttpError, isoDay, isoTime, json } = require('../lib/http');
const { POSITION_CHANGE_REASONS, CAREER_EVENTS } = require('../lib/rh');
const { DEPARTMENTS } = require('../lib/paie');
const { requireRole } = require('./roles');
const { notify } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const today = () => new Date().toISOString().slice(0, 10);
const fr = d => (d ? d.split('-').reverse().join('/') : '');

async function list(db, { all = true } = {}) {
  const rows = await db('hr_positions').modify(q => { if (!all) q.where({ active: true }); }).orderBy('title');
  const counts = await db('employees').where({ active: true }).whereNotNull('position_id').groupBy('position_id').select('position_id').count({ n: '*' });
  return rows.map(p => ({
    ...p, active: !!p.active, department_label: DEPARTMENTS[p.department] || p.department,
    employees: Number(counts.find(c => c.position_id === p.id)?.n || 0),
  }));
}

/** Le rôle Super administrateur se propose (ou se retire) pour un poste par un super administrateur seulement. */
async function check(db, data, actor, current = null) {
  if (data.department && !DEPARTMENTS[data.department]) throw new HttpError(400, 'Service inconnu.');
  if (data.default_role) await requireRole(db, data.default_role);
  const touchesSuper = data.default_role === 'super_admin' ? current?.default_role !== 'super_admin' : data.default_role !== undefined && current?.default_role === 'super_admin';
  if (touchesSuper && actor?.role !== 'super_admin') throw new HttpError(403, 'Seul un super administrateur propose ou retire le rôle super administrateur pour un poste.');
}

async function create(db, data, actor) {
  await check(db, data, actor);
  if (await db('hr_positions').whereRaw('lower(title) = ?', [data.title.toLowerCase()]).first()) throw new HttpError(409, 'Ce poste existe déjà.');
  const [id] = await db('hr_positions').insert(data);
  return insertedId(id);
}

/** Renommer un poste renomme l'intitulé recopié sur les fiches qui l'occupent. */
async function update(db, p, data, actor) {
  await check(db, data, actor, p);
  if (data.title && data.title.toLowerCase() !== p.title.toLowerCase()
    && await db('hr_positions').whereRaw('lower(title) = ?', [data.title.toLowerCase()]).whereNot({ id: p.id }).first()) throw new HttpError(409, 'Ce poste existe déjà.');
  await db.transaction(async trx => {
    await trx('hr_positions').where({ id: p.id }).update({ ...data, updated_at: new Date() });
    if (data.title && data.title !== p.title) await trx('employees').where({ position_id: p.id }).update({ job_title: data.title, updated_at: new Date() });
  });
}

/**
 * Poste d'une fiche créée ou modifiée ailleurs (création d'un compte, embauche d'un candidat, fiche paie) :
 * le poste choisi, sinon celui du même intitulé, sinon un nouveau poste créé à la volée pour que la liste reste complète.
 */
async function resolve(trx, { position_id = null, job_title = null, department = null }) {
  if (position_id) {
    const p = await trx('hr_positions').where({ id: position_id }).first();
    if (!p) throw new HttpError(404, 'Poste introuvable.');
    return { position_id: p.id, job_title: p.title, department: department || p.department };
  }
  if (!job_title) return {};
  const title = job_title.trim();
  const found = await trx('hr_positions').whereRaw('lower(title) = ?', [title.toLowerCase()]).first();
  if (found) return { position_id: found.id, job_title: found.title, department: department || found.department };
  const [id] = await trx('hr_positions').insert({ title: title.slice(0, 120), department: department || 'administratif' });
  return { position_id: insertedId(id), job_title: title, department: department || 'administratif' };
}

const changeRow = c => ({
  ...c, effective_date: isoDay(c.effective_date), applied_at: isoTime(c.applied_at), created_at: isoTime(c.created_at),
  team_ids: json(c.team_ids, []), change_manager: !!c.change_manager, reset_overrides: !!c.reset_overrides, base_salary: c.base_salary == null ? null : Number(c.base_salary),
  reason_label: POSITION_CHANGE_REASONS[c.reason]?.label || c.reason, department_label: DEPARTMENTS[c.department] || c.department,
});

/**
 * Enregistre un changement de poste ; appliqué tout de suite si la date d'effet est atteinte, sinon le jour venu.
 * `can` : droits du compte qui saisit (salaire : paie:employees ; rôle : users:write).
 */
async function changePosition(db, e, data, { user, can }) {
  if (!e.active) throw new HttpError(409, 'Employé sorti des effectifs.');
  if (!POSITION_CHANGE_REASONS[data.reason]) throw new HttpError(400, 'Motif inconnu.');
  const p = await db('hr_positions').where({ id: data.position_id }).first();
  if (!p) throw new HttpError(404, 'Poste introuvable.');
  const department = data.department || p.department;
  if (!DEPARTMENTS[department]) throw new HttpError(400, 'Service inconnu.');
  if (data.base_salary != null && !can('paie:employees')) throw new HttpError(403, 'Le salaire se modifie avec le droit « Gérer les fiches salariés ».');
  if (data.role) {
    if (!can('users:write')) throw new HttpError(403, 'Changer le rôle du compte demande le droit « Gérer les utilisateurs ».');
    if (!e.user_id) throw new HttpError(400, 'Cet employé n’a pas de compte : aucun rôle à changer.');
    await requireRole(db, data.role);
    const u = await db('users').where({ id: e.user_id }).first('role');
    if ((u.role === 'super_admin' || data.role === 'super_admin') && user.role !== 'super_admin') throw new HttpError(403, 'Seul un super administrateur modifie un super administrateur.');
    if (e.user_id === user.id) throw new HttpError(400, 'Vous ne pouvez pas changer votre propre rôle.');
  }
  const team = [...new Set((data.team_ids || []).map(Number))].filter(id => id !== e.id);
  if (data.change_manager && data.manager_id) {
    if (data.manager_id === e.id) throw new HttpError(400, 'Un employé ne peut pas être son propre responsable.');
    if (team.includes(data.manager_id)) throw new HttpError(400, 'Son nouveau responsable ne peut pas être dans son équipe.');
    // Pas de boucle : le nouveau responsable ne doit pas dépendre de lui
    for (let m = data.manager_id, guard = 0; m && guard < 50; guard++) {
      if (m === e.id) throw new HttpError(400, 'Cette hiérarchie formerait une boucle.');
      m = (await db('employees').where({ id: m }).first('manager_id'))?.manager_id;
    }
  }
  if (team.length && (await db('employees').whereIn('id', team).where({ active: true }).count({ n: '*' }).first()).n != team.length) throw new HttpError(400, 'Équipe : employé introuvable.');
  if (team.length && !data.change_manager && e.manager_id && team.includes(e.manager_id)) throw new HttpError(400, 'Son responsable actuel ne peut pas entrer dans son équipe.');
  const [id] = await db('hr_position_changes').insert({
    employee_id: e.id, position_id: p.id, job_title: p.title, department, category: data.category ?? null, base_salary: data.base_salary ?? null,
    change_manager: !!data.change_manager, manager_id: data.change_manager ? data.manager_id || null : null, team_ids: JSON.stringify(team), role: data.role || null,
    reset_overrides: !!(data.role && data.reset_overrides),
    effective_date: data.effective_date, reason: data.reason, note: data.note || null, created_by: user.id,
  });
  const changeId = insertedId(id);
  if (data.effective_date <= today()) await apply(db, changeId);
  return changeId;
}

/** Applique un changement planifié : fiche, équipe, rôle du compte, carrière, et prévient l'employé. */
async function apply(db, changeId) {
  const c = changeRow(await db('hr_position_changes').where({ id: changeId }).first());
  if (c.status !== 'planifie') return false;
  const e = await db('employees').where({ id: c.employee_id }).first();
  const before = { job_title: e.job_title, department: e.department, category: e.category, base_salary: e.base_salary == null ? null : Number(e.base_salary), manager_id: e.manager_id };
  const patch = { position_id: c.position_id, job_title: c.job_title, department: c.department, updated_at: new Date() };
  if (c.category) patch.category = c.category;
  if (c.base_salary != null) patch.base_salary = c.base_salary;
  if (c.change_manager) patch.manager_id = c.manager_id;
  let oldRole = null;
  await db.transaction(async trx => {
    await trx('employees').where({ id: e.id }).update(patch);
    if (c.team_ids.length) await trx('employees').whereIn('id', c.team_ids).update({ manager_id: e.id, updated_at: new Date() });
    let removed = [];
    if (c.role && e.user_id) {
      oldRole = (await trx('users').where({ id: e.user_id }).first('role'))?.role;
      await trx('users').where({ id: e.user_id }).update({ role: c.role, updated_at: new Date() });
      // Le nouveau rôle seul, sans les privilèges individuels de l'ancien poste (si demandé)
      if (c.reset_overrides) {
        removed = await trx('user_permissions').where({ user_id: e.user_id }).pluck('permission');
        await trx('user_permissions').where({ user_id: e.user_id }).del();
      }
    }
    const after = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([k]) => k in before)) };
    const details = Object.fromEntries(Object.keys(before).filter(k => String(before[k] ?? '') !== String(after[k] ?? '')).map(k => [k, { from: before[k], to: after[k] }]));
    if (c.team_ids.length) details.team = { to: c.team_ids };
    if (c.role) details.role = { from: oldRole, to: c.role };
    if (removed.length) details.privileges_removed = removed;
    if (c.note) details.note = c.note;
    await trx('hr_career_events').insert({
      employee_id: e.id, date: c.effective_date, kind: POSITION_CHANGE_REASONS[c.reason]?.career || 'autre',
      label: `${c.reason_label} : ${before.job_title} → ${c.job_title}`.slice(0, 255), details: JSON.stringify(details), created_by: c.created_by,
    });
    await trx('hr_position_changes').where({ id: c.id }).update({ status: 'applique', applied_at: new Date(), updated_at: new Date() });
  });
  if (e.user_id) {
    await notify(db, {
      to: e.user_id, except: c.created_by, module: 'rh', event: 'poste.change', title: `Nouveau poste : ${c.job_title}`,
      body: `${c.reason_label} — à compter du ${fr(c.effective_date)}${c.role ? '. Vos droits dans l’ERP ont été mis à jour.' : '.'}`,
      link: `/rh/personnel/${e.id}?onglet=carriere`, priority: 'info', key: `poste:${c.id}`, email: true,
    });
  }
  return true;
}

/** Tâche horaire : changements dont la date d'effet est atteinte. */
async function tick(db, day = today()) {
  let n = 0;
  for (const c of await db('hr_position_changes').where({ status: 'planifie' }).where('effective_date', '<=', day).orderBy('effective_date')) {
    if (await apply(db, c.id)) n++;
  }
  return n;
}

async function changesOf(db, employeeId) {
  const rows = await db('hr_position_changes as c').leftJoin('users as u', 'u.id', 'c.created_by').leftJoin('employees as m', 'm.id', 'c.manager_id')
    .where('c.employee_id', employeeId).orderBy('c.effective_date', 'desc').orderBy('c.id', 'desc')
    .select('c.*', 'u.name as created_by_name', 'm.last_name as manager_last', 'm.first_name as manager_first');
  return rows.map(c => ({ ...changeRow(c), manager_name: c.manager_last ? `${c.manager_last} ${c.manager_first}` : null }));
}

/**
 * Fusion de deux postes en double (« Commercial » et « Commerciale ») : les fiches et changements du premier passent au
 * second, qui donne son intitulé ; le premier disparaît. L'historique de carrière garde les anciens libellés.
 */
async function merge(db, from, into) {
  if (from.id === into.id) throw new HttpError(400, 'Choisissez un autre poste.');
  await db.transaction(async trx => {
    await trx('employees').where({ position_id: from.id }).update({ position_id: into.id, job_title: into.title, updated_at: new Date() });
    await trx('hr_position_changes').where({ position_id: from.id }).update({ position_id: into.id, job_title: into.title, updated_at: new Date() });
    await trx('hr_positions').where({ id: from.id }).del();
  });
}

async function cancel(db, c) {
  if (c.status !== 'planifie') throw new HttpError(409, 'Seul un changement planifié s’annule.');
  await db('hr_position_changes').where({ id: c.id }).update({ status: 'annule', updated_at: new Date() });
}

module.exports = { list, create, update, merge, resolve, changePosition, apply, tick, changesOf, cancel, CAREER_EVENTS };
