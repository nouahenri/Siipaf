const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { compute, computeService } = require('../src/services/performance');
const { parsePeriod } = require('../src/lib/rh');

let db, app, comptable, commercial, exploitation, awa, yao, mariam, kpis;
const R = '/api/admin/erp/rh';
const P = '/api/admin/erp/paie';
const Y = new Date().getUTCFullYear();
const NEXT = Y + 1;
const kpi = metric => kpis.find(k => k.metric === metric);

before(async () => {
  ({ db, app } = await setup());
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  exploitation = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  const user = email => db('users').where({ email }).first();
  const hire = async body => {
    const res = await comptable.post(`${P}/employees`).send({ gender: 'F', hire_date: '2024-01-01', base_salary: 300000, ...body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  awa = await hire({ last_name: 'Koné', first_name: 'Awa', job_title: 'Commerciale', department: 'commercial', user_id: (await user('commercial@test.ci')).id });
  yao = await hire({ last_name: 'Yao', first_name: 'Paul', gender: 'M', job_title: 'Commercial terrain', department: 'commercial' });
  mariam = await hire({ last_name: 'Diallo', first_name: 'Mariam', job_title: 'Comptable', department: 'comptabilite', user_id: (await user('comptable@test.ci')).id });
});
after(() => db.destroy());

test('référentiel : indicateurs repris, droit kpi:write, doublons et niveaux contrôlés', async () => {
  let res = await commercial.get(`${R}/kpis`);
  assert.equal(res.status, 200, 'lecture ouverte (formulaires des responsables)');
  kpis = res.body.kpis;
  assert.ok(kpi('ca_fcfa') && kpi('cpt_cloture') && kpi('adm_courriers_delai'));
  assert.equal(kpi('cpt_cloture').level, 'service');
  assert.equal(kpi('ca_fcfa').level, 'tous');
  assert.equal(res.body.collective_pct, 50);

  const manual = { name: 'Qualité des dossiers', family: 'Tous services', metric: 'manuel', level: 'individuel' };
  assert.equal((await commercial.post(`${R}/kpis`).send(manual)).status, 403);
  res = await comptable.post(`${R}/kpis`).send(manual);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await exploitation.post(`${R}/kpis`).send({ ...manual, name: 'qualite des DOSSIERS' })).status, 409, 'doublon, accents et majuscules compris');
  assert.equal((await comptable.post(`${R}/kpis`).send({ name: 'CA bis', family: 'Commercial', metric: 'ca_fcfa' })).status, 409, 'un seul indicateur par calcul');
  assert.equal((await comptable.patch(`${R}/kpis/${kpi('cpt_cloture').id}`).send({ level: 'tous' })).status, 400, 'mesuré sur le service entier');
  assert.equal((await comptable.patch(`${R}/kpis/${kpi('ca_fcfa').id}`).send({ warn_pct: 90, ok_pct: 80 })).status, 400);
  res = await comptable.patch(`${R}/kpis/${kpi('ca_fcfa').id}`).send({ name: 'CA signé (VEFA et terrains)', warn_pct: 60 });
  assert.equal(res.body.name, 'CA signé (VEFA et terrains)');
  kpis = (await comptable.get(`${R}/kpis`)).body.kpis;
});

test('modèles : service puis poste, aperçu, application, réapplication sans écraser un ajustement', async () => {
  const quality = kpis.find(k => k.name === 'Qualité des dossiers');
  const posteAwa = (await db('employees').where({ id: awa.id }).first()).position_id;
  let res = await comptable.put(`${R}/kpi-templates`).send({ scope: 'service', department: 'commercial', lines: [{ kpi_id: kpi('cpt_cloture').id, period: 'annee', target_value: 100 }] });
  assert.equal(res.status, 400, 'indicateur de service : objectif collectif seulement');
  res = await comptable.put(`${R}/kpi-templates`).send({ scope: 'service', department: 'commercial', lines: [{ kpi_id: kpi('ca_fcfa').id, period: 'mois' }] });
  assert.equal(res.status, 400, 'cible obligatoire');
  res = await comptable.put(`${R}/kpi-templates`).send({ scope: 'service', department: 'commercial', lines: [
    { kpi_id: kpi('ca_fcfa').id, period: 'mois', target_value: 10000000, weight: 2 }, { kpi_id: kpi('ca_fcfa').id, period: 'mois', target_value: 1 },
  ] });
  assert.equal(res.status, 409, 'même indicateur deux fois avec le même découpage');
  res = await comptable.put(`${R}/kpi-templates`).send({ scope: 'service', department: 'commercial', lines: [
    { kpi_id: kpi('ca_fcfa').id, period: 'mois', target_value: 10000000, weight: 2 }, { kpi_id: quality.id, period: 'annee', weight: 1 },
  ] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.services.find(s => s.department === 'commercial').lines.length, 2);
  res = await comptable.put(`${R}/kpi-templates`).send({ scope: 'poste', position_id: posteAwa, lines: [{ kpi_id: kpi('ca_fcfa').id, period: 'mois', target_value: 20000000, weight: 2 }] });
  assert.equal(res.status, 200);
  assert.equal((await commercial.put(`${R}/kpi-templates`).send({ scope: 'poste', position_id: posteAwa, lines: [] })).status, 403);

  // Aperçu pour l'an prochain (toutes les périodes) : rien n'est écrit
  res = await comptable.post(`${R}/kpi-templates/apply`).send({ scope: 'service', department: 'commercial', year: NEXT });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.confirmed, false);
  assert.equal(res.body.created, 12 + 1 + 1, 'Awa : 12 mois de CA (poste) + qualité ; Yao : qualité seulement');
  assert.ok(res.body.skipped.some(s => s.name === 'Yao Paul' && /compte/.test(s.reason)), 'CA impossible sans compte du dashboard');
  assert.equal(await db('hr_objectives').where({ year: NEXT }).count({ n: '*' }).first().then(r => Number(r.n)), 0);

  res = await comptable.post(`${R}/kpi-templates/apply`).send({ scope: 'service', department: 'commercial', year: NEXT, confirm: true });
  assert.equal(res.body.created, 14);
  const ca = await db('hr_objectives').where({ employee_id: awa.id, year: NEXT, metric: 'ca_fcfa' }).orderBy('period_index');
  assert.equal(ca.length, 12);
  assert.ok(ca.every(o => Number(o.target_value) === 20000000 && o.source === 'modele' && o.period === 'mois'), 'le poste remplace le service');
  assert.equal(ca[2].title, 'CA signé (VEFA et terrains) — mars ' + NEXT);
  const awaUser = await db('users').where({ email: 'commercial@test.ci' }).first();
  assert.ok(await db('notifications').where({ user_id: awaUser.id, event: 'objectifs.fixes' }).first(), 'l’employé est prévenu');

  res = await comptable.post(`${R}/kpi-templates/apply`).send({ scope: 'service', department: 'commercial', year: NEXT, confirm: true });
  assert.deepEqual([res.body.created, res.body.updated, res.body.unchanged], [0, 0, 14], 'réappliquer ne double rien');

  // Ajustement individuel : gardé quand le modèle change
  assert.equal((await comptable.patch(`${R}/objectives/${ca[0].id}`).send({ target_value: 5000000 })).status, 200);
  assert.equal((await db('hr_objectives').where({ id: ca[0].id }).first()).adjusted, 1);
  await comptable.put(`${R}/kpi-templates`).send({ scope: 'poste', position_id: posteAwa, lines: [{ kpi_id: kpi('ca_fcfa').id, period: 'mois', target_value: 25000000, weight: 2 }] });
  res = await comptable.post(`${R}/kpi-templates/apply`).send({ scope: 'poste', position_id: posteAwa, year: NEXT, confirm: true });
  assert.deepEqual([res.body.updated, res.body.kept, res.body.created], [11, 1, 0]);
  assert.equal(Number((await db('hr_objectives').where({ id: ca[0].id }).first()).target_value), 5000000);
  assert.equal(Number((await db('hr_objectives').where({ id: ca[1].id }).first()).target_value), 25000000);
});

test('périodes : objectifs mensuels regroupés sur l’année, un seul sur le mois, période invalide refusée', async () => {
  let res = await comptable.get(`${R}/employees/${awa.id}/objectives?annee=${NEXT}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const line = res.body.lines.find(l => l.metric === 'ca_fcfa');
  assert.equal(line.count, 12);
  assert.equal(line.target, 5000000 + 11 * 25000000, 'cibles mensuelles additionnées');
  assert.equal(line.title, 'CA signé (VEFA et terrains) — objectifs mensuels');
  assert.equal(line.warn_pct, 60, 'seuils de l’indicateur');
  assert.equal(res.body.objectives.length, 13);
  res = await comptable.get(`${R}/employees/${awa.id}/objectives?annee=${NEXT}&periode=trimestre&n=2`);
  assert.equal(res.body.lines.find(l => l.metric === 'ca_fcfa').target, 75000000);
  assert.equal(res.body.objectives.length, 4, '3 mois du trimestre + l’objectif annuel');
  res = await comptable.get(`${R}/employees/${awa.id}/objectives?annee=${NEXT}&periode=mois&n=1`);
  assert.equal(res.body.lines.find(l => l.metric === 'ca_fcfa').target, 5000000);
  assert.equal((await comptable.get(`${R}/employees/${awa.id}/objectives?annee=${NEXT}&periode=mois&n=13`)).status, 400);
  assert.equal((await comptable.get(`${R}/performance?annee=${NEXT}&periode=trimestre`)).status, 400, 'trimestre à préciser');
  assert.equal(parsePeriod({ annee: '2026', periode: 'mois', n: '2' }).to, '2026-02-28');

  // Objectif saisi à la main pour un trimestre : échéance à la fin du trimestre
  res = await comptable.post(`${R}/employees/${awa.id}/objectives`).send({ year: NEXT, title: 'RDV du T3', kpi_id: kpi('rdv').id, period: 'trimestre', period_index: 3, target_value: 30 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.due_date.slice(0, 10), `${NEXT}-09-30`);
  assert.equal((await comptable.post(`${R}/employees/${awa.id}/objectives`).send({ year: NEXT, title: 'Clôture', kpi_id: kpi('cpt_cloture').id, target_value: 100 })).status, 400, 'indicateur de service refusé pour un employé');
  assert.equal((await comptable.post(`${R}/employees/${awa.id}/objectives`).send({ year: NEXT, title: 'Mois ?', kpi_id: kpi('rdv').id, period: 'mois', target_value: 3 })).status, 400, 'mois à préciser');
});

test('nouvel arrivant : les modèles de son poste et de son service s’appliquent pour l’année en cours, à partir du mois en cours', async () => {
  const u = await createUser(db, 'commercial', 'nouveau@test.ci');
  const res = await comptable.post(`${P}/employees`).send({ last_name: 'Nouveau', first_name: 'Ange', gender: 'M', job_title: 'Commerciale', department: 'commercial', hire_date: `${Y}-01-01`, base_salary: 200000, user_id: (await db('users').where({ email: u }).first()).id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const objs = await db('hr_objectives').where({ employee_id: res.body.id, year: Y });
  const month = new Date().getUTCMonth() + 1;
  assert.equal(objs.filter(o => o.metric === 'ca_fcfa').length, 12 - month + 1, 'mois écoulés non créés après coup');
  assert.equal(objs.filter(o => o.metric === 'manuel').length, 1);
});

test('objectifs collectifs : score du service = 50 % collectif + 50 % employés, part réglable, Vue Direction', async () => {
  assert.equal((await comptable.post(`${R}/employees/${mariam.id}/objectives`).send({ year: Y, title: 'Classer les pièces', progress: 40 })).status, 201);
  const body = { department: 'comptabilite', year: Y, title: 'Clôturer chaque mois à temps', progress: 80 };
  assert.equal((await commercial.post(`${R}/department-objectives`).send(body)).status, 403);
  let res = await comptable.post(`${R}/department-objectives`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const col = res.body;
  assert.equal(col.due_date.slice(0, 10), `${Y}-12-31`);
  assert.equal((await comptable.post(`${R}/department-objectives`).send({ ...body, kpi_id: kpis.find(k => k.name === 'Qualité des dossiers').id })).status, 400, 'indicateur réservé aux employés');
  assert.equal((await comptable.post(`${R}/department-objectives`).send({ ...body, kpi_id: kpi('cpt_cloture').id })).status, 400, 'cible obligatoire');

  let rep = (await comptable.get(`${R}/performance?annee=${Y}`)).body;
  let compta = rep.departments.find(d => d.key === 'comptabilite');
  assert.deepEqual([compta.collective_score, compta.employees_score, compta.score], [80, 40, 60]);
  assert.equal(compta.collective.length, 1);
  assert.ok(compta.service_indicators.some(i => i.key === 'cpt_cloture'), 'indicateurs mesurés sur le service');
  assert.equal(rep.collective_pct, 50);

  assert.equal((await commercial.put(`${R}/kpi-settings`).send({ service_collective_pct: 100 })).status, 403);
  assert.equal((await comptable.put(`${R}/kpi-settings`).send({ service_collective_pct: 100 })).status, 200);
  rep = (await comptable.get(`${R}/performance?annee=${Y}`)).body;
  assert.equal(rep.departments.find(d => d.key === 'comptabilite').score, 80);
  await comptable.put(`${R}/kpi-settings`).send({ service_collective_pct: 50 });

  res = await comptable.patch(`${R}/department-objectives/${col.id}`).send({ progress: 100, period: 'trimestre', period_index: 4 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.period_index, 4);
  res = await exploitation.get(`/api/admin/erp/direction/performance?annee=${Y}&periode=trimestre&n=4`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  compta = res.body.departments.find(d => d.key === 'comptabilite');
  assert.equal(compta.collective_score, 100);
  assert.equal(res.body.period.label, `4e trimestre ${Y}`);
  res = await exploitation.get(`/api/admin/erp/direction/performance?annee=${Y}&periode=trimestre&n=1`);
  assert.equal(res.body.departments.find(d => d.key === 'comptabilite').collective_score, null, 'objectif du 4e trimestre hors du 1er');
  assert.equal((await commercial.get('/api/admin/erp/direction/performance')).status, 403);
  assert.equal((await comptable.delete(`${R}/department-objectives/${col.id}`)).status, 200);
});

test('indicateurs des services support : calculs individuels et de service', () => {
  const at = s => new Date(s);
  const raw = {
    e: { id: 1, department: 'administratif', hire_date: '2020-01-01' }, uid: 9, settings: { working_days: [1, 2, 3, 4, 5, 6] }, holidays: [],
    sales: [], rdv: [], payments: [], updates: [], reserves: [], interventions: [], tickets: [], site: [], leaves: [], trainings: [], portfolio: [],
    entries: [{ at: at('2026-03-10T10:00:00Z'), created_at: '2026-03-08T10:00:00Z' }, { at: at('2026-04-02T10:00:00Z'), created_at: '2026-04-01T10:00:00Z' }],
    litigations: [{ opened: '2026-01-05', closed: '2026-03-20', next: null }, { opened: '2026-02-01', closed: null, next: null }, { opened: '2026-02-01', closed: null, next: '2026-12-01' }],
    guarantees: [{ expires: '2026-02-01', status: 'active', closed: null }, { expires: '2026-02-01', status: 'liberee', closed: '2026-02-10' }],
    mails: [{ at: at('2026-03-05T09:00:00Z'), due_date: '2026-03-05', assigned_at: '2026-03-01T09:00:00Z' }, { at: at('2026-03-09T09:00:00Z'), due_date: '2026-03-06', assigned_at: '2026-03-03T09:00:00Z' }],
    requests: [{ at: at('2026-03-12T09:00:00Z'), created_at: '2026-03-01T09:00:00Z', manager_at: '2026-03-02T09:00:00Z', dg_at: null }],
    actions: [{ at: at('2026-03-01T09:00:00Z'), due_date: '2026-03-02' }, { at: at('2026-03-04T09:00:00Z'), due_date: null }],
  };
  const v = compute(raw, '2026-03-01', '2026-03-31', at('2026-10-27T12:00:00Z'));
  assert.equal(v.cpt_ecritures, 1);
  assert.equal(v.cpt_delai_valid, 2);
  assert.equal(v.jur_contentieux_clos, 1);
  assert.equal(v.jur_sans_echeance, 1, 'ouvert sans prochaine date au 31 mars');
  assert.equal(v.jur_garanties_echues, 1, 'la garantie libérée le 10/02 est traitée');
  assert.equal(v.adm_courriers_delai, 50);
  assert.equal(v.adm_courriers_duree, 5, '4 et 6 jours');
  assert.equal(v.adm_demandes_ok, 1);
  assert.equal(v.adm_demandes_duree, 10, 'depuis la validation du responsable');
  assert.equal(v.adm_actions_delai, 100, 'action sans échéance non comptée');
  assert.equal(v.cpt_cloture, null, 'indicateur de service : pas de valeur individuelle');

  const sraw = {
    closeDay: 10,
    locks: [{ lock: '2026-01-31', at: at('2026-02-08T10:00:00Z') }, { lock: '2026-02-28', at: at('2026-03-15T10:00:00Z') }, { lock: '2026-03-31', at: at('2026-04-10T18:00:00Z') }],
    invoices: [{ due: '2026-03-10', settled: '2026-03-09' }, { due: '2026-03-20', settled: '2026-03-25' }, { due: '2026-03-25', settled: null }],
    runs: [{ period: '2026-01', validated: at('2026-01-30T10:00:00Z') }, { period: '2026-02', validated: at('2026-03-02T10:00:00Z') }],
    files: [{ reserved: '2026-01-01', handed: '2026-03-02' }, { reserved: null, handed: '2026-03-15' }],
    plans: [{ months: 6, last: '2026-01-15' }, { months: 3, last: '2025-10-01' }, { months: 6, last: null }],
  };
  const s = computeService(sraw, '2026-01-01', '2026-03-31', at('2026-04-30T12:00:00Z'));
  assert.equal(s.cpt_cloture, 66.7, 'janvier et mars à temps, février en retard');
  assert.equal(s.cpt_fourn_echeance, 33.3);
  assert.equal(s.cpt_fourn_retard, Math.round(((0 + 5 + 36) / 3) * 10) / 10, 'facture impayée : retard jusqu’à aujourd’hui');
  assert.equal(s.cpt_paie_a_temps, Math.round((1 / 3) * 1000) / 10, 'mars sans paie : en retard');
  assert.equal(s.jur_actes_remis, 2);
  assert.equal(s.jur_delai_acte, 60);
  assert.equal(s.adm_parc_entretiens, 33.3, 'un plan à jour sur trois au 31 mars');
});

test('Comptabilité : verrouillage daté, jour de clôture réglable', async () => {
  let res = await comptable.post('/api/admin/erp/compta/fiscal-years').send({ label: String(Y), start_date: `${Y}-01-01`, end_date: `${Y}-12-31` });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  res = await comptable.patch(`/api/admin/erp/compta/fiscal-years/${res.body.id}`).send({ lock_date: `${Y}-01-31` });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const h = await db('acc_lock_history').first();
  assert.equal(String(h.lock_date).slice(0, 10), `${Y}-01-31`);
  assert.equal((await comptable.get('/api/admin/erp/compta/settings')).body.close_day, 10);
  assert.equal((await comptable.put('/api/admin/erp/compta/settings').send({ close_day: 31 })).status, 400);
  assert.equal((await comptable.put('/api/admin/erp/compta/settings').send({ close_day: 5 })).body.close_day, 5);
});
