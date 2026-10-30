const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');
const {
  SITE_STAGES, SITE_STAGE_LABELS, LOTISSEMENT_STAGES, LOTISSEMENT_STAGE_LABELS, ALL_SITE_STAGES, siteStagesFor, siteStageLabel, siteStageError,
} = require('../src/lib/domain');

// Les étapes d'un chantier diffèrent selon le projet : bâtiments (programme immobilier) ou terrains (lotissement)
let db, app, admin, conducteur, lotis, immo, lotLot, lotImmo;
const W = '/api/admin/erp/chantiers';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const LOTIS_KEYS = ['etudes', 'bornage', 'terrassement', 'voirie', 'reseaux', 'assainissement', 'eclairage', 'attribution_lots', 'livraison'];
const LOTIS_LABELS = [
  'Études et approbation du lotissement', 'Bornage et implantation', 'Défrichage et terrassement', 'Voirie', 'Réseaux (eau, électricité)',
  'Assainissement et drainage', 'Éclairage public et finitions', 'Attribution des lots', 'Livraison (ACD, titre)',
];

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  // Un lotissement (catégorie technique tirée du type de projet) et un programme immobilier
  lotis = await db('projects').where({ slug: 'riviera' }).first();
  await db('projects').where({ id: lotis.id }).update({ category: 'lotissement' });
  immo = await db('projects').where({ slug: 'ahoutoue' }).first();
  await db('lots').insert([
    { project_id: lotis.id, code: 'T1', ilot: 'A', status: 'disponible', price_fcfa: 8000000 },
    { project_id: immo.id, code: 'V1', ilot: 'A', status: 'disponible', price_fcfa: 20000000 },
  ]);
  lotLot = await db('lots').where({ project_id: lotis.id, code: 'T1' }).first();
  lotImmo = await db('lots').where({ project_id: immo.id, code: 'V1' }).first();
});
after(() => db.destroy());

test('règles : liste ordonnée et libellés d’un lotissement, programme immobilier inchangé', () => {
  assert.deepEqual(LOTISSEMENT_STAGES, LOTIS_KEYS);
  assert.deepEqual(LOTIS_KEYS.map(k => LOTISSEMENT_STAGE_LABELS[k]), LOTIS_LABELS);
  const lot = siteStagesFor('lotissement');
  assert.deepEqual(lot.keys, LOTIS_KEYS);
  assert.deepEqual(lot.list.map(s => s.label), LOTIS_LABELS);
  assert.equal(lot.labels.bornage, 'Bornage et implantation');
  for (const cat of ['social', 'haut_standing', 'social_haut_standing', null, undefined]) {
    assert.deepEqual(siteStagesFor(cat).keys, SITE_STAGES, `bâtiments pour ${cat}`);
    assert.equal(siteStagesFor(cat).labels.fondations, 'Fondations');
  }
  assert.equal(SITE_STAGE_LABELS.etudes, 'Études et autorisations', 'libellé bâtiments conservé');
  // Les clés actuelles restent valides, les nouvelles s'y ajoutent
  for (const k of [...SITE_STAGES, ...LOTIS_KEYS]) assert.ok(ALL_SITE_STAGES.includes(k), k);
  assert.equal(new Set(ALL_SITE_STAGES).size, ALL_SITE_STAGES.length, 'sans doublon');
  // Clés communes : même clé, libellé propre au projet
  assert.equal(siteStageLabel('lotissement', 'etudes'), 'Études et approbation du lotissement');
  assert.equal(siteStageLabel('haut_standing', 'etudes'), 'Études et autorisations');
  assert.equal(siteStageLabel('lotissement', 'livraison'), 'Livraison (ACD, titre)');
  assert.equal(siteStageLabel(null, 'livraison'), 'Livraison');
  // Une donnée ancienne (étape de bâtiment sur un lotissement) reste lisible
  assert.equal(siteStageLabel('lotissement', 'fondations'), 'Fondations');
  assert.equal(siteStageLabel('haut_standing', 'bornage'), 'Bornage et implantation');
  // Refus de l'étape de l'autre type, sauf clés communes
  assert.match(siteStageError('lotissement', 'fondations'), /lotissement/);
  assert.match(siteStageError('haut_standing', 'bornage'), /programme immobilier/);
  assert.equal(siteStageError('lotissement', 'terrassement'), null);
  assert.equal(siteStageError('haut_standing', 'livraison'), null);
  assert.equal(siteStageError('lotissement', 'bornage'), null);
  assert.match(siteStageError('lotissement', 'nimportequoi'), /inconnue/);
});

test('chantier d’un lotissement : phases de départ aux libellés du lotissement, étape de bâtiment refusée', async () => {
  let res = await admin.post(W).send({ project_id: lotis.id, name: 'Viabilisation', stages: ['livraison', 'voirie', 'bornage', 'etudes'] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const w = res.body;
  assert.deepEqual(w.phases.map(p => p.stage), ['etudes', 'bornage', 'voirie', 'livraison'], 'ordre du lotissement');
  assert.deepEqual(w.phases.map(p => p.label), ['Études et approbation du lotissement', 'Bornage et implantation', 'Voirie', 'Livraison (ACD, titre)']);
  assert.equal(w.phases[0].stage_label, 'Études et approbation du lotissement');

  res = await admin.post(W).send({ project_id: lotis.id, name: 'Faux départ', stages: ['fondations'] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /lotissement/);
  res = await admin.post(W).send({ project_id: lotis.id, name: 'Inconnue', stages: ['nimportequoi'] });
  assert.equal(res.status, 400);

  // Phase ajoutée à la main
  res = await admin.post(`${W}/${w.id}/phases`).send({ stage: 'reseaux' });
  assert.equal(res.status, 400, 'libellé obligatoire');
  res = await admin.post(`${W}/${w.id}/phases`).send({ stage: 'reseaux', label: 'Réseaux (eau, électricité)' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.phases.find(p => p.stage === 'reseaux').stage_label, 'Réseaux (eau, électricité)');
  res = await admin.post(`${W}/${w.id}/phases`).send({ stage: 'gros_oeuvre', label: 'Gros œuvre' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /lotissement/);

  // Phase ancienne (créée avant les étapes de lotissement) : toujours modifiable avec son étape d'origine
  const [old] = await db('worksite_phases').insert({ worksite_id: w.id, stage: 'fondations', label: 'Fondations', sort: 99 });
  const oldId = typeof old === 'object' ? old.id : old;
  res = await admin.patch(`${W}/${w.id}/phases/${oldId}`).send({ stage: 'fondations', label: 'Fondations', progress_pct: 40 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  res = await admin.patch(`${W}/${w.id}/phases/${oldId}`).send({ stage: 'toiture' });
  assert.equal(res.status, 400, 'changer pour une autre étape de bâtiment reste refusé');
});

test('programme immobilier : liste des bâtiments inchangée, étape de lotissement refusée', async () => {
  let res = await admin.post(W).send({ project_id: immo.id, name: 'Tranche 1', stages: ['fondations', 'etudes', 'toiture'] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.phases.map(p => [p.stage, p.label]), [['etudes', 'Études et autorisations'], ['fondations', 'Fondations'], ['toiture', 'Toiture']]);
  res = await admin.post(W).send({ project_id: immo.id, name: 'Mélange', stages: ['bornage'] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /programme immobilier/);
  res = await admin.post(`${W}/${(await db('worksites').where({ project_id: immo.id }).first()).id}/phases`).send({ stage: 'voirie', label: 'Voirie' });
  assert.equal(res.status, 400);
});

test('référentiel des chantiers : chaque projet propose sa liste d’étapes', async () => {
  const refs = (await admin.get(`${W}/refs`)).body;
  assert.deepEqual(refs.stages.map(s => s.key), SITE_STAGES, 'liste des bâtiments par défaut');
  assert.deepEqual(refs.projects.find(p => p.id === lotis.id).stages.map(s => s.key), LOTIS_KEYS);
  assert.deepEqual(refs.projects.find(p => p.id === lotis.id).stages.map(s => s.label), LOTIS_LABELS);
  assert.deepEqual(refs.projects.find(p => p.id === immo.id).stages.map(s => s.key), SITE_STAGES);
  assert.equal(refs.projects.find(p => p.id === lotis.id).category, 'lotissement');
  // Appels de fonds VEFA : les bâtiments seulement
  const meta = (await admin.get('/api/admin/erp/commercial/meta')).body;
  assert.deepEqual(meta.site_stages.map(s => s.id), SITE_STAGES);
  assert.deepEqual(meta.project_stages[lotis.id].map(s => s.id), LOTIS_KEYS);
  assert.deepEqual(meta.project_stages[immo.id].map(s => s.id), SITE_STAGES);
});

test('étapes signalées et déclarées : celles du projet seulement, libellés du lotissement', async () => {
  const w = (await admin.post(W).send({ project_id: lotis.id, name: 'Tranche A', manager_id: (await db('users').where({ role: 'conducteur_travaux' }).first()).id, stages: ['bornage'] })).body;
  const url = `${W}/${w.id}/etapes`;
  let res = await conducteur.post(url).field('stage', 'fondations').field('reached_on', day(-1));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /lotissement/);
  res = await conducteur.post(url).field('stage', 'bornage').field('reached_on', day(-1));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const decl = (await admin.get(url)).body[0];
  assert.equal(decl.stage_label, 'Bornage et implantation');
  assert.equal((await admin.post(`${W}/etapes/${decl.id}/declarer`).send({})).status, 200);
  // La phase du chantier est terminée à la déclaration
  const phase = (await db('worksite_phases').where({ worksite_id: w.id, stage: 'bornage' }).first());
  assert.equal(phase.progress_pct, 100);
  // Déclaration directe par la Direction : mêmes contrôles
  res = await admin.post(url).field('stage', 'gros_oeuvre').field('reached_on', day(-1)).field('declare', 'true');
  assert.equal(res.status, 400);
  res = await admin.post(url).field('stage', 'voirie').field('reached_on', day(-1)).field('declare', 'true');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await admin.get(url)).body.find(d => d.stage === 'voirie').stage_label, 'Voirie');
  // Un programme immobilier refuse l'étape d'un lotissement
  const wi = (await admin.post(W).send({ project_id: immo.id, name: 'Tranche B' })).body;
  res = await admin.post(`${W}/${wi.id}/etapes`).field('stage', 'bornage').field('reached_on', day(-1)).field('declare', 'true');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /programme immobilier/);
  // Signalement d'une étape commune : libellé du projet
  res = await admin.post(`${W}/${wi.id}/etapes`).field('stage', 'etudes').field('reached_on', day(-1)).field('declare', 'true');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await admin.get(`${W}/${wi.id}/etapes`)).body[0].stage_label, 'Études et autorisations');
  // Déclaration de la Direction depuis les appels de fonds : liste du projet
  res = await admin.post('/api/admin/erp/commercial/vefa/milestones').send({ project_id: lotis.id, stage: 'fondations', date: day(-1) });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /lotissement/);
  res = await admin.post('/api/admin/erp/commercial/vefa/milestones').send({ project_id: lotis.id, stage: 'reseaux', date: day(-1) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('points d’avancement publiés : étapes du projet, libellés du lotissement', async () => {
  const post = (id, body) => admin.post(`/api/admin/projects/${id}/site-updates`).send({ progress_pct: 30, title: 'Point', published_at: new Date().toISOString(), ...body });
  let res = await post(lotis.id, { stage: 'voirie' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.stage_label, 'Voirie');
  res = await post(lotis.id, { stage: 'etudes', title: 'Plan approuvé' });
  assert.equal(res.body.stage_label, 'Études et approbation du lotissement');
  res = await post(lotis.id, { stage: 'toiture' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /lotissement/);
  res = await post(immo.id, { stage: 'voirie' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /programme immobilier/);
  res = await post(immo.id, { stage: 'toiture' });
  assert.equal(res.status, 201);
  assert.equal(res.body.stage_label, 'Toiture');
  // Modification : l'étape est contrôlée sur le projet du point
  const id = (await post(lotis.id, { stage: 'bornage' })).body.id;
  assert.equal((await admin.patch(`/api/admin/site-updates/${id}`).send({ stage: 'fondations' })).status, 400);
  res = await admin.patch(`/api/admin/site-updates/${id}`).send({ stage: 'assainissement' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.stage_label, 'Assainissement et drainage');
  // Liste du projet : libellés du lotissement
  const list = (await admin.get(`/api/admin/projects/${lotis.id}/site-updates`)).body;
  assert.ok(list.every(u => u.stage_label));
  // Étapes proposées à l'écran de saisie
  const stages = (await admin.get(`/api/admin/projects/${lotis.id}/site-stages`)).body;
  assert.deepEqual(stages.map(s => s.id), LOTIS_KEYS);
  assert.deepEqual((await admin.get(`/api/admin/projects/${immo.id}/site-stages`)).body.map(s => s.id), SITE_STAGES);
  assert.equal((await admin.get('/api/admin/projects/999999/site-stages')).status, 404);
  // Le compte qui publie l'avancement (sans lire les projets) obtient aussi la liste
  assert.deepEqual((await conducteur.get(`/api/admin/projects/${lotis.id}/site-stages`)).body.map(s => s.id), LOTIS_KEYS);
});

test('espace client d’un lotissement : étapes du lotissement, programme immobilier inchangé', async () => {
  const access = async lot => {
    const sale = (await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: `Client ${lot.code}`, phone: `+225 07 00 00 0${lot.id % 10}${lot.id % 7}`, financing: 'comptant' })).body;
    const code = sale.lead.client_code;
    const tmp = (await admin.post(`/api/admin/leads/${sale.lead.id}/client-access`).send({})).body.temporary_password;
    const agent = request.agent(app);
    assert.equal((await agent.post('/api/client/login').send({ code, password: tmp })).status, 200);
    assert.equal((await agent.post('/api/client/password').send({ current: tmp, next: 'MotDePasseClient-2026' })).status, 200);
    return { agent, sale };
  };
  // Une donnée ancienne : étape de bâtiment publiée avant la distinction, toujours lisible
  await db('site_updates').insert({ project_id: lotis.id, stage: 'fondations', progress_pct: 5, title: 'Ancien point', visible_client: true, published_at: new Date('2026-01-01T10:00:00Z') });

  const l = await access(lotLot);
  let res = await l.agent.get(`/api/client/dossiers/${l.sale.id}/chantier`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.stages.map(s => s.id), LOTIS_KEYS);
  assert.deepEqual(res.body.stages.map(s => s.label), LOTIS_LABELS);
  assert.equal(res.body.updates.find(u => u.title === 'Ancien point').stage_label, 'Fondations');
  // Le dernier point publié donne l'étape actuelle (libellé du lotissement)
  await admin.post(`/api/admin/projects/${lotis.id}/site-updates`).send({ stage: 'attribution_lots', progress_pct: 90, title: 'Tirage au sort', published_at: `${day(1)}T10:00:00Z` });
  res = await l.agent.get(`/api/client/dossiers/${l.sale.id}/chantier`);
  assert.equal(res.body.updates[0].stage, 'attribution_lots');
  assert.equal(res.body.updates[0].stage_label, 'Attribution des lots');
  res = await l.agent.get('/api/client/dossiers');
  assert.equal(res.body[0].progress.stage_label, 'Attribution des lots');
  res = await l.agent.get('/api/client/me');
  assert.equal(res.body.client.progress.stage_label, 'Attribution des lots', 'accueil de l’espace client');

  const i = await access(lotImmo);
  await admin.post(`/api/admin/projects/${immo.id}/site-updates`).send({ stage: 'gros_oeuvre', progress_pct: 40, title: 'Murs', published_at: `${day(2)}T10:00:00Z` });
  res = await i.agent.get(`/api/client/dossiers/${i.sale.id}/chantier`);
  assert.deepEqual(res.body.stages.map(s => s.id), SITE_STAGES);
  assert.equal(res.body.stages[0].label, 'Études et autorisations');
  assert.equal(res.body.updates[0].stage_label, 'Gros œuvre');
  // Le dashboard (liste des clients) montre l'avancement avec le libellé du projet
  const row = (await admin.get('/api/admin/clients')).body.find(c => c.lead_id === l.sale.lead.id);
  assert.equal(row.progress.stage_label, 'Attribution des lots');
});

test('VEFA interdite sur un lotissement (plan d’appels de fonds, dossier de vente)', async () => {
  const plan = { milestones: [{ stage: 'signature', label: 'Signature', pct: 20 }, { stage: 'livraison', label: 'Livraison', pct: 80 }] };
  const refused = await admin.put(`/api/admin/erp/commercial/vefa/plans/${lotis.id}`).send(plan);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /lotissement/);
  const lead = (await admin.post('/api/admin/leads').send({ name: 'Acheteur de terrain', phone: '0799990001' })).body;
  const sale = await admin.post(`/api/admin/lots/${lotLot.id}/sale`).send({ lead_id: lead.id, vefa: true });
  assert.equal(sale.status, 400, JSON.stringify(sale.body));
  const ok = await admin.put(`/api/admin/erp/commercial/vefa/plans/${immo.id}`).send(plan);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});
