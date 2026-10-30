/**
 * Cloisonnement des commerciaux, demandes de transfert et versements à confirmer (demande du client du 29/10).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

const PWD = 'motdepasse-test-123';
let db, app, admin, sellerA, sellerB, resp, comptable, idA, idB, project, lotId, leadA, leadB;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  sellerA = await login(app, await createUser(db, 'commercial', 'vendeur.a@test.ci'), PWD);
  sellerB = await login(app, await createUser(db, 'commercial', 'vendeur.b@test.ci'), PWD);
  resp = await login(app, await createUser(db, 'resp_exploitation'), PWD);
  comptable = await login(app, await createUser(db, 'comptable'), PWD);
  idA = (await db('users').where({ email: 'vendeur.a@test.ci' }).first()).id;
  idB = (await db('users').where({ email: 'vendeur.b@test.ci' }).first()).id;
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'CL1', price_fcfa: 20000000 }, { code: 'CL2', price_fcfa: 20000000 }]);
  lotId = (await db('lots').where({ project_id: project.id, code: 'CL1' }).first()).id;
  leadA = (await sellerA.post('/api/admin/leads').send({ name: 'Client de A', phone: '0711111111' })).body;
  leadB = (await sellerB.post('/api/admin/leads').send({ name: 'Client de B', phone: '0722222222' })).body;
});
after(() => db.destroy());

test('un commercial ne voit ni ne touche les prospects, rendez-vous et clients d’un collègue', async () => {
  assert.equal(leadA.assigned_to, idA, 'attribué d’office à son auteur');
  const list = (await sellerA.get('/api/admin/leads')).body.rows.map(l => l.id);
  assert.ok(list.includes(leadA.id) && !list.includes(leadB.id));
  assert.equal((await sellerA.get(`/api/admin/leads/${leadB.id}`)).status, 404);
  assert.equal((await sellerA.patch(`/api/admin/leads/${leadB.id}`).send({ stage: 'visite' })).status, 404);
  assert.equal((await sellerA.get(`/api/admin/leads/${leadB.id}/portefeuille`)).status, 404);
  // Désattribuer son propre prospect ou le confier : responsable seulement
  assert.equal((await sellerA.patch(`/api/admin/leads/${leadA.id}`).send({ assigned_to: null })).status, 403);
  assert.equal((await sellerA.patch(`/api/admin/leads/${leadA.id}`).send({ assigned_to: idB })).status, 403);
  // Rendez-vous
  assert.equal((await sellerA.post('/api/admin/appointments').send({ lead_id: leadB.id, starts_at: '2026-12-01T10:00:00Z' })).status, 404);
  const apptB = (await sellerB.post('/api/admin/appointments').send({ lead_id: leadB.id, starts_at: '2026-12-01T10:00:00Z' })).body;
  assert.equal((await sellerA.patch(`/api/admin/appointments/${apptB.id}`).send({ status: 'annule' })).status, 404);
  assert.ok(!(await sellerA.get('/api/admin/appointments')).body.some(a => a.id === apptB.id));
  assert.equal((await sellerA.post('/api/admin/appointments').send({ lead_id: leadA.id, assigned_to: idB, starts_at: '2026-12-02T10:00:00Z' })).status, 403);
  // Doublon d'une personne suivie par un collègue : 409 sans sa fiche
  const dup = await sellerA.post('/api/admin/leads').send({ name: 'Doublon', phone: '0722222222' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.details.transfer, true);
  assert.equal(dup.body.name, undefined);
  // Prospect non attribué (site) : vu du responsable seulement
  const free = await db('leads').insert({ name: 'Venu du site', phone: '0733333333', source: 'site' });
  const freeId = typeof free[0] === 'object' ? free[0].id : free[0];
  assert.equal((await sellerA.get(`/api/admin/leads/${freeId}`)).status, 404);
  assert.equal((await resp.get(`/api/admin/leads/${freeId}`)).status, 200);
});

test('clients, messagerie et fiche du lot : ceux du commercial seulement ; message à plusieurs clients', async () => {
  let res = await sellerA.post(`/api/admin/lots/${lotId}/sale`).send({ lead_id: leadA.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const sale = res.body;
  const lotB = (await db('lots').where({ project_id: project.id, code: 'CL2' }).first()).id;
  assert.equal((await sellerA.post(`/api/admin/lots/${lotB}/sale`).send({ lead_id: leadB.id })).status, 404, 'dossier pour le prospect d’un collègue');
  res = await sellerB.post(`/api/admin/lots/${lotB}/sale`).send({ lead_id: leadB.id });
  assert.equal(res.status, 201);

  const clientsA = (await sellerA.get('/api/admin/clients')).body.map(c => c.lead_id);
  assert.deepEqual(clientsA, [leadA.id]);
  assert.equal((await sellerB.get(`/api/admin/lots/${lotId}/detail`)).body.sale, null, 'dossier d’un collègue masqué');
  assert.equal((await sellerA.get(`/api/admin/lots/${lotId}/detail`)).body.sale.id, sale.id);
  assert.equal((await sellerB.get(`/api/admin/lots?project_id=${project.id}`)).body.find(l => l.id === lotId).buyer_name, null);
  assert.equal((await sellerB.patch(`/api/admin/sales/${sale.id}`).send({ notes: 'x' })).status, 404);
  assert.equal((await sellerB.post(`/api/admin/lots/${lotId}/status`).send({ status: 'desistement', reason: 'test' })).status, 403);

  // Messagerie
  assert.equal((await sellerB.get(`/api/admin/leads/${leadA.id}/messages`)).status, 404);
  assert.equal((await sellerB.post(`/api/admin/leads/${leadA.id}/messages`).send({ body: 'Bonjour' })).status, 404);
  assert.equal((await sellerB.post('/api/admin/client-messages/groupe').send({ lead_ids: [leadA.id, leadB.id], body: 'Info' })).status, 403);
  res = await resp.post('/api/admin/client-messages/groupe').send({ lead_ids: [leadA.id, leadB.id], body: 'Visite du chantier samedi' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.sent, 2);
  const inbox = (await sellerB.get('/api/admin/client-messages')).body.map(m => m.lead_id);
  assert.deepEqual(inbox, [leadB.id]);
  // Accès à l'espace client d'un client d'un collègue
  assert.equal((await sellerB.post(`/api/admin/leads/${leadA.id}/client-access`).send({ notify: false })).status, 404);
});

test('demande de transfert : motivée par le commercial, validée ou refusée par le responsable, historisée', async () => {
  // B demande à reprendre le client de A
  let res = await sellerB.post(`/api/admin/leads/${leadA.id}/transfert`).send({ reason: 'Le client m’a contacté directement' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // Audit du 30/10 : celui qui demande à reprendre la personne d'un collègue ne reçoit que { id, status } (ni nom ni code client)
  assert.deepEqual(Object.keys(res.body).sort(), ['id', 'status']);
  const t = await db('lead_transfer_requests').where({ id: res.body.id }).first();
  assert.equal(t.from_user_id, idA);
  assert.equal(t.to_user_id, idB);
  assert.equal((await sellerB.post(`/api/admin/leads/${leadA.id}/transfert`).send({ reason: 'Encore une fois' })).status, 409, 'une demande à la fois');
  assert.equal((await sellerB.post(`/api/admin/lead-transfers/${t.id}/valider`)).status, 403, 'pas d’auto-validation');
  // Le responsable est prévenu
  const respId = (await db('users').where({ role: 'resp_exploitation' }).first()).id;
  assert.ok(await db('notifications').where({ user_id: respId, event: 'prospect.transfert_demande' }).first());
  // Refus
  assert.equal((await resp.post(`/api/admin/lead-transfers/${t.id}/refuser`).send({})).status, 400, 'motif obligatoire');
  res = await resp.post(`/api/admin/lead-transfers/${t.id}/refuser`).send({ note: 'A suit déjà le dossier' });
  assert.equal(res.body.status, 'refusee');
  assert.equal((await db('leads').where({ id: leadA.id }).first()).assigned_to, idA);
  // A confie son client à B : accord du responsable, puis approbation de l'administrateur général (client : double validation)
  res = await sellerA.post(`/api/admin/leads/${leadA.id}/transfert`).send({ to_user_id: idB, reason: 'Je pars en congé trois mois' });
  assert.equal(res.status, 201);
  const tId = res.body.id;
  assert.equal((await sellerA.get('/api/admin/lead-transfers')).body.length, 1, 'le commercial voit ses demandes');
  res = await resp.post(`/api/admin/lead-transfers/${tId}/valider`).send({});
  assert.equal(res.body.awaiting, 'administrateur');
  res = await admin.post(`/api/admin/lead-transfers/${tId}/valider`).send({});
  assert.equal(res.body.status, 'validee');
  assert.equal((await db('leads').where({ id: leadA.id }).first()).assigned_to, idB);
  const events = await db('lead_portfolio_events').where({ lead_id: leadA.id }).orderBy('id');
  assert.deepEqual(events.slice(-2).map(e => `${e.kind}:${e.user_id}`), [`retrait:${idA}`, `attribution:${idB}`]);
  assert.equal((await sellerA.get(`/api/admin/leads/${leadA.id}`)).status, 404, 'A ne le voit plus');
});

test('versement déclaré par un commercial : à confirmer, ne compte qu’après la confirmation de la Comptabilité', async () => {
  const sale = await db('sales').where({ lead_id: leadB.id }).first();
  let res = await sellerB.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 5000000, paid_at: '2026-10-20', method: 'virement', reference: 'VIR-1' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.paid_fcfa, 0, 'ne compte pas avant confirmation');
  assert.equal(res.body.declarations.length, 1);
  assert.equal(res.body.declarations[0].status, 'a_confirmer');
  assert.equal((await db('payments').where({ sale_id: sale.id })).length, 0);
  // Reste à payer : les déclarations en attente sont déduites
  assert.equal((await sellerB.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 16000000, paid_at: '2026-10-20', method: 'especes' })).status, 409);
  const comptableId = (await db('users').where({ role: 'comptable' }).first()).id;
  assert.ok(await db('notifications').where({ user_id: comptableId, event: 'versement.a_confirmer' }).first());
  const pending = (await comptable.get('/api/admin/payment-declarations')).body;
  assert.equal(pending.length, 1);
  assert.equal((await sellerB.post(`/api/admin/payment-declarations/${pending[0].id}/confirm`)).status, 403);
  res = await comptable.post(`/api/admin/payment-declarations/${pending[0].id}/confirm`).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.paid_fcfa, 5000000);
  assert.equal(res.body.payments[0].declared_by_name, 'commercial');
  // Refus motivé
  res = await sellerB.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 1000000, paid_at: '2026-10-21', method: 'especes' });
  const d = res.body.declarations.find(x => x.status === 'a_confirmer');
  assert.equal((await comptable.post(`/api/admin/payment-declarations/${d.id}/reject`).send({ reason: 'Fonds non reçus en caisse' })).body.declarations.find(x => x.id === d.id).status, 'rejete');
  const sellerBId = (await db('users').where({ email: 'vendeur.b@test.ci' }).first()).id;
  assert.ok(await db('notifications').where({ user_id: sellerBId, event: 'versement.refuse' }).first());
  assert.equal(Number((await db('payments').where({ sale_id: sale.id }).sum({ v: 'amount_fcfa' }).first()).v), 5000000);
});

test('privilèges détaillés : chaque action se coche à part ; un ancien privilège est découpé sans rien perdre', async () => {
  // Rôle qui ne fait qu'avancer les prospects dans le circuit
  await admin.post('/api/admin/permissions/roles').send({ label: 'Suivi du circuit', permissions: ['leads:read', 'leads:stage', 'leads:all'] });
  await admin.post('/api/admin/users').send({ name: 'Suivi', email: 'suivi@test.ci', role: 'suivi_du_circuit', password: 'motdepasse-long-123' });
  await db('users').where({ email: 'suivi@test.ci' }).update({ must_change_password: false });
  const suivi = await login(app, 'suivi@test.ci', 'motdepasse-long-123');
  assert.equal((await suivi.patch(`/api/admin/leads/${leadB.id}`).send({ stage: 'visite' })).status, 200);
  assert.equal((await suivi.patch(`/api/admin/leads/${leadB.id}`).send({ name: 'Autre nom' })).status, 403, 'modifier la fiche : autre action');
  assert.equal((await suivi.post('/api/admin/leads').send({ name: 'Nouveau', phone: '0744444444' })).status, 403, 'créer : autre action');
  // La grille présente les actions sous leur intitulé
  const cat = (await admin.get('/api/admin/permissions')).body.catalog.find(g => g.group === 'Ventes');
  assert.deepEqual(cat.items.filter(i => i.parent === 'Gérer ses prospects').map(i => i.id),
    ['leads:create', 'leads:edit', 'leads:stage', 'leads:activities', 'leads:import', 'leads:transfer']);
  // Migration : un rôle qui avait encore « leads:write » reçoit toutes ses actions
  await db('role_permissions').insert({ role: 'suivi_du_circuit', permission: 'leads:write' });
  await require('../migrations/20261129200000_privileges_detailles').up(db);
  const perms = await db('role_permissions').where({ role: 'suivi_du_circuit' }).pluck('permission');
  assert.ok(!perms.includes('leads:write'));
  for (const p of ['leads:create', 'leads:edit', 'leads:transfer']) assert.ok(perms.includes(p), p);
});

test('la Comptabilité ajuste un versement déclaré avant de le confirmer, ou en saisit un directement ; le commercial est prévenu', async () => {
  const sale = await db('sales').where({ lead_id: leadB.id }).first();
  const sellerBId = (await db('users').where({ email: 'vendeur.b@test.ci' }).first()).id;
  let res = await sellerB.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 2000000, paid_at: '2026-10-22', method: 'especes' });
  const d = res.body.declarations.find(x => x.status === 'a_confirmer');
  const before = Number(res.body.paid_fcfa);
  res = await comptable.post(`/api/admin/payment-declarations/${d.id}/confirm`).send({ amount_fcfa: 1800000, method: 'virement', reference: 'RELEVE-22' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.paid_fcfa, before + 1800000, 'montant ajusté retenu');
  const p = res.body.payments.find(x => x.reference === 'RELEVE-22');
  assert.equal(p.method, 'virement');
  assert.equal(Number((await db('payment_declarations').where({ id: d.id }).first()).amount_fcfa), 2000000, 'la déclaration reste telle que saisie');
  const n = await db('notifications').where({ user_id: sellerBId, event: 'vente.versement' }).orderBy('id', 'desc').first();
  assert.match(n.body, /ajusté : déclaré 2 ?000 ?000|ajusté/);
  // Saisie directe : le commercial est prévenu
  res = await comptable.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 100000, paid_at: '2026-10-23', method: 'especes', reference: 'CAISSE-1' });
  assert.equal(res.status, 201);
  assert.ok(await db('notifications').where({ user_id: sellerBId, event: 'vente.versement' }).where('title', 'like', '%Versement reçu%').first());
});

test('rendez-vous avec un client : le commercial avec le sien, le responsable avec n’importe lequel (au nom du commercial)', async () => {
  const client = await db('leads').where({ id: leadB.id }).first();
  assert.ok(client.client_code, 'B est client (dossier ouvert)');
  let res = await sellerB.post('/api/admin/appointments').send({ lead_id: leadB.id, kind: 'bureau', starts_at: '2026-12-05T09:00:00Z' });
  assert.equal(res.status, 201);
  assert.equal(res.body.assigned_to, (await db('users').where({ email: 'vendeur.b@test.ci' }).first()).id);
  res = await resp.post('/api/admin/appointments').send({ lead_id: leadB.id, kind: 'visite', starts_at: '2026-12-06T09:00:00Z' });
  assert.equal(res.status, 201);
  assert.equal(res.body.assigned_to, client.assigned_to, 'par défaut, le commercial du client');
  assert.equal((await sellerA.post('/api/admin/appointments').send({ lead_id: leadB.id, starts_at: '2026-12-07T09:00:00Z' })).status, 404);
});
