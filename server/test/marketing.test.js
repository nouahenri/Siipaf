const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');
const ai = require('../src/services/marketingAi');
const marketing = require('../src/services/marketing');
const { buildContext } = require('../src/services/marketingContext');
const { checkContent, costMicroUsd, amountsIn } = require('../src/lib/marketing');

// Les tests n'appellent JAMAIS le réseau : faux client de l'IA (setClient) et fausse clé (jamais celle du .env)
const KEY = 'sk-ant-api03-SECRETTEST-wxyz';
const URL = '/api/admin/erp/marketing';
let db, app, admin, resp, commercial, editeur, ids;
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const noKey = () => { delete process.env.ANTHROPIC_API_KEY; ai.setClient(null); };
const useKey = client => { process.env.ANTHROPIC_API_KEY = KEY; ai.setClient(client); return client; };
const toolUse = (input, usage = { input_tokens: 1500, output_tokens: 800 }) => ({ content: [{ type: 'tool_use', id: 'tu_1', name: 'proposer_contenus', input }], usage });
const fakeClient = handler => {
  const client = { calls: [], messages: { create: async params => { client.calls.push(params); return handler(params, client.calls.length); } } };
  return client;
};
const item = (over = {}) => ({
  channel: 'facebook', kind: 'post', title: 'Découvrez SIIPAF CITY YAMOUSSOUKRO',
  body: 'SIIPAF CITY YAMOUSSOUKRO à Yamoussoukro : des appartements à partir de 9 210 000 FCFA. Livraison prévue : 30 mois.',
  hashtags: ['#SIIPAF'], cta: 'Réservez une visite', visual_idea: 'Photo de couverture du programme', scheduled_for: day(2), fact_refs: ['p1', 'o1'], ...over,
});
const okClient = (items = [item()]) => fakeClient(() => toolUse({ items }));

const mkCampaign = async (over = {}, agent = admin) => {
  const res = await agent.post(`${URL}/campaigns`).send({ name: 'Rentrée 2026', segment: 'residence_principale', cta_label: 'Réserver une visite', landing_path: 'contact.html', ...over });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
};
const validCampaign = async over => {
  const c = await mkCampaign(over);
  assert.equal((await admin.post(`${URL}/campaigns/${c.id}/validate`)).status, 200);
  return c;
};
const generate = (agent, id, body = {}) => agent.post(`${URL}/campaigns/${id}/generate`).send({ step: 'contenus', channels: ['facebook'], count: 1, ...body });
const contentsOf = async id => (await admin.get(`${URL}/contents?campaign_id=${id}`)).body;
const ensureLot = async () => (await db('lots').where({ project_id: 1 }).first()) || (await db('lots').insert({ project_id: 1, code: 'MKT-1', status: 'disponible' }), db('lots').where({ project_id: 1 }).first());
const notifs = (userId, event) => db('notifications').where({ user_id: userId, event });

before(async () => {
  ({ db, app } = await setup());
  noKey(); // la clé réelle du .env ne sert jamais aux tests
  admin = await login(app);
  resp = await login(app, await createUser(db, 'resp_communication'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
});
after(async () => { noKey(); await db.destroy(); });

test('mode démonstration sans clé : contenus « demo » sur les vrais faits du catalogue, coût nul, WhatsApp avec désinscription', async () => {
  noKey();
  const refs = (await admin.get(`${URL}/refs`)).body;
  assert.equal(refs.mode, 'demo');
  const c = await mkCampaign();
  const res = await generate(resp, c.id, { channels: ['facebook', 'whatsapp', 'email'], count: 3 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'demo');
  assert.equal(res.body.cost_micro_usd, 0);
  const list = await contentsOf(c.id);
  assert.equal(list.length, 3);
  assert.ok(list.every(x => x.origin === 'demo'), 'origine demo');
  assert.ok(list.every(x => x.created_by === null), 'proposé par l’IA, pas par un compte');
  const fb = list.find(x => x.channel === 'facebook');
  assert.match(fb.body, /SIIPAF CITY YAMOUSSOUKRO/, 'programme réel');
  assert.match(fb.body, /9 210 000 FCFA/, 'prix réel du catalogue');
  assert.ok(list.every(x => x.warnings.length === 0 && x.status === 'a_valider'), JSON.stringify(list.map(x => x.warnings)));
  const wa = list.find(x => x.channel === 'whatsapp');
  assert.match(wa.body, /SIIPAF/);
  assert.match(wa.body, /STOP/, 'désinscription mentionnée');
  assert.match(wa.body, /accepté d’être contacté/, 'consentement rappelé');
  assert.match(fb.link, /utm_campaign=rentree-2026/);
  assert.match(fb.link, new RegExp(`utm_content=${fb.id}`));

  const gen = await db('marketing_generations').where({ campaign_id: c.id }).first();
  assert.equal(gen.mode, 'demo');
  assert.equal(gen.status, 'ok');
  assert.equal(Number(gen.cost_micro_usd), 0);
  const usage = (await admin.get(`${URL}/usage`)).body.usage;
  assert.equal(usage.spent_fcfa, 0);
  assert.equal(usage.key.present, false);

  // Arrêt d'urgence : même avec une clé, l'IA ne répond plus
  const fake = useKey(okClient());
  assert.equal((await admin.post(`${URL}/settings/emergency-stop`).send({ active: true })).status, 200);
  const stopped = await generate(admin, c.id);
  assert.equal(stopped.body.mode, 'demo');
  assert.equal(fake.calls.length, 0, 'aucun appel en arrêt d’urgence');
  assert.equal((await admin.post(`${URL}/settings/emergency-stop`).send({ active: false })).status, 200);
  noKey();
});

test('plafond mensuel en FCFA : refus 409 sans appel de l’IA, alerte à la Direction, cumul des dépenses', async () => {
  const fake = useKey(okClient());
  const c = await mkCampaign({ name: 'Plafond' });
  assert.equal((await admin.put(`${URL}/settings`).send({ marketing_cap_fcfa: 1 })).status, 200);
  const before = (await contentsOf(c.id)).length;
  const res = await generate(resp, c.id);
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.details.code, 'plafond');
  assert.match(res.body.error, /Plafond mensuel/);
  assert.equal(fake.calls.length, 0, 'aucun appel quand le plafond est dépassé');
  assert.equal((await contentsOf(c.id)).length, before);
  const row = await db('marketing_generations').where({ campaign_id: c.id, status: 'refuse_plafond' }).first();
  assert.ok(row, 'refus consigné');
  const alert = await notifs(ids.super_admin, 'marketing.plafond');
  assert.ok(alert.length >= 1, 'la Direction générale est prévenue');

  // Plafond à 0 : l'IA est bloquée
  await admin.put(`${URL}/settings`).send({ marketing_cap_fcfa: 0 });
  assert.equal((await generate(resp, c.id)).status, 409);
  assert.equal(fake.calls.length, 0);

  // Plafond normal mais le mois est presque dépensé (cumul + coût maximal estimé > plafond) : refus
  await admin.put(`${URL}/settings`).send({ marketing_cap_fcfa: 30000, marketing_usd_fcfa: 600 });
  const spent = await db('marketing_generations').insert({ step: 'contenus', mode: 'ia', status: 'ok', month: new Date().toISOString().slice(0, 7), cost_micro_usd: 49990000 });
  assert.equal((await generate(resp, c.id)).status, 409);
  assert.equal(fake.calls.length, 0);
  await db('marketing_generations').where({ id: typeof spent[0] === 'object' ? spent[0].id : spent[0] }).del();
  assert.equal((await generate(resp, c.id)).status, 201, 'sous le plafond, l’IA répond');
  assert.equal(fake.calls.length, 1);
  noKey();
});

test('génération IA avec faux client : outil imposé, versions créées, coût enregistré en jetons, dollars et FCFA', async () => {
  const fake = useKey(okClient([item(), item({ channel: 'linkedin', title: 'LinkedIn Yamoussoukro', scheduled_for: day(3) })]));
  const c = await mkCampaign({ name: 'Campagne IA' });
  const res = await generate(admin, c.id, { channels: ['facebook', 'linkedin'], count: 2 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'ia');
  assert.equal(res.body.created.length, 2);
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.model, 'claude-sonnet-5-5');
  assert.deepEqual(call.tool_choice, { type: 'tool', name: 'proposer_contenus' });
  assert.equal(call.tools[0].name, 'proposer_contenus');
  assert.ok(call.tools[0].input_schema.properties.items, 'schéma de sortie');
  assert.equal(call.system[0].cache_control.type, 'ephemeral');

  const list = await contentsOf(c.id);
  assert.equal(list.length, 2);
  assert.ok(list.every(x => x.origin === 'ia' && x.version_no === 1 && x.status === 'a_valider'));
  assert.equal((await db('marketing_content_versions').whereIn('content_id', list.map(x => x.id)).count({ n: '*' }).first()).n, 2);

  const gen = await db('marketing_generations').where({ id: res.body.generation_id }).first();
  assert.equal(gen.status, 'ok');
  assert.equal(gen.tokens_in, 1500);
  assert.equal(gen.tokens_out, 800);
  assert.equal(Number(gen.cost_micro_usd), 1500 * 3 + 800 * 15);
  assert.equal(costMicroUsd('claude-opus-5-5', { tokens_in: 1000, tokens_out: 1000 }), 30000);
  const usage = (await admin.get(`${URL}/usage`)).body.usage;
  assert.ok(usage.spent_micro_usd >= 16500);
  assert.equal(usage.mode, 'ia');
  assert.ok(usage.spent_fcfa >= Math.round((16500 / 1e6) * 600));

  // La responsable de la communication est prévenue (pas celui qui a lancé la préparation)
  assert.equal((await notifs(ids.resp_communication, 'marketing.a_valider')).length >= 1, true);
  assert.equal((await notifs(ids.commercial, 'marketing.a_valider')).length, 0, 'lecture seule : pas de contenu à valider');
  noKey();
});

test('sortie invalide de l’IA : une relance, statut « invalide », rien n’est créé', async () => {
  const fake = useKey(fakeClient(() => toolUse({ items: [{ channel: 'facebook' }] })));
  const c = await mkCampaign({ name: 'Sortie invalide' });
  const res = await generate(resp, c.id);
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(fake.calls.length, 2, 'une relance au plus');
  const retry = fake.calls[1].messages;
  assert.equal(retry[retry.length - 1].content[0].type, 'tool_result');
  assert.equal(retry[retry.length - 1].content[0].is_error, true);
  assert.equal((await contentsOf(c.id)).length, 0);
  const gen = await db('marketing_generations').where({ campaign_id: c.id }).first();
  assert.equal(gen.status, 'invalide');
  assert.equal(gen.tokens_in, 3000, 'les deux appels sont comptés');
  assert.ok(Number(gen.cost_micro_usd) > 0);

  // Première réponse invalide, seconde correcte : la relance sauve la génération
  const second = useKey(fakeClient((p, n) => (n === 1 ? toolUse({ items: [] }) : toolUse({ items: [item()] }))));
  assert.equal((await generate(resp, c.id)).status, 201);
  assert.equal(second.calls.length, 2);
  assert.equal((await contentsOf(c.id)).length, 1);
  noKey();
});

test('validation obligatoire avant planifié ou publié ; modifier après validation = nouvelle version et retour à valider', async () => {
  useKey(okClient());
  const c = await mkCampaign({ name: 'Validation' });
  const created = (await generate(resp, c.id)).body.created[0];
  const url = `${URL}/contents/${created}`;
  assert.equal((await resp.post(`${url}/publish`).send({})).status, 409, 'non validé : pas publiable');
  assert.equal((await resp.post(`${url}/schedule`).send({ scheduled_for: day(2) })).status, 409, 'non validé : pas planifiable');

  assert.equal((await commercial.post(`${url}/validate`)).status, 403);
  const v = await resp.post(`${url}/validate`);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.status, 'valide');
  // Campagne non validée par la Direction générale : pas de publication
  assert.equal((await resp.post(`${url}/publish`).send({})).status, 409);
  assert.equal((await resp.post(`${URL}/campaigns/${c.id}/validate`)).status, 403, 'la validation des campagnes relève de la Direction générale');
  assert.equal((await admin.post(`${URL}/campaigns/${c.id}/validate`)).status, 200);

  // Modification après validation
  const edit = await resp.patch(url).send({ body: 'SIIPAF CITY YAMOUSSOUKRO : appartements à partir de 9 210 000 FCFA, visite sur rendez-vous.' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.status, 'a_valider');
  assert.equal(edit.body.version_no, 2);
  assert.equal(edit.body.validated_by, null);
  const detail = (await resp.get(url)).body;
  assert.deepEqual(detail.versions.map(x => [x.version_no, x.origin]), [[2, 'humain'], [1, 'ia']]);
  assert.match(detail.versions[1].body, /Livraison prévue/, 'la version 1 reste intacte');
  assert.equal((await resp.post(`${url}/publish`).send({})).status, 409, 'revalider avant de publier');

  assert.equal((await resp.post(`${url}/validate`)).status, 200);
  const planned = await resp.post(`${url}/schedule`).send({ scheduled_for: day(4) });
  assert.equal(planned.status, 200);
  assert.equal(planned.body.status, 'planifie');
  const published = await resp.post(`${url}/publish`).send({ published_url: 'https://www.facebook.com/siipaf/posts/1' });
  assert.equal(published.body.status, 'publie');
  assert.ok(published.body.published_at);
  assert.equal((await resp.patch(url).send({ title: 'Autre titre' })).status, 409, 'publié : plus modifiable');

  // Refus : motif obligatoire, retour en brouillon, nouvelle soumission
  const second = (await generate(resp, c.id)).body.created[0];
  assert.equal((await resp.post(`${URL}/contents/${second}/reject`).send({})).status, 400);
  const rejected = await resp.post(`${URL}/contents/${second}/reject`).send({ reason: 'Ton trop commercial' });
  assert.equal(rejected.body.status, 'brouillon');
  assert.equal(rejected.body.reject_reason, 'Ton trop commercial');
  const resubmitted = await resp.post(`${URL}/contents/${second}/submit`);
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  assert.equal(resubmitted.body.status, 'a_valider');

  // Journal complet
  const events = (await resp.get(`${URL}/contents/${created}`)).body.events.map(e => e.action);
  for (const a of ['propose', 'validate', 'edit', 'schedule', 'publish']) assert.ok(events.includes(a), a);
  noKey();
});

test('droits : commercial en lecture seule, responsable communication génère et valide, réglages réservés au super administrateur', async () => {
  noKey();
  const c = await mkCampaign({ name: 'Droits' });
  // Commercial : lecture seule
  assert.equal((await commercial.get(`${URL}/dashboard`)).status, 200);
  assert.equal((await commercial.get(`${URL}/campaigns/${c.id}`)).status, 200);
  assert.equal((await commercial.post(`${URL}/campaigns`).send({ name: 'Interdit', segment: 'diaspora' })).status, 403);
  assert.equal((await generate(commercial, c.id)).status, 403);
  assert.equal((await commercial.get(`${URL}/settings`)).status, 403);
  // Éditeur : génère, ne valide pas
  assert.equal((await generate(editeur, c.id)).status, 201);
  const id = (await contentsOf(c.id))[0].id;
  assert.equal((await editeur.post(`${URL}/contents/${id}/validate`)).status, 403);
  // Responsable communication : génère, valide, mais ni réglages ni arrêt d'urgence ni validation de campagne
  assert.equal((await generate(resp, c.id)).status, 201);
  assert.equal((await resp.post(`${URL}/contents/${id}/validate`)).status, 200);
  assert.equal((await resp.get(`${URL}/settings`)).status, 403);
  assert.equal((await resp.put(`${URL}/settings`).send({ marketing_cap_fcfa: 99999 })).status, 403);
  assert.equal((await resp.post(`${URL}/settings/emergency-stop`).send({ active: true })).status, 403);
  assert.equal((await resp.post(`${URL}/campaigns/${c.id}/archive`)).status, 403);
  // Super administrateur
  assert.equal((await admin.get(`${URL}/settings`)).status, 200);
  assert.equal((await request(app).get(`${URL}/dashboard`)).status, 401);

  // Le rôle créé pour le client
  const grid = (await admin.get('/api/admin/permissions')).body;
  const role = grid.roles.find(r => r.id === 'resp_communication');
  assert.equal(role.label, 'Responsable communication');
  assert.deepEqual(role.permissions.filter(p => p.startsWith('marketing:')).sort(), ['marketing:generate', 'marketing:read', 'marketing:validate']);
  assert.ok(grid.catalog.some(g => g.group === 'ERP · Marketing & Communication'));
  assert.deepEqual(grid.roles.find(r => r.id === 'commercial').permissions.filter(p => p.startsWith('marketing:')), ['marketing:read']);
});

test('réglages : la clé n’apparaît jamais (réponses, journal des générations, erreurs, base) ; seulement « présente » et 4 derniers caractères', async () => {
  useKey(fakeClient(() => { throw new Error(`401 invalid x-api-key ${KEY} (request failed)`); }));
  const c = await mkCampaign({ name: 'Secret' });
  const res = await generate(resp, c.id);
  assert.equal(res.status, 502);
  assert.ok(!JSON.stringify(res.body).includes(KEY) && !JSON.stringify(res.body).includes('SECRETTEST'), 'erreur renvoyée sans la clé');
  const gen = await db('marketing_generations').where({ campaign_id: c.id }).first();
  assert.equal(gen.status, 'erreur');
  assert.ok(!gen.error.includes('SECRETTEST'));

  const settings = await admin.get(`${URL}/settings`);
  assert.equal(settings.status, 200);
  assert.deepEqual(settings.body.key, { present: true, last4: 'wxyz' });
  for (const url of [`${URL}/settings`, `${URL}/usage`, `${URL}/dashboard`, `${URL}/refs`, `${URL}/facts`, `${URL}/campaigns/${c.id}`]) {
    const text = JSON.stringify((await admin.get(url)).body);
    assert.ok(!text.includes('SECRETTEST') && !text.includes(KEY), `${url} ne contient pas la clé`);
  }
  // Aucune table du module (ni les notifications) ne contient la clé
  for (const table of ['marketing_campaigns', 'marketing_contents', 'marketing_content_versions', 'marketing_generations', 'marketing_events', 'marketing_settings', 'notifications', 'app_settings']) {
    assert.ok(!JSON.stringify(await db(table)).includes('SECRETTEST'), table);
  }
  // On ne peut pas enregistrer de clé par l'API
  assert.equal((await admin.put(`${URL}/settings`).send({ api_key: KEY })).status, 400);
  assert.equal((await admin.put(`${URL}/settings`).send({ model: 'modele-inconnu' })).status, 400);
  const saved = await admin.put(`${URL}/settings`).send({ model: 'claude-haiku-5-5', tone: 'Chaleureux et précis', banned_words: ['bradé'], marketing_alert_pct: 70 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.text.model, 'claude-haiku-5-5');
  assert.equal(saved.body.values.marketing_alert_pct, 70);
  const fake = useKey(okClient());
  await generate(resp, c.id);
  assert.equal(fake.calls[0].model, 'claude-haiku-5-5', 'le modèle réglé est utilisé');
  assert.match(fake.calls[0].system[0].text, /bradé/, 'mots interdits transmis');
  await admin.put(`${URL}/settings`).send({ model: 'claude-sonnet-5-5', tone: '', banned_words: [], marketing_alert_pct: 80 });
  noKey();
});

test('contexte envoyé à l’IA : faits du catalogue seulement, jamais de prospects ni de clients, témoignage non publié et point non visible exclus', async () => {
  const lot = await ensureLot();
  await db('leads').insert([
    { name: 'Prospect Secret', phone: '+2250700000001', email: 'secret@prospect.ci', source: 'site', stage: 'prospection' },
    { name: 'Client Confidentiel', phone: '+2250700000002', source: 'site', stage: 'paiement', client_code: 'C-TEST-1' },
  ]);
  await db('testimonials').insert([
    { name: 'Awa Koné', role_label: 'Cliente', project_id: 1, rating: 5, message: 'Un suivi de chantier très clair.', status: 'publie', source: 'admin' },
    { name: 'Témoin Caché', project_id: 1, rating: 4, message: 'Texte en attente de modération.', status: 'en_attente', source: 'site' },
  ]);
  const now = new Date();
  await db('site_updates').insert([
    { project_id: 1, stage: 'fondations', progress_pct: 40, title: 'Dalle du R+1 coulée', body: 'Avancement visible.', visible_client: true, published_at: now },
    { project_id: 1, stage: 'fondations', progress_pct: 41, title: 'Point interne confidentiel', body: 'Non visible du client.', visible_client: false, published_at: now },
    { project_id: 1, lot_id: lot.id, stage: 'fondations', progress_pct: 42, title: 'Point du lot précis', body: 'Propre à un lot.', visible_client: true, published_at: now },
  ]);
  const { facts } = await buildContext(db, {});
  const text = JSON.stringify(facts);
  assert.match(text, /SIIPAF CITY YAMOUSSOUKRO/);
  assert.match(text, /Awa K\./, 'nom abrégé');
  assert.ok(!text.includes('Koné'), 'jamais le nom complet');
  assert.match(text, /Dalle du R\+1 coulée/);
  for (const hidden of ['Prospect Secret', 'secret@prospect.ci', '+2250700000001', 'Client Confidentiel', '+2250700000002', 'C-TEST-1', 'Témoin Caché', 'en attente de modération', 'Point interne confidentiel', 'Point du lot précis']) {
    assert.ok(!text.includes(hidden), `exclu du contexte : ${hidden}`);
  }
  // Même chose dans ce qui part réellement vers l'IA
  const fake = useKey(okClient());
  const c = await mkCampaign({ name: 'Contexte' });
  await generate(resp, c.id);
  const sent = JSON.stringify(fake.calls[0]);
  assert.match(sent, /Dalle du R\+1/);
  for (const hidden of ['Prospect Secret', 'Client Confidentiel', 'secret@prospect.ci', 'Témoin Caché', 'Point interne confidentiel', 'Point du lot précis']) assert.ok(!sent.includes(hidden), hidden);
  const stored = await db('marketing_generations').where({ campaign_id: c.id }).first();
  assert.ok(!stored.context.includes('Prospect Secret'));
  const api = JSON.stringify((await admin.get(`${URL}/facts`)).body);
  assert.ok(!api.includes('Prospect Secret') && !api.includes('Témoin Caché'));
  noKey();
});

test('contrôle des chiffres inventés : prix et pourcentages hors catalogue, fausse urgence et promesse de gain bloquent la soumission', async () => {
  const { facts } = await buildContext(db, {});
  const base = { subject: null, cta: null, hashtags: [] };
  assert.deepEqual(checkContent({ ...base, body: 'Appartements à partir de 9 210 000 FCFA, soit 9,21 millions de FCFA.' }, facts), []);
  assert.match(checkContent({ ...base, body: 'À partir de 7 500 000 FCFA seulement.' }, facts)[0], /Montant non vérifié/);
  assert.match(checkContent({ ...base, body: 'Un acompte de 30 % suffit.' }, facts)[0], /Pourcentage non vérifié/);
  assert.match(checkContent({ ...base, body: 'Dernière chance : ne ratez pas cette offre limitée !' }, facts).join(' '), /Fausse urgence/);
  assert.match(checkContent({ ...base, body: 'Rentabilité garantie pour tous les investisseurs.' }, facts).join(' '), /Promesse de gain/);
  assert.match(checkContent({ ...base, body: 'Le meilleur promoteur du pays.' }, facts).join(' '), /Superlatif/);
  assert.match(checkContent({ ...base, body: 'Appelez Kouassi au 07 08 09 10 11.' }, facts).join(' '), /Coordonnées personnelles/);
  assert.deepEqual(checkContent({ ...base, body: 'Appelez le +225 01 02 27 95 95 ou écrivez à info@siipaf.com.' }, facts), []);
  assert.deepEqual(checkContent({ ...base, body: 'Offre bradée.' }, facts, { banned: ['bradée'] }).length, 1);
  assert.equal(amountsIn('3,5 millions de FCFA et 12 000 F CFA')[0].value, 3500000);

  // De bout en bout : l'IA invente un prix → brouillon avec avertissement, soumission et validation bloquées
  useKey(okClient([item({ body: 'Appartements à partir de 4 500 000 FCFA seulement, dernière chance !' })]));
  const c = await mkCampaign({ name: 'Chiffres' });
  const created = (await generate(resp, c.id)).body.created[0];
  const bad = (await resp.get(`${URL}/contents/${created}`)).body;
  assert.equal(bad.status, 'brouillon');
  assert.ok(bad.warnings.some(w => /4 500 000/.test(w)));
  const submit = await resp.post(`${URL}/contents/${created}/submit`);
  assert.equal(submit.status, 409);
  assert.ok(submit.body.details.warnings.length >= 2);
  // Correction à la main : le texte est revérifié, la soumission passe
  const fixed = await resp.patch(`${URL}/contents/${created}`).send({ body: 'Appartements à partir de 9 210 000 FCFA. Visite sur rendez-vous.' });
  assert.deepEqual(fixed.body.warnings, []);
  assert.equal((await resp.post(`${URL}/contents/${created}/submit`)).body.status, 'a_valider');
  noKey();
});

test('suivi des prospects par campagne : utm du site → campaign_id sans toucher à la source, alerte émise, premier contact conservé', async () => {
  const c = await mkCampaign({ name: 'Suivi UTM' });
  const other = await mkCampaign({ name: 'Autre campagne' });
  const body = { name: 'Fatou Diop', phone: '0707070707', message: 'Je voudrais visiter le programme.', utm: { source: 'facebook', medium: 'social', campaign: c.code, content: '12' } };
  assert.equal((await request(app).post('/api/public/contact').send(body)).status, 201);
  let lead = await db('leads').where({ phone: '0707070707' }).first();
  assert.equal(lead.campaign_id, c.id);
  assert.equal(lead.utm_medium, 'social');
  assert.equal(lead.utm_content, '12');
  assert.equal(lead.source, 'site', 'la source ne change pas : elle pilote les alertes');
  assert.ok(lead.alert_at, 'alerte toujours émise');
  assert.equal(lead.seen_at, null);
  assert.ok((await admin.get('/api/admin/stats')).body.new_leads >= 1);

  // La même personne revient par une autre campagne : le premier contact est conservé, la nouvelle demande alerte quand même
  await db('leads').where({ id: lead.id }).update({ seen_at: new Date(), alert_at: null });
  await request(app).post('/api/public/contact').send({ ...body, message: 'Je reviens vers vous.', utm: { source: 'linkedin', medium: 'social', campaign: other.code, content: '99' } });
  lead = await db('leads').where({ id: lead.id }).first();
  assert.equal(lead.campaign_id, c.id, 'premier contact conservé');
  assert.equal(lead.utm_content, '12');
  assert.ok(lead.alert_at && lead.seen_at === null, 'nouvelle demande publique : alerte de nouveau');

  // Code inconnu ou absent : rien n'est écrit, la demande aboutit
  assert.equal((await request(app).post('/api/public/contact').send({ name: 'Inconnu Code', phone: '0708080808', message: 'Bonjour à tous.', utm: { campaign: 'nexiste-pas' } })).status, 201);
  assert.equal((await db('leads').where({ phone: '0708080808' }).first()).campaign_id, null);
  assert.equal((await request(app).post('/api/public/contact').send({ name: 'Sans Utm', phone: '0709090909', message: 'Bonjour à tous.' })).status, 201);
  assert.equal((await db('leads').where({ phone: '0709090909' }).first()).utm_medium, null);

  // La fiche du prospect indique la campagne d'origine
  const fiche = (await admin.get(`/api/admin/leads/${lead.id}`)).body;
  assert.equal(fiche.campaign.name, 'Suivi UTM');
  assert.equal(fiche.source, 'site');

  // Intérêt pour un lot et rendez-vous : même suivi
  const lot = await ensureLot();
  assert.equal((await request(app).post('/api/public/interest').send({ name: 'Intérêt Lot', phone: '0710101010', lot_id: lot.id, utm: { campaign: c.code, medium: 'messagerie' } })).status, 201);
  const interest = await db('leads').where({ phone: '0710101010' }).first();
  assert.equal(interest.campaign_id, c.id);
  assert.equal(interest.source, 'plan');
  assert.equal((await request(app).post('/api/public/appointments').send({ name: 'Rendez Vous', phone: '0711111111', kind: 'visite', starts_at: new Date(Date.now() + 5 * 86400000).toISOString(), utm: { campaign: c.code, medium: 'email', content: '7' } })).status, 201);
  assert.equal((await db('leads').where({ phone: '0711111111' }).first()).utm_medium, 'email');

  // Mesure : prospects, répartition par canal et par contenu
  const perf = (await admin.get(`${URL}/campaigns/${c.id}`)).body.performance;
  assert.equal(perf.prospects, 3);
  assert.deepEqual(perf.by_medium.map(m => m.medium).sort(), ['email', 'messagerie', 'social']);
  assert.equal((await admin.get(`${URL}/dashboard`)).body.leads.tracked >= 3, true);
  // utm_content/utm_medium dépassant les bornes sont tronqués, pas refusés
  assert.equal((await request(app).post('/api/public/contact').send({ name: 'Long Utm', phone: '0712121212', message: 'Bonjour à tous.', utm: { campaign: c.code, medium: 'social', content: 'x'.repeat(80) } })).status, 201);
});

test('préparation hebdomadaire planifiée : une seule par semaine et par campagne, rattrapage, arrêt d’urgence, rappel « à publier » une fois', async () => {
  noKey();
  const c = await validCampaign({ name: 'Hebdo' });
  const friday = '2026-11-06';
  const week = '2026-11-09';
  const prepared = () => db('marketing_generations').where({ campaign_id: c.id, step: 'semaine' });

  await marketing.tick(db, '2026-11-05'); // jeudi : trop tôt
  assert.equal((await prepared()).length, 0);
  await marketing.tick(db, friday);
  assert.equal((await prepared()).length, 1);
  assert.equal(String((await prepared())[0].week_of).slice(0, 10), week);
  const first = await contentsOf(c.id);
  assert.equal(first.length, 4, 'contenus par semaine (réglage)');
  assert.ok(first.every(x => x.scheduled_for >= week && x.scheduled_for <= '2026-11-15' && x.origin === 'demo'), 'tous dans la semaine suivante');
  await marketing.tick(db, friday);
  await marketing.tick(db, '2026-11-07'); // samedi : rattrapage possible mais déjà fait
  assert.equal((await prepared()).length, 1, 'une seule préparation par semaine');
  assert.equal((await contentsOf(c.id)).length, 4);
  // La ligne éditoriale permanente est préparée aussi, et une campagne non validée jamais
  const permanent = await db('marketing_campaigns').where({ permanent: true }).first();
  assert.equal(permanent.status, 'validee');
  assert.equal((await db('marketing_generations').where({ campaign_id: permanent.id, step: 'semaine' })).length, 1);
  const draft = await mkCampaign({ name: 'Non validée' });
  await marketing.tick(db, friday);
  assert.equal((await db('marketing_generations').where({ campaign_id: draft.id })).length, 0);
  // La responsable est prévenue des contenus à valider, une fois
  assert.ok((await notifs(ids.resp_communication, 'marketing.a_valider')).length >= 1);

  // Arrêt d'urgence : rien n'est préparé la semaine suivante ; levé, la préparation reprend
  await admin.post(`${URL}/settings/emergency-stop`).send({ active: true });
  await marketing.tick(db, '2026-11-13');
  assert.equal((await prepared()).length, 1);
  await admin.post(`${URL}/settings/emergency-stop`).send({ active: false });
  // Préparation désactivée dans les réglages : rien non plus
  await admin.put(`${URL}/settings`).send({ marketing_weekly_prep: 0 });
  await marketing.tick(db, '2026-11-13');
  assert.equal((await prepared()).length, 1);
  await admin.put(`${URL}/settings`).send({ marketing_weekly_prep: 1 });
  await marketing.tick(db, '2026-11-13');
  assert.equal((await prepared()).length, 2);
  assert.deepEqual((await prepared()).map(g => String(g.week_of).slice(0, 10)).sort(), ['2026-11-09', '2026-11-16']);

  // Plafond atteint : la tentative est notée et n'est pas répétée à chaque heure
  useKey(okClient());
  await admin.put(`${URL}/settings`).send({ marketing_cap_fcfa: 0 });
  await marketing.tick(db, '2026-11-20');
  await marketing.tick(db, '2026-11-20');
  const refused = (await prepared()).filter(g => g.status === 'refuse_plafond');
  assert.equal(refused.length, 1);
  await admin.put(`${URL}/settings`).send({ marketing_cap_fcfa: 30000 });
  noKey();

  // Rappel « à publier » : contenu validé dont le jour est venu, une seule fois
  const content = first[0];
  await resp.post(`${URL}/contents/${content.id}/validate`);
  const before = (await notifs(ids.resp_communication, 'marketing.a_publier')).length;
  const stats = await marketing.tick(db, '2026-11-15');
  assert.ok(stats.reminded >= 1);
  assert.equal((await notifs(ids.resp_communication, 'marketing.a_publier')).length > before, true);
  assert.equal((await marketing.tick(db, '2026-11-15')).reminded, 0, 'une seule fois');
});

test('notifications : à valider → responsables ; validé et refusé → proposant ; refus de l’IA → retour donné à la prochaine préparation', async () => {
  noKey();
  const c = await validCampaign({ name: 'Notifications' });
  // L'éditeur rédige à la main et soumet : la responsable est prévenue, pas l'éditeur
  const manual = await editeur.post(`${URL}/campaigns/${c.id}/contents`).send({ channel: 'facebook', title: 'Post de l’éditeur', body: 'SIIPAF CITY AHOUTOUE : visite du site sur rendez-vous.' });
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  assert.equal(manual.body.status, 'brouillon');
  assert.equal(manual.body.origin, 'humain');
  assert.equal(manual.body.created_by, ids.editeur);
  assert.equal((await editeur.post(`${URL}/contents/${manual.body.id}/submit`)).status, 200);
  const toValidate = (await notifs(ids.resp_communication, 'marketing.a_valider')).filter(n => /soumis par/.test(n.title));
  assert.equal(toValidate.length, 1);
  assert.equal((await notifs(ids.editeur, 'marketing.a_valider')).length, 0, 'jamais l’auteur de l’action');
  assert.equal((await notifs(ids.commercial, 'marketing.a_valider')).length, 0);

  // Validé : le proposant est prévenu
  assert.equal((await resp.post(`${URL}/contents/${manual.body.id}/validate`)).status, 200);
  const ok = await notifs(ids.editeur, 'marketing.valide');
  assert.equal(ok.length, 1);
  assert.match(ok[0].title, /Post de l’éditeur/);

  // Refusé : le proposant est prévenu avec le motif
  const second = await editeur.post(`${URL}/campaigns/${c.id}/contents`).send({ channel: 'linkedin', title: 'Second post', body: 'SIIPAF CITY AHOUTOUE : présentation du programme.' });
  await editeur.post(`${URL}/contents/${second.body.id}/submit`);
  assert.equal((await resp.post(`${URL}/contents/${second.body.id}/reject`).send({ reason: 'Ajouter le point de chantier' })).status, 200);
  const refused = await notifs(ids.editeur, 'marketing.refuse');
  assert.equal(refused.length, 1);
  assert.match(refused[0].body, /point de chantier/);

  // Proposé par l'IA : le refus est consigné (journal) et sert de consigne à la préparation suivante
  useKey(okClient());
  const aiContent = (await generate(admin, c.id)).body.created[0];
  assert.equal((await resp.post(`${URL}/contents/${aiContent}/reject`).send({ reason: 'Trop de promesses, plus de faits' })).status, 200);
  const events = (await resp.get(`${URL}/contents/${aiContent}`)).body.events;
  assert.ok(events.some(e => e.action === 'reject' && /Trop de promesses/.test(e.note)));
  assert.ok(events.some(e => e.action === 'propose' && e.is_ai), 'proposé par l’IA');
  const fake = useKey(okClient());
  await generate(admin, c.id);
  assert.match(JSON.stringify(fake.calls[0].messages), /Trop de promesses, plus de faits/, 'retour de la responsable transmis à l’IA');
  noKey();

  // Campagne soumise : la Direction générale est prévenue ; validée : l'auteur aussi
  const mine = await mkCampaign({ name: 'Campagne de l’éditeur' }, editeur);
  assert.equal((await editeur.post(`${URL}/campaigns/${mine.id}/submit`)).status, 200);
  assert.equal((await notifs(ids.super_admin, 'marketing.campagne_a_valider')).length, 1);
  assert.equal((await admin.post(`${URL}/campaigns/${mine.id}/validate`)).status, 200);
  assert.equal((await notifs(ids.editeur, 'marketing.valide')).length >= 2, true);

  // Réglage « Mes notifications » : le module existe dans la cloche
  const prefs = (await resp.get('/api/admin/erp/notifications?limit=1')).body;
  assert.equal(prefs.modules.marketing, 'Marketing & Communication');
});

test('e-mail : un contenu validé devient un brouillon de la newsletter existante (droit Newsletter requis)', async () => {
  noKey();
  const c = await validCampaign({ name: 'Newsletter' });
  const created = (await generate(admin, c.id, { channels: ['email'] })).body.created[0];
  assert.equal((await admin.post(`${URL}/contents/${created}/newsletter`)).status, 409, 'à valider d’abord');
  await resp.post(`${URL}/contents/${created}/validate`);
  assert.equal((await resp.post(`${URL}/contents/${created}/newsletter`)).status, 403, 'sans le droit Newsletter');
  const res = await admin.post(`${URL}/contents/${created}/newsletter`);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const draft = await db('newsletter_campaigns').where({ id: res.body.newsletter_id }).first();
  assert.equal(draft.status, 'brouillon');
  assert.match(draft.cta_url, /utm_medium=email/);
  assert.equal((await admin.post(`${URL}/contents/${(await contentsOf(c.id)).find(x => x.channel === 'email').id}/newsletter`)).status, 201);
});

test('migration : tables, colonnes de suivi des prospects et rôle « Responsable communication » en montée et en descente', async () => {
  const other = await setup();
  const k = other.db;
  try {
    const NAME = '20261201000000_marketing_communication.js';
    for (const t of ['marketing_campaigns', 'marketing_contents', 'marketing_content_versions', 'marketing_generations', 'marketing_events', 'marketing_settings']) assert.equal(await k.schema.hasTable(t), true, t);
    for (const col of ['campaign_id', 'utm_medium', 'utm_content']) assert.equal(await k.schema.hasColumn('leads', col), true, col);
    const role = await k('roles').where({ id: 'resp_communication' }).first();
    assert.equal(role.system ? 1 : 0, 0);
    assert.deepEqual((await k('role_permissions').where({ role: 'resp_communication' })).map(r => r.permission).sort(), ['marketing:generate', 'marketing:read', 'marketing:validate']);
    assert.ok(await k('role_permissions').where({ role: 'commercial', permission: 'marketing:read' }).first());
    assert.equal(await k('role_permissions').where({ permission: 'marketing:settings' }).first(), undefined, 'réglages réservés au super administrateur');

    await k('leads').insert({ name: 'Garde Moi', phone: '+2250799999999', source: 'site', stage: 'prospection' });
    await k.migrate.down({ name: NAME });
    for (const t of ['marketing_campaigns', 'marketing_contents', 'marketing_content_versions', 'marketing_generations', 'marketing_events', 'marketing_settings']) assert.equal(await k.schema.hasTable(t), false, t);
    for (const col of ['campaign_id', 'utm_medium', 'utm_content']) assert.equal(await k.schema.hasColumn('leads', col), false, col);
    assert.equal((await k('leads').where({ phone: '+2250799999999' }).first()).name, 'Garde Moi', 'les prospects sont conservés');
    assert.equal(await k('roles').where({ id: 'resp_communication' }).first(), undefined, 'rôle retiré s’il n’est attribué à personne');
    assert.equal(await k('role_permissions').where('permission', 'like', 'marketing:%').first(), undefined);

    await k.migrate.up({ name: NAME });
    assert.equal(await k.schema.hasTable('marketing_campaigns'), true);
    assert.equal(await k.schema.hasColumn('leads', 'campaign_id'), true);
    assert.ok(await k('roles').where({ id: 'resp_communication' }).first());
    assert.equal((await k('leads').where({ phone: '+2250799999999' }).first()).campaign_id, null);
  } finally {
    await k.destroy();
  }
});
