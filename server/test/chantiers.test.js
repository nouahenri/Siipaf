const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { lotInZone, phaseState, worksiteProgress, phaseRefusal } = require('../src/lib/domain');

let db, app, admin, conducteur, comptable, commercial, editeur, ids, project, other;
const URL = '/api/admin/erp/chantiers';
const insertedId = r => (typeof r === 'object' ? r.id : r);
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  other = await db('projects').where({ slug: 'riviera' }).first();
  await db('lots').insert([
    { project_id: project.id, code: 'A1', ilot: 'A', status: 'disponible' }, { project_id: project.id, code: 'A2', ilot: 'A', status: 'vendu' },
    { project_id: project.id, code: 'B1', ilot: 'B', status: 'disponible' }, { project_id: other.id, code: 'R1', ilot: 'A', status: 'disponible' },
  ]);
});
after(() => db.destroy());

test('règles : zone d’un chantier, état et avancement des phases, enchaînements refusés', () => {
  const lot = { id: 7, project_id: 1, ilot: 'A', building_id: 3 };
  assert.equal(lotInZone({ project_id: 1, zone_kind: 'programme' }, lot), true);
  assert.equal(lotInZone({ project_id: 2, zone_kind: 'programme' }, lot), false, 'autre programme');
  assert.equal(lotInZone({ project_id: 1, zone_kind: 'ilots', zone: ['B'] }, lot), false);
  assert.equal(lotInZone({ project_id: 1, zone_kind: 'ilots', zone: ['A'] }, lot), true);
  assert.equal(lotInZone({ project_id: 1, zone_kind: 'batiments', zone: [3] }, lot), true);
  assert.equal(lotInZone({ project_id: 1, zone_kind: 'lots', zone: [8] }, lot), false);

  assert.equal(phaseState({ planned_start: '2026-10-01', planned_end: '2026-10-20' }, '2026-09-30').state, 'a_venir');
  assert.deepEqual(phaseState({ planned_start: '2026-10-01', planned_end: '2026-10-20' }, '2026-10-05'), { state: 'en_retard', late_days: 4 }, 'pas démarrée à la date prévue');
  assert.equal(phaseState({ planned_start: '2026-10-01', planned_end: '2026-10-20', actual_start: '2026-10-02' }, '2026-10-05').state, 'en_cours');
  assert.deepEqual(phaseState({ planned_end: '2026-10-20', actual_start: '2026-10-02' }, '2026-10-25'), { state: 'en_retard', late_days: 5 });
  assert.deepEqual(phaseState({ planned_end: '2026-10-20', actual_end: '2026-10-23' }, '2026-11-01'), { state: 'termine', late_days: 3 });

  assert.equal(worksiteProgress([]), 0);
  // 10 jours à 100 %, 30 jours à 0 % → 25 %
  assert.equal(worksiteProgress([{ planned_start: '2026-10-01', planned_end: '2026-10-10', progress_pct: 100 }, { planned_start: '2026-10-11', planned_end: '2026-11-09', progress_pct: 0 }]), 25);

  assert.match(phaseRefusal({ planned_start: '2026-10-10', planned_end: '2026-10-01' }), /précède/);
  assert.match(phaseRefusal({ actual_end: '2026-10-10' }), /début réel/);
  assert.match(phaseRefusal({ depends_on_id: 9 }, [{ id: 1 }]), /même chantier/);
  assert.match(phaseRefusal({ id: 1, depends_on_id: 2 }, [{ id: 2, depends_on_id: 1 }]), /boucle/);
  assert.equal(phaseRefusal({ id: 3, depends_on_id: 2 }, [{ id: 2, depends_on_id: 1 }, { id: 1 }]), null);
});

test('chantiers : création par le conducteur avec ses phases, zone contrôlée, visibilité selon les droits', async () => {
  assert.equal((await editeur.post(URL).send({ project_id: project.id, name: 'Essai' })).status, 403);
  assert.equal((await conducteur.post(URL).send({ project_id: project.id, name: 'Tranche 1', zone_kind: 'ilots', zone: [] })).status, 400, 'zone vide');
  assert.equal((await conducteur.post(URL).send({ project_id: project.id, name: 'Tranche 1', zone_kind: 'ilots', zone: ['Z'] })).status, 400, 'îlot inconnu');
  const r1 = await db('lots').where({ project_id: other.id, code: 'R1' }).first();
  assert.equal((await conducteur.post(URL).send({ project_id: project.id, name: 'Tranche 1', zone_kind: 'lots', zone: [r1.id] })).status, 400, 'lot d’un autre programme');

  const res = await conducteur.post(URL).send({
    project_id: project.id, name: 'Tranche 1 — îlot A', zone_kind: 'ilots', zone: ['A'], manager_id: ids.conducteur_travaux,
    planned_start: day(-10), planned_end: day(120), stages: ['vrd', 'terrassement', 'fondations'],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const w = res.body;
  assert.match(w.reference, /^CH-\d{4}-0001$/);
  assert.deepEqual(w.phases.map(p => p.stage), ['terrassement', 'vrd', 'fondations'], 'dans l’ordre du journal de chantier');
  assert.equal(w.zone_label, 'Îlot A');
  assert.deepEqual(w.lots, { total: 2, sold: 1, codes: ['A1', 'A2'] });
  assert.equal(w.can_manage, true);

  // Deux chantiers dans le même programme
  const b = await conducteur.post(URL).send({ project_id: project.id, name: 'Tranche 2 — îlot B', zone_kind: 'ilots', zone: ['B'] });
  assert.equal(b.status, 201);
  assert.equal((await conducteur.get(`${URL}?project_id=${project.id}`)).body.length, 2);

  // Comptable : lecture seule ; éditeur : rien
  assert.equal((await comptable.get(`${URL}/${w.id}`)).status, 200);
  assert.equal((await comptable.patch(`${URL}/${w.id}`).send({ name: 'Autre nom' })).status, 403);
  assert.deepEqual((await editeur.get(URL)).body, []);
  assert.equal((await editeur.get(`${URL}/${w.id}`)).status, 404);

  // Un commercial nommé conducteur gère son chantier sans le droit, mais ne change pas le conducteur
  assert.equal((await admin.patch(`${URL}/${b.body.id}`).send({ manager_id: ids.commercial })).status, 200);
  const notif = await db('notifications').where({ user_id: ids.commercial, event: 'chantier.conducteur' }).first();
  assert.ok(notif, 'le conducteur nommé est prévenu');
  assert.deepEqual((await commercial.get(URL)).body.map(x => x.id), [b.body.id], 'il ne voit que le sien');
  assert.equal((await commercial.patch(`${URL}/${b.body.id}`).send({ status: 'en_cours', actual_start: day(-2) })).status, 200);
  assert.equal((await commercial.patch(`${URL}/${b.body.id}`).send({ manager_id: ids.conducteur_travaux })).status, 403);
  assert.equal((await commercial.patch(`${URL}/${w.id}`).send({ name: 'x y' })).status, 404);
  assert.equal((await commercial.patch(`${URL}/${b.body.id}`).send({ planned_start: day(10), planned_end: day(1) })).status, 400, 'fin avant début');
});

test('phases : dates, avancement, phase précédente, suppression qui raccorde l’enchaînement', async () => {
  const w = (await conducteur.get(URL)).body.find(x => x.name.startsWith('Tranche 1'));
  const url = `${URL}/${w.id}/phases`;
  let d = (await conducteur.get(`${URL}/${w.id}`)).body;
  const [terr, vrd, fond] = d.phases;

  assert.equal((await conducteur.patch(`${url}/${vrd.id}`).send({ planned_start: day(5), planned_end: day(1) })).status, 400);
  assert.equal((await conducteur.patch(`${url}/${terr.id}`).send({ depends_on_id: fond.id })).status, 200);
  assert.match((await conducteur.patch(`${url}/${fond.id}`).send({ depends_on_id: terr.id })).body.error, /boucle/);
  await conducteur.patch(`${url}/${terr.id}`).send({ depends_on_id: null });

  let res = await conducteur.patch(`${url}/${terr.id}`).send({ planned_start: day(-10), planned_end: day(-3), progress_pct: 100 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  let p = res.body.phases.find(x => x.id === terr.id);
  assert.equal(p.state, 'termine');
  assert.equal(p.actual_end, day(0), '100 % termine la phase aujourd’hui');
  assert.equal(p.late_days, 3);

  res = await conducteur.patch(`${url}/${vrd.id}`).send({ planned_start: day(-3), planned_end: day(-1), depends_on_id: terr.id, progress_pct: 40 });
  p = res.body.phases.find(x => x.id === vrd.id);
  assert.equal(p.state, 'en_retard');
  assert.equal(p.actual_start, day(0), 'un avancement démarre la phase');
  assert.equal(res.body.late_phases, 1);
  await conducteur.patch(`${url}/${fond.id}`).send({ planned_start: day(0), planned_end: day(30), depends_on_id: vrd.id });

  res = await conducteur.post(url).send({ label: 'Clôture du chantier', planned_start: day(31), planned_end: day(35) });
  assert.equal(res.status, 201);
  assert.equal(res.body.phases.at(-1).stage, null, 'phase libre');

  // Supprimer la VRD : les fondations suivent désormais le terrassement
  res = await conducteur.delete(`${url}/${vrd.id}`);
  assert.equal(res.body.phases.find(x => x.id === fond.id).depends_on_id, terr.id);

  // Ordre des phases
  const order = res.body.phases.map(x => x.id).reverse();
  assert.equal((await conducteur.put(`${url}/ordre`).send({ ids: order.slice(1) })).status, 400, 'ordre incomplet');
  res = await conducteur.put(`${url}/ordre`).send({ ids: order });
  assert.deepEqual(res.body.phases.map(x => x.id), order);

  const badges = (await conducteur.get(`${URL}/badges`)).body;
  assert.equal(badges.mine, 1);
  assert.ok(badges.open >= 2);
});

test('tâches et budget : Kanban, employé prévenu, totaux par poste, chantier vide seul supprimé', async () => {
  const w = (await conducteur.get(URL)).body.find(x => x.name.startsWith('Tranche 1'));
  const empId = insertedId((await db('employees').insert({ hire_date: '2024-01-01', job_title: 'Chef d’équipe', base_salary: 250000, department: 'technique', matricule: 'E-9', last_name: 'Kouassi', first_name: 'Jean', user_id: ids.editeur }))[0]);
  const phase = (await conducteur.get(`${URL}/${w.id}`)).body.phases[0];

  assert.equal((await conducteur.post(`${URL}/${w.id}/taches`).send({ title: 'Coffrage', start_on: day(5), due_on: day(1) })).status, 400);
  let res = await conducteur.post(`${URL}/${w.id}/taches`).send({ title: 'Implantation des bornes', phase_id: phase.id, employee_id: empId, due_on: day(-1), milestone: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const task = res.body.tasks[0];
  assert.equal(task.late, true);
  assert.equal(task.employee_name, 'Kouassi Jean');
  assert.ok(await db('notifications').where({ user_id: ids.editeur, event: 'chantier.tache' }).first(), 'l’employé est prévenu');

  res = await conducteur.patch(`${URL}/${w.id}/taches/${task.id}`).send({ status: 'fait' });
  assert.equal(res.body.tasks[0].done_on, day(0));
  assert.equal(res.body.tasks[0].late, false);
  res = await conducteur.patch(`${URL}/${w.id}/taches/${task.id}`).send({ status: 'en_cours' });
  assert.equal(res.body.tasks[0].done_on, null);

  res = await conducteur.post(`${URL}/${w.id}/budget`).send({ category: 'materiaux', label: 'Ciment et acier', amount_fcfa: 12000000 });
  assert.equal(res.status, 201);
  await conducteur.post(`${URL}/${w.id}/budget`).send({ category: 'materiaux', label: 'Sable et gravier', amount_fcfa: 3000000 });
  res = await conducteur.post(`${URL}/${w.id}/budget`).send({ category: 'sous_traitance', label: 'Lot VRD', amount_fcfa: 25000000, phase_id: phase.id });
  assert.equal(res.body.budget_fcfa, 40000000);
  assert.equal(res.body.budget_by_category.find(c => c.category === 'materiaux').amount_fcfa, 15000000);
  const line = res.body.budget_lines[0];
  res = await conducteur.patch(`${URL}/${w.id}/budget/${line.id}`).send({ amount_fcfa: 10000000 });
  assert.equal(res.body.budget_fcfa, 38000000);
  assert.equal((await comptable.post(`${URL}/${w.id}/budget`).send({ category: 'autre', label: 'Essai', amount_fcfa: 1 })).status, 403);

  assert.equal((await conducteur.delete(`${URL}/${w.id}`)).status, 409, 'un chantier avec des tâches se clôt');
  const empty = await conducteur.post(URL).send({ project_id: other.id, name: 'Chantier à supprimer' });
  assert.equal((await conducteur.delete(`${URL}/${empty.body.id}`)).status, 204);
});

test('listes réglables : postes du budget et météo ; poste système protégé, élément utilisé désactivé et non supprimé', async () => {
  const w = (await conducteur.get(URL)).body.find(x => x.name.startsWith('Tranche 1'));
  const R = `${URL}/reglages/listes`;
  assert.equal((await comptable.post(R).send({ kind: 'poste', label: 'Études et honoraires' })).status, 403);
  let res = await conducteur.post(R).send({ kind: 'poste', label: 'Études et honoraires' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const item = res.body.find(i => i.label === 'Études et honoraires');
  assert.equal(item.code, 'etudes_et_honoraires');
  assert.equal((await conducteur.post(R).send({ kind: 'poste', label: 'études et honoraires' })).status, 409, 'doublon');
  res = await conducteur.post(`${URL}/${w.id}/budget`).send({ category: item.code, label: 'Bureau de contrôle', amount_fcfa: 1500000 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.budget_by_category.find(c => c.category === item.code).label, 'Études et honoraires');
  assert.equal((await conducteur.post(`${URL}/${w.id}/budget`).send({ category: 'inconnu', label: 'X y', amount_fcfa: 1 })).status, 400);

  assert.equal((await conducteur.delete(`${R}/${item.id}`)).status, 409, 'utilisé : se désactive');
  res = await conducteur.patch(`${R}/${item.id}`).send({ active: false, label: 'Études, honoraires' });
  assert.equal(res.status, 200);
  const refs = (await conducteur.get(`${URL}/refs`)).body;
  assert.equal(refs.budget_categories[item.code], undefined, 'plus proposé');
  assert.equal(refs.budget_labels[item.code], 'Études, honoraires', 'libellé gardé pour l’existant');
  assert.equal((await conducteur.post(`${URL}/${w.id}/budget`).send({ category: item.code, label: 'Autre ligne', amount_fcfa: 1 })).status, 400, 'désactivé : refusé pour une nouvelle ligne');

  const mo = refs.lists.poste.find(p => p.code === 'main_oeuvre');
  assert.equal((await conducteur.patch(`${R}/${mo.id}`).send({ active: false })).status, 409);
  assert.equal((await conducteur.delete(`${R}/${mo.id}`)).status, 409);
  assert.equal((await conducteur.patch(`${R}/${mo.id}`).send({ label: 'Main-d’œuvre pointée' })).status, 200, 'renommable');

  res = await conducteur.post(R).send({ kind: 'meteo', label: 'Harmattan' });
  const harmattan = res.body.find(i => i.label === 'Harmattan');
  assert.equal((await conducteur.delete(`${R}/${harmattan.id}`)).status, 200, 'jamais utilisé : supprimé');
  const ordre = refs.lists.meteo.map(m => m.id).reverse();
  res = await conducteur.put(`${R}/meteo/ordre`).send({ ids: ordre });
  assert.deepEqual(res.body.map(m => m.id), ordre);
});
