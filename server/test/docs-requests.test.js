const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const { readReminder, requestNextStep } = require('../src/lib/domain');
const docs = require('../src/services/docs');

let db, app, resp, comptable, commercial, editeur, ids, emp;
const DOCS = '/api/admin/erp/documents';
const REQ = '/api/admin/erp/demandes';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const insertedId = r => (typeof r === 'object' ? r.id : r);

before(async () => {
  ({ db, app } = await setup());
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  // Comptable : chef du service comptabilité ; commercial : dans son équipe ; éditeur : service commercial, sans responsable
  const base = { hire_date: '2024-01-01', job_title: 'Employé', base_salary: 300000 };
  const [c] = await db('employees').insert({ ...base, matricule: 'E-1', last_name: 'Chef', first_name: 'Compta', department: 'comptabilite', user_id: ids.comptable });
  emp = { comptable: insertedId(c) };
  await db('employees').insert({ ...base, matricule: 'E-2', last_name: 'Agent', first_name: 'Commercial', department: 'comptabilite', manager_id: emp.comptable, user_id: ids.commercial });
  await db('employees').insert({ ...base, matricule: 'E-3', last_name: 'Editeur', first_name: 'Web', department: 'commercial', user_id: ids.editeur });
  await db('employees').insert({ ...base, matricule: 'E-4', last_name: 'Resp', first_name: 'Exploitation', department: 'direction', user_id: ids.resp_exploitation });
});
after(() => db.destroy());

test('règles : relance de lecture, circuit responsable → DG au-delà du plafond → services généraux', () => {
  assert.equal(readReminder('2026-11-10', '2026-11-08'), null);
  assert.equal(readReminder('2026-11-10', '2026-11-09'), 'veille');
  assert.equal(readReminder('2026-11-10', '2026-11-11'), 'retard');
  assert.equal(readReminder(null, '2026-11-11'), null);
  const achat = { kind: 'achat', estimated_amount: 800000 };
  assert.equal(requestNextStep(achat, { hasManager: true, threshold: 500000 }), 'attente_responsable');
  assert.equal(requestNextStep(achat, { from: 'attente_responsable', hasManager: true, threshold: 500000 }), 'attente_dg');
  assert.equal(requestNextStep({ ...achat, estimated_amount: 100000 }, { from: 'attente_responsable', hasManager: true, threshold: 500000 }), 'attente_sg');
  assert.equal(requestNextStep({ kind: 'intervention' }, { hasManager: false, threshold: 500000 }), 'attente_sg', 'sans responsable : directement aux services généraux');
  assert.equal(requestNextStep(achat, { hasManager: false, threshold: 500000 }), 'attente_dg');
});

test('documents : publication à tous, accusé « lu et compris », nouvelle version relue, chef de service limité à son service', async () => {
  let res = await resp.post(DOCS).send({ kind: 'note', title: 'Horaires de fin d’année', body: 'Le bureau ferme le 24 à 13 h.', ack_deadline: day(5) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.reference, /^NS-\d{4}-0001$/);
  const id = res.body.id;
  assert.equal((await commercial.get(`${DOCS}/${id}`)).status, 404, 'brouillon invisible');
  sent.length = 0;
  res = await resp.post(`${DOCS}/${id}/publier`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.tracking.total, 4, 'les comptes reliés à une fiche employé');
  assert.ok(sent.some(m => m.to === 'commercial@test.ci'));
  let inbox = (await commercial.get(`${DOCS}/moi`)).body.documents;
  assert.equal(inbox[0].to_read, true);
  await commercial.post(`${DOCS}/${id}/lu`);
  inbox = (await commercial.get(`${DOCS}/moi`)).body.documents;
  assert.equal(inbox[0].to_read, false);
  assert.equal((await resp.get(`${DOCS}/${id}`)).body.tracking.read, 1);
  // Nouvelle version : il faut relire
  res = await resp.post(`${DOCS}/${id}/version`).send({ change_note: 'Fermeture à 12 h', body: 'Le bureau ferme le 24 à 12 h.', ack_deadline: day(3) });
  assert.equal(res.body.version, 2);
  assert.equal((await commercial.get(`${DOCS}/moi`)).body.documents[0].to_read, true);
  // Chef de service : son service seulement ; un employé sans équipe ne publie pas
  assert.equal((await comptable.post(DOCS).send({ kind: 'note', title: 'Clôture mensuelle', body: 'x', audience: 'tous' })).status, 403);
  res = await comptable.post(DOCS).send({ kind: 'note', title: 'Clôture mensuelle', body: 'Pièces avant le 5.' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.audience_departments, ['comptabilite']);
  res = await comptable.post(`${DOCS}/${res.body.id}/publier`);
  assert.equal(res.body.tracking.total, 2, 'chef et agent du service comptabilité');
  assert.equal((await editeur.post(DOCS).send({ kind: 'note', title: 'Test', body: 'x' })).status, 403);
  assert.equal((await editeur.get(`${DOCS}/${res.body.id}`)).status, 404, 'hors du service');
});

test('relances de lecture et actions de PV : veille puis retard, une fois ; l’auteur est prévenu du retard', async () => {
  let res = await resp.post(DOCS).send({ kind: 'pv', title: 'Réunion de chantier n°12', body: 'Décisions…', meeting_date: day(-1), audience: 'personnes', audience_users: [ids.commercial, ids.comptable], ack_deadline: day(1) });
  const id = res.body.id;
  await resp.post(`${DOCS}/${id}/actions`).send({ label: 'Commander les fers', owner_id: ids.commercial, due_date: day(2) });
  await resp.post(`${DOCS}/${id}/publier`);
  sent.length = 0;
  await docs.tick(db, day(0));
  assert.ok(sent.some(m => m.to === 'commercial@test.ci' && /avant le/.test(m.subject)), sent.map(m => m.subject).join(' | '));
  sent.length = 0;
  await docs.tick(db, day(0));
  assert.equal(sent.length, 0, 'pas deux fois');
  await docs.tick(db, day(3));
  assert.ok(sent.some(m => m.to === 'comptable@test.ci' && /retard/i.test(m.subject)));
  assert.ok(sent.some(m => m.to === 'commercial@test.ci' && /Action en retard/.test(m.subject)));
  // Le responsable de l'action la déclare faite depuis Mon espace
  const action = (await commercial.get(`${DOCS}/moi`)).body.actions[0];
  res = await commercial.patch(`${DOCS}/actions/${action.id}`).send({ status: 'fait', done_note: 'Commande passée' });
  assert.equal(res.body.actions[0].status, 'fait');
});

test('demandes : responsable direct, DG au-delà du plafond, services généraux, facture d’achat en brouillon', async () => {
  const acc = await db('acc_accounts').where('code', 'like', '60%').orderBy('code').first();
  const [s] = await db('suppliers').insert({ name: 'Bureau Plus', kind: 'fournisseur', expense_account_id: acc.id });
  const supplier = insertedId(s);
  assert.equal((await commercial.post(REQ).send({ kind: 'achat', title: 'Imprimante' })).status, 400, 'montant estimé');
  let res = await commercial.post(REQ).send({ kind: 'achat', title: 'Climatiseur salle de réunion', estimated_amount: 750000, urgency: 'urgente' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id = res.body.id;
  assert.equal(res.body.status, 'attente_responsable');
  assert.match(res.body.reference, /^DI-\d{4}-0001$/);
  assert.equal((await resp.post(`${REQ}/${id}/decision`).send({ approve: true })).status, 403, 'pas son responsable');
  res = await comptable.post(`${REQ}/${id}/decision`).send({ approve: true });
  assert.equal(res.body.status, 'attente_dg', 'au-delà de 500 000 FCFA');
  assert.equal((await resp.post(`${REQ}/${id}/decision`).send({ approve: true })).status, 403, 'droit DG requis');
  const admin = await login(app);
  res = await admin.post(`${REQ}/${id}/decision`).send({ approve: true });
  assert.equal(res.body.status, 'attente_sg');
  assert.equal((await resp.get(`${REQ}?scope=handle`)).body.length, 1);
  res = await resp.post(`${REQ}/${id}/prendre`);
  assert.equal(res.body.status, 'en_cours');
  res = await resp.post(`${REQ}/${id}/cloturer`).send({ outcome: 'traitee', note: 'Livré et posé', invoice: true, supplier_id: supplier, amount_ttc: 708000, vat_rate: 18 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'traitee');
  const inv = await db('purchase_invoices').where({ id: res.body.purchase_invoice_id }).first();
  assert.equal(inv.status, 'brouillon');
  assert.equal(Number(inv.amount_ht), 600000);
  // Sans responsable direct : directement aux services généraux ; refus motivé ; annulation par l'auteur
  res = await editeur.post(REQ).send({ kind: 'intervention', title: 'Climatisation en panne', location: 'Bureau 3' });
  assert.equal(res.body.status, 'attente_sg');
  assert.equal((await resp.post(`${REQ}/${res.body.id}/cloturer`).send({ outcome: 'refusee' })).status, 400);
  res = await editeur.post(REQ).send({ kind: 'autre', kind_other: 'Badge', title: 'Badge d’accès perdu' });
  assert.equal((await editeur.post(`${REQ}/${res.body.id}/annuler`)).body.status, 'annulee');
  assert.equal((await commercial.get(`${REQ}/${res.body.id}`)).status, 404, 'demande d’un autre');
});
