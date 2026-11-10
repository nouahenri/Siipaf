const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const presences = require('../src/services/presences');

// Départ oublié (demande du client du 10/11) : l'arrivée restée ouverte au-delà du délai ne bloque plus le pointage suivant,
// les responsables sont prévenus, les heures ne comptent pas avant la correction ; cas de l'employé absent plusieurs jours
let db, app, admin, awaAgent, koffiAgent, users, awa, koffi;
const R = '/api/admin/erp/rh';
const HOUR = 3600000;
const ago = h => new Date(Date.now() - h * HOUR);

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  await createUser(db, 'comptable'); // service RH (rh:read)
  awaAgent = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  koffiAgent = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  users = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  const P = '/api/admin/erp/paie/employees';
  koffi = (await admin.post(P).send({ matricule: 'T-40', last_name: 'Kouassi', first_name: 'Koffi', gender: 'M', job_title: 'Conducteur de travaux', department: 'technique', hire_date: '2023-06-01', base_salary: 173330, user_id: users.conducteur_travaux })).body;
  awa = (await admin.post(P).send({ matricule: 'T-41', last_name: 'Koné', first_name: 'Awa', gender: 'F', job_title: 'Commerciale', department: 'commercial', hire_date: '2024-01-01', base_salary: 300000, user_id: users.commercial, manager_id: koffi.id })).body;
});
after(() => db.destroy());

const insertOpen = async (employee_id, h) => {
  const r = (await db('hr_attendances').insert({ employee_id, check_in: ago(h), source: 'web' }).returning('id'))[0];
  return typeof r === 'object' ? r.id : r;
};

test('le lendemain : l’arrivée est acceptée, la veille passe en « départ oublié », responsables et employé prévenus', async () => {
  const old = await insertOpen(awa.id, 20);
  const res = await awaAgent.post(`${R}/me/attendance`).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.action, 'arrivee', 'plus de blocage : c’est une arrivée');
  assert.equal(res.body.forgotten.id, old);
  assert.ok(res.body.forgotten.forgotten_at);

  const notes = await db('notifications').where({ event: 'pointage.depart_oublie' });
  assert.ok(notes.some(n => n.user_id === users.comptable && /Koné Awa/.test(n.title)), 'service RH prévenu');
  assert.ok(notes.some(n => n.user_id === users.conducteur_travaux), 'responsable direct prévenu');
  assert.ok(notes.some(n => n.user_id === users.commercial && /Votre départ/.test(n.title)), 'l’employé est informé, avec son propre message');

  const me = (await awaAgent.get(`${R}/me/attendance`)).body;
  assert.equal(me.open.id, res.body.attendance.id, 'le pointage du jour est le pointage en cours');
  assert.deepEqual(me.forgotten.map(a => a.id), [old], 'Mon espace : départ à corriger');
  const list = (await admin.get(`${R}/attendance?controle=oubli`)).body;
  assert.deepEqual(list.map(a => a.id), [old], 'filtre « Départs oubliés »');
  assert.ok((await admin.get(`${R}/attendance/today`)).body.forgotten.some(a => a.id === old));
  // Départ du jour : ferme le pointage du jour, pas celui de la veille
  const out = await awaAgent.post(`${R}/me/attendance`).send({});
  assert.equal(out.body.action, 'depart');
  assert.equal(out.body.attendance.id, res.body.attendance.id);
});

test('absent plusieurs jours : classé par la tâche horaire, rappel quotidien au RH, la feuille de présence n’est plus bloquée', async () => {
  const old = await insertOpen(koffi.id, 72);
  await presences.forgottenTick(db);
  assert.ok((await db('hr_attendances').where({ id: old }).first()).forgotten_at, 'classé sans que l’employé revienne pointer');
  const once = await db('notifications').where({ event: 'pointage.depart_oublie' }).where('dedupe_key', 'like', `pointage:${old}:oubli%`);
  await presences.forgottenTick(db);
  assert.equal((await db('notifications').where({ event: 'pointage.depart_oublie' }).where('dedupe_key', 'like', `pointage:${old}:oubli%`)).length, once.length, 'une seule alerte par pointage');

  // Le lendemain, toujours pas corrigé : rappel au service RH (une fois par jour)
  const tomorrow = new Date(Date.now() + 25 * HOUR);
  await presences.forgottenTick(db, tomorrow);
  await presences.forgottenTick(db, tomorrow);
  const reminders = await db('notifications').where({ event: 'pointage.departs_a_corriger', user_id: users.comptable });
  assert.equal(reminders.length, 1);
  assert.match(reminders[0].title, /2 départ\(s\) oublié\(s\)/);

  // Feuille de chantier des jours suivants : plus de « déjà un pointage sur cette plage »
  const day = ago(48).toISOString().slice(0, 10);
  const sheet = await admin.post(`${R}/attendance/sheet`).send({ date: day, rows: [{ employee_id: koffi.id, periods: [['07:30', '12:00']] }] });
  assert.equal(sheet.status, 201, JSON.stringify(sheet.body));
});

test('correction : départ saisi avec motif, alertes traitées, heures comptées, historique gardé', async () => {
  const a = (await admin.get(`${R}/attendance?controle=oubli`)).body.find(x => x.employee_id === awa.id);
  const period = a.check_in.slice(0, 7);
  let ot = (await admin.get(`${R}/overtime?period=${period}`)).body.rows.find(r => r.employee_id === awa.id);
  assert.equal(ot.forgotten, 1, 'heures sup : départ oublié signalé, heures non comptées');
  const check_out = new Date(new Date(a.check_in).getTime() + 8 * HOUR).toISOString();
  assert.equal((await koffiAgent.patch(`${R}/attendance/${a.id}`).send({ check_out, note: 'Départ oublié' })).status, 200, 'le responsable corrige');
  const fixed = await db('hr_attendances').where({ id: a.id }).first();
  assert.ok(fixed.check_out && fixed.forgotten_at, 'départ saisi, trace de l’oubli conservée');
  assert.ok(!(await admin.get(`${R}/attendance?controle=oubli`)).body.some(x => x.id === a.id));
  const unread = await db('notifications').where('dedupe_key', 'like', `pointage:${a.id}:oubli%`).whereNull('read_at');
  assert.equal(unread.length, 0, 'alertes traitées pour tous');
  ot = (await admin.get(`${R}/overtime?period=${period}`)).body.rows.find(r => r.employee_id === awa.id);
  assert.equal(ot.forgotten, 0);
});

test('délai réglable : sous le délai, le pointage suivant reste le départ', async () => {
  assert.equal((await admin.put(`${R}/settings`).send({ forgotten_departure_hours: 7 })).status, 400, 'au moins 8 h');
  assert.equal((await admin.put(`${R}/settings`).send({ forgotten_departure_hours: 24 })).status, 200);
  await db('hr_attendances').where({ employee_id: awa.id }).whereNull('check_out').update({ check_out: ago(1) });
  await insertOpen(awa.id, 20);
  const res = await awaAgent.post(`${R}/me/attendance`).send({});
  assert.equal(res.body.action, 'depart', '20 h < 24 h : départ (journée longue)');
  await admin.put(`${R}/settings`).send({ forgotten_departure_hours: 16 });
});
