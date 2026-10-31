/**
 * ERP · Marketing & Communication (mission A4 de docs/strategie-commercial-ia-siipaf.md) : campagnes, calendrier éditorial,
 * bibliothèque de contenus versionnés, journal des générations de l'IA (coût compris) et événements de validation.
 * L'IA est le « responsable marketing » : elle prépare ; la responsable de la communication relit, valide et publie ;
 * la Direction générale supervise. Rôle « Responsable communication » créé pour le client (réglable ensuite).
 * Suivi des prospects par campagne : colonnes simples sur `leads` (campaign_id, utm_medium, utm_content), jamais dans
 * `leads.source` (qui pilote les alertes). Sans clé étrangère sur `leads` : sous SQLite, une clé étrangère reconstruit la table.
 */
const ROLE = { id: 'resp_communication', label: 'Responsable communication', description: 'Relit, ajuste et valide les contenus préparés par l’IA, puis les marque planifiés ou publiés' };
const GRANTS = {
  resp_communication: ['marketing:read', 'marketing:generate', 'marketing:validate'], // pas les réglages : ils relèvent de la Direction générale
  commercial: ['marketing:read'],
  editeur: ['marketing:read', 'marketing:generate'],
  resp_exploitation: ['marketing:read', 'marketing:generate', 'marketing:validate'],
};
const PERMISSIONS = ['marketing:read', 'marketing:generate', 'marketing:validate', 'marketing:settings'];

exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.schema.createTable('marketing_campaigns', t => {
    t.increments('id');
    t.string('code', 60).notNullable().unique(); // utm_campaign
    t.string('name', 160).notNullable();
    t.string('objective', 500);
    t.string('segment', 30).notNullable().defaultTo('residence_principale');
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.integer('offer_id').unsigned().references('project_offers.id').onDelete('SET NULL');
    t.string('cta_label', 60);
    t.string('landing_path', 160).notNullable().defaultTo('contact.html');
    t.string('status', 12).notNullable().defaultTo('brouillon'); // brouillon, a_valider, validee, archivee
    t.boolean('permanent').notNullable().defaultTo(false); // ligne éditoriale permanente, créée par l'IA
    t.date('starts_on');
    t.date('ends_on');
    t.json('concept');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL'); // nul : IA
    t.integer('validated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('validated_at');
    t.timestamps(true, true);
    t.index(['status']);
  });

  await knex.schema.createTable('marketing_contents', t => {
    t.increments('id');
    t.integer('campaign_id').unsigned().notNullable().references('marketing_campaigns.id').onDelete('CASCADE');
    t.string('channel', 20).notNullable();
    t.string('kind', 20).notNullable();
    t.string('title', 200).notNullable();
    t.string('status', 12).notNullable().defaultTo('brouillon'); // brouillon, a_valider, valide, planifie, publie, archive
    t.integer('current_version_id').unsigned();
    t.date('scheduled_for');
    t.timestamp('published_at');
    t.string('published_url', 500);
    t.string('reject_reason', 500);
    t.json('warnings');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL'); // nul : IA
    t.integer('validated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('validated_at');
    t.timestamps(true, true);
    t.index(['status', 'scheduled_for']);
    t.index(['campaign_id']);
  });

  // Versions immuables : modifier un contenu en crée une nouvelle
  await knex.schema.createTable('marketing_content_versions', t => {
    t.increments('id');
    t.integer('content_id').unsigned().notNullable().references('marketing_contents.id').onDelete('CASCADE');
    t.integer('version_no').notNullable();
    t.text('body').notNullable();
    t.string('subject', 200);
    t.json('hashtags');
    t.string('cta', 200);
    t.text('visual_idea');
    t.string('origin', 8).notNullable(); // ia, demo, humain
    t.integer('generation_id').unsigned();
    t.json('fact_refs');
    t.integer('edited_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['content_id', 'version_no']);
  });

  await knex.schema.createTable('marketing_generations', t => {
    t.increments('id');
    t.integer('campaign_id').unsigned().references('marketing_campaigns.id').onDelete('SET NULL');
    t.integer('content_id').unsigned();
    t.string('step', 12).notNullable(); // concept, contenus, variante, semaine
    t.string('mode', 4).notNullable(); // ia, demo
    t.string('model', 60);
    t.string('prompt_version', 20);
    t.string('status', 16).notNullable().defaultTo('en_cours'); // en_cours, ok, invalide, erreur, refuse_plafond
    t.string('month', 7).notNullable(); // AAAA-MM, pour le cumul mensuel de la dépense
    t.date('week_of'); // lundi de la semaine préparée (préparation hebdomadaire, sans doublon)
    t.integer('tokens_in').notNullable().defaultTo(0);
    t.integer('tokens_out').notNullable().defaultTo(0);
    t.integer('tokens_cache_read').notNullable().defaultTo(0);
    t.integer('tokens_cache_write').notNullable().defaultTo(0);
    t.bigInteger('cost_micro_usd').notNullable().defaultTo(0); // en cours : coût maximal réservé
    t.json('context'); // faits envoyés à l'IA (jamais de données de prospects ni de clients)
    t.json('output');
    t.string('error', 400);
    t.integer('requested_by').unsigned().references('users.id').onDelete('SET NULL'); // nul : tâche planifiée
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['month', 'status']);
    t.index(['campaign_id', 'step', 'week_of']);
  });

  await knex.schema.createTable('marketing_events', t => {
    t.increments('id');
    t.integer('campaign_id').unsigned().references('marketing_campaigns.id').onDelete('CASCADE');
    t.integer('content_id').unsigned().references('marketing_contents.id').onDelete('CASCADE');
    t.string('action', 16).notNullable(); // propose, edit, submit, validate, reject, schedule, publish, archive, settings
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.boolean('is_ai').notNullable().defaultTo(false);
    t.string('note', 500);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['content_id']);
    t.index(['campaign_id']);
  });

  // Réglages texte (le modèle, le ton de la marque, l'arrêt d'urgence) ; la clé API reste dans server/.env
  await knex.schema.createTable('marketing_settings', t => {
    t.string('key', 40).primary();
    t.text('value');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('leads', t => {
    t.integer('campaign_id').unsigned().nullable();
    t.string('utm_medium', 40).nullable();
    t.string('utm_content', 80).nullable();
    t.index(['campaign_id'], 'leads_campaign_idx');
  });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  if (!(await knex('roles').where({ id: ROLE.id }).first())) {
    const last = await knex('roles').max({ s: 'sort' }).first();
    await knex('roles').insert({ ...ROLE, system: false, sort: Number(last?.s || 0) + 1 });
  }
  for (const [role, perms] of Object.entries(GRANTS)) {
    if (!(await knex('roles').where({ id: role }).first())) continue;
    for (const permission of perms) {
      if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
    }
  }
};

exports.down = async function (knex) {
  const sqlite = /sqlite/.test(knex.client.config.client);
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('leads', t => { t.dropIndex(['campaign_id'], 'leads_campaign_idx'); });
    await knex.schema.alterTable('leads', t => { t.dropColumn('campaign_id'); t.dropColumn('utm_medium'); t.dropColumn('utm_content'); });
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
  for (const table of ['marketing_settings', 'marketing_events', 'marketing_generations', 'marketing_content_versions', 'marketing_contents', 'marketing_campaigns']) {
    await knex.schema.dropTableIfExists(table);
  }
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', PERMISSIONS).del();
  }
  // Le rôle créé pour le client disparaît s'il n'est plus attribué ; sinon il reste (sans les droits du module)
  if (await knex.schema.hasTable('roles')) {
    if (!(await knex('users').where({ role: ROLE.id }).first())) {
      await knex('role_permissions').where({ role: ROLE.id }).del();
      await knex('roles').where({ id: ROLE.id }).del();
    }
  }
};
