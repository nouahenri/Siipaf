const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { budgetAlertLevel } = require('../src/lib/domain');
const chantiers = require('../src/services/chantiers');

let db, app, admin, comptable, conducteur, commercial, ids, project, other, siege, worksite, supplier;
const C = '/api/admin/erp/compta';
const L = '/api/admin/erp/lieux';
const W = '/api/admin/erp/chantiers';
const year = new Date().getUTCFullYear();
const today = new Date().toISOString().slice(0, 10);
const insertedId = r => (typeof r === 'object' ? r.id : r);

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  other = await db('projects').where({ slug: 'riviera' }).first();
  siege = (await db('places').where({ kind: 'siege' }).first()).id;
  await comptable.post(`${C}/fiscal-years`).send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` });
  supplier = (await comptable.post(`${C}/suppliers`).send({ name: 'Quincaillerie du Plateau', expense_account: '621100' })).body;
  worksite = (await conducteur.post(W).send({ project_id: project.id, name: 'Tranche 1', manager_id: ids.conducteur_travaux })).body;
});
after(() => db.destroy());

test('lieux : siège unique et permanent, gérés par la Comptabilité et l’Administration générale', async () => {
  assert.equal((await commercial.post(L).send({ kind: 'annexe', name: 'Bureau de Yamoussoukro' })).status, 403);
  let res = await comptable.post(L).send({ kind: 'annexe', name: 'Bureau de Yamoussoukro' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await comptable.post(L).send({ kind: 'siege', name: 'Autre siège' })).status, 409, 'un seul siège');
  // Ville et localité : listes de référence du dashboard, la localité appartient à la ville
  const city = insertedId((await db('ref_items').insert({ kind: 'ville', label: 'Yamoussoukro' }))[0]);
  const otherCity = insertedId((await db('ref_items').insert({ kind: 'ville', label: 'Bouaké' }))[0]);
  const loc = insertedId((await db('ref_items').insert({ kind: 'localisation', label: 'Habitat', parent_id: city }))[0]);
  const bureau = (await db('places').where({ name: 'Bureau de Yamoussoukro' }).first()).id;
  assert.equal((await comptable.patch(`${L}/${bureau}`).send({ city_id: otherCity, location_id: loc })).status, 400, 'localité d’une autre ville');
  res = await comptable.patch(`${L}/${bureau}`).send({ city_id: city, location_id: loc });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const saved = res.body.find(p => p.id === bureau);
  assert.deepEqual([saved.city_label, saved.location_label], ['Yamoussoukro', 'Habitat']);
  const form = (await comptable.get(`${L}?tous=1`)).body;
  assert.ok(form.cities.some(c => c.id === city) && form.locations.some(l => l.id === loc && l.city_id === city));
  assert.equal((await comptable.post(L).send({ kind: 'autre', name: 'Logement' })).status, 400, 'type « autre » précisé');
  assert.equal((await comptable.patch(`${L}/${siege}`).send({ active: false })).status, 409);
  assert.equal((await comptable.delete(`${L}/${siege}`)).status, 409);
  const choix = (await commercial.get(`${L}/choix`)).body;
  assert.equal(choix.siege_id, siege);
  assert.ok(choix.places.some(p => p.name === 'Bureau de Yamoussoukro'));
  assert.ok(choix.programmes.find(p => p.id === project.id).worksites.some(w => w.id === worksite.id), 'les chantiers sont proposés sous leur programme');
});

test('achats : siège par défaut, lieu ou programme mais pas les deux, chantier qui fixe le programme, axe analytique', async () => {
  const base = { supplier_id: supplier.id, date: `${year}-03-01`, label: 'Fournitures', expense_account: '621100', amount_ttc: 118000, vat_rate: 18 };
  let res = await comptable.post(`${C}/purchases`).send(base);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.place_id, siege, 'sans affectation : le siège');
  const bureau = (await db('places').where({ name: 'Bureau de Yamoussoukro' }).first()).id;
  assert.equal((await comptable.post(`${C}/purchases`).send({ ...base, project_id: project.id, place_id: bureau })).status, 400);
  assert.equal((await comptable.post(`${C}/purchases`).send({ ...base, project_id: other.id, worksite_id: worksite.id })).status, 400, 'chantier hors du programme');
  res = await comptable.post(`${C}/purchases`).send({ ...base, label: 'Ciment', worksite_id: worksite.id, amount_ttc: 2360000 });
  assert.equal(res.body.project_id, project.id);
  assert.equal(res.body.worksite_category, 'materiaux');
  const cement = res.body;
  res = await comptable.post(`${C}/purchases`).send({ ...base, label: 'Loyer du bureau', place_id: bureau });
  assert.equal(res.body.place_id, bureau);
  assert.equal((await comptable.post(`${C}/purchases/${res.body.id}/validate`)).status, 200);
  const entry = await db('acc_entries').where({ source_key: `purchase:${res.body.id}` }).first();
  assert.equal(entry.place_id, bureau);
  assert.ok((await db('acc_lines').where({ entry_id: entry.id })).every(l => l.place_id === bureau && !l.project_id));
  const margins = (await comptable.get(`${C}/reports/margins?from=${year}-01-01&to=${year}-12-31&draft=1`)).body;
  const rows = margins.rows || margins;
  assert.ok(rows.some(r => r.kind === 'lieu' && r.place_id === bureau && r.charges === 100000), JSON.stringify(rows));
  // Modifier un brouillon sans renvoyer l'affectation la garde
  res = await comptable.patch(`${C}/purchases/${cement.id}`).send({ label: 'Ciment CPJ 45' });
  assert.equal(res.body.worksite_id, worksite.id);
});

test('coûts réels du chantier : achats, parc et main-d’œuvre pointée ; alerte de budget une fois par seuil', async () => {
  assert.equal(budgetAlertLevel(80, 100, 90), null);
  assert.equal(budgetAlertLevel(90, 100, 90), 'seuil');
  assert.equal(budgetAlertLevel(101, 100, 90), 'depasse');
  assert.equal(budgetAlertLevel(10, 0, 90), null);

  // Ouvrier journalier : taux de chantier saisi ; chef d'équipe : taux tiré du salaire
  const base = { hire_date: '2024-01-01', department: 'chantier' };
  const daily = insertedId((await db('employees').insert({ ...base, matricule: 'J-1', last_name: 'Koffi', first_name: 'Ali', job_title: 'Manœuvre', base_salary: 0, site_hourly_rate: 1000 }))[0]);
  const chief = insertedId((await db('employees').insert({ ...base, matricule: 'J-2', last_name: 'Yao', first_name: 'Ben', job_title: 'Chef d’équipe', base_salary: 346000 }))[0]);
  let res = await comptable.post('/api/admin/erp/rh/attendance/sheet').send({ date: today, worksite_id: worksite.id, rows: [daily, chief].map(employee_id => ({ employee_id, periods: [['07:00', '12:00'], ['13:00', '16:00']] })) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const a = await db('hr_attendances').where({ employee_id: daily }).first();
  assert.deepEqual([a.project_id, a.worksite_id, a.place_id], [project.id, worksite.id, null]);

  await conducteur.post(`${W}/${worksite.id}/budget`).send({ category: 'materiaux', label: 'Ciment', amount_fcfa: 2500000 });
  res = await conducteur.get(`${W}/${worksite.id}`);
  const c = res.body.costs;
  assert.equal(c.by_category.materiaux, 2000000, 'facture de ciment HT');
  const labor = c.labor.find(l => l.employee_id === daily);
  assert.deepEqual([labor.hours, labor.rate, labor.source, labor.amount_fcfa], [8, 1000, 'fiche', 8000]);
  const chiefRow = c.labor.find(l => l.employee_id === chief);
  assert.equal(chiefRow.source, 'salaire');
  assert.ok(chiefRow.rate > 2000, 'coût employeur ÷ 173 h');
  assert.equal(res.body.spent_fcfa, c.total);
  assert.equal(res.body.budget_by_category.find(x => x.category === 'materiaux').spent_fcfa, 2000000);

  // 2 000 000 + main-d'œuvre sur 2 500 000 : sous le seuil de 90 %, puis au-delà avec un deuxième achat
  assert.equal(await chantiers.tick(db), 0);
  await comptable.post(`${C}/purchases`).send({ supplier_id: supplier.id, date: today, label: 'Fer à béton', expense_account: '621100', amount_ttc: 472000, vat_rate: 18, worksite_id: worksite.id });
  assert.ok(await chantiers.tick(db) > 0);
  assert.ok(await db('notifications').where({ user_id: ids.conducteur_travaux, event: 'budget.depasse' }).first());
  assert.equal(await chantiers.tick(db), 0, 'une seule fois par seuil');
  assert.ok((await conducteur.get(W)).body.find(w => w.id === worksite.id).consumed_pct >= 90);

  // Réglages : seuil et heures mensuelles, dans les bornes
  assert.equal((await conducteur.put(`${W}/reglages`).send({ chantier_budget_alert_pct: 20 })).status, 400);
  res = await conducteur.put(`${W}/reglages`).send({ chantier_budget_alert_pct: 80, chantier_monthly_hours: 200 });
  assert.deepEqual(res.body, { chantier_budget_alert_pct: 80, chantier_monthly_hours: 200 });
  assert.equal((await commercial.put(`${W}/reglages`).send({ chantier_budget_alert_pct: 80 })).status, 403);
});
