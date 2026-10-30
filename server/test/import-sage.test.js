/**
 * Import d'un fichier Sage (point 4 du client du 29/10) : plan comptable, écritures, soldes d'ouverture ;
 * simulation d'abord, comptes Sage sur 8 chiffres rapprochés du plan, réimport sans doublon, tout ou rien.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { parseDate, parseAmount } = require('../src/services/sageImport');

const C = '/api/admin/erp/compta';
let db, app, comptable, commercial, fy;
const year = new Date().getFullYear() - 1;
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
const rowsOf = lines => lines.map((cells, i) => ({ line: i + 2, cells }));

before(async () => {
  ({ db, app } = await setup());
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  fy = ok(await comptable.post(`${C}/fiscal-years`).send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` }), 201);
});
after(() => db.destroy());

test('lecture : dates et montants au format Sage', () => {
  assert.equal(parseDate('15032025', 'JJMMAAAA'), '2025-03-15');
  assert.equal(parseDate('150325', 'JJMMAA'), '2025-03-15');
  assert.equal(parseDate('15/03/2025', 'JJ/MM/AAAA'), '2025-03-15');
  assert.equal(parseDate('20250315', 'AAAAMMJJ'), '2025-03-15');
  assert.equal(parseDate('31022025', 'JJMMAAAA'), null);
  assert.equal(parseAmount('1 500 000,00', ','), 1500000);
  assert.equal(parseAmount('1500000.00', '.'), 1500000);
  assert.equal(parseAmount('-250,00', ','), -250);
});

test('plan comptable : comptes sur 8 chiffres rapprochés, comptes nouveaux créés sous leur parent', async () => {
  const rows = rowsOf([['52110000', 'Banque principale'], ['41100000', 'Clients'], ['40110001', 'Fournisseur Béton Plus'], ['99999', 'Sans parent']]);
  const body = { kind: 'plan', rows, mapping: { account: 0, label: 1 }, headers: ['Compte', 'Intitulé'] };
  assert.equal((await commercial.post(`${C}/import/sage`).send(body)).status, 403);
  const sim = ok(await comptable.post(`${C}/import/sage`).send(body));
  assert.equal(sim.summary.known, 2, '521100 et 411 reconnus malgré les zéros de fin');
  assert.equal(sim.summary.to_create, 1);
  assert.ok(sim.errors.some(e => /99999/.test(e.message)));
  // Une erreur bloque l'enregistrement : rien n'est créé
  ok(await comptable.post(`${C}/import/sage`).send({ ...body, dry_run: false }));
  assert.equal(await db('acc_accounts').where({ code: '40110001' }).first(), undefined);
  const done = ok(await comptable.post(`${C}/import/sage`).send({ ...body, rows: rows.slice(0, 3), dry_run: false }), 201);
  assert.equal(done.summary.created, 1);
  assert.equal((await db('acc_accounts').where({ code: '40110001' }).first()).partner_kind, 'fournisseur');
  // Correspondance des colonnes mémorisée pour le prochain import
  assert.deepEqual(ok(await comptable.get(`${C}/import/sage`)).saved.plan.mapping, { account: 'Compte', label: 'Intitulé' });
});

test('écritures : regroupées par pièce, contrôlées, réimport sans doublon, validation au choix', async () => {
  const d = `1503${year}`;
  const lines = [
    ['BQ', d, 'P001', '52110000', '', 'Versement client', '500000,00', ''],
    ['BQ', d, 'P001', '41100000', '', 'Versement client', '', '500000,00'],
    ['OD', d, 'P002', '60110000', '', 'Achat ciment', '120000', ''],
    ['OD', d, 'P002', '40110001', '', 'Achat ciment', '', '120000'],
    ['XX', d, 'P003', '52110000', '', 'Journal inconnu', '1000', ''],
    ['XX', d, 'P003', '57110000', '', 'Journal inconnu', '', '1000'],
  ];
  const body = { kind: 'ecritures', rows: rowsOf(lines), mapping: { journal: 0, date: 1, piece: 2, account: 3, partner: 4, label: 5, debit: 6, credit: 7 }, options: { date_format: 'JJMMAAAA' } };
  let sim = ok(await comptable.post(`${C}/import/sage`).send(body));
  assert.ok(sim.errors.some(e => /Journal XX/.test(e.message)), 'journal inconnu signalé');
  sim = ok(await comptable.post(`${C}/import/sage`).send({ ...body, options: { ...body.options, create_journals: true, create_accounts: true } }));
  assert.deepEqual(sim.errors, []);
  assert.equal(sim.summary.ready, 3);
  assert.equal(sim.summary.journals_to_create, 1);
  assert.equal(await db('acc_entries').where({ source: 'sage' }).first(), undefined, 'simulation : rien d’enregistré');
  const opts = { ...body.options, create_journals: true, create_accounts: true, validate: true };
  const done = ok(await comptable.post(`${C}/import/sage`).send({ ...body, options: opts, dry_run: false }), 201);
  assert.equal(done.summary.created, 3);
  const entries = await db('acc_entries').where({ source: 'sage' });
  assert.equal(entries.length, 3);
  assert.ok(entries.every(e => e.status === 'valide' && e.number), 'validées et numérotées');
  // Réimport du même fichier : rien en double
  const again = ok(await comptable.post(`${C}/import/sage`).send({ ...body, options: opts, dry_run: false }));
  assert.equal(again.summary.duplicates, 3);
  assert.equal(again.summary.created, 0);
  // Pièce déséquilibrée : signalée, rien n'est enregistré
  const bad = ok(await comptable.post(`${C}/import/sage`).send({ ...body, rows: rowsOf([['BQ', d, 'P009', '52110000', '', 'X', '100', ''], ['BQ', d, 'P009', '41100000', '', 'X', '', '90']]), dry_run: false }));
  assert.match(bad.errors[0].message, /déséquilibrée/);
});

test('soldes d’ouverture : balance équilibrée dans l’exercice choisi, une seule fois', async () => {
  const rows = rowsOf([['52110000', 'Banque', '3000000', ''], ['10100000', 'Capital', '', '3000000']]);
  const body = { kind: 'balance', rows, mapping: { account: 0, label: 1, debit: 2, credit: 3 }, options: { fiscal_year_id: fy.id, create_accounts: true } };
  const sim = ok(await comptable.post(`${C}/import/sage`).send(body));
  assert.deepEqual(sim.errors, []);
  assert.equal(sim.summary.debit, 3000000);
  const done = ok(await comptable.post(`${C}/import/sage`).send({ ...body, dry_run: false }), 201);
  assert.ok(done.summary.entry_id);
  assert.match(ok(await comptable.post(`${C}/import/sage`).send(body)).errors[0].message, /existent déjà/);
});
