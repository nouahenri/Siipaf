const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { geoCheck, distanceM } = require('../src/lib/rh');

// Contrôle du lieu de pointage (demande du client du 02/11) : positions des lieux et chantiers, privilège « Positions de pointage »,
// modification soumise au super administrateur, pointage toujours enregistré et signalé
let db, app, admin, expl, comptable, awaAgent, koffiAgent, awa, siege, users;
const R = '/api/admin/erp/rh';
const L = '/api/admin/erp/lieux';
const SIEGE = { latitude: 5.36, longitude: -4.0083 };
const north = m => ({ latitude: SIEGE.latitude + m / (6371000 * Math.PI / 180), longitude: SIEGE.longitude }); // m mètres au nord du siège

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  expl = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  awaAgent = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  koffiAgent = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  users = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  awa = (await admin.post('/api/admin/erp/paie/employees').send({ last_name: 'Koné', first_name: 'Awa', gender: 'F', job_title: 'Commerciale', department: 'commercial', hire_date: '2024-01-01', base_salary: 300000, user_id: users.commercial })).body;
  await awaAgent.put(`${R}/me/pin`).send({ pin: '4821' });
  siege = await db('places').where({ kind: 'siege' }).first();
});
after(() => db.destroy());

test('contrôle d’une position : sur place, imprécise, hors zone, sans position, lieu non situé', () => {
  const ref = { ...SIEGE, radius: 20 };
  assert.ok(Math.abs(distanceM(SIEGE, north(100)) - 100) < 1);
  assert.deepEqual(geoCheck({ ...north(10), accuracy: 8 }, ref), { geo_status: 'sur_place', distance_m: 10 });
  assert.equal(geoCheck({ ...north(10), accuracy: 60 }, ref).geo_status, 'imprecise', 'marge du téléphone plus large que le rayon');
  assert.equal(geoCheck({ ...north(45), accuracy: 30 }, ref).geo_status, 'imprecise', 'la marge d’erreur atteint le rayon');
  assert.deepEqual(geoCheck({ ...north(500), accuracy: 30 }, ref), { geo_status: 'hors_zone', distance_m: 500 });
  assert.equal(geoCheck({ ...north(30) }, ref).geo_status, 'hors_zone', 'précision inconnue : distance seule');
  assert.equal(geoCheck(null, ref).geo_status, 'sans_position');
  assert.equal(geoCheck({ ...north(10) }, null).geo_status, 'non_situe');
});

test('privilège « Positions de pointage » : responsable des exploitations oui, comptable non (même avec la gestion des lieux)', async () => {
  const pos = { ...SIEGE, radius_m: null };
  assert.equal((await comptable.put(`${R}/attendance/zones/lieu/${siege.id}`).send(pos)).status, 403);
  assert.equal((await comptable.patch(`${L}/${siege.id}`).send({ latitude: 5.1, longitude: -4.1 })).status, 403, 'Lieux : la position demande le privilège');
  assert.equal((await comptable.patch(`${L}/${siege.id}`).send({ address: 'Plateau, avenue Chardy' })).status, 200, 'le reste du lieu reste ouvert à lieux:write');
  assert.equal((await comptable.get(`${R}/attendance/zones`)).status, 200, 'lecture : service RH');
  assert.equal((await expl.put(`${R}/attendance/zones/lieu/${siege.id}`).send({ latitude: 5.36 })).status, 400);
  // Première saisie : appliquée tout de suite
  const res = await expl.put(`${R}/attendance/zones/lieu/${siege.id}`).send(pos);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.applied, true);
  assert.equal(res.body.places.find(p => p.id === siege.id).latitude, SIEGE.latitude);
});

test('pointage en ligne et borne : position comparée au lieu, hors zone signalé au service RH, jamais refusé', async () => {
  let res = await awaAgent.post(`${R}/me/attendance`).send({ ...north(8), accuracy: 6 });
  assert.equal(res.body.action, 'arrivee');
  assert.equal(res.body.attendance.geo_status, 'sur_place');
  assert.equal(res.body.attendance.accuracy_m, 6);
  res = await awaAgent.post(`${R}/me/attendance`).send({ ...north(1800), accuracy: 15 });
  assert.equal(res.body.action, 'depart', 'départ hors zone enregistré');
  assert.equal(res.body.attendance.out_geo_status, 'hors_zone');
  assert.equal(res.body.attendance.out_distance_m, 1800);
  const notes = await db('notifications').where({ event: 'pointage.hors_zone' });
  assert.ok(notes.some(n => n.user_id === users.comptable && /Koné Awa/.test(n.title) && /1,8 km/.test(n.body)), 'service RH prévenu');
  assert.ok(!notes.some(n => n.user_id === users.commercial), 'jamais l’employé lui-même');

  // Borne : position de la tablette ; sans position fournie
  res = await koffiAgent.post(`${R}/attendance/kiosk`).send({ matricule: awa.matricule, pin: '4821' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.attendance.geo_status, 'sans_position');
  await koffiAgent.post(`${R}/attendance/kiosk`).send({ matricule: awa.matricule, pin: '4821', ...north(5), accuracy: 5 });

  // Liste : filtre des pointages à vérifier
  const all = (await comptable.get(`${R}/attendance`)).body;
  const alerts = (await comptable.get(`${R}/attendance?controle=alerte`)).body;
  const out = (await comptable.get(`${R}/attendance?controle=hors_zone`)).body;
  assert.equal(all.length, 2);
  assert.equal(alerts.length, 2, 'départ hors zone + arrivée sans position');
  assert.equal(out.length, 1);

  // Géolocalisation coupée dans les réglages : pas de contrôle
  await admin.put(`${R}/settings`).send({ geolocation: false });
  res = await awaAgent.post(`${R}/me/attendance`).send({ ...north(3000) });
  assert.equal(res.body.attendance.geo_status, null);
  assert.equal(res.body.attendance.latitude, null, 'position non enregistrée');
  await awaAgent.post(`${R}/me/attendance`).send({});
  await admin.put(`${R}/settings`).send({ geolocation: true });
});

test('correction du lieu d’un pointage : les positions relevées sont comparées au nouveau lieu', async () => {
  const depot = (await admin.post(L).send({ kind: 'depot', name: 'Dépôt de Bingerville', ...north(1800) })).body.find(p => p.name === 'Dépôt de Bingerville');
  const a = (await comptable.get(`${R}/attendance?controle=hors_zone`)).body[0];
  const res = await comptable.patch(`${R}/attendance/${a.id}`).send({ place_id: depot.id, note: 'Journée au dépôt' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.out_geo_status, 'sur_place');
  assert.equal(res.body.geo_status, 'hors_zone', 'arrivée au siège, à 1,8 km du dépôt');
});

test('modification d’une position existante : en attente du super administrateur, qui valide ou refuse', async () => {
  const z = () => db('places').where({ id: siege.id }).first();
  let res = await expl.put(`${R}/attendance/zones/lieu/${siege.id}`).send({ ...north(300), radius_m: 40 });
  assert.equal(res.body.applied, false);
  assert.ok(res.body.request_id);
  assert.equal(Number((await z()).latitude), SIEGE.latitude, 'l’ancienne position sert jusqu’à la décision');
  const pending = res.body.places.find(p => p.id === siege.id).pending;
  assert.equal(pending.radius_m, 40);
  assert.ok((await db('notifications').where({ event: 'pointage.position_a_valider' })).some(n => n.user_id === users.super_admin), 'super administrateur prévenu');
  assert.ok((await expl.get(`${L}?tous=1`)).body.places.find(p => p.id === siege.id).zone_pending, 'visible dans Administration générale › Lieux');

  assert.equal((await expl.post(`${R}/attendance/zones/requests/${pending.id}/decide`).send({ action: 'valider' })).status, 403, 'seul le super administrateur valide');
  res = await admin.post(`${R}/attendance/zones/requests/${pending.id}/decide`).send({ action: 'valider' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(Number((await z()).radius_m), 40);
  assert.ok(Math.abs(Number((await z()).latitude) - north(300).latitude) < 1e-6);
  assert.ok((await db('notifications').where({ event: 'pointage.position_decidee', user_id: users.resp_exploitation })).length, 'demandeur prévenu');
  assert.equal((await admin.post(`${R}/attendance/zones/requests/${pending.id}/decide`).send({ action: 'refuser' })).status, 409);

  // Effacer passe aussi par la validation ; refus : rien ne change
  res = await expl.patch(`${L}/${siege.id}`).send({ latitude: null, longitude: null, radius_m: null });
  assert.equal(res.status, 200);
  const rid = res.body.find(p => p.id === siege.id).zone_pending.id;
  await admin.post(`${R}/attendance/zones/requests/${rid}/decide`).send({ action: 'refuser', note: 'Position vérifiée sur place' });
  assert.equal(Number((await z()).radius_m), 40);

  // Le super administrateur modifie directement ; sa saisie remplace une demande en attente
  await expl.put(`${R}/attendance/zones/lieu/${siege.id}`).send({ ...SIEGE, radius_m: 25 });
  res = await admin.put(`${R}/attendance/zones/lieu/${siege.id}`).send({ ...SIEGE, radius_m: 30 });
  assert.equal(res.body.applied, true);
  assert.equal(res.body.places.find(p => p.id === siege.id).pending, null);
  assert.equal(Number((await z()).radius_m), 30);
});
