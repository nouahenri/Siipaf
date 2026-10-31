/**
 * Acquisition par les canaux officiels Meta (décision du client du 31/10/2026) : formulaires de publicité (Lead Ads), messages et
 * commentaires de la page Facebook et du compte Instagram traités par Sita, pixel du site, audiences et ciblage proposés par l'IA.
 * Aucune collecte d'identités sur d'autres pages : seuls les messages adressés à SIIPAF et les formulaires remplis pour SIIPAF arrivent.
 * - `meta_settings` : réglages des connecteurs ; les secrets (jeton de page, secret de l'application, jeton de vérification…) y sont
 *   stockés CHIFFRÉS (AES-256-GCM) et ne sont jamais renvoyés au navigateur.
 * - `meta_events` : journal des webhooks, des tests de connexion, des exports et envois d'audiences. L'unicité (type, identifiant
 *   externe) rend le traitement idempotent (un même leadgen_id, un même message ou commentaire n'est traité qu'une fois).
 * - `meta_audiences` : audiences créées (liste hachée envoyée, audience d'interaction, audience similaire).
 * - `marketing_targetings` : paramètres de ciblage et textes d'annonce proposés par l'IA pour une campagne, validés par la responsable
 *   de la communication.
 * - `sita_conversations` : canal (site, messenger, instagram), identifiant d'expéditeur propre à la page et fin de la fenêtre de 24 h.
 * Sans clé étrangère sur les tables existantes (SQLite reconstruirait la table) ; les droits marketing:* existants sont réutilisés.
 */
exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.schema.createTable('meta_settings', t => {
    t.string('key', 40).primary();
    t.text('value');
    t.boolean('secret').notNullable().defaultTo(false);
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('meta_events', t => {
    t.increments('id');
    t.string('kind', 12).notNullable(); // lead, message, comment, test, export, audience, pixel
    t.string('status', 12).notNullable().defaultTo('recu'); // recu, ok, ignore, erreur
    t.string('external_id', 100); // leadgen_id, identifiant du message ou du commentaire (unique par type)
    t.string('channel', 12); // facebook, instagram, messenger
    t.integer('lead_id').unsigned();
    t.integer('conversation_id').unsigned();
    t.string('detail', 500);
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['kind', 'external_id']);
    t.index(['kind', 'status']);
    t.index(['created_at']);
  });

  await knex.schema.createTable('meta_audiences', t => {
    t.increments('id');
    t.string('kind', 12).notNullable(); // liste, interaction, similaire
    t.string('name', 160).notNullable();
    t.string('scope', 20); // clients, prospects, tous (liste) ; modèle (interaction)
    t.integer('size').notNullable().defaultTo(0); // personnes de la liste envoyée
    t.string('meta_audience_id', 40); // identifiant côté Meta
    t.integer('origin_id').unsigned(); // audience d'origine d'une audience similaire
    t.string('status', 12).notNullable().defaultTo('cree'); // cree, erreur
    t.string('detail', 500);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['kind']);
  });

  await knex.schema.createTable('marketing_targetings', t => {
    t.increments('id');
    t.integer('campaign_id').unsigned().notNullable().references('marketing_campaigns.id').onDelete('CASCADE');
    t.integer('version_no').notNullable().defaultTo(1);
    t.string('status', 12).notNullable().defaultTo('brouillon'); // brouillon, a_valider, valide, refuse, archive
    t.string('origin', 8).notNullable(); // ia, demo, humain
    t.json('params').notNullable(); // zones, âges, centres d'intérêt, diaspora, audiences
    t.json('ads').notNullable(); // textes d'annonce : titre, texte principal, description, bouton
    t.text('rationale');
    t.json('warnings');
    t.string('reject_reason', 500);
    t.integer('generation_id').unsigned();
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL'); // nul : IA
    t.integer('validated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('validated_at');
    t.timestamps(true, true);
    t.index(['campaign_id', 'status']);
  });

  await knex.schema.alterTable('sita_conversations', t => {
    t.string('channel', 12).notNullable().defaultTo('site'); // site, messenger, instagram
    t.string('external_id', 64); // identifiant de l'expéditeur propre à la page (PSID, IGSID) ; jamais une donnée personnelle
    t.timestamp('window_until'); // fin de la fenêtre de réponse de 24 h de Meta (dernier message reçu + 24 h)
    t.index(['channel'], 'sita_conversations_channel_idx');
  });
};

exports.down = async function (knex) {
  for (const table of ['marketing_targetings', 'meta_audiences', 'meta_events', 'meta_settings']) await knex.schema.dropTableIfExists(table);
  const sqlite = /sqlite/.test(knex.client.config.client);
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('sita_conversations', t => {
      t.dropIndex(['channel'], 'sita_conversations_channel_idx');
      for (const c of ['channel', 'external_id', 'window_until']) t.dropColumn(c);
    });
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};
