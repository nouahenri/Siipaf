/**
 * Services de l'entreprise et leurs chefs (précision du client du 29/10) : un chef par service, désigné dans
 * Réglages RH ; lui seul fait les demandes au nom du service (besoins de travail : achat, équipement, véhicule…),
 * depuis le module du service. Les membres du service (fiche employé) suivent ces demandes dans le module.
 */
const { HttpError } = require('../lib/http');
const { DEPARTMENTS } = require('../lib/paie');
const { notify } = require('./notifications');

/** Module de l'ERP où chaque service fait et suit ses demandes (absent : le service n'a pas de module propre). */
const DEPARTMENT_MODULES = {
  rh: { module: 'rh', link: '/rh' }, commercial: { module: 'commercial', link: '/commercial' }, sav: { module: 'sav', link: '/sav' },
  comptabilite: { module: 'compta', link: '/compta' }, juridique: { module: 'juridique', link: '/juridique' },
  administratif: { module: 'administration', link: '/administration' },
};

/** Chef désigné de chaque service : { departement: { employee_id, name, user_id } }. */
async function heads(db) {
  const rows = await db('department_heads as h').join('employees as e', 'e.id', 'h.employee_id')
    .select('h.department', 'h.employee_id', 'e.user_id', 'e.first_name', 'e.last_name');
  return Object.fromEntries(rows.map(r => [r.department, { employee_id: r.employee_id, user_id: r.user_id, name: `${r.last_name} ${r.first_name}` }]));
}

/** Service d'un compte (fiche employé) et services qu'il dirige. */
async function departmentsOf(db, userId) {
  const [e, led] = await Promise.all([
    db('employees').where({ user_id: userId, active: true }).first('department'),
    db('department_heads as h').join('employees as e', 'e.id', 'h.employee_id').where('e.user_id', userId).pluck('h.department'),
  ]);
  return { member: e?.department || null, heads: led };
}

/** Désigne (ou retire, employeeId nul) le chef d'un service ; il est prévenu. */
async function setHead(db, department, employeeId, { userId }) {
  if (!DEPARTMENTS[department]) throw new HttpError(400, 'Service inconnu.');
  if (!employeeId) { await db('department_heads').where({ department }).del(); return heads(db); }
  const e = await db('employees').where({ id: employeeId, active: true }).first('id', 'user_id');
  if (!e) throw new HttpError(404, 'Employé introuvable ou parti.');
  if (!e.user_id) throw new HttpError(400, 'Cet employé n’a pas de compte : créez-le d’abord pour qu’il puisse faire les demandes du service.');
  const before = await db('department_heads').where({ department }).first();
  if (before) await db('department_heads').where({ department }).update({ employee_id: e.id, updated_by: userId, updated_at: new Date() });
  else await db('department_heads').insert({ department, employee_id: e.id, updated_by: userId });
  if (before?.employee_id !== e.id) {
    const where = DEPARTMENT_MODULES[department];
    await notify(db, {
      to: e.user_id, except: userId, module: where?.module || 'rh', event: 'rh.chef_service', link: where?.link || '/rh/moi', key: `chef:${department}:${e.id}`,
      title: `Vous êtes chef du service ${DEPARTMENTS[department]}`,
      body: where ? 'Vous faites les demandes au nom du service (achat, équipement, véhicule…) depuis le tableau de bord de son module.' : 'Vous faites les demandes au nom du service.',
    });
  }
  return heads(db);
}

module.exports = { DEPARTMENT_MODULES, heads, departmentsOf, setHead };
