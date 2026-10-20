const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');

let db, app, admin, project;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  project = await db('projects').where({ slug: 'riviera' }).first();
});
after(() => db.destroy());

test('créer un lot à l’unité ; numéro en double refusé ; statut initial limité', async () => {
  let res = await admin.post(`/api/admin/projects/${project.id}/lots`).send({ code: 'R-01', ilot: '3', surface_m2: 300, price_fcfa: 45000000 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'disponible');
  const history = await db('lot_status_history').where({ lot_id: res.body.id });
  assert.equal(history.length, 1, 'la création est historisée');
  assert.equal((await admin.post(`/api/admin/projects/${project.id}/lots`).send({ code: 'R-01' })).status, 409);
  assert.equal((await admin.post(`/api/admin/projects/${project.id}/lots`).send({ code: 'R-02', status: 'vendu' })).status, 400, 'pas de lot créé « vendu »');
  res = await admin.post(`/api/admin/projects/${project.id}/lots`).send({ code: 'R-02', status: 'bloque' });
  assert.equal(res.body.status, 'bloque');
  const commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  assert.equal((await commercial.post(`/api/admin/projects/${project.id}/lots`).send({ code: 'R-03' })).status, 403);
});

test('modifier un lot sans créer de doublon de numéro', async () => {
  const lot = await db('lots').where({ project_id: project.id, code: 'R-02' }).first();
  assert.equal((await admin.patch(`/api/admin/lots/${lot.id}`).send({ code: 'R-01' })).status, 409);
  const res = await admin.patch(`/api/admin/lots/${lot.id}`).send({ code: 'R-02B', surface_m2: 250, price_fcfa: 40000000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 'R-02B');
});

test('dossier : dates renvoyées en AAAA-MM-JJ et réenvoyables telles quelles', async () => {
  const [lotId] = await db('lots').insert({ project_id: project.id, code: 'R-DATE', status: 'disponible', price_fcfa: 30000000 });
  const lot = { id: lotId };
  let res = await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: 'Date Test', phone: '0700000012', financing: 'diaspora', reserved_at: '2026-03-15' });
  assert.equal(res.body.reserved_at, '2026-03-15');
  const sale = res.body;
  res = await admin.patch(`/api/admin/sales/${sale.id}`).send({ price_fcfa: sale.price_fcfa, financing: 'apport', reserved_at: sale.reserved_at, signed_at: null, notes: 'ok' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.financing, 'apport');
  assert.equal(res.body.schedule.lines[0].kind, 'apport', 'échéancier recalculé');
  await admin.post(`/api/admin/lots/${lot.id}/status`).send({ status: 'desistement', reason: 'Test' });
  await admin.post(`/api/admin/lots/${lot.id}/status`).send({ status: 'disponible', reason: 'Test' });
});

test('un lot avec un historique de vente ne se supprime pas', async () => {
  const lot = await db('lots').where({ project_id: project.id, code: 'R-01' }).first();
  await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: 'Acheteur Test', phone: '0700000011' });
  await admin.post(`/api/admin/lots/${lot.id}/status`).send({ status: 'desistement', reason: 'Test' });
  await admin.post(`/api/admin/lots/${lot.id}/status`).send({ status: 'disponible', reason: 'Test' });
  const res = await admin.delete(`/api/admin/lots/${lot.id}`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /historique de vente/);
  const [freeId] = await db('lots').insert({ project_id: project.id, code: 'R-LIBRE', status: 'disponible' });
  assert.equal((await admin.delete(`/api/admin/lots/${freeId}`)).status, 200);
});

test('supprimer un prospect : interdit avec un dossier ou une option, réservé au droit dédié', async () => {
  const commercial = await login(app, await createUser(db, 'commercial', 'commercial-del@test.ci'), 'motdepasse-test-123');
  const created = await admin.post('/api/admin/leads').send({ name: 'Doublon Test', phone: '0700000077' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await commercial.delete(`/api/admin/leads/${created.body.id}`)).status, 403, 'droit leads:delete requis');
  await admin.post(`/api/admin/leads/${created.body.id}/messages`).send({ body: 'x' }).catch(() => {});
  assert.equal((await admin.delete(`/api/admin/leads/${created.body.id}`)).status, 200);
  assert.equal(await db('leads').where({ id: created.body.id }).first(), undefined);
  const buyer = await db('sales').first('lead_id');
  const res = await admin.delete(`/api/admin/leads/${buyer.lead_id}`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /dossier d’acquisition/);
});

test('type de projet « lotissement » et indication de plan interactif sur le site', async () => {
  const p = await admin.post('/api/admin/projects').send({ name: 'Lotissement Test', slug: 'lotissement-test', published: true });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal((await admin.patch(`/api/admin/projects/${p.body.id}`).send({ category: 'inconnu' })).status, 400);
  assert.equal((await admin.patch(`/api/admin/projects/${p.body.id}`).send({ category: 'lotissement' })).status, 200);
  let list = await request(app).get('/api/public/projects');
  let mine = list.body.find(x => x.slug === 'lotissement-test');
  assert.equal(mine.category, 'lotissement');
  assert.equal(mine.has_plan, false);
  await admin.post('/api/admin/plans').send({ project_id: p.body.id, name: 'Tranche 1', published: true });
  list = await request(app).get('/api/public/projects');
  assert.equal(list.body.find(x => x.slug === 'lotissement-test').has_plan, true);
});
