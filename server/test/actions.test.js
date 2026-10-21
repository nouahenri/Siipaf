const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { SAV_CATEGORIES } = require('../src/lib/domain');

let db, app, admin, conducteur, comptable, commercial;
before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
});
after(() => db.destroy());

const setRole = async (role, add = [], remove = []) => {
  const current = (await admin.get('/api/admin/permissions')).body.roles.find(r => r.id === role).permissions;
  const res = await admin.put(`/api/admin/permissions/roles/${role}`).send({ permissions: [...new Set([...current.filter(p => !remove.includes(p)), ...add])] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
};

test('SAV par action : le conducteur crée et traite mais n’attribue pas sans le droit', async () => {
  const category = Object.keys(SAV_CATEGORIES)[0];
  const [leadId] = await db('leads').insert({ name: 'Client SAV', phone: '0700000009', stage: 'prospection' });
  let res = await conducteur.post('/api/admin/erp/sav/tickets').send({ category, title: 'Fissure du mur', lead_id: typeof leadId === 'object' ? leadId.id : leadId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id = res.body.id;
  const other = await db('users').where({ email: 'comptable@test.ci' }).first();
  assert.equal((await conducteur.patch(`/api/admin/erp/sav/tickets/${id}`).send({ assigned_to: other.id })).status, 403);
  assert.equal((await conducteur.patch(`/api/admin/erp/sav/tickets/${id}`).send({ location: 'Salon' })).status, 200);
  await setRole('conducteur_travaux', ['sav:assign'], ['sav:handle']);
  assert.equal((await conducteur.patch(`/api/admin/erp/sav/tickets/${id}`).send({ assigned_to: other.id })).status, 200, 'attribuer sans traiter');
  assert.equal((await conducteur.patch(`/api/admin/erp/sav/tickets/${id}`).send({ location: 'Cuisine' })).status, 403, 'modifier demande « Traiter »');
});

test('comptabilité et espace employé par action ; prospects de l’équipe', async () => {
  assert.equal((await comptable.get('/api/admin/erp/compta/export/sage')).status !== 403, true);
  await setRole('comptable', [], ['compta:export']);
  assert.equal((await comptable.get('/api/admin/erp/compta/export/sage')).status, 403, 'export retiré');
  assert.equal((await comptable.get('/api/admin/erp/compta/entries')).status, 200, 'consultation gardée');

  const user = await db('users').where({ email: 'commercial@test.ci' }).first();
  await comptable.post('/api/admin/erp/paie/employees').send({ last_name: 'Koné', first_name: 'Awa', job_title: 'Commerciale', hire_date: '2025-01-01', base_salary: 300000, user_id: user.id });
  assert.equal((await commercial.post('/api/admin/erp/rh/me/attendance').send({})).status, 200);
  await setRole('commercial', [], ['self:pointage']);
  assert.equal((await commercial.post('/api/admin/erp/rh/me/attendance').send({})).status, 403, 'pointage en ligne retiré au rôle');

  const otherId = (await db('users').where({ email: 'comptable@test.ci' }).first()).id;
  await db('leads').insert([
    { name: 'Prospect 1', phone: '0700000001', stage: 'prospection', assigned_to: null },
    { name: 'Prospect 2', phone: '0700000002', stage: 'prospection', assigned_to: user.id },
    { name: 'Prospect 3', phone: '0700000003', stage: 'prospection', assigned_to: otherId },
  ]);
  const mine = (await commercial.get('/api/admin/erp/commercial/pipeline')).body;
  assert.ok(!mine.some(l => l.name === 'Prospect 3'), 'sans « toute l’équipe » : ses prospects et les non attribués');
  await setRole('commercial', ['leads:all']);
  const all = (await commercial.get('/api/admin/erp/commercial/pipeline')).body;
  assert.ok(all.some(l => l.name === 'Prospect 3'));
});

test('migration : les anciens droits larges deviennent les actions qu’ils couvraient', async () => {
  await db('roles').insert({ id: 'ancien_role', label: 'Ancien rôle', system: false }).catch(() => {});
  await db('role_permissions').insert([{ role: 'ancien_role', permission: 'sav:write' }, { role: 'ancien_role', permission: 'compta:write' }, { role: 'ancien_role', permission: 'leads:read' }]);
  await require('../migrations/20261029000000_erp_actions').up(db);
  const perms = await db('role_permissions').where({ role: 'ancien_role' }).pluck('permission');
  for (const p of ['sav:create', 'sav:handle', 'sav:assign', 'sav:reserves', 'sav:interventions', 'compta:entries', 'achats:write', 'achats:pay', 'frais:post', 'leads:all']) assert.ok(perms.includes(p), p);
  assert.ok(!perms.includes('sav:write') && !perms.includes('compta:write'), 'anciens identifiants retirés');
  assert.ok(!perms.includes('compta:validate'), 'aucun droit gagné au passage');
});

test('comptes créés depuis l’ERP : mot de passe provisoire, fiche employé reliée ou créée, réinitialisation', async () => {
  let res = await admin.post('/api/admin/users').send({ name: 'Yao Christelle', email: 'christelle@test.ci', role: 'editeur', employee: { job_title: 'Assistante', department: 'administratif', hire_date: '2026-01-05' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const temp = res.body.temporary_password;
  assert.equal(temp.length, 12);
  assert.equal(res.body.must_change_password, true);
  const e = await db('employees').where({ user_id: res.body.id }).first();
  assert.deepEqual([e.first_name, e.last_name, e.department], ['Yao', 'Christelle', 'administratif']);

  const { request } = require('./helpers');
  const agent = request.agent(app);
  assert.equal((await agent.post('/api/auth/login').send({ email: 'christelle@test.ci', password: temp })).body.user.must_change_password, true);
  assert.equal((await agent.get('/api/admin/erp/rh/me')).status, 403, 'bloqué tant que le mot de passe est provisoire');
  assert.equal((await agent.post('/api/auth/password').send({ current: temp, next: temp })).status, 400, 'nouveau mot de passe différent');
  await agent.post('/api/auth/password').send({ current: temp, next: 'mon-mot-de-passe-2026' });
  assert.equal((await agent.get('/api/admin/erp/rh/me')).status, 200);

  res = await admin.post(`/api/admin/users/${e.user_id}/reset-password`);
  assert.equal(res.body.temporary_password.length, 12);
  assert.equal((await agent.get('/api/admin/erp/rh/me')).status, 403, 'réinitialisé : à changer de nouveau');

  const list = (await admin.get('/api/admin/users')).body;
  assert.equal(list.find(u => u.email === 'christelle@test.ci').employee.id, e.id);
  assert.equal((await conducteur.post('/api/admin/users').send({ name: 'Intrus', email: 'x@test.ci', role: 'commercial' })).status, 403);
});
