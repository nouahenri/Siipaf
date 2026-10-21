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

test('import de l’ancienne plateforme : clients sans lot, N°, nom + prénom, type de bien, accès ouverts', async () => {
  const rows = [
    { legacy_number: 1, name: 'ABOU ALLIA', first_name: 'SONIA ANGE', phone: '+2250708972671', email: '', project: 'SIIPAF CITY AHOUTOUE', property_type: 'Villa basse jumelée 4 pièces' },
    { legacy_number: '2', name: 'ACAFFOU', first_name: 'DJORO FRANCK', phone: '+2250787367656', project: 'SIIPAF CITY AHOUTOUE', property_type: 'Villa basse jumelée 3 pièces' },
    { legacy_number: '115', name: 'Test', first_name: 'Henri', phone: '+2250101078090', project: 'TEST PROGRAMME', property_type: '—' },
  ];
  let res = await admin.post('/api/admin/import').send({ mode: 'clients', rows, dry_run: true, open_access: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, 2, JSON.stringify(res.body.report));
  assert.match(res.body.report[0].action, /sans dossier/);
  assert.equal(res.body.report[0].access, undefined, 'aucun mot de passe en simulation');
  assert.match(res.body.report[2].error, /Projet inconnu/);

  res = await admin.post('/api/admin/import').send({ mode: 'clients', rows, dry_run: false, open_access: true });
  assert.equal(res.body.ok, 2);
  const [a, b] = res.body.report;
  assert.notEqual(a.access.client_code, b.access.client_code, 'un code client chacun');
  assert.ok(a.access.temporary_password.length >= 10);

  const lead = await db('leads').where({ phone: '+2250708972671' }).first();
  assert.equal(lead.name, 'ABOU ALLIA SONIA ANGE');
  assert.equal(lead.legacy_number, '1');
  assert.equal(lead.property_type, 'Villa basse jumelée 4 pièces');
  assert.equal(lead.stage, 'paiement');
  assert.equal(lead.client_code, a.access.client_code);
  assert.equal((await db('sales').where({ lead_id: lead.id })).length, 0);
  assert.ok(await db('client_accounts').where({ lead_id: lead.id, must_change_password: true }).first());

  // Le client se connecte avec son téléphone et le mot de passe provisoire
  const request = require('supertest');
  const login = await request(app).post('/api/client/login').send({ login: '0708972671', password: a.access.temporary_password });
  assert.equal(login.status, 200, JSON.stringify(login.body));

  const list = await admin.get('/api/admin/clients');
  const row = list.body.find(c => c.lead_id === lead.id);
  assert.equal(row.status, 'sans_dossier');
  assert.equal(row.legacy_number, '1');
  assert.equal(row.project_name, 'SIIPAF CITY AHOUTOUE');

  // Un second import ne réinitialise ni le code ni le mot de passe
  res = await admin.post('/api/admin/import').send({ mode: 'clients', rows: rows.slice(0, 1), dry_run: false, open_access: true });
  assert.equal(res.body.ok, 1);
  assert.equal(res.body.report[0].access, undefined);
  assert.equal((await db('leads').where({ id: lead.id }).first()).client_code, lead.client_code);
});

test('nouveau client saisi à la main : code client, sans dossier, pas de doublon', async () => {
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  let res = await admin.post('/api/admin/clients').send({ name: 'KOUASSI', first_name: 'Ama', phone: '+2250700112233', property_type: 'Duplex 5 pièces', project_id: project.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.client_code, /^SIIPAF-\d{4}-\d{4}$/);
  const lead = await db('leads').where({ id: res.body.lead_id }).first();
  assert.equal(lead.name, 'KOUASSI Ama');
  assert.equal(lead.source, 'admin');
  assert.equal(lead.project_id, project.id);
  assert.equal(lead.property_type, 'Duplex 5 pièces');

  const list = await admin.get('/api/admin/clients');
  assert.equal(list.body.find(c => c.lead_id === lead.id).status, 'sans_dossier');

  res = await admin.post('/api/admin/clients').send({ name: 'Autre nom', phone: '+2250700112233' });
  assert.equal(res.status, 409, 'même téléphone : déjà client');
  res = await admin.post('/api/admin/clients').send({ name: 'Sans contact' });
  assert.equal(res.status, 400);
});

test('avancement du chantier par client : lot, programme rattaché, sans programme', async () => {
  const project = await db('projects').where({ slug: 'yamoussoukro' }).first();
  const mk = async body => (await admin.post('/api/admin/clients').send(body)).body.lead_id;
  const withProject = await mk({ name: 'AVANCE Projet', phone: '+2250711000001', project_id: project.id });
  const without = await mk({ name: 'AVANCE Rien', phone: '+2250711000002' });
  // Client avec un dossier sur un lot de l'îlot Q
  const imp = await admin.post('/api/admin/import').send({ mode: 'clients', dry_run: false, rows: [{ name: 'AVANCE Lot', phone: '+2250711000003', project: 'yamoussoukro', lot: 'AV-1', ilot: 'Q', price: 1000000 }] });
  assert.equal(imp.body.ok, 1, JSON.stringify(imp.body.report));
  const lotLead = (await db('leads').where({ phone: '+2250711000003' }).first()).id;

  const post = body => admin.post(`/api/admin/projects/${project.id}/site-updates`).send({ stage: 'fondations', title: 'Point', ...body });
  assert.equal((await post({ progress_pct: 30 })).status, 201);
  assert.equal((await post({ progress_pct: 55, ilot: 'Q', stage: 'gros_oeuvre' })).status, 201);
  assert.equal((await post({ progress_pct: 90, visible_client: false })).status, 201, 'point interne : ignoré');

  const list = (await admin.get('/api/admin/clients')).body;
  const of = id => list.find(c => c.lead_id === id);
  assert.equal(of(withProject).progress.progress_pct, 30, 'programme rattaché : point du projet');
  assert.equal(of(without).progress.progress_pct, 0, 'sans programme : 0 %');
  assert.equal(of(lotLead).progress.progress_pct, 55, 'lot : dernier point de son îlot');
  assert.equal(of(lotLead).progress.stage, 'gros_oeuvre');
  assert.equal(of(lotLead).sales[0].progress_pct, 55);

  // Même calcul pour les états comptables (soldes clients)
  const { clientsProgress } = require('../src/services/clients');
  const byLead = await clientsProgress(db, [withProject, without, lotLead]);
  assert.deepEqual([withProject, without, lotLead].map(id => byLead[id].progress_pct), [30, 0, 55]);
  for (const kind of ['client', 'fournisseur']) assert.equal((await admin.get(`/api/admin/erp/compta/reports/partners?kind=${kind}`)).status, 200);
  assert.equal((await admin.get('/api/admin/erp/compta/reports/margins')).status, 200);
});

test('droits : un éditeur ne peut rien importer', async () => {
  const editeur = await login(app, await createUser(db, 'editeur', 'editeur-import@test.ci'), 'motdepasse-test-123');
  const res = await editeur.post('/api/admin/import').send({ mode: 'prospects', rows: [{ name: 'Test', phone: '0700000000' }] });
  assert.equal(res.status, 403);
});
