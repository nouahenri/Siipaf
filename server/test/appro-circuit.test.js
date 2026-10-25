const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { INFO_EVENTS } = require('../src/lib/domain');
const { saveInfoRoutes, inform } = require('../src/services/notifications');

const A = '/api/admin/erp/achats', N = '/api/admin/erp/notifications';
const date = new Date().toISOString().slice(0, 10);
const events = ['devis.recu', 'commande.soumise', 'commande.a_valider', 'commande.confirmee', 'commande.refusee', 'commande.annulee', 'appro.reception', 'stock.entree', 'stock.sortie', 'stock.transfert', 'stock.bas', 'commande.payee', 'appro.facture'];
let db, app, admin, conducteur, comptable, direction, observer, commercial, ids, article, depot, chantier, supplier;
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
const orderData = (quantity = 10, price = 1000) => ({ supplier_id: supplier.id, location_id: chantier.id, date, vat_rate: 18, lines: [{ article_id: article.id, quantity, unit_price_fcfa: price }] });
const order = async (quantity = 10) => ok(await comptable.post(`${A}/orders`).send(orderData(quantity)), 201);
const notices = (event, id = null) => { const q = db('notifications').where({ event }); return id == null ? q : q.where({ user_id: id }); };
// L'émetteur désigne le validateur puis soumet la commande.
const submit = async (o, approverId) => { await db('appro_orders').where({ id: o.id }).update({ approver_id: approverId }); ok(await comptable.post(`${A}/orders/${o.id}/submit`)); };
const override = (userId, permission, granted) => db('user_permissions').insert({ user_id: userId, permission, granted });

before(async () => {
  ({ db, app } = await setup()); admin = await login(app);
  for (const [role, permissions] of Object.entries({ circuit_observer: ['sav:handle', 'appro:read'], circuit_blind: ['appro:direction', 'direction:read'], circuit_finance: ['compta:entries'] })) {
    await db('roles').insert({ id: role, label: role });
    await db('role_permissions').insert(permissions.map(permission => ({ role, permission })));
  }
  require('../src/services/permissions').invalidate(db);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  direction = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  observer = await login(app, await createUser(db, 'circuit_observer'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  await createUser(db, 'circuit_blind'); await createUser(db, 'circuit_finance');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  const account = await db('acc_accounts').where({ code: '604100' }).first();
  const [sid] = await db('suppliers').insert({ name: 'Fournisseur circuit', kind: 'fournisseur', expense_account_id: account.id }); supplier = { id: sid };
  const place = await db('places').first(), project = await db('projects').where({ slug: 'ahoutoue' }).first();
  const w = ok(await conducteur.post('/api/admin/erp/chantiers').send({ project_id: project.id, name: 'Chantier circuit', zone_kind: 'programme', manager_id: ids.resp_exploitation }), 201);
  depot = ok(await conducteur.post(`${A}/locations`).send({ place_id: place.id }), 201);
  chantier = ok(await conducteur.post(`${A}/locations`).send({ worksite_id: w.id }), 201);
  const unit = (await db('worksite_ref_items').where({ kind: 'unite', active: true }).first()).code;
  article = ok(await comptable.post(`${A}/articles`).send({ code: 'CIRCUIT', label: 'Matériau circuit', unit, min_quantity: 0 }), 201);
});
beforeEach(async () => {
  await db('notifications').del(); await db('app_settings').where({ key: 'info_routes' }).del();
  await db('user_permissions').whereIn('user_id', Object.values(ids)).del();
  await db('users').whereIn('id', Object.values(ids)).update({ active: true, notif_prefs: null });
  await db('appro_settings').where({ id: 1 }).update({ direction_threshold: 500000 });
});
after(() => db.destroy());

test('circuit Achats : catalogue administrable, treize événements, conservation des autres réglages', async () => {
  const before = ok(await admin.get(`${N}/circuit`));
  assert.ok(before.audiences.achats);
  for (const key of events) { const e = before.events.find(e => e.key === key); assert.ok(e, key); assert.ok(e.hint); assert.equal(e.requiredPerms, undefined); }
  assert.equal((await comptable.put(`${N}/circuit`).send({ 'appro.reception': ['sav'] })).status, 403);
  ok(await admin.put(`${N}/circuit`).send({ 'vente.ouverte': ['juridique'], 'appro.reception': ['sav'] }));
  const reread = ok(await admin.get(`${N}/circuit`));
  assert.deepEqual(reread.events.find(e => e.key === 'appro.reception').audiences, ['sav']);
  assert.deepEqual(reread.events.find(e => e.key === 'vente.ouverte').audiences, ['juridique']);
  assert.deepEqual(reread.events.find(e => e.key === 'chantier.cree').audiences, before.events.find(e => e.key === 'chantier.cree').audiences);
});

test('commande à approuver : accès ET validation requis, retrait individuel respecté, tâche résolue', async () => {
  await saveInfoRoutes(db, { 'commande.a_valider': ['sav', 'achats', 'dg', 'exploitation'] });
  const o = await order(600); await submit(o, ids.resp_exploitation);
  const rows = await notices('commande.a_valider');
  assert.ok(rows.some(n => n.user_id === ids.resp_exploitation));
  assert.ok(rows.some(n => n.user_id === ids.super_admin));
  for (const role of ['conducteur_travaux', 'comptable', 'circuit_observer', 'commercial', 'circuit_blind', 'circuit_finance']) assert.equal(rows.some(n => n.user_id === ids[role]), false, role);
  ok(await direction.post(`${A}/orders/${o.id}/approve`));
  assert.ok((await notices('commande.a_valider')).every(n => n.read_at));
  await override(ids.resp_exploitation, 'appro:direction', false);
  const next = await order(601);
  await db('appro_orders').where({ id: next.id }).update({ approver_id: ids.resp_exploitation });
  assert.equal((await comptable.post(`${A}/orders/${next.id}/submit`)).status, 400, 'validateur privé de son droit refusé');
  await submit(next, ids.super_admin);
  assert.equal(await notices('commande.a_valider', ids.resp_exploitation).where('dedupe_key', 'like', `appro:validation:${next.id}:%`).first(), undefined);
});

test('devis, décisions et réceptions : services choisis, personnes concernées et une notification par événement', async () => {
  await saveInfoRoutes(db, Object.fromEntries(events.filter(e => e !== 'commande.a_valider').map(e => [e, ['sav']])));
  const q = ok(await comptable.post(`${A}/quotes`).send(orderData()), 201);
  ok(await conducteur.post(`${A}/quotes/${q.id}/received`));
  assert.equal((await notices('devis.recu', ids.circuit_observer).first()).module, 'sav');
  assert.ok(await notices('devis.recu', ids.comptable).first(), 'créateur directement prévenu');
  const o = ok(await conducteur.post(`${A}/quotes/${q.id}/order`), 201);
  await submit(o, ids.comptable); ok(await comptable.post(`${A}/orders/${o.id}/approve`));
  assert.equal((await notices('commande.confirmee', ids.circuit_observer)).length, 1);
  const receive = quantity => conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity }] });
  ok(await receive(4)); ok(await receive(6));
  const received = await notices('appro.reception', ids.circuit_observer);
  assert.equal(received.length, 2); assert.equal(new Set(received.map(n => n.dedupe_key)).size, 2);
  assert.ok(received.every(n => n.module === 'sav' && n.link === `/achats/commandes?fiche=${o.id}`));
  assert.ok(received.some(n => n.title.includes('partielle'))); assert.ok(received.some(n => n.title.includes('complète')));
  assert.equal((await receive(1)).status, 409); assert.equal((await notices('appro.reception', ids.circuit_observer)).length, 2);
  assert.ok(await notices('appro.reception', ids.resp_exploitation).first(), 'conducteur du chantier directement prévenu');
  const refused = await order(600); await submit(refused, ids.resp_exploitation);
  ok(await direction.post(`${A}/orders/${refused.id}/refuse`).send({ reason: 'Prix à revoir' }));
  ok(await comptable.post(`${A}/orders/${refused.id}/cancel`));
  assert.equal((await notices('commande.refusee', ids.circuit_observer)).length, 1);
  assert.equal((await notices('commande.annulee', ids.circuit_observer)).length, 1);
});

test('mouvements validés : entrée, sortie, transfert ; aucun envoi pour un brouillon ou une validation rejetée', async () => {
  await saveInfoRoutes(db, { 'stock.entree': ['sav'], 'stock.sortie': ['sav'], 'stock.transfert': ['sav'] });
  async function move(kind, quantity, extra = {}) {
    return ok(await conducteur.post(`${A}/movements`).send({ kind, quantity, date, from_location_id: depot.id, to_location_id: depot.id, note: 'Circuit mouvement', lines: [{ article_id: article.id, quantity }], ...extra }), 201);
  }
  const input = await move('entree', 12);
  assert.equal((await notices('stock.entree')).length, 0);
  ok(await conducteur.post(`${A}/movements/${input.id}/post`));
  const output = await move('sortie', 2); ok(await conducteur.post(`${A}/movements/${output.id}/post`));
  const transfer = await move('transfert', 3, { to_location_id: chantier.id }); ok(await conducteur.post(`${A}/movements/${transfer.id}/post`));
  for (const e of ['stock.entree', 'stock.sortie', 'stock.transfert']) {
    const rows = await notices(e, ids.circuit_observer); assert.equal(rows.length, 1); assert.equal(rows[0].module, 'sav'); assert.ok(rows[0].link.includes('mouvement='));
    assert.equal((await notices(e, ids.conducteur_travaux)).length, 0, 'auteur exclu');
  }
  const bad = await move('sortie', 1000000); assert.equal((await conducteur.post(`${A}/movements/${bad.id}/post`)).status, 409);
  assert.equal((await notices('stock.sortie', ids.circuit_observer)).length, 1);
  assert.equal((await conducteur.post(`${A}/movements/${transfer.id}/post`)).status, 409);
  assert.equal((await notices('stock.transfert', ids.circuit_observer)).length, 1);
});

test('réception : privilège individuel accordé/retiré, compte inactif, créateur sans accès et préférences respectés', async () => {
  await saveInfoRoutes(db, { 'appro.reception': ['sav', 'achats', 'compta'] });
  await override(ids.commercial, 'sav:handle', true); await override(ids.commercial, 'appro:read', true);
  const o = await order(); await submit(o, ids.conducteur_travaux); ok(await conducteur.post(`${A}/orders/${o.id}/approve`));
  const receive = quantity => conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity }] });
  ok(await receive(1));
  assert.equal((await notices('appro.reception', ids.commercial)).length, 1, 'privilèges individuels admis');
  assert.equal((await notices('appro.reception', ids.comptable)).length, 1, 'pas de doublon malgré plusieurs services');
  await override(ids.comptable, 'appro:read', false);
  await override(ids.circuit_observer, 'appro:read', false);
  await db('users').where({ id: ids.commercial }).update({ active: false });
  ok(await receive(1));
  assert.equal((await notices('appro.reception', ids.comptable)).length, 1, 'le créateur ayant perdu son accès ne reçoit plus les suivantes');
  assert.equal((await notices('appro.reception', ids.circuit_observer)).length, 1, 'retrait individuel pris en compte');
  assert.equal((await notices('appro.reception', ids.commercial)).length, 1, 'compte désactivé exclu');
  await db('user_permissions').where({ user_id: ids.circuit_observer }).del();
  ok(await observer.put(`${N}/preferences`).send({ module: 'sav', enabled: false }));
  ok(await receive(1));
  assert.equal((await notices('appro.reception', ids.circuit_observer)).length, 1, 'préférence du module destinataire respectée');
});

test('facture : information configurable dans la cloche, seuls les comptes avec accès comptable la reçoivent', async () => {
  await saveInfoRoutes(db, { 'appro.facture': ['sav', 'compta', 'achats'] });
  const o = await order(); await submit(o, ids.conducteur_travaux); ok(await conducteur.post(`${A}/orders/${o.id}/approve`));
  ok(await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity: 2 }] }));
  const invoice = ok(await admin.post(`${A}/orders/${o.id}/invoice`).send({ date, supplier_ref: 'CIRCUIT-FACTURE', expense_account: '604100' }), 201);
  const row = await notices('appro.facture', ids.comptable).first(); assert.ok(row); assert.equal(row.module, 'compta'); assert.equal(row.link, '/compta/achats');
  assert.equal((await notices('appro.facture', ids.circuit_finance)).length, 0, 'droit de saisie seul sans lecture insuffisant');
  assert.equal((await notices('appro.facture', ids.circuit_observer)).length, 0, 'service coché sans accès comptable exclu');
  assert.equal((await notices('appro.facture', ids.conducteur_travaux)).length, 0);
  assert.equal((await db('purchase_invoices').where({ id: invoice.invoice_id }).first()).status, 'brouillon');
});

test('alerte de stock : circuit configurable, pas de doublon entre services, résolution et événements existants inchangés', async () => {
  await saveInfoRoutes(db, { 'stock.bas': ['sav', 'achats', 'compta'] });
  ok(await conducteur.put(`${A}/stock/minimum`).send({ article_id: article.id, location_id: depot.id, min_quantity: 9999 }));
  let rows = await notices('stock.bas', ids.circuit_observer); assert.equal(rows.length, 1); assert.equal(rows[0].module, 'sav');
  ok(await conducteur.put(`${A}/stock/minimum`).send({ article_id: article.id, location_id: depot.id, min_quantity: 9999 }));
  assert.equal((await notices('stock.bas', ids.circuit_observer)).length, 1);
  ok(await conducteur.put(`${A}/stock/minimum`).send({ article_id: article.id, location_id: depot.id, min_quantity: 0 }));
  assert.ok((await notices('stock.bas')).every(n => n.read_at), 'résolution dans tous les modules destinataires');
  await saveInfoRoutes(db, { 'vente.ouverte': ['sav'] });
  await override(ids.circuit_observer, 'appro:read', false);
  await inform(db, 'vente.ouverte', { title: 'Circuit existant conservé', key: 'test:legacy:vente' });
  assert.ok(await notices('vente.ouverte', ids.circuit_observer).first(), 'les règles des anciens événements ne sont pas modifiées');
  assert.equal(INFO_EVENTS['vente.ouverte'].requiredPerms, undefined);
});
