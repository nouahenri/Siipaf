/**
 * Paramètres : listes de référence (villes, localisations, équipements, commodités, viabilisation,
 * types de biens), réglages généraux, thème d'affichage de chaque compte, archivage des plans de masse.
 * Les projets existants sont rattachés aux listes à partir de leurs textes actuels.
 *
 * Attention SQLite (local, démo, tests) : ajouter une colonne AVEC clé étrangère oblige SQLite à
 * reconstruire la table « projects », et la reconstruction supprime en cascade lots, plans, dossiers…
 * Les colonnes city_id / location_id n'ont donc de clé étrangère qu'en MySQL ; sous SQLite c'est le
 * code (services/refs.js) qui garantit leur cohérence. Le retour arrière coupe les clés étrangères
 * pendant l'opération pour la même raison.
 */
const { backfill } = require('../src/services/refs');

const isSqlite = knex => /sqlite/.test(knex.client.config.client);

exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.schema.createTable('ref_items', t => {
    t.increments('id');
    t.string('kind', 30).notNullable();
    t.string('label', 120).notNullable();
    t.integer('parent_id').unsigned().references('ref_items.id').onDelete('RESTRICT');
    t.integer('sort').notNullable().defaultTo(0);
    t.boolean('archived').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['kind', 'parent_id']);
  });
  await knex.schema.createTable('project_refs', t => {
    t.integer('project_id').unsigned().notNullable().references('projects.id').onDelete('CASCADE');
    t.integer('ref_id').unsigned().notNullable().references('ref_items.id').onDelete('RESTRICT');
    t.string('state', 20); // viabilisation : prevu, en_cours, fait
    t.primary(['project_id', 'ref_id']);
  });
  await knex.schema.alterTable('projects', t => {
    if (isSqlite(knex)) {
      t.integer('city_id').unsigned();
      t.integer('location_id').unsigned();
    } else {
      t.integer('city_id').unsigned().references('ref_items.id').onDelete('SET NULL');
      t.integer('location_id').unsigned().references('ref_items.id').onDelete('SET NULL');
    }
    t.string('location_detail', 255); // précision d'accès : « Axe Abidjan–Alépé, 20 min de Cocody »
  });
  await knex.schema.createTable('app_settings', t => {
    t.string('key', 60).primary();
    t.text('value');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('users', t => { t.string('theme', 10); });
  await knex.schema.alterTable('site_plans', t => { t.timestamp('archived_at').nullable(); });
  // Nouveau droit « Gérer les paramètres » pour les rôles qui l'ont par défaut (sans toucher aux réglages faits)
  for (const role of ['editeur', 'resp_exploitation']) {
    const has = await knex('role_permissions').where({ role }).first();
    const already = await knex('role_permissions').where({ role, permission: 'settings:write' }).first();
    if (has && !already) await knex('role_permissions').insert({ role, permission: 'settings:write' });
  }
  await backfill(knex);
};

exports.down = async function (knex) {
  const sqlite = isSqlite(knex);
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('site_plans', t => { t.dropColumn('archived_at'); });
    await knex.schema.alterTable('users', t => { t.dropColumn('theme'); });
    await knex.schema.dropTableIfExists('app_settings');
    await knex.schema.alterTable('projects', t => {
      if (!sqlite) { t.dropForeign('city_id'); t.dropForeign('location_id'); }
      t.dropColumn('city_id'); t.dropColumn('location_id'); t.dropColumn('location_detail');
    });
    await knex.schema.dropTableIfExists('project_refs');
    await knex.schema.dropTableIfExists('ref_items');
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};
