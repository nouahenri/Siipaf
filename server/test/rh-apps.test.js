const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');
const { computeOvertime, withoutBreak, DEFAULT_RH } = require('../src/lib/rh');

const noBreak = { ...DEFAULT_RH, break_minutes: 0 };

let db, app, comptable, awaAgent, koffiAgent, editeur, awa, koffi;
const R = '/api/admin/erp/rh';
const P = '/api/admin/erp/paie';
const pdf = Buffer.from('%PDF-1.4 reçu');

before(async () => {
  ({ db, app } = await setup());
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  awaAgent = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  koffiAgent = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  const awaUser = await db('users').where({ email: 'commercial@test.ci' }).first();
  const koffiUser = await db('users').where({ email: 'conducteur_travaux@test.ci' }).first();
  koffi = (await comptable.post(`${P}/employees`).send({ last_name: 'Kouassi', first_name: 'Koffi', gender: 'M', job_title: 'Conducteur de travaux', department: 'technique', hire_date: '2023-06-01', base_salary: 173330, user_id: koffiUser.id })).body;
  awa = (await comptable.post(`${P}/employees`).send({ last_name: 'Koné', first_name: 'Awa', gender: 'F', job_title: 'Commerciale', department: 'commercial', hire_date: '2024-01-01', base_salary: 300000, user_id: awaUser.id, manager_id: koffi.id })).body;
  await comptable.post('/api/admin/erp/compta/fiscal-years').send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
});
after(() => db.destroy());

test('heures supplémentaires : 41e à 46e heure à +15 %, au-delà +50 %, dimanche +75 %', () => {
  const a = [2, 3, 4, 5, 6].map(d => ({ check_in: `2026-03-0${d}T07:00:00Z`, check_out: `2026-03-0${d}T17:00:00Z` }));
  a.push({ check_in: '2026-03-07T08:00:00Z', check_out: '2026-03-07T12:00:00Z' }, { check_in: '2026-03-08T08:00:00Z', check_out: '2026-03-08T10:00:00Z' });
  const r = computeOvertime(a, { period: '2026-03', baseSalary: 173330, s: noBreak });
  assert.equal(r.worked, 56);
  assert.deepEqual(r.lines.map(l => [l.key, l.hours]), [['tier0', 6], ['tier1', 8], ['sunday', 2]]);
  assert.equal(r.amount, 6 * 1000 * 1.15 + 8 * 1000 * 1.5 + 2 * 1000 * 1.75);
  const night = computeOvertime([{ check_in: '2026-03-09T06:00:00Z', check_out: '2026-03-09T23:00:00Z' }, ...[10, 11].map(d => ({ check_in: `2026-03-${d}T06:00:00Z`, check_out: `2026-03-${d}T23:30:00Z` }))], { period: '2026-03', baseSalary: 173330, s: noBreak });
  assert.equal(night.lines.find(l => l.key === 'night').hours, 1.5, 'seules les heures de nuit au-delà de 40 h sont majorées (mercredi 22 h – 23 h 30)');
  assert.equal(computeOvertime(a, { period: '2026-04', baseSalary: 1 }).worked, 0, 'semaine rattachée au mois de son jeudi');
  // Pause déjeuner : 7 h – 17 h continu → 9 h, la pause est prise de 12 h à 13 h
  const parts = withoutBreak(new Date('2026-03-02T07:00:00Z'), new Date('2026-03-02T17:00:00Z'));
  assert.deepEqual(parts.map(([x, y]) => [x.toISOString().slice(11, 16), y.toISOString().slice(11, 16)]), [['07:00', '12:00'], ['13:00', '17:00']]);
  assert.equal(withoutBreak(new Date('2026-03-02T07:00:00Z'), new Date('2026-03-02T12:00:00Z')).length, 1, 'pas de pause sous 6 h');
  assert.equal(computeOvertime(a, { period: '2026-03', baseSalary: 173330 }).worked, 51, '5 × 9 h + 4 h + 2 h');
});

test('pointage : en ligne, borne avec code, feuille de chantier, correction motivée ; heures sup reprises dans la paie', async () => {
  let res = await awaAgent.post(`${R}/me/attendance`).send({});
  assert.equal(res.body.action, 'arrivee');
  res = await awaAgent.post(`${R}/me/attendance`).send({});
  assert.equal(res.body.action, 'depart');
  assert.equal((await editeur.post(`${R}/me/attendance`).send({})).status, 404, 'compte sans fiche');

  assert.equal((await awaAgent.put(`${R}/me/pin`).send({ pin: '12' })).status, 400);
  await awaAgent.put(`${R}/me/pin`).send({ pin: '4821' });
  assert.equal((await awaAgent.post(`${R}/attendance/kiosk`).send({ matricule: awa.matricule, pin: '4821' })).status, 403, 'borne : compte autorisé à pointer');
  assert.equal((await koffiAgent.post(`${R}/attendance/kiosk`).send({ matricule: awa.matricule, pin: '0000' })).status, 401);
  res = await koffiAgent.post(`${R}/attendance/kiosk`).send({ matricule: awa.matricule.toLowerCase(), pin: '4821' });
  assert.equal(res.body.action, 'arrivee');
  assert.equal(res.body.employee.name, 'Koné Awa');
  const me = (await awaAgent.get(`${R}/me`)).body.employee;
  assert.equal(me.attendance_pin_hash, undefined, 'code jamais renvoyé');
  assert.equal(me.has_pin, true);

  // Semaine du 2 au 8 mars 2026 sur le chantier : 5 jours de 10 h + samedi matin
  const rows = d => [{ employee_id: koffi.id, periods: d === '07' ? [['08:00', '12:00']] : [['07:00', '12:00'], ['13:00', '18:00']] }];
  for (const d of ['02', '03', '04', '05', '06', '07']) {
    res = await koffiAgent.post(`${R}/attendance/sheet`).send({ date: `2026-03-${d}`, rows: rows(d) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  res = await koffiAgent.post(`${R}/attendance/sheet`).send({ date: '2026-03-02', rows: rows('02') });
  assert.equal(res.body.created, 2, 'la feuille du jour remplace la précédente');
  res = await koffiAgent.post(`${R}/attendance`).send({ employee_id: koffi.id, check_in: '2026-03-08T08:00:00Z', check_out: '2026-03-08T10:00:00Z', note: '' });
  assert.equal(res.status, 400, 'motif obligatoire');
  res = await koffiAgent.post(`${R}/attendance`).send({ employee_id: koffi.id, check_in: '2026-03-08T08:00:00Z', check_out: '2026-03-08T10:00:00Z', note: 'Coulage de dalle le dimanche' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await koffiAgent.post(`${R}/attendance`).send({ employee_id: koffi.id, check_in: '2026-03-08T09:00:00Z', check_out: '2026-03-08T11:00:00Z', note: 'Doublon' })).status, 409);

  res = await koffiAgent.get(`${R}/overtime?period=2026-03`);
  const k = res.body.rows.find(r => r.employee_id === koffi.id);
  assert.equal(k.overtime, 16);
  assert.equal(k.amount, undefined, 'montant masqué sans droit de paie');
  assert.equal((await koffiAgent.post(`${R}/overtime/approve`).send({ period: '2026-03' })).status, 403);
  res = await comptable.post(`${P}/runs`).send({ period: '2026-03' });
  const runId = res.body.id;
  res = await comptable.post(`${R}/overtime/approve`).send({ period: '2026-03', employee_ids: [koffi.id] });
  assert.equal(res.body.approved, 1);
  const slip = (await comptable.get(`${P}/runs/${runId}`)).body.slips.find(s => s.employee_id === koffi.id);
  assert.equal(slip.inputs.overtime, 6 * 1000 * 1.15 + 8 * 1000 * 1.5 + 2 * 1000 * 1.75);
  assert.equal(slip.result.overtime, slip.inputs.overtime);
  assert.equal(slip.inputs.overtime_hours.length, 3);
});

test('notes de frais : reçu, soumission, approbation du responsable, comptabilisation, remboursement', async () => {
  let res = await awaAgent.post(`${R}/me/expenses`).field('date', '2026-03-10').field('category', 'carburant').field('label', 'Visite clients Bingerville').field('amount', '23600').field('vat_rate', '18');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  let x = res.body;
  assert.equal(x.reference, 'NDF-2026-0001');
  assert.equal((await awaAgent.post(`${R}/expenses/${x.id}/submit`)).status, 400, 'reçu obligatoire');
  res = await awaAgent.patch(`${R}/expenses/${x.id}`).attach('receipt', pdf, { filename: 'recu.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.receipt_url);
  await awaAgent.post(`${R}/expenses/${x.id}/submit`);
  assert.equal((await awaAgent.post(`${R}/expenses/${x.id}/approve`)).status, 403, 'pas d’approbation de sa propre note');
  assert.equal((await editeur.post(`${R}/expenses/${x.id}/approve`)).status, 403);
  assert.equal((await koffiAgent.get(`${R}/expenses?to_do=1`)).body.length, 1);
  res = await koffiAgent.post(`${R}/expenses/${x.id}/approve`);
  assert.equal(res.body.status, 'approuvee');
  assert.equal((await koffiAgent.post(`${R}/expenses/${x.id}/post`)).status, 403, 'comptabilisation : comptable');
  res = await comptable.post(`${R}/expenses/${x.id}/post`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'comptabilisee');
  const lines = await db('acc_lines as l').join('acc_accounts as a', 'a.id', 'l.account_id').where('l.entry_id', res.body.entry_id).select('a.code', 'l.debit', 'l.credit', 'l.partner_id');
  assert.deepEqual(lines.map(l => [l.code, Number(l.debit), Number(l.credit)]), [['6053', 20000, 0], ['4452', 3600, 0], ['422100', 0, 23600]]);
  assert.equal(lines[2].partner_id, awa.id);
  assert.equal((await awaAgent.get(x.receipt_url || res.body.receipt_url)).status, 200);
  assert.equal((await editeur.get(res.body.receipt_url)).status, 403);

  res = await comptable.post(`${R}/expenses/reimburse`).send({ ids: [x.id], journal: 'MM', date: '2026-03-15' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 23600);
  x = (await awaAgent.get(`${R}/expenses/${x.id}`)).body;
  assert.equal(x.status, 'remboursee');
  assert.equal((await comptable.post(`${R}/expenses/reimburse`).send({ ids: [x.id], journal: 'MM', date: '2026-03-15' })).status, 409);
});

test('recrutement : candidature du site, étapes, refus motivé, embauche qui crée la fiche employé', async () => {
  let res = await comptable.post(`${R}/jobs`).send({ title: 'Chef de chantier', department: 'chantier', contract_type: 'cdd', openings: 1, published: true, description: 'Suivi des travaux à Ahoutoué' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const job = res.body;
  assert.equal((await request(app).get('/api/public/emplois')).body[0].title, 'Chef de chantier');
  res = await request(app).post('/api/public/candidatures').field('job_id', String(job.id)).field('name', 'Yao Serge').field('email', 'yao@example.ci').field('phone', '0700000000');
  assert.equal(res.status, 400, 'CV obligatoire');
  res = await request(app).post('/api/public/candidatures').field('job_id', String(job.id)).field('name', 'Yao Serge').field('email', 'yao@example.ci').field('phone', '0700000000').field('website', 'spam').attach('cv', pdf, { filename: 'cv.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 400, 'champ piège');
  res = await request(app).post('/api/public/candidatures').field('job_id', String(job.id)).field('name', 'Yao Serge').field('email', 'yao@example.ci').field('phone', '0700000000').attach('cv', pdf, { filename: 'cv.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id = res.body.id;
  res = await comptable.post(`${R}/applicants`).field('job_id', String(job.id)).field('name', 'Bamba Ali').field('source', 'linkedin');
  const other = res.body;

  assert.equal((await editeur.get(`${R}/applicants`)).status, 403);
  assert.equal((await comptable.post(`${R}/applicants/${id}/hire`).send({ hire_date: '2026-04-01' })).status, 400, 'proposition d’abord');
  await comptable.post(`${R}/applicants/${id}/move`).send({ stage: 'entretien_1', note: 'Bon contact' });
  await comptable.post(`${R}/applicants/${id}/move`).send({ stage: 'proposition' });
  await comptable.post(`${R}/applicants/${other.id}/move`).send({ refuse_reason: 'experience' });
  res = await comptable.get(`${R}/applicants/${id}`);
  assert.equal(res.body.source, 'site_web');
  assert.ok(res.body.logs.some(l => l.summary.includes('Premier entretien')));

  res = await comptable.post(`${R}/applicants/${id}/hire`).send({ hire_date: '2026-04-01', base_salary: 450000, trial_end_date: '2026-06-30' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const e = await db('employees').where({ id: res.body.employee_id }).first();
  assert.deepEqual([e.first_name, e.last_name, e.job_title, e.department, e.contract_type, Number(e.base_salary)], ['Yao', 'Serge', 'Chef de chantier', 'chantier', 'cdd', 450000]);
  assert.ok(await db('hr_career_events').where({ employee_id: e.id, kind: 'embauche' }).first());
  const j = (await comptable.get(`${R}/jobs?all=1`)).body.find(x => x.id === job.id);
  assert.equal(j.status, 'pourvu', 'poste pourvu');
  assert.equal(j.published, false);
  assert.equal((await request(app).get('/api/public/emplois')).body.length, 0);
});

test('compétences et formations : profil complété par l’employé, formation réalisée reportée au CV, organigramme', async () => {
  const types = (await awaAgent.get(`${R}/skills`)).body;
  const neg = types.flatMap(t => t.skills).find(s => s.name === 'Négociation commerciale');
  let res = await awaAgent.put(`${R}/employees/${awa.id}/skills/${neg.id}`).send({ level: 2 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.skills[0].level_label, 'Maîtrise');
  assert.equal((await awaAgent.put(`${R}/employees/${awa.id}/skills/${neg.id}`).send({ level: 9 })).status, 400);
  assert.equal((await koffiAgent.put(`${R}/employees/${awa.id}/skills/${neg.id}`).send({ level: 3 })).status, 403, 'le responsable ne modifie pas le profil');
  await awaAgent.post(`${R}/employees/${awa.id}/resume`).send({ kind: 'experience', title: 'Conseillère commerciale', organisation: 'Agence X', start_date: '2020-01-01', end_date: '2023-12-31' });

  const height = types.flatMap(t => t.skills).find(s => s.name === 'Travail en hauteur');
  res = await comptable.post(`${R}/trainings`).send({ title: 'Sécurité en hauteur', provider: 'Organisme agréé', kind: 'externe', skill_id: height.id, start_date: '2026-03-20', end_date: '2026-03-21', hours: 14, cost: 250000, fdfp: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const t = res.body;
  await comptable.put(`${R}/trainings/${t.id}/participants`).send({ employee_ids: [koffi.id, awa.id] });
  res = await comptable.post(`${R}/trainings/${t.id}/complete`).send({ attendance: [{ employee_id: koffi.id, present: true }, { employee_id: awa.id, present: false }] });
  assert.equal(res.body.status, 'realisee');
  const profile = (await koffiAgent.get(`${R}/employees/${koffi.id}/profile`)).body;
  assert.equal(profile.resume[0].title, 'Sécurité en hauteur');
  assert.equal(profile.skills[0].skill_name, 'Travail en hauteur');
  assert.equal((await db('hr_resume_lines').where({ employee_id: awa.id, title: 'Sécurité en hauteur' })).length, 0, 'absente : rien au CV');
  assert.equal((await awaAgent.get(`${R}/trainings`)).body.length, 1, 'l’employé voit ses formations');
  const sum = (await comptable.get(`${R}/trainings/summary?year=2026`)).body;
  assert.equal(sum.cost, 250000);
  assert.equal(sum.hours, 14);

  const org = (await editeur.get(`${R}/orgchart`)).body;
  const top = org.find(n => n.id === koffi.id);
  assert.equal(top.reports[0].id, awa.id);
});

test('performance : indicateurs chantier, SAV et assiduité calculés, score pondéré, tableau par service', async () => {
  const koffiUser = await db('users').where({ email: 'conducteur_travaux@test.ci' }).first();
  const project = await db('projects').first('id');
  await comptable.patch(`${P}/employees/${koffi.id}`).send({ project_id: project.id });
  const y = new Date().getFullYear();
  const at = (m, d, h = 9) => new Date(Date.UTC(y, m - 1, d, h));
  await db('site_updates').insert([
    { project_id: project.id, ilot: 'A', stage: 'gros_oeuvre', progress_pct: 40, title: 'Élévation', published_at: at(1, 10), created_by: koffiUser.id },
    { project_id: project.id, ilot: 'A', stage: 'toiture', progress_pct: 70, title: 'Charpente', published_at: at(1, 20), created_by: koffiUser.id },
    { project_id: project.id, ilot: 'B', stage: 'fondations', progress_pct: 30, title: 'Fondations', published_at: at(1, 15), created_by: koffiUser.id },
  ]);
  await db('sav_tickets').insert([
    { ref: 'SAV-T-1', category: 'plomberie', title: 'Fuite', status: 'resolu', assigned_to: koffiUser.id, created_at: at(1, 5, 8), due_at: at(1, 7), resolved_at: at(1, 6, 8), satisfaction: 5 },
    { ref: 'SAV-T-2', category: 'electricite', title: 'Prise', status: 'resolu', assigned_to: koffiUser.id, created_at: at(1, 5, 8), due_at: at(1, 6), resolved_at: at(1, 8, 8), satisfaction: 3 },
  ]);
  let res = await comptable.post(`${R}/employees/${koffi.id}/objectives`).send({ year: y, title: 'Faire avancer la tranche', metric: 'chantier_avancement', target_value: 100, weight: 2 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await comptable.post(`${R}/employees/${koffi.id}/objectives`).send({ year: y, title: 'SAV dans les délais', metric: 'sav_dans_delai', target_value: 100, weight: 1 });
  await comptable.post(`${R}/employees/${koffi.id}/objectives`).send({ year: y, title: 'Zéro absence non planifiée', metric: 'absences', target_value: 0, weight: 1 });
  assert.equal((await comptable.post(`${R}/employees/${awa.id}/objectives`).send({ year: y, title: 'Chantier', metric: 'chantier_avancement', target_value: 80 })).status, 400, 'fiche sans affectation');

  const ind = (await comptable.get(`${R}/employees/${koffi.id}/indicators?year=${y}`)).body;
  const v = Object.fromEntries(ind.groups.flatMap(g => g.items).map(i => [i.key, i.value]));
  assert.equal(v.chantier_avancement, 50, 'dernier % de chaque îlot : (70 + 30) / 2');
  assert.equal(v.chantier_publications, 3);
  assert.equal(v.sav_resolus, 2);
  assert.equal(v.sav_dans_delai, 50);
  assert.equal(v.sav_delai_moyen, 48, '24 h et 72 h');
  assert.equal(v.sav_satisfaction, 4);
  assert.equal(v.absences, 0);
  assert.equal(v.presence, 100);
  assert.equal(ind.score, Math.round((50 * 2 + 50 + 100) / 4), 'atteintes pondérées 50 %, 50 %, 100 %');
  assert.deepEqual(ind.groups.map(g => g.group), ['Chantier et technique', 'SAV et qualité', 'Assiduité et formation']);

  const rep = (await comptable.get(`${R}/performance?year=${y}`)).body;
  const tech = rep.departments.find(d => d.key === 'technique');
  assert.equal(tech.headcount, 1);
  assert.equal(tech.score, ind.score);
  assert.equal(tech.employees[0].name, 'Kouassi Koffi');
  assert.ok(rep.departments.some(d => d.key === 'commercial'));
  assert.equal((await editeur.get(`${R}/performance?year=${y}`)).status, 404, 'sans fiche ni droit RH');
  const team = (await koffiAgent.get(`${R}/performance?year=${y}`)).body;
  assert.deepEqual(team.overall.employees.map(e => e.employee_id), [awa.id], 'le responsable voit son équipe');
});

test('courbes de performance : semaines ISO, mois, trimestres ; cible proratisée, trajectoire, objectifs manuels datés', async () => {
  const { buckets } = require('../src/services/performance');
  const w = buckets('semaine', '2026-01-01', '2026-01-14');
  assert.deepEqual(w.map(b => [b.key, b.from, b.to]), [['2026-S01', '2025-12-29', '2026-01-04'], ['2026-S02', '2026-01-05', '2026-01-11'], ['2026-S03', '2026-01-12', '2026-01-18']]);
  assert.deepEqual(buckets('trimestre', '2026-02-10', '2026-12-31').map(b => b.key), ['2026-T1', '2026-T2', '2026-T3', '2026-T4']);
  assert.deepEqual(buckets('annee', '2024-06-01', '2026-03-01').map(b => b.label), ['2024', '2025', '2026']);

  const y = new Date().getFullYear();
  let res = await comptable.post(`${R}/employees/${koffi.id}/objectives`).send({ year: y, title: 'Publier l’avancement', metric: 'chantier_publications', target_value: 12, weight: 1 });
  const pub = res.body;
  res = await comptable.post(`${R}/employees/${koffi.id}/objectives`).send({ year: y, title: 'Plan sécurité', metric: 'manuel', progress: 20, weight: 1 });
  const manual = res.body;
  assert.equal((await db('hr_objective_checkins').where({ objective_id: manual.id })).length, 1, 'avancement initial daté');
  await comptable.patch(`${R}/objectives/${manual.id}`).send({ progress: 60 });
  await comptable.patch(`${R}/objectives/${manual.id}`).send({ progress: 70 });
  assert.equal((await db('hr_objective_checkins').where({ objective_id: manual.id })).length, 1, 'un seul point par jour');

  res = await comptable.get(`${R}/employees/${koffi.id}/performance?granularite=mois&du=${y}-01-01&au=${y}-12-31`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const s = res.body;
  assert.equal(s.buckets.length, 12);
  const jan = s.buckets[0];
  assert.equal(jan.values.chantier_publications, 3);
  assert.equal(jan.values.sav_resolus, 2);
  const p = s.objectives.find(o => o.id === pub.id).points[0];
  assert.equal(p.target, Math.round((12 * 31 / (y % 4 === 0 ? 366 : 365)) * 10) / 10, 'cible de janvier au prorata');
  assert.equal(p.attainment, 100);
  assert.equal(p.ytd, 3);
  assert.ok(typeof jan.score === 'number');
  assert.equal(s.objectives.find(o => o.id === manual.id).points.find(x => x.key === new Date().toISOString().slice(0, 7))?.attainment, 70);
  assert.ok(s.buckets.some(b => b.future) || new Date().getUTCMonth() === 11, 'mois à venir sans valeur');
  assert.ok(s.metrics.some(m => m.key === 'presence'));

  assert.equal((await comptable.get(`${R}/employees/${koffi.id}/performance?granularite=jour`)).status, 400);
  assert.equal((await awaAgent.get(`${R}/employees/${koffi.id}/performance`)).status, 403, 'pas les courbes de son responsable');
  assert.equal((await koffiAgent.get(`${R}/employees/${awa.id}/performance?granularite=trimestre`)).body.buckets.length, 4, 'le responsable voit son équipe');
});
