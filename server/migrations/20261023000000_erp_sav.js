/**
 * ERP · Client & SAV : réclamations (tickets) et leur fil, réserves relevées à la livraison,
 * interventions, date de livraison des dossiers (point de départ des garanties).
 * Règle SQLite : aucune clé étrangère ajoutée par alterTable (sinon reconstruction de table).
 */
const { SAV_STATUSES, SAV_SOURCES, SAV_RESERVE_STATUSES, SAV_INTERVENTION_STATUSES, PERMISSIONS } = require('../src/lib/domain');

exports.up = async function (knex) {
  // Date de livraison du bien (PV) : point de départ des garanties
  await knex.schema.alterTable('sales', t => {
    t.date('delivered_at');
  });

  await knex.schema.createTable('sav_tickets', t => {
    t.increments('id');
    t.string('ref', 20).notNullable().unique(); // SAV-2026-0001
    t.integer('sale_id').unsigned().references('sales.id').onDelete('SET NULL');
    t.integer('lead_id').unsigned().references('leads.id').onDelete('SET NULL');
    t.integer('lot_id').unsigned().references('lots.id').onDelete('SET NULL');
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.string('category', 30).notNullable();
    t.string('priority', 20).notNullable().defaultTo('normale');
    t.enu('status', SAV_STATUSES).notNullable().defaultTo('nouveau');
    t.string('title', 160).notNullable();
    t.text('description');
    t.string('location', 120); // pièce, façade, jardin…
    t.enu('source', SAV_SOURCES).notNullable().defaultTo('equipe');
    t.string('warranty', 30); // parfait_achevement, biennale, decennale, hors_garantie
    t.integer('assigned_to').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('due_at');
    t.timestamp('first_response_at');
    t.timestamp('resolved_at');
    t.timestamp('closed_at');
    t.tinyint('satisfaction').unsigned();
    t.string('satisfaction_comment', 500);
    t.json('media'); // photos jointes à la création
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['sale_id']);
    t.index(['project_id']);
  });

  // Fil d'un ticket : commentaires (client / équipe / note interne), changements de statut, affectations
  await knex.schema.createTable('sav_events', t => {
    t.increments('id');
    t.integer('ticket_id').unsigned().notNullable().references('sav_tickets.id').onDelete('CASCADE');
    t.string('kind', 20).notNullable(); // comment, status, assign, intervention, reserve, system
    t.string('author', 10).notNullable(); // client, equipe, systeme
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.text('body');
    t.boolean('internal').notNullable().defaultTo(false); // note interne : jamais montrée au client
    t.json('media');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['ticket_id']);
  });

  // Réserves relevées au procès-verbal de livraison
  await knex.schema.createTable('sav_reserves', t => {
    t.increments('id');
    t.integer('sale_id').unsigned().notNullable().references('sales.id').onDelete('CASCADE');
    t.integer('lot_id').unsigned().references('lots.id').onDelete('SET NULL');
    t.integer('ticket_id').unsigned().references('sav_tickets.id').onDelete('SET NULL');
    t.string('label', 255).notNullable();
    t.string('location', 120);
    t.string('category', 30);
    t.enu('status', SAV_RESERVE_STATUSES).notNullable().defaultTo('ouverte');
    t.date('noted_at').notNullable();
    t.date('deadline');
    t.timestamp('lifted_at');
    t.integer('lifted_by').unsigned().references('users.id').onDelete('SET NULL');
    t.json('media');
    t.string('note', 500);
    t.timestamps(true, true);
    t.index(['sale_id', 'status']);
  });

  await knex.schema.createTable('sav_interventions', t => {
    t.increments('id');
    t.integer('ticket_id').unsigned().references('sav_tickets.id').onDelete('CASCADE');
    t.integer('reserve_id').unsigned().references('sav_reserves.id').onDelete('CASCADE');
    t.timestamp('scheduled_at').notNullable();
    t.integer('duration_min').unsigned().notNullable().defaultTo(60);
    t.integer('technician_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('contractor', 160); // sous-traitant ou artisan externe
    t.enu('status', SAV_INTERVENTION_STATUSES).notNullable().defaultTo('planifiee');
    t.text('report');
    t.json('media_before');
    t.json('media_after');
    t.bigInteger('cost_fcfa');
    t.timestamp('done_at');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['scheduled_at']);
  });

  // Photos jointes (réclamation, échange, réserve, intervention). Jamais publiques : rangées dans
  // uploads/private/sav et servies après contrôle (équipe autorisée, ou client propriétaire).
  await knex.schema.createTable('sav_files', t => {
    t.increments('id');
    t.integer('lead_id').unsigned().references('leads.id').onDelete('CASCADE');
    t.string('filename', 255).notNullable();
    t.string('original_name', 255);
    t.string('mime', 100).notNullable();
    t.integer('size').unsigned();
    t.integer('uploaded_by').unsigned().references('users.id').onDelete('SET NULL'); // null : déposé par le client
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['lead_id']);
  });

  // Les nouveaux droits rejoignent les rôles d'origine qui les ont par défaut
  if (await knex.schema.hasTable('role_permissions')) {
    const existing = await knex('roles').select('id').catch(() => null);
    const roles = new Set(existing ? existing.map(r => r.id) : Object.keys(PERMISSIONS));
    const rows = Object.entries(PERMISSIONS)
      .filter(([role]) => role !== 'super_admin' && roles.has(role))
      .flatMap(([role, perms]) => perms.filter(p => p.startsWith('sav:')).map(permission => ({ role, permission })));
    for (const row of rows) {
      const has = await knex('role_permissions').where(row).first();
      if (!has) await knex('role_permissions').insert(row);
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('sav_files');
  await knex.schema.dropTableIfExists('sav_interventions');
  await knex.schema.dropTableIfExists('sav_reserves');
  await knex.schema.dropTableIfExists('sav_events');
  await knex.schema.dropTableIfExists('sav_tickets');
  // Sous SQLite, retirer une colonne reconstruit la table « sales » et supprimerait en cascade
  // versements et documents : la colonne (inoffensive) est laissée en place.
  if (!String(knex.client.config.client).includes('sqlite')) {
    await knex.schema.alterTable('sales', t => t.dropColumn('delivered_at'));
  }
  if (await knex.schema.hasTable('role_permissions')) await knex('role_permissions').where('permission', 'like', 'sav:%').del();
};
