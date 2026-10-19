/**
 * Espace client (phase 2) : accès des acquéreurs, échéancier de paiement,
 * journal de chantier et messagerie client ↔ équipe SIIPAF.
 */
const { SCHEDULE_KINDS, SITE_STAGES, MESSAGE_SENDERS } = require('../src/lib/domain');

exports.up = async function (knex) {
  // Un accès par acquéreur (prospect doté d'un code client) ; connexion par code client + mot de passe
  await knex.schema.createTable('client_accounts', t => {
    t.increments('id');
    t.integer('lead_id').unsigned().notNullable().unique().references('leads.id').onDelete('CASCADE');
    t.string('password_hash', 100).notNullable();
    t.boolean('must_change_password').notNullable().defaultTo(true);
    t.boolean('active').notNullable().defaultTo(true);
    t.string('reset_token_hash', 64); // empreinte SHA-256 du lien de réinitialisation
    t.timestamp('reset_expires_at');
    t.timestamp('last_login_at');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  // Échéancier prévu d'un dossier ; les versements réels restent dans `payments`
  await knex.schema.createTable('payment_schedule', t => {
    t.increments('id');
    t.integer('sale_id').unsigned().notNullable().references('sales.id').onDelete('CASCADE');
    t.integer('seq').unsigned().notNullable();
    t.enu('kind', SCHEDULE_KINDS).notNullable();
    t.string('label', 120).notNullable();
    t.date('due_date').notNullable();
    t.bigInteger('amount_fcfa').notNullable();
    t.unique(['sale_id', 'seq']);
  });

  // Journal de chantier : un point d'avancement vise un projet entier, un îlot ou un lot
  await knex.schema.createTable('site_updates', t => {
    t.increments('id');
    t.integer('project_id').unsigned().notNullable().references('projects.id').onDelete('CASCADE');
    t.string('ilot', 40);
    t.integer('lot_id').unsigned().references('lots.id').onDelete('CASCADE');
    t.enu('stage', SITE_STAGES).notNullable();
    t.integer('progress_pct').unsigned().notNullable().defaultTo(0);
    t.string('title', 160).notNullable();
    t.text('body');
    t.json('media'); // identifiants de la médiathèque (photos, vidéos)
    t.boolean('visible_client').notNullable().defaultTo(true);
    t.timestamp('published_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['project_id', 'published_at']);
  });

  // Fil de discussion d'un acquéreur avec l'équipe
  await knex.schema.createTable('client_messages', t => {
    t.increments('id');
    t.integer('lead_id').unsigned().notNullable().references('leads.id').onDelete('CASCADE');
    t.integer('sale_id').unsigned().references('sales.id').onDelete('SET NULL');
    t.enu('sender', MESSAGE_SENDERS).notNullable();
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL'); // auteur côté équipe
    t.text('body').notNullable();
    t.timestamp('read_at'); // lu par le destinataire
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['lead_id', 'created_at']);
  });
};

exports.down = async function (knex) {
  for (const table of ['client_messages', 'site_updates', 'payment_schedule', 'client_accounts']) {
    await knex.schema.dropTableIfExists(table);
  }
};
