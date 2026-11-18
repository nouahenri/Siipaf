/**
 * Liasse fiscale DGI dans l'ERP (demande du client du 18/11) : balance N-1 importée quand l'exercice précédent n'est pas
 * tenu dans l'ERP, renseignements du tableau des flux de trésorerie (montants corrigés par la Comptabilité).
 * Droits : « Consulter et produire la liasse fiscale » (Comptabilité, Direction générale) et « Préparer la liasse
 * fiscale » (Comptabilité), réglables dans Rôles & privilèges ; le super administrateur a tout.
 */
exports.up = async knex => {
  await knex.schema.createTable('liasse_balances_n1', t => {
    t.increments('id');
    t.integer('fiscal_year_id').unsigned().notNullable().references('acc_fiscal_years.id').onDelete('CASCADE');
    t.string('account', 12).notNullable();
    t.string('label', 160);
    t.bigInteger('debit').notNullable().defaultTo(0);
    t.bigInteger('credit').notNullable().defaultTo(0);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['fiscal_year_id']);
  });
  await knex.schema.createTable('liasse_inputs', t => {
    t.integer('fiscal_year_id').unsigned().primary().references('acc_fiscal_years.id').onDelete('CASCADE');
    t.text('data');
    t.integer('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  if (!(await knex.schema.hasTable('role_permissions'))) return;
  const grant = async (roles, permission) => {
    for (const role of roles) if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
  };
  const compta = await knex('role_permissions').where({ permission: 'compta:entries' }).distinct('role').pluck('role');
  const dg = await knex('role_permissions').where({ permission: 'demandes:dg' }).distinct('role').pluck('role');
  await grant([...new Set([...compta, ...dg])], 'liasse:read');
  await grant(compta, 'liasse:prepare');
};

exports.down = async knex => {
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', ['liasse:read', 'liasse:prepare']).del();
  }
  await knex.schema.dropTableIfExists('liasse_inputs');
  await knex.schema.dropTableIfExists('liasse_balances_n1');
};
