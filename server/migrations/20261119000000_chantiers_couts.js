/**
 * ERP · Chantiers, lot 2 : coûts réels imputés au chantier sans ressaisie. Le chantier (worksite_id) s'ajoute au
 * programme (project_id, axe analytique de la Comptabilité) sur les factures d'achat, les dépenses et affectations
 * du Parc et les pointages ; coût horaire de chantier sur la fiche employé (journaliers, intérim).
 * Colonnes ajoutées sans clé étrangère (règle SQLite des migrations du projet).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('purchase_invoices', t => {
    t.integer('worksite_id').unsigned();
    t.string('worksite_category', 20); // poste du budget du chantier
  });
  for (const table of ['asset_costs', 'asset_assignments', 'assets', 'hr_attendances']) {
    await knex.schema.alterTable(table, t => { t.integer('worksite_id').unsigned(); });
  }
  await knex.schema.alterTable('employees', t => { t.bigInteger('site_hourly_rate'); }); // FCFA par heure, vide : tiré du salaire
};

exports.down = async function (knex) {
  await knex.schema.alterTable('employees', t => { t.dropColumn('site_hourly_rate'); });
  for (const table of ['hr_attendances', 'assets', 'asset_assignments', 'asset_costs']) {
    await knex.schema.alterTable(table, t => { t.dropColumn('worksite_id'); });
  }
  await knex.schema.alterTable('purchase_invoices', t => { t.dropColumn('worksite_category'); t.dropColumn('worksite_id'); });
};
