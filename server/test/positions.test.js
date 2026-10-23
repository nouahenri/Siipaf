const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const positions = require('../src/services/positions');

let db, app, admin, resp, comptable, ids, emp;
const RH = '/api/admin/erp/rh';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  await createUser(db, 'commercial');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  // Le responsable d'exploitation (RH : fiches) et le comptable (paie) créent les fiches par les écrans habituels
  let res = await comptable.post('/api/admin/erp/paie/employees').send({ last_name: 'Koné', first_name: 'Awa', job_title: 'Commercial', department: 'commercial', hire_date: '2024-01-15', base_salary: 350000, user_id: ids.commercial });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  emp = { awa: res.body.id };
  res = await comptable.post('/api/admin/erp/paie/employees').send({ last_name: 'Yao', first_name: 'Paul', job_title: 'commercial', department: 'commercial', hire_date: '2024-03-01', base_salary: 300000 });
  emp.paul = res.body.id;
});
after(() => db.destroy());

test('postes : un intitulé saisi rejoint la liste (sans doublon de casse) ; RH › Réglages crée et renomme', async () => {
  let res = await resp.get(`${RH}/positions`);
  const commercial = res.body.positions.filter(p => p.title.toLowerCase() === 'commercial');
  assert.equal(commercial.length, 1, 'un seul poste « Commercial »');
  assert.equal(commercial[0].employees, 2);
  const vendeur = await login(app, 'commercial@test.ci', 'motdepasse-test-123');
  assert.equal((await vendeur.post(`${RH}/positions`).send({ title: 'Responsable commercial', department: 'commercial' })).status, 403, 'droit rh:settings');
  res = await resp.post(`${RH}/positions`).send({ title: 'Responsable commercial', department: 'commercial', category: 'Cadre', default_role: 'resp_exploitation' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await resp.post(`${RH}/positions`).send({ title: 'responsable COMMERCIAL', department: 'commercial' })).status, 409);
  assert.equal((await resp.post(`${RH}/positions`).send({ title: 'DG', department: 'direction', default_role: 'super_admin' })).status, 400);
  await resp.patch(`${RH}/positions/${commercial[0].id}`).send({ title: 'Commercial(e)' });
  assert.equal((await db('employees').where({ id: emp.paul }).first()).job_title, 'Commercial(e)', 'les fiches suivent le renommage');
});

test('changement de poste immédiat : poste, service, catégorie, salaire, équipe, rôle du compte, carrière datée', async () => {
  const post = await db('hr_positions').where({ title: 'Responsable commercial' }).first();
  const body = { position_id: post.id, effective_date: day(0), reason: 'promotion', category: 'Cadre', base_salary: 600000, team_ids: [emp.paul], role: 'resp_exploitation', note: 'Nomination du 23/10' };
  assert.equal((await resp.post(`${RH}/employees/${emp.awa}/position`).send(body)).status, 403, 'salaire : droit paie:employees');
  let res = await resp.post(`${RH}/employees/${emp.awa}/position`).send({ ...body, base_salary: undefined, role: undefined });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'applique');
  let e = await db('employees').where({ id: emp.awa }).first();
  assert.equal(e.job_title, 'Responsable commercial');
  assert.equal(e.category, 'Cadre');
  assert.equal((await db('employees').where({ id: emp.paul }).first()).manager_id, emp.awa, 'équipe rattachée');
  const ev = await db('hr_career_events').where({ employee_id: emp.awa, kind: 'promotion' }).orderBy('id', 'desc').first();
  assert.match(ev.label, /Commercial.*→ Responsable commercial/);
  // Le super administrateur a tous les droits : salaire et rôle du compte
  res = await admin.post(`${RH}/employees/${emp.awa}/position`).send({ ...body, team_ids: [] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  e = await db('employees').where({ id: emp.awa }).first();
  assert.equal(Number(e.base_salary), 600000);
  assert.equal((await db('users').where({ id: ids.commercial }).first()).role, 'resp_exploitation', 'rôle du compte mis à jour');
  assert.equal((await resp.post(`${RH}/employees/${emp.paul}/position`).send({ position_id: post.id, effective_date: day(0), reason: 'promotion', change_manager: true, manager_id: emp.paul })).status, 400, 'pas son propre responsable');
});

test('fusion de deux postes en double : les fiches passent au poste gardé', async () => {
  let res = await resp.post(`${RH}/positions`).send({ title: 'Commerciale', department: 'commercial' });
  const dup = res.body.id;
  await db('employees').insert({ matricule: 'E-DUP', last_name: 'Bamba', first_name: 'Ines', job_title: 'Commerciale', position_id: dup, department: 'commercial', hire_date: '2025-01-01', base_salary: 1 });
  const keep = await db('hr_positions').where({ title: 'Commercial(e)' }).first();
  res = await resp.post(`${RH}/positions/${dup}/merge`).send({ into: keep.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const e = await db('employees').where({ matricule: 'E-DUP' }).first();
  assert.equal(e.position_id, keep.id);
  assert.equal(e.job_title, 'Commercial(e)');
  assert.equal(await db('hr_positions').where({ id: dup }).first(), undefined);
});

test('guide « Bien démarrer » : étapes mesurées d’après la base, coche manuelle des rôles', async () => {
  let res = await resp.get('/api/admin/erp/demarrage');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const step = k => res.body.steps.find(s => s.key === k);
  assert.equal(step('postes').done, true);
  assert.equal(step('roles').done, false);
  assert.match(step('droits').detail, /Direction générale/, 'personne n’a encore le droit DG');
  assert.equal((await comptable.post('/api/admin/erp/demarrage/roles').send({ done: true })).status, 403, 'droit users:write');
  assert.equal((await admin.post('/api/admin/erp/demarrage/roles').send({ done: true })).status, 200);
  res = await resp.get('/api/admin/erp/demarrage');
  assert.equal(step('roles').done, true);
});

test('changement planifié : appliqué à la date d’effet, annulable avant', async () => {
  const p = await db('hr_positions').where({ title: 'Commercial(e)' }).first();
  let res = await resp.post(`${RH}/employees/${emp.paul}/position`).send({ position_id: p.id, department: 'direction', effective_date: day(10), reason: 'mutation' });
  assert.equal(res.body.status, 'planifie');
  assert.equal((await db('employees').where({ id: emp.paul }).first()).department, 'commercial', 'pas encore appliqué');
  assert.equal(await positions.tick(db, day(9)), 0);
  assert.equal(await positions.tick(db, day(10)), 1);
  assert.equal((await db('employees').where({ id: emp.paul }).first()).department, 'direction');
  res = await resp.post(`${RH}/employees/${emp.paul}/position`).send({ position_id: p.id, effective_date: day(20), reason: 'autre' });
  assert.equal((await resp.delete(`${RH}/position-changes/${res.body.id}`)).status, 200);
  assert.equal(await positions.tick(db, day(25)), 0);
  const list = (await resp.get(`${RH}/employees/${emp.paul}/position-changes`)).body;
  assert.deepEqual(list.map(c => c.status), ['annule', 'applique']);
});
