const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { money, day, financing } = require('../src/services/importer');

let db, app, admin;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
});
after(() => db.destroy());

test('lecture des cellules : montants, dates, financements', () => {
  assert.equal(money('23 212 000'), 23212000);
  assert.equal(money('23.212.000 FCFA'), 23212000);
  assert.equal(money(6963600), 6963600);
  assert.equal(day('31/01/2026'), '2026-01-31');
  assert.equal(day('2026-1-5'), '2026-01-05');
  assert.equal(day(46053), '2026-01-31', 'date Excel');
  assert.equal(financing('Diaspora sans apport'), 'diaspora');
  assert.equal(financing('Crédit bancaire'), 'credit');
  assert.equal(financing('Apport 30%'), 'apport');
});

test('import de prospects : simulation sans écriture, puis import avec dédoublonnage', async () => {
  const rows = [
    { name: 'Koffi Import', phone: '07 11 22 33 44', email: 'koffi@example.com', project: 'Ahoutoué', financing: 'diaspora' },
    { name: 'Koffi Doublon', phone: '0711223344' },
    { name: 'X', phone: '0711000000' },
    { name: 'Sans contact' },
  ];
  const before = (await db('leads').count({ n: '*' }))[0].n;
  let res = await admin.post('/api/admin/import').send({ mode: 'prospects', rows, dry_run: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, 2);
  assert.equal(res.body.errors, 2);
  assert.equal((await db('leads').count({ n: '*' }))[0].n, before, 'la simulation n’enregistre rien');

  res = await admin.post('/api/admin/import').send({ mode: 'prospects', rows, dry_run: false });
  assert.equal(res.body.report[0].action, 'Nouveau prospect');
  assert.equal(res.body.report[1].action, 'Prospect existant complété', 'même téléphone : pas de doublon');
  assert.match(res.body.report[3].error, /téléphone ou un e-mail/);
  const koffi = await db('leads').where({ email: 'koffi@example.com' }).first();
  assert.equal(koffi.source, 'import');
  assert.equal(!!koffi.is_diaspora, true);
});

test('import de clients : dossier, échéancier, code repris, sommes déjà versées', async () => {
  const rows = [
    { name: 'Awa Reprise', phone: '+225 05 00 00 00 01', project: 'ahoutoue', lot: 'IMP-1', ilot: 'Z', price: '23 212 000', financing: 'Apport 30 %', reserved_at: '15/01/2026', paid: '8 000 000', client_code: 'SIIPAF-2025-0042' },
    { name: 'Lot inconnu', phone: '0500000002', project: 'Projet fantôme', lot: 'A1' },
    { name: 'Trop payé', phone: '0500000003', project: 'ahoutoue', lot: 'IMP-2', price: 1000000, paid: 2000000 },
  ];
  const res = await admin.post('/api/admin/import').send({ mode: 'clients', rows, dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, 1, JSON.stringify(res.body.report));
  assert.match(res.body.report[1].error, /Projet inconnu/);
  assert.match(res.body.report[2].error, /dépasse le prix/);
  assert.equal(await db('lots').where({ code: 'IMP-2' }).first(), undefined, 'ligne en erreur entièrement annulée');

  const lead = await db('leads').where({ client_code: 'SIIPAF-2025-0042' }).first();
  assert.ok(lead, 'code client de l’ancienne plateforme conservé');
  const sale = await db('sales').where({ lead_id: lead.id }).first();
  assert.equal(Number(sale.price_fcfa), 23212000);
  assert.equal(sale.financing, 'apport');
  const lot = await db('lots').where({ id: sale.lot_id }).first();
  assert.equal(lot.status, 'reserve');
  assert.equal(lot.ilot, 'Z');
  assert.equal((await db('payment_schedule').where({ sale_id: sale.id })).length, 37);
  const paid = await db('payments').where({ sale_id: sale.id });
  assert.equal(paid.length, 1);
  assert.equal(Number(paid[0].amount_fcfa), 8000000);
});

test('droits : un éditeur ne peut rien importer', async () => {
  const editeur = await login(app, await createUser(db, 'editeur', 'editeur-import@test.ci'), 'motdepasse-test-123');
  const res = await editeur.post('/api/admin/import').send({ mode: 'prospects', rows: [{ name: 'Test', phone: '0700000000' }] });
  assert.equal(res.status, 403);
});
