const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

let db, app, admin;
before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
});
after(() => db.destroy());

const newUser = (agent, role, email) =>
  agent.post('/api/admin/users').send({ name: `Compte ${role}`, email, role, password: 'motdepasse-long-123' });

test('les 6 rôles d’origine sont dans la table, marqués système', async () => {
  const res = await admin.get('/api/admin/users/roles');
  assert.equal(res.status, 200);
  const system = res.body.filter(r => r.system).map(r => r.id);
  assert.deepEqual(system, ['super_admin', 'commercial', 'editeur', 'conducteur_travaux', 'comptable', 'resp_exploitation']);
  // Rôle créé pour le client (catalogue Achats & stocks, 25/10) : réglable et supprimable comme un rôle personnalisé
  assert.deepEqual(res.body.filter(r => !r.system).map(r => r.id), ['resp_achats']);
});

test('créer un rôle avec ses droits, puis lui attribuer un compte qui obtient exactement ces droits', async () => {
  const res = await admin.post('/api/admin/permissions/roles').send({
    label: 'Assistant(e) commercial', description: 'Suivi des prospects', permissions: ['leads:read', 'appointments:read', 'leads:read'],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.id, 'assistant_e_commercial');
  assert.equal(res.body.system, false);
  assert.deepEqual([...res.body.permissions].sort(), ['appointments:read', 'leads:read']);

  // Le rôle apparaît dans la grille et dans les sélecteurs
  const grid = (await admin.get('/api/admin/permissions')).body.roles.find(r => r.id === 'assistant_e_commercial');
  assert.equal(grid.label, 'Assistant(e) commercial');
  assert.ok((await admin.get('/api/admin/users/roles')).body.some(r => r.id === 'assistant_e_commercial'));

  const created = await newUser(admin, 'assistant_e_commercial', 'assistant@test.ci');
  assert.equal(created.status, 201);
  const agent = await login(app, 'assistant@test.ci', 'motdepasse-long-123');
  // Mot de passe fixé par l'administrateur : provisoire, à remplacer avant tout accès
  assert.equal((await agent.get('/api/admin/leads')).status, 403);
  assert.equal((await agent.post('/api/auth/password').send({ current: 'motdepasse-long-123', next: 'motdepasse-perso-456' })).status, 200);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.body.user.must_change_password, false);
  assert.equal(me.body.user.role_label, 'Assistant(e) commercial');
  assert.deepEqual([...me.body.permissions].sort(), ['appointments:read', 'leads:read']);
  assert.equal((await agent.get('/api/admin/leads')).status, 200);
  assert.equal((await agent.post('/api/admin/leads').send({ name: 'Test' })).status, 403, 'pas le droit « Gérer les prospects »');
  assert.equal((await agent.get('/api/admin/users')).status, 403);

  // Les droits du rôle se règlent ensuite comme ceux des rôles d'origine
  await admin.put('/api/admin/permissions/roles/assistant_e_commercial').send({ permissions: ['leads:read', 'leads:write'] });
  assert.equal((await agent.get('/api/admin/appointments')).status, 403);
  const sellers = await admin.get('/api/admin/users/commerciaux');
  assert.ok(sellers.body.some(u => u.role === 'assistant_e_commercial'), 'proposé pour l’assignation des prospects');
});

test('un libellé déjà pris est refusé et une clé en double reçoit un suffixe', async () => {
  assert.equal((await admin.post('/api/admin/permissions/roles').send({ label: '  commercial ' })).status, 409);
  const a = await admin.post('/api/admin/permissions/roles').send({ label: 'Juriste' });
  const b = await admin.post('/api/admin/permissions/roles').send({ label: 'Juriste !' });
  assert.equal(a.body.id, 'juriste');
  assert.equal(b.body.id, 'juriste_2');
  assert.equal((await admin.post('/api/admin/permissions/roles').send({ label: 'X', permissions: [] })).status, 400, 'libellé trop court');
  assert.equal((await admin.post('/api/admin/permissions/roles').send({ label: 'Pirate', permissions: ['tout:faire'] })).status, 400);
});

test('renommer un rôle garde ses comptes et ses droits', async () => {
  const res = await admin.patch('/api/admin/permissions/roles/juriste').send({ label: 'Juriste conseil' });
  assert.equal(res.status, 200);
  assert.equal(res.body.label, 'Juriste conseil');
  assert.equal(res.body.id, 'juriste');
  // Les rôles d'origine se renomment aussi, sauf le super administrateur
  assert.equal((await admin.patch('/api/admin/permissions/roles/comptable').send({ label: 'Comptabilité' })).status, 200);
  assert.equal((await admin.patch('/api/admin/permissions/roles/super_admin').send({ label: 'Chef' })).status, 400);
  assert.equal((await admin.patch('/api/admin/permissions/roles/juriste').send({ label: 'Comptabilité' })).status, 409);
});

test('suppression refusée tant qu’un compte (même désactivé) a le rôle', async () => {
  const created = await newUser(admin, 'juriste_2', 'juriste2@test.ci');
  await admin.patch(`/api/admin/users/${created.body.id}`).send({ active: false });
  const refused = await admin.delete('/api/admin/permissions/roles/juriste_2');
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /1 compte/);

  await admin.patch(`/api/admin/users/${created.body.id}`).send({ role: 'commercial' });
  assert.equal((await admin.delete('/api/admin/permissions/roles/juriste_2')).status, 200);
  assert.equal(await db('role_permissions').where({ role: 'juriste_2' }).first(), undefined);
  assert.ok(!(await admin.get('/api/admin/users/roles')).body.some(r => r.id === 'juriste_2'));
  // Un rôle supprimé n'est plus attribuable
  assert.equal((await newUser(admin, 'juriste_2', 'juriste3@test.ci')).status, 400);
});

test('seul le super administrateur est indélébile ; un rôle d’origine sans compte se supprime', async () => {
  assert.equal((await admin.delete('/api/admin/permissions/roles/super_admin')).status, 400);
  assert.equal((await admin.delete('/api/admin/permissions/roles/comptable')).status, 200, 'rôle d’origine sans compte');
  assert.equal((await admin.get('/api/admin/permissions')).body.roles.some(r => r.id === 'comptable'), false);
  assert.equal((await admin.put('/api/admin/permissions/roles/super_admin').send({ permissions: [] })).status, 400);
  const me = await admin.get('/api/auth/me');
  assert.deepEqual(me.body.permissions, ['*']);
  // Pas de « Défaut » pour un rôle créé dans le dashboard
  assert.equal((await admin.post('/api/admin/permissions/roles/juriste/reset')).status, 400);
});

test('un rôle inconnu est refusé à la création d’un compte', async () => {
  assert.equal((await newUser(admin, 'chef_de_gare', 'gare@test.ci')).status, 400);
});

test('seul le super administrateur crée, renomme ou supprime des rôles', async () => {
  const resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  assert.equal((await resp.post('/api/admin/permissions/roles').send({ label: 'Mon rôle', permissions: ['users:write'] })).status, 403);
  assert.equal((await resp.patch('/api/admin/permissions/roles/juriste').send({ label: 'Autre' })).status, 403);
  assert.equal((await resp.delete('/api/admin/permissions/roles/juriste')).status, 403);
});
