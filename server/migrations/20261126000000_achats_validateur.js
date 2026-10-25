/** Achats & stocks : validateur désigné par l'émetteur du bon de commande (séparation émission / validation). */
exports.up = async knex => {
  await knex.schema.alterTable('appro_orders', t => { t.integer('approver_id').unsigned(); t.timestamp('submitted_at'); });
};
exports.down = async knex => {
  await knex.schema.alterTable('appro_orders', t => { t.dropColumn('approver_id'); t.dropColumn('submitted_at'); });
};
