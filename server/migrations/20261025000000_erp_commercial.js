/**
 * ERP · Commercial : parc immobilier (bâtiments, étages, caractéristiques des lots), CRM (activités et
 * historique des échanges, motif de perte, montant attendu), objectifs des commerciaux, appels de fonds VEFA.
 * Règle SQLite : aucune clé étrangère ajoutée par alterTable (sinon reconstruction de table et cascades).
 */
const { PERMISSIONS } = require('../src/lib/domain');

const NEW_PERMISSIONS = ['commercial:read', 'targets:write', 'property:write', 'vefa:write'];

exports.up = async function (knex) {
  await knex.schema.alterTable('leads', t => {
    t.bigInteger('expected_revenue_fcfa'); // budget / montant attendu de la vente
    t.tinyint('priority').unsigned().notNullable().defaultTo(0); // 0 à 3 étoiles
    t.string('kind', 20); // acquéreur, investisseur, entreprise
    t.string('lost_reason', 30);
    t.string('lost_note', 255);
    t.timestamp('lost_at');
  });

  await knex.schema.alterTable('lots', t => {
    t.string('lot_type', 20); // parcelle, villa, appartement…
    t.integer('building_id').unsigned(); // bâtiment (sans clé étrangère : règle SQLite ci-dessus)
    t.integer('floor'); // 0 = rez-de-chaussée
    t.tinyint('rooms').unsigned(); // nombre de pièces
    t.string('title_number', 80); // titre foncier / ACD
    t.integer('tantiemes').unsigned(); // quote-part des parties communes (copropriété)
    t.index(['building_id']);
  });

  await knex.schema.alterTable('sales', t => {
    t.boolean('vefa').notNullable().defaultTo(false); // paiement par appels de fonds selon l'avancement
  });

  await knex.schema.createTable('buildings', t => {
    t.increments('id');
    t.integer('project_id').unsigned().notNullable().references('projects.id').onDelete('CASCADE');
    t.string('ilot', 40);
    t.string('code', 40).notNullable(); // ex. « Bât. A »
    t.string('name', 160);
    t.string('kind', 20).notNullable().defaultTo('immeuble');
    t.integer('floors').unsigned().notNullable().defaultTo(0); // étages au-dessus du rez-de-chaussée
    t.string('notes', 500);
    t.timestamps(true, true);
    t.unique(['project_id', 'code']);
  });

  // Activités (planifiées : done_at nul) et historique des échanges avec un prospect
  await knex.schema.createTable('lead_activities', t => {
    t.increments('id');
    t.integer('lead_id').unsigned().notNullable().references('leads.id').onDelete('CASCADE');
    t.string('kind', 20).notNullable(); // appel, whatsapp, email, visite, reunion, relance, document, tache, note, etape, systeme
    t.string('summary', 200);
    t.text('note');
    t.timestamp('due_at');
    t.timestamp('done_at');
    t.text('outcome');
    t.integer('assigned_to').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['lead_id']);
    t.index(['assigned_to', 'done_at']);
  });

  await knex.schema.createTable('sales_targets', t => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('month', 7).notNullable(); // AAAA-MM
    t.bigInteger('ca_fcfa');
    t.integer('ventes').unsigned();
    t.integer('rdv').unsigned();
    t.bigInteger('encaissements_fcfa');
    t.integer('set_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['user_id', 'month']);
  });

  // Plan d'appels de fonds d'un programme (étapes du chantier et pourcentages)
  await knex.schema.createTable('vefa_plans', t => {
    t.increments('id');
    t.integer('project_id').unsigned().notNullable().unique().references('projects.id').onDelete('CASCADE');
    t.json('milestones').notNullable();
    t.integer('due_days').unsigned().notNullable().defaultTo(15);
    t.integer('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  // Appels de fonds d'un dossier VEFA : « à venir » tant que l'étape n'est pas constatée, puis « appelé »
  await knex.schema.createTable('fund_calls', t => {
    t.increments('id');
    t.integer('sale_id').unsigned().notNullable().references('sales.id').onDelete('CASCADE');
    t.integer('seq').unsigned().notNullable();
    t.string('stage', 20).notNullable();
    t.string('label', 160).notNullable();
    t.decimal('pct', 5, 2).notNullable();
    t.bigInteger('amount_fcfa').notNullable();
    t.string('status', 12).notNullable().defaultTo('a_venir');
    t.date('called_at');
    t.date('due_date');
    t.integer('site_update_id').unsigned(); // point de chantier qui a déclenché l'appel
    t.integer('called_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['sale_id', 'seq']);
    t.index(['status', 'due_date']);
  });

  if (await knex.schema.hasTable('role_permissions')) {
    const existing = await knex('roles').select('id').catch(() => null);
    const roles = new Set(existing ? existing.map(r => r.id) : Object.keys(PERMISSIONS));
    const rows = Object.entries(PERMISSIONS)
      .filter(([role]) => role !== 'super_admin' && roles.has(role))
      .flatMap(([role, perms]) => perms.filter(p => NEW_PERMISSIONS.includes(p)).map(permission => ({ role, permission })));
    for (const row of rows) {
      if (!(await knex('role_permissions').where(row).first())) await knex('role_permissions').insert(row);
    }
  }
};

exports.down = async function (knex) {
  for (const table of ['fund_calls', 'vefa_plans', 'sales_targets', 'lead_activities', 'buildings']) {
    await knex.schema.dropTableIfExists(table);
  }
  // Sous SQLite, retirer des colonnes reconstruit leads / lots / sales et supprimerait en cascade
  // dossiers, versements, documents : les colonnes (inoffensives) restent en place.
  if (!String(knex.client.config.client).includes('sqlite')) {
    await knex.schema.alterTable('leads', t => {
      for (const c of ['expected_revenue_fcfa', 'priority', 'kind', 'lost_reason', 'lost_note', 'lost_at']) t.dropColumn(c);
    });
    await knex.schema.alterTable('lots', t => {
      t.dropIndex(['building_id']);
      for (const c of ['lot_type', 'building_id', 'floor', 'rooms', 'title_number', 'tantiemes']) t.dropColumn(c);
    });
    await knex.schema.alterTable('sales', t => t.dropColumn('vefa'));
  }
  if (await knex.schema.hasTable('role_permissions')) await knex('role_permissions').whereIn('permission', NEW_PERMISSIONS).del();
};
