/**
 * Mot de passe provisoire : un compte créé (ou un mot de passe réinitialisé) par quelqu'un d'autre doit choisir
 * son propre mot de passe à la connexion suivante (dashboard et ERP).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', t => {
    t.boolean('must_change_password').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  if (!String(knex.client.config.client).includes('sqlite')) {
    await knex.schema.alterTable('users', t => t.dropColumn('must_change_password'));
  }
};
