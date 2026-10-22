const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login } = require('./helpers');
const { offerSurface, gridOfferFor } = require('../src/lib/domain');

let db, admin, project;

before(async () => {
  let app;
  ({ db, app } = await setup());
  admin = await login(app);
  project = await db('projects').where({ slug: 'bingerville' }).first();
});
after(() => db.destroy());

const grid = rows => admin.put(`/api/admin/projects/${project.id}/offers`).send(rows);
const lot = code => db('lots').where({ project_id: project.id, code }).first();

test('surface de la grille : surface exacte (pas de fourchette), terrain pour une villa', () => {
  assert.equal(offerSurface('400'), 400);
  assert.equal(offerSurface('400 m²'), 400);
  assert.equal(offerSurface('1 000 m²'), 1000);
  assert.equal(offerSurface('T.125 m² | H.85 m²'), 125, 'surface du terrain');
  assert.equal(offerSurface('Sur demande'), null);
  const offers = [{ id: 1, label: 'Terrain nu', surface: '400', price_fcfa: 10 }, { id: 2, label: 'Villa', surface: '400', price_fcfa: 99 }];
  assert.equal(gridOfferFor(offers, 400).id, 1, 'première ligne qui correspond');
  assert.equal(gridOfferFor(offers, 400, 2).id, 2, 'même type de bien que le lot');
  assert.equal(gridOfferFor(offers, 401), null, 'surface exacte uniquement');
  assert.equal(gridOfferFor(offers, 450), null);
});

test('les lots prennent le prix de la grille selon leur surface ; un prix saisi reste', async () => {
  let res = await grid([
    { label: 'Terrain nu', surface: '400', price_fcfa: 2400000, diaspora_price_fcfa: 2700000 },
    { label: 'Terrain nu', surface: '500', price_fcfa: 2400000 },
    { label: 'Terrain nu', surface: '600', price_fcfa: 2700000 },
  ]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const offer400 = res.body.find(o => o.surface === '400');

  res = await admin.put(`/api/admin/projects/${project.id}/lots`).send([
    { code: 'G-400', surface_m2: 400 },
    { code: 'G-450', surface_m2: 450 },
    { code: 'G-MAN', surface_m2: 400, price_fcfa: 3000000 },
  ]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.priced, 1);
  let g400 = await lot('G-400');
  assert.equal(Number(g400.price_fcfa), 2400000);
  assert.equal(g400.offer_id, offer400.id);
  assert.equal(!!g400.price_from_grid, true);
  assert.equal((await lot('G-450')).price_fcfa, null, 'pas de ligne pour 450 m²');
  assert.equal(Number((await lot('G-MAN')).price_fcfa), 3000000);

  // La grille change : les lots qui la suivent sont mis à jour, pas le prix saisi à la main
  const rows = (await admin.get(`/api/admin/projects/${project.id}`)).body.offers;
  await grid(rows.map(o => ({ ...o, price_fcfa: o.surface === '400' ? 2500000 : o.price_fcfa })));
  assert.equal(Number((await lot('G-400')).price_fcfa), 2500000);
  assert.equal(Number((await lot('G-MAN')).price_fcfa), 3000000);

  // Surface corrigée : le prix suit
  const g450 = await lot('G-450');
  res = await admin.patch(`/api/admin/lots/${g450.id}`).send({ surface_m2: 600 });
  assert.equal(Number(res.body.price_fcfa), 2700000);

  // Le formulaire renvoie le prix affiché (celui de la grille) : le lot continue de la suivre
  g400 = await lot('G-400');
  await admin.patch(`/api/admin/lots/${g400.id}`).send({ code: 'G-400', price_fcfa: 2500000, surface_m2: 400 });
  assert.equal(!!(await lot('G-400')).price_from_grid, true);

  // Surface absente de la grille : le prix venu de la grille est retiré (le prix saisi reste)
  res = await admin.patch(`/api/admin/lots/${g450.id}`).send({ surface_m2: 612 });
  assert.equal(res.body.price_fcfa, null);
  await admin.patch(`/api/admin/lots/${(await lot('G-MAN')).id}`).send({ surface_m2: 612 });
  assert.equal(Number((await lot('G-MAN')).price_fcfa), 3000000);
});

test('un lot réservé ou avec dossier ne change pas de prix', async () => {
  const g400 = await lot('G-400');
  await db('lots').where({ id: g400.id }).update({ status: 'reserve' });
  const rows = (await admin.get(`/api/admin/projects/${project.id}`)).body.offers;
  await grid(rows.map(o => ({ ...o, price_fcfa: o.surface === '400' ? 2600000 : o.price_fcfa })));
  assert.equal(Number((await lot('G-400')).price_fcfa), 2500000);
});
