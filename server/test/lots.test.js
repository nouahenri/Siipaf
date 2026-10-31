const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');
const { expireOptions } = require('../src/services/lots');

let db, app, admin, project, plan;
const square = (x, y) => [[x, y], [x + 0.1, y], [x + 0.1, y + 0.1], [x, y + 0.1]];
const inEightDays = () => new Date(Date.now() + 8 * 24 * 3600 * 1000);

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  project = await db('projects').where({ slug: 'yamoussoukro' }).first();
  plan = (await admin.post('/api/admin/plans').send({ project_id: project.id, name: 'Tranche 1', width: 2000, height: 1400, published: true })).body;
  const res = await admin.put(`/api/admin/projects/${project.id}/lots`).send(
    ['A1', 'A2', 'A3', 'A4', 'A5'].map((code, i) => ({ code, ilot: 'A', plan_id: plan.id, surface_m2: 250, price_fcfa: 21212000, shape: square(i * 0.15, 0.1) })),
  );
  assert.deepEqual(res.body, { created: 5, updated: 0 });
});
after(() => db.destroy());

const lot = code => db('lots').where({ project_id: project.id, code }).first();
const visitor = { name: 'Awa Koné', phone: '+33 6 12 34 56 78', email: 'awa@example.com' };

test('le plan public expose les lots sans données de prospect', async () => {
  const res = await request(app).get('/api/public/projects/yamoussoukro');
  assert.equal(res.status, 200);
  const lots = res.body.plans[0].lots;
  assert.equal(lots.length, 5);
  assert.deepEqual(lots[0].shape[0], [0, 0.1]);
  assert.equal(lots[0].sellable, true);
  assert.equal(res.body.offers.length, 8);
});

test("l'éditeur charge le plan avec les lots du projet", async () => {
  const res = await admin.get(`/api/admin/plans/${plan.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.project.slug, 'yamoussoukro');
  assert.equal(res.body.lots.length, 5);
  assert.equal(res.body.offers.length, 8);
});

test('pré-réservation : le lot passe en option pour 7 jours', async () => {
  const a1 = await lot('A1');
  const res = await request(app).post(`/api/public/lots/${a1.id}/option`).send(visitor);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.days, 7);
  assert.equal((await lot('A1')).status, 'option');
  const lead = await db('leads').where({ email: 'awa@example.com' }).first();
  assert.equal(lead.source, 'plan');
});

test('une seule option active par prospect, et pas deux options sur un lot', async () => {
  const a2 = await lot('A2');
  const again = await request(app).post(`/api/public/lots/${a2.id}/option`).send({ ...visitor, email: 'AWA@example.com ' });
  assert.equal(again.status, 409);
  const a1 = await lot('A1');
  const other = await request(app).post(`/api/public/lots/${a1.id}/option`).send({ name: 'Yao', phone: '0700000000' });
  assert.equal(other.status, 409);
});

test("à expiration, l'option est libérée et le lot redevient disponible", async () => {
  const n = await expireOptions(db, inEightDays());
  assert.equal(n, 1);
  const a1 = await lot('A1');
  assert.equal(a1.status, 'disponible');
  const opt = await db('lot_options').where({ lot_id: a1.id }).first();
  assert.equal(opt.state, 'expiree');
});

test('circuit : « Réservé » par le dossier de vente, « Vendu » par l’acte, jamais à la main ; désistement (super admin) → de nouveau vendable', async () => {
  const commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  const a3 = await lot('A3');
  // Décision du client du 31/10 : ni « Réservé » ni « Vendu » ne se posent à la main (409 explicite)
  const sold = await commercial.post(`/api/admin/lots/${a3.id}/status`).send({ status: 'vendu' });
  assert.equal(sold.status, 409, 'vendu à la main interdit');
  assert.match(sold.body.error, /signature de l’acte/);
  const reserved = await commercial.post(`/api/admin/lots/${a3.id}/status`).send({ status: 'reserve' });
  assert.equal(reserved.status, 409, 'réservé à la main interdit');
  assert.match(reserved.body.error, /ouverture de son dossier/);
  assert.equal((await lot('A3')).status, 'disponible');
  // Le dossier de vente réserve le lot ; l'acte signé (Juridique) le vend
  const sale = await commercial.post(`/api/admin/lots/${a3.id}/sale`).send({ name: 'Acquéreur A3', phone: '0709000333', financing: 'comptant' });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal((await lot('A3')).status, 'reserve');
  await db('lots').where({ id: a3.id }).update({ status: 'vendu' }); // l'acte signé fait passer « vendu » (voir juridique.test.js)
  await db('lot_status_history').insert({ lot_id: a3.id, from_status: 'reserve', to_status: 'vendu', reason: 'Acte notarié signé' });
  assert.equal((await commercial.post(`/api/admin/lots/${a3.id}/status`).send({ status: 'desistement' })).status, 409, 'réservé au super admin');
  assert.equal((await admin.post(`/api/admin/lots/${a3.id}/status`).send({ status: 'desistement', reason: 'Client désisté' })).status, 200);

  // Un lot en désistement se pré-réserve ; à expiration il revient en « désistement »
  const res = await request(app).post(`/api/public/lots/${a3.id}/option`).send({ name: 'Koffi', phone: '0102030405' });
  assert.equal(res.status, 201);
  await expireOptions(db, inEightDays());
  assert.equal((await lot('A3')).status, 'desistement');

  const history = await admin.get(`/api/admin/lots/${a3.id}/history`);
  assert.deepEqual(history.body.map(h => h.to_status), ['desistement', 'option', 'desistement', 'vendu', 'reserve', 'disponible']);
});

test("confirmer une option en ouvrant le dossier de vente clôt l'option", async () => {
  const a4 = await lot('A4');
  await request(app).post(`/api/public/lots/${a4.id}/option`).send({ name: 'Marie', email: 'marie@example.com' });
  assert.equal((await admin.post(`/api/admin/lots/${a4.id}/status`).send({ status: 'reserve' })).status, 409, 'plus de réservation à la main');
  const res = await admin.post(`/api/admin/lots/${a4.id}/sale`).send({ name: 'Marie', email: 'marie@example.com', financing: 'comptant' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const opt = await db('lot_options').where({ lot_id: a4.id }).first();
  assert.equal(opt.state, 'confirmee');
});

test('import en masse : met à jour sans toucher au statut, refuse les doublons', async () => {
  const res = await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'A3', price_fcfa: 1, status: 'disponible' }]);
  assert.deepEqual(res.body, { created: 0, updated: 1 });
  assert.equal((await lot('A3')).status, 'desistement');
  const dup = await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'Z' }, { code: 'Z' }]);
  assert.equal(dup.status, 400);
});
