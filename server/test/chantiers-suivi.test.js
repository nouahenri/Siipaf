const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { deliveryForecast, deliveryDelay } = require('../src/lib/domain');
const suivi = require('../src/services/chantiersSuivi');

let db, app, admin, conducteur, commercial, ids, project, worksite, sale, lots;
const W = '/api/admin/erp/chantiers';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await db('lots').insert([
    { project_id: project.id, code: 'A1', ilot: 'A', status: 'disponible', price_fcfa: 20000000 },
    { project_id: project.id, code: 'A2', ilot: 'A', status: 'disponible', price_fcfa: 20000000 },
    { project_id: project.id, code: 'B1', ilot: 'B', status: 'disponible', price_fcfa: 20000000 },
  ]);
  lots = Object.fromEntries((await db('lots').where({ project_id: project.id })).map(l => [l.code, l]));
  worksite = (await conducteur.post(W).send({ project_id: project.id, name: 'Tranche 1', zone_kind: 'ilots', zone: ['A'], manager_id: ids.conducteur_travaux, planned_end: day(200), stages: ['fondations', 'gros_oeuvre', 'livraison'] })).body;
  const res = await admin.post(`/api/admin/lots/${lots.A1.id}/sale`).send({ name: 'Awa Koné', phone: '+225 07 11 22 33 44', email: 'awa@test.ci', vefa: true, signed_at: day(-60) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  sale = res.body;
  await db('leads').where({ id: sale.lead_id }).update({ assigned_to: ids.commercial });
});
after(() => db.destroy());

test('règles : livraison prévue (phase Livraison, sinon fin du chantier) et retard', () => {
  assert.equal(deliveryForecast({ planned_end: '2027-06-30' }, [{ stage: 'livraison', planned_end: '2027-07-15' }]), '2027-07-15');
  assert.equal(deliveryForecast({ planned_end: '2027-06-30' }, [{ stage: 'livraison', planned_end: null }]), '2027-06-30');
  assert.equal(deliveryDelay('2027-06-01', '2027-06-30'), 29);
  assert.equal(deliveryDelay('2027-07-01', '2027-06-30'), 0);
  assert.equal(deliveryDelay('2027-06-01', '2027-06-30', '2027-06-20'), 0, 'déjà livré');
  assert.equal(deliveryDelay(null, '2027-06-30'), 0);
});

test('journal quotidien : une page par jour, complétée ; jamais à l’avance ; un incident prévient la Direction', async () => {
  const url = `${W}/${worksite.id}/journal`;
  assert.equal((await commercial.post(url).field('day', day(0))).status, 404, 'hors de ses chantiers');
  assert.equal((await conducteur.post(url).field('day', day(1))).status, 400);
  let res = await conducteur.post(url).field('day', day(0)).field('weather', 'pluie').field('headcount', '14').field('work_done', 'Coulage des semelles îlot A');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  res = await conducteur.post(url).field('day', day(0)).field('weather', 'pluie').field('headcount', '15').field('work_done', 'Coulage des semelles îlot A').field('incidents', 'Pelle en panne deux heures')
    .attach('photos', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: 'semelles.jpg', contentType: 'image/jpeg' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.length, 1, 'même page complétée');
  assert.deepEqual([res.body[0].headcount, res.body[0].weather_label, res.body[0].photos.length], [15, 'Pluie', 1]);
  assert.ok(await db('notifications').where({ event: 'chantier.incident' }).first());
  const photo = res.body[0].photos[0];
  assert.equal((await conducteur.get(photo.url.replace('/api', '/api'))).status, 200);
  res = await conducteur.delete(`${url}/photos/${photo.id}`);
  assert.equal(res.body[0].photos.length, 0);
});

test('étapes : le conducteur signale, seule la Direction déclare ; la déclaration émet les appels de fonds de la zone', async () => {
  const url = `${W}/${worksite.id}/etapes`;
  const calledBefore = (await db('fund_calls').where({ sale_id: sale.id, status: 'appele' })).length;
  // Un point d'avancement publié n'appelle rien ; la zone « îlot A » donne un point pour l'îlot
  let res = await conducteur.post(`${W}/${worksite.id}/avancement`).field('stage', 'gros_oeuvre').field('progress_pct', '30').field('title', 'Élévation des murs');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.published, 1);
  assert.equal(res.body.points[0].scope_label, 'Îlot A');
  assert.equal((await db('fund_calls').where({ sale_id: sale.id, status: 'appele' })).length, calledBefore);

  assert.equal((await conducteur.post(url).field('stage', 'fondations').field('reached_on', day(-2)).field('declare', 'true')).status, 403, 'le conducteur ne déclare pas');
  res = await conducteur.post(url).field('stage', 'fondations').field('reached_on', day(-2)).field('note', 'PV du bureau de contrôle');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const declId = res.body.id;
  assert.equal((await conducteur.post(url).field('stage', 'fondations').field('reached_on', day(-2))).status, 409, 'déjà signalée');
  assert.ok((await admin.get(`${W}/badges`)).body.to_declare >= 1);
  // La Direction générale (super administrateur) est prévenue et voit l'étape dans la Vue Direction
  const signalNotif = () => db('notifications').where({ dedupe_key: `etape:${declId}:signalee` }).whereIn('user_id', db('users').where({ role: 'super_admin' }).select('id')).first();
  assert.equal((await signalNotif())?.read_at, null, 'cloche du super administrateur');
  let view = (await admin.get('/api/admin/erp/direction/overview')).body.chantiers.worksites;
  assert.ok(view.declarations.some(x => x.id === declId), 'Vue Direction : à déclarer');
  assert.ok((await admin.get('/api/admin/erp/direction/overview')).body.administration.attention.some(x => x.module === 'chantiers' && /Fondations/.test(x.label)), 'À traiter en priorité');
  assert.equal((await conducteur.post(`${W}/etapes/${declId}/declarer`).send({})).status, 403);

  res = await admin.post(`${W}/etapes/${declId}/declarer`).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.calls, 1, 'les fondations du lot A1 (VEFA, îlot A)');
  const called = await db('fund_calls').where({ sale_id: sale.id, status: 'appele' }).orderBy('seq');
  assert.deepEqual(called.map(c => c.stage), ['signature', 'fondations']);
  assert.ok(await db('notifications').where({ user_id: ids.conducteur_travaux, event: 'chantier.etape_declaree' }).first());
  assert.ok(await db('notifications').where({ user_id: ids.commercial, event: 'vefa.appel_emis' }).first());
  assert.ok((await signalNotif()).read_at, 'la demande « à déclarer » est lue une fois déclarée');
  view = (await admin.get('/api/admin/erp/direction/overview')).body.chantiers.worksites;
  assert.equal(view.declarations.some(x => x.id === declId), false);
  const decided = view.decided.find(x => x.id === declId);
  assert.deepEqual([decided.status, decided.calls_count], ['declaree', 1], 'Vue Direction : déclarée, avec ses appels de fonds');
  const phase = (await conducteur.get(`${W}/${worksite.id}`)).body.phases.find(p => p.stage === 'fondations');
  assert.deepEqual([phase.actual_end, phase.progress_pct], [day(-2), 100]);

  // Refus motivé d'un signalement
  res = await conducteur.post(url).field('stage', 'gros_oeuvre').field('reached_on', day(0));
  assert.equal((await admin.post(`${W}/etapes/${res.body.id}/refuser`).send({ reason: '' })).status, 400);
  assert.equal((await admin.post(`${W}/etapes/${res.body.id}/refuser`).send({ reason: 'Attestation du maître d’œuvre manquante' })).status, 200);
  const list = (await conducteur.get(url)).body;
  assert.deepEqual(list.map(d => d.status).sort(), ['declaree', 'refusee']);

  // Un nouveau dossier VEFA de la zone reçoit aussitôt les appels des étapes déjà déclarées
  res = await admin.post(`/api/admin/lots/${lots.A2.id}/sale`).send({ name: 'Yao Paul', phone: '+225 07 55 66 77 88', email: 'yao@test.ci', vefa: true, signed_at: day(-1) });
  assert.deepEqual((await db('fund_calls').where({ sale_id: res.body.id, status: 'appele' }).orderBy('seq')).map(c => c.stage), ['signature', 'fondations']);
  // … mais pas un dossier hors de la zone (îlot B)
  res = await admin.post(`/api/admin/lots/${lots.B1.id}/sale`).send({ name: 'Diallo Fanta', phone: '+225 07 99 88 77 66', email: 'fanta@test.ci', vefa: true, signed_at: day(-1) });
  assert.deepEqual((await db('fund_calls').where({ sale_id: res.body.id, status: 'appele' })).map(c => c.stage), ['signature']);
});

test('livraisons : date promise (dossier de vente), livraison prévue du chantier, retard signalé une fois', async () => {
  const url = `${W}/${worksite.id}/livraisons`;
  assert.equal((await conducteur.patch(`${url}/${sale.id}`).send({ promised_delivery_on: day(100) })).status, 403, 'la date promise relève du commercial');
  let res = await commercial.patch(`${url}/${sale.id}`).send({ promised_delivery_on: day(100) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = res.body.rows.find(r => r.sale_id === sale.id);
  assert.deepEqual([row.lot_code, row.forecast, row.delay_days], ['A1', day(200), 100]);
  assert.equal(res.body.rows.some(r => r.lot_code === 'B1'), false, 'hors zone');
  // Même date que le dossier de vente du dashboard (aller-retour)
  const d = await admin.patch(`/api/admin/sales/${sale.id}`).send({ promised_delivery_on: day(100) });
  assert.equal(d.body.promised_delivery_on, day(100), JSON.stringify(d.body).slice(0, 200));

  assert.ok(await suivi.tick(db) > 0);
  assert.ok(await db('notifications').where({ user_id: ids.commercial, event: 'chantier.livraison_retard' }).first());
  assert.equal(await suivi.tick(db), 0, 'une seule fois pour cette date prévue');
  // Le planning rattrape la date promise : plus de retard
  const phase = (await conducteur.get(`${W}/${worksite.id}`)).body.phases.find(p => p.stage === 'livraison');
  await conducteur.patch(`${W}/${worksite.id}/phases/${phase.id}`).send({ planned_start: day(80), planned_end: day(95) });
  res = await conducteur.get(url);
  assert.equal(res.body.rows.find(r => r.sale_id === sale.id).delay_days, 0);
});

test('reprise : les points publiés avant ce lot deviennent l’étape précédente déclarée', async () => {
  const other = await db('projects').where({ slug: 'riviera' }).first();
  await db('site_updates').insert([
    { project_id: other.id, stage: 'gros_oeuvre', progress_pct: 40, title: 'Murs', published_at: '2026-08-01T08:00:00Z' },
    { project_id: other.id, stage: 'fondations', progress_pct: 20, title: 'Semelles', published_at: '2026-06-01T08:00:00Z' },
    { project_id: other.id, ilot: 'C', stage: 'etudes', progress_pct: 5, title: 'Permis', published_at: '2026-05-01T08:00:00Z' },
  ]);
  const { reprise } = require('../migrations/20261120000000_chantiers_suivi.js');
  const before = await db('stage_declarations').where({ project_id: other.id }).count({ n: '*' }).first();
  assert.equal(Number(before.n), 0);
  await reprise(db);
  const rows = await db('stage_declarations').where({ project_id: other.id });
  assert.deepEqual(rows.map(r => [r.ilot, r.stage, r.status]), [[null, 'fondations', 'declaree']], 'gros œuvre publié → fondations achevées ; les études seules ne déclarent rien');
});
