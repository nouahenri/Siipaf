/**
 * Données de démonstration du Parc auto et matériel (ERP · Administration générale ; base de démo locale uniquement).
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-parc.js
 * Véhicules (dont deux de service), engins sur chantier, matériel, informatique ; échéances, plans d'entretien,
 * pleins et réparations, une demande de véhicule. Alertes marquées faites : la démo n'envoie rien.
 */
const { createDb } = require('../src/db');
const { maintenanceDue } = require('../src/lib/domain');

const DAY = 24 * 3600 * 1000;
const ymd = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

(async () => {
  const db = createDb();
  if (process.env.NODE_ENV === 'production') throw new Error('Script réservé à la base de démo.');
  if ((await db('assets').count({ n: '*' }))[0].n > 0) { console.log('Parc déjà présent.'); return db.destroy(); }
  const admin = await db('users').orderBy('id').first();
  const others = await db('users').whereNot({ id: admin.id }).where({ active: true }).orderBy('id').limit(2);
  const employees = await db('employees').where({ active: true }).orderBy('id').limit(3);
  const projects = await db('projects').orderBy('id').limit(2);
  const seq = {};
  const id = r => (typeof r === 'object' ? r.id : r);
  const add = async a => {
    const prefix = { vehicule: 'VEH', engin: 'ENG', materiel: 'MAT', informatique: 'INF', autre: 'DIV' }[a.kind];
    seq[prefix] = (seq[prefix] || 0) + 1;
    const [i] = await db('assets').insert({ meter: a.kind === 'vehicule' ? 'km' : a.kind === 'engin' ? 'h' : null, created_by: admin.id, manager_id: admin.id, ...a, code: `${prefix}-${String(seq[prefix]).padStart(4, '0')}` });
    return id(i);
  };
  const assign = async (assetId, g) => {
    await db('asset_assignments').insert({ asset_id: assetId, created_by: admin.id, ...g });
    await db('assets').where({ id: assetId }).update({ status: 'affecte', employee_id: g.employee_id || null, project_id: g.project_id || null });
  };

  const hilux = await add({ kind: 'vehicule', name: 'Toyota Hilux double cabine', brand: 'Toyota', model: 'Hilux', plate: '4512 HG 01', year: 2022, meter_value: 68450, meter_at: ymd(-2), pool: true, acquired_on: '2022-03-15', purchase_amount: 28500000 });
  const prado = await add({ kind: 'vehicule', name: 'Toyota Land Cruiser Prado', brand: 'Toyota', model: 'Prado', plate: '2208 JK 01', year: 2021, meter_value: 91200, meter_at: ymd(-5) });
  const duster = await add({ kind: 'vehicule', name: 'Renault Duster', brand: 'Renault', model: 'Duster', plate: '7731 GT 01', year: 2020, meter_value: 120300, meter_at: ymd(-1), pool: true });
  const pelle = await add({ kind: 'engin', name: 'Pelleteuse sur chenilles', brand: 'Caterpillar', model: '320', serial: 'CAT0320XK8812', year: 2019, meter_value: 6840, meter_at: ymd(-3) });
  const betonniere = await add({ kind: 'engin', name: 'Bétonnière tractable 350 L', brand: 'Altrad', meter_value: 1210, meter_at: ymd(-3) });
  const groupe = await add({ kind: 'materiel', name: 'Groupe électrogène 20 kVA', brand: 'SDMO', serial: 'SD20-55102' });
  await add({ kind: 'materiel', name: 'Niveau laser rotatif', brand: 'Leica', serial: 'RUG-2011' });
  const laptop = await add({ kind: 'informatique', name: 'Ordinateur portable', brand: 'HP', model: 'ProBook 450', serial: '5CD2231XYZ' });
  await add({ kind: 'autre', kind_other: 'Container de chantier', name: 'Container 20 pieds — magasin', status: 'disponible' });

  if (employees[0]) await assign(prado, { kind: 'employe', employee_id: employees[0].id, start_date: ymd(-200), condition_out: 'Bon état', meter_out: 70000 });
  if (employees[1]) await assign(laptop, { kind: 'employe', employee_id: employees[1].id, start_date: ymd(-90), condition_out: 'Neuf' });
  if (projects[0]) {
    await assign(pelle, { kind: 'chantier', project_id: projects[0].id, start_date: ymd(-45), condition_out: 'Révisée', meter_out: 6600 });
    await assign(betonniere, { kind: 'chantier', project_id: projects[0].id, start_date: ymd(-45) });
    await assign(groupe, { kind: 'chantier', project_id: (projects[1] || projects[0]).id, start_date: ymd(-20) });
  }
  await db('assets').where({ id: duster }).update({ status: 'maintenance' });

  await db('asset_documents').insert([
    { asset_id: hilux, kind: 'assurance', label: 'Assurance flotte', reference: 'NSIA-AUTO-55821', expires_on: ymd(18) },
    { asset_id: hilux, kind: 'visite_technique', label: 'Visite technique', expires_on: ymd(95) },
    { asset_id: prado, kind: 'vignette', label: 'Vignette 2026', expires_on: ymd(-4) },
    { asset_id: prado, kind: 'assurance', label: 'Assurance flotte', reference: 'NSIA-AUTO-55822', expires_on: ymd(18) },
    { asset_id: duster, kind: 'visite_technique', label: 'Visite technique', expires_on: ymd(6) },
    { asset_id: pelle, kind: 'assurance', label: 'Assurance engins de chantier', expires_on: ymd(160) },
  ]);
  await db('asset_maintenance_plans').insert([
    { asset_id: hilux, label: 'Vidange', every_km: 10000, every_months: 6, last_date: ymd(-150), last_meter: 58800 },
    { asset_id: prado, label: 'Vidange', every_km: 10000, every_months: 6, last_date: ymd(-60), last_meter: 85000 },
    { asset_id: pelle, label: 'Révision 250 h', every_hours: 250, last_date: ymd(-40), last_meter: 6600 },
    { asset_id: betonniere, label: 'Graissage', every_months: 1, last_date: ymd(-26) },
  ]);
  const fills = [[hilux, -40, 64200, 62, 52700], [hilux, -25, 65900, 58, 49300], [hilux, -12, 67250, 55, 46750], [hilux, -2, 68450, 49, 41650],
    [pelle, -30, 6680, 180, 153000], [pelle, -15, 6760, 170, 144500], [pelle, -3, 6840, 175, 148750]];
  for (const [a, d, meterValue, liters, amount] of fills) {
    await db('asset_costs').insert({ asset_id: a, kind: 'carburant', date: ymd(d), amount, liters, meter_value: meterValue, project_id: a === pelle && projects[0] ? projects[0].id : null, created_by: admin.id });
  }
  await db('asset_costs').insert([
    { asset_id: duster, kind: 'reparation', date: ymd(-1), amount: 385000, label: 'Embrayage — garage Auto Plus', created_by: admin.id },
    { asset_id: pelle, kind: 'reparation', date: ymd(-20), amount: 620000, label: 'Flexible hydraulique', project_id: projects[0]?.id || null, created_by: admin.id },
    { asset_id: groupe, kind: 'location', date: ymd(-20), amount: 450000, label: 'Location remorque transport', project_id: (projects[1] || projects[0])?.id || null, created_by: admin.id },
  ]);
  if (others[0]) {
    await db('asset_reservations').insert([
      { requested_by: others[0].id, asset_id: null, status: 'demandee', decided_by: null, decided_at: null, start_at: `${ymd(2)}T08:30`, end_at: `${ymd(2)}T13:00`, purpose: 'Visite client — programme Ahoutoué', destination: 'Ahoutoué', passengers: 3 },
      { requested_by: (others[1] || others[0]).id, asset_id: hilux, status: 'accordee', decided_by: admin.id, decided_at: new Date(), start_at: `${ymd(4)}T09:00`, end_at: `${ymd(4)}T16:00`, purpose: 'Dépôt de dossiers à la mairie', destination: 'Bingerville', passengers: null },
    ]);
  }

  // Rien ne part de la démo : toutes les alertes possibles marquées envoyées
  const today = ymd(0);
  for (const d of await db('asset_documents')) for (const stage of [30, 7]) await db('asset_alerts').insert({ asset_id: d.asset_id, deadline_key: `doc:${d.id}`, due: d.expires_on, stage });
  for (const p of await db('asset_maintenance_plans')) {
    const a = await db('assets').where({ id: p.asset_id }).first();
    const r = maintenanceDue(p, a, today);
    if (r.next_date) for (const stage of [30, 7]) await db('asset_alerts').insert({ asset_id: p.asset_id, deadline_key: `plan:${p.id}`, due: r.next_date, stage });
    if (r.next_meter != null) await db('asset_alerts').insert({ asset_id: p.asset_id, deadline_key: `plan:${p.id}:compteur`, due: String(r.next_meter), stage: 0 });
  }
  console.log('Parc de démonstration enregistré.');
  await db.destroy();
})().catch(e => { console.error(e); process.exit(1); });
