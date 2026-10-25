const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');
const { stockQuantityUnits, approAmounts, approRequiresDirection } = require('../src/lib/domain');
const A = '/api/admin/erp/achats', CH = '/api/admin/erp/chantiers';
const date = new Date().toISOString().slice(0, 10);
let db, app, admin, conducteur, comptable, direction, commercial, lecteur, article, depot, chantier, supplier, unit, worksite, ids;
const ok = (res, code = 200) => { assert.equal(res.status, code, JSON.stringify(res.body)); return res.body; };
const line = (quantity = 10, unit_price_fcfa = 1000) => ({ article_id: article.id, quantity, unit_price_fcfa });
const orderData = (lines = [line()], extra = {}) => ({ supplier_id: supplier.id, location_id: chantier.id, date, vat_rate: 18, lines, ...extra });
async function newOrder(agent, data = orderData()) { return ok(await agent.post(`${A}/orders`).send(data), 201); }
async function movement(kind, quantity, extra = {}) { return ok(await conducteur.post(`${A}/movements`).send({ kind, date, note: 'Mouvement de vérification', from_location_id: depot.id, to_location_id: chantier.id, lines: [{ article_id: article.id, quantity }], ...extra }), 201); }
// Circuit du bon de commande : l'émetteur désigne le validateur et soumet ; le validateur (Direction par défaut) décide.
async function confirmOrder(emitter, o, validator = direction, validatorId = ids.resp_exploitation) {
  await db('appro_orders').where({ id: o.id }).update({ approver_id: validatorId });
  ok(await emitter.post(`${A}/orders/${o.id}/submit`)); return ok(await validator.post(`${A}/orders/${o.id}/approve`));
}
async function quantity(locationId) { return Number((await db('appro_balances').where({ article_id: article.id, location_id: locationId }).first())?.quantity_units || 0) / 100; }
before(async () => {
  ({ db, app } = await setup()); admin = await login(app);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  direction = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  await db('roles').insert({ id: 'stock_lecture', label: 'Stock lecture' }); await db('role_permissions').insert({ role: 'stock_lecture', permission: 'appro:read' });
  require('../src/services/permissions').invalidate(db);
  lecteur = await login(app, await createUser(db, 'stock_lecture'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  const account = await db('acc_accounts').where({ code: '604100' }).first();
  const [sid] = await db('suppliers').insert({ name: 'Fournisseur matériaux test', kind: 'fournisseur', expense_account_id: account.id }); supplier = await db('suppliers').where({ id: sid }).first();
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  const manager = await db('users').where({ role: 'conducteur_travaux' }).first();
  worksite = ok(await conducteur.post(CH).send({ project_id: project.id, name: 'Chantier stock', zone_kind: 'programme', manager_id: manager.id }), 201);
  const [pid] = await db('places').insert({ kind: 'depot', name: 'Dépôt test' });
  depot = ok(await conducteur.post(`${A}/locations`).send({ place_id: pid }), 201);
  chantier = ok(await conducteur.post(`${A}/locations`).send({ worksite_id: worksite.id }), 201);
  unit = (await db('worksite_ref_items').where({ kind: 'unite', active: true }).first()).code;
  article = ok(await comptable.post(`${A}/articles`).send({ code: 'CIM-TEST', label: 'Ciment test', unit, min_quantity: 2 }), 201);
});
after(async () => { if (db) await db.destroy(); });

test('quantités exactes au centième, montants HT/TVA/TTC et plafond inclusif', () => {
  assert.equal(stockQuantityUnits(1.01), 101); assert.equal(stockQuantityUnits(0.001), null); assert.equal(stockQuantityUnits(-1), null);
  assert.deepEqual(approAmounts([{ quantity: 1.25, unit_price_fcfa: 1000 }], 18), { amount_ht: 1250, vat_amount: 225, amount_ttc: 1475 });
  assert.ok(approAmounts([{ quantity: 0, unit_price_fcfa: 10 }]).error);
  assert.equal(approRequiresDirection(500000, 500000), true); assert.equal(approRequiresDirection(499999, 500000), false);
});
test('accès des quatre rôles, lecture seule, refus commercial et session obligatoire', async () => {
  for (const agent of [admin, conducteur, comptable, direction]) { ok(await agent.get(`${A}/refs`)); ok(await agent.get(`${A}/settings`)); }
  ok(await lecteur.get(`${A}/stock`)); assert.equal((await lecteur.put(`${A}/settings`).send({ direction_threshold: 10 })).status, 403);
  assert.equal((await commercial.get(`${A}/refs`)).status, 403); assert.equal((await request(app).get(`${A}/stock`)).status, 401);
  assert.equal((await conducteur.get('/api/admin/erp/compta/meta')).status, 403, 'aucun droit comptable accordé au conducteur');
  ok(await comptable.get(`${A}/contracts`));
});
test('catalogue et emplacements : mêmes sources, unité utilisée figée, aller-retour et désactivation', async () => {
  const refs = ok(await admin.get(`${A}/refs`)); assert.ok(refs.suppliers.some(s => s.id === supplier.id));
  assert.equal((await conducteur.post(`${A}/locations`).send({ worksite_id: worksite.id })).status, 409);
  assert.equal((await conducteur.post(`${A}/locations`).send({ worksite_id: worksite.id, place_id: depot.place_id })).status, 400);
  assert.equal((await comptable.post(`${A}/articles`).send({ code: 'BAD', label: 'Mauvaise unité', unit: 'absente' })).status, 400);
  const updated = ok(await comptable.put(`${A}/articles/${article.id}`).send({ code: article.code, label: 'Ciment test', unit, min_quantity: 2.25, active: true })); assert.equal(updated.min_quantity, 2.25);
  assert.equal(ok(await conducteur.get(`${A}/articles`)).find(a => a.id === article.id).min_quantity, 2.25);
});
test('annuler un devis ne clôture pas la notification d’une commande portant le même identifiant', async () => {
  const q = ok(await conducteur.post(`${A}/quotes`).send(orderData()), 201), o = await newOrder(conducteur, orderData([line(100, 10000)]));
  assert.equal(q.id, o.id); await db('appro_orders').where({ id: o.id }).update({ approver_id: ids.resp_exploitation }); ok(await conducteur.post(`${A}/orders/${o.id}/submit`));
  const key = `appro:validation:${o.id}`, pending = () => db('notifications').where('dedupe_key', 'like', `${key}:%`).whereNull('read_at').first();
  assert.ok(await pending()); ok(await conducteur.post(`${A}/quotes/${q.id}/cancel`)); assert.ok(await pending());
  const recipient = await db('users').where({ role: 'resp_exploitation' }).first();
  await require('../src/services/notifications').notify(db, { to: recipient.id, module: 'achats', event: 'commande.a_valider', key: `${key}0`, title: 'Autre commande de test' });
  ok(await conducteur.post(`${A}/orders/${o.id}/cancel`)); assert.equal(await pending(), undefined, 'tâche du validateur résolue');
  assert.ok(await db('notifications').where({ dedupe_key: `${key}0` }).whereNull('read_at').first(), 'pas de collision entre les identifiants 1 et 10');
});
test('plafond réglable par les rôles cités, validation Direction et impossibilité de contourner une demande en attente', async () => {
  ok(await conducteur.put(`${A}/settings`).send({ direction_threshold: 11800 }));
  assert.equal((await conducteur.post(`${A}/orders`).send(orderData([line()], { approver_id: ids.comptable }))).status, 400, 'à partir du plafond, validateur de la Direction');
  const o = await newOrder(conducteur, orderData([line()], { approver_id: ids.resp_exploitation })); assert.equal(o.amount_ttc, 11800); assert.equal(o.approver_id, ids.resp_exploitation);
  let res = ok(await conducteur.post(`${A}/orders/${o.id}/submit`)); assert.equal(res.status, 'attente_direction'); assert.equal(res.approval_threshold, 11800);
  assert.equal((await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity: 1 }] })).status, 409);
  ok(await comptable.put(`${A}/settings`).send({ direction_threshold: 999999 }));
  assert.equal((await comptable.post(`${A}/orders/${o.id}/approve`)).status, 403, 'le changement de plafond ne contourne pas la validation demandée');
  assert.equal((await conducteur.post(`${A}/orders/${o.id}/approve`)).status, 403, 'l’émetteur ne valide pas sa commande');
  res = ok(await direction.post(`${A}/orders/${o.id}/approve`)); assert.equal(res.status, 'confirmee');
  assert.equal((await direction.post(`${A}/orders/${o.id}/approve`)).status, 409);
  assert.equal((await conducteur.put(`${A}/orders/${o.id}`).send(orderData())).status, 409);
});
test('refus motivé, annulation d’un brouillon et aucune modification comptable à la confirmation', async () => {
  ok(await direction.put(`${A}/settings`).send({ direction_threshold: 1 }));
  const before = Number((await db('purchase_invoices').count({ n: '*' }).first()).n), o = await newOrder(comptable, orderData([line()], { approver_id: ids.resp_exploitation }));
  ok(await comptable.post(`${A}/orders/${o.id}/submit`));
  assert.equal((await comptable.post(`${A}/orders/${o.id}/refuse`).send({ reason: 'Auto-refus' })).status, 403, 'l’émetteur ne refuse pas sa commande');
  assert.equal((await direction.post(`${A}/orders/${o.id}/refuse`).send({ reason: '' })).status, 400);
  assert.equal(ok(await direction.post(`${A}/orders/${o.id}/refuse`).send({ reason: 'Quantité à revoir' })).status, 'refusee');
  assert.equal(ok(await comptable.post(`${A}/orders/${o.id}/reopen`)).status, 'brouillon', 'reprise en brouillon pour correction');
  assert.equal(ok(await comptable.post(`${A}/orders/${o.id}/cancel`)).status, 'annulee');
  assert.equal(Number((await db('purchase_invoices').count({ n: '*' }).first()).n), before);
  ok(await direction.put(`${A}/settings`).send({ direction_threshold: 500000 }));
});
test('réceptions partielles, protection contre la sur-réception et facture séparée sans double comptabilisation', async () => {
  const o = await newOrder(comptable), start = await quantity(chantier.id); await confirmOrder(comptable, o);
  const count = Number((await db('purchase_invoices').count({ n: '*' }).first()).n);
  let d = ok(await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, supplier_ref: 'BL-001', lines: [{ order_line_id: o.lines[0].id, quantity: 4 }] }));
  assert.equal(d.status, 'partielle'); assert.equal(await quantity(chantier.id), start + 4);
  assert.equal(Number((await db('purchase_invoices').count({ n: '*' }).first()).n), count, 'la réception physique ne constate pas de dette');
  assert.equal((await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity: 7 }] })).status, 409);
  const invoice = { date, supplier_ref: 'FAC-001', expense_account: '604100' };
  assert.equal((await conducteur.post(`${A}/orders/${o.id}/invoice`).send(invoice)).status, 403);
  const bill = ok(await comptable.post(`${A}/orders/${o.id}/invoice`).send(invoice), 201); assert.equal(bill.amount_ttc, 4720); assert.equal(bill.status, 'brouillon');
  assert.equal((await comptable.post(`${A}/orders/${o.id}/invoice`).send(invoice)).status, 409);
  assert.equal(await db('acc_entries').where({ source: 'achat', source_key: `purchase:${bill.invoice_id}` }).first(), undefined);
  d = ok(await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity: 6 }] }));
  assert.equal(d.status, 'recue'); assert.equal(await quantity(chantier.id), start + 10);
  const bill2 = ok(await comptable.post(`${A}/orders/${o.id}/invoice`).send({ ...invoice, supplier_ref: 'FAC-002' }), 201); assert.equal(bill2.amount_ttc, 7080);
  assert.equal(ok(await comptable.get(`/api/admin/erp/compta/purchases/${bill.invoice_id}`)).number, bill.number);
});
test('stock négatif bloqué, transfert atomique, centièmes exacts et mouvement non rejouable', async () => {
  const input = await movement('entree', 10.25, { to_location_id: depot.id }); ok(await conducteur.post(`${A}/movements/${input.id}/post`));
  const start = await quantity(chantier.id), transfer = await movement('transfert', 3.25); ok(await conducteur.post(`${A}/movements/${transfer.id}/post`));
  assert.equal(await quantity(depot.id), 7); assert.equal(await quantity(chantier.id), start + 3.25);
  assert.equal((await conducteur.post(`${A}/movements/${transfer.id}/post`)).status, 409);
  const invalid = await movement('transfert', 8); assert.equal((await conducteur.post(`${A}/movements/${invalid.id}/post`)).status, 409);
  assert.equal(await quantity(depot.id), 7); assert.equal(await quantity(chantier.id), start + 3.25);
  assert.equal(ok(await conducteur.get(`${A}/movements/${invalid.id}`)).status, 'brouillon');
  const dup = await movement('sortie', 4); await db('appro_movement_lines').insert({ movement_id: dup.id, article_id: article.id, quantity_units: 400, label: 'Ciment test', unit });
  assert.equal((await conducteur.post(`${A}/movements/${dup.id}/post`)).status, 409); assert.equal(await quantity(depot.id), 7, 'rollback de toutes les lignes');
});
test('besoin exprimé par le chantier, commandé par les Achats (même quantité/unité, commande unique), livré à la réception', async () => {
  let n = ok(await conducteur.post(`${CH}/${worksite.id}/besoins`).send({ label: 'Ciment test', quantity: 2, unit }), 201);
  const data = orderData([{ ...line(2), need_id: n.id }]);
  assert.equal(ok(await conducteur.get(`${A}/dashboard`)).needs >= 1, true, 'besoin à traiter par les Achats');
  assert.equal((await conducteur.post(`${A}/orders`).send(orderData([{ ...line(1), need_id: n.id }]))).status, 400);
  const o = await newOrder(conducteur, data);
  assert.equal((await conducteur.post(`${A}/orders`).send(data)).status, 409);
  assert.equal(ok(await conducteur.get(`${A}/needs`)).find(x => x.id === n.id).order_id, o.id);
  assert.equal((await conducteur.post(`${A}/needs/${n.id}/refuse`).send({ reason: 'Déjà en stock' })).status, 409, 'pas de refus d’un besoin déjà dans un bon');
  await confirmOrder(conducteur, o); assert.equal((await db('worksite_needs').where({ id: n.id }).first()).status, 'commande');
  ok(await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity: 2 }] }));
  assert.equal((await db('worksite_needs').where({ id: n.id }).first()).status, 'livre');
});
test('demande de prix, devis reçu, conversion unique en commande et conservation de la saisie', async () => {
  const q = ok(await conducteur.post(`${A}/quotes`).send({ ...orderData(), supplier_ref: 'DEV-123', note: 'Transport inclus' }), 201);
  const reread = ok(await conducteur.get(`${A}/quotes/${q.id}`)); assert.equal(reread.supplier_ref, 'DEV-123'); assert.equal(reread.note, 'Transport inclus');
  ok(await conducteur.post(`${A}/quotes/${q.id}/received`));
  const a = ok(await conducteur.post(`${A}/quotes/${q.id}/order`), 201), b = ok(await conducteur.post(`${A}/quotes/${q.id}/order`), 201);
  assert.equal(a.id, b.id); assert.equal(a.lines[0].quantity, 10); assert.equal(a.lines[0].unit_price_fcfa, 1000);
  assert.equal((await conducteur.put(`${A}/quotes/${q.id}`).send(orderData())).status, 409);
});
test('seuil de rupture par emplacement, alertes et historique des actions', async () => {
  ok(await conducteur.put(`${A}/stock/minimum`).send({ article_id: article.id, location_id: depot.id, min_quantity: 10 }));
  const stocks = ok(await conducteur.get(`${A}/stock`)); assert.equal(stocks.find(b => b.location_id === depot.id && b.article_id === article.id).low, true);
  assert.ok(await db('notifications').where({ module: 'achats', event: 'stock.bas' }).first());
  const stats = ok(await conducteur.get(`${A}/dashboard`)); assert.ok(stats.low_stock.length > 0); assert.ok(stats.committed_fcfa >= 0);
  const moves = ok(await conducteur.get(`${A}/movements`)); const posted = moves.find(m => m.status === 'valide');
  assert.ok(ok(await conducteur.get(`${A}/movements/${posted.id}`)).events.some(e => e.action === 'validation' || e.action === 'reception'));
  const prefs = ok(await conducteur.put('/api/admin/erp/notifications/preferences').send({ module: 'achats', enabled: false, sound: null })); assert.equal(prefs.prefs.achats.enabled, false);
});
test('arrondis des réceptions partielles : total facturé identique au bon de commande au franc près', async () => {
  const baseline = ok(await comptable.get(`${A}/dashboard`)).committed_fcfa;
  const o = await newOrder(comptable, orderData([line(1.01, 101)])); await confirmOrder(comptable, o);
  ok(await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity: 0.5 }] }));
  const a = ok(await comptable.post(`${A}/orders/${o.id}/invoice`).send({ date, supplier_ref: 'ARR-1', expense_account: '604100' }), 201);
  assert.equal(ok(await comptable.get(`${A}/dashboard`)).committed_fcfa, baseline + o.amount_ttc - a.amount_ttc);
  ok(await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity: 0.51 }] }));
  const b = ok(await comptable.post(`${A}/orders/${o.id}/invoice`).send({ date, supplier_ref: 'ARR-2', expense_account: '604100' }), 201);
  assert.equal(a.amount_ht + b.amount_ht, o.amount_ht); assert.equal(a.vat_amount + b.vat_amount, o.vat_amount); assert.equal(a.amount_ttc + b.amount_ttc, o.amount_ttc);
  assert.equal(ok(await comptable.get(`${A}/dashboard`)).committed_fcfa, baseline);
});
test('sortie antidatée refusée et deux sorties concurrentes ne peuvent consommer deux fois le même stock', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10), old = await quantity(depot.id);
  const backdated = await movement('sortie', 1, { date: yesterday }); assert.equal((await conducteur.post(`${A}/movements/${backdated.id}/post`)).status, 409); assert.equal(await quantity(depot.id), old);
  const a = await movement('sortie', old), b = await movement('sortie', old);
  const results = await Promise.all([conducteur.post(`${A}/movements/${a.id}/post`), conducteur.post(`${A}/movements/${b.id}/post`)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(await quantity(depot.id), 0);
});
test('réception et validation de mouvement futures refusées sans modifier le stock', async () => {
  const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10), current = await quantity(chantier.id);
  const o = await newOrder(comptable); await confirmOrder(comptable, o);
  assert.equal((await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date: future, lines: [{ order_line_id: o.lines[0].id, quantity: 1 }] })).status, 400);
  const m = await movement('entree', 10, { date: future, to_location_id: chantier.id }); assert.equal((await conducteur.post(`${A}/movements/${m.id}/post`)).status, 400);
  assert.equal(await quantity(chantier.id), current); assert.equal(ok(await conducteur.get(`${A}/orders/${o.id}`)).receipts.length, 0);
});
test('brouillon supprimé en Comptabilité : réception libérée ; référence fournisseur existante protégée', async () => {
  const o = await newOrder(comptable, orderData([line(1)])); await confirmOrder(comptable, o);
  const received = ok(await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity: 1 }] }));
  const body = { date, supplier_ref: 'FAC-PONT', expense_account: '604100' };
  const bill = ok(await comptable.post(`${A}/orders/${o.id}/invoice`).send(body), 201);
  ok(await comptable.delete(`/api/admin/erp/compta/purchases/${bill.invoice_id}`));
  assert.equal(ok(await conducteur.get(`${A}/orders/${o.id}`)).receipts[0].invoice_id, null);
  ok(await comptable.post(`${A}/orders/${o.id}/invoice`).send({ ...body, receipt_ids: [received.receipts[0].id] }), 201);
  const other = await newOrder(comptable, orderData([line(1)])); await confirmOrder(comptable, other);
  ok(await conducteur.post(`${A}/orders/${other.id}/receive`).send({ date, lines: [{ order_line_id: other.lines[0].id, quantity: 1 }] }));
  assert.equal((await comptable.post(`${A}/orders/${other.id}/invoice`).send({ ...body, supplier_ref: 'fac-pont' })).status, 409);
});
test('article déjà utilisé : refus de changement d’unité, conservation d’une unité désactivée', async () => {
  const other = await db('worksite_ref_items').where({ kind: 'unite' }).whereNot({ code: unit }).first();
  const body = { code: article.code, label: 'Ciment test', unit, min_quantity: 2.25, active: true };
  assert.equal((await comptable.put(`${A}/articles/${article.id}`).send({ ...body, unit: other.code })).status, 409);
  await db('worksite_ref_items').where({ kind: 'unite', code: unit }).update({ active: false });
  assert.equal(ok(await comptable.put(`${A}/articles/${article.id}`).send(body)).unit, unit);
  await db('worksite_ref_items').where({ kind: 'unite', code: unit }).update({ active: true });
});



test('émetteur et validateur désigné : liste des validateurs, auto-validation interdite, substitution de la Direction', async () => {
  const list = ok(await conducteur.get(`${A}/approvers`)), find = id => list.find(u => u.id === id);
  assert.deepEqual([find(ids.comptable).validate, find(ids.comptable).direction], [true, false]);
  assert.equal(find(ids.resp_exploitation).direction, true); assert.equal(find(ids.commercial), undefined, 'sans droit de valider');
  assert.ok(ok(await conducteur.get(`${A}/refs`)).approvers.some(u => u.id === ids.comptable));
  assert.equal((await conducteur.post(`${A}/orders`).send(orderData([line(1)], { approver_id: ids.conducteur_travaux }))).status, 400, 'pas soi-même');
  assert.equal((await conducteur.post(`${A}/orders`).send(orderData([line(1)], { approver_id: ids.commercial }))).status, 400, 'droit de valider requis');
  const bare = await newOrder(conducteur, orderData([line(1)])); assert.equal((await conducteur.post(`${A}/orders/${bare.id}/submit`)).status, 400, 'validateur obligatoire à la soumission');
  assert.equal((await conducteur.post(`${A}/orders/${bare.id}/approve`)).status, 409, 'un brouillon se soumet d’abord');
  const o = await newOrder(conducteur, orderData([line(1)], { approver_id: ids.comptable }));
  let d = ok(await conducteur.get(`${A}/orders/${o.id}`));
  assert.equal(d.created_by_name, 'conducteur_travaux'); assert.equal(d.approver_name, 'comptable'); assert.ok(d.created_by_role);
  d = ok(await conducteur.post(`${A}/orders/${o.id}/submit`)); assert.equal(d.status, 'a_valider'); assert.equal(d.status_label, 'À valider');
  const bell = await db('notifications').where({ event: 'commande.soumise', user_id: ids.comptable }).first();
  assert.equal(bell.priority, 'action'); assert.equal(bell.link, `/achats/commandes?fiche=${o.id}`); assert.ok(bell.body.includes('conducteur_travaux'));
  assert.equal(await db('notifications').where({ event: 'commande.soumise', user_id: ids.conducteur_travaux }).first(), undefined);
  assert.equal(ok(await conducteur.get(`${A}/orders?status=a_valider,attente_direction`)).some(x => x.id === o.id), true);
  assert.equal((await conducteur.post(`${A}/orders/${o.id}/approve`)).status, 403);
  d = ok(await comptable.post(`${A}/orders/${o.id}/approve`)); assert.equal(d.status, 'confirmee'); assert.equal(d.approved_by_name, 'comptable');
  assert.ok(bell && (await db('notifications').where({ id: bell.id }).first()).read_at, 'tâche du validateur résolue');
  assert.deepEqual(d.events.map(e => e.action).slice(0, 3), ['confirmation', 'soumission', 'creation']);
  const other = await newOrder(conducteur, orderData([line(1)], { approver_id: ids.comptable })); ok(await conducteur.post(`${A}/orders/${other.id}/submit`));
  d = ok(await direction.post(`${A}/orders/${other.id}/approve`)); assert.equal(d.status, 'confirmee');
  assert.equal(d.events[0].details.substitute, true);
  assert.ok(await db('notifications').where({ event: 'commande.confirmee', user_id: ids.comptable, dedupe_key: `appro:commande:${other.id}:confirmee` }).first(), 'validateur remplacé informé');
});
test('circuit complet : émission, validation, réception, facture puis règlement tracé sur la commande', async () => {
  ok(await conducteur.put('/api/admin/erp/notifications/preferences').send({ module: 'achats', enabled: true, sound: null }), 200);
  const o = await newOrder(conducteur, orderData([line(2)], { approver_id: ids.comptable }));
  ok(await conducteur.post(`${A}/orders/${o.id}/submit`)); ok(await comptable.post(`${A}/orders/${o.id}/approve`));
  ok(await conducteur.post(`${A}/orders/${o.id}/receive`).send({ date, lines: [{ order_line_id: o.lines[0].id, quantity: 2 }] }));
  const bill = ok(await comptable.post(`${A}/orders/${o.id}/invoice`).send({ date, supplier_ref: 'FAC-CIRCUIT', expense_account: '604100' }), 201);
  const year = date.slice(0, 4); ok(await comptable.post('/api/admin/erp/compta/fiscal-years').send({ label: year, start_date: `${year}-01-01`, end_date: `${year}-12-31` }), 201);
  ok(await comptable.post(`/api/admin/erp/compta/purchases/${bill.invoice_id}/validate`));
  const bq = (await db('acc_journals').where({ code: 'BQ' }).first()).id;
  ok(await comptable.post(`/api/admin/erp/compta/purchases/${bill.invoice_id}/payments`).send({ date, amount: 1000, journal_id: bq }), 201);
  let d = ok(await conducteur.get(`${A}/orders/${o.id}`));
  assert.deepEqual(d.invoices.map(i => [i.number, i.status, i.amount_ttc, i.paid_fcfa]), [[bill.number, 'validee', 2360, 1000]]);
  assert.equal(d.events[0].action, 'paiement'); assert.equal(d.events[0].details.remaining, 1360);
  const n = await db('notifications').where({ event: 'commande.payee', user_id: ids.conducteur_travaux }).first(); assert.ok(n.title.includes('Règlement partiel'));
  ok(await comptable.post(`/api/admin/erp/compta/purchases/${bill.invoice_id}/payments`).send({ date, amount: 1360, journal_id: bq }), 201);
  d = ok(await conducteur.get(`${A}/orders/${o.id}`)); assert.equal(d.invoices[0].paid_fcfa, 2360);
  assert.ok(await db('notifications').where({ event: 'commande.payee', user_id: ids.conducteur_travaux }).where('title', 'like', 'Facture réglée%').first());
});
test('émetteur choisi parmi les comptes habilités ; super administrateur seul autorisé à valider sa commande', async () => {
  const refs = ok(await comptable.get(`${A}/refs`));
  assert.ok(refs.issuers.some(u => u.id === ids.conducteur_travaux)); assert.equal(refs.issuers.some(u => u.id === ids.commercial), false);
  assert.equal(refs.approvers.find(u => u.id === ids.super_admin).super_admin, true);
  assert.equal((await comptable.post(`${A}/orders`).send(orderData([line(1)], { issuer_id: ids.commercial }))).status, 400, 'émetteur sans droit de préparer les achats');
  assert.equal((await comptable.post(`${A}/orders`).send(orderData([line(1)], { issuer_id: ids.conducteur_travaux, approver_id: ids.conducteur_travaux }))).status, 400, 'émetteur validateur');
  assert.equal((await comptable.post(`${A}/orders`).send(orderData([line(1)], { issuer_id: ids.conducteur_travaux, approver_id: ids.comptable }))).status, 400, 'auteur de la saisie validateur');
  const o = await newOrder(comptable, orderData([line(1)], { issuer_id: ids.conducteur_travaux, approver_id: ids.resp_exploitation }));
  assert.equal(o.issuer_id, ids.conducteur_travaux); assert.equal(o.issuer_name, 'conducteur_travaux'); assert.equal(o.created_by_name, 'comptable');
  assert.equal((await comptable.put(`${A}/orders/${o.id}`).send(orderData([line(1)], { issuer_id: ids.conducteur_travaux, approver_id: ids.resp_exploitation }))).status, 200);
  ok(await comptable.post(`${A}/orders/${o.id}/submit`));
  assert.ok(await db('notifications').where({ event: 'commande.soumise', user_id: ids.resp_exploitation }).where('body', 'like', '%émise par conducteur_travaux%').first());
  assert.equal((await conducteur.post(`${A}/orders/${o.id}/approve`)).status, 403, 'l’émetteur ne valide pas');
  assert.equal((await comptable.post(`${A}/orders/${o.id}/approve`)).status, 403, 'l’auteur de la saisie ne valide pas');
  assert.equal(ok(await direction.post(`${A}/orders/${o.id}/approve`)).status, 'confirmee');
  // Besoin personnel du directeur général : il émet, valide, puis la Comptabilité contrôle facture et règlement.
  const own = await newOrder(admin, orderData([line(600)], { approver_id: ids.super_admin }));
  assert.equal(own.issuer_id, ids.super_admin, 'émetteur par défaut : compte connecté');
  assert.equal(ok(await admin.post(`${A}/orders/${own.id}/submit`)).status, 'attente_direction');
  const done = ok(await admin.post(`${A}/orders/${own.id}/approve`)); assert.equal(done.status, 'confirmee'); assert.equal(done.approved_by_name, done.issuer_name);
});
test('préparer la commande d’un besoin : emplacement du chantier, article du catalogue, prix estimé, fournisseur et note repris', async () => {
  const n = ok(await conducteur.post(`${CH}/${worksite.id}/besoins`).send({ label: '  ciment TEST ', quantity: 4, unit, estimate_fcfa: 10000, supplier_id: supplier.id, needed_on: date, note: 'Dalle du bloc B' }), 201);
  assert.equal((await lecteur.post(`${A}/needs/${n.id}/prepare`)).status, 403, 'préparer les achats requis');
  let p = ok(await conducteur.post(`${A}/needs/${n.id}/prepare`));
  assert.deepEqual([p.location_id, p.article_id, p.suggestion, p.unit_price_fcfa, p.supplier_id, p.needed_on], [chantier.id, article.id, null, 2500, supplier.id, date], 'même désignation (casse, espaces) et même unité');
  assert.ok(p.note.includes('Dalle du bloc B') && p.note.includes(worksite.reference));
  // Chantier sans emplacement de stock : créé une seule fois ; article absent : code proposé
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  const other = ok(await conducteur.post(CH).send({ project_id: project.id, name: 'Chantier sans stock', zone_kind: 'programme', manager_id: ids.conducteur_travaux }), 201);
  const m = ok(await conducteur.post(`${CH}/${other.id}/besoins`).send({ label: 'Pointe de 10', quantity: 20, unit }), 201);
  p = ok(await conducteur.post(`${A}/needs/${m.id}/prepare`));
  const loc = await db('appro_locations').where({ worksite_id: other.id }).first();
  assert.equal(p.location_id, loc.id); assert.equal(p.article_id, null); assert.equal(p.unit_price_fcfa, null);
  assert.deepEqual(p.suggestion, { code: 'POINTE-DE-10', label: 'Pointe de 10', unit });
  assert.equal(ok(await conducteur.post(`${A}/needs/${m.id}/prepare`)).location_id, loc.id, 'pas de second emplacement');
  const created = ok(await comptable.post(`${A}/articles`).send({ ...p.suggestion, min_quantity: 0, active: true }), 201);
  assert.equal(ok(await conducteur.post(`${A}/needs/${m.id}/prepare`)).article_id, created.id);
  const o = await newOrder(conducteur, { supplier_id: supplier.id, location_id: loc.id, date, vat_rate: 18, lines: [{ article_id: created.id, quantity: 20, unit_price_fcfa: 50, need_id: m.id }] });
  assert.equal(o.lines[0].need_id, m.id);
  assert.equal((await conducteur.post(`${A}/needs/${m.id}/prepare`)).status, 200, 'préparation relançable tant que le bon n’est pas validé');
});
test('catalogue : géré par le privilège dédié ; besoin chantier choisi dans le catalogue ou hors catalogue puis rattaché', async () => {
  assert.equal((await conducteur.post(`${A}/articles`).send({ code: 'COND-1', label: 'Essai conducteur', unit })).status, 403, 'le conducteur consulte le catalogue sans le gérer');
  const buyer = await login(app, await createUser(db, 'resp_achats'), 'motdepasse-test-123');
  const sable = ok(await buyer.post(`${A}/articles`).send({ code: 'SAB-01', label: 'Sable lagunaire', unit, min_quantity: 0 }), 201);
  assert.ok(ok(await conducteur.get(`${CH}/refs`)).articles.some(a => a.id === sable.id), 'catalogue proposé au chantier');
  const n = ok(await conducteur.post(`${CH}/${worksite.id}/besoins`).send({ label: 'texte ignoré', quantity: 3, unit: 'autre', article_id: sable.id }), 201);
  assert.deepEqual([n.label, n.unit, n.article_id, n.off_catalog], ['Sable lagunaire', unit, sable.id, false], 'désignation et unité du catalogue');
  assert.equal(ok(await conducteur.post(`${A}/needs/${n.id}/prepare`)).article_id, sable.id);
  assert.equal((await conducteur.post(`${A}/orders`).send(orderData([{ ...line(3), need_id: n.id }]))).status, 400, 'l’article choisi par le chantier s’impose');
  ok(await conducteur.post(`${A}/needs/${n.id}/refuse`).send({ reason: 'Essai' }));
  const free = ok(await conducteur.post(`${CH}/${worksite.id}/besoins`).send({ label: 'Clous spéciaux', quantity: 2, unit }), 201);
  assert.equal(free.off_catalog, true);
  await newOrder(conducteur, orderData([{ ...line(2), need_id: free.id }]));
  assert.equal((await db('worksite_needs').where({ id: free.id }).first()).article_id, article.id, 'besoin hors catalogue rattaché à l’article commandé');
});
test('import CSV du catalogue : séparateur « ; », virgule décimale, mise à jour par code, tout ou rien avec lignes fautives signalées', async () => {
  const label = (await db('worksite_ref_items').where({ kind: 'unite', code: unit }).first()).label;
  assert.equal((await conducteur.post(`${A}/articles/import`).send({ csv: 'code;désignation;unité\nX;Y;' + unit })).status, 403);
  let r = ok(await comptable.post(`${A}/articles/import`).send({ csv: `﻿Code;Désignation;Unité;Seuil\nPARP-15;Parpaing de 15;${label};12,5\nPARP-15;Doublon;${unit};\nBAD;Article;inconnue;1\n` }));
  assert.equal(r.ok, false); assert.deepEqual(r.errors.map(e => e.line), [3, 4]);
  assert.equal(await db('appro_articles').where({ code: 'PARP-15' }).first(), undefined, 'rien n’est enregistré en cas d’erreur');
  r = ok(await comptable.post(`${A}/articles/import`).send({ csv: `code,désignation,unité,seuil\nPARP-15,"Parpaing de 15, creux",${unit},"12,5"\n${article.code},Ciment test importé,${unit},3\n` }));
  assert.deepEqual([r.ok, r.created, r.updated], [true, 1, 1]);
  const parp = await db('appro_articles').where({ code: 'PARP-15' }).first();
  assert.deepEqual([parp.label, Number(parp.min_units)], ['Parpaing de 15, creux', 1250]);
  assert.equal((await db('appro_articles').where({ id: article.id }).first()).label, 'Ciment test importé');
  assert.equal(ok(await comptable.post(`${A}/articles/import`).send({ csv: 'nom;prix\nA;1' })).errors[0].line, 1, 'en-tête contrôlé');
});
