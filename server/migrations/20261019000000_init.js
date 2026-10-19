/**
 * Schéma initial — phase 1 : utilisateurs, contenu du site, projets, plans de masse,
 * lots, prospects, options, rendez-vous, messages de contact, newsletter.
 * Écrit avec le constructeur de schéma Knex pour tourner à l'identique sur MySQL et SQLite.
 */

const { LOT_STATUSES, LEAD_STAGES, ROLES } = require('../src/lib/domain');

exports.up = async function (knex) {
  await knex.schema.createTable('users', t => {
    t.increments('id');
    t.string('email', 190).notNullable().unique();
    t.string('password_hash', 100).notNullable();
    t.string('name', 120).notNullable();
    t.string('phone', 40);
    t.enu('role', ROLES).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('last_login_at');
    t.timestamps(true, true);
  });

  // Contenu éditable du site : diaporama, textes, réglages (clé → JSON)
  await knex.schema.createTable('site_content', t => {
    t.string('key', 100).primary();
    t.json('value').notNullable();
    t.integer('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Médiathèque (images, PDF de plans, vidéos)
  await knex.schema.createTable('media', t => {
    t.increments('id');
    t.string('filename', 255).notNullable();
    t.string('original_name', 255);
    t.string('mime', 100).notNullable();
    t.integer('size').unsigned();
    t.integer('width').unsigned();
    t.integer('height').unsigned();
    t.string('alt', 255);
    t.integer('uploaded_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('projects', t => {
    t.increments('id');
    t.string('slug', 80).notNullable().unique();
    t.string('name', 160).notNullable();
    t.string('city', 80);
    t.string('location', 255);
    t.string('tagline', 255);
    t.text('description');
    t.string('category', 80); // social, haut_standing, mixte…
    t.integer('cover_media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.integer('option_days').unsigned(); // null = valeur par défaut
    t.string('delivery', 80); // ex. « 30 mois »
    t.json('amenities');
    t.boolean('published').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  // Types de biens et grille de prix d'un projet
  await knex.schema.createTable('project_offers', t => {
    t.increments('id');
    t.integer('project_id').unsigned().notNullable().references('projects.id').onDelete('CASCADE');
    t.string('label', 160).notNullable();
    t.string('surface', 80);
    t.bigInteger('price_fcfa');
    t.bigInteger('diaspora_price_fcfa');
    t.integer('sort').notNullable().defaultTo(0);
  });

  // Plan de masse : image ou PDF rasterisé sur laquelle on dessine les lots
  await knex.schema.createTable('site_plans', t => {
    t.increments('id');
    t.integer('project_id').unsigned().notNullable().references('projects.id').onDelete('CASCADE');
    t.string('name', 160).notNullable();
    t.integer('media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.integer('width').unsigned();
    t.integer('height').unsigned();
    t.boolean('published').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('lots', t => {
    t.increments('id');
    t.integer('project_id').unsigned().notNullable().references('projects.id').onDelete('CASCADE');
    t.integer('plan_id').unsigned().references('site_plans.id').onDelete('SET NULL');
    t.integer('offer_id').unsigned().references('project_offers.id').onDelete('SET NULL');
    t.string('code', 40).notNullable(); // numéro de lot
    t.string('ilot', 40);
    t.decimal('surface_m2', 10, 2);
    t.bigInteger('price_fcfa');
    t.enu('status', LOT_STATUSES).notNullable().defaultTo('disponible');
    t.json('shape'); // polygone : [[x,y],…] en coordonnées relatives 0–1 du plan
    t.text('notes');
    t.timestamps(true, true);
    t.unique(['project_id', 'code']);
    t.index(['project_id', 'status']);
  });

  // Prospects : toute personne intéressée, suivie le long du circuit de vente
  await knex.schema.createTable('leads', t => {
    t.increments('id');
    t.string('name', 160).notNullable();
    t.string('email', 190);
    t.string('phone', 40);
    t.string('country', 80);
    t.boolean('is_diaspora').notNullable().defaultTo(false);
    t.enu('stage', LEAD_STAGES).notNullable().defaultTo('prospection');
    t.string('source', 40).notNullable().defaultTo('site'); // site, plan, ia, whatsapp, admin, import
    t.string('financing', 40); // apport, diaspora, credit, comptant
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.integer('lot_id').unsigned().references('lots.id').onDelete('SET NULL');
    t.integer('assigned_to').unsigned().references('users.id').onDelete('SET NULL');
    t.text('message');
    t.timestamps(true, true);
    t.index(['stage']);
    t.index(['email']);
    t.index(['phone']);
  });

  // Options (pré-réservations) — une seule active par lot
  await knex.schema.createTable('lot_options', t => {
    t.increments('id');
    t.integer('lot_id').unsigned().notNullable().references('lots.id').onDelete('CASCADE');
    t.integer('lead_id').unsigned().notNullable().references('leads.id').onDelete('CASCADE');
    t.enu('state', ['active', 'confirmee', 'expiree', 'annulee']).notNullable().defaultTo('active');
    t.timestamp('expires_at').notNullable();
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['state', 'expires_at']);
  });

  // Historique de chaque changement de statut d'un lot
  await knex.schema.createTable('lot_status_history', t => {
    t.increments('id');
    t.integer('lot_id').unsigned().notNullable().references('lots.id').onDelete('CASCADE');
    t.enu('from_status', LOT_STATUSES);
    t.enu('to_status', LOT_STATUSES).notNullable();
    t.integer('lead_id').unsigned().references('leads.id').onDelete('SET NULL');
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('reason', 255);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('appointments', t => {
    t.increments('id');
    t.integer('lead_id').unsigned().notNullable().references('leads.id').onDelete('CASCADE');
    t.integer('assigned_to').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.integer('lot_id').unsigned().references('lots.id').onDelete('SET NULL');
    t.enu('kind', ['visite', 'appel', 'bureau', 'visio']).notNullable().defaultTo('appel');
    t.enu('status', ['demande', 'confirme', 'effectue', 'annule', 'absent']).notNullable().defaultTo('demande');
    t.timestamp('starts_at').notNullable();
    t.integer('duration_min').unsigned().notNullable().defaultTo(30);
    t.string('source', 40).notNullable().defaultTo('site');
    t.text('notes');
    t.timestamps(true, true);
    t.index(['starts_at']);
  });

  await knex.schema.createTable('contact_messages', t => {
    t.increments('id');
    t.string('name', 160).notNullable();
    t.string('email', 190);
    t.string('phone', 40);
    t.string('subject', 160);
    t.text('message').notNullable();
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.integer('lead_id').unsigned().references('leads.id').onDelete('SET NULL');
    t.enu('status', ['nouveau', 'traite', 'archive']).notNullable().defaultTo('nouveau');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('newsletter_subscribers', t => {
    t.increments('id');
    t.string('email', 190).notNullable().unique();
    t.enu('status', ['actif', 'desinscrit']).notNullable().defaultTo('actif');
    t.string('unsubscribe_token', 64).notNullable().unique();
    t.string('source', 40).defaultTo('site');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  for (const table of [
    'newsletter_subscribers', 'contact_messages', 'appointments', 'lot_status_history',
    'lot_options', 'leads', 'lots', 'site_plans', 'project_offers', 'projects', 'media',
    'site_content', 'users',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
};

