const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { isoDay } = require('../src/lib/http');

// Rapports des tableaux de bord (demande du client du 03/11) : Ressources humaines et Achats & stocks, période de septembre 2026.
// Les dates sont rangées tantôt en texte, tantôt en millisecondes (comme SQLite le fait selon le chemin d'écriture).
let db, app, admin, commercial, lecteur, ids, awa, yao, kone, futur;
const RAP = '/api/admin/erp/rapports';
const SEPT = '?du=2026-09-01&au=2026-09-30';
const ok = (res, code = 200) => { assert.equal(res.status, code, JSON.stringify(res.body)); return res.body; };
const at = iso => new Date(iso).getTime();
const section = (r, title) => r.sections.find(s => s.title === title);
const indicator = (r, label) => r.summary.find(s => s.label === label)?.value;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  // Lecture des Achats seule : rapport des Achats oui, rapport RH non
  await db('roles').insert({ id: 'achats_lecture', label: 'Achats lecture' });
  await db('role_permissions').insert({ role: 'achats_lecture', permission: 'appro:read' });
  require('../src/services/permissions').invalidate(db);
  lecteur = await login(app, await createUser(db, 'achats_lecture'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));

  // ─── Personnel ───
  const hire = async (last_name, first_name, hire_date, extra = {}) => ok(await admin.post('/api/admin/erp/paie/employees')
    .send({ matricule: `RH-${last_name}-${first_name}`.normalize('NFD').replace(/[^A-Za-z-]/g, '').slice(0, 20), last_name, first_name, gender: 'F', job_title: 'Agent', department: 'commercial', hire_date, base_salary: 987654, ...extra }), 201);
  awa = await hire('Koné', 'Awa', '2024-01-01');
  yao = await hire('Yao', 'Marc', '2026-09-15', { department: 'chantier' }); // entrée de la période
  kone = await hire('Kouassi', 'Paul', '2025-01-01');
  futur = await hire('Traoré', 'Ali', '2026-10-10'); // entrée hors période
  await db('employees').where({ id: kone.id }).update({ end_date: at('2026-09-20T00:00:00Z') }); // sortie de la période (date en millisecondes)

  // Absences : une approuvée dans la période, une à cheval sur la fin, une hors période, une annulée
  await db('hr_leaves').insert([
    { employee_id: awa.id, type: 'maladie', start_date: '2026-09-08', end_date: '2026-09-10', days: 3, calendar_days: 3, status: 'approuvee' },
    { employee_id: awa.id, type: 'conge_annuel', start_date: '2026-09-28', end_date: '2026-10-03', days: 5, calendar_days: 6, status: 'approuvee' },
    { employee_id: awa.id, type: 'maladie', start_date: '2026-08-03', end_date: '2026-08-04', days: 2, calendar_days: 2, status: 'approuvee' },
    { employee_id: awa.id, type: 'formation', start_date: '2026-09-15', end_date: '2026-09-15', days: 1, calendar_days: 1, status: 'annulee' },
  ]);
  // Pointages : semaine du lundi 7 au samedi 12 septembre, 9 h par jour (8 h après la pause déjeuner), puis un pointage d'octobre
  const days = [7, 8, 9, 10, 11, 12].map(d => ({ employee_id: awa.id, check_in: new Date(`2026-09-${String(d).padStart(2, '0')}T08:00:00Z`), check_out: new Date(`2026-09-${String(d).padStart(2, '0')}T17:00:00Z`), source: 'manuel' }));
  await db('hr_attendances').insert([...days, { employee_id: awa.id, check_in: new Date('2026-10-01T08:00:00Z'), check_out: new Date('2026-10-01T17:00:00Z'), source: 'manuel' }]);
  // Notes de frais : soumise et refusée en septembre, brouillon (jamais montré), approuvée en août (hors période)
  await db('hr_expenses').insert([
    { reference: 'NDF-T-1', employee_id: awa.id, date: '2026-09-05', category: 'carburant', label: 'Plein chantier', amount: 25000, status: 'soumise' },
    { reference: 'NDF-T-2', employee_id: awa.id, date: at('2026-09-06T00:00:00Z'), category: 'mission', label: 'Hôtel', amount: 10000, status: 'refusee' },
    { reference: 'NDF-T-3', employee_id: awa.id, date: '2026-09-07', category: 'autre', label: 'Brouillon', amount: 5000, status: 'brouillon' },
    { reference: 'NDF-T-4', employee_id: awa.id, date: '2026-08-20', category: 'autre', label: 'Août', amount: 7000, status: 'approuvee' },
  ]);

  // ─── Achats ───
  const account = await db('acc_accounts').where({ code: '604100' }).first();
  const [sid] = await db('suppliers').insert({ name: 'Matériaux Rapport', kind: 'fournisseur', expense_account_id: account.id });
  const [lid] = await db('appro_locations').insert({ name: 'Dépôt rapport' });
  const [aid] = await db('appro_articles').insert({ code: 'FER-RAP', label: 'Fer à béton', unit: 'u', min_units: 0 });
  await db('appro_balances').insert({ article_id: aid, location_id: lid, quantity_units: 1500, min_units: 1200 }); // 15 aujourd'hui, seuil 12
  const order = (reference, date, status, amount_ttc) => ({ reference, supplier_id: sid, location_id: lid, date, status, vat_rate: 18, amount_ht: Math.round(amount_ttc / 1.18), vat_amount: amount_ttc - Math.round(amount_ttc / 1.18), amount_ttc, issuer_id: ids.super_admin });
  const [o1] = await db('appro_orders').insert(order('BC-RAP-1', '2026-09-10', 'recue', 118000));
  await db('appro_orders').insert([order('BC-RAP-2', at('2026-09-20T00:00:00Z'), 'a_valider', 59000), order('BC-RAP-3', '2026-08-15', 'confirmee', 236000), order('BC-RAP-4', '2026-09-25', 'brouillon', 11800)]);
  // Réception de septembre (10 unités), puis une entrée d'octobre (5 unités) : 10 au 30/09, sous le seuil de 12
  const [m1] = await db('appro_movements').insert({ reference: 'BR-RAP-1', kind: 'reception', status: 'valide', to_location_id: lid, order_id: o1, date: '2026-09-12', amount_ttc: 118000, supplier_ref: 'BL-77' });
  const [m2] = await db('appro_movements').insert({ reference: 'ST-RAP-2', kind: 'entree', status: 'valide', to_location_id: lid, date: '2026-10-05' });
  await db('appro_movement_lines').insert([
    { movement_id: m1, article_id: aid, quantity_units: 1000, label: 'Fer à béton', unit: 'u' },
    { movement_id: m2, article_id: aid, quantity_units: 500, label: 'Fer à béton', unit: 'u' },
  ]);
  await db('internal_requests').insert([
    { reference: 'DI-RAP-1', kind: 'achat', title: 'Cartouches d’encre', status: 'attente_achats', requested_by: ids.commercial, department: 'commercial', estimated_amount: 45000, created_at: new Date('2026-09-14T09:00:00Z') },
    { reference: 'DI-RAP-2', kind: 'achat', title: 'Chaises (octobre)', status: 'attente_achats', requested_by: ids.commercial, created_at: new Date('2026-10-02T09:00:00Z') },
    { reference: 'DI-RAP-3', kind: 'intervention', title: 'Climatisation', status: 'attente_sg', requested_by: ids.commercial, created_at: new Date('2026-09-14T09:00:00Z') },
  ]);
});
after(async () => { if (db) await db.destroy(); });

test('droits : rapport RH réservé à rh:read, rapport des Achats à appro:read', async () => {
  assert.equal((await commercial.get(`${RAP}/rh${SEPT}`)).status, 403);
  assert.equal((await commercial.get(`${RAP}/achats${SEPT}`)).status, 403);
  assert.equal((await lecteur.get(`${RAP}/rh${SEPT}`)).status, 403, 'appro:read ne donne pas le rapport RH');
  ok(await lecteur.get(`${RAP}/achats${SEPT}`));
});

test('rapport RH : structure, effectif au dernier jour, entrées et sorties, absences, heures, notes de frais', async () => {
  const r = ok(await admin.get(`${RAP}/rh${SEPT}`));
  assert.equal(r.title, 'Ressources humaines');
  assert.deepEqual(r.period, { from: '2026-09-01', to: '2026-09-30', label: 'du 01/09/2026 au 30/09/2026' });
  for (const s of r.sections) { assert.ok(s.columns.length && Array.isArray(s.rows)); for (const c of s.columns) assert.ok(c.key && c.label); }
  // Effectif au 30/09 : Awa et Yao (Kouassi sorti le 20, Traoré embauché en octobre) ; plus les fiches du jeu d'essai
  const seeded = (await db('employees').whereNotIn('id', [awa.id, yao.id, kone.id, futur.id]))
    .filter(e => e.active && isoDay(e.hire_date) <= '2026-09-30' && (!e.end_date || isoDay(e.end_date) >= '2026-09-30')).length;
  assert.equal(indicator(r, 'Effectif au 30/09/2026'), seeded + 2);
  const moves = section(r, 'Entrées et sorties').rows;
  assert.deepEqual(moves.filter(m => [yao.matricule, kone.matricule, futur.matricule].includes(m.matricule)).map(m => [m.mouvement, m.matricule, m.date]),
    [['Entrée', yao.matricule, '2026-09-15'], ['Sortie', kone.matricule, '2026-09-20']], 'l’embauche d’octobre est exclue');
  assert.equal(moves.find(m => m.matricule === yao.matricule).service, 'Chantier');
  // Absences : maladie (3 j) et congé à cheval (3 j en septembre) ; août et annulée exclues
  const absences = section(r, 'Absences et congés').rows;
  assert.deepEqual(absences.map(a => [a.type, a.du, a.periode, a.statut]), [['Maladie', '2026-09-08', 3, 'Approuvée'], ['Congé annuel', '2026-09-28', 3, 'Approuvée']]);
  assert.equal(indicator(r, 'Jours d’absence approuvés (calendaires)'), 6);
  // 6 jours × 8 h = 48 h, dont 8 h au-delà des 40 h de la semaine ; le pointage d'octobre est exclu
  const h = section(r, 'Heures pointées').rows.find(x => x.matricule === awa.matricule);
  assert.deepEqual([h.jours, h.heures, h.sup, h.forfait], [6, 48, 8, 'Non']);
  assert.equal(indicator(r, 'Heures pointées'), 48);
  assert.equal(indicator(r, 'Heures supplémentaires'), 8);
  // Notes de frais : soumise et refusée listées, brouillon et août exclus ; total hors refusées
  const notes = section(r, 'Notes de frais').rows;
  assert.deepEqual(notes.map(n => [n.reference, n.statut, n.montant]), [['NDF-T-1', 'À approuver', 25000], ['NDF-T-2', 'Refusée', 10000]]);
  assert.equal(notes[0].categorie, 'Carburant');
  assert.equal(indicator(r, 'Notes de frais (hors refusées)'), 25000);
  // Jamais de salaire dans le rapport
  const raw = JSON.stringify(r);
  assert.ok(!raw.includes('987654') && !raw.includes('base_salary') && !raw.includes('salary'), 'aucun salaire');
});

test('rapport des Achats : bons de commande, réceptions, besoins et stock sous le seuil au dernier jour', async () => {
  const r = ok(await lecteur.get(`${RAP}/achats${SEPT}`));
  assert.equal(r.title, 'Achats & stocks');
  assert.equal(r.period.label, 'du 01/09/2026 au 30/09/2026');
  for (const s of r.sections) assert.ok(s.columns.length && Array.isArray(s.rows));
  const orders = section(r, 'Bons de commande').rows;
  assert.deepEqual(orders.map(o => [o.reference, o.statut, o.ttc]), [['BC-RAP-1', 'Reçue', 118000], ['BC-RAP-2', 'À valider', 59000], ['BC-RAP-4', 'Brouillon', 11800]], 'le bon d’août est exclu');
  assert.equal(orders[0].fournisseur, 'Matériaux Rapport');
  assert.equal(indicator(r, 'Bons de commande émis'), 2, 'brouillon non compté');
  assert.equal(indicator(r, 'Montant commandé (bons validés, TTC)'), 118000);
  assert.equal(indicator(r, 'Bons de commande en attente de validation'), 1);
  assert.deepEqual(section(r, 'Réceptions').rows.map(m => [m.reference, m.commande, m.bl, m.ttc]), [['BR-RAP-1', 'BC-RAP-1', 'BL-77', 118000]]);
  assert.equal(indicator(r, 'Montant reçu (TTC)'), 118000);
  // Besoins : la demande d'achat de septembre parvenue aux Achats ; ni celle d'octobre ni l'intervention
  const needs = section(r, 'Besoins exprimés').rows;
  assert.deepEqual(needs.map(n => [n.objet, n.origine, n.estimation, n.statut]), [['Cartouches d’encre', 'Service Commercial', 45000, 'À traiter (Achats)']]);
  // Stock au 30/09 : 15 aujourd'hui − 5 entrés en octobre = 10, sous le seuil de 12
  const low = section(r, 'Articles sous le seuil au 30/09/2026').rows;
  assert.deepEqual(low.map(b => [b.code, b.quantite, b.seuil]), [['FER-RAP', 10, 12]]);
  assert.equal(indicator(r, 'Articles sous le seuil au 30/09/2026'), 1);
  // Aujourd'hui (15 ≥ 12) l'article n'est plus sous le seuil
  const today = new Date().toISOString().slice(0, 10);
  const now = ok(await lecteur.get(`${RAP}/achats?du=${today}&au=${today}`));
  assert.ok(!now.sections.find(s => s.title.startsWith('Articles sous le seuil')).rows.some(b => b.code === 'FER-RAP'));
});
