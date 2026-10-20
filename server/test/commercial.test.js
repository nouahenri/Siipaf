const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { checkVefaPlan, splitVefaAmounts, milestoneReached, DEFAULT_VEFA_PLAN } = require('../src/lib/domain');

let db, app, admin, commercial, conducteur, editeur, comptable, sellerId, project, lots;
const yesterday = () => new Date(Date.now() - 24 * 3600e3).toISOString();
const M = '/api/admin/erp/commercial';

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  sellerId = (await db('users').where({ email: 'commercial@test.ci' }).first()).id;
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([
    { code: 'V1', price_fcfa: 30000000 }, { code: 'V2', price_fcfa: 30000000 }, { code: 'V3', price_fcfa: 25000000 },
  ]);
  lots = await db('lots').where({ project_id: project.id }).whereIn('code', ['V1', 'V2', 'V3']).orderBy('code');
  await db('lots').whereIn('id', lots.map(l => l.id)).update({ ilot: '7' });
});
after(() => db.destroy());

test('VEFA : plafonds légaux cumulés (art. 124), total 100 %, solde à la livraison', () => {
  assert.deepEqual(checkVefaPlan(DEFAULT_VEFA_PLAN), []);
  assert.match(checkVefaPlan([{ stage: 'signature', pct: 15 }, { stage: 'fondations', pct: 10 }, { stage: 'livraison', pct: 75 }]).join(' '), /plafond légal de 20 %/);
  assert.match(checkVefaPlan([{ stage: 'signature', pct: 10 }, { stage: 'toiture', pct: 55 }, { stage: 'livraison', pct: 35 }]).join(' '), /60 %/);
  assert.match(checkVefaPlan([{ stage: 'signature', pct: 10 }, { stage: 'finitions', pct: 50 }]).join(' '), /100 %/);
  assert.match(checkVefaPlan([{ stage: 'toiture', pct: 10 }, { stage: 'fondations', pct: 10 }, { stage: 'livraison', pct: 80 }]).join(' '), /ordre du chantier/);
  const amounts = splitVefaAmounts(18256001, DEFAULT_VEFA_PLAN).map(m => m.amount_fcfa);
  assert.equal(amounts.reduce((a, b) => a + b, 0), 18256001, 'le dernier appel absorbe l’arrondi');
  assert.equal(milestoneReached('fondations', 'gros_oeuvre'), true, 'le chantier est passé à l’étape suivante');
  assert.equal(milestoneReached('fondations', 'fondations'), false, 'fondations en cours : pas encore achevées');
  assert.equal(milestoneReached('livraison', 'livraison'), true);
});

test('droits : module ouvert au commercial et au comptable, pas à l’éditeur ; le conducteur constate l’avancement', async () => {
  assert.equal((await commercial.get(`${M}/dashboard`)).status, 200);
  assert.equal((await comptable.get(`${M}/dashboard`)).status, 200);
  assert.equal((await editeur.get(`${M}/dashboard`)).status, 403);
  assert.equal((await conducteur.get(`${M}/pipeline`)).status, 403);
  assert.equal((await conducteur.get(`${M}/vefa/calls`)).status, 200);
  assert.equal((await commercial.put(`${M}/targets`).send({ month: '2026-10', user_id: sellerId, ca_fcfa: 1 })).status, 403);
});

let lead;
test('pipeline : étapes journalisées, perte avec motif obligatoire, activités en retard', async () => {
  let res = await commercial.post('/api/admin/leads').send({ name: 'Koffi Yao', phone: '0707070707', project_id: project.id });
  lead = res.body;
  assert.equal(lead.assigned_to, sellerId);
  res = await commercial.patch(`${M}/leads/${lead.id}`).send({ expected_revenue_fcfa: 30000000, priority: 2, kind: 'investisseur' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  res = await commercial.post(`${M}/leads/${lead.id}/activities`).send({ kind: 'appel', summary: 'Rappeler pour la visite', due_at: yesterday() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.state, 'retard');
  const act = res.body;
  res = await commercial.get(`${M}/pipeline`);
  const card = res.body.find(c => c.id === lead.id);
  assert.equal(card.next_activity.state, 'retard');
  assert.equal(card.weighted_fcfa, 3000000, '10 % de 30 M en prospection');

  res = await commercial.post(`${M}/activities/${act.id}/done`).send({ outcome: 'Visite calée samedi', next: { kind: 'visite', due_at: new Date(Date.now() + 3 * 864e5).toISOString() } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await commercial.get(`${M}/activities`)).body.filter(a => a.lead_id === lead.id).length, 1, 'la suivante est planifiée');

  res = await commercial.post(`${M}/leads/${lead.id}/stage`).send({ stage: 'visite' });
  assert.equal(res.status, 200);
  assert.equal((await commercial.post(`${M}/leads/${lead.id}/stage`).send({ stage: 'perdu' })).status, 400, 'motif obligatoire');
  res = await commercial.post(`${M}/leads/${lead.id}/stage`).send({ stage: 'perdu', lost_reason: 'prix', lost_note: 'Budget 20 M' });
  assert.equal(res.body.lost_reason, 'prix');
  assert.equal((await db('lead_activities').where({ lead_id: lead.id }).whereNull('done_at')).length, 0, 'plus d’activités à faire');
  res = await commercial.post(`${M}/leads/${lead.id}/stage`).send({ stage: 'decision' });
  assert.equal(res.body.lost_reason, null, 'le motif est effacé quand on le relance');

  await commercial.post(`${M}/leads/${lead.id}/activities`).send({ kind: 'note', note: 'Préfère une villa d’angle' });
  res = await commercial.get(`${M}/leads/${lead.id}`);
  const titles = res.body.history.map(h => h.title);
  assert.ok(titles.includes('Étape : Prospection → Visite'));
  assert.ok(titles.some(t => /Classé perdu : Prix/.test(t)));
  assert.ok(res.body.history.some(h => h.type === 'note' && /villa d’angle/.test(h.body)));
  assert.ok(res.body.history.some(h => h.body && /Visite calée samedi/.test(h.body)), 'compte rendu de l’appel');
});

test('cloisonnement : un commercial ne voit pas les prospects d’un collègue', async () => {
  const other = await createUser(db, 'commercial', 'commercial2@test.ci');
  const otherId = (await db('users').where({ email: other }).first()).id;
  const res = await admin.post('/api/admin/leads').send({ name: 'Client de Paul', phone: '0708080808', assigned_to: otherId });
  assert.equal((await commercial.get(`${M}/leads/${res.body.id}`)).status, 404);
  assert.ok(!(await commercial.get(`${M}/pipeline`)).body.some(c => c.id === res.body.id));
  assert.ok((await admin.get(`${M}/pipeline`)).body.some(c => c.id === res.body.id));
});

test('parc immobilier : bâtiments, étages, types de lots', async () => {
  let res = await admin.post(`${M}/projects/${project.id}/buildings`).send({ code: 'Bât. A', ilot: '7', floors: 3 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const b = res.body;
  assert.equal((await admin.post(`${M}/projects/${project.id}/buildings`).send({ code: 'Bât. A' })).status, 409);
  assert.equal((await admin.patch(`${M}/lots/${lots[0].id}`).send({ building_id: b.id, floor: 5 })).status, 400, 'étage hors bâtiment');
  res = await admin.patch(`${M}/lots/${lots[0].id}`).send({ building_id: b.id, floor: 2, lot_type: 'appartement', rooms: 4, title_number: 'TF 12345', tantiemes: 120 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  res = await admin.post(`${M}/lots/bulk`).send({ lot_ids: [lots[1].id, lots[2].id], building_id: b.id, floor: 1, lot_type: 'appartement' });
  assert.equal(res.body.updated, 2);
  assert.equal((await commercial.patch(`${M}/lots/${lots[0].id}`).send({ rooms: 3 })).status, 403, 'le commercial ne structure pas le parc');
  res = await admin.get(`${M}/property?project_id=${project.id}`);
  assert.equal(res.body.lots.filter(l => l.building_id === b.id).length, 3);
  assert.equal(res.body.lots.find(l => l.id === lots[0].id).title_number, 'TF 12345');
  const tmp = (await admin.post(`${M}/projects/${project.id}/buildings`).send({ code: 'Bât. Z', floors: 1 })).body;
  await admin.patch(`${M}/lots/${lots[2].id}`).send({ building_id: tmp.id, floor: 0 });
  await admin.delete(`${M}/buildings/${tmp.id}`);
  assert.equal((await db('lots').where({ id: lots[2].id }).first()).building_id, null, 'le lot reste, sans bâtiment');
});

let sale;
test('VEFA : appels de fonds émis selon l’avancement du chantier', async () => {
  let res = await conducteur.put(`${M}/vefa/plans/${project.id}`).send({ milestones: [{ stage: 'signature', label: 'Signature', pct: 30 }, { stage: 'livraison', label: 'Solde', pct: 70 }] });
  assert.equal(res.status, 400, 'plafond de 20 % aux fondations');
  res = await conducteur.put(`${M}/vefa/plans/${project.id}`).send({ milestones: DEFAULT_VEFA_PLAN, due_days: 10 });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  res = await commercial.post(`/api/admin/lots/${lots[0].id}/sale`).send({ lead_id: lead.id, vefa: true, signed_at: '2026-09-01' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  sale = res.body;
  assert.equal(sale.schedule.vefa, true);
  assert.equal(sale.schedule.calls.length, 6);
  assert.deepEqual(sale.schedule.lines.map(l => [l.label, l.amount_fcfa, l.due_date]), [['Signature de l’acte notarié', 3000000, '2026-09-11']], 'seule la signature est appelée');

  // Les fondations sont en cours : rien n'est appelé ; le gros œuvre démarre : les fondations sont achevées
  await admin.post(`/api/admin/projects/${project.id}/site-updates`).send({ stage: 'fondations', progress_pct: 20, title: 'Fondations en cours', published_at: '2026-10-01T08:00:00Z' });
  assert.equal((await db('fund_calls').where({ sale_id: sale.id, status: 'appele' })).length, 1);
  res = await admin.post(`/api/admin/projects/${project.id}/site-updates`).send({ stage: 'gros_oeuvre', progress_pct: 35, title: 'Élévation des murs', published_at: '2026-10-10T08:00:00Z' });
  assert.equal(res.body.fund_calls, 1);
  const called = await db('fund_calls').where({ sale_id: sale.id, status: 'appele' }).orderBy('seq');
  assert.deepEqual(called.map(c => c.stage), ['signature', 'fondations']);
  const msg = await db('client_messages').where({ lead_id: lead.id }).orderBy('id', 'desc').first();
  assert.match(msg.body, /Achèvement des fondations \(10 %\) : 3 000 000 FCFA, à régler avant le 20 octobre 2026/);

  // Constat manuel : la mise hors d'eau de l'îlot 7 (le gros œuvre et la toiture sont appelés)
  res = await conducteur.post(`${M}/vefa/milestones`).send({ project_id: project.id, ilot: '7', stage: 'toiture', date: '2026-10-15' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.sales, res.body.calls, res.body.amount_fcfa], [1, 2, 12000000]);

  await comptable.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 3000000, paid_at: '2026-09-05', method: 'virement' });
  res = await admin.get(`${M}/vefa/calls?project_id=${project.id}`);
  const byStage = Object.fromEntries(res.body.map(c => [c.stage, c]));
  assert.equal(byStage.signature.payment_status, 'payee');
  assert.equal(byStage.fondations.status, 'appele');
  assert.equal(byStage.finitions.status, 'a_venir');
  assert.equal(byStage.livraison.payment_status, null);
  assert.equal((await admin.get(`${M}/vefa/calls?filter=a_venir`)).body.length, 2);

  // Prix renégocié : les montants suivent, les appels déjà émis restent émis
  res = await admin.patch(`/api/admin/sales/${sale.id}`).send({ price_fcfa: 32000000 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.schedule.calls.find(c => c.stage === 'signature').amount_fcfa, 3200000);
  assert.equal(res.body.schedule.calls.filter(c => c.status === 'appele').length, 4);
  assert.equal((await admin.put(`/api/admin/sales/${sale.id}/schedule`).send([{ kind: 'solde', label: 'Solde', due_date: '2026-12-01', amount_fcfa: 32000000 }])).status, 409);

  res = await admin.get(`${M}/sales/${sale.id}`);
  assert.equal(res.body.vefa, true);
  assert.equal(res.body.paid_fcfa, 3000000);
});

test('objectifs du mois : cible et réalisé par commercial', async () => {
  const month = new Date().toISOString().slice(0, 7);
  let res = await admin.put(`${M}/targets`).send({ month, user_id: sellerId, ca_fcfa: 64000000, ventes: 2, rdv: 4 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const mine = res.body.rows.find(r => r.user_id === sellerId);
  assert.equal(mine.done.ventes, 1);
  assert.equal(mine.done.ca_fcfa, 32000000);
  assert.equal(mine.pct.ca_fcfa, 50);
  res = await commercial.get(`${M}/targets?month=${month}`);
  assert.deepEqual(res.body.rows.map(r => r.user_id), [sellerId], 'un commercial ne voit que ses objectifs');

  res = await commercial.get(`${M}/dashboard`);
  assert.equal(res.status, 200);
  assert.equal(res.body.current.ventes, 1);
  assert.equal(res.body.series.length, 12);
  assert.ok(res.body.stages.find(s => s.stage === 'paiement').n >= 1);
});
