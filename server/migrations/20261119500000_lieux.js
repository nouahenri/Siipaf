/**
 * Lieux hors programmes (choix du client du 24/10) : siège social, bureaux annexes, dépôts, autres emplacements,
 * administrés dans ERP › Administration générale › Lieux. Axe analytique à côté du programme : une pièce porte un
 * programme (et un chantier) ou un lieu ; sans l'un ni l'autre, le siège social. L'existant sans programme est
 * repris sur le siège. Colonnes ajoutées sans clé étrangère (règle SQLite des migrations du projet).
 */
const TABLES = ['purchase_invoices', 'asset_costs', 'hr_attendances', 'hr_expenses', 'internal_requests', 'contracts', 'acc_entries', 'acc_lines'];
const WORKSITE_TABLES = ['hr_expenses', 'internal_requests', 'contracts'];
const GRANTS = { comptable: ['lieux:write'], resp_exploitation: ['lieux:write'] };

exports.up = async function (knex) {
  await knex.schema.createTable('places', t => {
    t.increments('id');
    t.string('kind', 10).notNullable(); // siege, annexe, depot, autre
    t.string('kind_other', 80); // libellé du type quand kind = autre
    t.string('name', 160).notNullable();
    t.string('address', 255);
    t.string('city', 80);
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  const [row] = await knex('places').insert({ kind: 'siege', name: 'Siège social', sort: 1 });
  const siege = typeof row === 'object' ? row.id : row;

  for (const table of TABLES) await knex.schema.alterTable(table, t => { t.integer('place_id').unsigned(); });
  await knex.schema.alterTable('suppliers', t => { t.integer('place_id').unsigned(); t.integer('project_id').unsigned(); }); // imputation par défaut
  // Chantier sur les pièces qui n'en portaient pas encore (les achats, le Parc et les pointages l'ont reçu au lot 2)
  for (const table of WORKSITE_TABLES) await knex.schema.alterTable(table, t => { t.integer('worksite_id').unsigned(); });

  // Reprise : ce qui n'a pas de programme part au siège (charges et produits seulement pour les lignes d'écriture)
  for (const table of TABLES.filter(x => x !== 'acc_lines')) await knex(table).whereNull('project_id').update({ place_id: siege });
  const accounts = knex('acc_accounts').whereIn('class', [6, 7]).select('id');
  await knex('acc_lines').whereNull('project_id').whereIn('account_id', accounts).update({ place_id: siege });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  for (const [role, perms] of Object.entries(GRANTS)) {
    if (!(await knex('role_permissions').where({ role }).first())) continue;
    for (const permission of perms) {
      if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('suppliers', t => { t.dropColumn('place_id'); t.dropColumn('project_id'); });
  for (const table of WORKSITE_TABLES) await knex.schema.alterTable(table, t => { t.dropColumn('worksite_id'); });
  for (const table of TABLES) await knex.schema.alterTable(table, t => { t.dropColumn('place_id'); });
  await knex.schema.dropTableIfExists('places');
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).where({ permission: 'lieux:write' }).del();
  }
};
