const knex = require('knex');

let instance;

/** Connexion partagée ; les tests en créent une neuve par fichier avec createDb(). */
function createDb() {
  delete require.cache[require.resolve('../knexfile')];
  const db = knex(require('../knexfile'));
  if (db.client.config.client === 'better-sqlite3') {
    db.client.pool.on('createSuccess', (_, conn) => conn.pragma('foreign_keys = ON'));
  }
  return db;
}

function getDb() {
  if (!instance) instance = createDb();
  return instance;
}

module.exports = { getDb, createDb };
