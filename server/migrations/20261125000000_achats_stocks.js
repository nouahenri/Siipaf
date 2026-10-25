/** Achats & stocks : tables propres au module ; aucun changement de table métier existante. */
const ACTIONS = ['appro:read', 'appro:write', 'appro:validate', 'appro:stock', 'appro:settings'];
exports.up = async knex => {
  await knex.schema.createTable('appro_settings', t => {
    t.integer('id').primary(); t.bigInteger('direction_threshold').notNullable(); t.integer('updated_by').unsigned(); t.timestamps(true, true);
  });
  const old = await knex('app_settings').where({ key: 'request_dg_threshold' }).first('value');
  const { REQUEST_DG_THRESHOLD } = require('../src/lib/domain');
  await knex('appro_settings').insert({ id: 1, direction_threshold: old?.value != null && old.value !== '' ? Number(old.value) : REQUEST_DG_THRESHOLD });
  await knex.schema.createTable('appro_articles', t => {
    t.increments('id'); t.string('code', 40).notNullable().unique(); t.string('label', 200).notNullable(); t.string('unit', 30).notNullable();
    t.bigInteger('min_units').notNullable().defaultTo(0); t.boolean('active').notNullable().defaultTo(true); t.timestamps(true, true);
  });
  // Sources conservées comme références et libellés historiques : aucune contrainte ajoutée aux suppressions des anciens modules.
  await knex.schema.createTable('appro_locations', t => {
    t.increments('id'); t.string('name', 200).notNullable(); t.integer('place_id').unsigned().unique(); t.integer('worksite_id').unsigned().unique();
    t.boolean('active').notNullable().defaultTo(true); t.timestamps(true, true);
  });
  await knex.schema.createTable('appro_balances', t => {
    t.integer('article_id').unsigned().notNullable().references('appro_articles.id').onDelete('RESTRICT');
    t.integer('location_id').unsigned().notNullable().references('appro_locations.id').onDelete('RESTRICT');
    t.bigInteger('quantity_units').notNullable().defaultTo(0); t.bigInteger('min_units'); t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.primary(['article_id', 'location_id']);
  });
  await knex.schema.createTable('appro_quotes', t => {
    t.increments('id'); t.string('reference', 30).unique(); t.integer('supplier_id').unsigned().notNullable(); t.integer('location_id').unsigned().notNullable();
    t.string('status', 15).notNullable().defaultTo('brouillon'); t.date('date').notNullable(); t.date('needed_on'); t.string('supplier_ref', 100); t.decimal('vat_rate', 5, 2).notNullable().defaultTo(0); t.text('note'); t.integer('created_by').unsigned(); t.timestamps(true, true);
  });
  await knex.schema.createTable('appro_orders', t => {
    t.increments('id'); t.string('reference', 30).unique(); t.integer('supplier_id').unsigned().notNullable(); t.integer('location_id').unsigned().notNullable();
    t.integer('quote_id').unsigned().unique(); t.string('status', 24).notNullable().defaultTo('brouillon'); t.date('date').notNullable(); t.date('needed_on');
    t.decimal('vat_rate', 5, 2).notNullable().defaultTo(0); t.bigInteger('amount_ht').notNullable(); t.bigInteger('vat_amount').notNullable(); t.bigInteger('amount_ttc').notNullable();
    t.bigInteger('approval_threshold'); t.integer('created_by').unsigned(); t.integer('approved_by').unsigned(); t.timestamp('approved_at'); t.string('refusal_reason', 500); t.text('note'); t.timestamps(true, true);
  });
  for (const [table, parent, field] of [['appro_quote_lines', 'appro_quotes', 'quote_id'], ['appro_order_lines', 'appro_orders', 'order_id']]) {
    await knex.schema.createTable(table, t => {
      t.increments('id'); t.integer(field).unsigned().notNullable().references(`${parent}.id`).onDelete('CASCADE');
      t.integer('article_id').unsigned().notNullable().references('appro_articles.id').onDelete('RESTRICT'); t.string('label', 200).notNullable(); t.string('unit', 30).notNullable();
      t.bigInteger('quantity_units').notNullable(); t.bigInteger('unit_price_fcfa'); t.integer('need_id').unsigned();
      if (field === 'order_id') t.bigInteger('received_units').notNullable().defaultTo(0);
      t.index('need_id');
    });
  }
  await knex.schema.createTable('appro_movements', t => {
    t.increments('id'); t.string('reference', 30).unique(); t.string('kind', 15).notNullable(); t.string('status', 12).notNullable().defaultTo('brouillon');
    t.integer('from_location_id').unsigned(); t.integer('to_location_id').unsigned(); t.integer('order_id').unsigned(); t.date('date').notNullable(); t.string('supplier_ref', 100);
    t.bigInteger('amount_ht'); t.bigInteger('vat_amount'); t.bigInteger('amount_ttc');
    t.text('note'); t.integer('created_by').unsigned(); t.integer('posted_by').unsigned(); t.timestamp('posted_at'); t.timestamps(true, true);
  });
  await knex.schema.createTable('appro_movement_lines', t => {
    t.increments('id'); t.integer('movement_id').unsigned().notNullable().references('appro_movements.id').onDelete('CASCADE');
    t.integer('article_id').unsigned().notNullable().references('appro_articles.id').onDelete('RESTRICT'); t.integer('order_line_id').unsigned(); t.bigInteger('quantity_units').notNullable();
    t.bigInteger('unit_price_fcfa'); t.string('label', 200).notNullable(); t.string('unit', 30).notNullable();
  });
  await knex.schema.createTable('appro_invoice_receipts', t => {
    t.integer('movement_id').unsigned().primary().references('appro_movements.id').onDelete('RESTRICT'); t.integer('invoice_id').unsigned().notNullable();
  });
  await knex.schema.createTable('appro_events', t => {
    t.increments('id'); t.string('entity', 20).notNullable(); t.integer('entity_id').unsigned().notNullable(); t.string('action', 50).notNullable(); t.integer('user_id').unsigned(); t.text('details'); t.timestamp('created_at').defaultTo(knex.fn.now()); t.index(['entity', 'entity_id']);
  });
  for (const role of ['conducteur_travaux', 'comptable', 'resp_exploitation']) {
    if (!(await knex('roles').where({ id: role }).first())) continue;
    for (const permission of [...ACTIONS, ...(role === 'resp_exploitation' ? ['appro:direction'] : [])]) {
      if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
    }
  }
};
exports.down = async knex => {
  for (const table of ['appro_events', 'appro_invoice_receipts', 'appro_movement_lines', 'appro_movements', 'appro_order_lines', 'appro_quote_lines', 'appro_orders', 'appro_quotes', 'appro_balances', 'appro_locations', 'appro_articles', 'appro_settings']) await knex.schema.dropTableIfExists(table);
  for (const table of ['role_permissions', 'user_permissions']) await knex(table).whereIn('permission', [...ACTIONS, 'appro:direction']).del();
};
