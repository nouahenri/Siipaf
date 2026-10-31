/**
 * « Sita », conseillère IA du site public (cadrage du client du 31/10/2026) : conversations avec les visiteurs, messages avec le
 * coût de chaque échange (en micro-dollars, converti en FCFA par le taux réglé), réglages de l'assistante.
 * - `sita_conversations` : une par visiteur du site (identifiant aléatoire gardé par son navigateur, jamais une donnée personnelle),
 *   rattachée à la fiche prospect (`lead_id`) quand le visiteur a laissé ses coordonnées, et au rendez-vous pris (`appointment_id`).
 *   Pas de clé étrangère vers `leads` ni `appointments` : un lien « souple » (colonne simple) évite de reconstruire ces tables sous SQLite.
 * - `sita_messages` : chaque message du visiteur et de l'assistante, avec le mode (IA ou démonstration), le modèle, les jetons et le coût.
 * - `sita_settings` : réglages texte (identité, accueil, invitations, horaires, modèle, plafond, arrêt d'urgence) ; la clé de l'IA reste
 *   dans ANTHROPIC_API_KEY (server/.env), jamais ici.
 * Droit « Régler l'assistante du site » (site:assistant) : accordé à qui gère le contenu du site (rôles et comptes ayant un droit de
 * « Contenu du site »). Le super administrateur a tous les droits.
 */
const PERMISSION = 'site:assistant';
const CONTENT_PERMS = ['content:home', 'content:texts', 'content:images', 'content:contacts', 'content:write'];

exports.up = async function (knex) {
  await knex.schema.createTable('sita_conversations', t => {
    t.increments('id');
    t.string('visitor_key', 64).notNullable().unique(); // identifiant aléatoire du navigateur (sessionStorage)
    t.integer('lead_id').unsigned(); // fiche prospect créée ou complétée par la conversation
    t.integer('appointment_id').unsigned(); // dernier rendez-vous pris par la conversation
    t.integer('project_id').unsigned(); // programme consulté au début de la conversation
    t.string('page_path', 160);
    t.string('lang', 2).notNullable().defaultTo('fr');
    t.string('mode', 4).notNullable().defaultTo('demo'); // ia, demo (dernier mode utilisé)
    t.integer('campaign_id').unsigned(); // campagne d'origine (liens utm_*), conservée pour la fiche
    t.string('utm_medium', 40);
    t.string('utm_content', 80);
    t.string('ip_hash', 24); // empreinte de l'adresse (anti-abus), jamais l'adresse
    t.boolean('consent_contact').notNullable().defaultTo(false); // le visiteur accepte d'être recontacté
    t.timestamp('consent_at');
    t.boolean('handed_over').notNullable().defaultTo(false); // relais WhatsApp ou conseiller proposé
    t.timestamp('handed_over_at');
    t.integer('messages_count').notNullable().defaultTo(0); // messages du visiteur
    t.bigInteger('cost_micro_usd').notNullable().defaultTo(0);
    t.json('state'); // mini-dialogue du mode démonstration (coordonnées en cours de saisie)
    t.text('summary'); // résumé laissé sur la fiche prospect
    t.timestamp('last_message_at');
    t.timestamps(true, true);
    t.index(['lead_id']);
    t.index(['last_message_at']);
    t.index(['ip_hash']);
  });

  await knex.schema.createTable('sita_messages', t => {
    t.increments('id');
    t.integer('conversation_id').unsigned().notNullable().references('sita_conversations.id').onDelete('CASCADE');
    t.string('role', 10).notNullable(); // visiteur, assistante
    t.text('content').notNullable();
    t.string('mode', 4); // ia, demo
    t.string('model', 60);
    t.string('prompt_version', 24);
    t.string('status', 16).notNullable().defaultTo('ok'); // ok, erreur, refuse_plafond, corrige (réponse remplacée par les contrôles)
    t.string('month', 7).notNullable(); // AAAA-MM : cumul mensuel de la dépense
    t.integer('tokens_in').notNullable().defaultTo(0);
    t.integer('tokens_out').notNullable().defaultTo(0);
    t.integer('tokens_cache_read').notNullable().defaultTo(0);
    t.integer('tokens_cache_write').notNullable().defaultTo(0);
    t.bigInteger('cost_micro_usd').notNullable().defaultTo(0);
    t.json('tools'); // outils exécutés par le serveur : [{ name, ok, result }]
    t.json('warnings'); // contrôles de la réponse qui ont corrigé le texte
    t.string('error', 400);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['conversation_id']);
    t.index(['month', 'status']);
  });

  await knex.schema.createTable('sita_settings', t => {
    t.string('key', 40).primary();
    t.text('value');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  const roles = await knex('role_permissions').whereIn('permission', CONTENT_PERMS).distinct('role');
  for (const { role } of roles) {
    if (role === 'super_admin') continue;
    if (!(await knex('role_permissions').where({ role, permission: PERMISSION }).first())) await knex('role_permissions').insert({ role, permission: PERMISSION });
  }
  if (await knex.schema.hasTable('user_permissions')) {
    // Comptes à qui un droit de contenu a été accordé en propre (et non retiré)
    const users = await knex('user_permissions').whereIn('permission', CONTENT_PERMS).where({ granted: true }).distinct('user_id');
    for (const { user_id } of users) {
      if (!(await knex('user_permissions').where({ user_id, permission: PERMISSION }).first())) await knex('user_permissions').insert({ user_id, permission: PERMISSION, granted: true });
    }
  }
};

exports.down = async function (knex) {
  for (const table of ['sita_messages', 'sita_conversations', 'sita_settings']) await knex.schema.dropTableIfExists(table);
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).where({ permission: PERMISSION }).del();
  }
};
