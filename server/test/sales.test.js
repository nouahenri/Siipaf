const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');

let db, app, admin, project, lotId;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'B1', price_fcfa: 23212000 }, { code: 'B2', price_fcfa: 23212000 }]);
  lotId = (await db('lots').where({ project_id: project.id, code: 'B1' }).first()).id;
});
after(() => db.destroy());

test("ouvrir un dossier réserve le lot, crée la checklist et un code client", async () => {
  const res = await admin.post(`/api/admin/lots/${lotId}/sale`).send({ name: 'Kouamé A.', phone: '+33 6 00 00 00 01', financing: 'diaspora' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.price_fcfa, 23212000, 'prix du lot par défaut');
  assert.match(res.body.lead.client_code, /^SIIPAF-\d{4}-0001$/);
  assert.equal(res.body.documents.length, 6);
  assert.equal(res.body.remaining_fcfa, 23212000);
  assert.equal((await db('lots').where({ id: lotId }).first()).status, 'reserve');
  const again = await admin.post(`/api/admin/lots/${lotId}/sale`).send({ name: 'Autre', phone: '0101010101' });
  assert.equal(again.status, 409, 'un seul dossier actif par lot');
});

test('versements : saisis par le comptable, reste à payer, soldé, pas de dépassement', async () => {
  const comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  const sale = await db('sales').where({ lot_id: lotId }).first();
  const pay = amount => comptable.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: amount, paid_at: '2026-10-01', method: 'mobile_money', reference: 'OM-123' });
  let res = await pay(10000000);
  assert.equal(res.status, 201);
  assert.equal(res.body.remaining_fcfa, 13212000);
  assert.equal(res.body.percent_paid, 43.1);
  assert.equal((await pay(20000000)).status, 409, 'au-delà du reste à payer');
  res = await pay(13212000);
  assert.equal(res.body.status, 'solde');
  // Un commercial ne saisit pas de versement
  const commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  assert.equal((await commercial.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 1, paid_at: '2026-10-01', method: 'especes' })).status, 403);
  // Supprimer un versement repasse le dossier « en cours »
  res = await comptable.delete(`/api/admin/payments/${res.body.payments[0].id}`);
  assert.equal(res.body.status, 'en_cours');
});

test('documents : le juridique fait avancer le statut', async () => {
  const juriste = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  const detail = await juriste.get(`/api/admin/lots/${lotId}/detail`);
  const acd = detail.body.sale.documents.find(d => d.type === 'acd');
  const res = await juriste.patch(`/api/admin/documents/${acd.id}`).send({ status: 'en_cours', note: 'Dépôt au MCLU le 12/10' });
  assert.equal(res.status, 200);
  assert.equal(res.body.documents.find(d => d.id === acd.id).status, 'en_cours');
});

test("la fiche lot n'expose pas le dossier aux rôles sans accès", async () => {
  const editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  const res = await editeur.get(`/api/admin/lots/${lotId}/detail`);
  assert.equal(res.status, 200);
  assert.equal(res.body.sale, null);
  const list = await editeur.get(`/api/admin/lots?project_id=${project.id}`);
  assert.equal(list.body.find(l => l.id === lotId).buyer_name, null);
  const adminList = await admin.get(`/api/admin/lots?project_id=${project.id}`);
  assert.equal(adminList.body.find(l => l.id === lotId).buyer_name, 'Kouamé A.');
});

test('désistement : le dossier est clos et le lot se revend', async () => {
  await admin.post(`/api/admin/lots/${lotId}/status`).send({ status: 'desistement', reason: 'Désistement client' });
  assert.equal((await db('sales').where({ lot_id: lotId }).first()).status, 'desiste');
  const res = await admin.post(`/api/admin/lots/${lotId}/sale`).send({ name: 'Nouvel acquéreur', email: 'nouveau@example.com' });
  assert.equal(res.status, 201);
  assert.match(res.body.lead.client_code, /-0002$/);
  const detail = await admin.get(`/api/admin/lots/${lotId}/detail`);
  assert.equal(detail.body.past_sales, 1);
});

test('tableau de bord : évolution mensuelle et totaux financiers', async () => {
  const res = await admin.get('/api/admin/stats/timeline?months=6');
  assert.equal(res.status, 200);
  assert.equal(res.body.series.length, 6);
  const current = res.body.series[5];
  assert.ok(current.reservations >= 1, 'les réservations du mois sont comptées');
  assert.ok(res.body.finance.chiffre_affaires > 0);
  assert.equal(res.body.finance.reste, res.body.finance.chiffre_affaires - res.body.finance.encaisse);
  assert.equal(res.body.week.length, 7);
  assert.ok(res.body.week[6].leads >= 1, 'prospects du jour comptés');
  assert.equal(res.body.by_project[0].name, 'SIIPAF CITY AHOUTOUE');
  assert.ok(res.body.recent_payments.length >= 1);
  const editeur = await login(app, 'editeur@test.ci', 'motdepasse-test-123');
  assert.equal((await editeur.get('/api/admin/stats/timeline')).body.finance, null, 'pas de chiffres financiers sans droit');
});
