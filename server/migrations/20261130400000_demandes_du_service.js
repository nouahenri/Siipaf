/**
 * Demande au nom d'un service (précision du client du 29/10) : le chef de service exprime un besoin de travail pour tout
 * son service (achat, équipement, intervention, prêt de matériel, véhicule…), depuis le module du service ; même
 * circuit que les demandes personnelles. Un chef par service, désigné dans Réglages RH (`department_heads`).
 * Les services RH et SAV s'ajoutent à la liste des fiches employés (lib/paie.js, DEPARTMENTS) : rien à migrer.
 */
exports.up = async knex => {
  await knex.schema.createTable('department_heads', t => {
    t.string('department', 20).primary();
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.integer('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });
  await knex.schema.alterTable('internal_requests', t => { t.string('department', 20); });
  await knex.schema.alterTable('asset_reservations', t => { t.string('department', 20); });
};

exports.down = async knex => {
  await knex.schema.alterTable('asset_reservations', t => { t.dropColumn('department'); });
  await knex.schema.alterTable('internal_requests', t => { t.dropColumn('department'); });
  await knex.schema.dropTableIfExists('department_heads');
};
