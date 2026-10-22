const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const { maintenanceDue, fuelConsumption, reservationsOverlap } = require('../src/lib/domain');
const parc = require('../src/services/parc');

let db, app, resp, comptable, commercial, project, employee, ids;
const URL = '/api/admin/erp/parc';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  ({ db, app } = await setup());
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').orderBy('id').first();
  const [e] = await db('employees').insert({ matricule: 'E-PARC', last_name: 'Koffi', first_name: 'Jean', hire_date: '2024-01-01', department: 'chantier', job_title: 'Conducteur d’engins', base_salary: 300000, user_id: ids.commercial });
  employee = typeof e === 'object' ? e.id : e;
});
after(() => db.destroy());

test('règles : entretien au compteur ou à la date, consommation, chevauchement de réservations', () => {
  const car = { meter: 'km', meter_value: 49700 };
  const plan = { every_km: 10000, every_months: 6, last_meter: 40000, last_date: '2026-06-01' };
  assert.deepEqual(maintenanceDue(plan, car, '2026-10-01'), { next_date: '2026-12-01', next_meter: 50000, state: 'bientot' }, 'à 300 km');
  assert.equal(maintenanceDue(plan, { ...car, meter_value: 50100 }, '2026-10-01').state, 'du');
  assert.equal(maintenanceDue(plan, { ...car, meter_value: 42000 }, '2026-12-01').state, 'du', 'la date d’abord');
  assert.equal(maintenanceDue(plan, { ...car, meter_value: 42000 }, '2026-09-01').state, 'ok');
  const c = fuelConsumption([{ meter_value: 1000, liters: 40 }, { meter_value: 1500, liters: 40 }, { meter_value: 2000, liters: 35 }], 'km');
  assert.deepEqual(c, { value: 7.5, unit: 'L/100 km', liters: 75, distance: 1000 });
  assert.equal(fuelConsumption([{ meter_value: 1000, liters: 40 }], 'km'), null);
  assert.equal(fuelConsumption([{ meter_value: 100, liters: 50 }, { meter_value: 110, liters: 60 }], 'h').unit, 'L/h');
  assert.ok(reservationsOverlap({ start_at: '2026-11-02T08:00', end_at: '2026-11-02T12:00' }, { start_at: '2026-11-02T11:00', end_at: '2026-11-02T14:00' }));
  assert.ok(!reservationsOverlap({ start_at: '2026-11-02T08:00', end_at: '2026-11-02T12:00' }, { start_at: '2026-11-02T12:00', end_at: '2026-11-02T14:00' }));
});

test('droits et codes : les services généraux gèrent, le comptable consulte, les autres non', async () => {
  const body = { kind: 'vehicule', name: 'Toyota Hilux', plate: '1234 AB 01', meter_value: 49700, pool: true };
  assert.equal((await comptable.post(`${URL}/assets`).send(body)).status, 403);
  assert.equal((await commercial.get(`${URL}/assets`)).status, 403);
  let res = await resp.post(`${URL}/assets`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.code, 'VEH-0001');
  assert.equal(res.body.meter, 'km');
  res = await resp.post(`${URL}/assets`).send({ kind: 'engin', name: 'Pelleteuse CAT 320', meter_value: 1200 });
  assert.equal(res.body.code, 'ENG-0001');
  assert.equal(res.body.meter, 'h');
  assert.equal((await resp.post(`${URL}/assets`).send({ kind: 'autre', name: 'Container' })).status, 400, 'nature à préciser');
  assert.equal((await comptable.get(`${URL}/assets`)).body.length, 2);
});

test('affectation : employé puis chantier (remise, retour), dépenses imputées au chantier, compteur et entretien', async () => {
  const engin = await db('assets').where({ code: 'ENG-0001' }).first();
  let res = await resp.post(`${URL}/assets/${engin.id}/assign`).send({ kind: 'chantier', project_id: project.id, date: day(-20), condition: 'Bon état', meter: 1200 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'affecte');
  assert.equal(res.body.holder, `Chantier ${project.name}`);
  res = await resp.post(`${URL}/assets/${engin.id}/plans`).send({ label: 'Révision 250 h', every_hours: 250, last_meter: 1200 });
  const plan = res.body.plans[0];
  assert.equal(plan.next_meter, 1450);
  // Plein sur le chantier : imputé d'office, compteur relevé
  await resp.post(`${URL}/assets/${engin.id}/costs`).send({ kind: 'carburant', date: day(-10), amount: 150000, liters: 200, meter_value: 1300 });
  res = await resp.post(`${URL}/assets/${engin.id}/costs`).send({ kind: 'carburant', date: day(-2), amount: 120000, liters: 160, meter_value: 1440 });
  assert.equal(res.body.meter_value, 1440);
  assert.equal(res.body.costs[0].project_id, project.id);
  assert.equal(res.body.consumption.unit, 'L/h');
  assert.equal(res.body.plans[0].state, 'bientot');
  assert.equal((await resp.post(`${URL}/assets/${engin.id}/costs`).send({ kind: 'carburant', date: day(0), amount: 1000 })).status, 400, 'litres obligatoires');
  // L'entretien fait remet le plan à zéro
  res = await resp.post(`${URL}/assets/${engin.id}/costs`).send({ kind: 'entretien', date: day(-1), amount: 300000, plan_id: plan.id, meter_value: 1445 });
  assert.equal(res.body.plans[0].next_meter, 1695);
  // Retour au dépôt puis remise à un employé
  res = await resp.post(`${URL}/assets/${engin.id}/release`).send({ date: day(0), condition: 'RAS' });
  assert.equal(res.body.status, 'disponible');
  res = await resp.post(`${URL}/assets/${engin.id}/assign`).send({ kind: 'employe', employee_id: employee, date: day(0) });
  assert.equal(res.body.employee_name, 'Koffi Jean');
  assert.equal(res.body.assignments.length, 2);
  // Coût par chantier
  const report = (await comptable.get(`${URL}/couts`)).body;
  assert.equal(report.by_project.find(p => p.key === project.id).total, 570000);
  assert.equal((await resp.post(`${URL}/assets/${engin.id}/status`).send({ status: 'reforme' })).status, 409, 'restituer avant de réformer');
});

test('réservation : l’employé demande, les services généraux accordent un véhicule libre ; chevauchement refusé', async () => {
  const car = await db('assets').where({ code: 'VEH-0001' }).first();
  const slot = { start_at: `${day(3)}T08:00`, end_at: `${day(3)}T17:00`, purpose: 'Visite client à Bingerville' };
  let res = await commercial.post(`${URL}/reservations`).send(slot);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const first = res.body.id;
  res = await comptable.post(`${URL}/reservations`).send({ ...slot, start_at: `${day(3)}T15:00`, end_at: `${day(3)}T18:00`, purpose: 'Banque' });
  const second = res.body.id;
  assert.equal((await commercial.get(`${URL}/reservations`)).body.length, 1, 'chacun voit ses demandes');
  assert.equal((await commercial.post(`${URL}/reservations/${first}/decide`).send({ status: 'accordee', asset_id: car.id })).status, 403);
  sent.length = 0;
  res = await resp.post(`${URL}/reservations/${first}/decide`).send({ status: 'accordee', asset_id: car.id });
  assert.equal(res.body.status, 'accordee');
  assert.ok(sent.some(m => m.to === 'commercial@test.ci' && /accordé/.test(m.subject)));
  assert.equal((await resp.post(`${URL}/reservations/${second}/decide`).send({ status: 'accordee', asset_id: car.id })).status, 409, 'véhicule déjà pris');
  assert.equal((await resp.get(`${URL}/vehicules-libres?start_at=${day(3)}T15:00&end_at=${day(3)}T18:00`)).body.length, 0);
  // Un véhicule de fonction (remis à un employé) n'est pas proposé
  await db('assets').where({ id: car.id }).update({ employee_id: employee });
  assert.equal((await resp.get(`${URL}/vehicules-libres?start_at=${day(9)}T08:00&end_at=${day(9)}T10:00`)).body.length, 0);
  await db('assets').where({ id: car.id }).update({ employee_id: null });
  assert.equal((await resp.post(`${URL}/reservations/${second}/decide`).send({ status: 'refusee' })).status, 400, 'motif du refus');
  assert.equal((await resp.post(`${URL}/reservations/${second}/decide`).send({ status: 'refusee', note: 'Aucun véhicule libre' })).body.status, 'refusee');
  assert.equal((await commercial.post(`${URL}/reservations`).send({ ...slot, start_at: `${day(-1)}T08:00`, end_at: `${day(-1)}T09:00` })).status, 400, 'pas dans le passé');
});

test('alertes : échéance administrative 30 puis 7 jours avant, entretien atteint au compteur, une seule fois', async () => {
  const car = await db('assets').where({ code: 'VEH-0001' }).first();
  await db('assets').where({ id: car.id }).update({ manager_id: ids.comptable });
  await resp.post(`${URL}/assets/${car.id}/documents`).send({ kind: 'visite_technique', label: 'Visite technique', expires_on: day(20) });
  await resp.post(`${URL}/assets/${car.id}/plans`).send({ label: 'Vidange', every_km: 10000, last_meter: 39000 });
  sent.length = 0;
  await parc.tick(db, day(0));
  const subjects = sent.filter(m => m.subject.includes('VEH-0001'));
  assert.ok(subjects.some(m => /Visite technique/.test(m.subject) && m.to === 'comptable@test.ci'));
  assert.ok(subjects.some(m => /Vidange/.test(m.subject) && m.to === 'resp_exploitation@test.ci'), 'compteur atteint (49 700 ≥ 49 000)');
  sent.length = 0;
  await parc.tick(db, day(1));
  assert.equal(sent.filter(m => m.subject.includes('VEH-0001')).length, 0, 'pas deux fois');
  await parc.tick(db, day(15));
  assert.ok(sent.some(m => /Visite technique/.test(m.subject)), 'palier de 7 jours');
  const due = (await comptable.get(`${URL}/echeances?days=30`)).body;
  assert.ok(due.some(d => d.kind === 'document' && d.asset_id === car.id));
  assert.ok(due.some(d => d.kind === 'entretien' && d.state === 'du'));
});
