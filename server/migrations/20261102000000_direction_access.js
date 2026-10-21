/**
 * ERP · Administration générale : droit « Ouvrir l'Administration générale (vue Direction) », donné au responsable
 * d'exploitation (rôle qui gère le module, choix du client du 21/10). Les autres rôles le reçoivent dans
 * Rôles et privilèges si besoin.
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('role_permissions'))) return;
  const exists = await knex('role_permissions').where({ role: 'resp_exploitation' }).first();
  if (exists && !(await knex('role_permissions').where({ role: 'resp_exploitation', permission: 'direction:read' }).first())) {
    await knex('role_permissions').insert({ role: 'resp_exploitation', permission: 'direction:read' });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('role_permissions')) await knex('role_permissions').where({ permission: 'direction:read' }).del();
  if (await knex.schema.hasTable('user_permissions')) await knex('user_permissions').where({ permission: 'direction:read' }).del();
};
