const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { setup, login, createUser, request } = require('./helpers');
const Q = require('../src/lib/qhse');
const { PERMISSIONS, PERMISSION_IDS, INFO_EVENTS } = require('../src/lib/domain');
const suivi = require('../src/services/qhseSuivi');
const direction = require('../src/services/direction');

const URL = '/api/admin/erp/qhse';
const insertedId = r => (typeof r === 'object' ? r.id : r);
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = day(0);
// Photo minimale (PNG de 1 pixel)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let db, app, admin, conducteur, autre, direction1, rh, commercial, qhse;
let ids, project, w1, w2, emp;
const users = {};

const daily = (agent, over = {}) => agent.post(`${URL}/controls/daily`).send({
  worksite_id: w1, day: today, rating_qualite: 3, rating_hygiene: 3, workers_present: 10, workers_compliant: 10, ...over,
});

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  autre = await login(app, await createUser(db, 'conducteur_travaux', 'autre-conducteur@test.ci'), 'motdepasse-test-123');
  direction1 = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  rh = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123'); // rôle qui règle les RH
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  qhse = await login(app, await createUser(db, 'resp_qhse'), 'motdepasse-test-123');
  for (const u of await db('users').select('id', 'role', 'email')) users[u.email.split('@')[0]] = u.id;
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  w1 = insertedId((await db('worksites').insert({ reference: 'CH-2026-9001', project_id: project.id, name: 'Tranche 1', status: 'en_cours', manager_id: users.conducteur_travaux, created_at: new Date('2026-01-05') }))[0]);
  w2 = insertedId((await db('worksites').insert({ reference: 'CH-2026-9002', project_id: project.id, name: 'Tranche 2', status: 'en_cours', manager_id: users['autre-conducteur'], created_at: new Date('2026-01-05') }))[0]);
  emp = insertedId((await db('employees').insert({ hire_date: '2024-01-01', job_title: 'Maçon', base_salary: 0, department: 'chantier', matricule: 'Q-1', last_name: 'Traoré', first_name: 'Ibrahim' }))[0]);
});
after(() => db.destroy());

test('règles : notes, pourcentage de sécurité, conformité, synthèse de semaine, score d’audit, jours ouvrés', () => {
  assert.equal(Q.meanRating([1, 2]), 2, '1,5 arrondi au niveau le plus proche');
  assert.equal(Q.meanRating([2, 3]), 3);
  assert.equal(Q.meanRating([]), null);
  assert.equal(Q.safetyPct(10, 9), 90);
  assert.equal(Q.safetyPct(3, 2), 67);
  assert.equal(Q.safetyPct(0, 0), null, 'personne sur le chantier : pas de taux');
  assert.equal(Q.conformityRate(['conforme', 'non_conforme', 'sans_objet', 'conforme']), 67, 'sans objet exclu');
  assert.equal(Q.conformityRate(['sans_objet']), null);
  assert.equal(Q.ratingPct(1), 0);
  assert.equal(Q.ratingPct(4), 100);
  assert.equal(Q.auditScore({ rating_qualite: 4, rating_hygiene: 1, safety_rate: 100, env_rate: 50 }), 63);
  assert.equal(Q.auditScore({}), null);
  assert.equal(Q.weekday('2026-11-04'), 3);
  assert.equal(Q.mondayOf('2026-11-08'), '2026-11-02', 'le dimanche appartient à la semaine du lundi précédent');
  assert.deepEqual(Q.workingDays('2026-11-02', '2026-11-08'), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  assert.equal(Q.workingDays('2026-11-02', '2026-11-08', { saturday: true }).length, 6);
  assert.equal(Q.workingDays('2026-11-02', '2026-11-08', { holidays: new Set(['2026-11-03']) }).length, 4);
  assert.equal(Q.actionDueDate('critique', '2026-11-02', { critique: 3, majeure: 15, mineure: 30 }), '2026-11-05');
  assert.match(Q.itemRefusal({ pillar: 'qualite', label: 'Béton', rating: 7 }), /note/);
  assert.match(Q.itemRefusal({ pillar: 'securite', label: 'Balisage', answer: 'bof' }), /conforme/);
  assert.equal(Q.itemRefusal({ pillar: 'securite', label: 'Balisage', answer: 'conforme' }), null);

  const s = Q.weekSummary(
    [{ day: '2026-11-02', rating_qualite: 3, rating_hygiene: 1, safety_pct: 90, env_rate: 80, workers_present: 10, workers_compliant: 9 }, { day: '2026-11-03', rating_qualite: 4, rating_hygiene: 2, safety_pct: 100, env_rate: 100, workers_present: 10, workers_compliant: 10 }],
    [{ day: '2026-10-26', rating_qualite: 2, rating_hygiene: 2, safety_pct: 80, env_rate: 70 }],
    { expected: ['2026-11-02', '2026-11-03', '2026-11-04'] },
  );
  assert.equal(s.qualite_avg, 3.5);
  assert.equal(s.safety_avg, 95);
  assert.equal(s.safety_min, 90);
  assert.deepEqual(s.missing_days, ['2026-11-04']);
  assert.equal(s.workers_non_compliant, 1);
  assert.deepEqual(s.bad_ratings, [{ day: '2026-11-02', pillar: 'hygiene' }]);
  assert.equal(s.trend.qualite, 1.5);
  assert.equal(s.trend.safety, 15);
});

test('droits : sept actions au catalogue, défauts des rôles, rôle Responsable QHSE, événements du circuit', async () => {
  const expected = ['qhse:read', 'qhse:control', 'qhse:all', 'qhse:audit', 'qhse:actions', 'qhse:validate', 'qhse:settings'];
  for (const p of expected) assert.ok(PERMISSION_IDS.includes(p), p);
  assert.deepEqual(PERMISSIONS.conducteur_travaux.filter(p => p.startsWith('qhse:')), ['qhse:read', 'qhse:control']);
  assert.equal(PERMISSIONS.resp_exploitation.filter(p => p.startsWith('qhse:')).length, 6);
  assert.ok(!PERMISSIONS.resp_exploitation.includes('qhse:settings'));
  const granted = async role => (await db('role_permissions').where({ role }).whereIn('permission', expected)).map(r => r.permission).sort();
  assert.deepEqual(await granted('conducteur_travaux'), ['qhse:control', 'qhse:read']);
  assert.deepEqual(await granted('resp_exploitation'), expected.filter(p => p !== 'qhse:settings').sort());
  assert.deepEqual(await granted('resp_qhse'), expected.filter(p => p !== 'qhse:settings').sort());
  assert.deepEqual(await granted('comptable'), ['qhse:all', 'qhse:read', 'qhse:validate'], 'rôle qui règle les RH');
  assert.deepEqual(await granted('commercial'), []);
  assert.ok(await db('roles').where({ id: 'resp_qhse', label: 'Responsable QHSE' }).first());
  for (const e of Object.keys(INFO_EVENTS).filter(k => k.startsWith('qhse.'))) assert.equal(INFO_EVENTS[e].module, 'qhse');

  assert.equal((await commercial.get(`${URL}/dashboard`)).status, 403);
  assert.equal((await commercial.get(`${URL}/badges`)).status, 403);
});

test('contrôle journalier : le conducteur saisit ses chantiers, notes, pourcentage, un par jour', async () => {
  assert.equal((await daily(commercial)).status, 403);
  assert.equal((await daily(autre)).status, 404, 'chantier d’un autre conducteur');
  assert.equal((await daily(conducteur, { day: day(1) })).status, 400, 'jour à venir');
  assert.equal((await daily(conducteur, { workers_present: 5, workers_compliant: 6 })).status, 400, 'plus de conformes que de présents');
  assert.equal((await daily(conducteur, { rating_qualite: null, items: [] })).status, 400, 'aucune note de qualité');
  assert.equal((await daily(conducteur, { rating_qualite: 5 })).status, 400);
  assert.equal((await daily(conducteur, { items: [{ pillar: 'qualite', label: 'Béton' }] })).status, 400, 'point sans note');

  const grid = await db('qhse_checkpoints').where({ pillar: 'securite' }).orderBy('sort');
  assert.ok(grid.length >= 5, 'grille par défaut');
  const res = ok(await daily(conducteur, {
    rating_qualite: null, rating_hygiene: 3, workers_present: 12, workers_compliant: 11,
    items: [
      { pillar: 'qualite', label: 'Maçonnerie', rating: 4 }, { pillar: 'qualite', label: 'Béton', rating: 2 },
      { checkpoint_id: grid[0].id, answer: 'conforme' }, { checkpoint_id: grid[1].id, answer: 'non_conforme' }, { checkpoint_id: grid[2].id, answer: 'sans_objet' },
    ],
    workers: [{ employee_id: emp, issue: 'Sans casque' }], remark_securite: 'Casque oublié',
  }), 201);
  assert.equal(res.rating_qualite, 3, 'moyenne de 4 et 2 : 3 (Bon)');
  assert.equal(res.safety_pct, 92);
  assert.equal(res.site_safety_pct, 50, 'sans objet exclu');
  assert.equal(res.items.length, 5);
  assert.equal(res.workers[0].name, 'Ibrahim Traoré');
  assert.equal(res.status, 'saisi');
  // Un contrôle par chantier et par jour : la saisie suivante corrige
  const again = ok(await daily(conducteur, { rating_qualite: 4, rating_hygiene: 4 }), 201);
  assert.equal(again.id, res.id);
  assert.equal(again.items.length, 0);
  assert.equal(await db('qhse_controls').where({ worksite_id: w1, kind: 'journalier', period_start: today }).count({ n: '*' }).first().then(r => Number(r.n)), 1);
  assert.equal(again.workers.length, 0);
  assert.equal(Number((await db('qhse_workers').where({ control_id: res.id }).count({ n: '*' }).first()).n), 0);

  // Ouvriers nommés : pas plus que les ouvriers hors consignes
  assert.equal((await daily(conducteur, { workers_present: 10, workers_compliant: 10, workers: [{ name: 'Koffi' }] })).status, 400);
  assert.equal((await daily(conducteur, { workers_present: 0, workers_compliant: 0 })).status, 201, 'chantier sans ouvrier ce jour');
  assert.equal((await conducteur.get(`${URL}/controls/${res.id}`)).status, 200);
  assert.equal((await autre.get(`${URL}/controls/${res.id}`)).status, 404);
});

test('portée : qhse:all voit tous les chantiers, le conducteur les siens ; effectif du jour tiré des pointages', async () => {
  ok(await daily(autre, { worksite_id: w2, rating_qualite: 2 }), 201);
  assert.equal(ok(await conducteur.get(`${URL}/controls?kind=journalier`)).every(c => c.worksite_id === w1), true);
  assert.equal(ok(await rh.get(`${URL}/controls?kind=journalier`)).some(c => c.worksite_id === w2), true);
  assert.deepEqual(ok(await conducteur.get(`${URL}/refs`)).worksites.map(w => w.id), [w1]);
  assert.ok(ok(await direction1.get(`${URL}/refs`)).worksites.length >= 2);

  const at = new Date(`${today}T08:00:00Z`);
  await db('hr_attendances').insert({ employee_id: emp, check_in: at, worksite_id: w1, source: 'manuel' });
  const a = ok(await conducteur.get(`${URL}/worksites/${w1}/attendance?day=${today}`));
  assert.equal(a.present, 1);
  assert.equal(a.employees[0].name, 'Ibrahim Traoré');
  assert.ok(a.control_id);
  assert.equal(ok(await conducteur.get(`${URL}/worksites/${w1}/attendance?day=${day(-3)}`)).present, 0);
  assert.equal((await conducteur.get(`${URL}/worksites/${w2}/attendance`)).status, 404);
});

test('alertes : note « Mauvais » et sécurité sous le seuil préviennent les services, sans doublon', async () => {
  const d = day(-1);
  ok(await daily(conducteur, { day: d, rating_qualite: 1, rating_hygiene: 3, workers_present: 10, workers_compliant: 7 }), 201);
  const mine = async (agent, event) => ok(await agent.get('/api/admin/erp/notifications?limit=100')).items.filter(n => n.event === event);
  assert.equal((await mine(direction1, 'qhse.note_mauvaise')).length, 1);
  const low = await mine(direction1, 'qhse.securite_basse');
  assert.equal(low.length, 1);
  assert.match(low[0].title, /70 %/);
  assert.equal((await mine(conducteur, 'qhse.note_mauvaise')).length, 0, 'l’auteur n’est pas prévenu de sa propre saisie');
  assert.equal((await mine(commercial, 'qhse.note_mauvaise')).length, 0);
  ok(await daily(conducteur, { day: d, rating_qualite: 1, rating_hygiene: 3, workers_present: 10, workers_compliant: 7 }), 201);
  assert.equal((await mine(direction1, 'qhse.note_mauvaise')).length, 1, 'même saisie : pas de doublon');
  // Seuil réglable
  ok(await admin.put('/api/admin/erp/reglages/qhse').send({ qhse_safety_threshold_pct: 60 }));
  ok(await daily(conducteur, { day: day(-2), rating_qualite: 3, rating_hygiene: 3, workers_present: 10, workers_compliant: 7 }), 201);
  assert.equal((await mine(direction1, 'qhse.securite_basse')).length, 1, '70 % ne passe pas sous un seuil de 60 %');
  ok(await admin.put('/api/admin/erp/reglages/qhse').send({ qhse_safety_threshold_pct: 90 }));
  assert.equal((await conducteur.put('/api/admin/erp/reglages/qhse').send({ qhse_safety_threshold_pct: 50 })).status, 403, 'réglage réservé à qhse:settings');
});

test('photos : jointes au contrôle, servies après contrôle des droits, retirables', async () => {
  const c = ok(await daily(conducteur), 201);
  const up = ok(await conducteur.post(`${URL}/files/controle/${c.id}`).attach('photos', PNG, { filename: 'mur.png', contentType: 'image/png' }), 201);
  assert.equal(up.length, 1);
  assert.equal(up[0].image, true);
  assert.equal((await conducteur.get(up[0].url.replace('/api/admin/erp/qhse', URL))).status, 200);
  assert.equal((await autre.get(up[0].url.replace('/api/admin/erp/qhse', URL))).status, 404, 'contrôle d’un autre chantier');
  assert.equal((await conducteur.post(`${URL}/files/controle/${c.id}`).attach('photos', Buffer.from('MZ'), { filename: 'virus.exe', contentType: 'application/x-msdownload' })).status, 400);
  assert.equal((await commercial.post(`${URL}/files/controle/${c.id}`).attach('photos', PNG, { filename: 'a.png', contentType: 'image/png' })).status, 403);
  const row = await db('qhse_files').first();
  assert.ok(fs.existsSync(require('../src/services/qhse').filePath(row)));
  assert.deepEqual(ok(await conducteur.delete(`${URL}/files/${up[0].id}`)), []);
  assert.equal(fs.existsSync(require('../src/services/qhse').filePath(row)), false);
});

test('hebdomadaire : synthèse de la semaine, soumission, validation par la direction, verrouillage des jours', async () => {
  const monday = Q.mondayOf(today);
  assert.equal((await rh.post(`${URL}/controls/weekly`).send({ worksite_id: w1, week: today })).status, 403, 'qhse:control requis');
  assert.equal((await conducteur.post(`${URL}/controls/weekly`).send({ worksite_id: w1, week: day(14) })).status, 400, 'semaine à venir');
  assert.equal((await conducteur.post(`${URL}/controls/weekly`).send({ worksite_id: w2, week: today })).status, 404);
  const w = ok(await conducteur.post(`${URL}/controls/weekly`).send({ worksite_id: w1, week: today }), 201);
  assert.equal(w.status, 'brouillon');
  assert.equal(w.period_start, monday);
  assert.ok(w.summary.days >= 1);
  assert.equal(w.summary.week_end, Q.addDays(monday, 6));
  assert.equal(ok(await conducteur.post(`${URL}/controls/weekly`).send({ worksite_id: w1, week: today }), 201).id, w.id, 'une synthèse par semaine');
  assert.equal(w.editable, true);

  ok(await conducteur.patch(`${URL}/controls/${w.id}`).send({ rating_qualite: 3, rating_hygiene: 2, observations: 'Semaine correcte, hygiène à surveiller.' }));
  assert.equal((await conducteur.post(`${URL}/controls/${w.id}/validate`)).status, 403, 'le conducteur ne valide pas');
  assert.equal((await direction1.post(`${URL}/controls/${w.id}/validate`)).status, 409, 'pas encore soumise');
  const sub = ok(await conducteur.post(`${URL}/controls/${w.id}/submit`));
  assert.equal(sub.status, 'a_valider');
  assert.equal((await conducteur.patch(`${URL}/controls/${w.id}`).send({ observations: 'x' })).status, 409, 'plus modifiable en attente');
  const notif = ok(await direction1.get('/api/admin/erp/notifications?limit=100')).items.filter(n => n.event === 'qhse.hebdo_a_valider');
  assert.equal(notif.length, 1);

  // Refus avec motif → retour en brouillon
  assert.equal((await direction1.post(`${URL}/controls/${w.id}/reject`).send({})).status, 400, 'motif obligatoire');
  const rej = ok(await direction1.post(`${URL}/controls/${w.id}/reject`).send({ reason: 'Précisez les remarques d’hygiène' }));
  assert.equal(rej.status, 'brouillon');
  assert.equal(rej.reject_reason, 'Précisez les remarques d’hygiène');
  assert.ok(ok(await conducteur.get('/api/admin/erp/notifications?limit=100')).items.some(n => n.event === 'qhse.decision' && /refusé/.test(n.title)));
  ok(await conducteur.post(`${URL}/controls/${w.id}/submit`));
  const val = ok(await rh.post(`${URL}/controls/${w.id}/validate`));
  assert.equal(val.status, 'valide');
  assert.equal(val.editable, false);

  // La semaine validée verrouille ses contrôles journaliers
  assert.equal((await daily(conducteur)).status, 409);
  const dc = ok(await conducteur.get(`${URL}/controls?kind=journalier&worksite_id=${w1}`)).find(c => c.period_start === today);
  assert.equal(ok(await conducteur.get(`${URL}/controls/${dc.id}`)).locked, true);
  assert.equal((await conducteur.post(`${URL}/files/controle/${dc.id}`).attach('photos', PNG, { filename: 'a.png', contentType: 'image/png' })).status, 403);
});

test('actions correctives : responsable obligatoire avec accès QHSE, levée avec preuve, échéance par gravité', async () => {
  assert.equal((await conducteur.post(`${URL}/actions`).send({ title: 'Réparer le garde-corps', owner_id: users.conducteur_travaux })).status, 403, 'qhse:actions requis');
  assert.equal((await direction1.post(`${URL}/actions`).send({ title: 'Réparer le garde-corps', owner_id: ids.commercial })).status, 400, 'le commercial n’a pas accès au QHSE');
  assert.equal((await direction1.post(`${URL}/actions`).send({ title: 'Réparer le garde-corps', owner_id: users.conducteur_travaux, due_on: day(-1) })).status, 400, 'échéance passée');
  const a = ok(await direction1.post(`${URL}/actions`).send({ title: 'Réparer le garde-corps', gravity: 'critique', owner_id: users.conducteur_travaux, worksite_id: w1, pillar: 'securite' }), 201);
  assert.match(a.reference, /^QHSE-\d{4}-0001$/);
  assert.equal(a.due_on, day(3), 'critique : 3 jours par défaut');
  assert.equal(a.status, 'ouverte');
  assert.ok(ok(await conducteur.get('/api/admin/erp/notifications?limit=100')).items.some(n => n.event === 'qhse.action_assignee'));

  // Le responsable fait avancer son action sans le droit qhse:actions
  assert.equal(ok(await conducteur.post(`${URL}/actions/${a.id}/status`).send({ status: 'en_cours' })).status, 'en_cours');
  assert.equal((await autre.post(`${URL}/actions/${a.id}/status`).send({ status: 'en_cours' })).status, 404, 'action d’un autre chantier');
  assert.equal((await conducteur.patch(`${URL}/actions/${a.id}`).send({ due_on: day(10) })).status, 403, 'modifier demande qhse:actions');
  assert.equal((await conducteur.post(`${URL}/actions/${a.id}/status`).send({ status: 'levee' })).status, 400, 'preuve obligatoire');
  assert.equal((await conducteur.post(`${URL}/actions/${a.id}/status`).send({ status: 'annulee', note: 'Inutile' })).status, 403, 'annuler demande qhse:actions');
  ok(await conducteur.post(`${URL}/files/action/${a.id}`).field('purpose', 'preuve').attach('photos', PNG, { filename: 'apres.png', contentType: 'image/png' }), 201);
  const lifted = ok(await conducteur.post(`${URL}/actions/${a.id}/status`).send({ status: 'levee', note: 'Garde-corps remplacé' }));
  assert.equal(lifted.status, 'levee');
  assert.equal(lifted.lifted_on, today);
  assert.equal(lifted.files.filter(f => f.purpose === 'preuve').length, 1);
  assert.equal((await conducteur.post(`${URL}/actions/${a.id}/status`).send({ status: 'ouverte' })).status, 403, 'rouvrir demande qhse:actions');
  assert.equal(ok(await direction1.post(`${URL}/actions/${a.id}/status`).send({ status: 'ouverte' })).status, 'ouverte');
  assert.equal(ok(await direction1.post(`${URL}/actions/${a.id}/status`).send({ status: 'annulee', note: 'Abandon' })).status, 'annulee');

  // Retard : l'action en retard remonte et prévient son responsable (une fois)
  const late = ok(await direction1.post(`${URL}/actions`).send({ title: 'Évacuer les gravats', owner_id: users.conducteur_travaux, worksite_id: w1, due_on: day(1) }), 201);
  await db('qhse_actions').where({ id: late.id }).update({ due_on: day(-2) });
  const list = ok(await direction1.get(`${URL}/actions?status=retard`));
  assert.equal(list.length, 1);
  assert.equal(list[0].late, true);
  assert.equal(list[0].days_late, 2);
  const stats = await suivi.tick(db, new Date());
  assert.equal(stats.late >= 1, true);
  const n = ok(await conducteur.get('/api/admin/erp/notifications?limit=100')).items.filter(x => x.event === 'qhse.action_retard');
  assert.equal(n.length, 1);
  assert.equal((await suivi.tick(db, new Date())).late, 0, 'sans doublon');
  assert.equal(ok(await conducteur.get(`${URL}/badges`)).actions_late, 1);
});

test('contrôle du jour manquant : alerte au conducteur à l’heure réglée, jours ouvrés seulement', async () => {
  const wed = (h) => new Date(`2026-11-04T${h}:00:00Z`);
  assert.equal((await suivi.tick(db, wed('12'))).missing, 0, 'avant l’heure réglée (17 h)');
  const stats = await suivi.tick(db, wed('18'));
  assert.equal(stats.missing, 2, 'les deux chantiers en cours sans contrôle ce jour-là');
  const mine = ok(await autre.get('/api/admin/erp/notifications?limit=100')).items.filter(x => x.event === 'qhse.controle_manquant');
  assert.equal(mine.length, 1);
  assert.match(mine[0].title, /CH-2026-9002/);
  assert.equal((await suivi.tick(db, wed('19'))).missing, 0, 'une alerte par chantier et par jour');
  const sat = new Date('2026-11-07T18:00:00Z');
  assert.equal((await suivi.tick(db, sat)).missing, 0, 'samedi : non ouvré');
  await db('hr_holidays').insert({ date: '2026-11-05', label: 'Férié test' });
  assert.equal((await suivi.tick(db, new Date('2026-11-05T18:00:00Z'))).missing, 0, 'jour férié');
  // Un contrôle saisi résout l'alerte
  await db('qhse_controls').insert({ worksite_id: w1, kind: 'journalier', period_start: '2026-11-04', status: 'saisi', rating_qualite: 3, rating_hygiene: 3, workers_present: 1, workers_compliant: 1, safety_pct: 100 });
});

test('inspections et audits : planifié ou inopiné, grille, constats, action obligatoire, validation', async () => {
  const body = { kind: 'planifie', place_kind: 'chantier', worksite_id: w1, auditor_id: ids.resp_qhse, planned_on: day(2), objective: 'Inspection générale' };
  assert.equal((await conducteur.post(`${URL}/audits`).send(body)).status, 403, 'qhse:audit requis');
  assert.equal((await direction1.post(`${URL}/audits`).send({ ...body, planned_on: day(-1) })).status, 400, 'date passée');
  assert.equal((await direction1.post(`${URL}/audits`).send({ ...body, auditor_id: null })).status, 400, 'auditeur obligatoire');
  const a = ok(await direction1.post(`${URL}/audits`).send(body), 201);
  assert.match(a.reference, /^AUD-\d{4}-0001$/);
  assert.equal(a.status, 'planifie');
  assert.ok(ok(await qhse.get('/api/admin/erp/notifications?limit=100')).items.some(n => n.event === 'qhse.audit_planifie'), 'l’auditeur est prévenu');
  assert.ok(ok(await conducteur.get('/api/admin/erp/notifications?limit=100')).items.some(n => n.event === 'qhse.audit_planifie'), 'le conducteur est prévenu');
  assert.equal((await autre.get(`${URL}/audits/${a.id}`)).status, 404);
  assert.equal(ok(await conducteur.get(`${URL}/audits`)).length, 1, 'le conducteur voit les audits de son chantier');

  assert.equal((await direction1.post(`${URL}/audits/${a.id}/findings`).send({ pillar: 'securite', gravity: 'majeure', description: 'Échafaudage non vérifié' })).status, 409, 'pas avant le démarrage');
  ok(await direction1.post(`${URL}/audits/${a.id}/start`));
  const grid = await db('qhse_checkpoints').where({ pillar: 'securite' }).orderBy('sort');
  ok(await direction1.put(`${URL}/audits/${a.id}/results`).send({
    items: [{ pillar: 'qualite', label: 'Béton', rating: 4 }, { pillar: 'hygiene', label: 'Propreté', rating: 3 }, { checkpoint_id: grid[0].id, answer: 'conforme' }, { checkpoint_id: grid[1].id, answer: 'non_conforme' }],
    summary: 'Chantier globalement bien tenu.',
  }));
  const withFinding = ok(await direction1.post(`${URL}/audits/${a.id}/findings`).send({ pillar: 'securite', gravity: 'majeure', description: 'Échafaudage non vérifié' }), 201);
  assert.equal(withFinding.findings.length, 1);
  assert.equal(withFinding.safety_rate, 50);
  assert.equal(withFinding.score_pct, Math.round((100 + 67 + 50) / 3), 'qualité 4 = 100 %, hygiène 3 = 67 %, sécurité 50 %');

  // Un constat majeur demande une action corrective avant la soumission
  assert.equal((await direction1.post(`${URL}/audits/${a.id}/submit`)).status, 400);
  const f = withFinding.findings[0];
  const act = ok(await direction1.post(`${URL}/actions`).send({ title: 'Faire vérifier l’échafaudage', finding_id: f.id, owner_id: users.conducteur_travaux }), 201);
  assert.equal(act.audit_id, a.id);
  assert.equal(act.worksite_id, w1);
  assert.equal(act.gravity, 'majeure', 'gravité du constat reprise');
  assert.equal(act.source_kind, 'audit');
  assert.equal((await direction1.delete(`${URL}/findings/${f.id}`)).status, 409, 'constat avec action');
  assert.equal(ok(await direction1.post(`${URL}/audits/${a.id}/submit`)).status, 'a_valider');
  assert.equal((await conducteur.post(`${URL}/audits/${a.id}/validate`)).status, 403);
  assert.ok(ok(await rh.get('/api/admin/erp/notifications?limit=100')).items.some(n => n.event === 'qhse.audit_a_valider'));
  const back = ok(await rh.post(`${URL}/audits/${a.id}/reject`).send({ reason: 'Ajoutez les photos' }));
  assert.equal(back.status, 'en_cours');
  ok(await direction1.post(`${URL}/audits/${a.id}/submit`));
  assert.equal(ok(await rh.post(`${URL}/audits/${a.id}/validate`)).status, 'valide');
  assert.equal((await direction1.put(`${URL}/audits/${a.id}/results`).send({ items: [] })).status, 409, 'audit validé : figé');

  // Inopiné au siège : démarre tout de suite ; le siège demande la portée « tous les chantiers »
  assert.equal((await conducteur.post(`${URL}/audits`).send({ kind: 'inopine', place_kind: 'siege', auditor_name: 'Cabinet X' })).status, 403);
  const siege = ok(await direction1.post(`${URL}/audits`).send({ kind: 'inopine', place_kind: 'siege', place_label: 'Dépôt', auditor_name: 'Cabinet Sécurité Plus' }), 201);
  assert.equal(siege.status, 'en_cours');
  assert.equal(siege.done_on, today);
  assert.equal(siege.place_label, 'Dépôt');
  assert.equal(siege.auditor_name, 'Cabinet Sécurité Plus');
  assert.equal(ok(await conducteur.get(`${URL}/audits`)).some(x => x.id === siege.id), false, 'audit du siège hors de la portée du conducteur');
});

test('grilles réglables : ajouter, renommer, désactiver, ordonner ; un point utilisé ne se supprime pas', async () => {
  assert.equal((await direction1.get(`${URL}/checkpoints`)).status, 403, 'qhse:settings requis');
  assert.equal((await direction1.post(`${URL}/checkpoints`).send({ pillar: 'securite', label: 'Éclairage du chantier' })).status, 403);
  const added = ok(await admin.post(`${URL}/checkpoints`).send({ pillar: 'securite', label: 'Éclairage du chantier' }), 201);
  const mine = added.find(c => c.label === 'Éclairage du chantier');
  assert.equal((await admin.post(`${URL}/checkpoints`).send({ pillar: 'securite', label: 'éclairage du chantier' })).status, 409, 'doublon');
  assert.equal((await admin.post(`${URL}/checkpoints`).send({ pillar: 'inconnu', label: 'Test' })).status, 400);
  ok(await admin.patch(`${URL}/checkpoints/${mine.id}`).send({ label: 'Éclairage de nuit' }));
  assert.ok(ok(await conducteur.get(`${URL}/refs`)).checkpoints.some(c => c.label === 'Éclairage de nuit'));
  ok(await admin.patch(`${URL}/checkpoints/${mine.id}`).send({ active: false }));
  assert.equal(ok(await conducteur.get(`${URL}/refs`)).checkpoints.some(c => c.id === mine.id), false, 'désactivé : absent des contrôles');
  const pillar = (await db('qhse_checkpoints').where({ pillar: 'securite' }).orderBy('sort')).map(c => c.id);
  const order = ok(await admin.put(`${URL}/checkpoints/ordre`).send({ pillar: 'securite', ids: [...pillar].reverse() })).filter(c => c.pillar === 'securite').map(c => c.id);
  assert.deepEqual(order, [...pillar].reverse());
  assert.equal((await admin.put(`${URL}/checkpoints/ordre`).send({ pillar: 'securite', ids: pillar.slice(1) })).status, 400, 'liste incomplète');
  const used = (await db('qhse_items').whereNotNull('checkpoint_id').first()).checkpoint_id;
  assert.equal((await admin.delete(`${URL}/checkpoints/${used}`)).status, 409);
  assert.equal((await admin.delete(`${URL}/checkpoints/${mine.id}`)).status, 200, 'jamais utilisé : supprimable');
});

test('liaisons : fiche employé (remarque sécurité), fiche chantier, réclamation SAV, Vue Direction', async () => {
  // RH : l'ouvrier nommé lors du contrôle du jour apparaît sur sa fiche (portée qhse:all)
  const rem = ok(await rh.get(`${URL}/employees/${emp}/remarks`));
  assert.ok(Array.isArray(rem));
  const c = ok(await daily(conducteur, { day: day(-30), workers_present: 4, workers_compliant: 3, workers: [{ employee_id: emp, issue: 'Sans harnais' }] }), 201);
  const rem2 = ok(await rh.get(`${URL}/employees/${emp}/remarks`));
  assert.equal(rem2[0].issue, 'Sans harnais');
  assert.equal(rem2[0].control_id, c.id);
  assert.equal((await conducteur.get(`${URL}/employees/${emp}/remarks`)).status, 403, 'portée tous les chantiers requise');

  // Chantiers : onglet QHSE
  const s = ok(await conducteur.get(`${URL}/worksites/${w1}/summary`));
  assert.equal(s.worksite.id, w1);
  assert.ok(s.recent.length >= 1);
  assert.equal(s.can.control, true);
  assert.equal((await conducteur.get(`${URL}/worksites/${w2}/summary`)).status, 404);

  // SAV : une réclamation qualité ouvre une action corrective et affiche l'historique qualité du programme
  const ticketId = insertedId((await db('sav_tickets').insert({ ref: 'SAV-2026-9001', project_id: project.id, category: 'maconnerie', priority: 'normale', status: 'nouveau', title: 'Fissure sur le mur', source: 'equipe' }))[0]);
  const link = ok(await direction1.get(`${URL}/sav/${ticketId}`));
  assert.equal(link.worksites.length >= 2, true);
  assert.equal(link.can_open, true);
  const act = ok(await direction1.post(`${URL}/actions`).send({ title: 'Reprendre la fissure', sav_ticket_id: ticketId, owner_id: users.conducteur_travaux, worksite_id: w1, pillar: 'qualite' }), 201);
  assert.equal(act.source_kind, 'sav');
  assert.equal(ok(await direction1.get(`${URL}/sav/${ticketId}`)).actions[0].sav_ref, 'SAV-2026-9001');
  assert.equal((await direction1.post(`${URL}/actions`).send({ title: 'Reprendre la fissure', sav_ticket_id: 999999, owner_id: users.conducteur_travaux })).status, 400);

  // Vue Direction : indicateurs et « À traiter en priorité »
  const overview = await direction.overview(db);
  assert.ok(overview.qhse);
  assert.equal(overview.qhse.worksites >= 2, true);
  assert.equal(overview.qhse.threshold, 90);
  assert.equal(overview.qhse.attention, undefined, 'les points rejoignent la liste commune');
  const priority = overview.administration.attention.filter(x => x.module === 'qhse');
  assert.ok(priority.some(x => /Sécurité à 70 %/.test(x.label)), 'sécurité sous le seuil sans action corrective');
  assert.ok(priority.some(x => /Action corrective en retard/.test(x.label)));
  assert.ok(priority.every(x => x.link.startsWith('/qhse')));
  const dash = ok(await direction1.get(`${URL}/dashboard`));
  assert.equal(dash.worksites.length >= 2, true);
  assert.equal(dash.series.length, 30);
  assert.ok(dash.kpis.late_actions >= 1);
  const mineDash = ok(await conducteur.get(`${URL}/dashboard`));
  assert.deepEqual(mineDash.worksites.map(w => w.id), [w1]);
});

test('migration : retour arrière puis nouvelle application, rôle conservé tant qu’il est attribué', async () => {
  const knex = db;
  await knex.migrate.down();
  assert.equal(await knex.schema.hasTable('qhse_controls'), false);
  assert.equal(await knex('role_permissions').where('permission', 'like', 'qhse:%').first(), undefined);
  assert.ok(await knex('roles').where({ id: 'resp_qhse' }).first(), 'le rôle reste : un compte l’utilise');
  await knex.migrate.latest();
  assert.equal(await knex.schema.hasTable('qhse_controls'), true);
  assert.equal(Number((await knex('qhse_checkpoints').count({ n: '*' }).first()).n) >= 20, true);
});
