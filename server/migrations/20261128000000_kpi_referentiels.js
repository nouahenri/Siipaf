/**
 * ERP · RH › KPI (demande du client du 27/10, docs/cadrage-kpi-referentiels.md) : référentiel des indicateurs, modèles
 * d'objectifs par service et par poste, objectifs collectifs des services, objectifs par mois ou trimestre en plus de
 * l'année, historique des verrouillages comptables (clôture mensuelle à temps) et droit « kpi:write » (RH + Direction).
 * Les cibles mensuelles du Commercial (sales_targets) deviennent des objectifs mensuels des fiches du personnel ; la table
 * est conservée (retour arrière) mais n'est plus lue. Une cible d'un compte sans fiche du personnel n'est pas reprise.
 */
const { OBJECTIVE_METRICS, SALES_TARGET_METRICS, MONTH_NAMES } = require('../src/lib/rh');

const MANAGERS = ['comptable', 'resp_exploitation'];

exports.up = async knex => {
  await knex.schema.createTable('hr_kpis', t => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('family', 60).notNullable();
    t.string('metric', 20).notNullable().defaultTo('manuel'); // calcul de lib/rh.js (OBJECTIVE_METRICS) ou « manuel »
    t.string('level', 12).notNullable().defaultTo('tous'); // tous, individuel, service
    t.string('description', 500);
    t.tinyint('warn_pct').unsigned().notNullable().defaultTo(50); // en dessous : alerte (orange)
    t.tinyint('ok_pct').unsigned().notNullable().defaultTo(100); // à partir de : atteint (vert)
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  const metrics = Object.entries(OBJECTIVE_METRICS).filter(([k]) => k !== 'manuel');
  await knex('hr_kpis').insert(metrics.map(([metric, m], i) => ({ name: m.label, family: m.group, metric, level: m.level === 'service' ? 'service' : 'tous', sort: (i + 1) * 10 })));

  // Modèle d'un service ou d'un poste : un seul par service, un seul par poste (contrôlé par le service)
  await knex.schema.createTable('hr_kpi_templates', t => {
    t.increments('id');
    t.string('scope', 8).notNullable(); // service, poste
    t.string('department', 20);
    t.integer('position_id').unsigned().references('hr_positions.id').onDelete('CASCADE');
    t.integer('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });
  await knex.schema.createTable('hr_kpi_template_lines', t => {
    t.increments('id');
    t.integer('template_id').unsigned().notNullable().references('hr_kpi_templates.id').onDelete('CASCADE');
    t.integer('kpi_id').unsigned().notNullable().references('hr_kpis.id').onDelete('CASCADE');
    t.string('period', 10).notNullable().defaultTo('annee'); // annee, trimestre, mois : un objectif par période
    t.bigInteger('target_value'); // cible de chaque période (vide pour un indicateur manuel)
    t.tinyint('weight').unsigned().notNullable().defaultTo(1);
    t.integer('sort').notNullable().defaultTo(0);
  });

  // Objectifs collectifs d'un service (même calcul d'atteinte que les objectifs individuels)
  await knex.schema.createTable('hr_department_objectives', t => {
    t.increments('id');
    t.string('department', 20).notNullable();
    t.integer('year').unsigned().notNullable();
    t.string('period', 10).notNullable().defaultTo('annee');
    t.tinyint('period_index').unsigned();
    t.integer('kpi_id').unsigned().references('hr_kpis.id').onDelete('SET NULL');
    t.string('metric', 20).notNullable().defaultTo('manuel');
    t.string('title', 200).notNullable();
    t.string('description', 1000);
    t.bigInteger('target_value');
    t.tinyint('weight').unsigned().notNullable().defaultTo(1);
    t.tinyint('progress').unsigned().notNullable().defaultTo(0); // suivi manuel
    t.string('status', 14).notNullable().defaultTo('en_cours');
    t.date('due_date');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['department', 'year']);
  });

  // Chaque verrouillage d'exercice est daté : « clôture du mois avant le jour J » se mesure sur cet historique
  await knex.schema.createTable('acc_lock_history', t => {
    t.increments('id');
    t.integer('fiscal_year_id').unsigned().notNullable().references('acc_fiscal_years.id').onDelete('CASCADE');
    t.date('lock_date');
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Sans clé étrangère : sous SQLite, en ajouter une reconstruit hr_objectives (refusé, la table est référencée)
  await knex.schema.alterTable('hr_objectives', t => {
    t.integer('kpi_id').unsigned();
    t.string('period', 10).notNullable().defaultTo('annee');
    t.tinyint('period_index').unsigned();
    t.integer('template_id').unsigned();
    t.string('source', 10).notNullable().defaultTo('saisie'); // saisie, modele, commercial
    t.boolean('adjusted').notNullable().defaultTo(false); // objectif d'un modèle modifié à la main : gardé si le modèle est réappliqué
  });
  const kpis = await knex('hr_kpis').select('id', 'metric', 'name');
  const kpiOf = Object.fromEntries(kpis.map(k => [k.metric, k]));
  for (const k of kpis) await knex('hr_objectives').where({ metric: k.metric }).update({ kpi_id: k.id });

  // Reprise des cibles mensuelles du Commercial › Objectifs
  let skipped = 0;
  for (const t of await knex('sales_targets')) {
    const e = await knex('employees').where({ user_id: t.user_id }).first();
    if (!e) { skipped++; continue; }
    const [year, month] = t.month.split('-').map(Number);
    const due = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    for (const metric of SALES_TARGET_METRICS) {
      if (t[metric] == null) continue;
      if (await knex('hr_objectives').where({ employee_id: e.id, year, period: 'mois', period_index: month, metric }).first()) continue;
      await knex('hr_objectives').insert({
        employee_id: e.id, year, period: 'mois', period_index: month, kpi_id: kpiOf[metric].id, metric, title: `${kpiOf[metric].name} — ${MONTH_NAMES[month - 1]} ${year}`,
        target_value: t[metric], weight: 1, due_date: due, source: 'commercial', adjusted: true, created_by: t.set_by || null,
      });
    }
  }
  if (skipped) console.log(`[kpi] ${skipped} cible(s) commerciale(s) non reprise(s) : compte sans fiche du personnel (table sales_targets conservée).`);

  // Droit « kpi:write » : RH (comptable) et Direction (responsable des exploitations, comptes de la Direction générale)
  const dgRoles = await knex('role_permissions').where({ permission: 'demandes:dg' }).pluck('role');
  for (const role of [...new Set([...MANAGERS, ...dgRoles])]) {
    if ((await knex('roles').where({ id: role }).first()) && !(await knex('role_permissions').where({ role, permission: 'kpi:write' }).first())) {
      await knex('role_permissions').insert({ role, permission: 'kpi:write' });
    }
  }
  if (await knex.schema.hasTable('user_permissions')) {
    for (const p of await knex('user_permissions').where({ permission: 'demandes:dg', granted: true })) {
      if (!(await knex('user_permissions').where({ user_id: p.user_id, permission: 'kpi:write' }).first())) await knex('user_permissions').insert({ user_id: p.user_id, permission: 'kpi:write', granted: true });
    }
  }
};

exports.down = async knex => {
  await knex('role_permissions').where({ permission: 'kpi:write' }).del();
  if (await knex.schema.hasTable('user_permissions')) await knex('user_permissions').where({ permission: 'kpi:write' }).del();
  // Les cibles commerciales reprises restent dans sales_targets
  await knex('hr_objectives').where({ source: 'commercial' }).del();
  await knex('hr_objectives').whereNot({ period: 'annee' }).del();
  await knex.schema.alterTable('hr_objectives', t => {
    for (const c of ['kpi_id', 'period', 'period_index', 'template_id', 'source', 'adjusted']) t.dropColumn(c);
  });
  for (const table of ['acc_lock_history', 'hr_department_objectives', 'hr_kpi_template_lines', 'hr_kpi_templates', 'hr_kpis']) await knex.schema.dropTableIfExists(table);
};
