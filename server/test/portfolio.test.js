const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { portfolioDiff, portfolioCounts, replayPortfolio, LOST_REASONS } = require('../src/lib/domain');

let db, app, admin, sellerA, sellerB, idA, idB, project, lotId;
const M = '/api/admin/erp/commercial';
const events = leadId => db('lead_portfolio_events').where({ lead_id: leadId }).orderBy('id').select('kind', 'user_id', 'reason');
const year = new Date().getFullYear();
const stats = (agent, q = '') => agent.get(`/api/admin/portefeuille?granularite=mois&du=${year}-01-01&au=${year}-12-31${q}`);

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  sellerA = await login(app, await createUser(db, 'commercial', 'a@test.ci'), 'motdepasse-test-123');
  sellerB = await login(app, await createUser(db, 'commercial', 'b@test.ci'), 'motdepasse-test-123');
  idA = (await db('users').where({ email: 'a@test.ci' }).first()).id;
  idB = (await db('users').where({ email: 'b@test.ci' }).first()).id;
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'PF1', price_fcfa: 20000000 }]);
  lotId = (await db('lots').where({ project_id: project.id, code: 'PF1' }).first()).id;
});
after(() => db.destroy());

test('règles : transfert avant conversion, compteurs brut / pertes / net', () => {
  const prev = replayPortfolio([{ kind: 'attribution', user_id: 1 }]);
  assert.deepEqual(portfolioDiff(prev, { owner: 2, client: true, desiste: false, lost: false }).map(e => `${e.kind}:${e.user_id}`),
    ['retrait:1', 'attribution:2', 'client:2'], 'le client revient au nouveau commercial');
  const c = portfolioCounts([
    { kind: 'attribution' }, { kind: 'attribution' }, { kind: 'attribution' }, { kind: 'retrait' },
    { kind: 'perte' }, { kind: 'reprise' }, { kind: 'perte' }, { kind: 'suppression' }, { kind: 'client' }, { kind: 'client' }, { kind: 'desistement' },
  ]);
  assert.deepEqual(c, { prospects: { brut: 3, transferes: 1, pertes: 2, net: 0 }, clients: { brut: 2, desistes: 1, net: 1 } });
});

let lead;
test('attribution d’office au commercial qui crée le prospect ; une personne déjà connue garde son commercial', async () => {
  let res = await sellerA.post('/api/admin/leads').send({ name: 'Adjoua Konan', phone: '0701010101' });
  lead = res.body;
  assert.equal(lead.assigned_to, idA);
  assert.deepEqual(await events(lead.id), [{ kind: 'attribution', user_id: idA, reason: 'creation' }]);
  // Le responsable ressaisit la même personne : elle n'est pas désattribuée
  res = await admin.post('/api/admin/leads').send({ name: 'Adjoua K.', phone: '0701010101' });
  assert.equal(res.body.id, lead.id);
  assert.equal(res.body.assigned_to, idA);
  assert.equal((await events(lead.id)).length, 1);
  // Créé par le responsable sans commercial : à répartir
  res = await admin.post('/api/admin/leads').send({ name: 'Site Web', phone: '0702020202' });
  assert.equal(res.body.assigned_to, null);
  assert.equal((await events(res.body.id)).length, 0);
});

test('transfert A → B par le responsable ; un commercial ne prend que des prospects libres', async () => {
  const free = (await admin.post('/api/admin/leads').send({ name: 'Libre', phone: '0703030303' })).body;
  assert.equal((await sellerB.post('/api/admin/leads/assign').send({ ids: [lead.id], user_id: idB })).status, 403, 'déjà à A');
  assert.equal((await sellerB.post('/api/admin/leads/assign').send({ ids: [free.id], user_id: idA })).status, 403, 'pas pour un autre');
  assert.equal((await sellerB.post('/api/admin/leads/assign').send({ ids: [free.id], user_id: idB })).body.changed, 1);
  const res = await admin.post('/api/admin/leads/assign').send({ ids: [lead.id], user_id: idB });
  assert.equal(res.body.changed, 1);
  assert.deepEqual((await events(lead.id)).map(e => `${e.kind}:${e.user_id}:${e.reason}`),
    [`attribution:${idA}:creation`, `retrait:${idA}:transfert`, `attribution:${idB}:transfert`]);
  const hist = await admin.get(`/api/admin/leads/${lead.id}/portefeuille`);
  assert.equal(hist.body[2].reason_label, 'Transfert');
});

test('conversion, désistement, perte, reprise et suppression sont comptés pour le commercial du moment', async () => {
  let res = await admin.post(`/api/admin/lots/${lotId}/sale`).send({ lead_id: lead.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await admin.post(`/api/admin/lots/${lotId}/status`).send({ status: 'desistement', reason: 'Désistement client' });
  assert.deepEqual((await events(lead.id)).slice(3).map(e => `${e.kind}:${e.user_id}`), [`client:${idB}`, `desistement:${idB}`]);

  const other = (await sellerB.post('/api/admin/leads').send({ name: 'Perdu Puis Repris', phone: '0704040404' })).body;
  const reason = Object.keys(LOST_REASONS)[0];
  res = await sellerB.post(`${M}/leads/${other.id}/stage`).send({ stage: 'perdu', lost_reason: reason });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await sellerB.post(`${M}/leads/${other.id}/stage`).send({ stage: 'visite' });
  const gone = (await sellerB.post('/api/admin/leads').send({ name: 'Doublon', phone: '0705050505' })).body;
  assert.equal((await admin.delete(`/api/admin/leads/${gone.id}`)).status, 200);
  assert.deepEqual((await events(other.id)).map(e => e.kind), ['attribution', 'perte', 'reprise']);
  assert.deepEqual((await events(gone.id)).map(e => e.kind), ['attribution', 'suppression'], 'l’historique survit à la suppression');
});

test('compteurs par période : brut, pertes, net, cumul ; un commercial ne voit que lui', async () => {
  let res = await stats(admin);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const a = res.body.rows.find(r => r.user_id === idA);
  const b = res.body.rows.find(r => r.user_id === idB);
  assert.deepEqual(a.total.prospects, { brut: 1, transferes: 1, pertes: 0, net: 0 });
  // B : Libre (pris), Adjoua (transfert), Perdu Puis Repris, Doublon (supprimé)
  assert.deepEqual(b.total.prospects, { brut: 4, transferes: 0, pertes: 1, net: 3 });
  assert.deepEqual(b.total.clients, { brut: 1, desistes: 1, net: 0 });
  assert.equal(b.series.at(-1).cumul.prospects, 3, 'cumul du net en fin d’année');
  assert.equal(res.body.unassigned, 1, 'prospect « Site Web » à répartir');
  assert.equal(res.body.periods.length, 12);
  res = await stats(sellerA);
  assert.deepEqual(res.body.rows.map(r => r.user_id), [idA]);
  assert.equal(res.body.unassigned, null);
  assert.equal((await sellerA.get(`/api/admin/portefeuille?granularite=semaine&du=${year}-03-01&au=${year}-03-31`)).body.periods[0].key.includes('-S'), true);
});

test('liste importée : nouveaux attribués au commercial choisi, doublons déduits, bilan', async () => {
  const send = (rows, list, dry = false) => admin.post('/api/admin/import').send({ mode: 'prospects', dry_run: dry, rows, list });
  let res = await send([{ name: 'Imp Un', phone: '0711111111' }, { name: 'Adjoua Konan', phone: '0701010101' }], { name: 'Salon octobre', filename: 'salon.xlsx', assigned_to: idA });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const importId = res.body.import_id;
  assert.ok(importId);
  res = await send([{ name: 'Imp Deux', phone: '0722222222' }, { name: 'Sans contact' }], { id: importId });
  assert.equal(res.body.errors, 1);
  assert.equal((await db('leads').where({ phone: '+2250722222222' }).orWhere({ phone: '0722222222' }).first()).assigned_to, idA);
  assert.equal((await db('leads').where({ id: lead.id }).first()).assigned_to, idB, 'un doublon garde son commercial');

  res = await admin.get(`/api/admin/imports/${importId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.bilan, { lignes: 4, nouveaux: 2, doublons: 1, erreurs: 1, en_cours: 2, clients: 0, perdus: 0, conversion_pct: 0 });
  assert.equal(res.body.items.length, 3);
  // Le commercial voit la liste qui lui est attribuée ; un autre non
  assert.equal((await sellerA.get('/api/admin/imports')).body.length, 1);
  assert.equal((await sellerB.get('/api/admin/imports')).body.length, 0);
  // Un commercial qui importe s'attribue ses nouveaux prospects
  res = await sellerB.post('/api/admin/import').send({ mode: 'prospects', dry_run: false, rows: [{ name: 'Imp Trois', phone: '0733333333' }], list: { name: 'Mes contacts', assigned_to: idA } });
  const imp3 = await db('lead_imports').where({ id: res.body.import_id }).first();
  assert.equal(imp3.assigned_to, idB);
  const evs = await db('lead_portfolio_events').where({ import_id: imp3.id });
  assert.deepEqual(evs.map(e => `${e.kind}:${e.user_id}:${e.reason}`), [`attribution:${idB}:import`]);
});

test('indicateurs de performance : prospects et clients nets du commercial', async () => {
  const { loadRaw, compute } = require('../src/services/performance');
  const raw = await loadRaw(db, { id: 0, user_id: idB, project_id: null });
  const out = compute(raw, `${year}-01-01`, `${year}-12-31`);
  assert.equal(out.prospects_nets, 4); // 3 + « Imp Trois »
  assert.equal(out.clients_nets, 0);
  const res = await admin.get(`${M}/dashboard`);
  assert.equal(res.status, 200);
});
