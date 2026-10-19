const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

let db, app, admin, commercial, commercialId;
before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  commercialId = (await db('users').where({ role: 'commercial' }).first()).id;
});
after(() => db.destroy());

test('le catalogue liste les rôles avec leurs droits actuels et par défaut', async () => {
  const res = await admin.get('/api/admin/permissions');
  assert.equal(res.status, 200);
  assert.ok(res.body.catalog.length >= 5);
  const com = res.body.roles.find(r => r.id === 'commercial');
  assert.ok(com.permissions.includes('leads:read'));
  assert.deepEqual([...com.permissions].sort(), [...com.defaults].sort());
  assert.equal(res.body.roles.find(r => r.id === 'super_admin').locked, true);
});

test("retirer un droit à un rôle s'applique tout de suite, et se rétablit par défaut", async () => {
  assert.equal((await commercial.get('/api/admin/leads')).status, 200);
  const current = (await admin.get('/api/admin/permissions')).body.roles.find(r => r.id === 'commercial').permissions;
  const res = await admin.put('/api/admin/permissions/roles/commercial').send({ permissions: current.filter(p => p !== 'leads:read') });
  assert.equal(res.status, 200);
  assert.equal((await commercial.get('/api/admin/leads')).status, 403);
  const me = await commercial.get('/api/auth/me');
  assert.ok(!me.body.permissions.includes('leads:read'), "l'interface reçoit les droits effectifs");
  await admin.post('/api/admin/permissions/roles/commercial/reset');
  assert.equal((await commercial.get('/api/admin/leads')).status, 200);
});

test('privilèges individuels : accorder et retirer un droit à un seul compte', async () => {
  assert.equal((await commercial.get('/api/admin/testimonials')).status, 403);
  const res = await admin.put(`/api/admin/users/${commercialId}/permissions`).send({ overrides: { 'testimonials:write': true, 'leads:read': false, 'appointments:read': true } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.overrides, { 'testimonials:write': true, 'leads:read': false }, 'les droits déjà donnés par le rôle ne sont pas dupliqués');
  assert.equal((await commercial.get('/api/admin/testimonials')).status, 200);
  assert.equal((await commercial.get('/api/admin/leads')).status, 403);
  // Un autre commercial n'est pas concerné
  const other = await login(app, await createUser(db, 'commercial', 'autre.commercial@test.ci'), 'motdepasse-test-123');
  assert.equal((await other.get('/api/admin/leads')).status, 200);
  await admin.put(`/api/admin/users/${commercialId}/permissions`).send({ overrides: {} });
  assert.equal((await commercial.get('/api/admin/leads')).status, 200);
});

test('seul le super administrateur modifie les privilèges et crée des super administrateurs', async () => {
  const resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  assert.equal((await resp.get('/api/admin/permissions')).status, 200, 'consultation possible');
  assert.equal((await resp.put('/api/admin/permissions/roles/commercial').send({ permissions: [] })).status, 403);
  assert.equal((await resp.put(`/api/admin/users/${commercialId}/permissions`).send({ overrides: { 'users:write': true } })).status, 403);
  // Même avec le droit « Gérer les utilisateurs » accordé, pas de création de super administrateur
  const respId = (await db('users').where({ role: 'resp_exploitation' }).first()).id;
  await admin.put(`/api/admin/users/${respId}/permissions`).send({ overrides: { 'users:write': true } });
  const create = await resp.post('/api/admin/users').send({ name: 'Pirate', email: 'pirate@test.ci', role: 'super_admin', password: 'motdepasse-long-123' });
  assert.equal(create.status, 403);
  const ok = await resp.post('/api/admin/users').send({ name: 'Nouveau commercial', email: 'nc@test.ci', role: 'commercial', password: 'motdepasse-long-123' });
  assert.equal(ok.status, 201);
});

test('un privilège inconnu est refusé', async () => {
  const res = await admin.put('/api/admin/permissions/roles/commercial').send({ permissions: ['tout:faire'] });
  assert.equal(res.status, 400);
});
