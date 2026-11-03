/**
 * Directions et services (demande du client du 03/11), sur le modèle des postes de RH › Réglages : ajouter, modifier,
 * archiver, fusionner (et supprimer ce qui n'a jamais servi). Deux niveaux : une direction regroupe des services ; un
 * employé appartient à un service. La clé d'un service, rangée dans les autres tables, ne change jamais : renommer ne touche
 * que le libellé ; fusionner fait passer tout ce qui porte le service (fiches, postes, courrier, demandes, objectifs…) au
 * service gardé. Après chaque changement, la copie en mémoire (lib/org) est relue.
 */
const { HttpError, json } = require('../lib/http');
const org = require('../lib/org');
const rh = require('./rh');
const kpi = require('./kpi');
const { inform } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);

// Tables qui rangent la clé d'un service (et la colonne)
const REFERENCES = [
  ['employees', 'department'], ['hr_positions', 'department'], ['hr_position_changes', 'department'], ['hr_jobs', 'department'],
  ['mail_items', 'assigned_department'], ['asset_reservations', 'department'], ['internal_docs', 'department'], ['internal_requests', 'department'],
  ['litigations', 'department'], ['hr_kpi_templates', 'department'], ['hr_department_objectives', 'department'],
];

/** Clé lisible tirée du libellé (« Trésorerie » → tresorerie), unique, 20 caractères au plus. */
async function newKey(db, label) {
  const base = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16) || 'service';
  let key = base;
  for (let n = 2; await db('org_units').where({ key }).first('id'); n++) key = `${base.slice(0, 16)}_${n}`;
  return key;
}

/** Nombre de fiches, postes, courriers… qui portent chaque service (actifs et passés). */
async function usage(db) {
  const out = {};
  for (const [table, column] of REFERENCES) {
    if (!(await db.schema.hasTable(table))) continue;
    for (const r of await db(table).whereNotNull(column).groupBy(column).select({ key: column }).count({ n: '*' })) out[r.key] = (out[r.key] || 0) + Number(r.n);
  }
  return out;
}

async function list(db) {
  const units = await org.load(db);
  const [used, staff, heads] = await Promise.all([
    usage(db),
    db('employees').where({ active: true }).groupBy('department').select('department').count({ n: '*' }),
    db('department_heads as h').join('employees as e', 'e.id', 'h.employee_id').select('h.department', 'e.first_name', 'e.last_name'),
  ]);
  const head = Object.fromEntries(heads.map(h => [h.department, `${h.last_name} ${h.first_name}`]));
  const employees = Object.fromEntries(staff.map(r => [r.department, Number(r.n)]));
  const directions = units.filter(u => u.kind === 'direction');
  const service = s => ({
    id: s.id, key: s.key, label: s.label, active: s.active, sort: s.sort, module: s.module, module_label: org.ERP_MODULES[s.module] || null,
    direction_id: s.parent_id, employees: employees[s.key] || 0, used: used[s.key] || 0, head: head[s.key] || null,
  });
  return {
    directions: directions.map(d => ({
      id: d.id, key: d.key, label: d.label, active: d.active, sort: d.sort, head: head[d.key] || null,
      services: units.filter(s => s.kind === 'service' && s.parent_id === d.id).map(service),
    })),
    without_direction: units.filter(s => s.kind === 'service' && !directions.some(d => d.id === s.parent_id)).map(service),
    modules: org.ERP_MODULES,
  };
}

async function get(db, id) {
  const u = await db('org_units').where({ id }).first();
  if (!u) throw new HttpError(404, 'Direction ou service introuvable.');
  return { ...u, active: !!u.active };
}

async function check(db, data, current = null) {
  const kind = current?.kind || data.kind;
  if (data.label) {
    const same = await db('org_units').where({ kind }).whereRaw('lower(label) = ?', [data.label.toLowerCase()]).whereNot('id', current?.id || 0).first('id');
    if (same) throw new HttpError(409, kind === 'direction' ? 'Cette direction existe déjà.' : 'Ce service existe déjà.');
  }
  if (kind === 'direction' && (data.direction_id || data.module)) throw new HttpError(400, 'Une direction ne se rattache ni à une direction ni à un module.');
  if (data.direction_id) {
    const d = await db('org_units').where({ id: data.direction_id, kind: 'direction' }).first('id');
    if (!d) throw new HttpError(404, 'Direction introuvable.');
  }
  if (data.module && !org.ERP_MODULES[data.module]) throw new HttpError(400, 'Module inconnu.');
}

async function create(db, data) {
  await check(db, data);
  const row = {
    key: await newKey(db, data.label), label: data.label, kind: data.kind, parent_id: data.kind === 'service' ? data.direction_id || null : null,
    module: data.kind === 'service' ? data.module || null : null, sort: data.sort ?? 100,
  };
  const id = insertedId((await db('org_units').insert(row))[0]);
  await org.load(db);
  return id;
}

async function update(db, id, data) {
  const u = await get(db, id);
  await check(db, data, u);
  const patch = { updated_at: new Date() };
  if (data.label !== undefined) patch.label = data.label;
  if (data.direction_id !== undefined) patch.parent_id = data.direction_id || null;
  if (data.module !== undefined) patch.module = data.module || null;
  if (data.sort !== undefined) patch.sort = data.sort;
  if (data.active !== undefined) patch.active = data.active;
  await db('org_units').where({ id }).update(patch);
  await org.load(db);
}

/** Remplace une clé de service dans une liste JSON (destinataires d'un document, services au forfait). */
const swap = (keys, from, into) => [...new Set((keys || []).map(k => (k === from ? into : k)))];

/**
 * Fusion (services en double, réorganisation) : tout ce qui porte le premier passe au second, puis le premier disparaît.
 * Directions : leurs services passent à la direction gardée. Le chef du premier n'est repris que si le second n'en a pas.
 */
async function merge(db, id, intoId) {
  const from = await get(db, id), into = await get(db, intoId);
  if (from.id === into.id) throw new HttpError(400, 'Choisissez une autre entrée.');
  if (from.kind !== into.kind) throw new HttpError(400, from.kind === 'service' ? 'Un service se fusionne dans un autre service.' : 'Une direction se fusionne dans une autre direction.');
  await db.transaction(async trx => {
    if (from.kind === 'direction') {
      await trx('org_units').where({ parent_id: from.id }).update({ parent_id: into.id, updated_at: new Date() });
    } else {
      for (const [table, column] of REFERENCES) {
        if (await trx.schema.hasTable(table)) await trx(table).where({ [column]: from.key }).update({ [column]: into.key });
      }
      for (const d of await trx('internal_docs').whereNotNull('audience_departments').select('id', 'audience_departments')) {
        const keys = json(d.audience_departments, []);
        if (keys.includes(from.key)) await trx('internal_docs').where({ id: d.id }).update({ audience_departments: JSON.stringify(swap(keys, from.key, into.key)) });
      }
      const rh = await trx('app_settings').where({ key: 'rh' }).first();
      const settings = rh ? json(rh.value, {}) : null;
      if (settings?.overtime_exempt_departments?.includes(from.key)) {
        settings.overtime_exempt_departments = swap(settings.overtime_exempt_departments, from.key, into.key);
        await trx('app_settings').where({ key: 'rh' }).update({ value: JSON.stringify(settings), updated_at: new Date() });
      }
    }
    if (await trx('department_heads').where({ department: into.key }).first()) await trx('department_heads').where({ department: from.key }).del();
    else await trx('department_heads').where({ department: from.key }).update({ department: into.key });
    await trx('org_units').where({ id: from.id }).del();
  });
  await org.load(db);
}

/**
 * Suppression (demande du client du 03/11). Direction : ses services passent à la direction choisie (`into`) ou restent sans
 * direction. Service jamais utilisé : supprimé. Service qui a servi : son personnel actif est d'abord réaffecté (panneau du
 * service, `reassign`) ; le reste (postes, fiches des anciens employés, courrier, demandes, objectifs) passe au service de
 * reprise `into`, comme une fusion.
 */
async function remove(db, id, { into = null } = {}) {
  const u = await get(db, id);
  if (u.kind === 'direction') {
    if (into && (into === u.id || (await get(db, into)).kind !== 'direction')) throw new HttpError(400, 'Choisissez une autre direction pour ses services.');
    await db.transaction(async trx => {
      await trx('org_units').where({ parent_id: u.id }).update({ parent_id: into || null, updated_at: new Date() });
      await trx('department_heads').where({ department: u.key }).del();
      await trx('org_units').where({ id: u.id }).del();
    });
    return org.load(db);
  }
  if ((await usage(db))[u.key]) {
    const staff = Number((await db('employees').where({ department: u.key, active: true }).count({ n: '*' }).first()).n);
    if (staff) throw new HttpError(409, `Réaffectez d’abord ${staff === 1 ? 'l’employé' : `les ${staff} employés`} du service.`);
    if (!into) throw new HttpError(400, 'Choisissez le service qui reprend ses postes, son courrier, ses demandes, ses objectifs et son historique.');
    return merge(db, u.id, into);
  }
  await db.transaction(async trx => {
    await trx('department_heads').where({ department: u.key }).del();
    await trx('org_units').where({ id: u.id }).del();
  });
  return org.load(db);
}

/** Panneau d'une direction ou d'un service : personnel actif (par service) et nombre d'éléments qu'il porte. */
async function detail(db, id) {
  const u = await get(db, id);
  await org.load(db);
  const services = u.kind === 'direction' ? org.units().filter(s => s.kind === 'service' && s.parent_id === u.id) : [u];
  const staff = await db('employees').where({ active: true }).whereIn('department', services.map(s => s.key))
    .orderBy([{ column: 'last_name' }, { column: 'first_name' }]).select('id', 'matricule', 'last_name', 'first_name', 'job_title', 'department', 'user_id');
  return {
    id: u.id, key: u.key, label: u.label, kind: u.kind, active: u.active,
    services: services.map(s => ({ id: s.id, key: s.key, label: s.label })),
    employees: staff.map(({ user_id, ...e }) => ({ ...e, has_account: !!user_id })),
    used: u.kind === 'service' ? (await usage(db))[u.key] || 0 : 0,
  };
}

/**
 * Réaffecte des employés à un autre service : inscrit dans l'historique de carrière de chaque fiche (mutation), applique les
 * modèles d'objectifs du nouveau service et prévient l'employé qui a un compte. Sa propre fiche se change par un autre.
 */
async function reassign(db, ids, department, { user }) {
  if (!org.isActiveDepartment(department)) throw new HttpError(400, 'Service inconnu ou archivé.');
  const rows = await db('employees').whereIn('id', ids).where({ active: true });
  if (rows.length !== new Set(ids).size) throw new HttpError(404, 'Employé introuvable ou sorti des effectifs.');
  if (user.role !== 'super_admin' && rows.some(e => e.user_id === user.id)) throw new HttpError(403, 'Votre propre service se change par une autre personne habilitée.');
  const moved = rows.filter(e => e.department !== department);
  await db.transaction(async trx => {
    for (const e of moved) {
      await trx('employees').where({ id: e.id }).update({ department, updated_at: new Date() });
      await rh.logChanges(trx, rh.normEmployee(e), { department }, user.id);
    }
  });
  const label = org.DEPARTMENTS[department];
  for (const e of moved) {
    await kpi.applyForEmployee(db, e.id, { user });
    if (e.user_id) {
      await inform(db, 'rh.service', {
        direct: e.user_id, except: user.id, module: 'rh', link: '/rh/moi', key: `service:${e.id}:${department}`,
        title: `Vous passez au service ${label}`,
        body: `Votre fiche passe du service ${org.DEPARTMENTS[e.department] || e.department} au service ${label} (Directions et services). Vos demandes de service suivent ce nouveau service.`,
      });
    }
  }
  return moved.length;
}

/**
 * Ordre et rattachement d'après le glisser-déposer : `items` liste les directions et les services dans l'ordre voulu,
 * chaque service avec sa direction (null : sans direction).
 */
async function reorder(db, items) {
  const kind = Object.fromEntries((await db('org_units').select('id', 'kind')).map(u => [u.id, u.kind]));
  for (const it of items) {
    if (!kind[it.id]) throw new HttpError(404, 'Direction ou service introuvable.');
    if (it.direction_id && (kind[it.id] === 'direction' || kind[it.direction_id] !== 'direction')) throw new HttpError(400, 'Seul un service se range sous une direction.');
  }
  await db.transaction(async trx => {
    for (const [i, it] of items.entries()) {
      await trx('org_units').where({ id: it.id }).update({ sort: (i + 1) * 10, ...(kind[it.id] === 'service' ? { parent_id: it.direction_id || null } : {}), updated_at: new Date() });
    }
  });
  return org.load(db);
}

module.exports = { list, get, create, update, merge, remove, detail, reassign, reorder, REFERENCES };
