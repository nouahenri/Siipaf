/**
 * Application mobile SIIPAF : jeton de 30 jours (en-tête X-Siipaf-App), déconnexion des autres appareils au changement de mot
 * de passe, inscription aux notifications push et préférences, push au message de l'équipe, origine « mobile » des prospects.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup, login, request } = require('./helpers');
const push = require('../src/services/push');

let db, app, admin, lead, password;
const APP = { 'X-Siipaf-App': 'mobile' };
const PUSH_TOKEN = 'ExponentPushToken[testAppareil-0001]';
const sentPushes = [];
let oldTransport;

const mobile = (method, url, token) => request(app)[method](url).set(APP).set(token ? { Authorization: `Bearer ${token}` } : {});

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  push.enableInTest(true);
  oldTransport = push.setTransport(async messages => { sentPushes.push(...messages); return messages.map(() => ({ status: 'ok' })); });
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'M1', price_fcfa: 20000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code: 'M1' }).first();
  const sale = await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: 'Mobile Test', email: 'mobile@example.com', phone: '+225 07 00 00 11 22', financing: 'comptant', reserved_at: '2026-10-01' });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  lead = sale.body.lead;
  password = (await admin.post(`/api/admin/leads/${lead.id}/client-access`).send({})).body.temporary_password;
});
after(async () => {
  push.enableInTest(false);
  push.setTransport(oldTransport);
  await db.destroy();
});

let token;

test('connexion depuis l’application : jeton de 30 jours dans la réponse, sans cookie', async () => {
  const web = await request(app).post('/api/client/login').send({ login: lead.client_code, password });
  assert.equal(web.status, 200);
  assert.equal(web.body.token, undefined, 'le site garde son cookie');
  assert.ok(String(web.headers['set-cookie'] || '').includes('siipaf_client='));

  const res = await mobile('post', '/api/client/login').send({ login: lead.client_code, password });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.headers['set-cookie'], undefined, 'pas de cookie pour l’application');
  const payload = jwt.decode(res.body.token);
  assert.equal(payload.aud, 'mobile');
  assert.ok(payload.exp - payload.iat >= 29 * 24 * 3600, '30 jours');
  token = res.body.token;
  assert.equal(res.body.client.must_change_password, true);
  assert.equal((await mobile('get', '/api/client/dossiers', token)).status, 403, 'mot de passe provisoire à changer');
});

test('changer le mot de passe : nouveau jeton, l’ancien ne marche plus', async () => {
  const other = (await mobile('post', '/api/client/login').send({ login: lead.client_code, password })).body.token;
  const res = await mobile('post', '/api/client/password', token).send({ current: password, next: 'MotDePasseMobile-2026' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.token);
  token = res.body.token;
  assert.equal((await mobile('get', '/api/client/dossiers', token)).status, 200);
  assert.equal((await mobile('get', '/api/client/me', other)).status, 401, 'l’autre appareil est déconnecté');
  assert.equal((await request(app).get('/api/client/me').set({ Authorization: 'Bearer abc' })).status, 401);
});

test('notifications : inscription du téléphone, préférences, push au message de l’équipe', async () => {
  assert.equal((await mobile('post', '/api/client/push', token).send({ token: 'pas-un-jeton' })).status, 400);
  let res = await mobile('post', '/api/client/push', token).send({ token: PUSH_TOKEN, platform: 'android' });
  assert.equal(res.status, 201);
  assert.equal(res.body.prefs.message, true, 'tout est activé par défaut');
  await mobile('post', '/api/client/push', token).send({ token: PUSH_TOKEN, platform: 'android' });
  assert.equal((await db('client_push_tokens').where({ token: PUSH_TOKEN })).length, 1, 'un appareil = une ligne');

  sentPushes.length = 0;
  res = await admin.post(`/api/admin/leads/${lead.id}/messages`).send({ body: 'Bonjour, votre dossier avance : montant confidentiel 12 000 000 FCFA.' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await new Promise(r => setTimeout(r, 50));
  assert.equal(sentPushes.length, 1);
  assert.equal(sentPushes[0].to, PUSH_TOKEN);
  assert.equal(sentPushes[0].title, 'Nouveau message de SIIPAF');
  assert.equal(sentPushes[0].data.screen, 'messages');
  assert.ok(!sentPushes[0].body.includes('12 000 000'), 'le push ne contient pas le détail');

  res = await mobile('put', '/api/client/push/prefs', token).send({ message: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.prefs.message, false);
  assert.equal(res.body.prefs.paiements, true);
  assert.equal((await mobile('put', '/api/client/push/prefs', token).send({ inconnu: true })).status, 400);
  assert.equal((await mobile('get', '/api/client/me', token)).body.client.push_prefs.message, false, 'relu dans le profil');
  sentPushes.length = 0;
  await admin.post(`/api/admin/leads/${lead.id}/messages`).send({ body: 'Second message' });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(sentPushes.length, 0, 'catégorie désactivée par le client');
  await mobile('put', '/api/client/push/prefs', token).send({ message: true });

  // Expo signale l'appareil désinscrit : le jeton est effacé
  push.setTransport(async messages => messages.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })));
  const out = await push.notifyLead(db, lead.id, { kind: 'paiements' });
  assert.equal(out.queued, 1);
  assert.equal(await out.done, 0);
  assert.equal((await db('client_push_tokens').where({ token: PUSH_TOKEN })).length, 0);
  push.setTransport(async messages => { sentPushes.push(...messages); return messages.map(() => ({ status: 'ok' })); });
});

test('déconnexion : le téléphone ne reçoit plus de notifications', async () => {
  await mobile('post', '/api/client/push', token).send({ token: PUSH_TOKEN, platform: 'ios' });
  const res = await mobile('post', '/api/client/logout', token).send({ push_token: PUSH_TOKEN });
  assert.equal(res.status, 200);
  assert.equal((await db('client_push_tokens').where({ token: PUSH_TOKEN })).length, 0);
});

test('prospects venus de l’application : origine « mobile », alerte de l’équipe', async () => {
  let res = await request(app).post('/api/public/contact').set(APP).send({ name: 'Prospect Appli', phone: '+225 05 11 22 33 44', message: 'Je souhaite être rappelé.' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const l = await db('leads').where({ name: 'Prospect Appli' }).first();
  assert.equal(l.source, 'mobile');
  assert.equal(l.seen_at, null, 'nouvelle demande signalée');
  assert.ok(l.alert_at);

  res = await request(app).post('/api/public/contact').send({ name: 'Prospect Site', phone: '+225 05 99 88 77 66', message: 'Bonjour depuis le site.' });
  assert.equal((await db('leads').where({ name: 'Prospect Site' }).first()).source, 'site', 'le site ne change pas');

  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  res = await request(app).post('/api/public/appointments').set(APP).send({ name: 'RDV Appli', phone: '+225 01 44 55 66 77', kind: 'visite', starts_at: new Date(Date.now() + 3 * 86400000).toISOString(), project_id: project.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await db('appointments').where({ id: res.body.appointment_id }).first()).source, 'mobile');
});

test('filtres de la recherche mobile : villes, localisations, types de biens et paliers de budget tirés de la base', async () => {
  const res = await request(app).get('/api/public/filtres');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { villes, localisations, types_bien, budgets, categories } = res.body;
  assert.ok(Array.isArray(villes) && Array.isArray(localisations) && Array.isArray(types_bien) && Array.isArray(budgets));
  assert.ok(categories.logement + categories.lotissement >= 1);
  for (const l of localisations) assert.ok(l.count >= 1, 'seulement les localisations utilisées');
  for (const b of budgets) assert.ok(b.count >= 1 && /FCFA$/.test(b.label));
  // Paliers réglables (Paramètres › Général) : « 20 » → moins de 20 M et plus de 20 M
  const saved = await admin.put('/api/admin/settings').send({ budget_tiers: '20' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.values.budget_tiers, '20');
  assert.equal((await admin.put('/api/admin/settings').send({ budget_tiers: 'aucun' })).status, 400);
  const again = (await request(app).get('/api/public/filtres')).body.budgets;
  assert.ok(again.every(b => ['0-20000000', '20000000-'].includes(b.key)));
  const projects = (await request(app).get('/api/public/projects')).body;
  assert.ok('city_id' in projects[0] && Array.isArray(projects[0].property_type_ids));
});

test('notifications pour tous : inscription du téléphone sans compte, annonce du dashboard ciblée par ville', async () => {
  const ville = await db('ref_items').where({ kind: 'ville' }).first();
  const autre = 'ExponentPushToken[testVisiteur-0002]';
  const visiteur = 'ExponentPushToken[testVisiteur-0001]';
  assert.equal((await request(app).post('/api/public/devices').send({ token: 'mauvais' })).status, 400);
  assert.equal((await request(app).post('/api/public/devices').send({ token: visiteur, platform: 'android', city_id: ville.id, language: 'fr' })).status, 200);
  assert.equal((await request(app).post('/api/public/devices').send({ token: autre, platform: 'ios' })).status, 200);
  // Nouvelle inscription du même téléphone : mise à jour, pas de doublon
  await request(app).post('/api/public/devices').send({ token: visiteur, platform: 'android', city_id: ville.id, language: 'en' });
  assert.equal((await db('app_devices').where({ token: visiteur })).length, 1);

  const panel = await admin.get('/api/admin/push');
  assert.equal(panel.status, 200, JSON.stringify(panel.body));
  assert.equal(panel.body.devices, 2);
  assert.equal(panel.body.cities.find(c => c.id === ville.id).devices, 1);

  assert.equal((await admin.post('/api/admin/push').send({ title: 'x', body: 'Texte' })).status, 400, 'titre trop court');
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  sentPushes.length = 0;
  const res = await admin.post('/api/admin/push').send({ title: 'Nouveau lancement', body: 'Découvrez les nouvelles villas.', project_id: project.id, city_id: ville.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.recipients, 1, 'seulement la ville préférée choisie');
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(sentPushes.map(m => m.to), [visiteur]);
  assert.equal(sentPushes[0].data.url, '/projet/ahoutoue');
  const row = await db('app_announcements').where({ id: res.body.id }).first();
  assert.equal(row.recipients, 1);
  assert.equal(row.sent, 1);
  assert.equal((await admin.get('/api/admin/push')).body.rows[0].project_name, project.name);

  // Ville sans téléphone : refus, rien d'enregistré
  const vide = await db('ref_items').where({ kind: 'ville' }).whereNot({ id: ville.id }).first();
  if (vide) assert.equal((await admin.post('/api/admin/push').send({ title: 'Annonce', body: 'Texte annonce', city_id: vide.id })).status, 409);
  assert.equal(await db('app_announcements').count({ n: '*' }).first().then(r => Number(r.n)), 1);

  // Désactivation dans l'application
  assert.equal((await request(app).post('/api/public/devices/remove').send({ token: autre })).status, 200);
  assert.equal((await admin.get('/api/admin/push')).body.devices, 1);
});

test('carte du programme : position GPS du dashboard, sinon position approchée de l’adresse', async () => {
  const geocode = require('../src/services/geocode');
  geocode.enableInTest(true);
  const asked = [];
  const old = geocode.setTransport(async q => { asked.push(q); return /Yamoussoukro/.test(q) && !/Subiakro/.test(q) ? { lat: 6.82, lng: -5.28 } : null; });
  try {
    await db('projects').where({ slug: 'ahoutoue' }).update({ latitude: 5.4398712, longitude: -3.8812345 });
    const withGps = (await request(app).get('/api/public/projects/ahoutoue/position')).body;
    assert.deepEqual(withGps, { lat: 5.4398712, lng: -3.8812345, approx: false, precision: 'gps' });
    assert.equal(asked.length, 0, 'pas de recherche quand le GPS est saisi');
    const p = await db('projects').whereNull('latitude').where({ published: true }).first();
    await db('projects').where({ id: p.id }).update({ city: 'Yamoussoukro', location: 'Subiakro — Axe Yamoussoukro–Oumé' });
    const approx = (await request(app).get(`/api/public/projects/${p.slug}/position`)).body;
    assert.deepEqual(approx, { lat: 6.82, lng: -5.28, precision: 'ville', approx: true });
    assert.equal(asked[0], "Subiakro, Yamoussoukro, Côte d'Ivoire", 'premier segment de la localisation');
    assert.equal((await request(app).get('/api/public/projects/inconnu/position')).status, 404);
  } finally {
    geocode.setTransport(old);
    geocode.enableInTest(false);
  }
});
