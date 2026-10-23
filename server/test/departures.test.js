const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

let db, app, admin, resp, comptable, ids, empId;
const insertedId = r => (typeof r === 'object' ? r.id : r);
const yesterday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  await createUser(db, 'commercial');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  // Le commercial a une fiche employé, une équipe d'un employé, un véhicule remis, un prospect et un courrier à traiter
  const base = { hire_date: '2024-01-01', job_title: 'Commercial', base_salary: 300000, department: 'commercial' };
  empId = insertedId((await db('employees').insert({ ...base, matricule: 'E-1', last_name: 'Koné', first_name: 'Awa', user_id: ids.commercial }))[0]);
  await db('employees').insert({ ...base, matricule: 'E-2', last_name: 'Yao', first_name: 'Paul', manager_id: empId });
  await db('assets').insert({ code: 'VEH-0001', kind: 'vehicule', name: 'Toyota Hilux', plate: '1234 AB 01', status: 'affecte', employee_id: empId });
  await db('leads').insert({ name: 'Client suivi', phone: '0700000000', assigned_to: ids.commercial, stage: 'visite' });
  await db('leads').insert({ name: 'Prospect perdu', phone: '0700000001', assigned_to: ids.commercial, stage: 'perdu' });
  await db('mail_items').insert({ direction: 'arrivee', year: 2026, seq: 1, number: 'A-2026-0001', date: '2026-10-01', correspondent: 'Mairie', subject: 'Permis', status: 'affecte', assigned_to: ids.commercial, due_date: yesterday() });
});
after(() => db.destroy());

test('départ : bilan du compte, du matériel et des dossiers, chacun prévenu de ce qu’il règle', async () => {
  let res = await comptable.patch(`/api/admin/erp/paie/employees/${empId}`).send({ active: false, end_date: '2026-10-22' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  res = await resp.get(`/api/admin/erp/rh/employees/${empId}/departure`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const r = res.body;
  assert.equal(r.account.active, true, 'le compte n’est jamais désactivé d’office');
  assert.deepEqual(r.assets.map(a => a.code), ['VEH-0001']);
  const by = Object.fromEntries(r.items.map(x => [x.key, x.count]));
  assert.deepEqual(by, { leads: 1, courrier: 1, equipe: 1 }, 'le prospect perdu ne compte pas');
  assert.equal(r.pending, 5);
  assert.equal((await db('users').where({ id: ids.commercial }).first()).active ? 1 : 0, 1);

  const bell = async (agent, event) => (await agent.get('/api/admin/erp/notifications')).body.items.find(n => n.event === event);
  assert.ok(await bell(admin, 'depart.compte'), 'gestion des comptes : désactiver le compte');
  assert.match((await bell(resp, 'depart.materiel')).body, /VEH-0001/, 'services généraux : récupérer le véhicule');
  assert.ok(await bell(resp, 'depart.dossiers'), 'direction : réaffecter les dossiers');
  assert.equal((await bell(comptable, 'depart.dossiers')), undefined, 'pas de notification à l’auteur de la sortie');

  // Une seconde sortie (fiche ré-enregistrée) ne renvoie pas les mêmes alertes
  await comptable.patch(`/api/admin/erp/paie/employees/${empId}`).send({ active: true });
  await comptable.patch(`/api/admin/erp/paie/employees/${empId}`).send({ active: false });
  assert.equal(await db('notifications').where({ event: 'depart.materiel' }).count({ n: '*' }).first().then(x => Number(x.n)), 1);

  // Tout réglé : compte désactivé, matériel rendu, dossiers repris
  await db('users').where({ id: ids.commercial }).update({ active: false });
  await db('assets').update({ employee_id: null, status: 'disponible' });
  await db('leads').update({ assigned_to: ids.resp_exploitation });
  await db('mail_items').update({ status: 'traite' });
  await db('employees').where({ manager_id: empId }).update({ manager_id: null });
  assert.equal((await resp.get(`/api/admin/erp/rh/employees/${empId}/departure`)).body.pending, 0);
  const editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  assert.equal((await editeur.get(`/api/admin/erp/rh/employees/${empId}/departure`)).status, 403, 'réservé au service RH et à la direction');
});

test('vue Direction : section Administration générale et retards à traiter', async () => {
  await db('mail_items').insert({ direction: 'arrivee', year: 2026, seq: 2, number: 'A-2026-0002', date: '2026-10-02', correspondent: 'Notaire', subject: 'Acte', status: 'affecte', assigned_to: ids.resp_exploitation, due_date: yesterday() });
  await db('mail_items').insert({ direction: 'arrivee', year: 2026, seq: 3, number: 'A-2026-0003', date: '2026-10-03', correspondent: 'Banque', subject: 'Relevé', status: 'enregistre' });
  const res = await admin.get('/api/admin/erp/direction/overview');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const a = res.body.administration;
  assert.equal(a.courrier.to_assign, 1);
  assert.equal(a.courrier.late, 1);
  for (const k of ['contrats', 'parc', 'documents', 'demandes']) assert.ok(a[k], k);
  const late = a.attention.find(x => x.module === 'courrier');
  assert.equal(late.link, `/administration/courrier?fiche=${(await db('mail_items').where({ number: 'A-2026-0002' }).first()).id}`);
});
