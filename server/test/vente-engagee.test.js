/**
 * Vente engagée (retours du client du 29/10) : la fiche du client ne contredit plus le dossier de vente ;
 * les dossiers de vente se consultent aussi depuis Comptabilité, Client & SAV et Administration générale.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

const PWD = 'motdepasse-test-123';
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
let db, app, admin, seller, conducteur, lead, sale;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  seller = await login(app, await createUser(db, 'commercial', 'vendeur.v@test.ci'), PWD);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), PWD);
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'VE1', price_fcfa: 20000000 }]);
  const lotId = (await db('lots').where({ project_id: project.id, code: 'VE1' }).first()).id;
  lead = (await seller.post('/api/admin/leads').send({ name: 'Ibrahim Cissé', phone: '0721111103', kind: 'particulier' })).body;
  const res = await seller.post(`/api/admin/lots/${lotId}/sale`).send({ lead_id: lead.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  sale = res.body;
});
after(() => db.destroy());

test('vente en cours : tous les champs de la fiche client restent modifiables (choix du client), ERP et dashboard', async () => {
  ok(await seller.patch(`/api/admin/erp/commercial/leads/${lead.id}`).send({ expected_revenue_fcfa: 26000000, financing: 'credit', name: 'Ibrahim CISSÉ', kind: 'entreprise' }));
  ok(await seller.patch(`/api/admin/leads/${lead.id}`).send({ financing: 'comptant', phone: '0700000000' }));
  // Le commercial, lui, ne change pas d'un simple enregistrement : responsable seulement
  assert.equal((await seller.patch(`/api/admin/erp/commercial/leads/${lead.id}`).send({ assigned_to: null })).status, 403);
});

test('dossiers de vente consultables hors du module Commercial (droit « Voir les dossiers »)', async () => {
  const list = await conducteur.get('/api/admin/erp/commercial/sales');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.some(s => s.id === sale.id));
  assert.equal((await conducteur.get(`/api/admin/erp/commercial/sales/${sale.id}`)).status, 200);
  assert.equal((await conducteur.get('/api/admin/erp/commercial/meta')).status, 200);
});

test('pipeline : colonne SAV pour les clients qui ont un dossier, hors pipeline pondéré', async () => {
  const meta = (await seller.get('/api/admin/erp/commercial/meta')).body;
  assert.deepEqual(meta.board_stages.slice(-2), ['notaire', 'sav']);
  assert.ok(!meta.pipeline_stages.includes('sav'));
  const prospect = (await seller.post('/api/admin/leads').send({ name: 'Sans dossier', phone: '0755555555' })).body;
  assert.equal((await seller.post(`/api/admin/erp/commercial/leads/${prospect.id}/stage`).send({ stage: 'sav' })).status, 409, 'pas de SAV sans dossier');
  assert.equal((await seller.post(`/api/admin/erp/commercial/leads/${lead.id}/stage`).send({ stage: 'sav' })).status, 200);
  assert.ok((await seller.get('/api/admin/erp/commercial/pipeline')).body.some(c => c.id === lead.id && c.stage === 'sav'));
  const dash = (await seller.get('/api/admin/erp/commercial/dashboard')).body;
  assert.ok(!dash.stages.some(s => s.stage === 'sav'), 'le SAV ne compte pas dans le pipeline pondéré');
});

test('étapes du client sur la fiche du bien : dossier de vente (ERP) et même règle SAV au dashboard', async () => {
  const s = (await conducteur.get(`/api/admin/erp/commercial/sales/${sale.id}`)).body;
  assert.ok(s.lead_stage, 'étape du client renvoyée avec le dossier');
  const prospect = (await seller.post('/api/admin/leads').send({ name: 'Encore sans dossier', phone: '0766666666' })).body;
  assert.equal((await seller.patch(`/api/admin/leads/${prospect.id}`).send({ stage: 'sav' })).status, 409);
  // Paiement : la personne devient client, même sans dossier
  assert.ok((await seller.patch(`/api/admin/leads/${prospect.id}`).send({ stage: 'paiement' })).body.client_code);
});
