/**
 * Notifications par module (choix du client du 25/10) : chaque compte active ou coupe les notifications d'un module
 * et choisit leur son, dans les Réglages du module. JSON { module: { enabled, sound } } ; vide = tout activé, son général.
 */
exports.up = async knex => {
  if (!(await knex.schema.hasColumn('users', 'notif_prefs'))) await knex.schema.alterTable('users', t => { t.text('notif_prefs').nullable(); });
};
exports.down = async knex => {
  if (await knex.schema.hasColumn('users', 'notif_prefs')) await knex.schema.alterTable('users', t => { t.dropColumn('notif_prefs'); });
};
