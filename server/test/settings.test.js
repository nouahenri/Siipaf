const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');

let db, app, admin;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
});
after(() => db.destroy());

const refs = async () => (await admin.get('/api/admin/refs')).body.items;
const find = async (kind, label) => (await refs()).find(i => i.kind === kind && i.label === label);

test('les projets existants sont rattachés aux listes (ville, localisation, précision, équipements)', async () => {
  const p = await db('projects').where({ slug: 'ahoutoue' }).first();
  const abidjan = await find('ville', 'Abidjan');
  const place = await find('localisation', 'Ahoutoué');
  assert.equal(p.city_id, abidjan.id);
  assert.equal(p.location_id, place.id);
  assert.equal(place.parent_id, abidjan.id);
  assert.match(p.location_detail, /Axe Abidjan/);
  const detail = (await admin.get(`/api/admin/projects/${p.id}`)).body;
  assert.ok(detail.refs.equipement.some(e => e.label === 'Centre médical'));
  assert.ok((await refs()).some(i => i.kind === 'viabilisation' && i.label === 'Voirie'), 'listes par défaut');
});

test('créer des valeurs : doublon refusé, localisation rattachée à une ville, droit dédié', async () => {
  let res = await admin.post('/api/admin/refs').send({ kind: 'ville', label: 'Grand-Bassam' });
  assert.equal(res.status, 201);
  const bassam = res.body;
  assert.equal((await admin.post('/api/admin/refs').send({ kind: 'ville', label: '  grand-bassam ' })).status, 409);
  assert.equal((await admin.post('/api/admin/refs').send({ kind: 'localisation', label: 'Mondoukou' })).status, 400, 'ville obligatoire');
  res = await admin.post('/api/admin/refs').send({ kind: 'localisation', label: 'Mondoukou', parent_id: bassam.id });
  assert.equal(res.status, 201);
  const commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  assert.equal((await commercial.post('/api/admin/refs').send({ kind: 'ville', label: 'Daloa' })).status, 403);
  assert.equal((await commercial.get('/api/admin/refs')).status, 200, 'lecture pour remplir les menus');
});

test('fiche projet : ville, localisation de cette ville, cases cochées et état de viabilisation', async () => {
  const p = await db('projects').where({ slug: 'riviera' }).first();
  const bassam = await find('ville', 'Grand-Bassam');
  const mondoukou = await find('localisation', 'Mondoukou');
  const ahoutoue = await find('localisation', 'Ahoutoué');
  const voirie = await find('viabilisation', 'Voirie');
  const ecole = await find('commodite', 'École');
  const piscine = await find('equipement', 'Piscine');

  let res = await admin.patch(`/api/admin/projects/${p.id}`).send({ city_id: bassam.id, location_id: ahoutoue.id });
  assert.equal(res.status, 400, 'localisation d’une autre ville');
  res = await admin.patch(`/api/admin/projects/${p.id}`).send({ city_id: bassam.id, location_id: mondoukou.id, location_detail: 'Bord de lagune',
    refs: [{ id: voirie.id, state: 'en_cours' }, { id: ecole.id }, { id: piscine.id, state: 'fait' }] });
  assert.equal(res.status, 400, 'état réservé à la viabilisation');
  res = await admin.patch(`/api/admin/projects/${p.id}`).send({ city_id: bassam.id, location_id: mondoukou.id, location_detail: 'Bord de lagune',
    refs: [{ id: voirie.id, state: 'en_cours' }, { id: ecole.id }, { id: piscine.id }] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.city, 'Grand-Bassam');
  assert.equal(res.body.location, 'Mondoukou — Bord de lagune');
  assert.deepEqual(res.body.amenities, ['Piscine']);

  const pub = (await request(app).get('/api/public/projects/riviera')).body;
  assert.deepEqual(pub.commodites, ['École']);
  assert.deepEqual(pub.viabilisation, [{ label: 'Voirie', state: 'en_cours', state_label: 'En cours' }]);

  // Changer de ville sans préciser la localisation : l'ancienne est retirée
  const abidjan = await find('ville', 'Abidjan');
  res = await admin.patch(`/api/admin/projects/${p.id}`).send({ city_id: abidjan.id });
  assert.equal(res.body.location_id, null);
  assert.equal(res.body.location, 'Bord de lagune');
});

test('renommer met à jour les projets ; une valeur utilisée s’archive mais ne se supprime pas', async () => {
  const ville = await find('ville', 'Yamoussoukro');
  assert.equal((await admin.patch(`/api/admin/refs/${ville.id}`).send({ label: 'Yamoussoukro (capitale)' })).status, 200);
  assert.equal((await db('projects').where({ slug: 'yamoussoukro' }).first()).city, 'Yamoussoukro (capitale)');

  const piscine = await find('equipement', 'Piscine');
  let res = await admin.delete(`/api/admin/refs/${piscine.id}`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /archivez/);
  assert.equal((await admin.patch(`/api/admin/refs/${piscine.id}`).send({ archived: true })).status, 200);
  const riviera = await db('projects').where({ slug: 'riviera' }).first();
  assert.equal((await admin.patch(`/api/admin/projects/${riviera.id}`).send({ refs: [{ id: piscine.id }] })).status, 200, 'déjà sur le projet : conservée');
  const cly = await db('projects').where({ slug: 'cly' }).first();
  res = await admin.patch(`/api/admin/projects/${cly.id}`).send({ refs: [{ id: piscine.id }] });
  assert.equal(res.status, 400, 'archivée : plus proposée');

  const bassam = await find('ville', 'Grand-Bassam');
  assert.equal((await admin.delete(`/api/admin/refs/${bassam.id}`)).status, 409, 'a encore des localisations');
  const libre = (await admin.post('/api/admin/refs').send({ kind: 'commodite', label: 'Plage' })).body;
  assert.equal((await admin.delete(`/api/admin/refs/${libre.id}`)).status, 200);
});

test('une case change de liste (équipement → commodité) et les textes suivent', async () => {
  const p = await db('projects').where({ slug: 'ahoutoue' }).first();
  const ecoles = await find('equipement', '3 écoles');
  assert.equal((await admin.patch(`/api/admin/refs/${ecoles.id}`).send({ kind: 'commodite' })).status, 200);
  const after = await db('projects').where({ id: p.id }).first();
  assert.ok(!JSON.parse(after.amenities).includes('3 écoles'));
  const pub = (await request(app).get('/api/public/projects/ahoutoue')).body;
  assert.ok(pub.commodites.includes('3 écoles'));
});

test('réglages généraux : durée de pré-réservation par défaut', async () => {
  assert.equal((await admin.put('/api/admin/settings').send({ option_days_default: 0 })).status, 400);
  const res = await admin.put('/api/admin/settings').send({ option_days_default: 10 });
  assert.equal(res.body.values.option_days_default, 10);
  const p = await db('projects').where({ slug: 'cly' }).first();
  await db('projects').where({ id: p.id }).update({ option_days: null });
  const [lotId] = await db('lots').insert({ project_id: p.id, code: 'OPT-10', status: 'disponible' });
  const opt = await request(app).post(`/api/public/lots/${lotId}/option`).send({ name: 'Durée Test', phone: '0700009999' });
  assert.equal(opt.status, 201, JSON.stringify(opt.body));
  assert.equal(opt.body.days, 10);
  assert.equal((await request(app).get('/api/public/projects/cly')).body.option_days, 10);
});

test('thème d’affichage enregistré sur le compte', async () => {
  assert.equal((await admin.patch('/api/auth/preferences').send({ theme: 'violet' })).status, 400);
  assert.equal((await admin.patch('/api/auth/preferences').send({ theme: 'sombre' })).status, 200);
  assert.equal((await admin.get('/api/auth/me')).body.user.theme, 'sombre');
});

test('plans : archiver, restaurer, supprimer, reconvertir', async () => {
  const p = await db('projects').where({ slug: 'bingerville' }).first();
  const plan = (await admin.post('/api/admin/plans').send({ project_id: p.id, name: 'Essai', published: true })).body;
  const sq = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]];
  await admin.put(`/api/admin/projects/${p.id}/lots`).send([
    { code: 'B-1', plan_id: plan.id, shape: sq }, { code: 'B-2', plan_id: plan.id, shape: sq }, { code: 'B-3', plan_id: plan.id, shape: sq },
  ]);

  // Reconversion : B-3 absent du nouveau fichier → à placer
  let res = await admin.put(`/api/admin/projects/${p.id}/lots?replace_plan=${plan.id}`).send([
    { code: 'B-1', plan_id: plan.id, shape: sq }, { code: 'B-2', plan_id: plan.id, shape: sq }, { code: 'B-4', plan_id: plan.id, shape: sq },
  ]);
  assert.deepEqual(res.body, { created: 1, updated: 2, unplaced: 1 });
  const b3 = await db('lots').where({ project_id: p.id, code: 'B-3' }).first();
  assert.equal(b3.plan_id, null);
  assert.equal(b3.shape, null);

  assert.equal((await admin.delete(`/api/admin/plans/${plan.id}`)).status, 409, 'publié : pas de suppression');
  res = await admin.patch(`/api/admin/plans/${plan.id}`).send({ archived: true });
  assert.ok(res.body.archived_at);
  assert.equal(!!res.body.published, false, 'archiver retire du site');
  assert.equal((await admin.patch(`/api/admin/plans/${plan.id}`).send({ published: true })).status, 409);
  assert.equal((await request(app).get('/api/public/projects/bingerville')).body.plans.length, 0);
  res = await admin.patch(`/api/admin/plans/${plan.id}`).send({ archived: false });
  assert.equal(res.body.archived_at, null);

  // B-1 a un dossier : il reste (à placer) ; B-2 et B-4 libres : supprimés avec l'option
  const b1 = await db('lots').where({ project_id: p.id, code: 'B-1' }).first();
  const sale = await admin.post(`/api/admin/lots/${b1.id}/sale`).send({ name: 'Acheteur Plan', phone: '0700000123', price_fcfa: 50000000 });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  res = await admin.delete(`/api/admin/plans/${plan.id}?delete_lots=1`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual({ deleted: res.body.deleted, unplaced: res.body.unplaced }, { deleted: 2, unplaced: 1 });
  assert.equal(await db('site_plans').where({ id: plan.id }).first(), undefined);
  assert.equal((await db('lots').where({ id: b1.id }).first()).plan_id, null);
});
