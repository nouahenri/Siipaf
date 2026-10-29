/**
 * Besoins de tous les services (demande du client du 29/10, point 3) : une demande interne d'achat ou d'équipement,
 * validée par le responsable direct (et la DG au-delà du plafond), arrive dans Achats › Besoins ; les Achats préparent
 * le bon de commande (circuit existant : validation, réception, facture en Comptabilité) ou la refusent avec un motif.
 * Statuts ajoutés à la demande : attente_achats, commande. Liens : appro_orders.request_id ↔ internal_requests.order_id.
 * Les demandes d'achat déjà en attente des services généraux sont transmises aux Achats.
 */
exports.up = async knex => {
  await knex.schema.alterTable('appro_orders', t => { t.integer('request_id').unsigned(); });
  await knex.schema.alterTable('internal_requests', t => { t.integer('order_id').unsigned(); });
  await knex('internal_requests').whereIn('kind', ['achat', 'equipement']).where({ status: 'attente_sg' }).update({ status: 'attente_achats' });
};

exports.down = async knex => {
  await knex('internal_requests').whereIn('status', ['attente_achats', 'commande']).update({ status: 'attente_sg' });
  await knex.schema.alterTable('internal_requests', t => { t.dropColumn('order_id'); });
  await knex.schema.alterTable('appro_orders', t => { t.dropColumn('request_id'); });
};
