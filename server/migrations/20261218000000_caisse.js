/**
 * Caisse (demande de la trésorière du 18/11) : point de caisse du soir. Solde de la veille, entrées et sorties du jour,
 * solde du soir, puis arrêté avec comptage des espèces (billetage) et écart passé en écriture.
 *
 * Les montants restent ceux du journal de caisse (compte 571…) : tout ce que les autres modules paient ou encaissent en
 * espèces y figure déjà. Ces tables ne gardent que ce que la comptabilité n'a pas :
 *  - cash_natures : natures des petites opérations (liste par défaut, administrable), chacune avec son compte ;
 *  - cash_movements : la saisie de la trésorière (nature, bénéficiaire, justificatif), liée à son écriture ;
 *  - cash_closings : l'arrêté du soir (solde théorique, comptage, écart, billetage).
 */
const NATURES = [
  // Sorties
  ['sortie', 'Transport et déplacements', '618'],
  ['sortie', 'Carburant (hors parc auto)', '605'],
  ['sortie', 'Fournitures de bureau', '6055'],
  ['sortie', 'Entretien et petites réparations', '624'],
  ['sortie', 'Crédit téléphone et internet', '628'],
  ['sortie', 'Réceptions et restauration', '6383'],
  ['sortie', 'Missions', '6384'],
  ['sortie', 'Timbres fiscaux et droits', '646'],
  ['sortie', 'Avance au personnel', '421'],
  ['sortie', 'Versement des espèces en banque', '521100'],
  ['sortie', 'Dépenses diverses', '658'],
  // Entrées
  ['entree', 'Retrait en banque pour la caisse', '521100'],
  ['entree', 'Remboursement d’avance par un employé', '421'],
  ['entree', 'Frais de dossier encaissés', '707100'],
  ['entree', 'Recettes diverses', '758'],
];
const NEW_ACCOUNTS = [['638', 'Autres charges externes', 6], ['6383', 'Réceptions', 6], ['6384', 'Missions', 6], ['658', 'Charges diverses', 6], ['758', 'Produits divers', 7]];

exports.up = async knex => {
  await knex.schema.createTable('cash_natures', t => {
    t.increments('id');
    t.string('label', 120).notNullable();
    t.string('direction', 10).notNullable(); // entree | sortie
    t.integer('account_id').unsigned().notNullable().references('acc_accounts.id').onDelete('RESTRICT');
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('cash_movements', t => {
    t.increments('id');
    t.date('date').notNullable();
    t.string('direction', 10).notNullable();
    t.integer('nature_id').unsigned().references('cash_natures.id').onDelete('SET NULL');
    t.bigInteger('amount').notNullable();
    t.string('label', 255).notNullable();
    t.string('beneficiary', 160);
    t.string('partner_type', 20);
    t.integer('partner_id').unsigned();
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.string('reference', 60);
    t.integer('entry_id').unsigned().references('acc_entries.id').onDelete('SET NULL');
    t.string('document_filename', 120);
    t.string('document_name', 255);
    t.string('document_mime', 100);
    t.integer('document_size').unsigned();
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['date']);
  });
  await knex.schema.createTable('cash_closings', t => {
    t.increments('id');
    t.date('date').notNullable().unique();
    t.bigInteger('opening').notNullable();
    t.bigInteger('receipts').notNullable();
    t.bigInteger('expenses').notNullable();
    t.bigInteger('theoretical').notNullable();
    t.bigInteger('counted').notNullable();
    t.bigInteger('gap').notNullable();
    t.text('denominations'); // JSON { "10000": 3, "500": 4 } : nombre de billets et de pièces
    t.string('note', 500);
    t.integer('entry_id').unsigned().references('acc_entries.id').onDelete('SET NULL'); // écriture de l'écart
    t.integer('closed_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('closed_at').defaultTo(knex.fn.now());
  });

  // Comptes utiles aux natures par défaut et aux écarts, absents des bases créées avant ce jour
  for (const [code, label, cls] of NEW_ACCOUNTS) {
    if (!(await knex('acc_accounts').where({ code }).first())) await knex('acc_accounts').insert({ code, label, class: cls, system: true });
  }
  let sort = 0;
  for (const [direction, label, code] of NATURES) {
    const a = await knex('acc_accounts').where({ code }).first('id');
    if (a) await knex('cash_natures').insert({ label, direction, account_id: a.id, sort: sort++ });
  }

  // « Tenir la caisse » : donné aux rôles qui saisissent déjà les écritures (rôles réglés dans Rôles & privilèges)
  if (!(await knex.schema.hasTable('role_permissions'))) return;
  for (const role of await knex('role_permissions').where({ permission: 'compta:entries' }).distinct('role').pluck('role')) {
    if (!(await knex('role_permissions').where({ role, permission: 'caisse:write' }).first())) await knex('role_permissions').insert({ role, permission: 'caisse:write' });
  }
};

exports.down = async knex => {
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).where({ permission: 'caisse:write' }).del();
  }
  await knex.schema.dropTableIfExists('cash_closings');
  await knex.schema.dropTableIfExists('cash_movements');
  await knex.schema.dropTableIfExists('cash_natures');
};
