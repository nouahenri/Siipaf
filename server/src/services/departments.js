/**
 * Services de l'entreprise et leurs chefs (précision du client du 29/10) : un chef par service, désigné dans
 * Réglages RH ; lui seul fait les demandes au nom du service (besoins de travail : achat, équipement, véhicule…),
 * depuis le module du service. Les membres du service (fiche employé) suivent ces demandes dans le module.
 */
const { HttpError } = require('../lib/http');
const { DEPARTMENTS, DIRECTIONS, moduleOf, servicesOf } = require('../lib/org');
const { inform } = require('./notifications');

/** Module de l'ERP où chaque service fait et suit ses demandes (réglé dans Directions et services ; absent : pas de module propre). */
const DEPARTMENT_MODULES = new Proxy({}, { get: (_, key) => { const m = typeof key === 'string' ? moduleOf(key) : null; return m ? { module: m, link: `/${m}` } : undefined; } });

/** Chef désigné de chaque service : { departement: { employee_id, name, user_id } }. */
async function heads(db) {
  const rows = await db('department_heads as h').join('employees as e', 'e.id', 'h.employee_id')
    .select('h.department', 'h.employee_id', 'e.user_id', 'e.first_name', 'e.last_name');
  return Object.fromEntries(rows.map(r => [r.department, { employee_id: r.employee_id, user_id: r.user_id, name: `${r.last_name} ${r.first_name}` }]));
}

/** Service d'un compte (fiche employé) et services qu'il dirige ; le chef d'une direction dirige aussi les services qu'elle regroupe. */
async function departmentsOf(db, userId) {
  const [e, led] = await Promise.all([
    db('employees').where({ user_id: userId, active: true }).first('department'),
    db('department_heads as h').join('employees as e', 'e.id', 'h.employee_id').where('e.user_id', userId).pluck('h.department'),
  ]);
  return { member: e?.department || null, heads: [...new Set(led.flatMap(k => (DIRECTIONS[k] ? servicesOf(k) : [k])))] };
}

/** Désigne (ou retire, employeeId nul) le chef d'un service ; il est prévenu. */
async function setHead(db, department, employeeId, { userId }) {
  if (!DEPARTMENTS[department] && !DIRECTIONS[department]) throw new HttpError(400, 'Service ou direction inconnu.');
  if (!employeeId) { await db('department_heads').where({ department }).del(); return heads(db); }
  const e = await db('employees').where({ id: employeeId, active: true }).first('id', 'user_id');
  if (!e) throw new HttpError(404, 'Employé introuvable ou parti.');
  if (!e.user_id) throw new HttpError(400, 'Cet employé n’a pas de compte : créez-le d’abord pour qu’il puisse faire les demandes du service.');
  const before = await db('department_heads').where({ department }).first();
  if (before) await db('department_heads').where({ department }).update({ employee_id: e.id, updated_by: userId, updated_at: new Date() });
  else await db('department_heads').insert({ department, employee_id: e.id, updated_by: userId });
  if (before?.employee_id !== e.id) {
    const where = DEPARTMENT_MODULES[department];
    await inform(db, 'rh.chef_service', {
      direct: e.user_id, except: userId, module: where?.module || 'rh', link: where ? `${where.link}/service` : '/rh/moi', key: `chef:${department}:${e.id}`,
      title: DIRECTIONS[department] ? `Vous êtes à la tête de la ${DIRECTIONS[department]}` : `Vous êtes chef du service ${DEPARTMENTS[department]}`,
      body: where ? 'Vous faites les demandes au nom du service (achat, équipement, véhicule…) depuis « Demandes du service », dans le menu de son module.' : 'Vous faites les demandes au nom du service.',
    });
  }
  return heads(db);
}

module.exports = { DEPARTMENT_MODULES, heads, departmentsOf, setHead };
