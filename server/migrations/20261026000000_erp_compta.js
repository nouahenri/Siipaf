/**
 * ERP · Comptabilité (SYSCOHADA révisé) : plan de comptes, journaux, exercices, écritures en partie double,
 * fournisseurs, factures d'achat et règlements. Les écritures automatiques sont reliées à leur origine
 * (versement, appel de fonds, vente, achat) par `source_key`, ce qui évite tout doublon.
 */
const { PERMISSIONS } = require('../src/lib/domain');
const { SYSCOHADA_ACCOUNTS, DEFAULT_JOURNALS, partnerKindOf, accountClass } = require('../src/lib/compta');

const NEW_PERMISSIONS = ['compta:read', 'compta:write', 'compta:validate'];

exports.up = async function (knex) {
  await knex.schema.createTable('acc_accounts', t => {
    t.increments('id');
    t.string('code', 12).notNullable().unique();
    t.string('label', 160).notNullable();
    t.tinyint('class').unsigned().notNullable();
    t.string('partner_kind', 12); // client, fournisseur, employe : compte suivi par tiers
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('system').notNullable().defaultTo(false); // livré avec le plan SYSCOHADA
    t.timestamps(true, true);
  });

  await knex.schema.createTable('acc_journals', t => {
    t.increments('id');
    t.string('code', 6).notNullable().unique();
    t.string('label', 120).notNullable();
    t.string('kind', 12).notNullable();
    t.integer('account_id').unsigned().references('acc_accounts.id').onDelete('SET NULL'); // compte de trésorerie
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('acc_fiscal_years', t => {
    t.increments('id');
    t.string('label', 40).notNullable();
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.string('status', 10).notNullable().defaultTo('ouvert'); // ouvert, cloture
    t.date('lock_date'); // aucune écriture validée ou modifiée jusqu'à cette date incluse
    t.timestamp('closed_at');
    t.integer('closed_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('acc_entries', t => {
    t.increments('id');
    t.integer('journal_id').unsigned().notNullable().references('acc_journals.id').onDelete('RESTRICT');
    t.integer('fiscal_year_id').unsigned().notNullable().references('acc_fiscal_years.id').onDelete('RESTRICT');
    t.string('number', 30).unique(); // attribué à la validation, chronologique par journal et exercice
    t.date('date').notNullable();
    t.string('ref', 60); // pièce justificative
    t.string('label', 255).notNullable();
    t.string('status', 10).notNullable().defaultTo('brouillon'); // brouillon, valide
    t.string('source', 20).notNullable().defaultTo('manuel');
    t.string('source_key', 60).unique(); // ex. « payment:12 » : une seule écriture par origine
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.integer('reversal_of').unsigned().references('acc_entries.id').onDelete('SET NULL');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('validated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('validated_at');
    t.timestamps(true, true);
    t.index(['journal_id', 'date']);
    t.index(['status']);
  });

  await knex.schema.createTable('acc_lines', t => {
    t.increments('id');
    t.integer('entry_id').unsigned().notNullable().references('acc_entries.id').onDelete('CASCADE');
    t.integer('account_id').unsigned().notNullable().references('acc_accounts.id').onDelete('RESTRICT');
    t.string('partner_type', 12); // client (leads), fournisseur (suppliers), employe
    t.integer('partner_id').unsigned();
    t.string('label', 255);
    t.bigInteger('debit').notNullable().defaultTo(0);
    t.bigInteger('credit').notNullable().defaultTo(0);
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL'); // analytique : programme
    t.integer('lot_id').unsigned().references('lots.id').onDelete('SET NULL');
    t.string('reconcile', 20); // lettrage
    t.integer('sort').unsigned().notNullable().defaultTo(0);
    t.index(['account_id']);
    t.index(['partner_type', 'partner_id']);
    t.index(['project_id']);
  });

  await knex.schema.createTable('suppliers', t => {
    t.increments('id');
    t.string('name', 160).notNullable();
    t.string('kind', 20).notNullable().defaultTo('fournisseur'); // fournisseur, sous_traitant, prestataire
    t.string('phone', 40);
    t.string('email', 190);
    t.string('address', 255);
    t.string('ncc', 40); // numéro de compte contribuable
    t.string('rccm', 60);
    t.integer('expense_account_id').unsigned().references('acc_accounts.id').onDelete('SET NULL'); // compte de charge habituel
    t.string('notes', 500);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('purchase_invoices', t => {
    t.increments('id');
    t.string('number', 30).notNullable().unique(); // ACH-2026-0001
    t.integer('supplier_id').unsigned().notNullable().references('suppliers.id').onDelete('RESTRICT');
    t.string('supplier_ref', 60);
    t.date('date').notNullable();
    t.date('due_date');
    t.string('label', 255).notNullable();
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.integer('expense_account_id').unsigned().notNullable().references('acc_accounts.id').onDelete('RESTRICT');
    t.bigInteger('amount_ht').notNullable();
    t.decimal('vat_rate', 5, 2).notNullable().defaultTo(0);
    t.bigInteger('vat_amount').notNullable().defaultTo(0);
    t.bigInteger('amount_ttc').notNullable();
    t.string('status', 12).notNullable().defaultTo('brouillon'); // brouillon, validee, annulee
    t.integer('media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['supplier_id']);
    t.index(['project_id']);
  });

  await knex.schema.createTable('purchase_payments', t => {
    t.increments('id');
    t.integer('invoice_id').unsigned().notNullable().references('purchase_invoices.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.bigInteger('amount').notNullable();
    t.integer('journal_id').unsigned().notNullable().references('acc_journals.id').onDelete('RESTRICT');
    t.string('reference', 120);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Plan SYSCOHADA et journaux de départ
  for (const [code, label] of SYSCOHADA_ACCOUNTS) {
    await knex('acc_accounts').insert({ code, label, class: accountClass(code), partner_kind: code.length >= 3 ? partnerKindOf(code) : null, system: true });
  }
  for (const j of DEFAULT_JOURNALS) {
    const account = j.account ? await knex('acc_accounts').where({ code: j.account }).first('id') : null;
    await knex('acc_journals').insert({ code: j.code, label: j.label, kind: j.kind, account_id: account ? account.id : null });
  }

  if (await knex.schema.hasTable('role_permissions')) {
    const existing = await knex('roles').select('id').catch(() => null);
    const roles = new Set(existing ? existing.map(r => r.id) : Object.keys(PERMISSIONS));
    const rows = Object.entries(PERMISSIONS)
      .filter(([role]) => role !== 'super_admin' && roles.has(role))
      .flatMap(([role, perms]) => perms.filter(p => NEW_PERMISSIONS.includes(p)).map(permission => ({ role, permission })));
    for (const row of rows) {
      if (!(await knex('role_permissions').where(row).first())) await knex('role_permissions').insert(row);
    }
  }
};

exports.down = async function (knex) {
  for (const table of ['purchase_payments', 'purchase_invoices', 'suppliers', 'acc_lines', 'acc_entries', 'acc_fiscal_years', 'acc_journals', 'acc_accounts']) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex('app_settings').where({ key: 'compta' }).del().catch(() => {});
  if (await knex.schema.hasTable('role_permissions')) await knex('role_permissions').whereIn('permission', NEW_PERMISSIONS).del();
};
