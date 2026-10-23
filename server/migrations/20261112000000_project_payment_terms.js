/**
 * Conditions de paiement d'un projet (fiche projet du dashboard, demande du client du 23/10) : acompte à verser et
 * délai de solde (nombre de mensualités), vides = valeurs par défaut de Paramètres › Réglages généraux ; liste
 * « Documents du bien » (titre foncier, ACD, attestation villageoise…) avec l'état de chaque pièce.
 */
const DOCUMENTS = ['Titre foncier', 'ACD (Arrêté de Concession Définitive)', 'Attestation villageoise', 'Lettre d’attribution', 'Certificat de propriété coutumière', 'Permis de construire'];

exports.up = async function (knex) {
  await knex.schema.alterTable('projects', t => {
    t.bigInteger('deposit_fcfa'); // acompte affiché sur la tuile du projet
    t.integer('balance_months'); // délai de solde : mensualités de la formule Diaspora
  });
  if (!(await knex('ref_items').where({ kind: 'document' }).first())) {
    await knex('ref_items').insert(DOCUMENTS.map((label, sort) => ({ kind: 'document', label, sort })));
  }
};

exports.down = async function (knex) {
  const ids = await knex('ref_items').where({ kind: 'document' }).pluck('id');
  if (ids.length) {
    await knex('project_refs').whereIn('ref_id', ids).del();
    await knex('ref_items').whereIn('id', ids).del();
  }
  await knex.schema.alterTable('projects', t => {
    t.dropColumn('deposit_fcfa');
    t.dropColumn('balance_months');
  });
  await knex('app_settings').whereIn('key', ['deposit_default', 'balance_months_default', 'balance_months_choices']).del();
};
