/**
 * ERP · Administration générale › Documents internes et Demandes internes (choix du client du 22/10).
 * Documents : notes de service, procédures (versions), PV de réunion (actions suivies), modèles ; diffusion à tous,
 * par service ou à des personnes ; accusé « lu et compris » avec délai. Demandes : responsable direct → DG au-delà
 * d'un plafond → services généraux ; un achat traité devient une facture d'achat en brouillon.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('internal_docs', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // NS-2026-0001…
    t.string('kind', 12).notNullable();
    t.string('title', 200).notNullable();
    t.text('body'); // texte de la note, ordre du jour et décisions d'un PV
    t.integer('version').notNullable().defaultTo(1);
    t.string('status', 10).notNullable().defaultTo('brouillon');
    t.string('audience', 10).notNullable().defaultTo('tous');
    t.text('audience_departments'); // JSON
    t.text('audience_users'); // JSON (personnes nommées, participants d'un PV)
    t.boolean('ack_required').notNullable().defaultTo(true);
    t.date('ack_deadline');
    t.date('meeting_date'); // PV
    t.string('department', 20); // service émetteur (chef de service)
    t.string('file_filename', 120);
    t.string('file_name', 255);
    t.string('file_mime', 120);
    t.integer('author_id').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('published_at');
    t.timestamps(true, true);
    t.index(['status', 'kind']);
  });

  // Historique des versions publiées (une nouvelle version redemande la lecture)
  await knex.schema.createTable('internal_doc_versions', t => {
    t.increments('id');
    t.integer('doc_id').unsigned().notNullable().references('internal_docs.id').onDelete('CASCADE');
    t.integer('version').notNullable();
    t.string('change_note', 255);
    t.text('body');
    t.string('file_filename', 120);
    t.string('file_name', 255);
    t.string('file_mime', 120);
    t.integer('published_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('published_at').defaultTo(knex.fn.now());
    t.unique(['doc_id', 'version']);
  });

  // Destinataires figés à la publication (et à chaque nouvelle version)
  await knex.schema.createTable('internal_doc_recipients', t => {
    t.integer('doc_id').unsigned().notNullable().references('internal_docs.id').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.primary(['doc_id', 'user_id']);
  });

  await knex.schema.createTable('internal_doc_reads', t => {
    t.increments('id');
    t.integer('doc_id').unsigned().notNullable().references('internal_docs.id').onDelete('CASCADE');
    t.integer('version').notNullable();
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.timestamp('read_at').defaultTo(knex.fn.now());
    t.unique(['doc_id', 'version', 'user_id']);
  });

  await knex.schema.createTable('internal_doc_actions', t => {
    t.increments('id');
    t.integer('doc_id').unsigned().notNullable().references('internal_docs.id').onDelete('CASCADE');
    t.string('label', 255).notNullable();
    t.integer('owner_id').unsigned().references('users.id').onDelete('SET NULL');
    t.date('due_date');
    t.string('status', 8).notNullable().defaultTo('a_faire');
    t.string('done_note', 255);
    t.timestamp('done_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('internal_requests', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // DI-2026-0001
    t.string('kind', 12).notNullable();
    t.string('kind_other', 100);
    t.string('title', 200).notNullable();
    t.text('details');
    t.string('quantity', 60);
    t.bigInteger('estimated_amount');
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL'); // chantier concerné
    t.string('location', 120); // lieu (bureau, dépôt…)
    t.date('needed_by');
    t.string('urgency', 8).notNullable().defaultTo('normale'); // normale | urgente
    t.string('status', 20).notNullable();
    t.integer('requested_by').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('manager_user_id').unsigned().references('users.id').onDelete('SET NULL'); // responsable direct à la demande
    t.integer('manager_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('manager_at');
    t.integer('dg_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('dg_at');
    t.integer('handled_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('handled_at');
    t.timestamp('closed_at');
    t.string('decision_note', 500); // motif du refus ou réponse des services généraux
    t.bigInteger('final_amount');
    t.integer('supplier_id').unsigned().references('suppliers.id').onDelete('SET NULL');
    t.integer('purchase_invoice_id').unsigned().references('purchase_invoices.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['requested_by']);
  });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  const grant = async (role, permission) => {
    if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
  };
  if (await knex('role_permissions').where({ role: 'resp_exploitation' }).first()) {
    await grant('resp_exploitation', 'docs:publish');
    await grant('resp_exploitation', 'demandes:handle');
  }
  for (const { role } of await knex('role_permissions').where({ permission: 'self:frais' }).select('role')) await grant(role, 'self:demandes');
};

exports.down = async function (knex) {
  for (const table of ['internal_requests', 'internal_doc_actions', 'internal_doc_reads', 'internal_doc_recipients', 'internal_doc_versions', 'internal_docs']) {
    await knex.schema.dropTableIfExists(table);
  }
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', ['docs:publish', 'demandes:handle', 'demandes:dg', 'self:demandes']).del();
  }
};
