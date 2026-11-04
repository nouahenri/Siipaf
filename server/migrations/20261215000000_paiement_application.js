/**
 * « Régler » depuis l'application mobile (demande du client du 04/11) : le client choisit Wave, Orange Money, MTN, Moov
 * ou PayPal/Visa, paie dans son application (coordonnées réglées dans Paramètres › Général) puis déclare son paiement.
 * La déclaration rejoint les versements « à confirmer » de la Comptabilité, comme celles des commerciaux :
 * - `source` : « equipe » (commercial) ou « client » (application) ;
 * - `channel` : moyen choisi par le client (wave, orange_money, mtn_money, moov_money, paypal) ;
 * - `schedule_id` : échéance réglée (informatif : l'imputation suit toujours l'ordre de l'échéancier) ;
 * - `proof_file_id` : capture du reçu ou du SMS jointe par le client (fichier privé, sav_files), facultative.
 */
exports.up = async knex => {
  await knex.schema.alterTable('payment_declarations', t => {
    t.string('source', 10).notNullable().defaultTo('equipe');
    t.string('channel', 20);
    t.integer('schedule_id').unsigned();
    t.integer('proof_file_id').unsigned();
  });
};

exports.down = async knex => {
  await knex.schema.alterTable('payment_declarations', t => {
    t.dropColumn('source');
    t.dropColumn('channel');
    t.dropColumn('schedule_id');
    t.dropColumn('proof_file_id');
  });
};
