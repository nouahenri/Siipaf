const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, request } = require('./helpers');
const { sent } = require('../src/lib/mailer');

let db, app;
before(async () => ({ db, app } = await setup()));
after(() => db.destroy());

test('formulaire de contact : message + prospect, dédoublonné par téléphone', async () => {
  const body = { name: 'Jean Kouassi', phone: '07 07 07 07 07', message: 'Je souhaite visiter Ahoutoué.', project: 'AHOUTOUE' };
  assert.equal((await request(app).post('/api/public/contact').send(body)).status, 201);
  assert.equal((await request(app).post('/api/public/contact').send({ ...body, phone: '0707070707', email: 'jean@example.com' })).status, 201);
  const leads = await db('leads').where({ phone: '0707070707' });
  assert.equal(leads.length, 1, 'un seul prospect pour le même téléphone');
  assert.equal(leads[0].email, 'jean@example.com', 'e-mail complété au second message');
  assert.equal((await db('contact_messages')).length, 2);
  assert.ok(sent.some(m => m.subject.includes('Nouveau message')), 'notification équipe');
});

test('validation : contact obligatoire, champ piège anti-robots', async () => {
  const noReach = await request(app).post('/api/public/contact').send({ name: 'X Y', message: 'Bonjour à vous' });
  assert.equal(noReach.status, 400);
  const bot = await request(app).post('/api/public/contact').send({ name: 'Bot', email: 'b@b.co', message: 'spam spam', website: 'http://x' });
  assert.equal(bot.status, 400);
});

test('newsletter : inscription, doublon sans erreur, désinscription par lien', async () => {
  assert.equal((await request(app).post('/api/public/newsletter').send({ email: 'Lecteur@Example.com' })).status, 201);
  assert.equal((await request(app).post('/api/public/newsletter').send({ email: 'lecteur@example.com' })).status, 201);
  const sub = await db('newsletter_subscribers').where({ email: 'lecteur@example.com' }).first();
  await request(app).get(`/api/public/newsletter/unsubscribe?token=${sub.unsubscribe_token}`);
  assert.equal((await db('newsletter_subscribers').where({ id: sub.id }).first()).status, 'desinscrit');
});

test('demande de rendez-vous visible dans le dashboard', async () => {
  const starts = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
  const res = await request(app).post('/api/public/appointments').send({ name: 'Aya', email: 'aya@example.com', kind: 'visite', starts_at: starts });
  assert.equal(res.status, 201);
  const admin = await login(app);
  const list = await admin.get('/api/admin/appointments');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].lead_name, 'Aya');
  const stats = await admin.get('/api/admin/stats');
  assert.equal(stats.body.upcoming_appointments, 1);
});

test('contenu du site : diaporama validé et exposé publiquement', async () => {
  const admin = await login(app);
  const bad = await admin.put('/api/admin/content/hero').send({ slides: [{ title: 123 }] });
  assert.equal(bad.status, 400);
  const ok = await admin.put('/api/admin/content/hero').send({ autoplay_ms: 6000, slides: [{ media_id: null, title: 'SIIPAF CITY', title_em: 'AHOUTOUE' }] });
  assert.equal(ok.status, 200);
  const pub = await request(app).get('/api/public/content');
  assert.equal(pub.body.hero.autoplay_ms, 6000);
  assert.equal(pub.body.site.phone, '+225 01 02 27 95 95');
});
