/**
 * Pipeline, activités et rendez-vous (choix du client du 30/10) : par défaut le commercial de la fiche ; sur une fiche
 * à attribuer, le commercial choisi par le responsable reçoit aussi la fiche ; un prospect créé par le responsable est
 * à attribuer ; quand la fiche change de commercial, ses activités à faire et ses rendez-vous à venir la suivent.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

const PWD = 'motdepasse-test-123', C = '/api/admin/erp/commercial';
let db, app, resp, awa, serge, idAwa, idSerge, idResp;
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
const tomorrow = () => new Date(Date.now() + 864e5).toISOString();

before(async () => {
  ({ db, app } = await setup());
  // Responsable commerciale (comme Fatou) : un commercial avec la portée « toute l'équipe » et le droit d'attribuer
  const respUser = await createUser(db, 'commercial', 'resp.pc@test.ci');
  const respId = (await db('users').where({ email: 'resp.pc@test.ci' }).first()).id;
  await db('user_permissions').insert(['leads:all', 'leads:assign'].map(permission => ({ user_id: respId, permission, granted: true })));
  resp = await login(app, respUser, PWD);
  awa = await login(app, await createUser(db, 'commercial', 'awa.pc@test.ci'), PWD);
  serge = await login(app, await createUser(db, 'commercial', 'serge.pc@test.ci'), PWD);
  [idAwa, idSerge, idResp] = await Promise.all(['awa.pc@test.ci', 'serge.pc@test.ci', 'resp.pc@test.ci'].map(async e => (await db('users').where({ email: e }).first()).id));
});
after(() => db.destroy());

test('activité : commercial de la fiche par défaut ; fiche à attribuer attribuée au commercial choisi', async () => {
  const mine = ok(await awa.post('/api/admin/leads').send({ name: 'Prospect d’Awa', phone: '0712340001' }), 201);
  assert.equal(mine.assigned_to, idAwa, 'un commercial garde le prospect qu’il crée');
  // Le responsable planifie sur la fiche d'Awa sans choisir : l'activité va à Awa
  const a1 = ok(await resp.post(`${C}/leads/${mine.id}/activities`).send({ kind: 'appel', due_at: tomorrow() }), 201);
  assert.equal(a1.assigned_to, idAwa);
  // Un commercial ne planifie pas pour un collègue
  assert.equal((await awa.post(`${C}/leads/${mine.id}/activities`).send({ kind: 'appel', due_at: tomorrow(), assigned_to: idSerge })).status, 403);
  // Prospect créé par le responsable : à attribuer ; il planifie pour Serge, la fiche passe à Serge
  const free = ok(await resp.post('/api/admin/leads').send({ name: 'Prospect à répartir', phone: '0712340002' }), 201);
  assert.equal(free.assigned_to, null);
  const piped = ok(await resp.get(`${C}/pipeline?assigned_to=aucun`));
  assert.ok(piped.some(c => c.id === free.id) && piped.every(c => !c.assigned_to), 'filtre « À attribuer »');
  const a2 = ok(await resp.post(`${C}/leads/${free.id}/activities`).send({ kind: 'appel', due_at: tomorrow(), assigned_to: idSerge }), 201);
  assert.equal(a2.assigned_to, idSerge);
  assert.equal((await db('leads').where({ id: free.id }).first()).assigned_to, idSerge, 'fiche attribuée en planifiant');
  assert.ok(ok(await serge.get(`${C}/activities`)).some(x => x.id === a2.id), 'dans « Mes activités » de Serge');
  // Commercial inconnu ou inactif refusé
  const other = ok(await resp.post('/api/admin/leads').send({ name: 'Autre à répartir', phone: '0712340003' }), 201);
  assert.equal((await resp.post(`${C}/leads/${other.id}/activities`).send({ kind: 'appel', due_at: tomorrow(), assigned_to: 999999 })).status, 400);
});

test('rendez-vous : même règle que les activités', async () => {
  const mine = ok(await awa.post('/api/admin/leads').send({ name: 'RDV d’Awa', phone: '0712340004' }), 201);
  const r1 = ok(await resp.post('/api/admin/appointments').send({ lead_id: mine.id, kind: 'visite', starts_at: tomorrow() }), 201);
  assert.equal(r1.assigned_to, idAwa, 'par défaut le commercial de la fiche, pas le responsable');
  const free = ok(await resp.post('/api/admin/leads').send({ name: 'RDV à répartir', phone: '0712340005' }), 201);
  const r2 = ok(await resp.post('/api/admin/appointments').send({ lead_id: free.id, kind: 'visite', starts_at: tomorrow(), assigned_to: idAwa }), 201);
  assert.equal(r2.assigned_to, idAwa);
  assert.equal((await db('leads').where({ id: free.id }).first()).assigned_to, idAwa);
  assert.equal((await awa.post('/api/admin/appointments').send({ lead_id: mine.id, kind: 'visite', starts_at: tomorrow(), assigned_to: idSerge })).status, 403);
});

test('changement de commercial : activités à faire et rendez-vous à venir suivent la fiche ; listes et pastille alignées', async () => {
  const lead = ok(await awa.post('/api/admin/leads').send({ name: 'À transférer', phone: '0712340006' }), 201);
  const act = ok(await awa.post(`${C}/leads/${lead.id}/activities`).send({ kind: 'appel', due_at: new Date(Date.now() - 3 * 864e5).toISOString() }), 201);
  const rdv = ok(await awa.post('/api/admin/appointments').send({ lead_id: lead.id, kind: 'visite', starts_at: tomorrow() }), 201);
  assert.ok(ok(await awa.get(`${C}/dashboard`)).my_late_activities >= 1);
  ok(await resp.post('/api/admin/leads/assign').send({ ids: [lead.id], user_id: idSerge }));
  assert.equal((await db('lead_activities').where({ id: act.id }).first()).assigned_to, idSerge);
  assert.equal((await db('appointments').where({ id: rdv.id }).first()).assigned_to, idSerge);
  assert.equal(ok(await awa.get(`${C}/dashboard`)).my_late_activities, 0, 'l’ancien commercial n’a plus de relance sur une fiche qu’il ne voit plus');
  // Une seule liste de commerciaux pour l'ERP et le dashboard
  const erp = ok(await resp.get(`${C}/meta`)).sellers.map(u => u.id).sort();
  const dash = ok(await resp.get('/api/admin/users/commerciaux')).map(u => u.id).sort();
  assert.deepEqual(dash, erp);
  assert.ok(erp.includes(idAwa) && erp.includes(idSerge));
  assert.ok(idResp);
});
