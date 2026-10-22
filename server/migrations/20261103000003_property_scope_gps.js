/**
 * - Types de biens rattachés aux types de projet (ref_items.project_types, liste d'identifiants en JSON ;
 *   vide = tous) : la fiche projet ne propose que les types de biens du type de projet choisi.
 * - Position GPS du projet (latitude, longitude) : carte et itinéraire sur le site.
 * Colonnes simples, sans clé étrangère. Le retour arrière reconstruit les tables sous SQLite :
 * clés étrangères coupées pendant l'opération (sinon suppressions en cascade).
 */
const { scopePropertyTypes } = require('../src/services/refs');

const isSqlite = knex => /sqlite/.test(knex.client.config.client);

exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.schema.alterTable('ref_items', t => { t.text('project_types'); });
  await knex.schema.alterTable('projects', t => {
    t.decimal('latitude', 10, 7);
    t.decimal('longitude', 10, 7);
  });
  await scopePropertyTypes(knex);
};

exports.down = async function (knex) {
  const sqlite = isSqlite(knex);
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('projects', t => { t.dropColumn('latitude'); t.dropColumn('longitude'); });
    await knex.schema.alterTable('ref_items', t => { t.dropColumn('project_types'); });
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};
