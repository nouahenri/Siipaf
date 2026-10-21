/**
 * Reprise des clients de l'ancienne plateforme de suivi (suiviclient-siipaf.com) :
 * - type de bien souscrit (« Villa basse jumelée 4 pièces »…), qui décrit le client tant que
 *   son dossier d'acquisition (lot, prix) n'est pas encore ouvert ;
 * - numéro du client sur l'ancienne plateforme, conservé pour s'y retrouver.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leads', t => {
    t.string('property_type', 160);
    t.string('legacy_number', 20);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('leads', t => {
    t.dropColumn('property_type');
    t.dropColumn('legacy_number');
  });
};
