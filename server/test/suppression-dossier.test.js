const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

let db, app, admin, comptable;
const C = '/api/admin/erp/compta';
const year = new Date().getFullYear();
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  await comptable.post(`${C}/fiscal-years`).send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` });
});
after(() => db.destroy());

async function saleWithPayment(code, name) {
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code, price_fcfa: 11210000 }]);
  const lot = await db('lots').where({ project_id: project.id, code }).first();
  const sale = (await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name, phone: `07${Math.floor(Math.random() * 1e8)}`, financing: 'comptant', reserved_at: today })).body;
  await comptable.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 500000, paid_at: today, method: 'especes' });
  return { sale, lot };
}

test('dossier de test : parcours complet jusqu’à la suppression définitive (dossier, lot, client ; écritures annulées gardées)', async () => {
  const { sale, lot } = await saleWithPayment('TST1', 'TEST CLIENT');
  const pay = await db('payments').where({ sale_id: sale.id }).first();
  await comptable.post(`${C}/sync`);
  const entry = await db('acc_entries').where({ source_key: `payment:${pay.id}` }).first();
  await comptable.post(`${C}/entries/validate`).send({ ids: [entry.id] });

  // 1. Versement encore présent : refusé, et réservé au super administrateur
  let pv = (await admin.get(`/api/admin/sales/${sale.id}/suppression`)).body;
  assert.match(pv.blockers.join(' '), /versement/);
  assert.equal((await comptable.get(`/api/admin/sales/${sale.id}/suppression`)).status, 403);
  assert.equal((await comptable.delete(`/api/admin/sales/${sale.id}`).send({ confirm: 'SUPPRIMER' })).status, 403);

  // 2. Versement supprimé, synchronisation : la contrepassation en brouillon bloque encore
  await comptable.delete(`/api/admin/payments/${pay.id}`);
  await comptable.post(`${C}/sync`);
  pv = (await admin.get(`/api/admin/sales/${sale.id}/suppression`)).body;
  assert.equal(pv.blockers.length, 1, JSON.stringify(pv.blockers));
  assert.match(pv.blockers[0], /validez-la/);
  assert.equal((await admin.delete(`/api/admin/sales/${sale.id}`).send({ confirm: 'SUPPRIMER' })).status, 409);

  // 3. Contrepassation validée : la suppression est possible ; confirmation exigée
  const rev = await db('acc_entries').where({ source_key: `reverse:payment:${pay.id}` }).first();
  await comptable.post(`${C}/entries/validate`).send({ ids: [rev.id] });
  pv = (await admin.get(`/api/admin/sales/${sale.id}/suppression`)).body;
  assert.deepEqual(pv.blockers, []);
  assert.equal(pv.client.can_delete, true);
  assert.equal((await admin.delete(`/api/admin/sales/${sale.id}`).send({})).status, 400, 'confirmation SUPPRIMER exigée');
  const res = await admin.delete(`/api/admin/sales/${sale.id}`).send({ confirm: 'SUPPRIMER', with_client: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.client_deleted, true);

  assert.equal(await db('sales').where({ id: sale.id }).first(), undefined, 'dossier supprimé');
  assert.equal(await db('leads').where({ id: sale.lead_id }).first(), undefined, 'client supprimé');
  assert.equal((await db('lots').where({ id: lot.id }).first()).status, 'disponible', 'lot remis en vente');
  assert.match((await db('lot_status_history').where({ lot_id: lot.id }).orderBy('id', 'desc').first()).reason, /supprimé définitivement/);
  assert.ok(await db('acc_entries').where({ id: entry.id }).first(), 'écriture validée conservée');
  assert.ok(await db('acc_entries').where({ id: rev.id }).first(), 'contrepassation conservée');
  // Plus rien à synchroniser, rien de recréé
  const sync = (await comptable.post(`${C}/sync`)).body;
  assert.equal(sync.created, 0);
  assert.equal(sync.reversed, 0);
  assert.equal((await db('acc_entries').where('source_key', 'like', `%payment:${pay.id}`)).length, 2);
});

test('dossier sans écriture validée : brouillons effacés ; client gardé s’il a un autre dossier', async () => {
  const a = await saleWithPayment('TST2', 'CLIENT DOUBLE');
  const leadId = a.sale.lead_id;
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'TST3', price_fcfa: 9000000 }]);
  const lot3 = await db('lots').where({ project_id: project.id, code: 'TST3' }).first();
  const lead = await db('leads').where({ id: leadId }).first();
  const b = (await admin.post(`/api/admin/lots/${lot3.id}/sale`).send({ lead_id: leadId, name: lead.name, phone: lead.phone, financing: 'comptant', reserved_at: today })).body;
  assert.equal(b.lead_id, leadId, 'même client, second dossier');

  const pay = await db('payments').where({ sale_id: a.sale.id }).first();
  await comptable.post(`${C}/sync`); // écriture du versement en brouillon
  await comptable.delete(`/api/admin/payments/${pay.id}`);
  const pv = (await admin.get(`/api/admin/sales/${a.sale.id}/suppression`)).body;
  assert.deepEqual(pv.blockers, []);
  assert.equal(pv.client.can_delete, false, 'autre dossier');
  const res = await admin.delete(`/api/admin/sales/${a.sale.id}`).send({ confirm: 'SUPPRIMER', with_client: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.client_deleted, false);
  assert.ok(await db('leads').where({ id: leadId }).first(), 'client gardé');
  assert.equal(await db('acc_entries').where({ source_key: `payment:${pay.id}` }).first(), undefined, 'brouillon effacé');
  assert.ok(await db('sales').where({ id: b.id }).first(), 'l’autre dossier reste');
});
