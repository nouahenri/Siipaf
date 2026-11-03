const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

// Directions et services administrables (demande du client du 03/11) : comme les postes de RH › Réglages
let db, app, admin, expl, commercial, users;
const O = '/api/admin/erp/organisation';
const R = '/api/admin/erp/rh';
const all = list => [...list.directions.flatMap(d => d.services), ...list.without_direction];

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  expl = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  users = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
});
after(() => db.destroy());

test('regroupement de départ : 4 directions, les 9 services et leur module', async () => {
  const res = await commercial.get(O);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.directions.map(d => d.label), ['Direction générale', 'Direction administrative et financière', 'Direction commerciale', 'Direction technique']);
  assert.equal(all(res.body).length, 9);
  assert.equal(all(res.body).find(s => s.key === 'comptabilite').module, 'compta');
  assert.equal((await commercial.post(O).send({ kind: 'service', label: 'Trésorerie' })).status, 403, 'privilège Directions et services');
});

test('ajouter, renommer, rattacher à un module ; le service sert aussitôt dans la fiche employé', async () => {
  const daf = (await expl.get(O)).body.directions.find(d => d.label.startsWith('Direction administrative'));
  let res = await expl.post(O).send({ kind: 'service', label: 'Trésorerie', direction_id: daf.id, module: 'compta' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const treso = all(res.body).find(s => s.label === 'Trésorerie');
  assert.equal(treso.key, 'tresorerie');
  assert.equal(treso.direction_id, daf.id);
  assert.equal((await expl.post(O).send({ kind: 'service', label: 'trésorerie' })).status, 409, 'doublon');
  assert.equal((await expl.post(O).send({ kind: 'service', label: 'Paie', module: 'inconnu' })).status, 400);
  res = await expl.post(`${R}/employees`).send({ matricule: 'TR-001', last_name: 'Bamba', first_name: 'Ali', job_title: 'Trésorier', department: 'tresorerie', hire_date: '2026-11-01', user_id: users.commercial });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await expl.patch(`${O}/${treso.id}`).send({ label: 'Trésorerie et banques' })).status, 200);
  assert.equal((await expl.get(`${R}/meta`)).body.departments.tresorerie, 'Trésorerie et banques', 'libellé relu partout');
  // Module : « Demandes du service » dans le menu de la Comptabilité pour ce service
  assert.deepEqual((await commercial.get('/api/admin/erp/demandes/espace')).body.module_departments.compta.sort(), ['comptabilite', 'tresorerie']);
});

test('chef de direction : il dirige aussi les services qu’elle regroupe', async () => {
  const daf = (await expl.get(O)).body.directions.find(d => d.label.startsWith('Direction administrative'));
  const ali = await db('employees').where({ matricule: 'TR-001' }).first();
  assert.equal((await expl.put(`${R}/department-heads/${daf.key}`).send({ employee_id: ali.id })).status, 200);
  const esp = await commercial.get('/api/admin/erp/demandes/espace');
  assert.equal(esp.status, 200, JSON.stringify(esp.body));
  const mine = esp.body.departments;
  assert.ok(['comptabilite', 'rh', 'administratif', 'tresorerie'].every(k => mine.heads.includes(k)), JSON.stringify(mine));
});

test('archiver, fusionner, supprimer', async () => {
  let list = (await expl.get(O)).body;
  const treso = all(list).find(s => s.key === 'tresorerie');
  assert.equal((await expl.delete(`${O}/${treso.id}`)).status, 409, 'déjà servi : archiver ou fusionner');
  assert.equal((await expl.patch(`${O}/${treso.id}`).send({ active: false })).status, 200);
  assert.equal((await expl.post(`${R}/employees`).send({ matricule: 'TR-002', last_name: 'Koffi', first_name: 'Ama', job_title: 'Caissière', department: 'tresorerie', hire_date: '2026-11-01' })).status, 400, 'service archivé : plus proposé');
  assert.match((await expl.get(`${R}/meta`)).body.departments.tresorerie, /archivé/, 'reste lisible sur les fiches');
  const compta = all(list).find(s => s.key === 'comptabilite');
  assert.equal((await expl.post(`${O}/${treso.id}/merge`).send({ into: compta.id })).status, 200);
  assert.equal((await db('employees').where({ matricule: 'TR-001' }).first()).department, 'comptabilite', 'fiches passées au service gardé');
  assert.ok(!(await db('org_units').where({ key: 'tresorerie' }).first()));
  const res = await expl.post(O).send({ kind: 'service', label: 'Service jamais utilisé' });
  const unused = all(res.body).find(s => s.label === 'Service jamais utilisé');
  assert.equal((await expl.delete(`${O}/${unused.id}`)).status, 200, 'jamais servi : supprimé');
  // Une direction se fusionne dans une autre : ses services la suivent
  list = (await expl.get(O)).body;
  const [dg, daf] = [list.directions[0], list.directions[1]];
  assert.equal((await expl.post(`${O}/${dg.id}/merge`).send({ into: daf.id })).status, 200);
  assert.ok((await expl.get(O)).body.directions.find(d => d.id === daf.id).services.some(s => s.key === 'juridique'));
  assert.equal((await admin.post(`${O}/${daf.id}/merge`).send({ into: compta.id })).status, 400, 'direction dans un service : refusé');
});
