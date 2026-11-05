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

test('fiche employé : la méta paie donne la direction de chaque service (champ Direction du formulaire)', async () => {
  const meta = (await admin.get('/api/admin/erp/paie/meta')).body;
  assert.equal(meta.directions[meta.department_directions.comptabilite], 'Direction administrative et financière');
  assert.equal(meta.directions[meta.department_directions.commercial], 'Direction commerciale');
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

// Demande du client du 03/11 (suite) : glisser-déposer, panneau du personnel, réaffectation tracée, suppression avec reprise
test('glisser-déposer : un service passe sous une autre direction et l’ordre est gardé', async () => {
  const list = (await expl.get(O)).body;
  const [first, second] = list.directions;
  const svc = all(list).find(s => s.key === 'sav');
  const items = [second, first, ...list.directions.slice(2)].map(d => ({ id: d.id, direction_id: null }))
    .concat({ id: svc.id, direction_id: first.id }, ...all(list).filter(s => s.id !== svc.id).map(s => ({ id: s.id, direction_id: s.direction_id })));
  const res = await expl.put(`${O}/order`).send({ items });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.directions.slice(0, 2).map(d => d.id), [second.id, first.id]);
  assert.equal(res.body.directions.find(d => d.id === first.id).services[0].key, 'sav', 'rangé en tête de la direction');
  assert.equal((await expl.put(`${O}/order`).send({ items: [{ id: first.id, direction_id: second.id }] })).status, 400, 'une direction ne va pas sous une autre');
  assert.equal((await commercial.put(`${O}/order`).send({ items })).status, 403);
  // Fiche poste : la direction se lit d'après le service
  assert.equal((await expl.get(`${R}/meta`)).body.department_directions.sav, first.key);
});

test('réaffecter le personnel puis supprimer le service avec un service de reprise', async () => {
  const list = (await expl.get(O)).body;
  const daf = list.directions.find(d => d.label.startsWith('Direction administrative'));
  let res = await expl.post(O).send({ kind: 'service', label: 'Logistique', direction_id: daf.id });
  const logi = all(res.body).find(s => s.label === 'Logistique');
  const add = (m, last, user_id) => expl.post(`${R}/employees`).send({ matricule: m, last_name: last, first_name: 'Test', job_title: 'Magasinier', department: logi.key, hire_date: '2026-11-01', user_id });
  const yao = (await db('users').where({ email: await createUser(db, 'commercial', 'yao@test.ci') }).first('id')).id;
  const a = (await add('LG-001', 'Yao', yao)).body, b = (await add('LG-002', 'Kone')).body;
  assert.ok(a.id && b.id, 'fiches créées');
  const panel = await expl.get(`${O}/${logi.id}`);
  assert.equal(panel.status, 200);
  assert.deepEqual(panel.body.employees.map(e => e.matricule).sort(), ['LG-001', 'LG-002']);
  assert.equal((await commercial.get(`${O}/${logi.id}`)).status, 403, 'personnel : privilège Directions et services');
  // Encore du personnel : suppression refusée
  assert.equal((await expl.delete(`${O}/${logi.id}`)).status, 409);
  res = await expl.post(`${O}/reassign`).send({ employee_ids: [a.id], department: 'rh' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.moved, 1);
  const event = await db('hr_career_events').where({ employee_id: a.id, kind: 'mutation' }).first();
  assert.ok(event, 'inscrit dans l’historique de carrière');
  assert.deepEqual(JSON.parse(event.details).department, { from: logi.key, to: 'rh' });
  assert.ok(await db('notifications').where({ event: 'rh.service', user_id: yao }).first(), 'employé prévenu');
  assert.equal((await expl.post(`${O}/reassign`).send({ employee_ids: [b.id], department: 'inconnu' })).status, 400);
  await expl.post(`${O}/reassign`).send({ employee_ids: [b.id], department: 'administratif' });
  // Plus de personnel actif : le reste (postes, historique) va au service de reprise
  assert.equal((await expl.delete(`${O}/${logi.id}`)).status, 400, 'service de reprise exigé');
  const compta = all(list).find(s => s.key === 'comptabilite');
  assert.equal((await expl.delete(`${O}/${logi.id}?into=${compta.id}`)).status, 200);
  assert.ok(!(await db('org_units').where({ key: logi.key }).first()));
  assert.equal(await db('hr_positions').where({ department: logi.key }).first(), undefined, 'postes repris');
});

test('supprimer une direction : ses services passent à la direction choisie', async () => {
  let res = await expl.post(O).send({ kind: 'direction', label: 'Direction des opérations' });
  const ops = res.body.directions.find(d => d.label === 'Direction des opérations');
  res = await expl.post(O).send({ kind: 'service', label: 'Atelier', direction_id: ops.id });
  const target = res.body.directions.find(d => d.id !== ops.id);
  assert.equal((await expl.delete(`${O}/${ops.id}?into=${target.id}`)).status, 200);
  const after = (await expl.get(O)).body;
  assert.ok(!after.directions.some(d => d.id === ops.id));
  assert.ok(after.directions.find(d => d.id === target.id).services.some(s => s.label === 'Atelier'));
});
