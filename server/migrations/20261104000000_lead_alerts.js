/**
 * Alertes « nouveau prospect » : `leads.seen_at` (fiche ouverte par l'équipe ; nul = compteur du menu Prospects),
 * `leads.alert_at` (moment de la demande, pour la cloche), `leads.created_by` (auteur côté équipe ; nul = site),
 * `users.notifications_seen_at` (dernière ouverture de la cloche) et le type de bien consulté sur un message
 * de contact. Colonnes simples, sans clé étrangère (sous SQLite, une clé étrangère reconstruit la table).
 * L'existant est considéré comme vu : les compteurs partent de zéro.
 */
const isSqlite = knex => /sqlite/.test(knex.client.config.client);

exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.schema.alterTable('leads', t => {
    t.timestamp('seen_at').nullable();
    t.timestamp('alert_at').nullable();
    t.integer('created_by').unsigned().nullable();
  });
  await knex.schema.alterTable('users', t => { t.timestamp('notifications_seen_at').nullable(); });
  await knex.schema.alterTable('contact_messages', t => { t.string('property_type', 160); });
  await knex('leads').update({ seen_at: knex.ref('created_at') });
  await knex('users').update({ notifications_seen_at: knex.fn.now() });
};

exports.down = async function (knex) {
  const sqlite = isSqlite(knex);
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('leads', t => { t.dropColumn('seen_at'); t.dropColumn('alert_at'); t.dropColumn('created_by'); });
    await knex.schema.alterTable('users', t => { t.dropColumn('notifications_seen_at'); });
    await knex.schema.alterTable('contact_messages', t => { t.dropColumn('property_type'); });
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};
