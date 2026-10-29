/**
 * Versements déclarés par les commerciaux (demande du client du 29/10) : la Comptabilité enregistre les versements ;
 * un commercial peut en saisir un pour son client, il reste « à confirmer » et ne compte nulle part (solde, espace client,
 * reçu, comptabilité) tant que la Comptabilité n'a pas confirmé la réception des fonds. À la confirmation, le versement
 * entre dans `payments` (rattaché à sa déclaration) ; un refus est motivé. Le commercial est prévenu dans les deux cas.
 * Droit « payments:record » donné aux rôles qui ouvrent des dossiers sans enregistrer les versements (commerciaux).
 */
exports.up = async knex => {
  await knex.schema.createTable('payment_declarations', t => {
    t.increments('id');
    t.integer('sale_id').unsigned().notNullable().references('sales.id').onDelete('CASCADE');
    t.bigInteger('amount_fcfa').notNullable();
    t.date('paid_at').notNullable();
    t.string('method', 20).notNullable();
    t.string('reference', 120);
    t.string('note', 255);
    t.string('status', 12).notNullable().defaultTo('a_confirmer'); // a_confirmer, confirme, rejete, annule
    t.integer('declared_by').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('decided_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('decided_at');
    t.string('reject_reason', 255);
    t.integer('payment_id').unsigned(); // versement créé à la confirmation
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['sale_id']);
  });
  await knex.schema.alterTable('payments', t => { t.integer('declared_by').unsigned(); }); // commercial qui l'a saisi, s'il y a lieu

  const roles = await knex('role_permissions').where({ permission: 'sales:write' }).pluck('role');
  for (const role of roles) {
    const has = await knex('role_permissions').where({ role }).whereIn('permission', ['payments:write', 'payments:record']).first();
    if (!has) await knex('role_permissions').insert({ role, permission: 'payments:record' });
  }
};

exports.down = async knex => {
  await knex('role_permissions').where({ permission: 'payments:record' }).del();
  if (await knex.schema.hasTable('user_permissions')) await knex('user_permissions').where({ permission: 'payments:record' }).del();
  await knex.schema.alterTable('payments', t => { t.dropColumn('declared_by'); });
  await knex.schema.dropTableIfExists('payment_declarations');
};
