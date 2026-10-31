/**
 * Compléments de liaisons décidés par le client le 31/10/2026 :
 * - honoraires du notaire saisis dans le circuit de l'acte (Juridique) : montant en FCFA et facture d'achat en brouillon
 *   préparée pour la Comptabilité (colonnes sans clé étrangère, règle SQLite des migrations du projet) ;
 * - cautions : dossier de vente de l'acheteur concerné (`guarantees.sale_id`, sans clé étrangère), pour lui annoncer la libération ;
 * - aucun droit à ajouter : les nouveaux événements (paie, caution libérée, seuil de trésorerie, litige depuis le SAV) s'appuient
 *   sur les droits existants et se règlent dans le circuit d'information.
 */
exports.up = async knex => {
  if (!(await knex.schema.hasColumn('legal_sale_files', 'notary_fee_fcfa'))) {
    await knex.schema.alterTable('legal_sale_files', t => {
      t.bigInteger('notary_fee_fcfa'); // honoraires du notaire (TTC, FCFA)
      t.integer('notary_invoice_id').unsigned(); // facture d'achat préparée pour la Comptabilité
    });
  }
  if (!(await knex.schema.hasColumn('guarantees', 'sale_id'))) {
    await knex.schema.alterTable('guarantees', t => { t.integer('sale_id').unsigned(); }); // acheteur concerné par la caution
  }
};

exports.down = async knex => {
  if (await knex.schema.hasColumn('guarantees', 'sale_id')) await knex.schema.alterTable('guarantees', t => { t.dropColumn('sale_id'); });
  if (await knex.schema.hasColumn('legal_sale_files', 'notary_fee_fcfa')) {
    await knex.schema.alterTable('legal_sale_files', t => { t.dropColumn('notary_invoice_id'); t.dropColumn('notary_fee_fcfa'); });
  }
};
