const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { depreciationAt, depreciationFor, costAccountingStatus } = require('../src/lib/domain');

let db, app, resp, comptable, commercial, ids, project, supplier, station, employee, vehicle, fy;
const P = '/api/admin/erp/parc';
const C = '/api/admin/erp/compta';
const year = new Date().getUTCFullYear();
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const id = r => (typeof r === 'object' ? r.id : r);

before(async () => {
  ({ db, app } = await setup());
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').orderBy('id').first();
  supplier = id((await db('suppliers').insert({ name: 'Garage Central', kind: 'prestataire' }))[0]);
  station = id((await db('suppliers').insert({ name: 'Station TotalEnergies Riviera', kind: 'fournisseur' }))[0]);
  employee = id((await db('employees').insert({ matricule: 'E-PC', last_name: 'Koné', first_name: 'Ali', hire_date: '2024-01-01', department: 'chantier', job_title: 'Chauffeur', base_salary: 200000 }))[0]);
  fy = (await comptable.post(`${C}/fiscal-years`).send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` })).body;
  const res = await resp.post(`${P}/assets`).send({ kind: 'vehicule', name: 'Toyota Hilux', plate: '1234 AB 01', meter_value: 1000 });
  vehicle = res.body;
  await resp.post(`${P}/assets/${vehicle.id}/assign`).send({ kind: 'chantier', project_id: project.id, date: day(-30) });
});
after(() => db.destroy());

test('règles : état comptable d’une dépense, amortissement linéaire au prorata avec reprise', () => {
  assert.equal(costAccountingStatus({ accounting: 'facture', doc_status: 'brouillon' }), 'a_valider');
  assert.equal(costAccountingStatus({ accounting: 'facture', doc_status: null }), 'rejetee', 'facture supprimée');
  assert.equal(costAccountingStatus({ accounting: 'ecriture', doc_status: 'valide' }), 'validee');
  assert.equal(costAccountingStatus({ accounting: 'frais' }), 'note_de_frais');
  assert.equal(costAccountingStatus({ accounting: null }), null);
  const a = { fixed_value: 12000000, in_service_on: '2026-01-01', depreciation_years: 4 };
  assert.equal(depreciationFor(a, '2026-01-01', '2026-12-31'), 3000000);
  assert.equal(depreciationAt(a, '2031-01-01'), 12000000, 'plafonné à la valeur');
  const repris = { fixed_value: 12000000, in_service_on: '2024-01-01', depreciation_years: 4, prior_depreciation: 6000000, prior_as_of: '2025-12-31' };
  assert.equal(depreciationFor(repris, '2026-01-01', '2026-12-31'), 3000000);
  assert.equal(depreciationFor({ ...a, disposed_on: '2026-06-30' }, '2026-01-01', '2026-12-31'), 1487671, 'arrêté à la sortie');
});

test('facture du fournisseur : facture d’achat en brouillon au chantier, une seule validation par le comptable', async () => {
  assert.equal((await resp.post(`${P}/assets/${vehicle.id}/costs`).send({ kind: 'reparation', date: day(-2), amount: 236000 })).status, 400, 'paiement obligatoire');
  assert.equal((await resp.post(`${P}/assets/${vehicle.id}/costs`).send({ kind: 'reparation', date: day(-2), amount: 236000, payment_mode: 'fournisseur' })).status, 400, 'fournisseur obligatoire');
  let res = await resp.post(`${P}/assets/${vehicle.id}/costs`).send({ kind: 'reparation', date: day(-2), amount: 236000, vat_rate: 18, payment_mode: 'fournisseur', supplier_id: supplier, label: 'Embrayage' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const cost = res.body.costs[0];
  assert.equal(cost.status, 'a_valider');
  assert.equal(cost.project_id, project.id);
  const inv = await db('purchase_invoices').where({ id: cost.purchase_invoice_id }).first();
  assert.equal(inv.status, 'brouillon');
  assert.equal(Number(inv.amount_ht), 200000);
  assert.equal(inv.project_id, project.id);
  assert.equal((await db('acc_accounts').where({ id: inv.expense_account_id }).first()).code, '624', 'entretien et réparations');
  assert.ok(await db('notifications').where({ user_id: ids.comptable, event: 'parc.depense' }).first(), 'comptable prévenu');

  assert.equal((await commercial.get(`${P}/compta/depenses`)).status, 403);
  assert.equal((await comptable.get(`${P}/compta/depenses`)).body.length, 1);
  assert.equal((await resp.post(`${P}/costs/${cost.id}/validate`)).status, 403, 'le comptable valide');
  res = await comptable.post(`${P}/costs/${cost.id}/validate`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'validee');
  assert.equal((await db('purchase_invoices').where({ id: inv.id }).first()).status, 'validee');
  assert.ok(await db('acc_entries').where({ source_key: `purchase:${inv.id}` }).first(), 'écriture d’achat');
  assert.equal((await resp.delete(`${P}/costs/${cost.id}`)).status, 409, 'validée : ne se supprime plus');
});

test('espèces : écriture de caisse en brouillon ; rejet avec motif ; suppression d’une dépense à valider', async () => {
  let res = await resp.post(`${P}/assets/${vehicle.id}/costs`).send({ kind: 'taxes', date: day(-1), amount: 45000, payment_mode: 'caisse', label: 'Vignette' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const cost = res.body.costs.find(c => c.kind === 'taxes');
  const entry = await db('acc_entries as e').join('acc_journals as j', 'j.id', 'e.journal_id').where('e.id', cost.entry_id).first('e.*', 'j.code');
  assert.equal(entry.code, 'CA');
  assert.equal(entry.status, 'brouillon');
  assert.equal((await comptable.post(`${P}/costs/${cost.id}/reject`).send({ reason: '' })).status, 400, 'motif obligatoire');
  res = await comptable.post(`${P}/costs/${cost.id}/reject`).send({ reason: 'Vignette déjà payée par le siège' });
  assert.equal(res.body.status, 'rejetee');
  assert.equal(await db('acc_entries').where({ id: cost.entry_id }).first(), undefined, 'brouillon supprimé');
  assert.ok(await db('notifications').where({ user_id: ids.resp_exploitation, event: 'parc.depense_rejetee' }).first(), 'auteur prévenu');

  res = await resp.post(`${P}/assets/${vehicle.id}/costs`).send({ kind: 'pneus', date: day(0), amount: 180000, payment_mode: 'fournisseur', supplier_id: supplier });
  const pneus = res.body.costs.find(c => c.kind === 'pneus');
  res = await resp.delete(`${P}/costs/${pneus.id}`);
  assert.equal(res.status, 200);
  assert.equal(await db('purchase_invoices').where({ id: pneus.purchase_invoice_id }).first(), undefined, 'facture en brouillon supprimée avec la dépense');
});

test('carte carburant prépayée : recharge (avance à la station), pleins, solde contrôlé ; avance de l’employé', async () => {
  assert.equal((await resp.post(`${P}/cartes`).send({ label: 'Carte Total 01', supplier_id: station })).status, 403);
  let res = await comptable.post(`${P}/cartes`).send({ label: 'Carte Total 01', number: '…4521', supplier_id: station });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const card = res.body[0];
  const bq = (await db('acc_journals').where({ code: 'BQ' }).first()).id;
  res = await comptable.post(`${P}/cartes/${card.id}/recharges`).send({ date: day(-5), amount: 100000, journal_id: bq, reference: 'VIR 778' });
  assert.equal(res.body[0].balance, 100000);
  const load = await db('acc_entries').where({ source_key: `fuel_load:${res.body[0].loads[0].id}` }).first();
  assert.ok(load, 'écriture de recharge');

  res = await resp.post(`${P}/assets/${vehicle.id}/costs`).send({ kind: 'carburant', date: day(-1), amount: 60000, liters: 75, meter_value: 1400, payment_mode: 'carte', fuel_card_id: card.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const plein = res.body.costs.find(c => c.kind === 'carburant');
  const lines = await db('acc_lines as l').join('acc_accounts as a', 'a.id', 'l.account_id').where('l.entry_id', plein.entry_id).select('a.code', 'l.debit', 'l.credit');
  assert.deepEqual(lines.map(l => [l.code, Number(l.debit), Number(l.credit)]).sort(), [['4091', 0, 60000], ['605', 60000, 0]]);
  res = await resp.post(`${P}/assets/${vehicle.id}/costs`).send({ kind: 'carburant', date: day(0), amount: 50000, liters: 60, payment_mode: 'carte', fuel_card_id: card.id });
  assert.equal(res.status, 409, 'solde insuffisant');
  assert.equal((await comptable.get(`${P}/cartes`)).body[0].balance, 40000);

  // L'employé a payé : remboursé par sa note de frais, pas de pièce créée par le Parc
  res = await resp.post(`${P}/assets/${vehicle.id}/costs`).send({ kind: 'autre', date: day(0), amount: 5000, payment_mode: 'employe', employee_id: employee, label: 'Lavage' });
  assert.equal(res.body.costs.find(c => c.label === 'Lavage').status, 'note_de_frais');
});

test('immobilisations : reprise, dotations à la clôture (obligatoires), sortie de l’actif ; échéances à payer', async () => {
  assert.equal((await resp.patch(`${P}/assets/${vehicle.id}/immobilisation`).send({ fixed_value: 18000000, in_service_on: `${year}-01-01` })).status, 403);
  assert.equal((await comptable.patch(`${P}/assets/${vehicle.id}/immobilisation`).send({ fixed_value: 18000000 })).status, 400, 'mise en service requise');
  let res = await comptable.patch(`${P}/assets/${vehicle.id}/immobilisation`).send({ fixed_value: 18000000, in_service_on: `${year - 2}-01-01`, prior_depreciation: 9000000, prior_as_of: `${year - 1}-12-31` });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = res.body.fixed.find(a => a.id === vehicle.id);
  assert.equal(row.depreciation_years, 4, 'durée par défaut des véhicules');
  assert.equal(row.account, '245');
  assert.equal(row.year_dotation, 4500000);

  assert.equal((await comptable.post(`${C}/fiscal-years/${fy.id}/close`)).status, 409, 'dotations à passer avant la clôture');
  res = await comptable.post(`${P}/immobilisations/dotations`).send({ fiscal_year_id: fy.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const e = await db('acc_entries').where({ source_key: `dotations:${fy.id}` }).first();
  const lines = await db('acc_lines as l').join('acc_accounts as a', 'a.id', 'l.account_id').where('l.entry_id', e.id).select('a.code', 'l.debit', 'l.credit');
  assert.deepEqual(lines.map(l => [l.code, Number(l.debit), Number(l.credit)]).sort(), [['284', 0, 4500000], ['681', 4500000, 0]]);
  // Repassées tant qu'en brouillon : une seule écriture
  await comptable.post(`${P}/immobilisations/dotations`).send({ fiscal_year_id: fy.id });
  assert.equal((await db('acc_entries').where({ source_key: `dotations:${fy.id}` })).length, 1);

  // Sortie de l'actif avec prix de cession encaissé en banque
  const bq = (await db('acc_journals').where({ code: 'BQ' }).first()).id;
  res = await comptable.post(`${P}/assets/${vehicle.id}/sortie`).send({ date: `${year}-06-30`, price: 7000000, journal_id: bq });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const out = await db('acc_entries').where({ source_key: `disposal:${vehicle.id}` }).first();
  const ol = await db('acc_lines as l').join('acc_accounts as a', 'a.id', 'l.account_id').where('l.entry_id', out.id).select('a.code', 'l.debit', 'l.credit');
  const d = Object.fromEntries(ol.map(l => [l.code, Number(l.debit) - Number(l.credit)]));
  assert.equal(d['245'], -18000000);
  assert.equal(d['284'] + d['81'], 18000000, 'cumul + valeur nette = valeur d’origine');
  assert.equal(d['82'], -7000000);
  assert.equal((await db('assets').where({ id: vehicle.id }).first()).status, 'reforme');

  // Échéance administrative avec montant à prévoir : visible dans la trésorerie de la Comptabilité
  const other = (await resp.post(`${P}/assets`).send({ kind: 'vehicule', name: 'Renault Duster' })).body;
  await resp.post(`${P}/assets/${other.id}/documents`).send({ kind: 'assurance', label: 'Assurance tous risques', expires_on: day(20), amount_estimate: 650000 });
  res = await comptable.get(`${P}/a-payer?days=60`);
  assert.equal(res.body.total, 650000);
  assert.equal(res.body.items[0].label, 'Assurance tous risques');
});
