/**
 * Acompte sur bon de commande (demande du client du 29/10) : la Comptabilité (« Régler les fournisseurs ») verse un
 * acompte sur une commande confirmée, avant la réception et la facture (écriture : avance fournisseur 4091 / trésorerie).
 * À la validation de la facture finale issue des réceptions, l'acompte est imputé automatiquement (fournisseur / 4091) :
 * seul le solde reste dû. `applied_amount` : part déjà imputée sur une ou plusieurs factures.
 */
exports.up = async knex => {
  await knex.schema.createTable('appro_order_advances', t => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('appro_orders.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.bigInteger('amount').notNullable();
    t.bigInteger('applied_amount').notNullable().defaultTo(0);
    t.integer('journal_id').unsigned().notNullable().references('acc_journals.id').onDelete('RESTRICT');
    t.string('reference', 120);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['order_id']);
  });
  // Imputation d'un acompte sur une facture : règlement sans trésorerie (journal OD), rattaché à l'acompte
  await knex.schema.alterTable('purchase_payments', t => { t.integer('advance_id').unsigned(); });
};

exports.down = async knex => {
  await knex.schema.alterTable('purchase_payments', t => { t.dropColumn('advance_id'); });
  await knex.schema.dropTableIfExists('appro_order_advances');
};
