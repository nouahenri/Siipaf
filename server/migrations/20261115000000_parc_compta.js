/**
 * Parc auto et matériel ↔ Comptabilité (choix du client du 23/10) : chaque dépense du parc part en comptabilité
 * (facture d'achat ou écriture en brouillon, validée par le comptable), cartes carburant prépayées, registre des
 * immobilisations (amortissement linéaire au prorata), montant à prévoir des échéances administratives.
 */
// Colonnes ajoutées sans clé étrangère : sous SQLite, une clé étrangère ajoutée reconstruirait les tables
exports.up = async function (knex) {
  await knex.schema.createTable('fuel_cards', t => {
    t.increments('id');
    t.string('label', 120).notNullable(); // « Carte TotalEnergies n° …1234 »
    t.string('number', 40);
    t.integer('supplier_id').unsigned().notNullable().references('suppliers.id').onDelete('RESTRICT'); // station
    t.boolean('active').notNullable().defaultTo(true);
    t.string('notes', 500);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('fuel_card_loads', t => {
    t.increments('id');
    t.integer('card_id').unsigned().notNullable().references('fuel_cards.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.bigInteger('amount').notNullable();
    t.integer('journal_id').unsigned().references('acc_journals.id').onDelete('SET NULL');
    t.integer('entry_id').unsigned().references('acc_entries.id').onDelete('SET NULL');
    t.string('reference', 120);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('asset_costs', t => {
    t.string('payment_mode', 12); // fournisseur, caisse, mobile, carte, employe ; vide : dépense d'avant le lien
    t.string('accounting', 10); // facture, ecriture, frais
    t.integer('supplier_id').unsigned();
    t.decimal('vat_rate', 5, 2).notNullable().defaultTo(0);
    t.integer('entry_id').unsigned();
    t.integer('fuel_card_id').unsigned();
    t.integer('employee_id').unsigned();
    t.timestamp('rejected_at');
    t.string('reject_reason', 255);
  });

  await knex.schema.alterTable('assets', t => {
    t.bigInteger('fixed_value'); // valeur d'origine immobilisée ; vide : bien non immobilisé
    t.date('in_service_on');
    t.integer('depreciation_years');
    t.bigInteger('prior_depreciation').notNullable().defaultTo(0); // reprise : amortissements déjà pratiqués
    t.date('prior_as_of');
    t.integer('purchase_invoice_id').unsigned(); // facture d'acquisition
    t.date('disposed_on');
    t.bigInteger('disposal_price');
    t.integer('disposal_entry_id').unsigned();
  });

  await knex.schema.alterTable('asset_documents', t => {
    t.bigInteger('amount_estimate'); // montant à prévoir (trésorerie de la Comptabilité)
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('asset_documents', t => { t.dropColumn('amount_estimate'); });
  await knex.schema.alterTable('assets', t => {
    for (const c of ['fixed_value', 'in_service_on', 'depreciation_years', 'prior_depreciation', 'prior_as_of', 'purchase_invoice_id', 'disposed_on', 'disposal_price', 'disposal_entry_id']) t.dropColumn(c);
  });
  await knex.schema.alterTable('asset_costs', t => {
    for (const c of ['payment_mode', 'accounting', 'supplier_id', 'vat_rate', 'entry_id', 'fuel_card_id', 'employee_id', 'rejected_at', 'reject_reason']) t.dropColumn(c);
  });
  await knex.schema.dropTableIfExists('fuel_card_loads');
  await knex.schema.dropTableIfExists('fuel_cards');
};
