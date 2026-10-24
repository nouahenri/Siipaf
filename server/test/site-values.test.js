const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, request } = require('./helpers');

let db, app, admin, project;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
});
after(() => db.destroy());

test('chiffres clés du site : réglés dans la fiche projet, publiés avec leur pictogramme', async () => {
  const figures = [{ icon: 'surface', value: '59 ha', label: 'Superficie' }, { icon: 'acces', value: 'Rocade Y4', label: 'Accès direct' }];
  let res = await admin.patch(`/api/admin/projects/${project.id}`).send({ key_figures: figures });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.key_figures, figures);
  assert.deepEqual((await admin.get(`/api/admin/projects/${project.id}`)).body.key_figures, figures, 'relu tel quel');
  const pub = (await request(app).get('/api/public/projects')).body.find(p => p.id === project.id);
  assert.deepEqual(pub.key_figures, [{ icon: 'fas fa-ruler-combined', value: '59 ha', label: 'Superficie' }, { icon: 'fas fa-road', value: 'Rocade Y4', label: 'Accès direct' }]);
  assert.equal((await request(app).get(`/api/public/projects/${project.slug}`)).body.key_figures.length, 2);

  assert.equal((await admin.patch(`/api/admin/projects/${project.id}`).send({ key_figures: [{ icon: 'fusee', value: 'x', label: '' }] })).status, 400, 'pictogramme inconnu');
  assert.equal((await admin.patch(`/api/admin/projects/${project.id}`).send({ key_figures: [{ icon: 'info', value: '', label: 'Vide' }] })).status, 400, 'valeur obligatoire');
  res = await admin.patch(`/api/admin/projects/${project.id}`).send({ key_figures: [] });
  assert.deepEqual(res.body.key_figures, []);
  assert.deepEqual((await request(app).get('/api/public/projects')).body.find(p => p.id === project.id).key_figures, []);
});

test('grille de prix : badge et points forts de chaque ligne, sur le site', async () => {
  const grid = [
    { label: 'Duplex', designation: 'comptant', price_fcfa: 99000000, badge: null, highlights: null },
    { label: 'Duplex', designation: '12 mois', price_fcfa: 110000000, badge: 'Populaire', highlights: '30 % à la réservation\n35 % à la remise des clés' },
  ];
  let res = await admin.put(`/api/admin/projects/${project.id}/offers`).send(grid);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.map(o => [o.badge, o.highlights]), [[null, null], ['Populaire', '30 % à la réservation\n35 % à la remise des clés']]);
  // Réenregistrer la grille relue ne perd rien
  res = await admin.put(`/api/admin/projects/${project.id}/offers`).send(res.body.map(({ id, label, designation, surface, price_fcfa, diaspora_price_fcfa, badge, highlights }) => ({ id, label, designation, surface, price_fcfa, diaspora_price_fcfa, badge, highlights })));
  assert.equal(res.body[1].badge, 'Populaire');
  const pub = (await request(app).get('/api/public/projects')).body.find(p => p.id === project.id);
  assert.deepEqual(pub.offers.map(o => o.badge), [null, 'Populaire']);
  assert.match(pub.offers[1].highlights, /remise des clés/);
});

test('reprise : les valeurs écrites du site passent dans les fiches projet', async () => {
  const name = '20261117000000_site_project_values.js';
  await db.migrate.down({ name });
  await db.migrate.up({ name });
  const p = await db('projects').where({ slug: 'ahoutoue' }).first();
  assert.deepEqual(JSON.parse(p.key_figures).map(f => f.value), ['59 ha', '30%', 'Rocade Y4']);
});
