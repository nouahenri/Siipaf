const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');

let db, app, admin;
before(async () => { ({ db, app } = await setup()); admin = await login(app); });
after(() => db.destroy());

async function project(slug) {
  const res = await admin.post('/api/admin/projects').send({ name: slug, slug, published: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

test('archiver masque le projet public, conserve ses dossiers et restaure sans republier', async () => {
  const p = await project('archive-presentation');
  const [lotId] = await db('lots').insert({ project_id: p.id, code: 'A1', price_fcfa: 1000000 });
  const sale = await admin.post(`/api/admin/lots/${lotId}/sale`).send({ name: 'Acquéreur archive', phone: '0700001122' });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const archived = await admin.patch(`/api/admin/projects/${p.id}`).send({ archived: true });
  assert.equal(archived.status, 200);
  assert.ok(archived.body.archived_at);
  assert.equal(archived.body.published, false);
  assert.equal((await request(app).get(`/api/public/projects/${p.slug}`)).status, 404);
  assert.ok(!(await request(app).get('/api/public/projects')).body.some(x => x.id === p.id));
  assert.ok(await db('sales').where({ id: sale.body.id }).first());
  assert.equal((await admin.patch(`/api/admin/projects/${p.id}`).send({ published: true })).status, 409);
  assert.equal((await admin.delete(`/api/admin/projects/${p.id}`)).status, 409);
  const restored = await admin.patch(`/api/admin/projects/${p.id}`).send({ archived: false });
  assert.equal(restored.body.archived_at, null);
  assert.equal(restored.body.published, false);
  assert.equal((await admin.patch(`/api/admin/projects/${p.id}`).send({ published: true })).status, 200);
  assert.equal((await request(app).get(`/api/public/projects/${p.slug}`)).status, 200);
});

test('supprimer un projet sans engagement retire ses lots libres et plans, conserve les médias', async () => {
  const p = await project('projet-sans-engagement');
  const [mediaId] = await db('media').insert({ filename: 'project-delete-test.jpg', original_name: 'plan.jpg', mime: 'image/jpeg', size: 1 });
  const [planId] = await db('site_plans').insert({ project_id: p.id, name: 'Plan libre', media_id: mediaId });
  const lot = await admin.post(`/api/admin/projects/${p.id}/lots`).send({ code: 'LIBRE' });
  assert.equal(lot.status, 201, JSON.stringify(lot.body));
  const res = await admin.delete(`/api/admin/projects/${p.id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await db('projects').where({ id: p.id }).first(), undefined);
  assert.equal(await db('lots').where({ id: lot.body.id }).first(), undefined);
  assert.equal(await db('site_plans').where({ id: planId }).first(), undefined);
  assert.ok(await db('media').where({ id: mediaId }).first());
  assert.equal((await admin.delete(`/api/admin/projects/${p.id}`)).status, 404);
});

test('la suppression protège les contacts et options, y compris expirées', async () => {
  const p = await project('historique-protege');
  const [lotId] = await db('lots').insert({ project_id: p.id, code: 'A1' });
  const [leadId] = await db('leads').insert({ name: 'Contact conservé', phone: '0700004455', project_id: p.id });
  assert.equal((await admin.delete(`/api/admin/projects/${p.id}`)).status, 409);
  await db('leads').where({ id: leadId }).update({ project_id: null });
  await db('lot_options').insert({ lot_id: lotId, lead_id: leadId, state: 'expiree', expires_at: new Date(0) });
  assert.equal((await admin.delete(`/api/admin/projects/${p.id}`)).status, 409);
  assert.ok(await db('lots').where({ id: lotId }).first());
});

test('archivage et suppression exigent le droit de modifier les projets', async () => {
  const p = await project('droits-projet');
  const email = await createUser(db, 'comptable', 'comptable-projets@test.ci');
  const reader = await login(app, email, 'motdepasse-test-123');
  assert.equal((await reader.patch(`/api/admin/projects/${p.id}`).send({ archived: true })).status, 403);
  assert.equal((await reader.delete(`/api/admin/projects/${p.id}`)).status, 403);
});

test('la recherche inclut clients et prospects homonymes et le dossier utilise la fiche choisie', async () => {
  const p = await project('acquereur-existant');
  const ids = [];
  for (const [phone, client_code] of [['0700112233', null], ['0700445566', 'SIIPAF-2026-9999']]) {
    const [id] = await db('leads').insert({ name: 'Amadou Homonyme', phone, client_code, email: `${phone}@test.ci` });
    ids.push(id);
  }
  const result = await admin.get('/api/admin/leads?q=Amadou%20Homonyme&limit=8');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.rows.map(l => l.id).sort(), ids.sort());
  const [beforeCount] = await db('leads').count({ n: '*' });
  const [lotId] = await db('lots').insert({ project_id: p.id, code: 'A1', price_fcfa: 1000000 });
  const sale = await admin.post(`/api/admin/lots/${lotId}/sale`).send({ lead_id: ids[1] });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal(sale.body.lead.id, ids[1]);
  assert.equal(sale.body.lead.phone, '0700445566');
  assert.equal(sale.body.lead.client_code, 'SIIPAF-2026-9999');
  assert.equal((await db('leads').count({ n: '*' }))[0].n, beforeCount.n);
});
