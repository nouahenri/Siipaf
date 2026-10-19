/**
 * Rôles personnalisables : la liste des rôles passe dans la table `roles` (remplie avec les
 * 6 rôles d'origine, marqués « système » donc non supprimables) et `users.role` devient une
 * simple chaîne au lieu d'une liste fermée (enum MySQL / contrôle CHECK SQLite).
 *
 * Pas de transaction globale : sous SQLite, retirer le contrôle CHECK impose de recréer la
 * table `users`, ce qui n'est sûr qu'avec les clés étrangères suspendues (sinon la suppression
 * de l'ancienne table effacerait en cascade les privilèges individuels), et SQLite ne permet
 * de les suspendre qu'en dehors d'une transaction. Sous MySQL, ces instructions ne sont de
 * toute façon pas transactionnelles.
 */
const { ROLES, ROLE_LABELS } = require('../src/lib/domain');

exports.config = { transaction: false };

const DESCRIPTIONS = {
  super_admin: 'Tous les droits, y compris la gestion des rôles et des privilèges.',
  commercial: 'Prospects, rendez-vous, options et dossiers d’acquisition.',
  editeur: 'Contenu du site, projets, plans de masse et médiathèque.',
  conducteur_travaux: 'Documents juridiques et avancement des chantiers.',
  comptable: 'Versements et échéanciers.',
  resp_exploitation: 'Supervision des ventes, des projets et de l’espace client.',
};

const isSqlite = knex => knex.client.config.client === 'better-sqlite3' || knex.client.dialect === 'sqlite3';

/**
 * SQLite : recrée `users` avec une nouvelle définition de la colonne `role`
 * (procédure recommandée par SQLite : nouvelle table, copie, échange, contrôle des clés).
 */
async function rebuildUsersRole(knex, roleColumnSql) {
  const [{ sql }] = await knex.raw("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'");
  const roleDef = /[`"]role[`"][^,]*?(?:check\s*\((?:[^()]|\([^()]*\))*\))?[^,]*?(?=,\s*[`"]\w+[`"]|\s*\)\s*$)/i;
  if (!roleDef.test(sql)) throw new Error('Colonne users.role introuvable dans le schéma SQLite.');
  const createSql = sql.replace(roleDef, roleColumnSql).replace(/^CREATE TABLE\s+[`"]?users[`"]?/i, 'CREATE TABLE `users_new`');
  const indexes = (await knex.raw("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users' AND sql IS NOT NULL")).map(i => i.sql);

  await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.transaction(async trx => {
      await trx.raw(createSql);
      await trx.raw('INSERT INTO `users_new` SELECT * FROM `users`');
      await trx.raw('DROP TABLE `users`');
      await trx.raw('ALTER TABLE `users_new` RENAME TO `users`');
      for (const index of indexes) await trx.raw(index);
      const violations = await trx.raw('PRAGMA foreign_key_check');
      if (violations.length) throw new Error('Clés étrangères incohérentes après la reconstruction de users.');
    });
  } finally {
    await knex.raw('PRAGMA foreign_keys = ON');
  }
}

exports.up = async function (knex) {
  await knex.schema.createTable('roles', t => {
    t.string('id', 40).primary(); // clé technique, enregistrée dans users.role
    t.string('label', 120).notNullable();
    t.string('description', 255);
    t.boolean('system').notNullable().defaultTo(false); // rôle d'origine : non supprimable
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  await knex('roles').insert(ROLES.map((id, sort) => ({
    id, label: ROLE_LABELS[id], description: DESCRIPTIONS[id] || null, system: true, sort,
  })));

  if (isSqlite(knex)) await rebuildUsersRole(knex, '`role` varchar(40) NOT NULL');
  else await knex.schema.alterTable('users', t => { t.string('role', 40).notNullable().alter(); });
};

exports.down = async function (knex) {
  // Les comptes d'un rôle personnalisé n'entreraient plus dans l'ancienne liste fermée
  const custom = await knex('users').whereNotIn('role', ROLES).count({ n: '*' });
  if (Number(custom[0].n)) throw new Error('Des comptes utilisent un rôle personnalisé : réaffectez-les avant de revenir en arrière.');
  if (isSqlite(knex)) {
    await rebuildUsersRole(knex, `\`role\` text CHECK (\`role\` IN (${ROLES.map(r => `'${r}'`).join(', ')})) NOT NULL`);
  } else {
    await knex.schema.alterTable('users', t => { t.enu('role', ROLES).notNullable().alter(); });
  }
  await knex('role_permissions').whereNotIn('role', ROLES).del();
  await knex.schema.dropTableIfExists('roles');
};
