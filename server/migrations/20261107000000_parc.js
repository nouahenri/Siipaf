/**
 * ERP · Administration générale › Parc auto et matériel (choix du client du 22/10) : biens, affectations (employé,
 * chantier), échéances administratives, plans d'entretien, dépenses (carburant, entretien, réparations… par chantier),
 * réservations de véhicules demandées depuis Mon espace. Les services généraux gèrent (parc:write).
 */
const GRANTS = { resp_exploitation: ['parc:read', 'parc:write'], comptable: ['parc:read'] };

exports.up = async function (knex) {
  await knex.schema.createTable('assets', t => {
    t.increments('id');
    t.string('code', 20).notNullable().unique(); // VEH-0001, ENG-0001…
    t.string('kind', 16).notNullable();
    t.string('kind_other', 100);
    t.string('name', 160).notNullable(); // désignation
    t.string('brand', 80);
    t.string('model', 80);
    t.string('serial', 80); // n° de série ou de châssis
    t.string('plate', 30); // immatriculation
    t.integer('year');
    t.date('acquired_on');
    t.bigInteger('purchase_amount');
    t.integer('supplier_id').unsigned().references('suppliers.id').onDelete('SET NULL');
    t.string('meter', 2); // km | h
    t.decimal('meter_value', 12, 1);
    t.date('meter_at');
    t.string('status', 12).notNullable().defaultTo('disponible');
    t.integer('employee_id').unsigned().references('employees.id').onDelete('SET NULL'); // détenteur actuel
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL'); // chantier actuel
    t.integer('manager_id').unsigned().references('users.id').onDelete('SET NULL'); // responsable (alertes)
    t.boolean('pool').notNullable().defaultTo(false); // véhicule de service réservable
    t.text('notes');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['kind', 'status']);
  });

  await knex.schema.createTable('asset_assignments', t => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('assets.id').onDelete('CASCADE');
    t.string('kind', 10).notNullable(); // employe | chantier
    t.integer('employee_id').unsigned().references('employees.id').onDelete('SET NULL');
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.date('start_date').notNullable();
    t.date('end_date');
    t.string('condition_out', 255);
    t.string('condition_in', 255);
    t.decimal('meter_out', 12, 1);
    t.decimal('meter_in', 12, 1);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('asset_documents', t => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('assets.id').onDelete('CASCADE');
    t.string('kind', 20).notNullable();
    t.string('label', 160).notNullable();
    t.string('reference', 80); // n° de police, de PV…
    t.date('expires_on');
    t.string('file_filename', 120);
    t.string('file_name', 255);
    t.string('file_mime', 60);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('asset_maintenance_plans', t => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('assets.id').onDelete('CASCADE');
    t.string('label', 120).notNullable(); // Vidange, révision…
    t.integer('every_km');
    t.integer('every_hours');
    t.integer('every_months');
    t.date('last_date');
    t.decimal('last_meter', 12, 1);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('asset_costs', t => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('assets.id').onDelete('CASCADE');
    t.string('kind', 12).notNullable();
    t.date('date').notNullable();
    t.bigInteger('amount').notNullable();
    t.string('label', 200);
    t.decimal('liters', 10, 2);
    t.decimal('meter_value', 12, 1);
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL'); // chantier imputé
    t.integer('plan_id').unsigned().references('asset_maintenance_plans.id').onDelete('SET NULL');
    t.integer('purchase_invoice_id').unsigned().references('purchase_invoices.id').onDelete('SET NULL');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['asset_id', 'date']);
    t.index(['project_id', 'date']);
  });

  await knex.schema.createTable('asset_reservations', t => {
    t.increments('id');
    t.integer('asset_id').unsigned().references('assets.id').onDelete('SET NULL'); // choisi par les services généraux
    t.integer('requested_by').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('start_at', 16).notNullable(); // AAAA-MM-JJTHH:MM
    t.string('end_at', 16).notNullable();
    t.string('purpose', 255).notNullable();
    t.string('destination', 160);
    t.integer('passengers');
    t.string('status', 10).notNullable().defaultTo('demandee');
    t.integer('decided_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('decided_at');
    t.string('decision_note', 255);
    t.timestamps(true, true);
    t.index(['status', 'start_at']);
  });

  await knex.schema.createTable('asset_alerts', t => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('assets.id').onDelete('CASCADE');
    t.string('deadline_key', 30).notNullable();
    t.string('due', 20).notNullable(); // date ou compteur visé
    t.integer('stage').notNullable();
    t.timestamp('sent_at').defaultTo(knex.fn.now());
    t.unique(['asset_id', 'deadline_key', 'due', 'stage']);
  });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  const grant = async (role, permission) => {
    if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
  };
  for (const [role, perms] of Object.entries(GRANTS)) {
    if (await knex('role_permissions').where({ role }).first()) for (const p of perms) await grant(role, p);
  }
  // Demande de véhicule : comme les autres actions de Mon espace, pour tous les rôles qui les ont
  for (const { role } of await knex('role_permissions').where({ permission: 'self:frais' }).select('role')) await grant(role, 'self:vehicule');
};

exports.down = async function (knex) {
  for (const table of ['asset_alerts', 'asset_reservations', 'asset_costs', 'asset_maintenance_plans', 'asset_documents', 'asset_assignments', 'assets']) {
    await knex.schema.dropTableIfExists(table);
  }
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', ['parc:read', 'parc:write', 'self:vehicule']).del();
  }
};
