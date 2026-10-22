const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');

let db, app, admin, commercial;
before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
});
after(() => db.destroy());

test('formulaire du site : prospect nouveau (compteur), type de bien consulté, vu à l\'ouverture de la fiche', async () => {
  const body = { name: 'Awa Traoré', phone: '0505050505', project: 'AHOUTOUE', property_type: 'Appartement Social 2 pièces', message: 'Plus d\'infos sur ce bien.' };
  assert.equal((await request(app).post('/api/public/contact').send(body)).status, 201);
  const lead = await db('leads').where({ phone: '0505050505' }).first();
  assert.equal(lead.property_type, 'Appartement Social 2 pièces');
  assert.equal(lead.seen_at, null);
  assert.ok(lead.alert_at);
  assert.equal((await db('contact_messages').where({ lead_id: lead.id }).first()).property_type, 'Appartement Social 2 pièces');

  assert.equal((await admin.get('/api/admin/stats')).body.new_leads, 1);
  assert.equal((await commercial.get('/api/admin/stats')).body.new_leads, 1, 'prospect libre : visible du commercial');
  assert.equal((await admin.get(`/api/admin/leads/${lead.id}`)).status, 200);
  assert.equal((await admin.get('/api/admin/stats')).body.new_leads, 0, 'fiche ouverte : plus nouveau pour personne');
  assert.equal((await commercial.get('/api/admin/stats')).body.new_leads, 0);

  // La même personne revient par le site : nouvelle demande à traiter
  await request(app).post('/api/public/contact').send({ ...body, message: 'Je reviens vers vous.' });
  assert.equal((await admin.get('/api/admin/stats')).body.new_leads, 1);
});

test('cloche : chaque nouveau prospect, sauf ceux qu\'on a saisis soi-même ; « vu » par utilisateur', async () => {
  await admin.post('/api/admin/notifications/seen');
  await commercial.post('/api/admin/notifications/seen');
  await new Promise(r => setTimeout(r, 15));

  assert.equal((await commercial.post('/api/admin/leads').send({ name: 'Koffi Yao', phone: '0101010199' })).status, 201);
  await request(app).post('/api/public/contact').send({ name: 'Marie Bamba', email: 'marie@example.com', message: 'Bonjour, des infos svp.' });

  const forAdmin = (await admin.get('/api/admin/notifications')).body;
  assert.equal(forAdmin.unread, 2, 'admin : le prospect du site et celui du commercial');
  assert.ok(forAdmin.items.some(i => i.name === 'Koffi Yao' && i.created_by_name === 'commercial' && i.unread));
  const forCommercial = (await commercial.get('/api/admin/notifications')).body;
  assert.equal(forCommercial.unread, 1, 'le commercial n\'est pas notifié de sa propre saisie');

  await admin.post('/api/admin/notifications/seen');
  assert.equal((await admin.get('/api/admin/notifications')).body.unread, 0);
  assert.equal((await commercial.get('/api/admin/notifications')).body.unread, 1, 'chacun sa cloche');
  // Un prospect saisi par l'équipe n'entre pas dans le compteur « nouveaux » du menu
  assert.equal((await db('leads').where({ name: 'Koffi Yao' }).first()).seen_at !== null, true);
});
