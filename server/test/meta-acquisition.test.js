const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { setup, login, createUser, request } = require('./helpers');
const ai = require('../src/services/marketingAi');
const graph = require('../src/services/metaGraph');
const sita = require('../src/services/sita');
const S = require('../src/lib/sita');
const M = require('../src/lib/meta');
const secrets = require('../src/lib/secrets');
const { INFO_EVENTS, PUBLIC_LEAD_SOURCES } = require('../src/lib/domain');

// Les tests n'appellent JAMAIS le réseau : faux client HTTP de l'API Graph (graph.setHttp) et faux client de l'IA (setClient),
// fausse clé de l'IA (jamais celle du .env) et faux identifiants Meta.
const KEY = 'sk-ant-api03-SECRETTEST-wxyz';
const MK = '/api/admin/erp/marketing';
const SITA_URL = '/api/admin/erp/commercial/sita';
const APP_SECRET = 'app-secret-test-0123456789';
const PAGE_TOKEN = 'EAAtestPAGEtokenABCDEFGHIJKLMNOPQRST';
const ADS_TOKEN = 'EAAtestADStokenABCDEFGHIJKLMNOPQRST1234';
const VERIFY = 'verifytoken-test-9876';
const CONFIG = {
  app_id: '111222333', app_secret: APP_SECRET, page_id: '1000', instagram_id: '2000', page_token: PAGE_TOKEN, ads_token: ADS_TOKEN,
  ad_account_id: 'act_5555', pixel_id: '777888999', verify_token: VERIFY,
};

const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
const noKey = () => { delete process.env.ANTHROPIC_API_KEY; ai.setClient(null); };
const useKey = client => { process.env.ANTHROPIC_API_KEY = KEY; ai.setClient(client); return client; };
const toolUse = (name, input, usage = { input_tokens: 2000, output_tokens: 150 }) => ({ content: [{ type: 'tool_use', id: `tu_${name}`, name, input }], stop_reason: 'tool_use', usage });
const text = (t, usage = { input_tokens: 2200, output_tokens: 120 }) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage });
/** Faux client de l'IA : renvoie les étapes dans l'ordre (la dernière se répète) ; `calls` garde les paramètres reçus. */
const scripted = (...steps) => {
  const client = { calls: [], messages: { create: async params => {
    client.calls.push(JSON.parse(JSON.stringify(params)));
    const step = steps[Math.min(client.calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(params) : step;
  } } };
  return client;
};

/** Faux client de l'API Graph : routes « MÉTHODE chemin » → réponse (objet ou fonction). `calls` garde chaque requête reçue. */
const fakeGraph = (routes = {}) => {
  const fake = { calls: [], routes };
  graph.setHttp(async req => {
    fake.calls.push(JSON.parse(JSON.stringify(req)));
    const route = fake.routes[`${req.method} ${req.path.replace(/^\/v\d+\.\d+/, '')}`];
    if (!route) return { status: 404, json: { error: { message: `Route inconnue ${req.path}`, code: 100 } } };
    return typeof route === 'function' ? route(req) : route;
  });
  return fake;
};
const sentMessages = fake => fake.calls.filter(c => c.method === 'POST' && /\/messages$/.test(c.path));

const sign = (raw, secret = APP_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
let app;
const hook = (payload, { secret = APP_SECRET, signature } = {}) => {
  const raw = JSON.stringify(payload);
  const req = request(app).post('/api/public/meta/webhook').set('Content-Type', 'application/json');
  if (signature !== null) req.set('X-Hub-Signature-256', signature || sign(raw, secret));
  return req.send(raw);
};
const leadEvent = (id, entryId = '1000') => ({ object: 'page', entry: [{ id: entryId, time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: id, page_id: entryId, form_id: 'F1', ad_id: 'A1' } }] }] });
const msgEvent = (sender, message, { mid = `mid-${sender}-${Math.random().toString(36).slice(2, 8)}`, ts = Date.now(), object = 'page', entryId = object === 'instagram' ? '2000' : '1000', echo = false } = {}) => ({
  object, entry: [{ id: entryId, time: ts, messaging: [{ sender: { id: sender }, recipient: { id: entryId }, timestamp: ts, message: { mid, text: message, ...(echo ? { is_echo: true } : {}) } }] }],
});
const fbComment = (id, message, { from = '9001', parent, post = '1000_5' } = {}) => ({
  object: 'page', entry: [{ id: '1000', time: 1, changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: id, post_id: post, parent_id: parent || post, from: { id: from, name: 'Une Personne' }, message } }] }],
});
const igComment = (id, message, { from = '9002', parent } = {}) => ({
  object: 'instagram', entry: [{ id: '2000', time: 1, changes: [{ field: 'comments', value: { id, text: message, from: { id: from, username: 'quelquun' }, media: { id: 'media-1' }, ...(parent ? { parent_id: parent } : {}) } }] }],
});
const LEAD_FIELDS = (over = {}) => ({
  id: 'L1', ad_id: 'A1', ad_name: 'Annonce test', adset_name: 'Ensemble 1', campaign_name: 'Campagne Meta', form_id: 'F1', platform: 'fb',
  field_data: [{ name: 'full_name', values: ['Awa Koné'] }, { name: 'email', values: ['AWA.kone@test.ci'] }, { name: 'phone_number', values: ['p:+2250102279595'] }, { name: 'city', values: ['Abidjan'] }],
  ...over,
});

let db, admin, commercial, editeur, direction1, respCom;
let campaign;
const settings = patch => admin.put(`${MK}/meta/settings`).send(patch);
const notifs = async (agent, event) => ok(await agent.get('/api/admin/erp/notifications?limit=100')).items.filter(n => n.event === event);

before(async () => {
  noKey();
  ({ db, app } = await setup());
  noKey();
  admin = await login(app);
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  direction1 = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  respCom = await login(app, await createUser(db, 'resp_communication'), 'motdepasse-test-123');
  campaign = ok(await admin.post(`${MK}/campaigns`).send({ name: 'Rentrée 2026 test', segment: 'diaspora' }), 201);
});
beforeEach(() => { noKey(); graph.setHttp(null); S.setLimits(); sita.limiter.reset(); });
after(() => { noKey(); graph.setHttp(null); return db.destroy(); });

// ─── Mode non connecté ────────────────────────────────────────────────────

test('non connecté : rien ne casse, aucun appel réseau, écrans explicites, webhook fermé', async () => {
  const fake = fakeGraph();
  const view = ok(await admin.get(`${MK}/meta/settings`));
  assert.equal(view.connected, false);
  assert.ok(view.connectors.every(c => c.state === 'non_configure' && c.configured === false));
  assert.match(view.connectors.find(c => c.key === 'page').detail, /À renseigner/);
  assert.match(view.webhook.url, /\/api\/public\/meta\/webhook$/);

  const test = ok(await admin.post(`${MK}/meta/test`));
  assert.ok(test.connectors.every(c => c.state === 'non_configure'));
  assert.equal(fake.calls.length, 0, 'aucun appel sans identifiants');

  assert.equal((await request(app).get('/api/public/meta/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '123' })).status, 403);
  assert.equal((await hook(leadEvent('L0'), { signature: null })).status, 503);
  assert.deepEqual((await request(app).get('/api/public/meta/config')).body, { pixel: null });

  const overview = ok(await admin.get(`${MK}/meta/overview`));
  assert.equal(overview.connected, false);
  assert.deepEqual(overview.channels.map(c => c.key), ['lead_ads', 'messenger', 'instagram', 'site']);
  assert.equal(overview.pixel.enabled, false);

  const up = await admin.post(`${MK}/meta/audiences/upload`).send({ scope: 'tous' });
  assert.equal(up.status, 409);
  assert.equal((await admin.post(`${MK}/meta/subscribe`)).status, 409);
  assert.equal(fake.calls.length, 0);
});

// ─── Connecteurs : secrets chiffrés, droits ───────────────────────────────

test('connecteurs : secrets chiffrés en base, jamais renvoyés, droit marketing:settings exigé', async () => {
  assert.ok(INFO_EVENTS['meta.connexion_erreur'] && INFO_EVENTS['meta.audience_exportee'], 'événements au catalogue du circuit d’information');
  assert.ok(PUBLIC_LEAD_SOURCES.includes('meta_lead'));
  for (const agent of [commercial, editeur, respCom, direction1]) {
    assert.equal((await agent.get(`${MK}/meta/settings`)).status, 403);
    assert.equal((await agent.put(`${MK}/meta/settings`).send({ page_id: '1' })).status, 403);
    assert.equal((await agent.post(`${MK}/meta/test`)).status, 403);
  }
  // Validations
  assert.equal((await settings({ page_id: 'abc' })).status, 400);
  assert.equal((await settings({ graph_version: 'x' })).status, 400);
  assert.equal((await settings({ page_token: 'court' })).status, 400);
  assert.equal((await settings({ inconnu: 1 })).status, 400);

  const view = ok(await settings(CONFIG));
  const body = JSON.stringify(view);
  for (const secret of [APP_SECRET, PAGE_TOKEN, ADS_TOKEN, VERIFY]) assert.ok(!body.includes(secret), 'aucun secret dans la réponse');
  assert.equal(view.secrets.page_token.present, true);
  assert.equal(view.secrets.page_token.last4, PAGE_TOKEN.slice(-4));
  assert.equal(view.values.ad_account_id, '5555', 'act_ retiré');
  assert.equal(view.values.page_id, '1000');
  assert.ok(view.connectors.find(c => c.key === 'page').configured);

  const rows = await db('meta_settings').where({ secret: true });
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.match(r.value, /^v1:/);
    for (const secret of [APP_SECRET, PAGE_TOKEN, ADS_TOKEN, VERIFY]) assert.ok(!r.value.includes(secret), 'chiffré en base');
  }
  assert.equal(secrets.decrypt(rows.find(r => r.key === 'page_token').value), PAGE_TOKEN);
  assert.equal(secrets.decrypt('v1:xx:yy:zz'), null, 'valeur altérée : illisible');
  // Une réponse GET ne contient pas non plus les secrets ; le journal des réglages ne garde que les noms
  assert.ok(!JSON.stringify(ok(await admin.get(`${MK}/meta/settings`))).includes(PAGE_TOKEN));
  const ev = await db('marketing_events').where({ action: 'settings' }).orderBy('id', 'desc').first();
  assert.match(ev.note, /page_token/);
  assert.ok(!ev.note.includes(PAGE_TOKEN));
  // Absent : conservé ; null : effacé
  ok(await settings({ page_id: '1000' }));
  assert.equal(ok(await admin.get(`${MK}/meta/settings`)).secrets.verify_token.present, true);
  ok(await settings({ ads_token: null }));
  assert.equal(ok(await admin.get(`${MK}/meta/settings`)).secrets.ads_token.present, false);
  ok(await settings({ ads_token: ADS_TOKEN }));
});

test('test de connexion : un appel minimal par connecteur, appsecret_proof, jeton jamais renvoyé, erreur nettoyée et alertée', async () => {
  const fake = fakeGraph({
    'GET /111222333': { status: 200, json: { id: '111222333', name: 'Application SIIPAF' } },
    'GET /1000': { status: 200, json: { id: '1000', name: 'SIIPAF SA' } },
    'GET /debug_token': { status: 200, json: { data: { is_valid: true, expires_at: 0, scopes: ['leads_retrieval', 'pages_messaging'] } } },
    'GET /1000/subscribed_apps': { status: 200, json: { data: [{ subscribed_fields: ['leadgen', 'messages'] }] } },
    'GET /2000': { status: 200, json: { id: '2000', username: 'siipaf' } },
    'GET /act_5555': { status: 200, json: { id: 'act_5555', name: 'Compte SIIPAF' } },
    'GET /777888999': { status: 200, json: { id: '777888999', name: 'Pixel SIIPAF' } },
    'GET /111222333/subscriptions': { status: 200, json: { data: [] } },
  });
  const out = ok(await admin.post(`${MK}/meta/test`));
  assert.deepEqual(out.connectors.map(c => c.state), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  assert.ok(!JSON.stringify(out).includes(PAGE_TOKEN) && !JSON.stringify(out).includes(APP_SECRET));
  const pageCall = fake.calls.find(c => c.path.endsWith('/1000') && c.method === 'GET');
  assert.equal(pageCall.query.access_token, PAGE_TOKEN);
  assert.equal(pageCall.query.appsecret_proof, M.appSecretProof(PAGE_TOKEN, APP_SECRET));
  const appCall = fake.calls.find(c => c.path.endsWith('/111222333') && c.method === 'GET');
  assert.equal(appCall.query.access_token, '111222333|' + APP_SECRET, 'jeton d’application pour l’application');
  assert.match(out.connectors.find(c => c.key === 'page').detail, /SIIPAF SA/);
  assert.ok(await db('meta_events').where({ kind: 'test', status: 'ok' }).first());

  // Jeton refusé : message nettoyé (aucun jeton), connecteur en erreur, Direction prévenue
  fakeGraph({
    'GET /111222333': { status: 200, json: { id: '111222333', name: 'Application SIIPAF' } },
    'GET /1000': { status: 400, json: { error: { message: `Invalid OAuth access token ${PAGE_TOKEN}`, code: 190 } } },
  });
  const bad = ok(await admin.post(`${MK}/meta/test`));
  const page = bad.connectors.find(c => c.key === 'page');
  assert.equal(page.state, 'erreur');
  assert.ok(!page.detail.includes(PAGE_TOKEN));
  assert.match(page.detail, /190/);
  assert.ok((await notifs(admin, 'meta.connexion_erreur')).length >= 1, 'la Direction est prévenue');
  assert.ok((await notifs(respCom, 'meta.connexion_erreur')).length >= 1, 'la responsable de la communication aussi');
  assert.ok(ok(await admin.get(`${MK}/meta/settings`)).last_error);
});

// ─── Webhook : vérification et signature ──────────────────────────────────

test('webhook : vérification hub.challenge, signature X-Hub-Signature-256 obligatoire', async () => {
  const good = { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1158201444' };
  const r = await request(app).get('/api/public/meta/webhook').query(good);
  assert.equal(r.status, 200);
  assert.equal(r.text, '1158201444');
  assert.equal((await request(app).get('/api/public/meta/webhook').query({ ...good, 'hub.verify_token': 'faux' })).status, 403);
  assert.equal((await request(app).get('/api/public/meta/webhook').query({ ...good, 'hub.mode': 'autre' })).status, 403);
  assert.equal((await request(app).get('/api/public/meta/webhook').query({ ...good, 'hub.challenge': '<script>' })).status, 403, 'le défi est restreint');

  const fake = fakeGraph({ 'GET /L-sig': { status: 200, json: LEAD_FIELDS({ id: 'L-sig' }) } });
  assert.equal((await hook(leadEvent('L-sig'), { signature: null })).status, 401);
  assert.equal((await hook(leadEvent('L-sig'), { secret: 'autre-secret-1234567890' })).status, 401);
  assert.equal((await hook(leadEvent('L-sig'), { signature: 'sha256=zz' })).status, 401);
  assert.equal(fake.calls.length, 0, 'rien n’est traité sans signature valide');
  assert.equal(await db('meta_events').where({ external_id: 'L-sig' }).first(), undefined);
  assert.equal(M.verifySignature(Buffer.from('{}'), sign('{}'), APP_SECRET), true);
  assert.equal(M.verifySignature(Buffer.from('{"a":1}'), sign('{}'), APP_SECRET), false);
  assert.equal(M.verifySignature(Buffer.from('{}'), sign('{}'), ''), false);
});

// ─── Formulaires de publicité ─────────────────────────────────────────────

test('Lead Ads : fiche créée (source meta_lead), campagne rattachée par le code, annoncée, idempotente, journalisée', async () => {
  const fake = fakeGraph({ 'GET /L1': { status: 200, json: LEAD_FIELDS({ ad_name: `Annonce ${campaign.code} diaspora` }) } });
  const r = await hook(leadEvent('L1'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { events: 1, ok: 1, duplicates: 0, ignored: 0, errors: 0 });
  const call = fake.calls[0];
  assert.match(call.query.fields, /field_data/);
  assert.equal(call.query.access_token, PAGE_TOKEN);

  const lead = await db('leads').where({ email: 'awa.kone@test.ci' }).first();
  assert.equal(lead.name, 'Awa Koné');
  assert.equal(lead.source, 'meta_lead');
  assert.equal(lead.phone, '+2250102279595');
  assert.equal(lead.campaign_id, campaign.id);
  assert.equal(lead.utm_medium, 'social_payant');
  assert.equal(lead.utm_content, 'A1');
  assert.equal(lead.seen_at, null, 'nouveau pour l’équipe, comme tout prospect entrant');
  assert.ok(lead.alert_at);
  assert.match(lead.message, /Formulaire de publicité Meta/);
  const event = await db('meta_events').where({ kind: 'lead', external_id: 'L1' }).first();
  assert.equal(event.status, 'ok');
  assert.equal(event.lead_id, lead.id);
  assert.ok((await notifs(direction1, 'prospect.nouveau')).some(n => /Awa Koné/.test(n.title) && /Meta/.test(n.body)), 'responsables prévenus, origine indiquée');
  const note = await db('lead_activities').where({ lead_id: lead.id }).first();
  assert.match(note.summary, /Meta/);

  // Meta renvoie parfois deux fois le même événement : un seul traitement
  const again = await hook(leadEvent('L1'));
  assert.deepEqual(again.body, { events: 1, ok: 0, duplicates: 1, ignored: 0, errors: 0 });
  assert.equal(fake.calls.length, 1);
  assert.equal(Number((await db('leads').where({ email: 'awa.kone@test.ci' }).count({ n: '*' }).first()).n), 1);

  // Même personne via un autre formulaire : fiche complétée, pas de doublon
  fakeGraph({ 'GET /L1b': { status: 200, json: LEAD_FIELDS({ id: 'L1b', field_data: [{ name: 'full_name', values: ['Awa Koné'] }, { name: 'email', values: ['awa.kone@test.ci'] }, { name: 'quel_programme', values: ['Un terrain'] }] }) } });
  ok(await hook(leadEvent('L1b')));
  assert.equal(Number((await db('leads').where({ email: 'awa.kone@test.ci' }).count({ n: '*' }).first()).n), 1);
});

test('Lead Ads : sans e-mail ni téléphone ignoré, page étrangère ignorée, désactivation respectée', async () => {
  fakeGraph({ 'GET /L3': { status: 200, json: LEAD_FIELDS({ id: 'L3', field_data: [{ name: 'full_name', values: ['Sans Contact'] }] }) } });
  const r = await hook(leadEvent('L3'));
  assert.equal(r.body.ignored, 1);
  assert.equal((await db('meta_events').where({ external_id: 'L3' }).first()).status, 'ignore');
  assert.equal(await db('leads').where({ name: 'Sans Contact' }).first(), undefined);

  const fake = fakeGraph({});
  assert.deepEqual((await hook(leadEvent('L4', '999999'))).body.events, 0, 'événement d’une autre page : ignoré');
  assert.equal(fake.calls.length, 0);

  ok(await settings({ lead_ads_enabled: false }));
  assert.equal((await hook(leadEvent('L5'))).body.ignored, 1);
  assert.equal(fake.calls.length, 0);
  ok(await settings({ lead_ads_enabled: true }));
});

test('Lead Ads : échec de Meta journalisé et alerté, nouvelle tentative possible', async () => {
  fakeGraph({ 'GET /L2': { status: 400, json: { error: { message: 'Permissions manquantes', code: 200 } } } });
  const r = await hook(leadEvent('L2'));
  assert.equal(r.body.errors, 1);
  const event = await db('meta_events').where({ external_id: 'L2' }).first();
  assert.equal(event.status, 'erreur');
  assert.match(event.detail, /Permissions manquantes/);
  assert.equal(await db('leads').where({ email: 'retry@test.ci' }).first(), undefined);

  fakeGraph({ 'GET /L2': { status: 200, json: LEAD_FIELDS({ id: 'L2', field_data: [{ name: 'full_name', values: ['Retry Test'] }, { name: 'email', values: ['retry@test.ci'] }] }) } });
  const retry = await hook(leadEvent('L2'));
  assert.equal(retry.body.ok, 1, 'un événement resté en erreur est retraité');
  assert.equal((await db('meta_events').where({ external_id: 'L2' }).first()).status, 'ok');
  assert.equal(Number((await db('leads').where({ email: 'retry@test.ci' }).count({ n: '*' }).first()).n), 1);
});

// ─── Messages Messenger et Instagram ──────────────────────────────────────

test('Messenger : Sita répond par le même moteur (démonstration sans clé), conversation visible avec son canal et sa fenêtre de 24 h', async () => {
  // Sita désactivée : aucune réponse
  const fake = fakeGraph({ 'POST /1000/messages': { status: 200, json: { recipient_id: '50010001', message_id: 'm.out' } } });
  const off = await hook(msgEvent('50010001', 'Bonjour'));
  assert.equal(off.body.ignored, 1);
  assert.equal(sentMessages(fake).length, 0);
  ok(await admin.put('/api/admin/assistant').send({ enabled: true }));

  const r = await hook(msgEvent('50010001', 'Bonjour, quels sont vos programmes ?', { mid: 'mid-1' }));
  assert.deepEqual(r.body, { events: 1, ok: 1, duplicates: 0, ignored: 0, errors: 0 });
  const sent = sentMessages(fake);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.recipient.id, '50010001');
  assert.equal(sent[0].body.messaging_type, 'RESPONSE');
  assert.ok(sent[0].body.message.text.length > 0 && sent[0].body.message.text.length <= M.MAX_TEXT);
  assert.equal(sent[0].body.access_token, PAGE_TOKEN);

  const conv = await db('sita_conversations').where({ visitor_key: 'messenger-50010001' }).first();
  assert.equal(conv.channel, 'messenger');
  assert.equal(conv.external_id, '50010001');
  assert.equal(conv.mode, 'demo');
  assert.ok(conv.window_until, 'fin de la fenêtre de 24 h');
  const list = ok(await admin.get(`${SITA_URL}?filtre=messenger`));
  assert.ok(list.length >= 1 && list.every(c => c.channel === 'messenger' && c.channel_label === 'Messenger'));
  const detail = ok(await admin.get(`${SITA_URL}/${conv.id}`));
  assert.equal(detail.channel_label, 'Messenger');
  assert.ok(detail.window_until);
  assert.equal(detail.messages[0].role, 'visiteur');
  assert.equal(ok(await admin.get(`${SITA_URL}/stats`)).by_channel.messenger >= 1, true);
  assert.equal(ok(await admin.get(`${SITA_URL}?filtre=instagram`)).length, 0);

  // Doublon, écho, accusé : un seul traitement
  assert.equal((await hook(msgEvent('50010001', 'Bonjour, quels sont vos programmes ?', { mid: 'mid-1' }))).body.duplicates, 1);
  assert.equal((await hook(msgEvent('50010001', 'Message de la page', { echo: true }))).body.events, 0);
  assert.equal(sentMessages(fake).length, 1);
});

test('Messenger : fenêtre de 24 h respectée, réponses désactivables, page étrangère ignorée', async () => {
  const fake = fakeGraph({ 'POST /1000/messages': { status: 200, json: { message_id: 'm.out' } } });
  const old = await hook(msgEvent('50010002', 'Bonjour', { ts: Date.now() - 25 * 3600 * 1000 }));
  assert.equal(old.body.ignored, 1);
  assert.match((await db('meta_events').where({ kind: 'message' }).orderBy('id', 'desc').first()).detail, /24 h/);
  assert.equal(sentMessages(fake).length, 0);

  ok(await settings({ messages_enabled: false }));
  assert.equal((await hook(msgEvent('50010003', 'Bonjour'))).body.ignored, 1);
  assert.equal(sentMessages(fake).length, 0);
  ok(await settings({ messages_enabled: true }));

  assert.equal((await hook(msgEvent('50010004', 'Bonjour', { entryId: '424242' }))).body.events, 0);
  assert.equal(sentMessages(fake).length, 0);
});

test('Instagram : même moteur, canal Instagram ; un envoi refusé par Meta est journalisé', async () => {
  const fake = fakeGraph({ 'POST /1000/messages': { status: 200, json: { message_id: 'm.out' } } });
  const r = await hook(msgEvent('60010001', 'Bonjour, avez-vous des terrains ?', { object: 'instagram' }));
  assert.equal(r.body.ok, 1);
  assert.equal(sentMessages(fake)[0].body.recipient.id, '60010001');
  assert.equal((await db('sita_conversations').where({ visitor_key: 'instagram-60010001' }).first()).channel, 'instagram');
  assert.equal(ok(await admin.get(`${SITA_URL}?filtre=instagram`)).length, 1);

  fakeGraph({ 'POST /1000/messages': { status: 400, json: { error: { message: 'Hors de la fenêtre de messagerie', code: 10, error_subcode: 2534022 } } } });
  const refused = await hook(msgEvent('60010002', 'Bonjour', { object: 'instagram' }));
  assert.equal(refused.body.errors, 1);
  assert.equal((await db('meta_events').where({ kind: 'message', status: 'erreur' }).first()).channel, 'instagram');
});

test('Messenger avec l’IA : consignes du canal, outil enregistrer_prospect exécuté par le serveur, coût compté, prospect annoncé', async () => {
  const fake = fakeGraph({ 'POST /1000/messages': { status: 200, json: { message_id: 'm.out' } } });
  const client = useKey(scripted(
    toolUse('enregistrer_prospect', { name: 'Koffi Yao', phone: '07 11 22 33 44', summary: 'Cherche un terrain à Abidjan.', consent_contact: true }),
    text('Merci Koffi, c’est noté : un conseiller SIIPAF vous recontacte.'),
  ));
  const r = await hook(msgEvent('50010010', 'Je suis Koffi Yao, mon numéro est 07 11 22 33 44, j’accepte que SIIPAF me rappelle.'));
  assert.equal(r.body.ok, 1);
  assert.match(client.calls[0].system[0].text, /Messenger/);
  assert.doesNotMatch(client.calls[0].system[0].text, /fenêtre de discussion/);
  assert.ok(!JSON.stringify(client.calls).includes(KEY));
  assert.match(sentMessages(fake)[0].body.message.text, /Koffi/);
  const conv = await db('sita_conversations').where({ visitor_key: 'messenger-50010010' }).first();
  assert.equal(conv.channel, 'messenger');
  assert.ok(Number(conv.cost_micro_usd) > 0);
  const lead = await db('leads').where({ id: conv.lead_id }).first();
  assert.equal(lead.source, 'ia');
  assert.equal((await db('lead_activities').where({ lead_id: lead.id }).first()).summary, 'Conversation avec Sita (Messenger)');
  assert.ok((await notifs(direction1, 'prospect.nouveau')).some(n => /Koffi Yao/.test(n.title) && /Sita sur Messenger/.test(n.body)));
  const event = await db('meta_events').where({ kind: 'message', conversation_id: conv.id }).first();
  assert.equal(event.lead_id, lead.id);

  const overview = ok(await admin.get(`${MK}/meta/overview`));
  assert.ok(overview.ai_cost.micro_usd > 0, 'coût de l’IA des conversations Meta');
  const messenger = overview.channels.find(c => c.key === 'messenger');
  assert.ok(messenger.conversations_month >= 1 && messenger.prospects_month >= 1);
  assert.equal(overview.channels.find(c => c.key === 'lead_ads').prospects_month >= 1, true);
  noKey();
});

test('Messenger : arrêt d’urgence de Sita respecté (démonstration, aucun appel de l’IA)', async () => {
  fakeGraph({ 'POST /1000/messages': { status: 200, json: { message_id: 'm.out' } } });
  const client = useKey(scripted(text('Ne doit pas servir.')));
  ok(await admin.put('/api/admin/assistant').send({ emergency_stop: true }));
  const r = await hook(msgEvent('50010011', 'Bonjour, quels programmes ?'));
  assert.equal(r.body.ok, 1);
  assert.equal(client.calls.length, 0);
  assert.equal((await db('sita_conversations').where({ visitor_key: 'messenger-50010011' }).first()).mode, 'demo');
  ok(await admin.put('/api/admin/assistant').send({ emergency_stop: false }));
});

test('site : la conversation du site garde le canal « site » et la réponse publique ne montre pas l’identifiant interne', async () => {
  const body = ok(await request(app).post('/api/public/sita/message').send({ visitor_id: 'visiteur-test-00000001', message: 'Bonjour', page: { path: '/projets.html' } }));
  assert.equal('conversation_id' in body, false);
  assert.equal((await db('sita_conversations').where({ visitor_key: 'visiteur-test-00000001' }).first()).channel, 'site');
});

// ─── Commentaires ─────────────────────────────────────────────────────────

test('commentaires : réponse publique courte et fixe, jamais de donnée personnelle, filtres et limite horaire', async () => {
  const fake = fakeGraph({
    'POST /c1/comments': { status: 200, json: { id: 'c1-r' } }, 'POST /c-link/comments': { status: 200, json: {} }, 'POST /c-sub/comments': { status: 200, json: {} },
    'POST /c-own/comments': { status: 200, json: {} }, 'POST /c-lim/comments': { status: 200, json: {} }, 'POST /ig-c1/replies': { status: 200, json: { id: 'r' } },
  });
  const replies = () => fake.calls.filter(c => /\/(comments|replies)$/.test(c.path));
  // Désactivé par défaut
  assert.equal((await hook(fbComment('c0', 'Quel est le prix ?'))).body.ignored, 1);
  assert.equal(replies().length, 0);

  ok(await settings({ comments_enabled: true }));
  assert.equal((await hook(fbComment('c1', 'Quel est le prix ?'))).body.ok, 1);
  assert.equal(replies().length, 1);
  assert.equal(replies()[0].path.endsWith('/c1/comments'), true);
  assert.match(replies()[0].body.message, /message privé/);
  assert.doesNotMatch(replies()[0].body.message, /Une Personne/, 'jamais le nom de la personne en public');
  assert.equal((await db('meta_events').where({ kind: 'comment', external_id: 'c1' }).first()).status, 'ok');

  assert.equal((await hook(fbComment('c1', 'Quel est le prix ?'))).body.duplicates, 1);
  assert.equal((await hook(fbComment('c-own', 'Merci !', { from: '1000' }))).body.events, 0, 'commentaire de la page elle-même');
  assert.equal((await hook(fbComment('c-sub', 'D’accord', { parent: '1000_5_77' }))).body.ignored, 1, 'réponse à un autre commentaire');
  assert.equal((await hook(fbComment('c-link', 'Regardez https://exemple.test'))).body.ignored, 1, 'lien : pas de réponse automatique');
  assert.equal(replies().length, 1);

  const ig = await hook(igComment('ig-c1', 'Prix ?'));
  assert.equal(ig.body.ok, 1);
  assert.equal(replies().at(-1).path.endsWith('/ig-c1/replies'), true);

  // Limite horaire
  ok(await settings({ comment_reply_max_per_hour: 1 }));
  assert.equal((await hook(fbComment('c-lim', 'Et les terrains ?'))).body.ignored, 1);
  assert.match((await db('meta_events').where({ external_id: 'c-lim' }).first()).detail, /Limite horaire/);
  ok(await settings({ comment_reply_max_per_hour: 20, comments_enabled: false }));
});

// ─── Pixel ────────────────────────────────────────────────────────────────

test('pixel : identifiant public seulement s’il est renseigné et activé, jamais un secret ; script présent sur toutes les pages', async () => {
  const on = (await request(app).get('/api/public/meta/config')).body;
  assert.deepEqual(on, { pixel: { id: '777888999', consent_required: true } });
  assert.ok(!JSON.stringify(on).includes(PAGE_TOKEN) && !JSON.stringify(on).includes(APP_SECRET));
  ok(await settings({ pixel_consent_required: false }));
  assert.equal((await request(app).get('/api/public/meta/config')).body.pixel.consent_required, false);
  ok(await settings({ pixel_enabled: false }));
  assert.deepEqual((await request(app).get('/api/public/meta/config')).body, { pixel: null });
  ok(await settings({ pixel_enabled: true, pixel_consent_required: true }));
  ok(await settings({ pixel_id: '' }));
  assert.deepEqual((await request(app).get('/api/public/meta/config')).body, { pixel: null });
  ok(await settings({ pixel_id: '777888999' }));

  const root = path.join(__dirname, '..', '..');
  for (const page of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
    assert.match(fs.readFileSync(path.join(root, page), 'utf8'), /js\/meta-pixel\.js/, `${page} charge le pixel`);
  }
  const script = fs.readFileSync(path.join(root, 'js', 'meta-pixel.js'), 'utf8');
  for (const word of ['PageView', 'ViewContent', 'siipafTrack', 'doNotTrack']) assert.ok(script.includes(word));
  assert.match(fs.readFileSync(path.join(root, 'js', 'contact.js'), 'utf8'), /siipafTrack\('Lead'/);
  assert.match(fs.readFileSync(path.join(root, 'js', 'sita.js'), 'utf8'), /siipafTrack\('Lead'/);
});

// ─── Audiences ────────────────────────────────────────────────────────────

test('hachage : e-mail et téléphone normalisés au format Meta puis SHA-256', () => {
  assert.equal(M.normalizeEmail('  Test@Siipaf.CI '), 'test@siipaf.ci');
  assert.equal(M.normalizeEmail('pas-un-email'), null);
  assert.equal(M.normalizePhone('01 02 27 95 95'), '2250102279595');
  assert.equal(M.normalizePhone('+225 01 02 27 95 95'), '2250102279595');
  assert.equal(M.normalizePhone('00225 0102279595'), '2250102279595');
  assert.equal(M.normalizePhone('+33 6 12 34 56 78'), '33612345678');
  assert.equal(M.normalizePhone('27 22 20 50'), null, 'ancien format ivoirien à 8 chiffres : ignoré');
  assert.equal(M.normalizePhone('12'), null);
  const h = M.hashPerson({ email: ' Test@Siipaf.CI ', phone: '0102279595' });
  assert.equal(h.email, crypto.createHash('sha256').update('test@siipaf.ci').digest('hex'));
  assert.equal(h.phone, crypto.createHash('sha256').update('2250102279595').digest('hex'));
  assert.equal(M.hashPerson({ email: 'x', phone: '1' }), null);
  assert.equal(M.audienceCsv([{ email: 'a@b.ci' }, { email: 'A@B.ci ' }, { phone: '1' }]).count, 1, 'doublons et inexploitables écartés');
});

test('audience similaire : CSV haché sans donnée en clair, prospects perdus exclus, export journalisé, droit exigé', async () => {
  const stamp = Date.now();
  await db('leads').insert([
    { name: 'Client Un', email: `Client.Un${stamp}@Test.CI `, phone: '0102030405', stage: 'paiement', source: 'admin' },
    { name: 'Prospect Deux', email: null, phone: '+33 6 12 34 56 78', stage: 'prospection', source: 'admin' },
    { name: 'Perdu Trois', email: `perdu${stamp}@test.ci`, phone: null, stage: 'perdu', source: 'admin' },
    { name: 'Inexploitable', email: 'pas-un-email', phone: '12', stage: 'prospection', source: 'admin' },
  ]);
  const h = v => crypto.createHash('sha256').update(v).digest('hex');
  const pre = ok(await admin.get(`${MK}/meta/audiences`));
  assert.ok(pre.scopes.clients.usable >= 1 && pre.scopes.prospects.usable >= 1);
  assert.ok(!JSON.stringify(pre).includes('Client.Un'), 'aucune donnée en clair dans l’aperçu');

  const res = await admin.get(`${MK}/meta/audiences/export.csv?scope=tous`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment/);
  const lines = res.text.trim().split('\n');
  assert.equal(lines[0], 'email,phone');
  assert.ok(lines.includes(`${h(`client.un${stamp}@test.ci`)},${h('2250102030405')}`));
  assert.ok(lines.includes(`,${h('33612345678')}`));
  assert.ok(!res.text.includes('test.ci') && !res.text.includes('@') && !/\d{9,}/.test(res.text.replace(/[0-9a-f]{64}/g, '')), 'aucune donnée en clair');
  assert.ok(!res.text.includes(h(`perdu${stamp}@test.ci`)), 'prospect perdu exclu');
  assert.ok(lines.slice(1).every(l => /^[0-9a-f]{0,64},[0-9a-f]{0,64}$/.test(l)));
  const clients = ok(await admin.get(`${MK}/meta/audiences`)).scopes;
  assert.equal(clients.clients.usable <= clients.tous.usable, true);
  const onlyClients = await admin.get(`${MK}/meta/audiences/export.csv?scope=clients`);
  assert.ok(onlyClients.text.includes(h(`client.un${stamp}@test.ci`)) && !onlyClients.text.includes(h('33612345678')));

  const adminId = (await db('users').where({ email: 'admin@test.ci' }).first()).id;
  const journal = await db('meta_events').where({ kind: 'export', user_id: adminId }).orderBy('id', 'desc').first();
  assert.match(journal.detail, /personne/);
  assert.equal((await admin.get(`${MK}/meta/audiences/export.csv?scope=invalide`)).status, 400);
  for (const agent of [commercial, editeur, respCom]) assert.equal((await agent.get(`${MK}/meta/audiences/export.csv?scope=tous`)).status, 403);
  assert.equal((await commercial.get(`${MK}/meta/audiences`)).status, 403);
});

test('audience : envoi au compte publicitaire par l’API (condensés seulement), audience similaire et audience d’interaction', async () => {
  const fake = fakeGraph({
    'POST /act_5555/customaudiences': req => ({ status: 200, json: { id: req.body.subtype === 'LOOKALIKE' ? 'aud-lal' : req.body.subtype === 'CUSTOM' ? 'aud-1' : 'aud-int' } }),
    'POST /aud-1/users': { status: 200, json: { num_received: 2 } },
  });
  const up = ok(await admin.post(`${MK}/meta/audiences/upload`).send({ scope: 'tous', name: 'Clients SIIPAF' }), 201);
  assert.equal(up.kind, 'liste');
  assert.ok(up.size >= 2);
  const users = fake.calls.find(c => c.path.endsWith('/aud-1/users'));
  assert.deepEqual(users.body.payload.schema, ['EMAIL_SHA256', 'PHONE_SHA256']);
  assert.ok(users.body.payload.data.every(row => row.every(v => /^[0-9a-f]{0,64}$/.test(v))), 'condensés SHA-256 uniquement');
  assert.equal(users.body.access_token, ADS_TOKEN, 'jeton du compte publicitaire');
  assert.equal(fake.calls[0].body.customer_file_source, 'USER_PROVIDED_ONLY');
  assert.ok(await db('meta_events').where({ kind: 'audience', status: 'ok' }).first());

  const audience = await db('meta_audiences').where({ id: up.id }).first();
  assert.equal(audience.meta_audience_id, 'aud-1');
  const tooSmall = await admin.post(`${MK}/meta/audiences/${up.id}/lookalike`).send({});
  assert.equal(tooSmall.status, 409, 'Meta exige 100 personnes au moins');
  await db('meta_audiences').where({ id: up.id }).update({ size: 150 });
  const lal = ok(await admin.post(`${MK}/meta/audiences/${up.id}/lookalike`).send({ country: 'CI', ratio: 0.01 }), 201);
  assert.equal(lal.kind, 'similaire');
  const lalCall = fake.calls.find(c => c.body?.subtype === 'LOOKALIKE');
  assert.equal(lalCall.body.origin_audience_id, 'aud-1');
  assert.deepEqual(JSON.parse(lalCall.body.lookalike_spec), { type: 'similarity', country: 'CI', ratio: 0.01 });

  const inter = ok(await admin.post(`${MK}/meta/audiences/interaction`).send({ preset: 'site_30j' }), 201);
  assert.equal(inter.kind, 'interaction');
  const rule = JSON.parse(fake.calls.find(c => c.body?.subtype === 'WEBSITE').body.rule);
  assert.equal(rule.inclusion.rules[0].event_sources[0].id, '777888999');
  assert.equal((await admin.post(`${MK}/meta/audiences/interaction`).send({ preset: 'inconnu' })).status, 400);

  // Refus de Meta : erreur claire, journalisée, sans jeton
  fakeGraph({ 'POST /act_5555/customaudiences': { status: 400, json: { error: { message: `Compte refusé ${ADS_TOKEN}`, code: 200 } } } });
  const refused = await admin.post(`${MK}/meta/audiences/upload`).send({ scope: 'tous' });
  assert.equal(refused.status, 502);
  assert.ok(!JSON.stringify(refused.body).includes(ADS_TOKEN));
  assert.ok(await db('meta_events').where({ kind: 'audience', status: 'erreur' }).first());
});

// ─── Ciblage et annonces proposés par l’IA ────────────────────────────────

const CLEAN_PARAMS = {
  summary: 'Acquéreurs et diaspora intéressés par un achat immobilier à Abidjan.',
  zones: [{ label: 'Abidjan', kind: 'ville' }], age_min: 30, age_max: 60, languages: ['fr'], interests: ['Immobilier', 'Investissement immobilier'],
  diaspora: { enabled: true, countries: ['France', 'Belgique'] }, audiences: [{ kind: 'interaction', description: 'Visiteurs du site des trente derniers jours' }], exclusions: [],
};
const CLEAN_ADS = [{ headline: 'Découvrez nos programmes', primary_text: 'Des programmes suivis par SIIPAF, avec des conditions d’acquisition expliquées simplement.', description: null, cta_button: 'LEARN_MORE' }];

test('ciblage : l’IA propose (démonstration), la responsable corrige, soumet et valide ; contrôles et droits', async () => {
  const id = campaign.id;
  assert.equal((await commercial.post(`${MK}/campaigns/${id}/targetings/generate`).send({})).status, 403);
  const demo = ok(await editeur.post(`${MK}/campaigns/${id}/targetings/generate`).send({ mode: 'demo' }), 201);
  assert.equal(demo.origin, 'demo');
  assert.equal(demo.mode, 'demo');
  assert.equal(demo.cost_micro_usd, 0);
  assert.ok(demo.params.zones.length >= 1 && demo.ads.length >= 2);
  assert.ok(['a_valider', 'brouillon'].includes(demo.status));
  assert.equal(demo.params.diaspora.enabled, true, 'segment diaspora');
  assert.equal(ok(await commercial.get(`${MK}/campaigns/${id}/targetings`)).length, 1, 'lecture ouverte au module');

  // Texte interdit : bloqué à la soumission
  const bad = ok(await editeur.patch(`${MK}/targetings/${demo.id}`).send({ params: CLEAN_PARAMS, ads: [{ ...CLEAN_ADS[0], primary_text: 'Dernière chance : plus que 3 lots à saisir maintenant.' }] }));
  assert.equal(bad.status, 'brouillon');
  assert.ok(bad.warnings.length >= 1);
  const blocked = await editeur.post(`${MK}/targetings/${demo.id}/submit`).send({});
  assert.equal(blocked.status, 409);

  // Corrigé : soumis, puis validé par la responsable (pas par l'éditeur)
  const fixed = ok(await editeur.patch(`${MK}/targetings/${demo.id}`).send({ params: CLEAN_PARAMS, ads: CLEAN_ADS }));
  assert.deepEqual(fixed.warnings, []);
  assert.equal(ok(await editeur.post(`${MK}/targetings/${demo.id}/submit`).send({})).status, 'a_valider');
  assert.ok((await notifs(respCom, 'marketing.a_valider')).some(n => /Ciblage Meta/.test(n.title)), 'la responsable est prévenue');
  assert.equal((await editeur.post(`${MK}/targetings/${demo.id}/validate`).send({})).status, 403);
  const validated = ok(await respCom.post(`${MK}/targetings/${demo.id}/validate`).send({}));
  assert.equal(validated.status, 'valide');
  assert.ok(validated.validated_by_name);
  assert.equal((await editeur.patch(`${MK}/targetings/${demo.id}`).send({ ads: CLEAN_ADS })).status, 409, 'un ciblage validé ne se modifie plus');

  // Refus avec motif puis nouvelle proposition : l'ancienne validée est archivée à la validation de la suivante
  const rej = ok(await respCom.post(`${MK}/targetings/${demo.id}/reject`).send({ reason: 'Cibler aussi Yamoussoukro' }));
  assert.equal(rej.status, 'brouillon');
  assert.equal(rej.reject_reason, 'Cibler aussi Yamoussoukro');
  ok(await editeur.patch(`${MK}/targetings/${demo.id}`).send({ params: CLEAN_PARAMS, ads: CLEAN_ADS }));
  ok(await editeur.post(`${MK}/targetings/${demo.id}/submit`).send({}));
  ok(await respCom.post(`${MK}/targetings/${demo.id}/validate`).send({}));
  const second = ok(await editeur.post(`${MK}/campaigns/${id}/targetings/generate`).send({ mode: 'demo' }), 201);
  ok(await editeur.patch(`${MK}/targetings/${second.id}`).send({ params: CLEAN_PARAMS, ads: CLEAN_ADS }));
  ok(await editeur.post(`${MK}/targetings/${second.id}/submit`).send({}));
  ok(await respCom.post(`${MK}/targetings/${second.id}/validate`).send({}));
  assert.equal((await db('marketing_targetings').where({ id: demo.id }).first()).status, 'archive');
  const events = await db('marketing_events').where({ campaign_id: id }).whereNull('content_id').select('action', 'note');
  assert.ok(events.some(e => e.action === 'validate' && /Ciblage Meta/.test(e.note)), 'journal de la campagne');
});

test('ciblage avec l’IA : sortie imposée par l’outil, validée, coût consigné, note Logement pour la diaspora au Canada', async () => {
  const client = useKey(scripted(toolUse('proposer_contenus', {
    params: { ...CLEAN_PARAMS, diaspora: { enabled: true, countries: ['Canada', 'France'] } },
    ads: CLEAN_ADS, rationale: 'Segment diaspora : zones de résidence et intérêt immobilier.',
  })));
  const out = ok(await editeur.post(`${MK}/campaigns/${campaign.id}/targetings/generate`).send({}), 201);
  assert.equal(out.origin, 'ia');
  assert.equal(out.mode, 'ia');
  assert.ok(out.cost_micro_usd > 0);
  assert.equal(client.calls[0].tool_choice.name, 'proposer_contenus');
  assert.match(client.calls[0].messages[0].content, /diaspora\.note|Gestionnaire|ciblage/i);
  assert.ok(!JSON.stringify(client.calls).includes(KEY));
  assert.equal(out.status, 'a_valider', 'aucun avertissement de texte');
  assert.ok(out.notes.some(n => /Logement/.test(n)), 'catégorie publicitaire spéciale signalée sans bloquer');
  const generation = await db('marketing_generations').where({ step: 'ciblage', mode: 'ia' }).first();
  assert.equal(generation.status, 'ok');

  // Sortie invalide : rien n'est créé
  const before = Number((await db('marketing_targetings').count({ n: '*' }).first()).n);
  useKey(scripted(toolUse('proposer_contenus', { params: { summary: 'x' }, ads: [] })));
  const invalid = await editeur.post(`${MK}/campaigns/${campaign.id}/targetings/generate`).send({});
  assert.equal(invalid.status, 422);
  assert.equal(Number((await db('marketing_targetings').count({ n: '*' }).first()).n), before);
  noKey();
});

test('tableau de bord Marketing : prospects par canal Meta, coût de l’IA, état des connecteurs, journal', async () => {
  const o = ok(await commercial.get(`${MK}/meta/overview`));
  assert.deepEqual(o.channels.map(c => c.key), ['lead_ads', 'messenger', 'instagram', 'site']);
  assert.ok(o.connectors.length === 6 && o.connected === true);
  assert.equal(o.pixel.enabled, true);
  assert.ok(o.events.length >= 1 && o.events.length <= 8);
  assert.ok(!JSON.stringify(o).includes(PAGE_TOKEN) && !JSON.stringify(o).includes(APP_SECRET));
  const events = ok(await admin.get(`${MK}/meta/events?limit=5`));
  assert.ok(events.length <= 5 && events[0].kind_label);
  assert.equal((await commercial.get(`${MK}/meta/events`)).status, 403);
});
