const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');
const fs = require('fs');
const path = require('path');
const { warrantyFor, warrantyDates } = require('../src/lib/domain');
const { savFilesDir } = require('../src/services/sav');

let db, app, admin, commercial, comptable, saleA, saleB, leadA, clientA, clientB;
const year = new Date().getFullYear();
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

async function clientAgent(lead) {
  const res = await admin.post(`/api/admin/leads/${lead.id}/client-access`).send({ notify: false });
  const agent = request.agent(app);
  await agent.post('/api/client/login').send({ login: lead.client_code, password: res.body.temporary_password });
  await agent.post('/api/client/password').send({ current: res.body.temporary_password, next: 'nouveau-mot-de-passe-1' });
  return agent;
}

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'S1', price_fcfa: 20000000 }, { code: 'S2', price_fcfa: 20000000 }]);
  const lots = await db('lots').where({ project_id: project.id }).whereIn('code', ['S1', 'S2']).orderBy('code');
  let res = await admin.post(`/api/admin/lots/${lots[0].id}/sale`).send({ name: 'Yao Kouassi', phone: '0701010101', financing: 'comptant', reserved_at: '2026-01-15' });
  saleA = res.body; leadA = res.body.lead;
  res = await admin.post(`/api/admin/lots/${lots[1].id}/sale`).send({ name: 'Mariam Traoré', phone: '0702020202', financing: 'comptant', reserved_at: '2026-01-15' });
  saleB = res.body;
  clientA = await clientAgent(leadA);
  clientB = await clientAgent(res.body.lead);
});
after(async () => {
  for (const f of await db('sav_files').select('filename')) fs.rmSync(path.join(savFilesDir, f.filename), { force: true });
  await db.destroy();
});

test('garanties : parfait achèvement 1 an, biennale 2 ans, décennale 10 ans', () => {
  const today = new Date('2026-10-20');
  assert.equal(warrantyFor('plomberie', null, today), null, 'pas encore livré');
  assert.equal(warrantyFor('plomberie', '2026-03-01', today), 'parfait_achevement');
  assert.equal(warrantyFor('plomberie', '2025-03-01', today), 'biennale');
  assert.equal(warrantyFor('maconnerie', '2020-01-01', today), 'decennale');
  assert.equal(warrantyFor('revetements', '2024-01-01', today), 'hors_garantie');
  assert.deepEqual(warrantyDates('2026-03-01'), { parfait_achevement: '2027-03-01', biennale: '2028-03-01', decennale: '2036-03-01' });
});

test('droits : le commercial consulte sans traiter, le comptable ne voit pas le SAV', async () => {
  assert.equal((await commercial.get('/api/admin/erp/sav/tickets')).status, 200);
  assert.equal((await commercial.post('/api/admin/erp/sav/tickets').send({ sale_id: saleA.id, category: 'plomberie', title: 'Fuite' })).status, 403);
  assert.equal((await comptable.get('/api/admin/erp/sav/stats')).status, 403);
});

let ticket;
test("réclamation saisie par l'équipe : référence, échéance, garantie selon la livraison", async () => {
  let res = await admin.patch(`/api/admin/erp/sav/sales/${saleA.id}/delivery`).send({ delivered_at: '2026-06-01' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.warranty_ends.parfait_achevement, '2027-06-01');

  res = await admin.post('/api/admin/erp/sav/tickets').send({ sale_id: saleA.id, category: 'plomberie', priority: 'haute', title: 'Fuite sous l’évier', location: 'Cuisine' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  ticket = res.body;
  assert.equal(ticket.ref, `SAV-${year}-0001`);
  assert.equal(ticket.status, 'nouveau');
  assert.equal(ticket.warranty, 'parfait_achevement');
  assert.equal(ticket.lot_code, 'S1');
  assert.ok(Math.abs(new Date(ticket.due_at) - new Date(ticket.created_at) - 48 * 3600e3) < 120e3, 'échéance à 48 h pour « haute »');
  assert.equal((await db('leads').where({ id: leadA.id }).first()).stage, 'sav', 'le client passe à l’étape SAV');

  res = await admin.post('/api/admin/erp/sav/tickets').send({ sale_id: saleB.id, category: 'electricite', title: 'Prise HS' });
  assert.equal(res.body.ref, `SAV-${year}-0002`);
  assert.equal(res.body.warranty, null, 'pas de livraison saisie');
});

test('statuts : passages autorisés, horodatage de la résolution, réouverture', async () => {
  let res = await admin.post(`/api/admin/erp/sav/tickets/${ticket.id}/status`).send({ status: 'clos' });
  assert.equal(res.status, 409, 'on ne clôt pas une réclamation nouvelle');
  res = await admin.post(`/api/admin/erp/sav/tickets/${ticket.id}/status`).send({ status: 'qualifie', note: 'Fuite confirmée par téléphone' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.first_response_at);
  assert.match(res.body.events.at(-1).body, /Nouveau → Qualifié : Fuite confirmée/);

  res = await admin.patch(`/api/admin/erp/sav/tickets/${ticket.id}`).send({ assigned_to: 1, priority: 'urgente' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.assigned_name, 'responsable affiché');
  assert.ok(Math.abs(new Date(res.body.due_at) - new Date(res.body.created_at) - 24 * 3600e3) < 120e3, 'échéance recalculée');
});

test('notes internes : visibles par l’équipe, jamais par le client', async () => {
  await admin.post(`/api/admin/erp/sav/tickets/${ticket.id}/comments`).send({ body: 'Plombier habituel indisponible', internal: true });
  await admin.post(`/api/admin/erp/sav/tickets/${ticket.id}/comments`).send({ body: 'Nous passons jeudi matin.' });
  const team = await admin.get(`/api/admin/erp/sav/tickets/${ticket.id}`);
  assert.ok(team.body.events.some(e => e.body === 'Plombier habituel indisponible'));
  const own = await clientA.get(`/api/client/sav/${ticket.id}`);
  assert.equal(own.status, 200);
  assert.ok(!own.body.events.some(e => e.internal || e.body === 'Plombier habituel indisponible'));
  assert.ok(!own.body.events.some(e => e.kind === 'status' || /Fuite confirmée/.test(e.body)), 'ni journal des statuts ni ses notes');
  assert.ok(own.body.events.some(e => e.body === 'Nous passons jeudi matin.'));
  assert.equal(own.body.assigned_name, undefined);
  assert.equal((await clientB.get(`/api/client/sav/${ticket.id}`)).status, 404, 'cloisonné par client');
});

test('interventions : planifier puis réaliser fait avancer la réclamation', async () => {
  let res = await admin.post('/api/admin/erp/sav/interventions').send({ ticket_id: ticket.id, scheduled_at: '2026-10-22T09:00:00Z', duration_min: 90, contractor: 'Plomberie Express' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const iv = res.body;
  assert.equal((await db('sav_tickets').where({ id: ticket.id }).first()).status, 'planifie');
  res = await admin.patch(`/api/admin/erp/sav/interventions/${iv.id}`).send({ status: 'realisee', report: 'Joint remplacé.', cost_fcfa: 15000 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.done_at);
  assert.equal((await db('sav_tickets').where({ id: ticket.id }).first()).status, 'en_cours');
  res = await admin.get('/api/admin/erp/sav/interventions?from=2026-10-01&to=2026-11-01');
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].client_name, 'Yao Kouassi');
});

test('le client signale un problème avec photo, répond et note la résolution', async () => {
  let res = await clientA.post('/api/client/sav/files').attach('files', PNG, { filename: 'fissure.png', contentType: 'image/png' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const photo = res.body[0];
  assert.match(photo.url, /^\/api\/client\/sav\/files\/\d+$/);
  assert.equal((await clientB.get(photo.url)).status, 404, 'photo d’un autre client');
  assert.equal((await clientA.get(photo.url)).status, 200);
  const file = await db('sav_files').where({ id: photo.id }).first();
  assert.equal((await request(app).get(`/uploads/private/sav/${file.filename}`)).status, 404, 'jamais servie en public');

  res = await clientA.post('/api/client/sav').send({ sale_id: saleB.id, category: 'maconnerie', title: 'Fissure' });
  assert.equal(res.status, 404, 'pas son dossier');
  res = await clientA.post('/api/client/sav').send({ sale_id: saleA.id, category: 'maconnerie', title: 'Fissure au salon', media_ids: [photo.id] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const mine = res.body;
  assert.equal(mine.source, 'client');
  assert.equal(mine.priority, 'normale');
  assert.equal(mine.media.length, 1);

  res = await clientB.post('/api/client/sav').send({ sale_id: saleB.id, category: 'autre', title: 'Volé', media_ids: [photo.id] });
  assert.equal(res.status, 400, 'on ne réutilise pas la photo d’un autre client');

  assert.equal((await clientA.post(`/api/client/sav/${mine.id}/rating`).send({ satisfaction: 5 })).status, 409, 'avis seulement après résolution');
  await admin.post(`/api/admin/erp/sav/tickets/${mine.id}/status`).send({ status: 'resolu' });
  res = await clientA.post(`/api/client/sav/${mine.id}/comments`).send({ body: 'La fissure est revenue.' });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'en_cours', 'la réponse du client rouvre la demande');
  await admin.post(`/api/admin/erp/sav/tickets/${mine.id}/status`).send({ status: 'resolu' });
  res = await clientA.post(`/api/client/sav/${mine.id}/rating`).send({ satisfaction: 4, comment: 'Rapide' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'clos');
  assert.equal((await clientA.post(`/api/client/sav/${mine.id}/rating`).send({ satisfaction: 1 })).status, 409);

  const list = await clientA.get('/api/client/sav');
  assert.equal(list.body.length, 2);
});

test('réserves de livraison : saisie, réclamation liée, levée', async () => {
  let res = await admin.post(`/api/admin/erp/sav/sales/${saleA.id}/reserves`).send({ label: 'Porte de la chambre 2 frotte', category: 'menuiserie', deadline: '2026-07-01' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const reserve = res.body;
  assert.equal(String(reserve.noted_at).slice(0, 10), '2026-06-01', 'datée du PV de livraison par défaut');
  res = await admin.get('/api/admin/erp/sav/reserves?status=ouverte');
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].late, true);

  res = await admin.post(`/api/admin/erp/sav/reserves/${reserve.id}/ticket`);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.source, 'livraison');
  assert.equal(res.body.warranty, 'parfait_achevement');
  assert.equal((await admin.post(`/api/admin/erp/sav/reserves/${reserve.id}/ticket`)).status, 409);

  res = await admin.patch(`/api/admin/erp/sav/reserves/${reserve.id}`).send({ status: 'levee' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.lifted_at);
  const detail = await admin.get(`/api/admin/erp/sav/sales/${saleA.id}`);
  assert.equal(detail.body.reserves[0].status, 'levee');
  assert.equal(detail.body.tickets.length, 3);
});

test('indicateurs du tableau de bord SAV', async () => {
  const res = await admin.get('/api/admin/erp/sav/stats');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const s = res.body;
  assert.equal(s.open, 3);
  assert.equal(s.satisfaction_avg, 4);
  assert.equal(s.satisfaction_count, 1);
  assert.equal(s.reserves.levee, 1);
  assert.equal(s.by_category.plomberie, 1);
  assert.equal(s.months.length, 6);
  assert.ok(s.avg_resolution_hours != null);
  const list = await admin.get('/api/admin/erp/sav/tickets?open=1&q=Fuite');
  assert.equal(list.body.total, 1);
});
