const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

// La fiche d'un nouvel employé se crée dans RH › Personnel et la Comptabilité est prévenue pour fixer le salaire (demande du client du 02/11)
let db, app, expl, editeur, users;
const R = '/api/admin/erp/rh';

before(async () => {
  ({ db, app } = await setup());
  expl = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  await createUser(db, 'comptable');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  users = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
});
after(() => db.destroy());

test('RH crée la fiche ; matricule, embauche au parcours, Comptabilité prévenue (salaire à fixer)', async () => {
  const body = { last_name: 'Yao', first_name: 'Marc', job_title: 'Chef de chantier', department: 'chantier', hire_date: '2026-11-03', contract_type: 'cdd', end_date: '2027-05-02' };
  assert.equal((await editeur.post(`${R}/employees`).send(body)).status, 403, 'réservé à « Identité, contrat et responsable »');
  const res = await expl.post(`${R}/employees`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.matricule, /\w/);
  const e = await db('employees').where({ id: res.body.id }).first();
  assert.equal(Number(e.base_salary), 0);
  assert.ok(await db('hr_career_events').where({ employee_id: e.id, kind: 'embauche' }).first(), 'embauche au parcours');
  const note = await db('notifications').where({ event: 'employe.embauche', user_id: users.comptable }).first();
  assert.ok(note, 'Comptabilité prévenue');
  assert.equal(note.link, '/compta/employes');
  assert.match(note.body, /salaire à fixer/);
  assert.ok(!(await db('notifications').where({ event: 'employe.embauche', user_id: users.resp_exploitation }).first()), 'jamais l’auteur');
});

test('reprise depuis les comptes du dashboard par le service RH', async () => {
  assert.equal((await editeur.post(`${R}/employees/from-users`).send({ user_ids: [users.editeur], hire_date: '2026-11-03' })).status, 403);
  const res = await expl.post(`${R}/employees/from-users`).send({ user_ids: [users.editeur], hire_date: '2026-11-03' });
  assert.equal(res.status, 201);
  assert.equal(res.body.created, 1);
  assert.equal((await db('employees').where({ user_id: users.editeur }).first()).department, 'administratif');
});
