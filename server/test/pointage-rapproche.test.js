const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

// Pointages successifs (demande du client du 10/11) : un 2e pointage peu après l'arrivée demande confirmation du départ ;
// la correction peut retirer un départ pointé par erreur (le pointage redevient « en cours »)
let db, app, admin, awaAgent, koffiAgent, users, awa;
const R = '/api/admin/erp/rh';

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  awaAgent = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  koffiAgent = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  users = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  awa = (await admin.post('/api/admin/erp/paie/employees').send({ matricule: 'T-51', last_name: 'Koné', first_name: 'Awa', gender: 'F', job_title: 'Commerciale', department: 'commercial', hire_date: '2024-01-01', base_salary: 300000, user_id: users.commercial })).body;
  await awaAgent.put(`${R}/me/pin`).send({ pin: '4821' });
});
after(() => db.destroy());

test('2e pointage moins de 30 min après l’arrivée : rien n’est enregistré sans confirmation du départ', async () => {
  const inRes = await awaAgent.post(`${R}/me/attendance`).send({});
  assert.equal(inRes.body.action, 'arrivee');
  let res = await awaAgent.post(`${R}/me/attendance`).send({});
  assert.equal(res.body.action, 'confirmer_depart', 'l’employé est averti : arrivée déjà pointée');
  assert.equal(res.body.attendance.id, inRes.body.attendance.id);
  assert.equal(res.body.minutes, 0);
  assert.equal((await db('hr_attendances').where({ id: inRes.body.attendance.id }).first()).check_out, null, 'rien n’est enregistré');
  // À la borne : même avertissement, puis départ confirmé
  res = await koffiAgent.post(`${R}/attendance/kiosk`).send({ matricule: awa.matricule, pin: '4821' });
  assert.equal(res.body.action, 'confirmer_depart');
  assert.equal(res.body.employee.name, 'Koné Awa');
  res = await koffiAgent.post(`${R}/attendance/kiosk`).send({ matricule: awa.matricule, pin: '4821', confirm: true });
  assert.equal(res.body.action, 'depart');
});

test('au-delà du délai, ou délai à 0 : le départ est enregistré directement', async () => {
  await db('hr_attendances').insert({ employee_id: awa.id, check_in: new Date(Date.now() - 45 * 60000), source: 'web' });
  assert.equal((await awaAgent.post(`${R}/me/attendance`).send({})).body.action, 'depart', '45 min > 30 min');
  assert.equal((await admin.put(`${R}/settings`).send({ double_pointage_minutes: 0 })).status, 200);
  assert.equal((await awaAgent.post(`${R}/me/attendance`).send({})).body.action, 'arrivee');
  assert.equal((await awaAgent.post(`${R}/me/attendance`).send({})).body.action, 'depart', '0 = jamais de confirmation');
  await admin.put(`${R}/settings`).send({ double_pointage_minutes: 30 });
});

test('correction : retirer un départ pointé par erreur, le pointage redevient « en cours »', async () => {
  const last = await db('hr_attendances').where({ employee_id: awa.id }).orderBy('check_in', 'desc').first();
  assert.ok(last.check_out);
  const res = await admin.patch(`${R}/attendance/${last.id}`).send({ check_out: null, note: 'Départ pointé par erreur' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.check_out, null);
  assert.equal(res.body.out_geo_status, null);
  assert.equal((await awaAgent.get(`${R}/me/attendance`)).body.open.id, last.id, 'Mon espace : arrivée en cours');

  // Un pointage plus récent existe : message clair (supprimer d'abord le doublon)
  const older = await db('hr_attendances').where({ employee_id: awa.id }).whereNotNull('check_out').orderBy('check_in', 'asc').first();
  const refused = await admin.patch(`${R}/attendance/${older.id}`).send({ check_out: null, note: 'Départ pointé par erreur' });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /pointage plus récent/);
});
