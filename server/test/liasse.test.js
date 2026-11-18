const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const liasse = require('../src/services/liasse');

let db, app, comptable, commercial, fy;
const C = '/api/admin/erp/compta';
const L = `${C}/liasse`;
const year = new Date().getFullYear();
const line = (rows, ref) => rows.find(l => l.ref === ref);

before(async () => {
  ({ db, app } = await setup());
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  fy = (await comptable.post(`${C}/fiscal-years`).send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` })).body;
  const j = async code => (await db('acc_journals').where({ code }).first()).id;
  const entry = async (journal, label, lines) => {
    const res = await comptable.post(`${C}/entries`).send({ journal_id: await j(journal), date: `${year}-03-10`, label, lines });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await comptable.post(`${C}/entries/validate`).send({ ids: [res.body.id] });
  };
  await entry('OD', 'Apport en capital', [{ account: '521100', debit: 10000000 }, { account: '101', credit: 10000000 }]);
  await entry('OD', 'Véhicule', [{ account: '245', debit: 4000000 }, { account: '521100', credit: 4000000 }]);
  await entry('OD', 'Dotation', [{ account: '681', debit: 800000 }, { account: '284', credit: 800000 }]);
  await entry('OD', 'Vente de terrain', [{ account: '4111', debit: 6000000 }, { account: '702120', credit: 6000000 }]);
  await entry('OD', 'Sous-traitance', [{ account: '621100', debit: 2000000 }, { account: '4011', credit: 2000000 }]);
  await entry('OD', 'Client créditeur', [{ account: '521100', debit: 300000 }, { account: '4191', credit: 300000 }]);
});
after(() => db.destroy());

test('rangement des comptes de l’ERP sous les comptes de référence du modèle DGI', () => {
  assert.equal(liasse.refAccount('521100'), '521100');
  assert.ok(liasse.refAccount('618').startsWith('618'));
  assert.ok(liasse.refAccount('4011').startsWith('4011'));
  assert.ok(liasse.refAccount('702120').startsWith('702'));
});

test('droits : la Comptabilité produit la liasse, le commercial n’y a pas accès', async () => {
  assert.equal((await comptable.get(`${L}/meta`)).status, 200);
  assert.equal((await commercial.get(`${L}/meta`)).status, 403);
  assert.equal((await commercial.get(`${L}/${fy.id}`)).status, 403);
});

test('bilan, compte de résultat, TFT et contrôles', async () => {
  const s = (await comptable.get(`${L}/${fy.id}`)).body;
  assert.equal(line(s.actif, 'AN').brut, 4000000, 'matériel de transport brut');
  // Le plan livré amortit tout le matériel au compte 284 : l'amortissement se range dans les immobilisations corporelles
  assert.equal(line(s.actif, 'AI').amort, 800000);
  assert.equal(line(s.actif, 'AI').net, 3200000);
  assert.equal(line(s.actif, 'BI').net, 6000000, 'clients');
  assert.equal(line(s.actif, 'BS').net, 6300000, 'banque');
  assert.equal(line(s.passif, 'CA').n, 10000000, 'capital');
  assert.equal(line(s.passif, 'DI').n, 300000, 'client créditeur au passif');
  assert.equal(line(s.passif, 'DJ').n, 2000000, 'fournisseurs');
  assert.equal(line(s.resultat, 'XB').n, 6000000, 'chiffre d’affaires');
  assert.equal(line(s.resultat, 'RL').n, -800000, 'dotations en charge');
  assert.equal(line(s.resultat, 'XI').n, 3200000, 'résultat net');
  assert.equal(line(s.passif, 'CJ').n, 3200000);
  assert.equal(line(s.actif, 'BZ').net, line(s.passif, 'DZ').n, 'bilan équilibré');
  assert.equal(s.controls.find(c => c.key === 'equilibre').ok, true);
  assert.equal(s.controls.find(c => c.key === 'comptes').ok, true);
  // TFT : CAFG = résultat + dotations ; acquisitions et apports proposés depuis les écritures
  assert.equal(line(s.tft, 'FA').n, 4000000);
  assert.equal(s.tft_inputs.FG.proposed, 4000000);
  assert.equal(s.tft_inputs.FK.proposed, 10000000);
  assert.equal(line(s.tft, 'FG').n, -4000000);
  assert.equal(line(s.tft, 'ZA').n, null, 'pas de N-1');
  assert.equal(s.previous.source, null);
});

test('préparation : renseignements du TFT, balance N-1 importée, fiche d’identification', async () => {
  let res = await comptable.put(`${L}/${fy.id}/tft`).send({ FG: 3500000 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(line(res.body.tft, 'FG').n, -3500000);
  res = await comptable.put(`${L}/${fy.id}/tft`).send({ FG: null });
  assert.equal(line(res.body.tft, 'FG').n, -4000000, 'retour à la proposition');

  assert.equal((await comptable.put(`${L}/${fy.id}/balance-n1`).send({ rows: [{ account: '521100', debit: 100 }, { account: '101', credit: 90 }] })).status, 400, 'déséquilibrée');
  // Exercice précédent tenu hors de l'ERP : à-nouveaux de N cohérents avec la balance N-1 importée
  const an = await comptable.post(`${C}/opening`).send({ fiscal_year_id: fy.id, lines: [{ account: '521100', debit: 5000000 }, { account: '101', credit: 4000000 }, { account: '121', credit: 1000000 }] });
  assert.equal(an.status, 201, JSON.stringify(an.body));
  await comptable.post(`${C}/entries/validate`).send({ ids: [an.body.id] });
  res = await comptable.put(`${L}/${fy.id}/balance-n1`).send({ rows: [
    { account: '521100', debit: 5000000 }, { account: '101100', credit: 4000000 }, { account: '702120', credit: 3000000 }, { account: '621100', debit: 2000000 },
  ] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const s = res.body;
  assert.equal(s.previous.source, 'import');
  assert.equal(line(s.actif, 'BS').net_n1, 5000000);
  assert.equal(line(s.resultat, 'XI').n1, 1000000);
  assert.equal(line(s.tft, 'ZA').n, 5000000, 'trésorerie au 1er janvier');
  assert.equal(line(s.tft, 'ZH').n, 11300000, 'trésorerie au 31 décembre : 5 M + 10 M d’apport − 4 M de véhicule + 0,3 M d’avance client');
  assert.equal(line(s.passif, 'CH').n, 1000000, 'report à nouveau');
  assert.equal(line(s.actif, 'BZ').net, line(s.passif, 'DZ').n);
  assert.equal(s.controls.find(c => c.key === 'tft').ok, true, 'TFT = trésorerie du bilan');

  assert.equal((await commercial.put(`${L}/identity`).send({ ncc: '1234567A' })).status, 403);
  res = await comptable.put(`${L}/identity`).send({ ncc: '1234567A' });
  assert.equal(res.body.ncc, '1234567A');
  assert.equal(res.body.denomination, 'SIIPAF SA');
});

test('classeur DGI rempli : balance collée, identité, recalcul à l’ouverture, macros gardées', async () => {
  const res = await comptable.get(`${L}/${fy.id}/classeur`).buffer(true).parse((r, cb) => { const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-disposition'], /liasse-fiscale-\d{4}\.xlsm/);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(res.body);
  assert.ok(zip.file('xl/vbaProject.bin'), 'macros gardées');
  assert.match(await zip.file('xl/workbook.xml').async('string'), /fullCalcOnLoad="1"/);
  const all = (await Promise.all(Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).map(f => zip.file(f).async('string')))).join('');
  assert.ok(all.includes('<t xml:space="preserve">521100</t>'), 'compte de banque collé');
  assert.ok(all.includes('1234567A'), 'NCC de la fiche');
});
