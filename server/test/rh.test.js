const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { easter, fixedHolidays, countDays, leaveBalance, annualBonus } = require('../src/lib/rh');

let db, app, comptable, awaAgent, koffiAgent, editeur, exploitation, awa, koffi, leave;
const R = '/api/admin/erp/rh';
const P = '/api/admin/erp/paie';

before(async () => {
  ({ db, app } = await setup());
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  awaAgent = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  koffiAgent = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  exploitation = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
});
after(() => db.destroy());

test('règles : Pâques, jours fériés, jours ouvrables, acquisition de 2,2 jours par mois et majorations', () => {
  assert.equal(easter(2026), '2026-04-05');
  assert.ok(fixedHolidays(2025).some(h => h.date === '2025-04-21' && h.label === 'Lundi de Pâques'));
  assert.ok(fixedHolidays(2025).some(h => h.date === '2025-06-09' && h.label === 'Lundi de Pentecôte'));
  // Du lundi 14 au samedi 26 avril 2025 : 12 jours ouvrables (dimanche exclu), moins le lundi de Pâques
  assert.equal(countDays('2025-04-14', '2025-04-26', { holidays: ['2025-04-21'] }), 11);
  assert.equal(countDays('2025-04-14', '2025-04-26', { count: 'calendaires' }), 13);
  assert.equal(countDays('2025-04-14', '2025-04-15', { startHalf: true }), 1.5);

  const year = leaveBalance({ hire_date: '2024-01-01' }, { at: '2024-12-31' });
  assert.equal(year.accrued, 26.4, '12 mois × 2,2 jours');
  const unpaid = leaveBalance({ hire_date: '2024-01-01' }, { at: '2024-12-31', unpaidCalendarDays: 30 });
  assert.equal(unpaid.accrued, 24.2, 'un mois sans solde n’ouvre pas de droits');
  assert.equal(annualBonus({ hire_date: '2015-03-01' }, '2025-03-01').seniority, 2, '10 ans d’ancienneté : +2 jours');
  assert.equal(annualBonus({ hire_date: '2020-03-01', children: 5, birth_date: '1985-01-01' }, '2025-03-01').children, 4, 'à partir du 4e enfant : 2 jours par enfant');
  assert.equal(annualBonus({ hire_date: '2020-03-01', children: 2, birth_date: '2006-01-01' }, '2025-03-01').children, 4, 'salarié de moins de 21 ans : 2 jours par enfant');
});

test('dossiers : fiches reliées aux comptes, responsable direct, historique de carrière', async () => {
  const awaUser = await db('users').where({ email: 'commercial@test.ci' }).first();
  const koffiUser = await db('users').where({ email: 'conducteur_travaux@test.ci' }).first();
  let res = await comptable.post(`${P}/employees`).send({ last_name: 'Kouassi', first_name: 'Koffi', gender: 'M', job_title: 'Conducteur de travaux', department: 'technique', hire_date: '2023-06-01', base_salary: 600000, user_id: koffiUser.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  koffi = res.body;
  res = await comptable.post(`${P}/employees`).send({ last_name: 'Koné', first_name: 'Awa', gender: 'F', job_title: 'Commerciale', department: 'commercial', hire_date: '2024-01-01', base_salary: 300000, user_id: awaUser.id, manager_id: koffi.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  awa = res.body;
  assert.equal((await comptable.patch(`${R}/employees/${koffi.id}`).send({ manager_id: awa.id })).status, 400, 'pas de boucle hiérarchique');

  await comptable.patch(`${P}/employees/${awa.id}`).send({ base_salary: 350000, job_title: 'Commerciale senior' });
  let career = (await comptable.get(`${R}/employees/${awa.id}`)).body.career;
  assert.equal(career[0].kind, 'promotion');
  assert.equal(career[0].details.base_salary.to, 350000);
  assert.ok(career.some(c => c.kind === 'embauche'));
  career = (await exploitation.get(`${R}/employees/${awa.id}`)).body.career;
  assert.equal(career[0].details.base_salary, undefined, 'salaire masqué sans droit de paie');
  assert.equal(career[0].details.job_title.to, 'Commerciale senior');

  assert.equal((await editeur.get(`${R}/employees`)).status, 403);
  assert.equal((await editeur.get(`${R}/me`)).status, 404, 'compte sans fiche employé');
  assert.equal((await awaAgent.get(`${R}/employees/${koffi.id}`)).status, 403, 'un employé ne voit pas le dossier de son responsable');
  assert.equal((await koffiAgent.get(`${R}/employees/${awa.id}`)).body.access, 'manager');
});

test('congé annuel : demande en libre-service, accord du responsable puis du service RH, solde', async () => {
  assert.equal((await comptable.post(`${R}/holidays/seed`).send({ year: 2025 })).body.created, 10);
  let res = await awaAgent.post(`${R}/me/leaves`).send({ type: 'conge_annuel', start_date: '2025-04-14', end_date: '2025-04-26', reason: 'Vacances' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  leave = res.body.leave;
  assert.equal(leave.days, 11, 'lundi de Pâques et dimanche non décomptés');
  assert.equal(leave.status, 'en_attente');
  assert.ok(res.body.warnings.some(w => w.includes('14 jours')), 'fraction de moins de 14 jours signalée');

  assert.equal((await awaAgent.post(`${R}/leaves/${leave.id}/decide`).send({ action: 'approve' })).status, 403, 'pas d’accord sur sa propre demande');
  assert.equal((await editeur.post(`${R}/leaves/${leave.id}/decide`).send({ action: 'approve' })).status, 403);
  assert.equal((await koffiAgent.get(`${R}/approvals`)).body.length, 1);
  res = await koffiAgent.post(`${R}/leaves/${leave.id}/decide`).send({ action: 'approve' });
  assert.equal(res.body.status, 'approuve_manager');
  assert.equal((await koffiAgent.get(`${R}/approvals`)).body.length, 0, 'plus rien à faire pour le responsable');
  assert.equal((await comptable.get(`${R}/approvals`)).body.length, 1);
  res = await comptable.post(`${R}/leaves/${leave.id}/decide`).send({ action: 'approve' });
  assert.equal(res.body.status, 'approuvee');
  assert.equal(res.body.manager_name, 'conducteur_travaux');

  const me = (await awaAgent.get(`${R}/me`)).body;
  assert.equal(me.balance.taken, 11);
  assert.equal(me.manager, 'Kouassi Koffi');

  res = await awaAgent.post(`${R}/me/leaves`).send({ type: 'conge_annuel', start_date: '2025-04-24', end_date: '2025-04-28' });
  assert.equal(res.status, 409, 'chevauchement refusé');
  res = await awaAgent.post(`${R}/me/leaves`).send({ type: 'conge_annuel', start_date: '2025-05-05', end_date: '2025-07-31' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Solde insuffisant/);
  res = await awaAgent.post(`${R}/me/leaves`).send({ type: 'absence_injustifiee', start_date: '2025-05-05', end_date: '2025-05-05' });
  assert.equal(res.status, 403, 'absence injustifiée : saisie du service RH');
  res = await awaAgent.post(`${R}/leaves/${leave.id}/decide`).send({ action: 'cancel' });
  assert.equal(res.status, 403, 'congé commencé : seul le service RH annule');
});

test('permissions exceptionnelles : durée par événement et plafond annuel ; maternité', async () => {
  let res = await awaAgent.post(`${R}/me/leaves`).send({ type: 'permission', event: 'mariage', start_date: '2025-09-01', end_date: '2025-09-05' });
  assert.equal(res.status, 400, 'mariage : 4 jours');
  res = await awaAgent.post(`${R}/me/leaves`).send({ type: 'permission', event: 'mariage', start_date: '2025-09-01', end_date: '2025-09-04' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await comptable.post(`${R}/leaves/${res.body.leave.id}/decide`).send({ action: 'approve' });
  res = await awaAgent.post(`${R}/me/leaves`).send({ type: 'permission', event: 'deces_enfant_parent', start_date: '2025-10-06', end_date: '2025-10-10' });
  assert.equal(res.status, 201);
  res = await awaAgent.post(`${R}/me/leaves`).send({ type: 'permission', event: 'naissance', start_date: '2025-11-03', end_date: '2025-11-04' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /10 jours/);
  res = await comptable.post(`${R}/leaves`).send({ employee_id: koffi.id, type: 'maternite', start_date: '2025-02-01', end_date: '2025-05-01' });
  assert.equal(res.status, 400, 'maternité refusée pour un salarié');
});

test('paie : une absence non payée approuvée réduit les jours payés ; la saisie manuelle est gardée', async () => {
  let res = await comptable.post(`${R}/leaves`).send({ employee_id: awa.id, type: 'sans_solde', start_date: '2025-06-10', end_date: '2025-06-14', approve: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.leave.status, 'approuvee');
  res = await comptable.post(`${P}/runs`).send({ period: '2025-06' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const slip = res.body.slips.find(s => s.employee_id === awa.id);
  assert.equal(slip.inputs.unpaid_days, 5);
  assert.equal(slip.inputs.days_worked, 25);
  assert.equal(slip.result.base, Math.round(350000 * 25 / 30));
  // Absence injustifiée ajoutée ensuite : le recalcul de la paie la prend en compte
  await comptable.post(`${R}/leaves`).send({ employee_id: awa.id, type: 'absence_injustifiee', start_date: '2025-06-20', end_date: '2025-06-20' });
  res = await comptable.post(`${P}/runs/${res.body.id}/refresh`);
  assert.equal(res.body.slips.find(s => s.employee_id === awa.id).inputs.days_worked, 24);
  const k = res.body.slips.find(s => s.employee_id === koffi.id);
  await comptable.patch(`${P}/payslips/${k.id}`).send({ days_worked: 28 });
  res = await comptable.post(`${P}/runs/${res.body.id}/refresh`);
  assert.equal(res.body.slips.find(s => s.employee_id === koffi.id).inputs.days_worked, 28, 'jours saisis à la main conservés');
});

test('documents privés du dossier : accès du service RH et de l’employé, pas du responsable', async () => {
  let res = await comptable.post(`${R}/employees/${awa.id}/documents`).field('kind', 'cni').field('expires_at', '2025-12-31').attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'cni.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const doc = res.body;
  assert.equal((await awaAgent.get(doc.url)).status, 200);
  assert.equal((await koffiAgent.get(doc.url)).status, 403);
  assert.equal((await editeur.get(doc.url)).status, 403);
  res = await comptable.post(`${R}/employees/${awa.id}/documents`).attach('file', Buffer.from('MZ'), { filename: 'virus.exe', contentType: 'application/x-msdownload' });
  assert.equal(res.status, 400);
  res = await awaAgent.post(`${R}/me/documents`).field('kind', 'cni').attach('file', Buffer.from('%PDF'), { filename: 'x.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 400, 'l’employé ne dépose que des justificatifs');
  assert.equal((await comptable.delete(`${R}/documents/${doc.id}`)).status, 200);
});

test('objectifs et entretien : indicateur commercial calculé, appréciation avant finalisation', async () => {
  let res = await koffiAgent.post(`${R}/employees/${awa.id}/objectives`).send({ year: 2025, title: 'Ventes de l’année', metric: 'ventes', target_value: 10, weight: 2 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await koffiAgent.post(`${R}/employees/${awa.id}/objectives`).send({ year: 2025, title: 'Formation produit', progress: 50 });
  assert.equal((await awaAgent.post(`${R}/employees/${awa.id}/objectives`).send({ year: 2025, title: 'Auto-objectif' })).status, 403);
  const rows = (await koffiAgent.get(`${R}/objectives?year=2025`)).body.rows;
  assert.equal(rows.length, 1, 'le responsable voit son équipe');
  const o = rows[0].objectives.find(x => x.metric === 'ventes');
  assert.equal(o.auto, true);
  assert.equal(o.actual, 0);
  assert.equal(rows[0].score, Math.round((0 * 2 + 50) / 3));
  await awaAgent.put(`${R}/me/review/2025`).send({ self_comment: 'Bonne année' });
  assert.equal((await koffiAgent.put(`${R}/employees/${awa.id}/reviews/2025`).send({ finalize: true })).status, 400);
  res = await koffiAgent.put(`${R}/employees/${awa.id}/reviews/2025`).send({ rating: 4, manager_comment: 'Très bien', finalize: true });
  assert.equal(res.body.status, 'finalise');
  assert.equal(res.body.self_comment, 'Bonne année');
  assert.equal((await awaAgent.put(`${R}/me/review/2025`).send({ self_comment: 'Modif' })).status, 409);
});

test('tableau de bord RH', async () => {
  const d = (await exploitation.get(`${R}/dashboard`)).body;
  assert.equal(d.headcount, 2);
  assert.equal(d.departments.commercial, 1);
  assert.equal(d.months.length, 12);
  assert.ok(d.pending >= 1);
});

test('réglages RH : heures supplémentaires et frais enregistrés, comptes contrôlés', async () => {
  let res = await comptable.put(`${R}/settings`).send({ weekly_hours: 40, overtime_tiers: [[6, 15], [null, 50]], break_minutes: 45, overtime_exempt_departments: ['direction', 'juridique'], expense_payable_account: '422100' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.break_minutes, 45);
  assert.deepEqual(res.body.overtime_exempt_departments, ['direction', 'juridique']);
  res = await comptable.put(`${R}/settings`).send({ expense_payable_account: 'abc' });
  assert.equal(res.status, 400);
  assert.equal((await exploitation.put(`${R}/settings`).send({ break_minutes: 0 })).status, 200, 'le responsable des exploitations gère les RH');
  assert.equal((await editeur.put(`${R}/settings`).send({ break_minutes: 0 })).status, 403);
});
