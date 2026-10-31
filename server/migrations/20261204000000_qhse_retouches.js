/**
 * QHSE, retouches demandées par le client (31/10/2026) :
 * - le droit « Régler le QHSE » (qhse:settings) est accordé au directeur des exploitations (resp_exploitation) et au Responsable QHSE
 *   (resp_qhse), en plus du super administrateur ;
 * - personne ne valide sa propre synthèse hebdomadaire ni son propre audit : on conserve QUI a soumis (submitted_by) ; pour les
 *   synthèses déjà en attente, c'est la dernière personne qui les a modifiées.
 */
exports.up = async knex => {
  if (!(await knex.schema.hasColumn('qhse_controls', 'submitted_by'))) {
    await knex.schema.alterTable('qhse_controls', t => t.integer('submitted_by').unsigned().references('users.id').onDelete('SET NULL'));
    await knex('qhse_controls').whereNotNull('submitted_at').whereNotNull('updated_by').update({ submitted_by: knex.ref('updated_by') });
  }
  if (!(await knex.schema.hasColumn('qhse_audits', 'submitted_by'))) {
    await knex.schema.alterTable('qhse_audits', t => t.integer('submitted_by').unsigned().references('users.id').onDelete('SET NULL'));
    await knex('qhse_audits').whereNotNull('submitted_at').whereNotNull('created_by').update({ submitted_by: knex.ref('created_by') });
  }
  if (!(await knex.schema.hasTable('role_permissions'))) return;
  for (const role of ['resp_exploitation', 'resp_qhse']) {
    if (!(await knex('roles').where({ id: role }).first())) continue;
    if (!(await knex('role_permissions').where({ role, permission: 'qhse:settings' }).first())) await knex('role_permissions').insert({ role, permission: 'qhse:settings' });
  }
};

// Sans retour arrière : les colonnes partent avec les tables si la migration du QHSE est annulée, et on ne sait plus quels rôles
// avaient déjà le droit de régler le QHSE
exports.down = async () => {};
