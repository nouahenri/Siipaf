/**
 * Changement du commercial d'un client (choix du client du 29/10) : accord du responsable commercial ET approbation de
 * l'administrateur général (super administrateur). `client` : la demande porte sur un client (code client) au moment
 * où elle est faite ; chaque accord est daté et signé. Les prospects gardent le circuit à une validation.
 */
exports.up = async knex => {
  await knex.schema.alterTable('lead_transfer_requests', t => {
    t.boolean('client').notNullable().defaultTo(false);
    t.integer('manager_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('manager_at');
    t.integer('admin_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('admin_at');
  });
};

exports.down = async knex => {
  await knex.schema.alterTable('lead_transfer_requests', t => {
    t.dropColumn('admin_at');
    t.dropColumn('admin_by');
    t.dropColumn('manager_at');
    t.dropColumn('manager_by');
    t.dropColumn('client');
  });
};
