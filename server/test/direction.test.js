const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { SITE_STAGES } = require('../src/lib/domain');

let db, app, admin, resp, commercial, comptable, project, lots;
const URL = '/api/admin/erp/direction/overview';

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'D1', price_fcfa: 20000000 }, { code: 'D2', price_fcfa: 30000000 }]);
  lots = await db('lots').where({ project_id: project.id }).whereIn('code', ['D1', 'D2']).orderBy('code');
  await db('lots').where({ id: lots[0].id }).update({ ilot: '4' });
});
after(() => db.destroy());

test('vue Direction : responsable d’exploitation et super administrateur ; pas le commercial ni le comptable', async () => {
  assert.equal((await resp.get(URL)).status, 200);
  assert.equal((await admin.get(URL)).status, 200);
  assert.equal((await commercial.get(URL)).status, 403);
  assert.equal((await comptable.get(URL)).status, 403);
});

test('synthèse : ventes et encaissements du programme, avancement du chantier par programme, îlot et dossier', async () => {
  let res = await admin.post(`/api/admin/lots/${lots[0].id}/sale`).send({ name: 'Client Direction', phone: '0708080808', financing: 'comptant' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const sale = await db('sales').where({ lot_id: lots[0].id }).first();
  await comptable.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 5000000, paid_at: '2026-10-01', method: 'virement' });
  const stage = SITE_STAGES[2];
  await db('site_updates').insert([
    { project_id: project.id, stage, progress_pct: 30, title: 'Programme', visible_client: true, published_at: new Date(Date.now() - 2000) },
    { project_id: project.id, ilot: '4', stage, progress_pct: 50, title: 'Îlot 4', visible_client: true, published_at: new Date() },
  ]);

  res = await resp.get(URL);
  const d = res.body;
  for (const k of ['commercial', 'chantiers', 'finance', 'rh', 'sav', 'achats']) assert.ok(d[k], `section ${k}`);
  const p = d.chantiers.projects.find(x => x.id === project.id);
  assert.equal(p.dossiers, 1);
  assert.equal(p.ca_fcfa, 20000000);
  assert.equal(p.encaisse_fcfa, 5000000);
  assert.equal(p.reste_fcfa, 15000000);
  assert.equal(p.progress_pct, 30, 'avancement du programme');
  assert.equal(p.ilots.find(i => i.ilot === '4').progress_pct, 50, 'avancement de l’îlot');
  assert.equal(p.dossiers_progress_pct, 50, 'le dossier suit son îlot');
  assert.equal(p.stale, false);
  assert.equal(d.commercial.ytd.ventes >= 1, true);
  assert.equal(typeof d.finance.overdue_fcfa, 'number');
  assert.equal(Array.isArray(d.rh.performance.departments), true);
  assert.equal(typeof d.sav.open, 'number');
});

test('Vue Direction : mêmes indicateurs Achats & stocks après validation, réception partielle et réapprovisionnement', async () => {
  const A = '/api/admin/erp/achats';
  const day = new Date().toISOString().slice(0, 10);
  const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
  async function summary() {
    const overview = ok(await resp.get(URL));
    const module = ok(await admin.get(`${A}/dashboard`));
    assert.deepEqual(overview.achats, module, 'une seule source pour les chiffres et le plafond');
    return overview.achats;
  }
  let s = await summary();
  assert.equal(s.orders_waiting, 0); assert.equal(s.to_receive, 0); assert.equal(s.committed_fcfa, 0); assert.equal(s.low_stock.length, 0);
  const [supplierId] = await db('suppliers').insert({ name: 'Matériaux Direction', kind: 'fournisseur' });
  const place = await db('places').first();
  const unit = (await db('worksite_ref_items').where({ kind: 'unite', active: true }).first()).code;
  const loc = ok(await admin.post(`${A}/locations`).send({ place_id: place.id }), 201);
  const article = ok(await admin.post(`${A}/articles`).send({ code: 'DIR-STOCK', label: 'Matériaux Direction', unit, min_quantity: 10 }), 201);
  async function entry(quantity) {
    const movement = ok(await admin.post(`${A}/movements`).send({ kind: 'entree', date: day, to_location_id: loc.id, note: 'Stock Direction test', lines: [{ article_id: article.id, quantity }] }), 201);
    ok(await admin.post(`${A}/movements/${movement.id}/post`));
  }
  await entry(5);
  async function order(quantity) {
    const o = ok(await admin.post(`${A}/orders`).send({ supplier_id: supplierId, location_id: loc.id, date: day, vat_rate: 18, lines: [{ article_id: article.id, quantity, unit_price_fcfa: 1000 }] }), 201);
    // Le compte opérationnel transmet la grosse commande à la Direction.
    await db('appro_orders').where({ id: o.id }).update({ approver_id: (await db('users').where({ role: 'resp_exploitation' }).first()).id });
    ok(await comptable.post(`${A}/orders/${o.id}/submit`)); return o;
  }
  const o = await order(3), pending = await order(600);
  s = await summary(); assert.equal(s.orders_waiting, 2, 'commandes soumises, sous le plafond et à partir du plafond');
  ok(await resp.post(`${A}/orders/${o.id}/approve`));
  s = await summary();
  assert.equal(s.orders_waiting, 1); assert.equal(s.to_receive, 1); assert.equal(s.low_stock.length, 1); assert.equal(s.committed_fcfa, 3540);
  const receive = quantity => admin.post(`${A}/orders/${o.id}/receive`).send({ date: day, lines: [{ order_line_id: o.lines[0].id, quantity }] });
  ok(await receive(1));
  s = await summary();
  assert.equal(s.committed_fcfa, 2360, 'seul le TTC encore à réceptionner reste engagé');
  assert.equal(s.to_receive, 1); assert.equal(s.orders_waiting, 1);
  ok(await admin.post(`${A}/orders/${pending.id}/cancel`));
  ok(await receive(2)); await entry(3);
  s = await summary();
  assert.equal(s.orders_waiting, 0); assert.equal(s.to_receive, 0); assert.equal(s.committed_fcfa, 0); assert.equal(s.low_stock.length, 0);
});
