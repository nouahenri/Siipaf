const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');

let db, app, editeur;
before(async () => {
  ({ db, app } = await setup());
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
});
after(() => db.destroy());

test('les 3 témoignages historiques du site sont publiés', async () => {
  const res = await request(app).get('/api/public/testimonials');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 3);
  assert.equal(res.body[0].name, 'Bamba S.', 'le témoignage mis en avant vient en premier');
  assert.equal(res.body[0].email, undefined, "l'e-mail n'est jamais exposé");
});

test('un témoignage déposé sur le site attend la validation avant publication', async () => {
  const sent = await request(app).post('/api/public/testimonials').send({ name: 'Awa K.', email: 'awa@example.com', rating: 4, message: 'Très bon accompagnement pour mon achat à Ahoutoué, équipe à l’écoute.' });
  assert.equal(sent.status, 201);
  assert.equal((await request(app).get('/api/public/testimonials')).body.length, 3, 'pas encore visible');

  const list = await editeur.get('/api/admin/testimonials?status=en_attente');
  assert.equal(list.body.counts.en_attente, 1);
  const id = list.body.rows[0].id;
  const ok = await editeur.patch(`/api/admin/testimonials/${id}`).send({ status: 'publie' });
  assert.equal(ok.status, 200);
  const pub = (await request(app).get('/api/public/testimonials')).body;
  assert.equal(pub.length, 4);
  assert.ok(pub.some(t => t.name === 'Awa K.'));
});

test('validation des dépôts : message trop court, note hors limites, robots', async () => {
  assert.equal((await request(app).post('/api/public/testimonials').send({ name: 'X Y', rating: 5, message: 'Court' })).status, 400);
  assert.equal((await request(app).post('/api/public/testimonials').send({ name: 'X Y', rating: 9, message: 'Un message suffisamment long pour passer.' })).status, 400);
  assert.equal((await request(app).post('/api/public/testimonials').send({ name: 'Bot', rating: 5, message: 'Un message suffisamment long pour passer.', website: 'spam' })).status, 400);
});

test('refuser retire la mise en avant ; seuls les rôles autorisés modèrent', async () => {
  const bamba = await db('testimonials').where({ name: 'Bamba S.' }).first();
  const res = await editeur.patch(`/api/admin/testimonials/${bamba.id}`).send({ status: 'refuse' });
  assert.equal(res.body.featured, 0);
  const commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  assert.equal((await commercial.get('/api/admin/testimonials')).status, 403);
});
