const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { situationAmounts } = require('../src/lib/domain');

let db, app, admin, conducteur, comptable, commercial, ids, project, worksite, supplier, market;
const W = '/api/admin/erp/chantiers';
const year = new Date().getUTCFullYear();
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await comptable.post('/api/admin/erp/compta/fiscal-years').send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` });
  supplier = (await comptable.post('/api/admin/erp/compta/suppliers').send({ name: 'BTP Ivoire Construction', kind: 'sous_traitant', expense_account: '621100' })).body;
  worksite = (await conducteur.post(W).send({ project_id: project.id, name: 'Tranche 1', manager_id: ids.conducteur_travaux })).body;
  // Marché : contrat de sous-traitance rattaché au chantier, sans taux de retenue → 5 % par défaut (Chantiers › Réglages)
  const res = await conducteur.post('/api/admin/erp/contrats').field('kind', 'sous_traitance').field('title', 'Lot VRD — tranche 1').field('supplier_id', String(supplier.id))
    .field('start_date', day(-60)).field('worksite_id', String(worksite.id)).field('contract_amount', '10000000').field('vat_rate', '18');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  market = await db('contracts').where({ title: 'Lot VRD — tranche 1' }).first();
  assert.equal(Number(market.retention_pct), 5);
  assert.equal(market.project_id, project.id, 'le chantier fixe le programme');
});
after(() => db.destroy());

test('règles : montant de la période, TVA, retenue sur le TTC, refus du cumul qui recule ou dépasse le marché', () => {
  assert.deepEqual(situationAmounts({ contractAmount: 10000000, cumulativePct: 30, previousAmount: 1000000, vatRate: 18, retentionPct: 5 }),
    { cumulative_amount: 3000000, amount_ht: 2000000, vat_amount: 360000, amount_ttc: 2360000, retention_amount: 118000, net_payable: 2242000 });
  assert.match(situationAmounts({ contractAmount: 10000000, cumulativePct: 10, previousAmount: 3000000 }).error, /n’ajoute aucun/);
  assert.match(situationAmounts({ contractAmount: 10000000, cumulativeAmount: 12000000 }).error, /dépasse/);
  assert.match(situationAmounts({ contractAmount: null, cumulativePct: 50 }).error, /pas de montant/);
  assert.equal(situationAmounts({ contractAmount: null, cumulativeAmount: 500000 }).amount_ht, 500000, 'marché sans montant : montant cumulé saisi');
});

test('situations : saisie et vérification par le conducteur, validation par la Direction → facture, coût réel, retenue au Juridique', async () => {
  const url = `${W}/${worksite.id}/marches/${market.id}/situations`;
  assert.equal((await commercial.post(url).field('period_end', day(-30)).field('cumulative_pct', '30')).status, 404, 'hors de ses chantiers');
  let res = await conducteur.post(url).field('period_end', day(-30)).field('cumulative_pct', '30').field('note', 'Terrassement et réseaux secs');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  let m = res.body.find(x => x.id === market.id);
  const s1 = m.situations[0];
  assert.deepEqual([s1.number, s1.amount_ht, s1.amount_ttc, s1.retention_amount, s1.net_payable, s1.status], [1, 3000000, 3540000, 177000, 3363000, 'brouillon']);
  assert.equal((await conducteur.post(url).field('period_end', day(-29)).field('cumulative_pct', '35')).status, 409, 'une seule situation en cours');

  // Correction du brouillon, vérification, renvoi en brouillon, nouvelle vérification
  res = await conducteur.patch(`${W}/${worksite.id}/situations/${s1.id}`).field('cumulative_pct', '25');
  assert.equal(res.body.find(x => x.id === market.id).situations[0].amount_ht, 2500000);
  await conducteur.post(`${W}/${worksite.id}/situations/${s1.id}/verifier`);
  assert.ok(await db('notifications').where({ event: 'chantier.situation_verifiee' }).first(), 'la Direction est prévenue');
  assert.equal((await conducteur.patch(`${W}/${worksite.id}/situations/${s1.id}`).field('cumulative_pct', '30')).status, 409, 'vérifiée : plus modifiable');
  await conducteur.post(`${W}/${worksite.id}/situations/${s1.id}/brouillon`);
  await conducteur.patch(`${W}/${worksite.id}/situations/${s1.id}`).field('cumulative_pct', '30');
  await conducteur.post(`${W}/${worksite.id}/situations/${s1.id}/verifier`);
  assert.equal((await admin.get(`${W}/situations`)).body.length, 1);
  assert.equal((await admin.get(`${W}/badges`)).body.situations_to_validate, 1);

  assert.equal((await conducteur.post(`${W}/${worksite.id}/situations/${s1.id}/valider`)).status, 403, 'le conducteur ne valide pas');
  res = await admin.post(`${W}/${worksite.id}/situations/${s1.id}/valider`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  m = res.body.find(x => x.id === market.id);
  assert.deepEqual([m.cumulative_amount, m.progress_pct, m.retention_amount, m.invoiced_ttc], [3000000, 30, 177000, 3540000]);

  // Facture d'achat en brouillon : sous-traitant, chantier, poste « sous-traitance »
  const inv = await db('purchase_invoices').where({ id: m.situations[0].purchase_invoice_id }).first();
  assert.deepEqual([inv.supplier_id, inv.worksite_id, inv.project_id, inv.worksite_category, inv.status, Number(inv.amount_ht), Number(inv.amount_ttc)],
    [supplier.id, worksite.id, project.id, 'sous_traitance', 'brouillon', 3000000, 3540000]);
  assert.ok(await db('notifications').where({ user_id: ids.comptable, event: 'chantier.situation_validee' }).first(), 'le comptable est prévenu');
  // Coût réel du chantier
  const detail = (await conducteur.get(`${W}/${worksite.id}`)).body;
  assert.equal(detail.costs.by_category.sous_traitance, 3000000);
  // Retenue de garantie du marché au Juridique
  let g = await db('guarantees').where({ contract_id: market.id, direction: 'retenue' }).first();
  assert.equal(Number(g.amount_fcfa), 177000);

  // Deuxième situation : 60 % cumulés → 30 % sur la période ; la retenue s'ajoute
  res = await conducteur.post(url).field('period_end', day(-1)).field('cumulative_pct', '60');
  const s2 = res.body.find(x => x.id === market.id).situations[1];
  assert.deepEqual([s2.number, s2.previous_amount, s2.amount_ht], [2, 3000000, 3000000]);
  await conducteur.post(`${W}/${worksite.id}/situations/${s2.id}/verifier`);
  await admin.post(`${W}/${worksite.id}/situations/${s2.id}/valider`);
  g = await db('guarantees').where({ contract_id: market.id, direction: 'retenue' });
  assert.equal(g.length, 1, 'une seule retenue par marché');
  assert.equal(Number(g[0].amount_fcfa), 354000);

  // Refus motivé
  res = await conducteur.post(url).field('period_end', day(0)).field('cumulative_pct', '70');
  const s3 = res.body.find(x => x.id === market.id).situations[2];
  assert.equal((await admin.post(`${W}/${worksite.id}/situations/${s3.id}/refuser`).send({ reason: '' })).status, 400);
  res = await admin.post(`${W}/${worksite.id}/situations/${s3.id}/refuser`).send({ reason: 'Métré à reprendre avec le bureau de contrôle' });
  assert.equal(res.body.find(x => x.id === market.id).situations[2].status, 'refusee');
  assert.ok(await db('notifications').where({ user_id: ids.conducteur_travaux, event: 'chantier.situation_refusee' }).first());
  assert.equal((await conducteur.post(url).field('period_end', day(0)).field('cumulative_pct', '50')).status, 400, 'le cumul ne recule pas');
  assert.equal((await conducteur.post(url).field('period_end', day(0)).field('cumulative_pct', '101')).status, 400);
});

test('marché sans sous-traitant rattaché ou sans compte de charge : situation ou validation refusée avec explication', async () => {
  let res = await conducteur.post('/api/admin/erp/contrats').field('kind', 'sous_traitance').field('title', 'Lot peinture').field('counterparty', 'Artisan peintre')
    .field('start_date', day(-10)).field('worksite_id', String(worksite.id)).field('contract_amount', '2000000');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const c = await db('contracts').where({ title: 'Lot peinture' }).first();
  res = await conducteur.post(`${W}/${worksite.id}/marches/${c.id}/situations`).field('period_end', day(0)).field('cumulative_pct', '20');
  assert.match(res.body.error, /sous-traitant/);
  // Fournisseur sans compte de charge habituel ni compte sur le contrat
  const bare = (await comptable.post('/api/admin/erp/compta/suppliers').send({ name: 'Plombier sans compte', kind: 'sous_traitant' })).body;
  await db('contracts').where({ id: c.id }).update({ supplier_id: bare.id });
  res = await conducteur.post(`${W}/${worksite.id}/marches/${c.id}/situations`).field('period_end', day(0)).field('cumulative_pct', '20');
  const sid = res.body.find(x => x.id === c.id).situations[0].id;
  await conducteur.post(`${W}/${worksite.id}/situations/${sid}/verifier`);
  res = await admin.post(`${W}/${worksite.id}/situations/${sid}/valider`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /compte de charge/);
});

test('assiette de la retenue réglable : HT ou TTC, conservée sur chaque situation', async () => {
  assert.equal(situationAmounts({ contractAmount: 10000000, cumulativePct: 10, vatRate: 18, retentionPct: 5, retentionBase: 'ht' }).retention_amount, 50000);
  assert.equal(situationAmounts({ contractAmount: 10000000, cumulativePct: 10, vatRate: 18, retentionPct: 5 }).retention_amount, 59000, 'TTC par défaut');
  assert.equal((await conducteur.put(`${W}/reglages`).send({ chantier_retention_base: 'net' })).status, 400);
  let res = await conducteur.put(`${W}/reglages`).send({ chantier_retention_base: 'ht' });
  assert.equal(res.body.chantier_retention_base, 'ht');
  assert.equal((await conducteur.get(`${W}/refs`)).body.settings.chantier_retention_base, 'ht', 'relu après enregistrement');
  res = await conducteur.post('/api/admin/erp/contrats').field('kind', 'sous_traitance').field('title', 'Lot menuiserie').field('supplier_id', String(supplier.id))
    .field('start_date', day(-5)).field('worksite_id', String(worksite.id)).field('contract_amount', '4000000').field('vat_rate', '18');
  const c = await db('contracts').where({ title: 'Lot menuiserie' }).first();
  res = await conducteur.post(`${W}/${worksite.id}/marches/${c.id}/situations`).field('period_end', day(0)).field('cumulative_pct', '50');
  const s = res.body.find(x => x.id === c.id).situations[0];
  assert.deepEqual([s.retention_base, s.amount_ht, s.retention_amount, s.net_payable], ['ht', 2000000, 100000, 2260000], '5 % de 2 000 000 HT ; net = TTC − retenue');
  // Les situations déjà enregistrées gardent leur assiette
  const old = (await conducteur.get(`${W}/${worksite.id}/sous-traitants`)).body.find(x => x.id === market.id).situations[0];
  assert.equal(old.retention_base, 'ttc');
  await conducteur.put(`${W}/reglages`).send({ chantier_retention_base: 'ttc' });
});
