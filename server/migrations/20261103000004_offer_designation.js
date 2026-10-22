/**
 * Grille de prix : désignation libre d'une ligne (« 2 pièces », « paiement comptant »), affichée sur le site
 * après le type de bien (« Appartement social 2 pièces »). Colonne simple : pas de reconstruction de table
 * à l'ajout sous SQLite ; le retour arrière coupe les clés étrangères pendant la reconstruction.
 */
const isSqlite = knex => /sqlite/.test(knex.client.config.client);

exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.schema.alterTable('project_offers', t => { t.string('designation', 120); });
};

exports.down = async function (knex) {
  const sqlite = isSqlite(knex);
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('project_offers', t => { t.dropColumn('designation'); });
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};
