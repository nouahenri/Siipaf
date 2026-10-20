const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setup, login, createUser, request } = require('./helpers');
const { catalog } = require('../src/services/siteImages');

let db, app, admin, imageId;
before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  [imageId] = await db('media').insert({ filename: 'site-assignment-test.jpg', original_name: 'photo.jpg', mime: 'image/jpeg', size: 100 });
});
after(() => db.destroy());

test('chaque emplacement du catalogue existe dans le HTML et son image d’origine existe', () => {
  const root = path.resolve(__dirname, '../..');
  const allPages = catalog.pages.filter(p => p.path).map(p => p.path).concat('plan-interactif.html');
  assert.equal(new Set(catalog.slots.map(s => s.id)).size, catalog.slots.length);
  for (const slot of catalog.slots) {
    assert.ok(fs.existsSync(path.join(root, slot.fallback)), slot.fallback);
    const pages = slot.page === 'shared' ? allPages : [catalog.pages.find(p => p.id === slot.page).path];
    for (const page of pages) assert.ok(fs.readFileSync(path.join(root, page), 'utf8').includes(`data-media-slot="${slot.id}"`), `${slot.id} dans ${page}`);
  }
});

test('affectation, publication, conservation des autres emplacements et retour à l’origine', async () => {
  const save = (id, body) => admin.put(`/api/admin/media-placements/${id}`).send(body);
  let res = await save('home.about.main', { media_id: imageId, alt: 'Notre équipe à Abidjan' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.media.id, imageId);
  assert.equal((await save('about.about.main', { media_id: imageId })).status, 200);
  const content = await request(app).get('/api/public/content');
  assert.deepEqual(content.body.images['home.about.main'], { url: '/uploads/site-assignment-test.jpg', alt: 'Notre équipe à Abidjan' });
  assert.equal((await admin.delete(`/api/admin/media/${imageId}`)).status, 409);
  assert.equal((await save('home.about.main', { media_id: null })).status, 200);
  res = await request(app).get('/api/public/content');
  assert.equal(res.body.images['home.about.main'], undefined);
  assert.ok(res.body.images['about.about.main']);
  await save('about.about.main', { media_id: null });
  const original = await admin.get('/api/admin/media-placements/default/home.about.main');
  assert.equal(original.status, 200);
  assert.match(original.headers['content-type'], /^image\//);
});

test('formats, identifiants et droits d’affectation contrôlés', async () => {
  assert.equal((await admin.put('/api/admin/media-placements/unknown').send({ media_id: imageId })).status, 404);
  assert.equal((await admin.get('/api/admin/media-placements/default/unknown')).status, 404);
  assert.equal((await admin.put('/api/admin/media-placements/home.about.main').send({ media_id: 999999 })).status, 400);
  const [pdfId] = await db('media').insert({ filename: 'assignment.pdf', original_name: 'doc.pdf', mime: 'application/pdf', size: 1 });
  assert.equal((await admin.put('/api/admin/media-placements/home.about.main').send({ media_id: pdfId })).status, 400);
  const reader = await login(app, await createUser(db, 'comptable', 'images-reader@test.ci'), 'motdepasse-test-123');
  assert.equal((await reader.get('/api/admin/media-placements')).status, 403);
  assert.equal((await reader.put('/api/admin/media-placements/home.about.main').send({ media_id: imageId })).status, 403);
});

test('une image liée à un document client ne peut pas être publiée', async () => {
  const p = await db('projects').first();
  const [lotId] = await db('lots').insert({ project_id: p.id, code: 'IMG-PRIVATE', price_fcfa: 1000000 });
  const sale = await admin.post(`/api/admin/lots/${lotId}/sale`).send({ name: 'Client privé', phone: '0700993344' });
  assert.equal(sale.status, 201);
  await admin.put('/api/admin/media-placements/home.about.accent').send({ media_id: imageId });
  const doc = await db('sale_documents').where({ sale_id: sale.body.id }).first();
  await db('sale_documents').where({ id: doc.id }).update({ media_id: imageId });
  assert.equal((await admin.put('/api/admin/media-placements/home.about.main').send({ media_id: imageId })).status, 409);
  assert.equal((await request(app).get('/api/public/content')).body.images['home.about.accent'], undefined);
});

test('le script du site applique les images et préserve le chargement différé et les valeurs d’origine', async () => {
  const element = (tagName, slot, bg) => ({
    tagName, src: 'origine.jpg', alt: 'Origine', style: {},
    attrs: { 'data-media-slot': slot, ...(bg ? { 'data-bg': bg } : {}) },
    getAttribute(k) { return this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    setAttribute(k, v) { this.attrs[k] = v; },
  });
  const img = element('IMG', 'shared.logo');
  const bg = element('DIV', 'home.about.main', 'images/about/about-main.jpg');
  const untouched = element('IMG', 'contact.hero');
  const invalid = element('IMG', 'about.hero');
  const context = {
    window: {}, location: { hostname: 'localhost' },
    document: { readyState: 'complete', querySelector: () => null, querySelectorAll: () => [img, bg, untouched, invalid] },
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async () => ({ ok: true, json: async () => ({ images: {
      'shared.logo': { url: '/uploads/logo.png', alt: 'SIIPAF SA' },
      'home.about.main': { url: '/uploads/maison.jpg', alt: '' },
      'about.hero': { url: 'javascript:alert(1)' },
    } }) }),
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../js/site-content.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(img.src, 'http://localhost:4000/uploads/logo.png');
  assert.equal(img.alt, 'SIIPAF SA');
  assert.equal(bg.attrs['data-bg'], 'http://localhost:4000/uploads/maison.jpg');
  assert.match(bg.style.backgroundImage, /maison.jpg/);
  assert.equal(untouched.src, 'origine.jpg');
  assert.equal(invalid.src, 'origine.jpg');
});
