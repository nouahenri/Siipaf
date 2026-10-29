/**
 * Besoins de tous les services (demande du client du 29/10, point 3) : demande d'achat validée → Achats › Besoins →
 * bon de commande (validation, réception) → facture en Comptabilité ; le demandeur suit chaque étape.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

const A = '/api/admin/erp/achats', REQ = '/api/admin/erp/demandes';
const date = new Date().toISOString().slice(0, 10);
let db, app, admin, editeur, comptable, conducteur, ids, supplier, article, place;
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };

before(async () => {
  ({ db, app } = await setup()); admin = await login(app);
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  const account = await db('acc_accounts').where({ code: '604100' }).first();
  const [sid] = await db('suppliers').insert({ name: 'Papeterie du Plateau', kind: 'fournisseur', expense_account_id: account.id }); supplier = typeof sid === 'object' ? sid.id : sid;
  place = await db('places').first();
  const unit = (await db('worksite_ref_items').where({ kind: 'unite', active: true }).first()).code;
  article = ok(await comptable.post(`${A}/articles`).send({ code: 'RAMETTE', label: 'Ramette de papier A4', unit, min_quantity: 0 }), 201);
});
after(() => db.destroy());

test('demande d’achat d’un service : Achats › Besoins, commande, livraison, facture ; intervention : services généraux', async () => {
  // L'éditeur (service sans responsable direct) demande des fournitures pour le siège
  let r = ok(await editeur.post(REQ).send({ kind: 'achat', title: 'Ramettes de papier pour le service', quantity: '10 ramettes', estimated_amount: 45000, place_id: place.id }), 201);
  assert.equal(r.status, 'attente_achats', 'achat validé → Achats (et non les services généraux)');
  // Les Achats sont prévenus et voient le besoin
  assert.ok(await db('notifications').where({ event: 'demande.achat', user_id: ids.comptable }).first());
  let needs = ok(await comptable.get(`${A}/service-needs`));
  assert.equal(needs.length, 1);
  assert.equal(needs[0].title, 'Ramettes de papier pour le service');
  // Bon de commande pré-rempli : emplacement du lieu (créé), montant estimé, note
  const pre = ok(await comptable.post(`${A}/service-needs/${r.id}/prepare`));
  assert.ok(pre.location_id, 'emplacement du lieu de la demande');
  assert.equal(pre.estimated_fcfa, 45000);
  assert.match(pre.note, /Ramettes de papier/);
  const order = ok(await comptable.post(`${A}/orders`).send({ request_id: r.id, supplier_id: supplier, location_id: pre.location_id, date, vat_rate: 18, note: pre.note, lines: [{ article_id: article.id, quantity: 10, unit_price_fcfa: 3800 }] }), 201);
  assert.equal((await comptable.post(`${A}/orders`).send({ request_id: r.id, supplier_id: supplier, location_id: pre.location_id, date, vat_rate: 18, lines: [{ article_id: article.id, quantity: 1, unit_price_fcfa: 1 }] })).status, 409, 'une seule commande par demande');
  // Validation (circuit existant) : la demande passe « Commandée », le demandeur est prévenu
  await db('appro_orders').where({ id: order.id }).update({ approver_id: ids.conducteur_travaux });
  ok(await comptable.post(`${A}/orders/${order.id}/submit`));
  ok(await conducteur.post(`${A}/orders/${order.id}/approve`));
  r = await db('internal_requests').where({ id: r.id }).first();
  assert.equal(r.status, 'commande');
  assert.equal(r.order_id, order.id);
  assert.ok(await db('notifications').where({ event: 'demande.suite', user_id: ids.editeur }).where('title', 'like', 'Commande passée%').first());
  // Réception complète : la demande est traitée ; la facture part en Comptabilité (circuit existant)
  ok(await comptable.post(`${A}/orders/${order.id}/receive`).send({ date, lines: [{ order_line_id: (await db('appro_order_lines').where({ order_id: order.id }).first()).id, quantity: 10 }] }));
  r = await db('internal_requests').where({ id: r.id }).first();
  assert.equal(r.status, 'traitee');
  assert.ok(await db('notifications').where({ event: 'demande.suite', user_id: ids.editeur }).where('title', 'like', 'Livré%').first());
  const invoice = ok(await admin.post(`${A}/orders/${order.id}/invoice`).send({ date, supplier_ref: 'FACT-RAMETTES', expense_account: '604100' }), 201);
  assert.ok(invoice.id || invoice.invoice_id);
  needs = ok(await comptable.get(`${A}/service-needs`));
  assert.equal(needs.length, 0, 'livrée : plus dans la liste');

  // Refus motivé par les Achats : la demande est close, le demandeur prévenu
  const r2 = ok(await editeur.post(REQ).send({ kind: 'equipement', title: 'Second écran', estimated_amount: 90000 }), 201);
  assert.equal(r2.status, 'attente_achats');
  assert.equal((await editeur.post(`${A}/service-needs/${r2.id}/refuse`).send({ reason: 'Hors droit' })).status, 403, 'droit des Achats requis');
  ok(await comptable.post(`${A}/service-needs/${r2.id}/refuse`).send({ reason: 'Écran disponible au dépôt' }));
  assert.equal((await db('internal_requests').where({ id: r2.id }).first()).status, 'refusee');

  // Une intervention reste aux services généraux
  const r3 = ok(await editeur.post(REQ).send({ kind: 'intervention', title: 'Climatisation en panne', location: 'Bureau 3' }), 201);
  assert.equal(r3.status, 'attente_sg');
});
