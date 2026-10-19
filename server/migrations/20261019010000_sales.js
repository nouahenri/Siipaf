/**
 * Dossiers d'acquisition : l'acquéreur d'un lot, le prix convenu, ses versements
 * et l'avancement de ses documents administratifs et juridiques.
 * Ces données alimentent la fiche lot du dashboard puis l'espace client (phase 2).
 */
const { SALE_STATUSES, PAYMENT_METHODS, DOCUMENT_TYPES, DOCUMENT_STATUSES } = require('../src/lib/domain');

exports.up = async function (knex) {
  await knex.schema.alterTable('leads', t => {
    t.string('client_code', 20).unique(); // attribué au premier dossier d'acquisition (SIIPAF-2026-0001)
  });

  await knex.schema.createTable('sales', t => {
    t.increments('id');
    t.integer('lot_id').unsigned().notNullable().references('lots.id').onDelete('CASCADE');
    t.integer('lead_id').unsigned().notNullable().references('leads.id').onDelete('RESTRICT');
    t.bigInteger('price_fcfa').notNullable();
    t.enu('financing', ['apport', 'diaspora', 'credit', 'comptant']);
    t.enu('status', SALE_STATUSES).notNullable().defaultTo('en_cours');
    t.date('reserved_at');
    t.date('signed_at');
    t.text('notes');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['lot_id', 'status']);
  });

  await knex.schema.createTable('payments', t => {
    t.increments('id');
    t.integer('sale_id').unsigned().notNullable().references('sales.id').onDelete('CASCADE');
    t.bigInteger('amount_fcfa').notNullable();
    t.date('paid_at').notNullable();
    t.enu('method', PAYMENT_METHODS).notNullable();
    t.string('reference', 120);
    t.string('note', 255);
    t.integer('recorded_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('sale_documents', t => {
    t.increments('id');
    t.integer('sale_id').unsigned().notNullable().references('sales.id').onDelete('CASCADE');
    t.enu('type', DOCUMENT_TYPES).notNullable();
    t.string('label', 160).notNullable();
    t.enu('status', DOCUMENT_STATUSES).notNullable().defaultTo('a_fournir');
    t.integer('media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.boolean('visible_client').notNullable().defaultTo(true);
    t.string('note', 255);
    t.integer('sort').notNullable().defaultTo(0);
    t.integer('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('sale_documents');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('sales');
  await knex.schema.alterTable('leads', t => t.dropColumn('client_code'));
};
