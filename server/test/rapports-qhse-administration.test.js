const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

// Rapports « Exporter » et « Imprimer » (demande du client du 03/11) : QHSE et Administration générale (vue Direction) sur une période,
// droits du tableau de bord, portée des chantiers conduits, données hors période exclues
let db, app, admin, conducteur, direction1, commercial, users, w1, w2;
const R = '/api/admin/erp/rapports';
const OCT = '?du=2026-10-01&au=2026-10-31';
const insertedId = r => (typeof r === 'object' ? r.id : r);
const summary = (body, label) => {
  const s = body.summary.find(x => x.label === label || x.label.startsWith(label));
  assert.ok(s, `indicateur « ${label} » absent : ${body.summary.map(x => x.label).join(' | ')}`);
  return s.value;
};
const section = (body, title) => {
  const s = body.sections.find(x => x.title === title);
  assert.ok(s, `section « ${title} » absente`);
  return s;
};

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  await createUser(db, 'conducteur_travaux', 'autre-conducteur@test.ci');
  direction1 = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  users = Object.fromEntries((await db('users').select('id', 'email')).map(u => [u.email.split('@')[0], u.id]));
  const project = await db('projects').first('id');
  w1 = insertedId((await db('worksites').insert({ reference: 'CH-2026-9101', project_id: project.id, name: 'Tranche A', status: 'en_cours', manager_id: users.conducteur_travaux, created_at: new Date('2026-01-05') }))[0]);
  w2 = insertedId((await db('worksites').insert({ reference: 'CH-2026-9102', project_id: project.id, name: 'Tranche B', status: 'en_cours', manager_id: users['autre-conducteur'], created_at: new Date('2026-01-05') }))[0]);

  // Contrôles journaliers : trois en octobre (dont un sur le chantier d'un autre conducteur), un en septembre (hors période)
  const daily = (worksite_id, period_start, q, h, present, compliant) => ({
    worksite_id, kind: 'journalier', period_start, status: 'saisi', rating_qualite: q, rating_hygiene: h, workers_present: present, workers_compliant: compliant,
    safety_pct: Math.round((compliant / present) * 100), env_rate: 100, created_by: users.conducteur_travaux,
  });
  await db('qhse_controls').insert([
    daily(w1, '2026-10-05', 1, 3, 10, 8), daily(w1, '2026-10-06', 3, 4, 10, 10), daily(w2, '2026-10-07', 4, 4, 5, 5), daily(w1, '2026-09-30', 1, 1, 10, 1),
    { worksite_id: w1, kind: 'hebdomadaire', period_start: '2026-10-05', status: 'valide', rating_qualite: 2, rating_hygiene: 3, created_by: users.conducteur_travaux },
  ]);
  // Actions correctives : en retard (ouverte en octobre), levée en octobre (ouverte en septembre), ouverte en octobre sur l'autre chantier, ouverte en août
  await db('qhse_actions').insert([
    { reference: 'QHSE-2026-9001', title: 'Reprendre le ferraillage', pillar: 'qualite', gravity: 'majeure', worksite_id: w1, owner_id: users.conducteur_travaux, due_on: '2026-10-10', status: 'ouverte', created_at: new Date('2026-10-06T09:00:00Z') },
    { reference: 'QHSE-2026-9002', title: 'Baliser la tranchée', pillar: 'securite', gravity: 'critique', worksite_id: w1, owner_id: users.conducteur_travaux, due_on: '2026-10-20', status: 'levee', lifted_on: '2026-10-15', created_at: new Date('2026-09-20T09:00:00Z') },
    { reference: 'QHSE-2026-9003', title: 'Nettoyer la base vie', pillar: 'hygiene', gravity: 'mineure', worksite_id: w2, owner_id: users['autre-conducteur'], due_on: '2026-11-30', status: 'ouverte', created_at: new Date('2026-10-02T09:00:00Z') },
    { reference: 'QHSE-2026-9004', title: 'Ancienne action', pillar: 'hygiene', gravity: 'mineure', worksite_id: w1, owner_id: users.conducteur_travaux, due_on: '2026-12-31', status: 'en_cours', created_at: new Date('2026-08-02T09:00:00Z') },
  ]);
  await db('qhse_audits').insert([
    { reference: 'AUD-2026-9001', kind: 'planifie', status: 'valide', place_kind: 'chantier', worksite_id: w1, planned_on: '2026-10-12', done_on: '2026-10-12', score_pct: 75, created_by: users.admin },
    { reference: 'AUD-2026-9002', kind: 'inopine', status: 'valide', place_kind: 'chantier', worksite_id: w1, planned_on: '2026-09-12', done_on: '2026-09-12', score_pct: 40, created_by: users.admin },
  ]);

  // Administration générale : courriers, demandes internes et un contrat échu en octobre ; une donnée de chaque hors période
  const mail = (direction, seq, date, extra = {}) => ({ direction, year: 2026, seq, number: `${direction === 'arrivee' ? 'A' : 'D'}-2026-${String(seq).padStart(4, '0')}`, date, correspondent: 'Mairie de Bingerville', subject: `Courrier ${seq}`, confidential: false, urgent: false, status: direction === 'arrivee' ? 'enregistre' : 'envoye', ...extra });
  await db('mail_items').insert([
    mail('arrivee', 901, '2026-10-03', { confidential: true, subject: 'Mise en demeure' }), mail('depart', 902, '2026-10-04'), mail('arrivee', 903, '2026-09-15'),
  ]);
  await db('internal_requests').insert([
    { reference: 'DI-2026-9001', kind: 'achat', title: 'Ramettes de papier', estimated_amount: 750000, urgency: 'normale', status: 'traitee', requested_by: users.commercial, created_at: new Date('2026-10-08T10:00:00Z') },
    { reference: 'DI-2026-9002', kind: 'intervention', title: 'Climatiseur en panne', urgency: 'urgente', status: 'attente_sg', requested_by: users.commercial, created_at: new Date('2026-11-02T10:00:00Z') },
  ]);
  await db('contracts').insert([
    { reference: 'CTR-2026-9001', kind: 'bail', title: 'Bail du dépôt', counterparty: 'SCI Plateau', start_date: '2025-10-20', end_date: '2026-10-20', tacit_renewal: false, status: 'actif' },
    { reference: 'CTR-2026-9002', kind: 'assurance', title: 'Assurance flotte', counterparty: 'Assureur', start_date: '2025-12-31', end_date: '2026-12-31', tacit_renewal: false, status: 'actif' },
  ]);
});
after(() => db.destroy());

test('droits : QHSE pour qhse:read, Administration générale pour direction:read ; module inconnu et période invalide refusés', async () => {
  assert.equal((await commercial.get(`${R}/qhse${OCT}`)).status, 403, 'le commercial n’a pas accès au QHSE');
  assert.equal((await commercial.get(`${R}/administration${OCT}`)).status, 403);
  assert.equal((await conducteur.get(`${R}/administration${OCT}`)).status, 403, 'le conducteur n’ouvre pas la vue Direction');
  assert.equal((await conducteur.get(`${R}/qhse${OCT}`)).status, 200);
  assert.equal((await direction1.get(`${R}/administration${OCT}`)).status, 200);
  assert.equal((await admin.get(`${R}/inconnu${OCT}`)).status, 404);
  assert.equal((await admin.get(`${R}/qhse?du=2026-10-31&au=2026-10-01`)).status, 400);
});

test('QHSE : structure, moyennes et alertes de la période, actions et audits, hors période exclu', async () => {
  const res = await admin.get(`${R}/qhse${OCT}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const b = res.body;
  assert.equal(b.title, 'QHSE');
  assert.deepEqual(b.period, { from: '2026-10-01', to: '2026-10-31', label: 'du 01/10/2026 au 31/10/2026' });
  for (const s of b.sections) {
    assert.ok(s.columns.length && s.columns.every(c => c.key && c.label), s.title);
    for (const row of s.rows) for (const c of s.columns) assert.ok(c.key in row, `${s.title} : colonne ${c.key}`);
  }
  assert.equal(summary(b, 'Contrôles journaliers saisis'), 3, 'le contrôle du 30/09 est exclu');
  assert.equal(summary(b, 'Note moyenne qualité'), 2.7, '(1 + 3 + 4) / 3');
  assert.equal(summary(b, 'Contrôles avec une note « Mauvais »'), 1);
  assert.equal(summary(b, 'Contrôles sous le seuil de sécurité'), 1, '80 % sous le seuil de 90 %');
  assert.equal(summary(b, 'Synthèses hebdomadaires validées'), 1);
  assert.equal(summary(b, 'Actions correctives ouvertes sur la période'), 2);
  assert.equal(summary(b, 'Actions correctives levées sur la période'), 1);
  assert.equal(summary(b, 'Actions correctives en retard au 31/10/2026'), 1);
  assert.equal(summary(b, 'Inspections et audits réalisés'), 1);

  const daily = section(b, 'Contrôles journaliers');
  assert.deepEqual(daily.rows.map(r => r.date), ['2026-10-05', '2026-10-06', '2026-10-07']);
  const first = daily.rows[0];
  assert.equal(first.qualite, 'Mauvais');
  assert.equal(first.securite, 80);
  assert.equal(first.statut, 'Saisi');
  assert.match(first.alertes, /Qualité « Mauvais »/);
  assert.match(first.alertes, /Sécurité sous 90 %/);
  const actions = section(b, 'Actions correctives');
  assert.deepEqual(actions.rows.map(r => r.reference).sort(), ['QHSE-2026-9001', 'QHSE-2026-9002', 'QHSE-2026-9003'], 'l’action d’août non échue n’apparaît pas');
  const late = actions.rows.find(r => r.reference === 'QHSE-2026-9001');
  assert.equal(late.retard, 21, 'du 10/10 au 31/10');
  assert.equal(late.statut, 'Ouverte');
  assert.equal(late.gravite, 'Majeure');
  assert.equal(actions.rows.find(r => r.reference === 'QHSE-2026-9002').levee, '2026-10-15');
  assert.deepEqual(section(b, 'Inspections et audits').rows.map(r => r.reference), ['AUD-2026-9001']);
  assert.equal(section(b, 'Inspections et audits').rows[0].statut, 'Validé');
});

test('QHSE : un conducteur sans la portée « tous les chantiers » ne voit que ses chantiers', async () => {
  const b = (await conducteur.get(`${R}/qhse${OCT}`)).body;
  assert.equal(summary(b, 'Contrôles journaliers saisis'), 2);
  assert.equal(summary(b, 'Note moyenne qualité'), 2);
  assert.ok(section(b, 'Contrôles journaliers').rows.every(r => r.chantier === 'CH-2026-9101'));
  assert.ok(!section(b, 'Actions correctives').rows.some(r => r.reference === 'QHSE-2026-9003'), 'action de l’autre chantier masquée');
});

test('Administration générale : chiffres clés, courriers, demandes internes et échéances de la période', async () => {
  const res = await direction1.get(`${R}/administration${OCT}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const b = res.body;
  assert.equal(b.title, 'Administration générale');
  assert.equal(b.period.label, 'du 01/10/2026 au 31/10/2026');
  for (const s of b.sections) for (const row of s.rows) for (const c of s.columns) assert.ok(c.key in row, `${s.title} : colonne ${c.key}`);
  for (const label of ['Chiffre d’affaires signé', 'Encaissements', 'Réclamations SAV reçues', 'Factures d’achat enregistrées (HT)', 'Étapes de chantier déclarées']) {
    assert.equal(typeof summary(b, label), 'number', label);
  }
  assert.equal(summary(b, 'Courriers arrivés'), 1, 'le courrier du 15/09 est exclu');
  assert.equal(summary(b, 'Courriers envoyés'), 1);
  assert.equal(summary(b, 'Courriers de la période non traités'), 1);
  assert.equal(summary(b, 'Demandes internes reçues'), 1, 'la demande du 02/11 est exclue');
  assert.equal(summary(b, 'Demandes internes traitées'), 1);
  assert.equal(summary(b, 'Achats demandés (montant estimé)'), 750000);
  assert.equal(summary(b, 'Échéances de contrats dans la période'), 1, 'la fin du 31/12 est hors période');

  const mails = section(b, 'Courriers de la période');
  assert.deepEqual(mails.rows.map(r => r.numero), ['A-2026-0901', 'D-2026-0902']);
  assert.equal(mails.rows[0].sens, 'Arrivée');
  assert.equal(mails.rows[0].statut, 'À affecter');
  assert.equal(mails.rows[0].objet, 'Mise en demeure', 'qui affecte le courrier voit l’objet d’un courrier confidentiel');
  const reqs = section(b, 'Demandes internes de la période');
  assert.equal(reqs.rows.length, 1);
  assert.equal(reqs.rows[0].type, 'Achat / fourniture');
  assert.equal(reqs.rows[0].statut, 'Traitée');
  assert.equal(reqs.rows[0].montant, 750000);
  const ctr = section(b, 'Échéances des contrats');
  assert.deepEqual(ctr.rows.map(r => [r.reference, r.date, r.echeance, r.type]), [['CTR-2026-9001', '2026-10-20', 'Fin du contrat', 'Bail / location']]);
  assert.match(ctr.columns.find(c => c.key === 'situation').label, /^Situation au \d{2}\/\d{2}\/\d{4}$/);
});

test('Administration générale : un courrier confidentiel ne montre que son numéro sans le droit d’affecter le courrier', async () => {
  const email = await createUser(db, 'commercial', 'direction-seule@test.ci');
  const u = await db('users').where({ email }).first('id');
  await db('user_permissions').insert({ user_id: u.id, permission: 'direction:read', granted: true });
  const agent = await login(app, email, 'motdepasse-test-123');
  const res = await agent.get(`${R}/administration${OCT}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = section(res.body, 'Courriers de la période').rows.find(r => r.numero === 'A-2026-0901');
  assert.equal(row.objet, 'Confidentiel');
  assert.equal(row.correspondant, 'Confidentiel');
});
