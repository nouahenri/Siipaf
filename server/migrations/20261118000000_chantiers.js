/**
 * ERP · Chantiers (choix du client du 24/10, docs/cadrage-chantiers.md) : plusieurs chantiers par programme, chacun
 * avec sa zone, son conducteur de travaux, ses phases (Gantt), ses tâches (Kanban) et son budget par poste.
 */
const GRANTS = {
  conducteur_travaux: ['chantiers:read', 'chantiers:write'],
  resp_exploitation: ['chantiers:read', 'chantiers:write'],
  comptable: ['chantiers:read'],
};

exports.up = async function (knex) {
  await knex.schema.createTable('worksites', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // CH-2026-0001
    t.integer('project_id').unsigned().notNullable().references('projects.id').onDelete('RESTRICT');
    t.string('name', 160).notNullable();
    t.string('zone_kind', 12).notNullable().defaultTo('programme'); // programme, ilots, batiments, lots
    t.json('zone'); // noms d'îlots, ou identifiants de bâtiments ou de lots
    t.integer('manager_id').unsigned().references('users.id').onDelete('SET NULL'); // conducteur de travaux
    t.string('status', 12).notNullable().defaultTo('preparation');
    t.date('planned_start');
    t.date('planned_end');
    t.date('actual_start');
    t.date('actual_end');
    t.text('description');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['project_id', 'status']);
  });

  await knex.schema.createTable('worksite_phases', t => {
    t.increments('id');
    t.integer('worksite_id').unsigned().notNullable().references('worksites.id').onDelete('CASCADE');
    t.string('stage', 20); // étape du journal de chantier (SITE_STAGES), vide pour une phase libre
    t.string('label', 160).notNullable();
    t.date('planned_start');
    t.date('planned_end');
    t.date('actual_start');
    t.date('actual_end');
    t.integer('progress_pct').unsigned().notNullable().defaultTo(0);
    t.integer('depends_on_id').unsigned(); // phase précédente du même chantier (sans clé étrangère, règle SQLite)
    t.integer('sort').notNullable().defaultTo(0);
    t.text('notes');
    t.timestamps(true, true);
    t.index(['worksite_id', 'sort']);
  });

  await knex.schema.createTable('worksite_tasks', t => {
    t.increments('id');
    t.integer('worksite_id').unsigned().notNullable().references('worksites.id').onDelete('CASCADE');
    t.integer('phase_id').unsigned().references('worksite_phases.id').onDelete('SET NULL');
    t.string('title', 200).notNullable();
    t.text('description');
    t.string('status', 10).notNullable().defaultTo('a_faire');
    t.boolean('milestone').notNullable().defaultTo(false); // jalon
    t.integer('employee_id').unsigned().references('employees.id').onDelete('SET NULL');
    t.integer('supplier_id').unsigned().references('suppliers.id').onDelete('SET NULL'); // sous-traitant
    t.string('team', 120); // équipe ou intervenant hors fichier
    t.date('start_on');
    t.date('due_on');
    t.date('done_on');
    t.integer('sort').notNullable().defaultTo(0);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['worksite_id', 'status']);
  });

  await knex.schema.createTable('worksite_budget_lines', t => {
    t.increments('id');
    t.integer('worksite_id').unsigned().notNullable().references('worksites.id').onDelete('CASCADE');
    t.string('category', 20).notNullable();
    t.string('label', 160).notNullable();
    t.integer('phase_id').unsigned().references('worksite_phases.id').onDelete('SET NULL');
    t.bigInteger('amount_fcfa').notNullable();
    t.text('notes');
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  for (const [role, perms] of Object.entries(GRANTS)) {
    if (!(await knex('role_permissions').where({ role }).first())) continue;
    for (const permission of perms) {
      if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
    }
  }
};

exports.down = async function (knex) {
  for (const table of ['worksite_budget_lines', 'worksite_tasks', 'worksite_phases', 'worksites']) await knex.schema.dropTableIfExists(table);
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', ['chantiers:read', 'chantiers:write', 'chantiers:direction']).del();
  }
};
