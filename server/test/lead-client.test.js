const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login } = require('./helpers');

let db, admin;

before(async () => {
  let app;
  ({ db, app } = await setup());
  admin = await login(app);
});
after(() => db.destroy());

const inList = async (type, id) => (await admin.get(`/api/admin/leads?type=${type}&limit=200`)).body.rows.some(l => l.id === id);

test('prospect OU client : arrivé au paiement, il reçoit un code client et quitte les prospects', async () => {
  let res = await admin.post('/api/admin/leads').send({ name: 'Awa Prospect', phone: '0700001111', stage: 'visite' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id = res.body.id;
  assert.equal(res.body.client_code, null);
  assert.ok(await inList('prospects', id));
  assert.ok(!(await inList('clients', id)));

  res = await admin.patch(`/api/admin/leads/${id}`).send({ stage: 'paiement' });
  assert.match(res.body.client_code, /^SIIPAF-\d{4}-\d{4}$/);
  assert.ok(!(await inList('prospects', id)), 'plus dans les prospects');
  assert.ok(await inList('clients', id));
  assert.ok((await admin.get('/api/admin/clients')).body.some(c => c.lead_id === id || c.id === id), 'page Clients');

  // Revenir en arrière ne retire pas le code : un client reste client
  res = await admin.patch(`/api/admin/leads/${id}`).send({ stage: 'decision' });
  assert.ok(res.body.client_code);
  assert.ok(!(await inList('prospects', id)));
});

test('créé directement à l’étape contrat : client d’emblée ; sans filtre, la recherche trouve tout le monde', async () => {
  const res = await admin.post('/api/admin/leads').send({ name: 'Koffi Contrat', phone: '0700002222', stage: 'contrat' });
  assert.ok(res.body.client_code);
  const all = (await admin.get('/api/admin/leads?q=Koffi')).body.rows;
  assert.ok(all.some(l => l.id === res.body.id), 'recherche sans filtre (ouverture d’un dossier)');
});
