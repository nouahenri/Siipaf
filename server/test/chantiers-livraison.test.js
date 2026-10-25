const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');

let db, app, admin, conducteur, commercial, client, ids, project, worksite, saleA1, saleA2, lots;
const W = '/api/admin/erp/chantiers';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const bell = (userId, event) => db('notifications').where({ user_id: userId, event }).orderBy('id', 'desc').first();

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  await createUser(db, 'comptable');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await db('lots').insert([
    { project_id: project.id, code: 'A1', ilot: 'A', status: 'disponible', price_fcfa: 20000000 },
    { project_id: project.id, code: 'A2', ilot: 'A', status: 'disponible', price_fcfa: 20000000 },
  ]);
  lots = Object.fromEntries((await db('lots').where({ project_id: project.id })).map(l => [l.code, l]));
  worksite = (await conducteur.post(W).send({ project_id: project.id, name: 'Tranche 1', zone_kind: 'ilots', zone: ['A'], manager_id: ids.conducteur_travaux, planned_end: day(200), stages: ['fondations', 'livraison'] })).body;
  saleA1 = (await admin.post(`/api/admin/lots/${lots.A1.id}/sale`).send({ name: 'Awa Koné', phone: '+225 07 11 22 33 44', email: 'awa@test.ci', vefa: true, signed_at: day(-60) })).body;
  saleA2 = (await admin.post(`/api/admin/lots/${lots.A2.id}/sale`).send({ name: 'Yao Kouassi', phone: '+225 07 55 66 77 88', email: 'yao@test.ci', vefa: true, signed_at: day(-50) })).body;
  await db('leads').whereIn('id', [saleA1.lead_id, saleA2.lead_id]).update({ assigned_to: ids.commercial });
  // Espace client de l'acquéreur du lot A1
  const lead = await db('leads').where({ id: saleA1.lead_id }).first();
  const temp = (await admin.post(`/api/admin/leads/${lead.id}/client-access`).send({})).body.temporary_password;
  client = request.agent(app);
  assert.equal((await client.post('/api/client/login').send({ code: lead.client_code, password: temp })).status, 200);
  assert.equal((await client.post('/api/client/password').send({ current: temp, next: 'MotDePasseClient-2026' })).status, 200);
});
after(() => db.destroy());

test('TMA : demande, devis du conducteur, accord de l’acquéreur dans son espace, échéancier et Comptabilité', async () => {
  const before = (await client.get(`/api/client/dossiers/${saleA1.id}`)).body;
  assert.equal((await client.post(`/api/client/dossiers/${saleA1.id}/tma`).send({ title: 'x' })).status, 400);
  let res = await commercial.post(`${W}/tma`).send({ sale_id: saleA1.id, title: 'Carrelage grand format au séjour', description: 'Remplacer le 40 × 40 par du 60 × 60' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const tma = res.body;
  assert.deepEqual([tma.status, tma.worksite_id, tma.source], ['demandee', worksite.id, 'equipe']);
  assert.match(tma.reference, /^TMA-\d{4}-0001$/);
  assert.ok(await bell(ids.conducteur_travaux, 'tma.demandee'), 'le conducteur chiffre');
  assert.equal((await conducteur.get(`${W}/badges`)).body.tma_to_quote, 1);

  // Devis : le conducteur seulement ; l'acquéreur répond dans son espace
  assert.equal((await commercial.post(`${W}/tma/${tma.id}/devis`).field('amount_fcfa', '1500000')).status, 403);
  res = await conducteur.post(`${W}/tma/${tma.id}/devis`).field('amount_fcfa', '1500000').field('delay_days', '20').field('quote_note', 'Fourniture et pose');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'chiffree');
  assert.ok((await db('notifications').where({ dedupe_key: `tma:${tma.id}:demandee` }).first()).read_at, 'demande traitée : lue');
  let mine = (await client.get(`/api/client/dossiers/${saleA1.id}`)).body;
  const seen = mine.changes.find(c => c.id === tma.id);
  assert.deepEqual([seen.can_answer, seen.amount_fcfa], [true, 1500000]);
  assert.ok((await db('client_messages').where({ sale_id: saleA1.id }).orderBy('id', 'desc').first()).body.replace(/\s/g, '').includes('1500000FCFA'), 'devis annoncé dans l’espace client');

  res = await client.post(`/api/client/tma/${tma.id}/reponse`).send({ accept: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  mine = res.body;
  assert.equal(mine.changes.find(c => c.id === tma.id).status, 'acceptee');
  assert.equal(mine.remaining_fcfa, before.remaining_fcfa + 1500000, 'ajouté au reste à payer');
  assert.ok(mine.schedule.some(l => l.kind === 'tma' && l.amount_fcfa === 1500000), 'échéance dans « Paiements »');
  assert.equal((await client.post(`/api/client/tma/${tma.id}/reponse`).send({ accept: false })).status, 409, 'une seule réponse');
  assert.ok(await bell(ids.comptable, 'tma.acceptee'), 'Comptabilité prévenue');
  assert.equal((await bell(ids.comptable, 'tma.acceptee')).module, 'compta');

  // Écriture de facturation de la TMA (Comptabilité, synchronisation)
  const compta = require('../src/services/compta');
  if (compta.syncAutoEntries) await compta.syncAutoEntries(db, { userId: ids.super_admin }).catch(() => null);

  // Réalisée par le conducteur ; une TMA acceptée ne s'annule plus
  assert.equal((await commercial.patch(`${W}/tma/${tma.id}`).send({ status: 'annulee' })).status, 409);
  res = await conducteur.patch(`${W}/tma/${tma.id}`).send({ status: 'realisee', done_on: day(0) });
  assert.equal(res.body.status, 'realisee');

  // Demande depuis l'espace client, refusée par l'acquéreur après devis
  res = await client.post(`/api/client/dossiers/${saleA1.id}/tma`).send({ title: 'Prise électrique supplémentaire' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const own = res.body.changes.find(c => c.title === 'Prise électrique supplémentaire');
  assert.equal(own.amount_fcfa, null);
  assert.ok(await bell(ids.commercial, 'tma.demandee'), 'le commercial suit la demande de son client');
  await conducteur.post(`${W}/tma/${own.id}/devis`).field('amount_fcfa', '45000');
  res = await client.post(`/api/client/tma/${own.id}/reponse`).send({ accept: false, note: 'Trop cher' });
  assert.equal(res.body.changes.find(c => c.id === own.id).status, 'refusee');
  assert.equal(res.body.remaining_fcfa, mine.remaining_fcfa, 'un refus ne change rien à payer');
  assert.ok(await bell(ids.conducteur_travaux, 'tma.refusee'));
  // Un autre acquéreur ne répond pas aux devis des autres
  const other = await db('worksite_changes').insert({ reference: 'TMA-2099-0001', sale_id: saleA2.id, lot_id: lots.A2.id, worksite_id: worksite.id, title: 'Essai', status: 'chiffree', amount_fcfa: 1000 });
  assert.equal((await client.post(`/api/client/tma/${typeof other[0] === 'object' ? other[0].id : other[0]}/reponse`).send({ accept: true })).status, 404);
});

test('besoins en matériaux : demandés par le conducteur, validés par la Direction ou l’acheteur, commandés, livrés', async () => {
  const url = `${W}/${worksite.id}/besoins`;
  assert.equal((await conducteur.post(url).send({ label: 'Ciment CPJ 42,5', quantity: 200, unit: 'palette' })).status, 400, 'unité de la liste réglable');
  let res = await conducteur.post(url).send({ label: 'Ciment CPJ 42,5', quantity: 200, unit: 'sac', needed_on: day(7) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const need = res.body;
  assert.deepEqual([need.status, need.unit_label], ['demande', 'Sac']);
  assert.ok(await db('notifications').where({ dedupe_key: `besoin:${need.id}` }).first(), 'validateurs prévenus');
  assert.equal((await admin.get(`${W}/badges`)).body.needs_to_validate, 1);
  assert.equal((await conducteur.post(`${url}/${need.id}/statut`).send({ status: 'valide' })).status, 403, 'le conducteur ne valide pas');
  assert.equal((await admin.post(`${url}/${need.id}/statut`).send({ status: 'livre' })).status, 409, 'dans l’ordre');
  assert.equal((await admin.post(`${url}/${need.id}/statut`).send({ status: 'valide' })).body.status, 'valide');
  assert.equal((await conducteur.patch(`${url}/${need.id}`).send({ quantity: 250 })).status, 409, 'validé : figé');
  assert.ok(await bell(ids.conducteur_travaux, 'besoin.valide'));
  assert.equal((await admin.post(`${url}/${need.id}/statut`).send({ status: 'commande', date: day(0) })).body.ordered_on, day(0));
  res = await conducteur.post(`${url}/${need.id}/statut`).send({ status: 'livre' });
  assert.deepEqual([res.body.status, res.body.delivered_on], ['livre', day(0)]);
  const other = (await conducteur.post(url).send({ label: 'Fer de 12', quantity: 1.5, unit: 't' })).body;
  assert.equal((await admin.post(`${url}/${other.id}/statut`).send({ status: 'refuse' })).status, 400, 'motif obligatoire');
  assert.equal((await admin.post(`${url}/${other.id}/statut`).send({ status: 'refuse', reason: 'Stock suffisant au dépôt' })).body.status, 'refuse');
});

test('réception d’un lot : PV, réserves au SAV, garanties, dernier appel de fonds du seul lot, espace client', async () => {
  const url = `${W}/${worksite.id}/livraisons/${saleA1.id}/reception`;
  assert.equal((await commercial.post(url).field('handed_on', day(0))).status, 404, 'hors de ses chantiers');
  assert.equal((await conducteur.post(url).field('handed_on', day(1))).status, 400, 'pas à l’avance');
  const reserves = JSON.stringify([
    { label: 'Fissure sur l’enduit de la façade', location: 'Façade nord', category: 'maconnerie' },
    { label: 'Porte de la chambre 2 qui frotte', category: 'menuiserie', deadline: day(30) },
  ]);
  let res = await conducteur.post(url).field('handed_on', day(0)).field('attendees', 'Mme Koné, M. Kouadio').field('reserves', reserves)
    .attach('file', Buffer.from('%PDF-1.4 pv'), { filename: 'pv.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.reserves, 2);
  assert.ok(res.body.declaration_id, 'étape « Livraison » du lot signalée');
  const row = res.body.rows.find(r => r.sale_id === saleA1.id);
  assert.deepEqual([row.delivered_at, row.reserves_open, !!row.handover.file_url], [day(0), 2, true]);
  assert.equal((await conducteur.post(url).field('handed_on', day(0))).status, 409, 'une seule réception');
  assert.equal((await conducteur.get(row.handover.file_url)).status, 200);

  const sale = await db('sales').where({ id: saleA1.id }).first();
  assert.ok(sale.delivered_at, 'garanties : date de livraison du dossier');
  assert.equal((await db('sav_reserves').where({ sale_id: saleA1.id, status: 'ouverte' })).length, 2);
  assert.ok(await bell(ids.commercial, 'lot.livre'));
  assert.equal((await bell(ids.comptable, 'lot.livre')).module, 'compta');

  // L'acquéreur voit son PV, ses réserves ; plus de TMA après la livraison
  const mine = (await client.get(`/api/client/dossiers/${saleA1.id}`)).body;
  assert.deepEqual([mine.delivery.handover.handed_on, mine.delivery.reserves.length, mine.can_request_changes], [day(0), 2, false]);
  assert.equal((await client.get(mine.delivery.handover.pv_url)).status, 200);
  assert.equal((await client.post(`/api/client/dossiers/${saleA1.id}/tma`).send({ title: 'Peinture du portail' })).status, 409);

  // La Direction déclare : seul le lot A1 reçoit l'appel « Livraison »
  res = await admin.post(`${W}/etapes/${res.body.declaration_id}/declarer`).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const livA1 = await db('fund_calls').where({ sale_id: saleA1.id, stage: 'livraison' }).first();
  const livA2 = await db('fund_calls').where({ sale_id: saleA2.id, stage: 'livraison' }).first();
  assert.deepEqual([livA1.status, livA2.status], ['appele', 'a_venir']);
  const phase = (await conducteur.get(`${W}/${worksite.id}`)).body.phases.find(p => p.stage === 'livraison');
  assert.equal(phase.actual_end, null, 'la phase Livraison du chantier reste ouverte');
});

test('réception des travaux d’un marché : libération de la retenue programmée, Juridique et Comptabilité prévenus', async () => {
  const supplier = await db('suppliers').insert({ name: 'BTP Gros Œuvre SARL', kind: 'sous_traitant', active: true });
  const supplierId = typeof supplier[0] === 'object' ? supplier[0].id : supplier[0];
  const [c] = await db('contracts').insert({ reference: 'CTR-2099-0001', title: 'Gros œuvre îlot A', kind: 'sous_traitance', status: 'actif', supplier_id: supplierId, worksite_id: worksite.id, project_id: project.id, start_date: day(-90) });
  const contractId = typeof c === 'object' ? c.id : c;
  const kind = await db('guarantee_kinds').where({ direction: 'retenue' }).first();
  await require('../src/services/juridique').createGuarantee(db, { kind_id: kind.id, contract_id: contractId, supplier_id: supplierId, amount_fcfa: 750000 }, { userId: ids.super_admin });
  await createUser(db, 'editeur').catch(() => null);
  const res = await conducteur.patch(`${W}/${worksite.id}/marches/${contractId}/reception`).send({ works_received_on: day(-10) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const m = res.body.find(x => x.id === contractId);
  const months = (await require('../src/services/juridique').settings(db)).legal_warranty_months;
  const expected = new Date(`${day(-10)}T00:00:00Z`); expected.setUTCMonth(expected.getUTCMonth() + months);
  assert.deepEqual([m.works_received_on, m.retention.release_on], [day(-10), expected.toISOString().slice(0, 10)]);
  assert.ok(await bell(ids.comptable, 'chantier.marche_receptionne'));
});
