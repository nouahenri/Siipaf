/**
 * ERP · RH : postes gérés en base (RH › Réglages, choix du client du 23/10) et changements de poste datés.
 * Les postes sont repris des fiches existantes (un par intitulé, rattaché au service le plus fréquent) ; chaque fiche
 * est reliée à son poste. L'intitulé reste recopié sur la fiche (`job_title`) pour la paie, les états et l'historique.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('hr_positions', t => {
    t.increments('id');
    t.string('title', 120).notNullable().unique();
    t.string('department', 20).notNullable().defaultTo('administratif');
    t.string('category', 40); // catégorie professionnelle habituelle
    t.string('default_role', 40); // rôle du compte proposé au changement de poste
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
  // Sans clé étrangère : sous SQLite, en ajouter une reconstruit la table employees (refusé dès qu'elle est référencée).
  // Un poste ne se supprime pas (il s'archive), le lien reste donc valable.
  await knex.schema.alterTable('employees', t => {
    t.integer('position_id').unsigned();
  });
  await knex.schema.createTable('hr_position_changes', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.integer('position_id').unsigned().references('hr_positions.id').onDelete('SET NULL');
    t.string('job_title', 120).notNullable();
    t.string('department', 20).notNullable();
    t.string('category', 40);
    t.bigInteger('base_salary');
    t.boolean('change_manager').notNullable().defaultTo(false);
    t.integer('manager_id').unsigned().references('employees.id').onDelete('SET NULL');
    t.text('team_ids'); // JSON : employés rattachés à lui comme responsable direct
    t.string('role', 40); // nouveau rôle du compte
    t.date('effective_date').notNullable();
    t.string('reason', 20).notNullable();
    t.string('note', 500);
    t.string('status', 10).notNullable().defaultTo('planifie'); // planifie | applique | annule
    t.timestamp('applied_at');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['status', 'effective_date']);
  });

  // Reprise : un poste par intitulé existant, au service le plus fréquent
  const rows = await knex('employees').select('id', 'job_title', 'department');
  const byTitle = new Map();
  for (const r of rows) {
    const title = String(r.job_title || '').trim();
    if (!title) continue;
    const key = title.toLowerCase();
    const g = byTitle.get(key) || { title, deps: {}, ids: [] };
    g.deps[r.department] = (g.deps[r.department] || 0) + 1;
    g.ids.push(r.id);
    byTitle.set(key, g);
  }
  for (const g of byTitle.values()) {
    const department = Object.entries(g.deps).sort((a, b) => b[1] - a[1])[0][0];
    const [id] = await knex('hr_positions').insert({ title: g.title.slice(0, 120), department });
    await knex('employees').whereIn('id', g.ids).update({ position_id: typeof id === 'object' ? id.id : id });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('hr_position_changes');
  await knex.schema.alterTable('employees', t => { t.dropColumn('position_id'); });
  await knex.schema.dropTableIfExists('hr_positions');
};
