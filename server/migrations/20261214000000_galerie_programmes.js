/**
 * Galerie photos d'un programme (demande du client du 04/11) : `projects.gallery`, liste ordonnée d'identifiants de la
 * médiathèque (JSON), choisie dans le dashboard (Projets › fiche › Galerie photos). L'application mobile l'affiche
 * après l'image principale (photo à balayer, vignettes, plein écran).
 */
exports.up = async knex => {
  await knex.schema.alterTable('projects', t => { t.text('gallery'); });
};

// SQLite (démo, tests) refait la table pour retirer une colonne : clés étrangères suspendues le temps de l'opération,
// hors transaction (SQLite ignore le réglage dans une transaction)
exports.config = { transaction: false };
const isSqlite = knex => /sqlite/.test(knex.client.config.client);

exports.down = async knex => {
  const sqlite = isSqlite(knex);
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('projects', t => { t.dropColumn('gallery'); });
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};
