const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');

let db, app;
before(async () => ({ db, app } = await setup()));
after(() => db.destroy());

test('connexion : refus avec un mauvais mot de passe, succès sinon', async () => {
  const bad = await request(app).post('/api/auth/login').send({ email: 'admin@test.ci', password: 'faux' });
  assert.equal(bad.status, 401);
  const agent = await login(app);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.body.user.role, 'super_admin');
  assert.equal(me.body.user.password_hash, undefined, 'le hash ne doit jamais sortir');
});

test("l'API admin exige une connexion", async () => {
  const res = await request(app).get('/api/admin/projects');
  assert.equal(res.status, 401);
});

test('les droits dépendent du rôle', async () => {
  const email = await createUser(db, 'commercial');
  const commercial = await login(app, email, 'motdepasse-test-123');
  assert.equal((await commercial.get('/api/admin/leads')).status, 200);
  assert.equal((await commercial.put('/api/admin/content/site').send({})).status, 403);
  assert.equal((await commercial.post('/api/admin/users').send({})).status, 403);

  const editeurEmail = await createUser(db, 'editeur');
  const editeur = await login(app, editeurEmail, 'motdepasse-test-123');
  assert.equal((await editeur.get('/api/admin/leads')).status, 403);
  const put = await editeur.put('/api/admin/content/site').send({ phone: '+225 00' });
  assert.equal(put.status, 200);
});

test('un compte désactivé ne peut plus se connecter', async () => {
  const email = await createUser(db, 'comptable');
  const admin = await login(app);
  const user = await db('users').where({ email }).first();
  await admin.patch(`/api/admin/users/${user.id}`).send({ active: false });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'motdepasse-test-123' });
  assert.equal(res.status, 401);
});
