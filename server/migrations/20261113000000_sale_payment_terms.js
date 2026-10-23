/**
 * Conditions de paiement du projet figées sur le dossier de vente à son ouverture (accord du client du 23/10) :
 * en formule Diaspora, l'échéancier prend l'acompte et le délai de solde du projet. Les dossiers existants
 * gardent des colonnes vides : leur échéancier reste celui de la formule (sans apport, 36 mensualités).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('sales', t => {
    t.bigInteger('terms_deposit_fcfa'); // acompte du projet à l'ouverture du dossier
    t.integer('terms_months'); // délai de solde du projet à l'ouverture du dossier
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('sales', t => {
    t.dropColumn('terms_deposit_fcfa');
    t.dropColumn('terms_months');
  });
};
