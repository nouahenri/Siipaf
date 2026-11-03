const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

// Matricule attribué par le service RH (demande du client du 03/11) : saisi, jamais numéroté automatiquement, unique,
// modifiable par le RH seulement ; le changement est inscrit au parcours et l'employé est prévenu (identifiant de la borne).
let db, app, expl, comptable, fichesPaie, users;
const R = '/api/admin/erp/rh';
const P = '/api/admin/erp/paie';
const body = { last_name: 'Kouadio', first_name: 'Jean', job_title: 'Maçon', department: 'chantier', hire_date: '2026-11-03' };

before(async () => {
  ({ db, app } = await setup());
  expl = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  await createUser(db, 'commercial');
  await createUser(db, 'editeur');
  // Gère les fiches salariés (Comptabilité) sans tenir les dossiers du personnel (RH)
  await db('roles').insert({ id: 'fiches_paie', label: 'fiches_paie', description: '', system: false });
  await db('role_permissions').insert(['paie:read', 'paie:employees'].map(permission => ({ role: 'fiches_paie', permission })));
  require('../src/services/permissions').invalidate(db);
  fichesPaie = await login(app, await createUser(db, 'fiches_paie', 'fiches@test.ci'), 'motdepasse-test-123');
  users = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
});
after(() => db.destroy());

test('création : matricule obligatoire, au bon format, rangé en majuscules, unique', async () => {
  assert.equal((await expl.post(`${R}/employees`).send(body)).status, 400, 'sans matricule');
  assert.equal((await expl.post(`${R}/employees`).send({ ...body, matricule: 'a b' })).status, 400, 'format');
  const res = await expl.post(`${R}/employees`).send({ ...body, matricule: ' siipaf-012 ', user_id: users.commercial });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.matricule, 'SIIPAF-012');
  const dup = await expl.post(`${R}/employees`).send({ ...body, last_name: 'Autre', matricule: 'Siipaf-012' });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /déjà attribué à Kouadio Jean/);
});

test('modification : réservée au RH, unique, inscrite au parcours, employé prévenu', async () => {
  const e = await db('employees').where({ matricule: 'SIIPAF-012' }).first();
  await expl.post(`${R}/employees`).send({ ...body, last_name: 'Diallo', matricule: 'SIIPAF-013' });
  assert.equal((await fichesPaie.patch(`${P}/employees/${e.id}`).send({ matricule: 'SIIPAF-099' })).status, 403, 'fiches salariés sans dossiers RH : pas le matricule');
  assert.equal((await expl.patch(`${R}/employees/${e.id}`).send({ matricule: 'SIIPAF-013' })).status, 409, 'déjà pris');
  const res = await expl.patch(`${R}/employees/${e.id}`).send({ matricule: 'sp-0001' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await db('employees').where({ id: e.id }).first()).matricule, 'SP-0001');
  const event = await db('hr_career_events').where({ employee_id: e.id }).whereNot('kind', 'embauche').first();
  assert.ok(event, 'changement inscrit au parcours');
  assert.deepEqual(JSON.parse(event.details).matricule, { from: 'SIIPAF-012', to: 'SP-0001' });
  const note = await db('notifications').where({ event: 'rh.matricule', user_id: users.commercial }).first();
  assert.ok(note, 'employé prévenu');
  assert.match(note.title, /SP-0001/);
  // Même matricule renvoyé : rien ne change, personne n'est prévenu une seconde fois
  assert.equal((await expl.patch(`${R}/employees/${e.id}`).send({ matricule: 'SP-0001' })).status, 200);
  assert.equal((await db('notifications').where({ event: 'rh.matricule', user_id: users.commercial })).length, 1);
});

test('reprise depuis les comptes : un matricule par compte, sans doublon', async () => {
  const twice = await expl.post(`${R}/employees/from-users`).send({ people: [{ user_id: users.editeur, matricule: 'X-100' }, { user_id: users.comptable, matricule: 'x-100' }], hire_date: '2026-11-03' });
  assert.equal(twice.status, 400, 'même matricule saisi deux fois');
  assert.equal((await expl.post(`${R}/employees/from-users`).send({ people: [{ user_id: users.editeur, matricule: 'SP-0001' }], hire_date: '2026-11-03' })).status, 409);
  const ok = await expl.post(`${R}/employees/from-users`).send({ people: [{ user_id: users.editeur, matricule: 'x-100' }], hire_date: '2026-11-03' });
  assert.equal(ok.body.created, 1);
  assert.equal((await db('employees').where({ user_id: users.editeur }).first()).matricule, 'X-100');
});
