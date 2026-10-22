const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const { contractDeadlines, contractAlertStage, renewedEnd, contractPaymentsDue } = require('../src/lib/domain');
const contracts = require('../src/services/contracts');

let db, app, resp, juridique, comptable, commercial, supplier, ids;
const URL = '/api/admin/erp/contrats';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  ({ db, app } = await setup());
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  juridique = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  const acc = await db('acc_accounts').where('code', 'like', '6%').where('code', '>=', '62').orderBy('code').first();
  const [s] = await db('suppliers').insert({ name: 'Gardiennage Sécurité Plus', kind: 'prestataire', expense_account_id: acc.id });
  supplier = typeof s === 'object' ? s.id : s;
});
after(() => db.destroy());

test('règles : échéances suivies, paliers 30 puis 7 jours, renouvellement tacite, paiements à préparer', () => {
  const c = { status: 'actif', end_date: '2027-06-30', notice_days: 90, revision_date: '2027-01-01', frequency: 'mensuel', next_payment_date: '2026-11-05', amount_ttc: 100 };
  const keys = contractDeadlines(c, [{ id: 4, label: 'Attestation d’assurance', expires_on: '2026-12-01' }]).map(d => `${d.key}@${d.date}`);
  assert.deepEqual(keys, ['paiement@2026-11-05', 'piece:4@2026-12-01', 'revision@2027-01-01', 'preavis@2027-04-01', 'fin@2027-06-30']);
  assert.equal(contractAlertStage('2026-12-01', '2026-10-01'), null);
  assert.equal(contractAlertStage('2026-12-01', '2026-11-01'), 30);
  assert.equal(contractAlertStage('2026-12-01', '2026-11-25'), 7);
  assert.equal(contractAlertStage('2026-12-01', '2026-12-03'), 7, 'dépassée : palier 7');
  assert.equal(renewedEnd({ tacit_renewal: true, end_date: '2026-10-01', renewal_months: 12 }, '2026-10-02'), '2027-10-01');
  assert.equal(renewedEnd({ tacit_renewal: false, end_date: '2026-10-01' }, '2026-10-02'), null);
  // 7 jours avant : la facture du 05/11 est préparée le 29/10, pas celle de décembre
  assert.deepEqual(contractPaymentsDue(c, '2026-10-29'), { dates: ['2026-11-05'], next: '2026-12-05' });
  assert.deepEqual(contractPaymentsDue(c, '2026-10-20').dates, []);
  assert.equal(contractPaymentsDue({ ...c, end_date: '2026-11-30' }, '2026-10-29').next, null, 'plus rien après la fin');
});

test('droits : juridique et responsable d’exploitation saisissent, le comptable consulte, le responsable nommé voit le sien', async () => {
  const body = { kind: 'fournisseur', title: 'Gardiennage du siège', supplier_id: supplier, start_date: day(-100), owner_id: ids.commercial };
  assert.equal((await comptable.post(URL).send(body)).status, 403);
  let res = await juridique.post(URL).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.reference, /^CTR-\d{4}-0001$/);
  assert.equal((await comptable.get(`${URL}/${res.body.id}`)).status, 200);
  assert.equal((await commercial.get(URL)).body.length, 1, 'le responsable nommé voit son contrat');
  await db('contracts').where({ id: res.body.id }).update({ owner_id: null });
  assert.equal((await commercial.get(`${URL}/${res.body.id}`)).status, 404);
  assert.equal((await resp.post(URL).send({ kind: 'autre', title: 'Convention', counterparty: 'X', start_date: day(0) })).status, 400, 'autre : nature à préciser');
  assert.equal((await resp.post(URL).send({ kind: 'bail', title: 'Bail', start_date: day(0) })).status, 400, 'cocontractant obligatoire');
});

test('paiement périodique : facture d’achat en brouillon 7 jours avant, une seule fois ; prochaine échéance avancée', async () => {
  assert.equal((await resp.post(URL).send({ kind: 'bail', title: 'Bail dépôt', counterparty: 'M. Koné', start_date: day(-30), frequency: 'mensuel', amount_ttc: 500000, next_payment_date: day(5) })).status, 400, 'fournisseur requis');
  const res = await resp.post(URL).send({ kind: 'fournisseur', title: 'Gardiennage chantier', supplier_id: supplier, start_date: day(-30), frequency: 'mensuel', amount_ttc: 1180000, vat_rate: 18, next_payment_date: day(5) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await contracts.tick(db, day(0));
  await contracts.tick(db, day(0));
  const inv = await db('purchase_invoices').where({ supplier_ref: res.body.reference });
  assert.equal(inv.length, 1);
  assert.equal(inv[0].status, 'brouillon');
  assert.equal(Number(inv[0].amount_ttc), 1180000);
  assert.equal(Number(inv[0].amount_ht), 1000000);
  const d = (await resp.get(`${URL}/${res.body.id}`)).body;
  assert.equal(d.invoices.length, 1);
  assert.ok(d.next_payment_date > day(5), 'échéance suivante');
});

test('alertes 30 puis 7 jours avant au responsable et au responsable d’exploitation ; renouvellement tacite ; fin', async () => {
  let res = await juridique.post(URL).send({ kind: 'assurance', title: 'Multirisque bureaux', counterparty: 'NSIA Assurances', start_date: day(-340), end_date: day(25), notice_days: 0, owner_id: ids.comptable });
  const id = res.body.id;
  sent.length = 0;
  await contracts.tick(db, day(0));
  const mine = sent.filter(m => m.subject.includes(res.body.reference));
  assert.ok(mine.some(m => m.to === 'comptable@test.ci') && mine.some(m => m.to === 'resp_exploitation@test.ci'), mine.map(m => m.to).join(','));
  sent.length = 0;
  await contracts.tick(db, day(1));
  assert.equal(sent.filter(m => m.subject.includes(res.body.reference)).length, 0, 'pas deux fois le même palier');
  await contracts.tick(db, day(20));
  assert.ok(sent.some(m => m.subject.includes(res.body.reference)), 'palier de 7 jours');

  // Pièce à renouveler : apparaît dans les échéances
  res = await juridique.post(`${URL}/${id}/documents`).send({ kind: 'attestation_assurance', label: 'Attestation 2026', expires_on: day(10) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const list = (await comptable.get(`${URL}/echeances?days=30`)).body;
  assert.ok(list.some(e => e.kind === 'piece' && e.contract_id === id));

  // Tacite reconduction : prolongée d'un an ; sans reconduction : terminée
  await db('contracts').where({ id }).update({ end_date: day(-1), tacit_renewal: true, renewal_months: 12 });
  await contracts.tick(db, day(0));
  assert.ok((await db('contracts').where({ id }).first()).end_date > day(300));
  await db('contracts').where({ id }).update({ end_date: day(-1), tacit_renewal: false });
  await contracts.tick(db, day(0));
  assert.equal((await db('contracts').where({ id }).first()).status, 'termine');
  assert.equal((await juridique.post(`${URL}/${id}/reopen`)).status, 200);
  res = await juridique.post(`${URL}/${id}/close`).send({ status: 'resilie', date: day(0) });
  assert.equal(res.status, 400, 'motif obligatoire');
  res = await juridique.post(`${URL}/${id}/close`).send({ status: 'resilie', date: day(0), reason: 'Changement d’assureur' });
  assert.equal(res.body.status, 'resilie');
});
