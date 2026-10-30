/**
 * Étapes d'un chantier selon le projet (choix du client) : un lotissement (terrains) a ses propres étapes (bornage,
 * voirie, réseaux, assainissement, éclairage public, attribution des lots…), différentes de celles d'un programme
 * immobilier. `site_updates.stage` était une liste fermée (enum MySQL / contrôle CHECK SQLite) des seules étapes des
 * bâtiments : elle devient une simple chaîne, validée par l'API selon la catégorie du projet (lib/domain.js ›
 * siteStageError). Les autres tables (déclarations, phases, appels de fonds) stockaient déjà l'étape en chaîne.
 */
const { SITE_STAGES, LOTISSEMENT_STAGES } = require('../src/lib/domain');

const isSqlite = knex => /sqlite/.test(knex.client.config.client);

/** SQLite : recrée `site_updates` avec une nouvelle définition de la colonne `stage` (nouvelle table, copie, échange). */
async function rebuildStage(knex, stageSql) {
  const [{ sql }] = await knex.raw("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'site_updates'");
  const def = /`stage`\s+text\s+check\s*\((?:[^()]|\([^()]*\))*\)|`stage`\s+varchar\(\d+\)/i;
  if (!def.test(sql)) throw new Error('Colonne site_updates.stage introuvable dans le schéma SQLite.');
  const createSql = sql.replace(def, stageSql).replace(/^CREATE TABLE\s+[`"]?site_updates[`"]?/i, 'CREATE TABLE `site_updates_new`');
  const indexes = (await knex.raw("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'site_updates' AND sql IS NOT NULL")).map(i => i.sql);
  await knex.raw(createSql);
  await knex.raw('INSERT INTO `site_updates_new` SELECT * FROM `site_updates`');
  await knex.raw('DROP TABLE `site_updates`');
  await knex.raw('ALTER TABLE `site_updates_new` RENAME TO `site_updates`');
  for (const index of indexes) await knex.raw(index);
}

exports.up = async function (knex) {
  if (isSqlite(knex)) await rebuildStage(knex, '`stage` varchar(30)');
  else await knex.schema.alterTable('site_updates', t => { t.string('stage', 30).notNullable().alter(); });
};

exports.down = async function (knex) {
  // Un point publié avec une étape de lotissement n'entrerait plus dans l'ancienne liste fermée
  const only = LOTISSEMENT_STAGES.filter(k => !SITE_STAGES.includes(k));
  const used = await knex('site_updates').whereIn('stage', only).count({ n: '*' });
  if (Number(used[0].n)) throw new Error('Des points d’avancement utilisent des étapes de lotissement : supprimez-les avant de revenir en arrière.');
  if (isSqlite(knex)) await rebuildStage(knex, `\`stage\` text check (\`stage\` in (${SITE_STAGES.map(s => `'${s}'`).join(', ')}))`);
  else await knex.schema.alterTable('site_updates', t => { t.enu('stage', SITE_STAGES).notNullable().alter(); });
};
