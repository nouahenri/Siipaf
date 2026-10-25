const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { stockQuantityUnits } = require('../../lib/domain');
const s = require('../../services/appro');
const id = z.number().int().positive();
const optId = id.nullable().optional();
const text = n => z.string().trim().max(n).nullable().optional().transform(v => v || null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }, 'Date invalide');
const qty = z.number().positive().refine(v => stockQuantityUnits(v) !== null, 'Quantité au centième, de 0,01 à 10 000 000');
const minimum = z.number().min(0).refine(v => stockQuantityUnits(v) !== null, 'Seuil au centième attendu');
const item = z.object({ article_id: id, quantity: qty, unit_price_fcfa: z.number().int().min(0).max(1000000000).nullable().optional(), need_id: optId });
const doc = z.object({ supplier_id: id, location_id: id, date: day, needed_on: day.nullable().optional(), vat_rate: z.number().min(0).max(100), supplier_ref: text(100), note: text(5000), lines: z.array(item).min(1).max(100) });
const article = z.object({ code: z.string().trim().min(1).max(40), label: z.string().trim().min(2).max(200), unit: z.string().trim().min(1).max(30), min_quantity: minimum.default(0), active: z.boolean().default(true) });
// Bon de commande : prix obligatoires et validateur désigné par l'émetteur (contrôlé à la soumission).
const order = doc.omit({ supplier_ref: true }).extend({ issuer_id: optId, approver_id: optId, lines: z.array(item.extend({ unit_price_fcfa: z.number().int().min(0).max(1000000000) })).min(1).max(100) });
const movement = z.object({ kind: z.enum(['entree', 'sortie', 'transfert']), from_location_id: optId, to_location_id: optId, date: day, note: z.string().trim().min(3).max(5000), lines: z.array(z.object({ article_id: id, quantity: qty })).min(1).max(100) });
module.exports = db => {
  const r = express.Router(); r.use(requirePermission('appro:read'));
  const actor = req => ({ userId: req.user.id, superAdmin: req.user.role === 'super_admin', can: req.can });
  const action = perm => requirePermission(perm);
  r.get('/refs', ah(async (req, res) => res.json(await s.refs(db))));
  r.get('/dashboard', ah(async (req, res) => res.json(await s.dashboard(db))));
  r.get('/settings', action('appro:settings'), ah(async (req, res) => res.json(await s.settings(db))));
  r.put('/settings', action('appro:settings'), ah(async (req, res) => res.json(await s.saveSettings(db, parse(z.object({ direction_threshold: z.number().int().min(0).max(1000000000000) }), req.body), req.user.id))));
  r.get('/articles', ah(async (req, res) => res.json(await s.articles(db))));
  r.post('/articles', action('appro:write'), ah(async (req, res) => res.status(201).json(await s.saveArticle(db, parse(article, req.body), null, req.user.id))));
  r.put('/articles/:id', action('appro:write'), ah(async (req, res) => res.json(await s.saveArticle(db, parse(article, req.body), idParam(req), req.user.id))));
  r.get('/locations', ah(async (req, res) => res.json(await s.locations(db))));
  r.post('/locations', action('appro:write'), ah(async (req, res) => res.status(201).json(await s.createLocation(db, parse(z.object({ place_id: optId, worksite_id: optId }), req.body), req.user.id))));
  r.get('/stock', ah(async (req, res) => res.json(await s.stock(db))));
  r.put('/stock/minimum', action('appro:stock'), ah(async (req, res) => res.json(await s.setStockMinimum(db, parse(z.object({ article_id: id, location_id: id, min_quantity: minimum.nullable() }), req.body), req.user.id))));
  r.get('/needs', ah(async (req, res) => res.json(await s.needs(db))));
  r.post('/needs/:id/refuse', action('appro:write'), ah(async (req, res) => res.json(await s.refuseNeed(db, idParam(req), parse(z.object({ reason: z.string().trim().min(3).max(255) }), req.body).reason, req.user.id))));
  r.get('/contracts', action('contrats:read'), ah(async (req, res) => res.json(await s.contracts(db))));
  for (const [url, type] of [['orders', 'order'], ['quotes', 'quote']]) {
    r.get(`/${url}`, ah(async (req, res) => res.json(await s.listDocuments(db, type, { status: req.query.status || null }))));
    r.post(`/${url}`, action('appro:write'), ah(async (req, res) => res.status(201).json(await s.saveDocument(db, type, parse(type === 'order' ? order : doc, req.body), null, req.user.id))));
    r.get(`/${url}/:id`, ah(async (req, res) => res.json(await s.detail(db, type, idParam(req)))));
    r.put(`/${url}/:id`, action('appro:write'), ah(async (req, res) => res.json(await s.saveDocument(db, type, parse(type === 'order' ? order : doc, req.body), idParam(req), req.user.id))));
    r.post(`/${url}/:id/cancel`, action('appro:write'), ah(async (req, res) => res.json(await s.cancelDocument(db, type, idParam(req), req.user.id))));
  }
  r.post('/quotes/:id/received', action('appro:write'), ah(async (req, res) => res.json(await s.receiveQuote(db, idParam(req), req.user.id))));
  r.post('/quotes/:id/order', action('appro:write'), ah(async (req, res) => res.status(201).json(await s.quoteToOrder(db, idParam(req), req.user.id))));
  r.get('/approvers', ah(async (req, res) => res.json(await s.approvers(db))));
  r.get('/issuers', ah(async (req, res) => res.json(await s.issuers(db))));
  r.post('/orders/:id/submit', action('appro:write'), ah(async (req, res) => res.json(await s.submitOrder(db, idParam(req), actor(req)))));
  r.post('/orders/:id/reopen', action('appro:write'), ah(async (req, res) => res.json(await s.reopenOrder(db, idParam(req), req.user.id))));
  r.post('/orders/:id/approve', requirePermission('appro:validate', 'appro:direction'), ah(async (req, res) => res.json(await s.approveOrder(db, idParam(req), actor(req)))));
  r.post('/orders/:id/refuse', requirePermission('appro:validate', 'appro:direction'), ah(async (req, res) => res.json(await s.approveOrder(db, idParam(req), actor(req), { refuse: true, reason: parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body).reason }))));
  r.post('/orders/:id/receive', action('appro:stock'), ah(async (req, res) => res.json(await s.receiveOrder(db, idParam(req), parse(z.object({ date: day, supplier_ref: text(100), note: text(5000), lines: z.array(z.object({ order_line_id: id, quantity: qty })).min(1).max(100) }), req.body), actor(req)))));
  // Reprend les droits existants de la Comptabilité ; aucun nouveau rôle n'obtient le droit de facturer.
  r.post('/orders/:id/invoice', action('achats:write'), action('compta:read'), ah(async (req, res) => res.status(201).json(await s.prepareInvoice(db, idParam(req), parse(z.object({ date: day, due_date: day.nullable().optional(), supplier_ref: z.string().trim().min(1).max(60), expense_account: z.string().trim().min(2).max(12), receipt_ids: z.array(id).min(1).max(100).optional() }), req.body), req.user.id))));
  r.get('/movements', ah(async (req, res) => res.json(await s.movements(db))));
  r.post('/movements', action('appro:stock'), ah(async (req, res) => res.status(201).json(await s.saveMovement(db, parse(movement, req.body), null, req.user.id))));
  r.get('/movements/:id', ah(async (req, res) => res.json(await s.movementDetail(db, idParam(req)))));
  r.put('/movements/:id', action('appro:stock'), ah(async (req, res) => res.json(await s.saveMovement(db, parse(movement, req.body), idParam(req), req.user.id))));
  r.post('/movements/:id/post', action('appro:stock'), ah(async (req, res) => res.json(await s.postMovement(db, idParam(req), req.user.id))));
  r.post('/movements/:id/cancel', action('appro:stock'), ah(async (req, res) => res.json(await s.cancelMovement(db, idParam(req), req.user.id))));
  return r;
};

