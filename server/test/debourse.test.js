const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { bases, unitCost, estimate, checkParams } = require('../src/lib/debourse');

// Déboursé sec (docs/cadrage-debourse-sec.md) : moteur de calcul, référentiels réglables, estimations, report au budget
let db, app, admin, conducteur, editeur, refs, worksite;
const D = '/api/admin/erp/chantiers/debourse';
const villa = { surface: 120, emprise: 140, perimetre: 48, murs_interieurs: 36, hauteur: 3, niveaux: 1, ouvertures: 20, logements: 1 };

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  const [project] = await db('projects').insert({ name: 'Programme essai', slug: 'programme-essai' });
  const res = await admin.post('/api/admin/erp/chantiers').send({ project_id: typeof project === 'object' ? project.id : project, name: 'Villas tranche 1' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  worksite = res.body.worksite || res.body;
  refs = (await admin.get(`${D}/refs`)).body;
});
after(() => db.destroy());

test('moteur : bases de métré, sous-détail d’un béton armé, totaux, toiture facultative, coût de revient', () => {
  const b = bases(villa);
  assert.equal(b.lineaire_fondations, 84);
  assert.equal(b.surface_murs, 201.6, '84 ml × 3 m × 1 niveau × 80 % (ouvertures déduites)');
  assert.equal(bases({ ...villa, niveaux: 2 }).planchers_intermediaires, 140);
  // 1 m³ de béton dosé à 350 kg/m³ : 7 sacs à 5 000 F (+3 % de perte), 0,4 m³ de sable à 12 000 F (+10 %), 2 h de maçon à 1 000 F
  const u = unitCost([
    { nature: 'materiau', quantity: 7, unit_price: 5000, loss_pct: 3 }, { nature: 'materiau', quantity: 0.4, unit_price: 12000, loss_pct: 10 },
    { nature: 'main_oeuvre', quantity: 2, unit_price: 1000 }, { nature: 'materiel', quantity: 0.1, unit_price: 15000 },
  ]);
  assert.equal(Math.round(u.materiau), 36050 + 5280);
  assert.equal(u.main_oeuvre, 2000);
  assert.equal(u.materiel, 1500);
  const lines = [
    { key: 'a', lot: 'fondations', label: 'Béton', unit: 'm3', quantity: 10, composition: [{ code: 'CIM', label: 'Ciment', nature: 'materiau', unit: 'sac', quantity: 7, unit_price: 5000, loss_pct: 0 }] },
    { key: 'b', lot: 'toiture', label: 'Couverture', unit: 'm2', quantity: 100, composition: [{ code: 'TOLE', label: 'Tôle', nature: 'materiau', unit: 'm2', quantity: 1, unit_price: 8000, loss_pct: 0 }] },
  ];
  const sans = estimate({ lines, units: 2, withRoof: false, rates: { site_pct: 10, contingency_pct: 5 }, params: { surface: 100, logements: 1 } });
  assert.equal(sans.dry_cost, 700000, '10 m³ × 35 000 F × 2 bâtiments ; toiture non comptée');
  assert.equal(sans.cost_price, 805000);
  assert.equal(sans.per_m2, 3500);
  assert.equal(sans.resources[0].quantity, 140, '7 sacs × 10 m³ × 2 bâtiments');
  const avec = estimate({ lines, units: 1, withRoof: true, params: { surface: 100 } });
  assert.equal(avec.dry_cost, 350000 + 800000);
  assert.deepEqual(avec.lots.map(l => l.lot), ['fondations', 'toiture']);
  assert.ok(checkParams({ ...villa, niveaux: 1.5 }).length, 'niveaux entiers');
  assert.ok(checkParams({ ...villa, hauteur: 9 }).length, 'hauteur bornée');
  assert.equal(checkParams(villa).length, 0);
});

test('référentiels de départ : ressources aux prix « à vérifier », ouvrages composés, trois modèles', async () => {
  assert.equal((await editeur.get(`${D}/refs`)).status, 403);
  assert.ok(refs.resources.length >= 20);
  assert.ok(refs.resources.every(r => !r.price_checked), 'prix indicatifs à vérifier');
  assert.equal(refs.resources.find(r => r.code === 'CIM-42').unit_price, 5000);
  const sem = refs.works.find(w => w.code === 'SEM');
  assert.equal(sem.lot, 'fondations');
  assert.ok(sem.unit_cost > 100000 && sem.unit_cost < 200000, `béton armé des semelles : ${sem.unit_cost} F/m³`);
  assert.deepEqual(refs.models.map(m => m.label), ['Villa basse', 'Duplex (R+1)', 'Immeuble d’appartements (R+3)']);
  assert.ok(refs.units.some(u => u.code === 'h') && refs.units.some(u => u.code === 'j'), 'heure et jour ajoutés aux unités');
  assert.equal(refs.rates.site_pct, 8);
});

test('référentiels réglables : ressource, ouvrage, modèle ; une ressource utilisée ne se supprime pas', async () => {
  assert.equal((await editeur.post(`${D}/ressources`).send({ code: 'X', nature: 'materiau', label: 'Essai', unit: 'u', unit_price: 1, loss_pct: 0 })).status, 403, 'réglage : chantiers:settings');
  let res = await admin.post(`${D}/ressources`).send({ code: 'BRIQ', nature: 'materiau', label: 'Brique de terre cuite', unit: 'u', unit_price: 250, loss_pct: 5, price_checked: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const briq = res.body.find(r => r.code === 'BRIQ');
  assert.equal((await admin.post(`${D}/ressources`).send({ code: 'briq', nature: 'materiau', label: 'Doublon', unit: 'u', unit_price: 1, loss_pct: 0 })).status, 409);
  assert.equal((await admin.post(`${D}/ressources`).send({ code: 'Z1', nature: 'materiau', label: 'Unité inconnue', unit: 'palette', unit_price: 1, loss_pct: 0 })).status, 400);
  res = await admin.post(`${D}/ouvrages`).send({ code: 'MURB', lot: 'elevation', label: 'Mur en briques', unit: 'm2', composition: [{ resource_id: briq.id, quantity: 50 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const murb = res.body.find(w => w.code === 'MURB');
  assert.equal(murb.unit_cost, Math.round(50 * 1.05 * 250));
  assert.equal((await admin.delete(`${D}/ressources/${briq.id}`)).status, 409, 'ressource utilisée');
  res = await admin.post(`${D}/modeles`).send({ label: 'Villa en briques', params: villa, with_roof: false, lines: [{ work_id: murb.id, base: 'surface_murs', ratio: 1 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const model = res.body.find(m => m.label === 'Villa en briques');
  assert.equal((await admin.delete(`${D}/ouvrages/${murb.id}`)).status, 409, 'ouvrage utilisé dans un modèle');
  // Aller-retour : prix modifié, relu
  await admin.patch(`${D}/ressources/${briq.id}`).send({ unit_price: 300 });
  assert.equal((await admin.get(`${D}/refs`)).body.resources.find(r => r.id === briq.id).unit_price, 300);
  assert.equal((await admin.delete(`${D}/modeles/${model.id}`)).status, 200);
  assert.equal((await admin.delete(`${D}/ouvrages/${murb.id}`)).status, 200);
  assert.equal((await admin.delete(`${D}/ressources/${briq.id}`)).status, 200);
});

test('estimation : aperçu, enregistrement aux prix figés, métré saisi gardé, lignes ajoutées et retirées, recalcul aux prix actuels', async () => {
  const model = refs.models.find(m => m.label === 'Villa basse');
  assert.equal((await editeur.post(`${D}/apercu`).send({ model_id: model.id, params: villa })).status, 403);
  let res = await conducteur.post(`${D}/apercu`).send({ model_id: model.id, params: villa });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.per_m2 > 30000 && res.body.per_m2 < 200000, `coût au m² : ${res.body.per_m2}`);
  assert.ok(res.body.calc.lots.some(l => l.lot === 'toiture'), 'toiture cochée par défaut pour la villa');
  assert.equal(res.body.cost_price, res.body.dry_cost + res.body.calc.site_costs + res.body.calc.contingency);
  assert.ok(res.body.unchecked_prices);
  assert.equal((await conducteur.post(`${D}/apercu`).send({ model_id: model.id, params: { ...villa, hauteur: 12 } })).status, 400);

  res = await conducteur.post(`${D}/estimations`).send({ model_id: model.id, params: villa, units: 4, label: 'Villas F4 — tranche 1', worksite_id: worksite.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  let est = res.body;
  assert.match(est.reference, /^EST-\d{4}-0001$/);
  assert.equal(est.units, 4);
  assert.ok(est.project_id, 'programme repris du chantier');
  const murs = est.lines.find(l => l.work_code === 'MUR15');
  assert.equal(murs.auto_quantity, 201.6);

  // Métré saisi pour les murs, gardé quand les paramètres changent ; les autres quantités suivent
  res = await conducteur.patch(`${D}/estimations/${est.id}`).send({ quantities: [{ key: murs.key, quantity: 210 }], params: { ...villa, perimetre: 60 } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  est = res.body;
  assert.equal(est.lines.find(l => l.key === murs.key).quantity, 210);
  assert.equal(est.lines.find(l => l.work_code === 'SEM').auto_quantity, 11.52, '(60 + 36) ml × 0,12');
  // Toiture décochée, ligne ajoutée (escalier, métré), ligne retirée
  const remb = est.lines.find(l => l.work_code === 'REMB');
  const esc = refs.works.find(w => w.code === 'ESC');
  res = await conducteur.patch(`${D}/estimations/${est.id}`).send({ with_roof: false, add: [{ work_id: esc.id, quantity: 1.2 }], remove: [remb.key] });
  est = res.body;
  assert.ok(!est.calc.lots.some(l => l.lot === 'toiture'));
  assert.ok(est.lines.some(l => l.work_code === 'ESC' && l.quantity === 1.2));
  assert.ok(!est.lines.some(l => l.key === remb.key));
  // Prix figés : le référentiel change, l'estimation non, jusqu'au recalcul
  const before = est.dry_cost;
  const cim = refs.resources.find(r => r.code === 'CIM-42');
  await admin.patch(`${D}/ressources/${cim.id}`).send({ unit_price: 6000 });
  assert.equal((await conducteur.get(`${D}/estimations/${est.id}`)).body.dry_cost, before);
  res = await conducteur.post(`${D}/estimations/${est.id}/prix`);
  assert.ok(res.body.dry_cost > before, 'recalcul aux prix actuels');
  await admin.patch(`${D}/ressources/${cim.id}`).send({ unit_price: 5000 });
  assert.equal((await conducteur.get(`${D}/estimations?worksite_id=${worksite.id}`)).body.length, 1);
});

test('report au budget du chantier : une ligne par poste, frais et aléas, remplacé sans doublon', async () => {
  const [est] = (await admin.get(`${D}/estimations`)).body;
  const full = (await admin.get(`${D}/estimations/${est.id}`)).body;
  assert.equal((await editeur.post(`${D}/estimations/${est.id}/budget`).send({ worksite_id: worksite.id })).status, 403);
  let res = await admin.post(`${D}/estimations/${est.id}/budget`).send({ worksite_id: worksite.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, full.cost_price);
  const lines = await db('worksite_budget_lines').where({ worksite_id: worksite.id });
  assert.deepEqual([...new Set(lines.map(l => l.category))].sort(), ['engins', 'frais', 'main_oeuvre', 'materiaux']);
  assert.equal(lines.find(l => l.category === 'materiaux').amount_fcfa * 1, full.calc.natures.materiau);
  res = await admin.post(`${D}/estimations/${est.id}/budget`).send({ worksite_id: worksite.id, with_costs: false });
  const again = await db('worksite_budget_lines').where({ worksite_id: worksite.id });
  assert.equal(again.length, 3, 'report refait : lignes remplacées, sans frais ni aléas');
  assert.equal(res.body.total, full.dry_cost);
  assert.equal((await admin.get(`${D}/estimations/${est.id}`)).body.budget_worksite_id, worksite.id);
});
