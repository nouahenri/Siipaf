const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { checkEntry, splitVat } = require('../src/lib/compta');

let db, app, admin, comptable, commercial, project, lots, fy;
const C = '/api/admin/erp/compta';
const year = new Date().getFullYear();
const sum = (lines, k) => lines.reduce((t, l) => t + l[k], 0);
const byAccount = (lines, code) => lines.filter(l => l.account_code === code);

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'K1', price_fcfa: 20000000 }, { code: 'K2', price_fcfa: 30000000 }]);
  lots = await db('lots').where({ project_id: project.id }).whereIn('code', ['K1', 'K2']).orderBy('code');
});
after(() => db.destroy());

test('règles : écriture équilibrée en francs entiers, ventilation HT / TVA', () => {
  assert.deepEqual(checkEntry([{ debit: 100 }, { credit: 100 }]), []);
  assert.match(checkEntry([{ debit: 100 }, { credit: 90 }]).join(' '), /déséquilibrée/);
  assert.match(checkEntry([{ debit: 100, credit: 100 }]).join(' '), /au moins deux lignes/);
  assert.deepEqual(splitVat(1180000, 18), { ht: 1000000, vat: 180000 });
  assert.deepEqual(splitVat(500000, 0), { ht: 500000, vat: 0 });
});

test('droits : le comptable tient la comptabilité, le commercial n’y a pas accès', async () => {
  assert.equal((await comptable.get(`${C}/meta`)).status, 200);
  assert.equal((await commercial.get(`${C}/meta`)).status, 403);
  const accounts = (await comptable.get(`${C}/accounts?q=4191`)).body;
  assert.equal(accounts[0].label, 'Clients, avances et acomptes reçus');
  assert.equal(accounts[0].partner_kind, 'client');
});

test('exercice obligatoire, saisie manuelle, validation numérotée, intangibilité et contrepassation', async () => {
  const od = (await db('acc_journals').where({ code: 'OD' }).first()).id;
  const entry = { journal_id: od, date: `${year}-02-10`, label: 'Frais bancaires', lines: [{ account: '631', debit: 5000 }, { account: '521100', credit: 5000 }] };
  assert.equal((await comptable.post(`${C}/entries`).send(entry)).status, 409, 'aucun exercice');
  assert.equal((await comptable.post(`${C}/sync`)).body.no_fiscal_year, true);

  let res = await comptable.post(`${C}/fiscal-years`).send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  fy = res.body;
  assert.equal((await comptable.post(`${C}/fiscal-years`).send({ label: 'Chevauche', start_date: `${year}-06-01`, end_date: `${year + 1}-05-31` })).status, 409, 'chevauchement');

  assert.equal((await comptable.post(`${C}/entries`).send({ ...entry, lines: [{ account: '631', debit: 5000 }, { account: '521100', credit: 4000 }] })).status, 400);
  res = await comptable.post(`${C}/entries`).send(entry);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'brouillon');
  assert.equal(res.body.number, null);
  const id = res.body.id;
  res = await comptable.post(`${C}/entries/validate`).send({ ids: [id] });
  assert.equal(res.body.validated, 1);
  const e = (await comptable.get(`${C}/entries/${id}`)).body;
  assert.equal(e.number, `OD-${year}-00001`);
  assert.equal((await comptable.patch(`${C}/entries/${id}`).send({ label: 'Modifié' })).status, 409, 'intangible');
  assert.equal((await comptable.delete(`${C}/entries/${id}`)).status, 409);
  res = await comptable.post(`${C}/entries/${id}/reverse`).send({ date: `${year}-02-11` });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(byAccount(res.body.lines, '631')[0].credit, 5000, 'débit et crédit inversés');
  assert.equal((await comptable.post(`${C}/entries/${id}/reverse`)).status, 409, 'une seule contrepassation');
});

let saleA, saleV;
test('écritures automatiques : versements en avances, vente constatée à l’acte, puis créance client', async () => {
  let res = await admin.post(`/api/admin/lots/${lots[0].id}/sale`).send({ name: 'Adjoua Brou', phone: '0705050505', financing: 'comptant', reserved_at: `${year}-03-01` });
  saleA = res.body;
  await comptable.post(`/api/admin/sales/${saleA.id}/payments`).send({ amount_fcfa: 6000000, paid_at: `${year}-03-02`, method: 'virement', reference: 'VIR-1' });
  res = await comptable.post(`${C}/sync`);
  assert.equal(res.body.created, 1, JSON.stringify(res.body));
  let entries = (await comptable.get(`${C}/entries?source=versement`)).body.rows;
  let detail = (await comptable.get(`${C}/entries/${entries[0].id}`)).body;
  assert.equal(detail.journal_code, 'BQ');
  assert.equal(byAccount(detail.lines, '521100')[0].debit, 6000000);
  assert.equal(byAccount(detail.lines, '4191')[0].credit, 6000000, 'avance client tant que l’acte n’est pas signé');
  assert.match(byAccount(detail.lines, '4191')[0].partner_name, /Adjoua Brou/);
  assert.equal(byAccount(detail.lines, '4191')[0].project_id, project.id, 'analytique : programme');

  await admin.patch(`/api/admin/sales/${saleA.id}`).send({ signed_at: `${year}-04-15` });
  await comptable.post(`/api/admin/sales/${saleA.id}/payments`).send({ amount_fcfa: 4000000, paid_at: `${year}-04-20`, method: 'mobile_money' });
  res = await comptable.post(`${C}/sync`);
  assert.equal(res.body.created, 2, JSON.stringify(res.body));
  const sale = (await comptable.get(`${C}/entries?source=vente`)).body.rows[0];
  detail = (await comptable.get(`${C}/entries/${sale.id}`)).body;
  assert.equal(detail.date, `${year}-04-15`);
  assert.equal(byAccount(detail.lines, '4191')[0].debit, 6000000, 'les avances soldent la vente');
  assert.equal(byAccount(detail.lines, '4111')[0].debit, 14000000, 'le reste devient une créance');
  assert.equal(byAccount(detail.lines, '702110')[0].credit, 20000000);
  entries = (await comptable.get(`${C}/entries?source=versement`)).body.rows;
  detail = (await comptable.get(`${C}/entries/${entries.find(e => e.date === `${year}-04-20`).id}`)).body;
  assert.equal(detail.journal_code, 'MM');
  assert.equal(byAccount(detail.lines, '4111')[0].credit, 4000000, 'après l’acte, le versement solde la créance');
  assert.equal((await comptable.post(`${C}/sync`)).body.created, 0, 'pas de doublon');
});

test('VEFA à l’avancement : chaque appel de fonds émis est facturé', async () => {
  const lead = (await admin.post('/api/admin/leads').send({ name: 'Moussa Kéita', phone: '0706060606' })).body;
  let res = await admin.post(`/api/admin/lots/${lots[1].id}/sale`).send({ lead_id: lead.id, vefa: true, signed_at: `${year}-05-02`, reserved_at: `${year}-05-01` });
  saleV = res.body;
  res = await comptable.post(`${C}/sync`);
  assert.equal(res.body.created, 1);
  const call = (await comptable.get(`${C}/entries?source=appel_fonds`)).body.rows[0];
  const detail = (await comptable.get(`${C}/entries/${call.id}`)).body;
  assert.equal(detail.journal_code, 'VT');
  assert.equal(byAccount(detail.lines, '4111')[0].debit, 3000000, 'appel de 10 % à la signature');
  assert.equal(byAccount(detail.lines, '702110')[0].credit, 3000000);
});

test('versement supprimé dans le dashboard : brouillon retiré, écriture validée contrepassée', async () => {
  const p = (await comptable.post(`/api/admin/sales/${saleV.id}/payments`).send({ amount_fcfa: 1000000, paid_at: `${year}-05-10`, method: 'especes' })).body;
  await comptable.post(`${C}/sync`);
  const payId = (await db('payments').where({ sale_id: saleV.id }).first()).id;
  assert.ok(await db('acc_entries').where({ source_key: `payment:${payId}` }).first());
  await comptable.delete(`/api/admin/payments/${payId}`);
  let res = await comptable.post(`${C}/sync`);
  assert.equal(res.body.removed, 1, JSON.stringify(res.body));
  assert.equal(await db('acc_entries').where({ source_key: `payment:${payId}` }).first(), undefined);

  await comptable.post(`/api/admin/sales/${saleV.id}/payments`).send({ amount_fcfa: 1500000, paid_at: `${year}-05-12`, method: 'especes' });
  await comptable.post(`${C}/sync`);
  const pay2 = (await db('payments').where({ sale_id: saleV.id }).first()).id;
  const e = await db('acc_entries').where({ source_key: `payment:${pay2}` }).first();
  await comptable.post(`${C}/entries/validate`).send({ ids: [e.id] });
  await comptable.delete(`/api/admin/payments/${pay2}`);
  res = await comptable.post(`${C}/sync`);
  assert.equal(res.body.reversed, 1);
  assert.ok(await db('acc_entries').where({ reversal_of: e.id }).first());
  assert.ok(p);
});

test('achats : facture fournisseur par programme, TVA récupérable, règlements', async () => {
  let res = await comptable.post(`${C}/suppliers`).send({ name: 'BTP Ivoire Construction', kind: 'sous_traitant', expense_account: '621100' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const sup = res.body;
  res = await comptable.post(`${C}/purchases`).send({ supplier_id: sup.id, date: `${year}-06-01`, due_date: `${year}-06-30`, label: 'Gros œuvre lot K2', project_id: project.id, expense_account: '621100', amount_ttc: 1180000, vat_rate: 18 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const inv = res.body;
  assert.equal(inv.number, `ACH-${year}-0001`);
  assert.deepEqual([inv.amount_ht, inv.vat_amount], [1000000, 180000]);
  assert.equal((await comptable.post(`${C}/purchases/${inv.id}/payments`).send({ date: `${year}-06-05`, amount: 1000, journal_id: 1 })).status, 409, 'valider d’abord');
  res = await comptable.post(`${C}/purchases/${inv.id}/validate`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const entry = await db('acc_entries').where({ source_key: `purchase:${inv.id}` }).first();
  const lines = (await comptable.get(`${C}/entries/${entry.id}`)).body.lines;
  assert.equal(byAccount(lines, '621100')[0].debit, 1000000);
  assert.equal(byAccount(lines, '4452')[0].debit, 180000);
  assert.equal(byAccount(lines, '4011')[0].credit, 1180000);
  const bq = (await db('acc_journals').where({ code: 'BQ' }).first()).id;
  res = await comptable.post(`${C}/purchases/${inv.id}/payments`).send({ date: `${year}-06-10`, amount: 500000, journal_id: bq, reference: 'CHQ 1234' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.remaining_fcfa, 680000);
  assert.equal((await comptable.post(`${C}/purchases/${inv.id}/payments`).send({ date: `${year}-06-11`, amount: 700000, journal_id: bq })).status, 400, 'pas plus que le reste dû');
  assert.equal((await comptable.get(`${C}/purchases/${inv.id}`)).body.payment_status, 'partielle');
  const s = (await comptable.get(`${C}/suppliers`)).body.find(x => x.id === sup.id);
  assert.equal(s.balance, 680000, 'dette envers le fournisseur');
});

test('états : balance équilibrée, compte de résultat, marge par programme, TVA, grand livre, export Sage', async () => {
  const q = '?draft=1';
  const tb = (await comptable.get(`${C}/reports/balance${q}`)).body;
  assert.equal(sum(tb, 'debit'), sum(tb, 'credit'), 'balance équilibrée');
  const st = (await comptable.get(`${C}/reports/statements${q}`)).body;
  assert.equal(st.revenue, 23000000, 'vente constatée + appel de fonds');
  assert.equal(st.total_actif, st.total_passif, 'bilan équilibré');
  const m = (await comptable.get(`${C}/reports/margins${q}`)).body.find(x => x.project_id === project.id);
  assert.deepEqual([m.produits, m.charges, m.marge], [23000000, 1000000, 22000000]);
  const vat = (await comptable.get(`${C}/reports/vat${q}`)).body;
  assert.equal(vat.find(x => x.month === `${year}-06`).deductible, 180000);
  const gl = (await comptable.get(`${C}/reports/ledger?account=4111&draft=1`)).body;
  assert.equal(gl.closing, 14000000 - 4000000 + 3000000, 'créances : vente moins versement après l’acte, plus l’appel VEFA');

  const clients = (await comptable.get(`${C}/reports/partners?kind=client&draft=1`)).body;
  assert.ok(clients.some(c => /Moussa Kéita/.test(c.name)));

  assert.equal((await comptable.post(`${C}/entries/validate`).send({ until: `${year}-12-31` })).body.errors.length, 0);
  const res = await comptable.get(`${C}/export/sage?from=${year}-01-01&to=${year}-12-31`);
  assert.equal(res.status, 200);
  const rows = res.text.replace(/^﻿/, '').trim().split('\n');
  assert.equal(rows[0], 'Journal;Date;Piece;Compte general;Compte tiers;Libelle;Debit;Credit;Reference');
  assert.ok(rows.some(r => r.startsWith(`VT;15/04/${year}`) || r.startsWith(`VT;1504${year}`)), 'date au format choisi');
  assert.ok(rows.some(r => r.includes(';4111;SIIPAF-')), 'compte tiers = code client');
  assert.equal((await commercial.get(`${C}/export/sage`)).status, 403);
});

test('verrouillage et clôture : plus aucune écriture dans la période', async () => {
  const od = (await db('acc_journals').where({ code: 'OD' }).first()).id;
  let res = await comptable.patch(`${C}/fiscal-years/${fy.id}`).send({ lock_date: `${year}-06-30` });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  res = await comptable.post(`${C}/entries`).send({ journal_id: od, date: `${year}-06-15`, label: 'Trop tard', lines: [{ account: '631', debit: 100 }, { account: '571100', credit: 100 }] });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /verrouillée/);
  res = await comptable.post(`${C}/fiscal-years/${fy.id}/close`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await comptable.post(`${C}/entries`).send({ journal_id: od, date: `${year}-11-15`, label: 'Après clôture', lines: [{ account: '631', debit: 100 }, { account: '571100', credit: 100 }] })).status, 409);

  // À-nouveaux de l'exercice suivant : soldes de bilan et résultat
  const next = (await comptable.post(`${C}/fiscal-years`).send({ label: String(year + 1), start_date: `${year + 1}-01-01`, end_date: `${year + 1}-12-31` })).body;
  res = await comptable.post(`${C}/fiscal-years/${next.id}/opening-from/${fy.id}`);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(sum(res.body.lines, 'debit'), sum(res.body.lines, 'credit'));
  assert.ok(byAccount(res.body.lines, '131').length, 'bénéfice reporté en 131');
});
