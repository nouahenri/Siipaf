/**
 * ERP · RH & paie : registre des employés (relié aux comptes du dashboard quand l'employé en a un),
 * paies mensuelles et bulletins. La validation d'une paie passe son écriture au journal PA.
 */
const { PERMISSIONS } = require('../src/lib/domain');

const NEW_PERMISSIONS = ['rh:read', 'paie:read', 'paie:write'];
const NEW_ACCOUNTS = [
  ['6413', 'Taxes sur appointements et salaires'], ['6414', 'Taxe d’apprentissage'], ['6415', 'Formation professionnelle continue'],
  ['4472', 'Impôts et taxes sur salaires à la charge de l’employeur'],
];

exports.up = async function (knex) {
  await knex.schema.createTable('employees', t => {
    t.increments('id');
    t.string('matricule', 20).notNullable().unique(); // EMP-0001
    t.integer('user_id').unsigned().unique().references('users.id').onDelete('SET NULL'); // compte du dashboard
    t.string('last_name', 80).notNullable();
    t.string('first_name', 80).notNullable();
    t.string('gender', 1); // F, M
    t.date('birth_date');
    t.string('nationality', 60).defaultTo('Ivoirienne');
    t.boolean('expatriate').notNullable().defaultTo(false);
    t.string('phone', 40);
    t.string('email', 190);
    t.string('address', 255);
    t.string('id_number', 60); // CNI, passeport
    t.string('cnps_number', 40);
    t.string('marital_status', 12).notNullable().defaultTo('celibataire');
    t.tinyint('children').unsigned().notNullable().defaultTo(0);
    t.decimal('tax_parts', 3, 1); // nul : calculé (1 + couple + ½ par enfant)
    t.string('job_title', 120).notNullable();
    t.string('department', 20).notNullable().defaultTo('administratif');
    t.string('category', 40); // catégorie professionnelle
    t.string('contract_type', 12).notNullable().defaultTo('cdi');
    t.date('hire_date').notNullable();
    t.date('end_date');
    t.bigInteger('base_salary').notNullable();
    t.bigInteger('housing_allowance').notNullable().defaultTo(0);
    t.bigInteger('transport_allowance').notNullable().defaultTo(0);
    t.bigInteger('other_allowance').notNullable().defaultTo(0);
    t.decimal('accident_rate', 4, 2); // taux AT propre au poste (chantier), sinon celui du barème
    t.string('pay_method', 14).notNullable().defaultTo('virement');
    t.string('bank_account', 80);
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL'); // affectation (analytique)
    t.boolean('active').notNullable().defaultTo(true);
    t.string('notes', 500);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('payroll_runs', t => {
    t.increments('id');
    t.string('period', 7).notNullable().unique(); // AAAA-MM
    t.string('status', 10).notNullable().defaultTo('brouillon'); // brouillon, valide, paye
    t.integer('entry_id').unsigned().references('acc_entries.id').onDelete('SET NULL');
    t.date('paid_at');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('validated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('validated_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('payslips', t => {
    t.increments('id');
    t.integer('run_id').unsigned().notNullable().references('payroll_runs.id').onDelete('CASCADE');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('RESTRICT');
    t.json('inputs'); // éléments variables : jours, heures sup, primes, non imposable, avance
    t.json('result'); // détail du calcul (figé à la validation)
    t.json('employee'); // fiche de l'employé au moment de la paie
    t.bigInteger('gross').notNullable().defaultTo(0);
    t.bigInteger('net').notNullable().defaultTo(0);
    t.bigInteger('employer_cost').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['run_id', 'employee_id']);
  });

  if (await knex.schema.hasTable('acc_accounts')) {
    for (const [code, label] of NEW_ACCOUNTS) {
      if (!(await knex('acc_accounts').where({ code }).first())) await knex('acc_accounts').insert({ code, label, class: Number(code[0]), system: true });
    }
    await knex('acc_accounts').whereIn('code', ['421', '422']).update({ partner_kind: 'employe' });
  }

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
  await knex.schema.dropTableIfExists('payslips');
  await knex.schema.dropTableIfExists('payroll_runs');
  await knex.schema.dropTableIfExists('employees');
  await knex('app_settings').where({ key: 'paie' }).del().catch(() => {});
  if (await knex.schema.hasTable('role_permissions')) await knex('role_permissions').whereIn('permission', NEW_PERMISSIONS).del();
};
