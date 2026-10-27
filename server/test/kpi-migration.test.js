const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createUser } = require('./helpers');

const NAME = '20261128000000_kpi_referentiels.js';
let db;

before(async () => { ({ db } = await setup()); });
after(() => db.destroy());

test('reprise : cibles du Commercial devenues objectifs mensuels des fiches, droit kpi:write, retour arrière', async () => {
  assert.ok(await db('role_permissions').where({ role: 'comptable', permission: 'kpi:write' }).first(), 'service RH');
  assert.ok(await db('role_permissions').where({ role: 'resp_exploitation', permission: 'kpi:write' }).first(), 'Direction');
  assert.equal(await db('role_permissions').where({ role: 'commercial', permission: 'kpi:write' }).first(), undefined);

  await db.migrate.down({ name: NAME });
  assert.equal(await db.schema.hasTable('hr_kpis'), false);
  assert.equal(await db.schema.hasColumn('hr_objectives', 'period'), false);

  const seller = await db('users').where({ email: await createUser(db, 'commercial', 'vendeur@test.ci') }).first();
  const orphan = await db('users').where({ email: await createUser(db, 'commercial', 'sansfiche@test.ci') }).first();
  const [eid] = await db('employees').insert({ matricule: 'T-001', user_id: seller.id, first_name: 'Awa', last_name: 'Koné', job_title: 'Commerciale', department: 'commercial', hire_date: '2024-01-01', base_salary: 0 });
  const employeeId = typeof eid === 'object' ? eid.id : eid;
  await db('hr_objectives').insert({ employee_id: employeeId, year: 2026, title: 'Ventes', metric: 'ventes', target_value: 10, weight: 1 });
  await db('sales_targets').insert([
    { user_id: seller.id, month: '2026-09', ca_fcfa: 50000000, ventes: 2, rdv: null, encaissements_fcfa: null },
    { user_id: orphan.id, month: '2026-09', ca_fcfa: 10000000 },
  ]);
  await db.migrate.up({ name: NAME });

  const kpis = await db('hr_kpis');
  assert.ok(kpis.length >= 30, 'un indicateur par calcul');
  const objs = await db('hr_objectives').where({ employee_id: employeeId }).orderBy('id');
  assert.equal(objs[0].period, 'annee', 'objectif existant : annuel');
  assert.equal(objs[0].kpi_id, kpis.find(k => k.metric === 'ventes').id, 'relié à son indicateur');
  const monthly = objs.filter(o => o.source === 'commercial');
  assert.deepEqual(monthly.map(o => [o.metric, Number(o.target_value), o.period, o.period_index]).sort(), [['ca_fcfa', 50000000, 'mois', 9], ['ventes', 2, 'mois', 9]]);
  assert.equal(monthly[0].title.endsWith('septembre 2026'), true);
  assert.equal((await db('hr_objectives').count({ n: '*' }).first()).n, 3, 'cible d’un compte sans fiche non reprise');
  assert.equal((await db('sales_targets').count({ n: '*' }).first()).n, 2, 'table conservée');
});
