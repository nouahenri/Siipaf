/**
 * Changement du commercial d'un client (choix du client du 29/10) : accord du responsable commercial ET approbation de
 * l'administrateur général (super admin), quel que soit celui qui demande ; jamais d'un simple enregistrement de la fiche.
 * Les prospects gardent le circuit à une validation.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

const PWD = 'motdepasse-test-123';
let db, app, admin, sellerA, sellerB, resp, idA, idB, client, prospect;
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  sellerA = await login(app, await createUser(db, 'commercial', 'cc.a@test.ci'), PWD);
  sellerB = await login(app, await createUser(db, 'commercial', 'cc.b@test.ci'), PWD);
  resp = await login(app, await createUser(db, 'resp_exploitation'), PWD); // responsable : attribue les prospects (leads:assign)
  idA = (await db('users').where({ email: 'cc.a@test.ci' }).first()).id;
  idB = (await db('users').where({ email: 'cc.b@test.ci' }).first()).id;
  client = ok(await sellerA.post('/api/admin/leads').send({ name: 'Client de A', phone: '0711112222', stage: 'paiement' }), 201);
  prospect = ok(await sellerA.post('/api/admin/leads').send({ name: 'Prospect de A', phone: '0711113333' }), 201);
  assert.ok((await db('leads').where({ id: client.id }).first()).client_code, 'paiement : client');
});
after(() => db.destroy());

const owner = async id => (await db('leads').where({ id }).first('assigned_to')).assigned_to;

test('client : jamais par la fiche ni par l’attribution en lot', async () => {
  assert.equal((await resp.patch(`/api/admin/erp/commercial/leads/${client.id}`).send({ assigned_to: idB })).status, 409);
  assert.equal((await admin.patch(`/api/admin/leads/${client.id}`).send({ assigned_to: idB })).status, 409);
  const bulk = ok(await resp.post('/api/admin/leads/assign').send({ ids: [client.id, prospect.id], user_id: idB }));
  assert.deepEqual([bulk.changed, bulk.clients_skipped], [1, 1]);
  assert.equal(await owner(client.id), idA);
  ok(await resp.post('/api/admin/leads/assign').send({ ids: [prospect.id], user_id: idA })); // prospect : le responsable seul, comme avant
});

test('demande du commercial : le responsable donne son accord, puis l’administrateur général approuve', async () => {
  const t = ok(await sellerA.post(`/api/admin/leads/${client.id}/transfert`).send({ to_user_id: idB, reason: 'Départ en congé longue durée' }), 201);
  assert.equal(t.client, true);
  assert.equal(t.awaiting, 'responsable');
  assert.equal((await admin.post(`/api/admin/lead-transfers/${t.id}/valider`).send({})).status, 409, 'le responsable d’abord');
  const step = ok(await resp.post(`/api/admin/lead-transfers/${t.id}/valider`).send({}));
  assert.equal(step.status, 'en_attente');
  assert.equal(step.awaiting, 'administrateur');
  assert.equal(await owner(client.id), idA, 'pas encore appliqué');
  assert.ok(await db('notifications').where({ user_id: (await db('users').where({ role: 'super_admin' }).first()).id, event: 'prospect.transfert_demande' }).first(), 'administrateur prévenu');
  assert.equal((await resp.post(`/api/admin/lead-transfers/${t.id}/valider`).send({})).status, 409, 'le responsable ne fait pas les deux');
  const done = ok(await admin.post(`/api/admin/lead-transfers/${t.id}/valider`).send({}));
  assert.equal(done.status, 'validee');
  assert.ok(done.manager_name && done.admin_name);
  assert.equal(await owner(client.id), idB);
});

test('demande du responsable : son accord est donné, l’administrateur général approuve ; et l’inverse', async () => {
  const t = ok(await resp.post(`/api/admin/leads/${client.id}/transfert`).send({ to_user_id: idA, reason: 'Retour de congé du commercial' }), 201);
  assert.equal(t.awaiting, 'administrateur');
  ok(await admin.post(`/api/admin/lead-transfers/${t.id}/valider`).send({}));
  assert.equal(await owner(client.id), idA);
  // L'administrateur général demande : le responsable donne son accord pour appliquer
  const u = ok(await admin.post(`/api/admin/leads/${client.id}/transfert`).send({ to_user_id: idB, reason: 'Réorganisation du portefeuille' }), 201);
  assert.equal(u.awaiting, 'responsable');
  ok(await resp.post(`/api/admin/lead-transfers/${u.id}/valider`).send({}));
  assert.equal(await owner(client.id), idB);
  // Refus possible à chaque étape
  const v = ok(await sellerB.post(`/api/admin/leads/${client.id}/transfert`).send({ to_user_id: idA, reason: 'Le client préfère A' }), 201);
  assert.equal(ok(await admin.post(`/api/admin/lead-transfers/${v.id}/refuser`).send({ note: 'Non justifié' })).status, 'refusee');
});
