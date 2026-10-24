const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, request } = require('./helpers');

let db, app, admin, project, types;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  types = Object.fromEntries((await db('ref_items').where({ kind: 'type_bien' }).select('id', 'label')).map(t => [t.label, t.id]));
});
after(() => db.destroy());

test('plusieurs types de biens par projet ; chaque bien porte un type coché du projet', async () => {
  let res = await admin.patch(`/api/admin/projects/${project.id}`).send({ property_type_ids: [types['Villa basse'], types.Appartement] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.property_types.map(t => t.label), ['Villa basse', 'Appartement']);
  assert.equal(res.body.property_type_id, types['Villa basse'], 'le premier type reste le type principal');
  assert.deepEqual((await admin.get(`/api/admin/projects/${project.id}`)).body.property_type_ids, [types['Villa basse'], types.Appartement]);

  res = await admin.post(`/api/admin/projects/${project.id}/lots`).send({ code: 'APT-1', property_type_id: types.Appartement, surface_m2: 90 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await admin.post(`/api/admin/projects/${project.id}/lots`).send({ code: 'D-1', property_type_id: types.Duplex })).status, 400, 'type non coché');
  // Site public : types cochés (tuile « N types de biens »)
  const pub = (await request(app).get('/api/public/projects')).body.find(p => p.id === project.id);
  assert.deepEqual(pub?.property_types, ['Villa basse', 'Appartement']);
  assert.deepEqual((await request(app).get(`/api/public/projects/${project.slug}`)).body.property_types, ['Villa basse', 'Appartement']);
  const lots = (await admin.get(`/api/admin/lots?project_id=${project.id}`)).body;
  assert.equal(lots.find(l => l.code === 'APT-1').property_type, 'Appartement');

  // Un type porté par un bien ne se décoche pas
  res = await admin.patch(`/api/admin/projects/${project.id}`).send({ property_type_ids: [types['Villa basse']] });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Appartement/);
  // Ancien formulaire (un seul type) : la liste cochée suit
  const other = await db('projects').whereNot({ id: project.id }).first();
  res = await admin.patch(`/api/admin/projects/${other.id}`).send({ property_type_id: types.Duplex });
  assert.deepEqual(res.body.property_type_ids, [types.Duplex]);
  // Un type coché sur un projet est « utilisé » : il ne se supprime pas de Paramètres
  assert.ok((await require('../src/services/refs').projectsUsing(db, types.Appartement)).includes(project.id));
});
