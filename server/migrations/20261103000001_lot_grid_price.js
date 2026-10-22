/**
 * Prix des lots tiré de la grille de prix du projet (correspondance par surface).
 * lots.price_from_grid : le prix suit la grille (mis à jour quand la grille change) ; false = prix saisi
 * à la main, jamais écrasé. Les lots existants dont le prix égale déjà celui de la grille la suivent.
 * Ajout d'une colonne simple, sans clé étrangère : pas de reconstruction de table sous SQLite. Le retour
 * arrière, lui, reconstruit « lots » sous SQLite : clés étrangères coupées pendant l'opération, sinon
 * dossiers et historique des lots partiraient en cascade.
 */
const { gridOfferFor } = require('../src/lib/domain');

const isSqlite = knex => /sqlite/.test(knex.client.config.client);

exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.schema.alterTable('lots', t => { t.boolean('price_from_grid').notNullable().defaultTo(false); });
  const offers = await knex('project_offers').orderBy(['project_id', 'sort']);
  const lots = await knex('lots').whereNotNull('price_fcfa').whereNotNull('surface_m2').select('id', 'project_id', 'surface_m2', 'price_fcfa', 'offer_id');
  for (const l of lots) {
    const hit = gridOfferFor(offers.filter(o => o.project_id === l.project_id), l.surface_m2, l.offer_id);
    if (hit && Number(hit.price_fcfa) === Number(l.price_fcfa)) await knex('lots').where({ id: l.id }).update({ price_from_grid: true });
  }
};

exports.down = async function (knex) {
  const sqlite = isSqlite(knex);
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('lots', t => { t.dropColumn('price_from_grid'); });
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};
