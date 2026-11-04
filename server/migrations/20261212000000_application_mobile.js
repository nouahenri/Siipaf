/**
 * Application mobile SIIPAF (demande du client du 03/11) :
 * - `client_accounts.token_version` : version des jetons de l'espace client. Elle augmente au changement ou à la réinitialisation
 *   du mot de passe, ce qui déconnecte les autres appareils (le jeton de l'application dure 30 jours) ;
 * - `client_accounts.push_prefs` : notifications push choisies par le client dans son profil ({ message, paiements, chantier,
 *   documents, sav } — absent = activé) ;
 * - `client_push_tokens` : jetons Expo des téléphones où le client est connecté (un appareil = une ligne, effacée à la déconnexion
 *   ou quand Expo signale l'appareil désinscrit).
 */
exports.up = async knex => {
  await knex.schema.alterTable('client_accounts', t => {
    t.integer('token_version').notNullable().defaultTo(0);
    t.text('push_prefs');
  });
  await knex.schema.createTable('client_push_tokens', t => {
    t.increments('id');
    t.integer('account_id').unsigned().notNullable().references('id').inTable('client_accounts').onDelete('CASCADE');
    t.string('token', 200).notNullable().unique();
    t.string('platform', 10);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('last_seen_at').defaultTo(knex.fn.now());
    t.index(['account_id']);
  });
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('client_push_tokens');
  await knex.schema.alterTable('client_accounts', t => {
    t.dropColumn('token_version');
    t.dropColumn('push_prefs');
  });
};
