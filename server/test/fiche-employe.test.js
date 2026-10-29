/**
 * Fiche employé commune à RH et Comptabilité (demande du client du 29/10) : mêmes champs, même règle d'enregistrement,
 * chaque groupe de champs au droit qui le gouverne. Barre latérale de chaque module : Mon espace et Demandes du service.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

const RH = '/api/admin/erp/rh', PAIE = '/api/admin/erp/paie', REQ = '/api/admin/erp/demandes';
const insertedId = r => (typeof r === 'object' ? r.id : r);
let db, app, admin, rhUser, comptable, commercial, ids, emp, rhEmp, commercialEmp;
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };

before(async () => {
  ({ db, app } = await setup()); admin = await login(app);
  rhUser = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123'); // dossiers RH sans la paie
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  const base = { hire_date: '2024-01-01', job_title: 'Assistant', base_salary: 300000, department: 'commercial' };
  emp = insertedId((await db('employees').insert({ ...base, matricule: 'E-1', last_name: 'Kouassi', first_name: 'Jean' }))[0]);
  rhEmp = insertedId((await db('employees').insert({ ...base, department: 'rh', matricule: 'E-2', last_name: 'Koné', first_name: 'Awa', user_id: ids.resp_exploitation }))[0]);
  commercialEmp = insertedId((await db('employees').insert({ ...base, matricule: 'E-3', last_name: 'Yao', first_name: 'Paul', user_id: ids.commercial }))[0]);
});
after(() => db.destroy());

test('même fiche depuis RH et Comptabilité, chaque champ à son droit', async () => {
  // RH (dossiers du personnel, sans la paie) : identité complète, plus seulement les coordonnées
  const e = ok(await rhUser.patch(`${RH}/employees/${emp}`).send({ last_name: 'Kouassi-Bamba', birth_place: 'Bouaké', hire_date: '2024-02-01', emergency_contact: 'Marie, 07 00 00 00' }));
  assert.equal(e.last_name, 'Kouassi-Bamba');
  assert.equal(e.base_salary, undefined, 'salaire masqué sans le droit paie');
  assert.equal((await rhUser.patch(`${RH}/employees/${emp}`).send({ base_salary: 1 })).status, 403, 'salaire : droit paie');
  assert.equal((await rhUser.patch(`${RH}/employees/${emp}`).send({ expatriate: true })).status, 403);
  assert.equal((await rhUser.patch(`${PAIE}/employees/${emp}`).send({ last_name: 'X' })).status, 403);
  // Comptabilité : la même règle, salaire compris, par l'une ou l'autre adresse
  ok(await comptable.patch(`${RH}/employees/${emp}`).send({ base_salary: 350000, emergency_contact: 'Marie' }));
  const p = ok(await comptable.patch(`${PAIE}/employees/${emp}`).send({ birth_place: 'Yamoussoukro' }));
  assert.equal(p.base_salary, 350000);
  assert.equal(p.birth_place, 'Yamoussoukro');
  // Sa propre fiche : jamais par soi-même ; pas de boucle hiérarchique, d'où que l'on vienne
  assert.equal((await rhUser.patch(`${RH}/employees/${rhEmp}`).send({ phone: '0102' })).status, 403);
  ok(await comptable.patch(`${PAIE}/employees/${commercialEmp}`).send({ manager_id: emp }));
  assert.equal((await comptable.patch(`${PAIE}/employees/${emp}`).send({ manager_id: commercialEmp })).status, 400);
  assert.equal((await commercial.patch(`${RH}/employees/${emp}`).send({ phone: '0102' })).status, 403);
});

test('barre latérale : Mon espace et Demandes du service avec leur pastille', async () => {
  const none = ok(await admin.get(`${REQ}/espace`));
  assert.equal(none.has_employee, false);
  let me = ok(await commercial.get(`${REQ}/espace`));
  assert.equal(me.has_employee, true);
  assert.equal(me.departments.member, 'commercial');
  assert.deepEqual(me.waiting, { commercial: 0 });
  // Le chef du service fait une demande : la pastille des membres et du chef la compte
  ok(await admin.put(`${RH}/department-heads/commercial`).send({ employee_id: commercialEmp }));
  ok(await commercial.post(REQ).send({ kind: 'intervention', department: 'commercial', title: 'Climatisation de l’agence' }), 201);
  me = ok(await commercial.get(`${REQ}/espace`));
  assert.deepEqual(me.departments.heads, ['commercial']);
  assert.equal(me.waiting.commercial, 1);
  const note = await db('notifications').where({ event: 'rh.chef_service', user_id: ids.commercial }).first();
  assert.equal(note.link, '/commercial/service', 'la notification mène à la page du menu');
  assert.deepEqual(ok(await rhUser.get(`${REQ}/espace`)).waiting, { rh: 0 }, 'pas les demandes d’un autre service');
});
