/**
 * ERP · Administration générale › Contrats et échéances (choix du client du 22/10) : tous les contrats, fin et
 * renouvellement, préavis, révision de prix, paiements périodiques (facture d'achat en brouillon), pièces à
 * renouveler ; un responsable par contrat ; alertes 30 puis 7 jours avant.
 */
const GRANTS = { resp_exploitation: ['contrats:read', 'contrats:write'], conducteur_travaux: ['contrats:read', 'contrats:write'], comptable: ['contrats:read'] };

exports.up = async function (knex) {
  await knex.schema.createTable('contracts', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // CTR-2026-0001
    t.string('kind', 20).notNullable();
    t.string('kind_other', 100); // libellé quand kind = autre
    t.string('title', 200).notNullable();
    t.integer('supplier_id').unsigned().references('suppliers.id').onDelete('SET NULL');
    t.string('counterparty', 160); // cocontractant hors fichier fournisseurs
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.integer('owner_id').unsigned().references('users.id').onDelete('SET NULL'); // responsable du contrat
    t.date('start_date').notNullable();
    t.date('end_date'); // vide : durée indéterminée
    t.boolean('tacit_renewal').notNullable().defaultTo(false);
    t.integer('renewal_months');
    t.integer('notice_days');
    t.bigInteger('contract_amount'); // montant du marché ou annuel (information)
    t.decimal('retention_pct', 5, 2); // retenue de garantie (sous-traitance)
    t.string('frequency', 12); // mensuel, trimestriel, semestriel, annuel
    t.bigInteger('amount_ttc'); // montant de chaque paiement
    t.decimal('vat_rate', 5, 2).notNullable().defaultTo(0);
    t.integer('expense_account_id').unsigned().references('acc_accounts.id').onDelete('SET NULL');
    t.date('next_payment_date');
    t.date('revision_date');
    t.string('revision_note', 255);
    t.string('status', 10).notNullable().defaultTo('actif');
    t.date('closed_on');
    t.string('close_reason', 255);
    t.text('notes');
    t.string('file_filename', 120);
    t.string('file_name', 255);
    t.string('file_mime', 60);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['status', 'end_date']);
  });

  await knex.schema.createTable('contract_documents', t => {
    t.increments('id');
    t.integer('contract_id').unsigned().notNullable().references('contracts.id').onDelete('CASCADE');
    t.string('kind', 24).notNullable().defaultTo('autre');
    t.string('label', 160).notNullable();
    t.date('expires_on');
    t.string('file_filename', 120);
    t.string('file_name', 255);
    t.string('file_mime', 60);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  // Une alerte par échéance et par palier (30, 7) : jamais deux fois
  await knex.schema.createTable('contract_alerts', t => {
    t.increments('id');
    t.integer('contract_id').unsigned().notNullable().references('contracts.id').onDelete('CASCADE');
    t.string('deadline_key', 30).notNullable();
    t.date('due_date').notNullable();
    t.integer('stage').notNullable();
    t.timestamp('sent_at').defaultTo(knex.fn.now());
    t.unique(['contract_id', 'deadline_key', 'due_date', 'stage']);
  });

  // Facture d'achat préparée pour chaque échéance de paiement
  await knex.schema.createTable('contract_invoices', t => {
    t.increments('id');
    t.integer('contract_id').unsigned().notNullable().references('contracts.id').onDelete('CASCADE');
    t.date('due_date').notNullable();
    t.integer('purchase_invoice_id').unsigned().references('purchase_invoices.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['contract_id', 'due_date']);
  });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  for (const [role, perms] of Object.entries(GRANTS)) {
    if (!(await knex('role_permissions').where({ role }).first())) continue;
    for (const permission of perms) {
      if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
    }
  }
};

exports.down = async function (knex) {
  for (const table of ['contract_invoices', 'contract_alerts', 'contract_documents', 'contracts']) await knex.schema.dropTableIfExists(table);
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', ['contrats:read', 'contrats:write']).del();
  }
};
