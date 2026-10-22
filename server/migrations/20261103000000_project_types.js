/**
 * Fiche projet : « Type de projet » et « Type de biens » choisis dans des listes de Paramètres.
 * - Type de projet : nouvelle liste (Logement social & haut standing, Logement social, Haut standing,
 *   Lotissement) ; les projets existants y sont rattachés d'après leur catégorie actuelle.
 * - Type de biens : liste déjà existante (Terrain nu, Villa basse, Duplex…) ; rattachement d'après la
 *   grille de prix du projet, ou « Terrain nu » pour un lotissement (services/refs.js › linkProjectTypes).
 *
 * SQLite (local, démo, tests) : colonnes sans clé étrangère, sinon SQLite reconstruit « projects » et
 * supprime en cascade lots, plans, dossiers (voir 20261022000000_settings.js).
 */
const { seedDefaultLists, linkProjectTypes } = require('../src/services/refs');

const isSqlite = knex => /sqlite/.test(knex.client.config.client);

exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.schema.alterTable('projects', t => {
    if (isSqlite(knex)) {
      t.integer('project_type_id').unsigned();
      t.integer('property_type_id').unsigned();
    } else {
      t.integer('project_type_id').unsigned().references('ref_items.id').onDelete('SET NULL');
      t.integer('property_type_id').unsigned().references('ref_items.id').onDelete('SET NULL');
    }
  });
  // Ajoute la liste « Types de projet » (valeurs par défaut) et rattache les projets existants
  await seedDefaultLists(knex);
  await linkProjectTypes(knex);
};

exports.down = async function (knex) {
  const sqlite = isSqlite(knex);
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('projects', t => {
      if (!sqlite) { t.dropForeign('project_type_id'); t.dropForeign('property_type_id'); }
      t.dropColumn('project_type_id'); t.dropColumn('property_type_id');
    });
    await knex('ref_items').where({ kind: 'type_projet' }).del();
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};
