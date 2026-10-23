/**
 * ERP · Juridique (choix du client du 23/10) : circuit de la vente jusqu'à l'acte (six étapes, notaire = fiche
 * fournisseur), litiges (étapes datées, échéance suivie), cautions et retenues de garantie (sortes réglables).
 * La date de l'acte reste sales.signed_at ; les contrats restent la table `contracts` (même liste que l'Administration).
 */
const DEFAULT_GUARANTEE_KINDS = [
  ['Retenue de garantie', 'retenue'],
  ['Caution de bonne exécution', 'recue'],
  ['Caution de restitution d’avance', 'recue'],
  ['Caution de soumission', 'recue'],
  ['Caution de retenue de garantie', 'recue'],
  ['Garantie bancaire donnée', 'donnee'],
  ['Caution administrative ou douanière', 'donnee'],
];
const GRANTS = { resp_exploitation: ['juridique:read', 'juridique:write'], conducteur_travaux: ['juridique:read', 'juridique:write'] };
const file = t => { t.string('file_filename', 120); t.string('file_name', 255); t.string('file_mime', 60); };

exports.up = async function (knex) {
  // Une fiche par dossier de vente : dates des étapes (l'acte = sales.signed_at), notaire, n° d'acte
  await knex.schema.createTable('legal_sale_files', t => {
    t.increments('id');
    t.integer('sale_id').unsigned().notNullable().unique().references('sales.id').onDelete('CASCADE');
    t.date('reservation_on');
    t.date('pieces_on');
    t.date('notaire_on');
    t.integer('notary_supplier_id').unsigned().references('suppliers.id').onDelete('SET NULL');
    t.string('notary_ref', 100); // référence du dossier à l'étude
    t.date('projet_on');
    t.string('deed_number', 60);
    t.date('remise_on');
    t.text('notes');
    t.integer('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('litigations', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // LIT-2026-0001
    t.string('origin', 20).notNullable();
    t.string('title', 200).notNullable();
    t.string('opponent', 200).notNullable(); // partie adverse
    t.bigInteger('amount_fcfa'); // montant en jeu
    t.string('stage', 20).notNullable().defaultTo('amiable');
    t.string('status', 10).notNullable().defaultTo('ouvert'); // ouvert, clos
    t.string('outcome', 20);
    t.string('department', 20); // service concerné (voit le dossier)
    t.integer('owner_id').unsigned().references('users.id').onDelete('SET NULL'); // juriste en charge
    t.string('lawyer', 160); // avocat, huissier
    t.string('court', 160); // juridiction
    t.integer('sale_id').unsigned().references('sales.id').onDelete('SET NULL');
    t.integer('sav_ticket_id').unsigned().references('sav_tickets.id').onDelete('SET NULL');
    t.integer('supplier_id').unsigned().references('suppliers.id').onDelete('SET NULL');
    t.integer('contract_id').unsigned().references('contracts.id').onDelete('SET NULL');
    t.integer('employee_id').unsigned().references('employees.id').onDelete('SET NULL');
    t.date('next_date');
    t.string('next_label', 160);
    t.date('opened_on').notNullable();
    t.date('closed_on');
    t.string('close_note', 500);
    t.text('notes');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['status', 'next_date']);
  });

  await knex.schema.createTable('litigation_events', t => {
    t.increments('id');
    t.integer('litigation_id').unsigned().notNullable().references('litigations.id').onDelete('CASCADE');
    t.string('stage', 20).notNullable();
    t.date('date').notNullable();
    t.text('note');
    file(t);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Sortes de cautions : réglables dans Juridique › Réglages
  await knex.schema.createTable('guarantee_kinds', t => {
    t.increments('id');
    t.string('label', 120).notNullable();
    t.string('direction', 10).notNullable(); // recue, donnee, retenue
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  await knex('guarantee_kinds').insert(DEFAULT_GUARANTEE_KINDS.map(([label, direction], sort) => ({ label, direction, sort })));

  await knex.schema.createTable('guarantees', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // GAR-2026-0001
    t.integer('kind_id').unsigned().notNullable().references('guarantee_kinds.id').onDelete('RESTRICT');
    t.string('direction', 10).notNullable(); // repris de la sorte à l'enregistrement
    t.integer('contract_id').unsigned().references('contracts.id').onDelete('SET NULL');
    t.integer('supplier_id').unsigned().references('suppliers.id').onDelete('SET NULL');
    t.string('counterparty', 160); // bénéficiaire ou donneur hors fichier fournisseurs
    t.string('bank', 160);
    t.bigInteger('amount_fcfa').notNullable();
    t.date('issued_on');
    t.date('expires_on');
    t.date('reception_on'); // retenue : réception des travaux
    t.date('release_on'); // retenue : fin du délai de garantie
    t.string('status', 10).notNullable().defaultTo('active');
    t.date('closed_on');
    t.string('close_note', 255);
    t.integer('owner_id').unsigned().references('users.id').onDelete('SET NULL');
    t.text('notes');
    file(t);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['status']);
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
  for (const table of ['guarantees', 'guarantee_kinds', 'litigation_events', 'litigations', 'legal_sale_files']) await knex.schema.dropTableIfExists(table);
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', ['juridique:read', 'juridique:write']).del();
  }
};
