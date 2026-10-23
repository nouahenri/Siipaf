const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

let db, app, admin, drh, resp;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  // DRH : rôle comptable (droits RH) + droit « Créer des rôles et régler leurs privilèges »
  await createUser(db, 'comptable', 'drh@test.ci');
  const u = await db('users').where({ email: 'drh@test.ci' }).first();
  await db('user_permissions').insert({ user_id: u.id, permission: 'roles:write', granted: true });
  drh = await login(app, 'drh@test.ci', 'motdepasse-test-123');
});
after(() => db.destroy());

test('un rôle créé dans le dashboard est proposé aux postes de l’ERP, et inversement', async () => {
  let res = await admin.post('/api/admin/permissions/roles').send({ label: 'Secrétaire', permissions: ['courrier:write', 'courrier:read'] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  let roles = (await resp.get('/api/admin/erp/rh/positions')).body.roles;
  assert.ok(roles.some(r => r.id === res.body.id), 'visible dans RH › Réglages › Postes');
  res = await resp.post('/api/admin/erp/rh/positions').send({ title: 'Secrétaire de direction', department: 'administratif', default_role: res.body.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // Créé depuis l'ERP (DRH) : visible dans Dashboard › Rôles et privilèges et attribuable à un compte
  res = await drh.post('/api/admin/permissions/roles').send({ label: 'Assistant RH', permissions: ['rh:read', 'conges:manage'] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  roles = (await admin.get('/api/admin/permissions')).body.roles;
  assert.deepEqual(roles.find(r => r.id === res.body.id).permissions.sort(), ['conges:manage', 'rh:read']);
  const created = await admin.post('/api/admin/users').send({ name: 'Ines Bamba', email: 'ines@test.ci', role: res.body.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

test('supprimer un rôle dans le dashboard : postes nettoyés, refus s’il est prévu par un changement de poste planifié', async () => {
  let res = await admin.post('/api/admin/permissions/roles').send({ label: 'Temporaire', permissions: [] });
  const role = res.body.id;
  res = await resp.post('/api/admin/erp/rh/positions').send({ title: 'Poste temporaire', department: 'administratif', default_role: role });
  const pos = res.body.id;
  const [e] = await db('employees').insert({ matricule: 'E-TMP', last_name: 'Test', first_name: 'Role', job_title: 'Poste temporaire', position_id: pos, department: 'administratif', hire_date: '2025-01-01', base_salary: 1 });
  const eid = typeof e === 'object' ? e.id : e;
  await db('hr_position_changes').insert({ employee_id: eid, position_id: pos, job_title: 'Poste temporaire', department: 'administratif', role, effective_date: '2099-01-01', reason: 'autre' });
  assert.equal((await admin.delete(`/api/admin/permissions/roles/${role}`)).status, 409, 'changement planifié');
  await db('hr_position_changes').where({ role }).update({ status: 'annule' });
  assert.equal((await admin.delete(`/api/admin/permissions/roles/${role}`)).status, 200);
  assert.equal((await db('hr_positions').where({ id: pos }).first()).default_role, null);
});

test('garde-fous : pas sans le droit, pas un privilège qu’on n’a pas, pas de réglage des rôles existants', async () => {
  assert.equal((await resp.post('/api/admin/permissions/roles').send({ label: 'Essai', permissions: [] })).status, 403, 'sans roles:write');
  let res = await drh.post('/api/admin/permissions/roles').send({ label: 'Tout puissant', permissions: ['users:write'] });
  assert.equal(res.status, 403, 'le comptable n’a pas users:write');
  assert.match(res.body.error, /users:write/);
  // Créer seulement : régler un rôle existant reste au super administrateur (choix du client du 23/10)
  assert.equal((await drh.put('/api/admin/permissions/roles/commercial').send({ permissions: ['leads:read'] })).status, 403);
  assert.equal((await drh.patch('/api/admin/permissions/roles/commercial').send({ label: 'Vendeur' })).status, 403);
  const me = (await drh.get('/api/admin/permissions')).body;
  assert.equal(me.can_create, true);
  assert.equal(me.can_edit, false, 'renommer / supprimer : super administrateur seul');
});
