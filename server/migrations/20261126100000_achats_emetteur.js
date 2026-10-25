/** Achats & stocks : émetteur du bon de commande choisi parmi les comptes habilités (par défaut l'auteur de la saisie). */
exports.up = async knex => {
  await knex.schema.alterTable('appro_orders', t => { t.integer('issuer_id').unsigned(); });
  await knex('appro_orders').whereNull('issuer_id').update({ issuer_id: knex.ref('created_by') });
};
exports.down = async knex => {
  await knex.schema.alterTable('appro_orders', t => { t.dropColumn('issuer_id'); });
};
