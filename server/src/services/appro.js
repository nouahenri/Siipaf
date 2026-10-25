/** Achats & stocks : tables propres, stock physique atomique ; circuits Chantiers et Comptabilité réutilisés. */
const { HttpError, isoDay, isoTime, json } = require('../lib/http');
const { APPRO_ORDER_STATUSES, APPRO_PENDING_STATUSES, approApproverRefusal, approDeciderRefusal, approParties, APPRO_QUOTE_STATUSES, APPRO_MOVE_KINDS, stockQuantityUnits, approAmounts, approRequiresDirection, stockHistoryAllows, approReceiptAmounts, stockPostingDateRefusal } = require('../lib/domain');
const { inform, resolve, usersWith } = require('./notifications');
const { effectivePermissions, hasPermission } = require('./permissions');
const ct = require('./compta');
const ch = require('./chantiersLivraison');
const insertedId = r => typeof r === 'object' ? r.id : r;
const today = () => new Date().toISOString().slice(0, 10);
const fail = (status, message) => { throw new HttpError(status, message); };
const units = q => { const n = stockQuantityUnits(q); if (!n) fail(400, 'Quantité positive, avec deux décimales au plus, attendue.'); return n; };
async function row(db, table, id) { const r = await db(table).where({ id }).first(); if (!r) fail(404, 'Fiche introuvable.'); return r; }
async function event(db, entity, id, action, userId, details = null) {
  await db('appro_events').insert({ entity, entity_id: id, action, user_id: userId, details: details == null ? null : JSON.stringify(details) });
}
const resolveOrderValidation = (db, id) => db('notifications').whereIn('event', ['commande.a_valider', 'commande.soumise'])
  .where(q => q.where('dedupe_key', `appro:validation:${id}`).orWhere('dedupe_key', 'like', `appro:validation:${id}:%`)).whereNull('read_at').update({ read_at: new Date() });
/** Comptes actifs du module avec leurs droits : émetteurs (`appro:write`) et validateurs (`appro:validate` ou Direction). */
async function approAccounts(db) {
  const out = [];
  for (const u of await db('users as u').leftJoin('roles as r', 'r.id', 'u.role').where('u.active', true).orderBy('u.name').select('u.id', 'u.name', 'u.role', 'r.label as role_label')) {
    const p = await effectivePermissions(db, u); if (!hasPermission(p, 'appro:read')) continue;
    out.push({ id: u.id, name: u.name, role_label: u.role_label || u.role, super_admin: u.role === 'super_admin', write: hasPermission(p, 'appro:write'), validate: hasPermission(p, 'appro:validate'), direction: hasPermission(p, 'appro:direction') });
  }
  return out;
}
const approvers = async db => (await approAccounts(db)).filter(a => a.validate || a.direction).map(({ write, ...a }) => a);
const issuers = async db => (await approAccounts(db)).filter(a => a.write).map(({ id, name, role_label }) => ({ id, name, role_label }));
async function approverProfile(db, id) {
  const u = id ? await db('users').where({ id }).first('id', 'role', 'active') : null; if (!u) return null;
  const p = await effectivePermissions(db, u);
  return { id: u.id, active: !!u.active, super_admin: u.role === 'super_admin', validate: hasPermission(p, 'appro:read') && hasPermission(p, 'appro:validate'), direction: hasPermission(p, 'appro:read') && hasPermission(p, 'appro:direction') };
}
async function locationContacts(db, ids) {
  const locations = await db('appro_locations').whereIn('id', ids.filter(Boolean)).whereNotNull('worksite_id').select('worksite_id');
  if (!locations.length) return [];
  return (await db('worksites').whereIn('id', locations.map(l => l.worksite_id)).whereNotNull('manager_id').select('manager_id')).map(w => w.manager_id);
}
async function history(db, entity, id) {
  return (await db('appro_events as e').leftJoin('users as u', 'u.id', 'e.user_id').where({ 'e.entity': entity, 'e.entity_id': id }).orderBy('e.id', 'desc').select('e.*', 'u.name as user_name'))
    .map(e => ({ ...e, details: json(e.details), created_at: isoTime(e.created_at) }));
}
async function reference(db, table, id, prefix, date) {
  const ref = `${prefix}-${date.slice(0, 4)}-${String(id).padStart(4, '0')}`;
  await db(table).where({ id }).update({ reference: ref }); return ref;
}
async function settings(db) {
  const s = await row(db, 'appro_settings', 1);
  return { direction_threshold: Number(s.direction_threshold) };
}
async function saveSettings(db, data, userId) {
  return db.transaction(async trx => {
    const before = await settings(trx);
    await trx('appro_settings').where({ id: 1 }).update({ ...data, updated_by: userId, updated_at: new Date() });
    await event(trx, 'settings', 1, 'plafond_modifie', userId, { before, after: data }); return settings(trx);
  });
}
async function locations(db) {
  return (await db('appro_locations as l').leftJoin('places as p', 'p.id', 'l.place_id').leftJoin('worksites as w', 'w.id', 'l.worksite_id')
    .leftJoin('projects as pr', 'pr.id', 'w.project_id').orderBy('l.name').select('l.*', 'p.name as place_name', 'w.name as worksite_name', 'w.reference as worksite_reference', 'w.project_id', 'pr.name as project_name'))
    .map(l => ({ ...l, active: !!l.active, name: l.worksite_id && l.worksite_name ? `${l.worksite_reference} — ${l.worksite_name}` : l.place_name || l.name }));
}
async function createLocation(db, data, userId) {
  if (!!data.place_id === !!data.worksite_id) fail(400, 'Choisissez un lieu existant ou un chantier.');
  const source = data.place_id ? await row(db, 'places', data.place_id) : await row(db, 'worksites', data.worksite_id);
  if (source.active === 0 || source.active === false || source.status === 'clos') fail(409, 'Cet emplacement est désactivé ou clos.');
  const key = data.place_id ? { place_id: data.place_id } : { worksite_id: data.worksite_id };
  if (await db('appro_locations').where(key).first()) fail(409, 'Cet emplacement de stock existe déjà.');
  return db.transaction(async trx => {
    const [r] = await trx('appro_locations').insert({ ...key, name: source.reference ? `${source.reference} — ${source.name}` : source.name });
    const id = insertedId(r); await event(trx, 'location', id, 'creation', userId); return (await locations(trx)).find(l => l.id === id);
  });
}
async function articles(db) {
  return (await db('appro_articles as a').leftJoin('worksite_ref_items as u', function () { this.on('u.code', '=', 'a.unit').andOn('u.kind', '=', db.raw('?', ['unite'])); })
    .orderBy('a.label').select('a.*', 'u.label as unit_label')).map(a => ({ ...a, active: !!a.active, min_quantity: Number(a.min_units) / 100 }));
}
async function saveArticle(db, data, id, userId) {
  const old = id ? await row(db, 'appro_articles', id) : null;
  await require('./chantiers').checkListCode(db, 'unite', data.unit, old?.unit);
  if (await db('appro_articles').where({ code: data.code }).whereNot({ id: id || 0 }).first()) fail(409, 'Ce code article existe déjà.');
  if (old && old.unit !== data.unit && (await db('appro_order_lines').where({ article_id: id }).first() || await db('appro_quote_lines').where({ article_id: id }).first() || await db('appro_movement_lines').where({ article_id: id }).first())) fail(409, 'Un article utilisé conserve son unité.');
  return db.transaction(async trx => {
    const { min_quantity, ...rest } = data;
    const patch = { ...rest, min_units: stockQuantityUnits(min_quantity), updated_at: new Date() };
    if (old) await trx('appro_articles').where({ id }).update(patch);
    else { const [r] = await trx('appro_articles').insert(patch); id = insertedId(r); }
    await event(trx, 'article', id, old ? 'modification' : 'creation', userId);
    await stockAlerts(trx, userId); return (await articles(trx)).find(a => a.id === id);
  });
}
async function active(db, table, id) { const r = await row(db, table, id); if (!r.active) fail(409, 'Article ou emplacement désactivé.'); return r; }
async function refs(db) {
  const [art, loc, places, worksites, suppliers, unitsList, accounts, conf, accounting, validators, emitters] = await Promise.all([
    articles(db), locations(db), db('places').where({ active: true }).orderBy('name').select('id', 'name', 'kind'),
    db('worksites').whereNot({ status: 'clos' }).orderBy('reference').select('id', 'reference', 'name', 'project_id'),
    db('suppliers').where({ active: true }).orderBy('name').select('id', 'name', 'kind', 'expense_account_id'),
    db('worksite_ref_items').where({ kind: 'unite', active: true }).orderBy(['sort', 'label']).select('code', 'label'),
    db('acc_accounts').whereIn('class', [2, 6]).orderBy('code').select('id', 'code', 'label'), settings(db), ct.getSettings(db), approvers(db), issuers(db),
  ]);
  return { approvers: validators, issuers: emitters, articles: art, locations: loc, places, worksites, suppliers, units: unitsList, accounts, settings: conf, vat_rate: accounting.vat_purchases_rate, order_statuses: APPRO_ORDER_STATUSES, quote_statuses: APPRO_QUOTE_STATUSES, movement_kinds: APPRO_MOVE_KINDS };
}
async function stock(db) {
  return (await db('appro_balances as b').join('appro_articles as a', 'a.id', 'b.article_id').join('appro_locations as l', 'l.id', 'b.location_id')
    .orderBy(['l.name', 'a.label']).select('b.*', 'a.code', 'a.label', 'a.unit', 'a.min_units as default_min_units', 'l.name as location_name'))
    .map(b => ({ ...b, quantity: Number(b.quantity_units) / 100, min_quantity: Number(b.min_units ?? b.default_min_units) / 100, low: Number(b.quantity_units) <= Number(b.min_units ?? b.default_min_units) }));
}
async function stockAlerts(db, except) {
  for (const b of await stock(db)) {
    const key = `appro:stock:${b.article_id}:${b.location_id}:`;
    if (!b.low) { await resolve(db, key); continue; }
    // Une nouvelle alerte après réapprovisionnement, sans doublon pendant la même rupture.
    const open = await db('notifications').where({ event: 'stock.bas' }).where('dedupe_key', 'like', `${key}%`).whereNull('read_at').first('id');
    if (!open) await inform(db, 'stock.bas', { direct: await usersWith(db, 'appro:stock'), except, key: `${key}${Date.now()}`, title: `Stock bas : ${b.label}`, body: `${b.location_name} · disponible ${b.quantity} ${b.unit} · seuil ${b.min_quantity}`, link: '/achats/stocks', priority: 'action' });
  }
}
async function setStockMinimum(db, data, userId) {
  await active(db, 'appro_articles', data.article_id); await active(db, 'appro_locations', data.location_id);
  return db.transaction(async trx => {
    const key = { article_id: data.article_id, location_id: data.location_id };
    await trx('appro_balances').insert({ ...key, quantity_units: 0 }).onConflict(['article_id', 'location_id']).ignore();
    await trx('appro_balances').where(key).update({ min_units: data.min_quantity == null ? null : stockQuantityUnits(data.min_quantity), updated_at: new Date() });
    await event(trx, 'article', data.article_id, 'seuil_emplacement', userId, data); await stockAlerts(trx, userId); return stock(trx);
  });
}
const documents = { order: { table: 'appro_orders', lines: 'appro_order_lines', key: 'order_id', prefix: 'BC' }, quote: { table: 'appro_quotes', lines: 'appro_quote_lines', key: 'quote_id', prefix: 'DP' } };
function documentQuery(db, type) {
  const q = db(`${documents[type].table} as d`).join('suppliers as s', 's.id', 'd.supplier_id').join('appro_locations as l', 'l.id', 'd.location_id')
    .leftJoin('users as uc', 'uc.id', 'd.created_by').leftJoin('roles as rc', 'rc.id', 'uc.role')
    .select('d.*', 's.name as supplier_name', 'l.name as location_name', 'uc.name as created_by_name', 'rc.label as created_by_role');
  // Émetteur, validateur désigné et auteur de la décision : affichés sur la fiche et le bon imprimé.
  if (type === 'order') q.leftJoin('users as ui', 'ui.id', 'd.issuer_id').leftJoin('roles as ri', 'ri.id', 'ui.role').select('ui.name as issuer_name', 'ri.label as issuer_role')
    .leftJoin('users as ua', 'ua.id', 'd.approver_id').leftJoin('roles as ra', 'ra.id', 'ua.role').leftJoin('users as uv', 'uv.id', 'd.approved_by')
    .select('ua.name as approver_name', 'ra.label as approver_role', 'uv.name as approved_by_name');
  return q;
}
function serializeDocument(d, type) {
  return { ...d, date: isoDay(d.date), needed_on: isoDay(d.needed_on), status_label: (type === 'order' ? APPRO_ORDER_STATUSES : APPRO_QUOTE_STATUSES)[d.status], vat_rate: Number(d.vat_rate),
    ...(type === 'order' ? { amount_ht: Number(d.amount_ht), amount_ttc: Number(d.amount_ttc), vat_amount: Number(d.vat_amount), approval_threshold: d.approval_threshold == null ? null : Number(d.approval_threshold) } : {}) };
}
async function listDocuments(db, type, { status = null } = {}) {
  const q = documentQuery(db, type).orderBy('d.id', 'desc').limit(500); if (status) q.whereIn('d.status', String(status).split(','));
  return (await q).map(d => serializeDocument(d, type));
}
async function detail(db, type, id) {
  const cfg = documents[type]; const d = await documentQuery(db, type).where('d.id', id).first(); if (!d) fail(404, 'Document introuvable.');
  const lines = (await db(cfg.lines).where({ [cfg.key]: id }).orderBy('id')).map(l => ({ ...l, quantity: Number(l.quantity_units) / 100, unit_price_fcfa: l.unit_price_fcfa == null ? null : Number(l.unit_price_fcfa), received_quantity: Number(l.received_units || 0) / 100 }));
  const out = { ...serializeDocument(d, type), lines, events: await history(db, type, id) };
  if (type === 'order') out.invoices = await db('purchase_invoices as p').whereIn('p.id', db('appro_invoice_receipts as i').join('appro_movements as m', 'm.id', 'i.movement_id').where('m.order_id', id).select('i.invoice_id')).whereNot('p.status', 'annulee').orderBy('p.id')
    .select('p.id', 'p.number', 'p.status', 'p.amount_ttc', db('purchase_payments as pp').whereRaw('pp.invoice_id = p.id').sum('pp.amount').as('paid_fcfa'))
    .then(rows => rows.map(p => ({ ...p, amount_ttc: Number(p.amount_ttc), paid_fcfa: Number(p.paid_fcfa || 0) })));
  if (type === 'order') out.receipts = await db('appro_movements as m').leftJoin('appro_invoice_receipts as i', 'i.movement_id', 'm.id').leftJoin('purchase_invoices as p', 'p.id', 'i.invoice_id').where({ 'm.order_id': id, 'm.status': 'valide' }).orderBy('m.id').select('m.id', 'm.reference', 'm.date', 'm.supplier_ref', db.raw("CASE WHEN p.status = 'annulee' THEN NULL ELSE p.id END as invoice_id"));
  return out;
}
async function lineRows(db, type, lines, locationId, excluding = null) {
  const loc = await active(db, 'appro_locations', locationId), needIds = new Set(), out = [];
  for (const needId of [...new Set(lines.map(l => l.need_id).filter(Boolean))].sort((a, b) => a - b)) {
    if (!(await db('worksite_needs').where({ id: needId }).forUpdate().first())) fail(404, 'Besoin introuvable.');
  }
  for (const l of lines) {
    const a = await active(db, 'appro_articles', l.article_id); const quantity_units = units(l.quantity);
    if (l.need_id) {
      if (needIds.has(l.need_id)) fail(400, 'Un besoin ne peut figurer qu’une fois dans le document.'); needIds.add(l.need_id);
      const n = await row(db, 'worksite_needs', l.need_id);
      if (!['demande', 'valide'].includes(n.status)) fail(409, 'Ce besoin est déjà commandé, livré, refusé ou annulé.');
      if (a.unit !== n.unit || quantity_units !== units(n.quantity)) fail(400, 'Reprenez la quantité et l’unité du besoin validé.');
      if (Number(loc.worksite_id) !== Number(n.worksite_id)) fail(400, 'Pour ce besoin, choisissez l’emplacement du chantier destinataire.');
      if (type === 'order') {
        const q = db('appro_order_lines as l').join('appro_orders as o', 'o.id', 'l.order_id').where('l.need_id', l.need_id).whereNotIn('o.status', ['annulee', 'refusee']);
        if (excluding) q.whereNot('o.id', excluding);
        if (await q.forUpdate().first('l.id')) fail(409, 'Ce besoin figure déjà dans un bon de commande.');
      }
    }
    out.push({ article_id: a.id, label: a.label, unit: a.unit, quantity_units, unit_price_fcfa: l.unit_price_fcfa ?? null, need_id: l.need_id || null });
  }
  return out;
}
async function saveDocument(db, type, data, id, userId) {
  const cfg = documents[type];
  return db.transaction(async trx => {
    const old = id ? await trx(cfg.table).where({ id }).forUpdate().first() : null;
    if (id && !old) fail(404, 'Document introuvable.');
    if (old && old.status !== 'brouillon') fail(409, 'Seul un brouillon se modifie.');
    const s = await row(trx, 'suppliers', data.supplier_id); if (!s.active) fail(409, 'Ce fournisseur est désactivé.');
    const lines = await lineRows(trx, type, data.lines, data.location_id, id);
    const amounts = type === 'order' ? approAmounts(data.lines, data.vat_rate) : {};
    if (amounts.error) fail(400, amounts.error);
    const { lines: ignored, ...header } = data;
    if (type === 'order') {
      header.issuer_id = data.issuer_id || old?.issuer_id || userId;
      if (!(await issuers(trx)).some(u => u.id === Number(header.issuer_id))) fail(400, 'L’émetteur choisi n’a pas le droit de préparer les achats.');
      const refusal = data.approver_id && approApproverRefusal(await approverProfile(trx, data.approver_id), [header.issuer_id, old?.created_by ?? userId], amounts.amount_ttc, (await settings(trx)).direction_threshold);
      if (refusal) fail(400, refusal);
    }
    if (old) { await trx(cfg.table).where({ id }).update({ ...header, ...amounts, updated_at: new Date() }); await trx(cfg.lines).where({ [cfg.key]: id }).del(); }
    else { const [r] = await trx(cfg.table).insert({ ...header, ...amounts, created_by: userId }); id = insertedId(r); await reference(trx, cfg.table, id, cfg.prefix, data.date); }
    await trx(cfg.lines).insert(lines.map(l => ({ ...l, [cfg.key]: id })));
    await event(trx, type, id, old ? 'modification' : 'creation', userId); return detail(trx, type, id);
  });
}
async function receiveQuote(db, id, userId) {
  return db.transaction(async trx => {
    const q = await trx('appro_quotes').where({ id }).forUpdate().first(); if (!q) fail(404, 'Demande de prix introuvable.');
    if (q.status !== 'brouillon') fail(409, 'Cette demande de prix a déjà été traitée.');
    const d = await detail(trx, 'quote', id); if (d.lines.some(l => l.unit_price_fcfa == null)) fail(400, 'Saisissez le prix HT proposé pour chaque article.');
    const amount = approAmounts(d.lines, d.vat_rate); if (amount.error) fail(400, amount.error);
    await trx('appro_quotes').where({ id }).update({ status: 'recue', updated_at: new Date() }); await event(trx, 'quote', id, 'devis_recu', userId);
    await inform(trx, 'devis.recu', { direct: q.created_by, except: userId, key: `appro:devis:${id}:recu`, title: `Devis reçu : ${q.reference}`, link: `/achats/prix?fiche=${id}` });
    return detail(trx, 'quote', id);
  });
}
async function quoteToOrder(db, id, userId) {
  return db.transaction(async trx => {
    const q = await trx('appro_quotes').where({ id }).forUpdate().first(); if (!q || q.status !== 'recue') fail(409, 'Enregistrez d’abord le devis reçu.');
    const previous = await trx('appro_orders').where({ quote_id: id }).first('id'); if (previous) return detail(trx, 'order', previous.id);
    const d = await detail(trx, 'quote', id);
    const order = await saveDocument(trx, 'order', { supplier_id: d.supplier_id, location_id: d.location_id, date: today(), needed_on: d.needed_on, vat_rate: d.vat_rate, note: d.note, lines: d.lines.map(l => ({ article_id: l.article_id, quantity: l.quantity, unit_price_fcfa: l.unit_price_fcfa, need_id: l.need_id })) }, null, userId);
    await trx('appro_orders').where({ id: order.id }).update({ quote_id: id }); await event(trx, 'order', order.id, 'issu_devis', userId, { quote_id: id }); return detail(trx, 'order', order.id);
  });
}
async function cancelDocument(db, type, id, userId) {
  return db.transaction(async trx => {
    const cfg = documents[type], d = await trx(cfg.table).where({ id }).forUpdate().first(); if (!d) fail(404, 'Document introuvable.');
    if (!(type === 'order' ? ['brouillon', ...APPRO_PENDING_STATUSES, 'refusee'] : ['brouillon', 'recue']).includes(d.status)) fail(409, 'Ce document engagé ne peut plus être annulé ici.');
    await trx(cfg.table).where({ id }).update({ status: 'annulee', updated_at: new Date() });
    if (type === 'order') {
      await resolveOrderValidation(trx, id);
      await inform(trx, 'commande.annulee', { direct: [...approParties(d), APPRO_PENDING_STATUSES.includes(d.status) ? d.approver_id : null], except: userId, key: `appro:commande:${id}:annulee`, title: `Commande annulée : ${d.reference}`, link: `/achats/commandes?fiche=${id}` });
    }
    await event(trx, type, id, 'annulation', userId); return detail(trx, type, id);
  });
}
async function submitOrder(db, id, actor) {
  return db.transaction(async trx => {
    const o = await trx('appro_orders').where({ id }).forUpdate().first(); if (!o) fail(404, 'Commande introuvable.');
    if (o.status !== 'brouillon') fail(409, 'Seul un brouillon se soumet à la validation.');
    const threshold = (await settings(trx)).direction_threshold;
    const refusal = approApproverRefusal(await approverProfile(trx, o.approver_id), approParties(o), o.amount_ttc, threshold); if (refusal) fail(400, refusal);
    const supplier = await row(trx, 'suppliers', o.supplier_id); if (!supplier.active) fail(409, 'Fournisseur désactivé.');
    const d = await detail(trx, 'order', id); await lineRows(trx, 'order', d.lines, o.location_id, id);
    // Plafond figé à la soumission : un changement ultérieur du réglage ne contourne pas la validation demandée.
    const direction = approRequiresDirection(o.amount_ttc, threshold);
    await trx('appro_orders').where({ id }).update({ status: direction ? 'attente_direction' : 'a_valider', approval_threshold: threshold, submitted_at: new Date(), updated_at: new Date() });
    await event(trx, 'order', id, direction ? 'transmission_direction' : 'soumission', actor.userId, { threshold, approver_id: o.approver_id, approver_name: d.approver_name });
    await inform(trx, direction ? 'commande.a_valider' : 'commande.soumise', { direct: o.approver_id, except: actor.userId, key: `appro:validation:${id}:${Date.now()}`, priority: 'action', title: `Commande à valider : ${o.reference}`,
      body: `${Number(o.amount_ttc).toLocaleString('fr-FR')} FCFA TTC · émise par ${d.issuer_name || d.created_by_name || 'compte supprimé'}${direction ? ` · plafond Direction ${threshold.toLocaleString('fr-FR')} FCFA` : ''}`, link: `/achats/commandes?fiche=${id}` });
    return detail(trx, 'order', id);
  });
}
async function approveOrder(db, id, actor, { refuse = false, reason = null } = {}) {
  return db.transaction(async trx => {
    const o = await trx('appro_orders').where({ id }).forUpdate().first(); if (!o) fail(404, 'Commande introuvable.');
    const refusal = approDeciderRefusal(o, { userId: actor.userId, superAdmin: !!actor.superAdmin, canValidate: actor.can('appro:validate'), canDirection: actor.can('appro:direction') });
    if (refusal) fail(APPRO_PENDING_STATUSES.includes(o.status) ? 403 : 409, refusal);
    const threshold = Number(o.approval_threshold), substitute = !!o.approver_id && Number(o.approver_id) !== Number(actor.userId);
    const informed = [...approParties(o), substitute ? o.approver_id : null];
    if (refuse) {
      if (!reason?.trim()) fail(400, 'Indiquez le motif du refus.');
      await trx('appro_orders').where({ id }).update({ status: 'refusee', refusal_reason: reason, approved_by: actor.userId, approved_at: new Date(), updated_at: new Date() });
      await resolveOrderValidation(trx, id); await event(trx, 'order', id, 'refus', actor.userId, { reason, substitute });
      await inform(trx, 'commande.refusee', { direct: informed, except: actor.userId, key: `appro:commande:${id}:refusee:${Date.now()}`, title: `${o.reference} refusée`, body: reason, link: `/achats/commandes?fiche=${id}` });
      return detail(trx, 'order', id);
    }
    const d = await detail(trx, 'order', id);
    const supplier = await row(trx, 'suppliers', o.supplier_id); if (!supplier.active) fail(409, 'Fournisseur désactivé.');
    await lineRows(trx, 'order', d.lines, o.location_id, id);
    await trx('appro_orders').where({ id }).update({ status: 'confirmee', approved_by: actor.userId, approved_at: new Date(), updated_at: new Date() });
    for (const l of d.lines.filter(l => l.need_id)) {
      const n = await row(trx, 'worksite_needs', l.need_id), w = await row(trx, 'worksites', n.worksite_id);
      await ch.moveNeed(trx, w, n, { status: 'commande', supplier_id: o.supplier_id, estimate_fcfa: Math.round(l.quantity * l.unit_price_fcfa), date: today() }, { userId: actor.userId });
    }
    await resolveOrderValidation(trx, id); await event(trx, 'order', id, 'confirmation', actor.userId, { threshold, substitute });
    await inform(trx, 'commande.confirmee', { direct: informed, except: actor.userId, key: `appro:commande:${id}:confirmee`, title: `Commande confirmée : ${o.reference}`, body: `${d.supplier_name} · à réceptionner : ${d.location_name}`, link: `/achats/commandes?fiche=${id}` });
    return detail(trx, 'order', id);
  });
}
/** Commande refusée : l'émetteur la reprend en brouillon pour la corriger puis la soumettre de nouveau. */
async function reopenOrder(db, id, userId) {
  return db.transaction(async trx => {
    const n = await trx('appro_orders').where({ id, status: 'refusee' }).update({ status: 'brouillon', approval_threshold: null, approved_by: null, approved_at: null, submitted_at: null, refusal_reason: null, updated_at: new Date() });
    if (!n) fail(409, 'Seule une commande refusée se reprend en brouillon.');
    await event(trx, 'order', id, 'reprise', userId); return detail(trx, 'order', id);
  });
}
/** Comptabilité › règlement d'une facture issue de réceptions : la commande en garde la trace et l'émetteur est prévenu. */
async function informPayment(db, invoice, amount, remaining, userId) {
  const o = await db('appro_invoice_receipts as i').join('appro_movements as m', 'm.id', 'i.movement_id').join('appro_orders as o', 'o.id', 'm.order_id').where('i.invoice_id', invoice.id).first('o.id', 'o.reference', 'o.created_by', 'o.issuer_id');
  if (!o) return;
  await event(db, 'order', o.id, 'paiement', userId, { invoice_id: invoice.id, number: invoice.number, amount, remaining });
  await inform(db, 'commande.payee', { direct: approParties(o), except: userId, key: `appro:paiement:${invoice.id}:${Date.now()}`, title: `${remaining > 0 ? 'Règlement partiel' : 'Facture réglée'} : ${o.reference}`,
    body: `${invoice.number} · ${amount.toLocaleString('fr-FR')} FCFA réglés${remaining > 0 ? ` · reste ${remaining.toLocaleString('fr-FR')} FCFA` : ''}`, link: `/achats/commandes?fiche=${o.id}` });
}
async function changeBalance(trx, articleId, locationId, delta, postingDate = null) {
  const key = { article_id: articleId, location_id: locationId };
  await trx('appro_balances').insert({ ...key, quantity_units: 0 }).onConflict(['article_id', 'location_id']).ignore();
  const q = trx('appro_balances').where(key); if (delta < 0) q.where('quantity_units', '>=', -delta);
  const changed = await q.update({ quantity_units: trx.raw('quantity_units + ?', [delta]), updated_at: new Date() });
  if (!changed) {
    const a = await row(trx, 'appro_articles', articleId), l = await row(trx, 'appro_locations', locationId), b = await trx('appro_balances').where(key).first();
    fail(409, `Stock insuffisant : ${a.label}, ${l.name} (${Number(b?.quantity_units || 0) / 100} ${a.unit} disponible). Enregistrez la réception ou le stock initial avant la sortie.`);
  }
  if (delta < 0 && postingDate) {
    const ledger = await trx('appro_movement_lines as l').join('appro_movements as m', 'm.id', 'l.movement_id')
      .where({ 'l.article_id': articleId, 'm.status': 'valide' }).where(q => q.where('m.from_location_id', locationId).orWhere('m.to_location_id', locationId))
      .orderBy(['m.date', 'm.id', 'l.id']).select('l.quantity_units', 'm.date', 'm.from_location_id', 'm.to_location_id');
    const entries = ledger.map(e => ({ date: isoDay(e.date), delta: Number(e.quantity_units) * (Number(e.to_location_id) === Number(locationId) ? 1 : -1) }));
    if (!stockHistoryAllows(entries, postingDate, delta)) fail(409, 'Cette sortie antidatée rendrait le stock historique négatif. Corrigez la date ou enregistrez la réception manquante.');
  }
}
async function movementDetail(db, id) {
  const m = await row(db, 'appro_movements', id), loc = await locations(db);
  return { ...m, date: isoDay(m.date), kind_label: APPRO_MOVE_KINDS[m.kind], from_name: loc.find(l => l.id === m.from_location_id)?.name || null, to_name: loc.find(l => l.id === m.to_location_id)?.name || null,
    lines: (await db('appro_movement_lines').where({ movement_id: id }).orderBy('id')).map(l => ({ ...l, quantity: Number(l.quantity_units) / 100 })), events: await history(db, 'movement', id) };
}
async function movements(db) {
  const loc = await locations(db), names = Object.fromEntries(loc.map(l => [l.id, l.name]));
  return (await db('appro_movements').orderBy('id', 'desc').limit(500)).map(m => ({ ...m, date: isoDay(m.date), kind_label: APPRO_MOVE_KINDS[m.kind], from_name: names[m.from_location_id] || null, to_name: names[m.to_location_id] || null }));
}
async function saveMovement(db, data, id, userId) {
  return db.transaction(async trx => {
    const old = id ? await trx('appro_movements').where({ id }).forUpdate().first() : null;
    if (id && !old) fail(404, 'Mouvement introuvable.');
    if (old && (old.status !== 'brouillon' || old.order_id)) fail(409, 'Un mouvement validé ne se modifie plus.');
    const outgoing = ['sortie', 'transfert'].includes(data.kind), incoming = ['entree', 'transfert'].includes(data.kind);
    const from = outgoing ? data.from_location_id : null, to = incoming ? data.to_location_id : null;
    if ((outgoing && !from) || (incoming && !to) || (from && from === to)) fail(400, 'Choisissez des emplacements de départ et d’arrivée distincts.');
    if (from) await active(trx, 'appro_locations', from); if (to) await active(trx, 'appro_locations', to);
    const lines = [];
    for (const l of data.lines) { const a = await active(trx, 'appro_articles', l.article_id); lines.push({ article_id: a.id, quantity_units: units(l.quantity), label: a.label, unit: a.unit }); }
    const header = { kind: data.kind, from_location_id: from, to_location_id: to, date: data.date, note: data.note };
    if (old) { await trx('appro_movements').where({ id }).update({ ...header, updated_at: new Date() }); await trx('appro_movement_lines').where({ movement_id: id }).del(); }
    else { const [r] = await trx('appro_movements').insert({ ...header, created_by: userId }); id = insertedId(r); await reference(trx, 'appro_movements', id, 'ST', data.date); }
    await trx('appro_movement_lines').insert(lines.map(l => ({ ...l, movement_id: id })));
    await event(trx, 'movement', id, old ? 'modification' : 'creation', userId); return movementDetail(trx, id);
  });
}
async function postMovement(db, id, userId) {
  return db.transaction(async trx => {
    const m = await trx('appro_movements').where({ id }).forUpdate().first(); if (!m) fail(404, 'Mouvement introuvable.');
    if (m.status !== 'brouillon' || m.order_id) fail(409, 'Ce mouvement est déjà traité.');
    const dateError = stockPostingDateRefusal(isoDay(m.date), today()); if (dateError) fail(400, dateError);
    if (m.from_location_id) await active(trx, 'appro_locations', m.from_location_id); if (m.to_location_id) await active(trx, 'appro_locations', m.to_location_id);
    const quantities = new Map();
    for (const l of await trx('appro_movement_lines').where({ movement_id: id })) quantities.set(l.article_id, (quantities.get(l.article_id) || 0) + Number(l.quantity_units));
    for (const [articleId, quantity] of [...quantities].sort(([a], [b]) => a - b)) {
      await active(trx, 'appro_articles', articleId);
      if (m.from_location_id) await changeBalance(trx, articleId, m.from_location_id, -quantity, isoDay(m.date));
      if (m.to_location_id) await changeBalance(trx, articleId, m.to_location_id, quantity);
    }
    await trx('appro_movements').where({ id }).update({ status: 'valide', posted_by: userId, posted_at: new Date(), updated_at: new Date() });
    await event(trx, 'movement', id, 'validation', userId);
    const d = await movementDetail(trx, id);
    await inform(trx, `stock.${m.kind}`, { direct: [m.created_by, ...await locationContacts(trx, [m.from_location_id, m.to_location_id])], except: userId, key: `appro:mouvement:${id}:valide`, title: `Mouvement validé : ${d.reference}`, body: `${APPRO_MOVE_KINDS[m.kind]} · ${d.from_name || 'Entrée'} → ${d.to_name || 'Consommation'}`, link: `/achats/stocks?onglet=mouvements&mouvement=${id}` });
    await stockAlerts(trx, userId); return d;
  });
}
async function cancelMovement(db, id, userId) {
  return db.transaction(async trx => {
    const n = await trx('appro_movements').where({ id, status: 'brouillon' }).whereNull('order_id').update({ status: 'annule', updated_at: new Date() });
    if (!n) fail(409, 'Seul un mouvement en brouillon s’annule.'); await event(trx, 'movement', id, 'annulation', userId); return movementDetail(trx, id);
  });
}
async function receiveOrder(db, id, data, actor) {
  const dateError = stockPostingDateRefusal(data.date, today()); if (dateError) fail(400, dateError);
  return db.transaction(async trx => {
    const o = await trx('appro_orders').where({ id }).forUpdate().first(); if (!o) fail(404, 'Commande introuvable.');
    if (!['confirmee', 'partielle'].includes(o.status)) fail(409, 'La commande doit être confirmée et rester à réceptionner.');
    const loc = await active(trx, 'appro_locations', o.location_id), seen = new Set(), lines = [];
    for (const item of data.lines) {
      if (seen.has(item.order_line_id)) fail(400, 'Une ligne ne peut figurer deux fois dans la réception.'); seen.add(item.order_line_id);
      const l = await trx('appro_order_lines').where({ id: item.order_line_id, order_id: id }).first(); if (!l) fail(400, 'Ligne étrangère à cette commande.');
      const q = units(item.quantity); if (q > Number(l.quantity_units) - Number(l.received_units)) fail(409, 'La réception dépasse la quantité encore attendue.');
      await active(trx, 'appro_articles', l.article_id);
      lines.push({ article_id: l.article_id, order_line_id: l.id, label: l.label, unit: l.unit, quantity_units: q, unit_price_fcfa: l.unit_price_fcfa });
    }
    const previous = await trx('appro_order_lines').where({ order_id: id });
    const receiptAmounts = approReceiptAmounts(previous, lines, Number(o.vat_rate));
    const [r] = await trx('appro_movements').insert({ kind: 'reception', status: 'valide', to_location_id: loc.id, order_id: id, ...receiptAmounts, date: data.date, supplier_ref: data.supplier_ref, note: data.note, created_by: actor.userId, posted_by: actor.userId, posted_at: new Date() });
    const receiptId = insertedId(r); await reference(trx, 'appro_movements', receiptId, 'BR', data.date);
    await trx('appro_movement_lines').insert(lines.map(l => ({ ...l, movement_id: receiptId })));
    for (const l of lines) {
      await changeBalance(trx, l.article_id, loc.id, Number(l.quantity_units));
      await trx('appro_order_lines').where({ id: l.order_line_id }).increment('received_units', Number(l.quantity_units));
    }
    const allLines = await trx('appro_order_lines').where({ order_id: id });
    const complete = allLines.every(l => Number(l.received_units) === Number(l.quantity_units));
    await trx('appro_orders').where({ id }).update({ status: complete ? 'recue' : 'partielle', updated_at: new Date() });
    for (const l of allLines.filter(l => l.need_id && Number(l.received_units) === Number(l.quantity_units))) {
      const n = await row(trx, 'worksite_needs', l.need_id), w = await row(trx, 'worksites', n.worksite_id);
      if (n.status === 'commande' && Number(loc.worksite_id) === Number(w.id)) await ch.moveNeed(trx, w, n, { status: 'livre', date: data.date }, { userId: actor.userId });
    }
    await event(trx, 'movement', receiptId, 'reception', actor.userId, { order_id: id }); await event(trx, 'order', id, 'reception', actor.userId, { receipt_id: receiptId, complete });
    await inform(trx, 'appro.reception', { direct: [...approParties(o), ...await locationContacts(trx, [loc.id])], except: actor.userId, key: `appro:reception:${receiptId}`, title: `Réception ${complete ? 'complète' : 'partielle'} : ${o.reference}`, body: `${loc.name} · ${lines.map(l => `${Number(l.quantity_units) / 100} ${l.unit} ${l.label}`).join(' · ')}`, link: `/achats/commandes?fiche=${id}` });
    await stockAlerts(trx, actor.userId); return detail(trx, 'order', id);
  });
}
async function prepareInvoice(db, id, data, userId) {
  return db.transaction(async trx => {
    const o = await trx('appro_orders').where({ id }).forUpdate().first(); if (!o) fail(404, 'Commande introuvable.');
    // Un brouillon supprimé par le circuit comptable existant libère ses seules liaisons de réception.
    const stale = await trx('appro_invoice_receipts as i').join('appro_movements as m', 'm.id', 'i.movement_id').leftJoin('purchase_invoices as p', 'p.id', 'i.invoice_id')
      .where('m.order_id', id).where(q => q.whereNull('p.id').orWhere('p.status', 'annulee')).select('i.movement_id');
    if (stale.length) await trx('appro_invoice_receipts').whereIn('movement_id', stale.map(r => r.movement_id)).del();
    const year = data.date.slice(0, 4);
    if (await trx('purchase_invoices').where({ supplier_id: o.supplier_id }).whereNot({ status: 'annulee' }).whereBetween('date', [`${year}-01-01`, `${year}-12-31`]).whereRaw('LOWER(supplier_ref) = ?', [data.supplier_ref.toLowerCase()]).first('id')) fail(409, 'Cette référence de facture est déjà enregistrée pour ce fournisseur. Contrôlez la facture existante dans la Comptabilité.');
    const received = await trx('appro_movements as m').leftJoin('appro_invoice_receipts as i', 'i.movement_id', 'm.id').where({ 'm.order_id': id, 'm.kind': 'reception', 'm.status': 'valide' }).whereNull('i.movement_id').select('m.id', 'm.amount_ht', 'm.vat_amount', 'm.amount_ttc');
    if (!received.length) fail(409, 'Aucune réception non facturée pour cette commande.');
    const selected = data.receipt_ids?.length ? received.filter(r => data.receipt_ids.includes(r.id)) : received;
    if (!selected.length || (data.receipt_ids?.length && selected.length !== new Set(data.receipt_ids).size)) fail(409, 'Réception inconnue, étrangère à la commande ou déjà facturée.');
    const account = await trx('acc_accounts').where({ code: data.expense_account }).first();
    if (!account || ![2, 6].includes(account.class)) fail(400, 'Choisissez un compte de charge ou d’immobilisation existant.');
    const selectedIds = selected.map(r => r.id);
    const amounts = Object.fromEntries(['amount_ht', 'vat_amount', 'amount_ttc'].map(k => [k, selected.reduce((sum, r) => sum + Number(r[k]), 0)]));
    if (!amounts.amount_ttc) fail(400, 'Une facture doit avoir un montant positif.');
    const loc = await row(trx, 'appro_locations', o.location_id);
    const site = await require('./lieux').resolvePlace(trx, { worksite_id: loc.worksite_id, place_id: loc.place_id });
    const number = await ct.nextPurchaseNumber(trx, data.date);
    const [r] = await trx('purchase_invoices').insert({ number, supplier_id: o.supplier_id, supplier_ref: data.supplier_ref, date: data.date, due_date: data.due_date || null, label: `${o.reference} — matériaux réceptionnés`, ...site, worksite_category: site.worksite_id ? 'materiaux' : null,
      expense_account_id: account.id, ...amounts, vat_rate: Number(o.vat_rate), status: 'brouillon', created_by: userId });
    const invoiceId = insertedId(r);
    await trx('appro_invoice_receipts').insert(selectedIds.map(movement_id => ({ movement_id, invoice_id: invoiceId })));
    await event(trx, 'order', id, 'facture_brouillon', userId, { invoice_id: invoiceId, number, receipt_ids: selectedIds });
    await inform(trx, 'appro.facture', { direct: await usersWith(trx, 'compta:entries'), except: userId, key: `appro:facture:${invoiceId}`, title: `Facture à contrôler : ${number}`, body: `${o.reference} · ${amounts.amount_ttc.toLocaleString('fr-FR')} FCFA TTC`, link: '/compta/achats', priority: 'action' });
    return { invoice_id: invoiceId, number, status: 'brouillon', ...amounts };
  });
}
/** Refus motivé d'un besoin par les Achats (déjà couvert par le stock, doublon…) ; le chantier en est prévenu. */
async function refuseNeed(db, id, reason, userId) {
  return db.transaction(async trx => {
    const n = await trx('worksite_needs').where({ id }).forUpdate().first(); if (!n) fail(404, 'Besoin introuvable.');
    const active = await trx('appro_order_lines as l').join('appro_orders as o', 'o.id', 'l.order_id').where('l.need_id', id).whereNotIn('o.status', ['annulee', 'refusee']).first('o.reference');
    if (active) fail(409, `Ce besoin figure dans le bon de commande ${active.reference} : annulez ou refusez d'abord ce bon.`);
    return ch.moveNeed(trx, await row(trx, 'worksites', n.worksite_id), n, { status: 'refuse', reason }, { userId });
  });
}
async function needs(db) {
  const rows = await ch.needs(db);
  const links = await db('appro_order_lines as l').join('appro_orders as o', 'o.id', 'l.order_id').whereNotNull('l.need_id').whereNotIn('o.status', ['annulee', 'refusee']).select('l.need_id', 'o.id as order_id', 'o.reference as order_reference');
  return rows.map(n => ({ ...n, ...links.find(l => l.need_id === n.id) }));
}
async function contracts(db) {
  return db('contracts as c').leftJoin('suppliers as s', 's.id', 'c.supplier_id').whereIn('c.kind', ['fournisseur', 'sous_traitance']).orderBy('c.id', 'desc').limit(500).select('c.id', 'c.reference', 'c.title', 'c.kind', 'c.status', 'c.contract_amount', 'c.start_date', 'c.end_date', 's.name as supplier_name');
}
async function dashboard(db) {
  const [open, positions, needsCount, quotesCount, conf, recent, waiting, receipts] = await Promise.all([
    db('appro_orders').whereIn('status', ['confirmee', 'partielle']).select('id', 'amount_ttc'), stock(db),
    db('worksite_needs as n').whereIn('n.status', ['demande', 'valide']).whereNotExists(db('appro_order_lines as l').join('appro_orders as o', 'o.id', 'l.order_id').whereRaw('l.need_id = n.id').whereNotIn('o.status', ['annulee', 'refusee'])).count({ n: '*' }).first(),
    db('appro_quotes').where({ status: 'brouillon' }).count({ n: '*' }).first(), settings(db),
    documentQuery(db, 'order').orderBy('d.id', 'desc').limit(8), db('appro_orders').whereIn('status', APPRO_PENDING_STATUSES).count({ n: '*' }).first(),
    db('appro_movements').where({ kind: 'reception', status: 'valide' }).groupBy('order_id').select('order_id').sum({ received_ttc: 'amount_ttc' }),
  ]);
  const totals = Object.fromEntries(receipts.map(r => [r.order_id, Number(r.received_ttc)]));
  const committed = open.reduce((sum, o) => sum + Math.max(0, Number(o.amount_ttc) - (totals[o.id] || 0)), 0);
  return { orders_waiting: Number(waiting.n), to_receive: open.length, low_stock: positions.filter(b => b.low), committed_fcfa: committed,
    needs: Number(needsCount.n), quotes_waiting: Number(quotesCount.n), recent_orders: recent.map(o => serializeDocument(o, 'order')), settings: conf };
}
module.exports = { settings, saveSettings, refs, articles, saveArticle, locations, createLocation, stock, setStockMinimum, needs, contracts, dashboard,
  approvers, issuers, refuseNeed, listDocuments, detail, saveDocument, receiveQuote, quoteToOrder, cancelDocument, submitOrder, approveOrder, reopenOrder, informPayment, movements, movementDetail, saveMovement, postMovement, cancelMovement, receiveOrder, prepareInvoice };


