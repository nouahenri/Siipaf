/** ERP · Chantiers › Déboursé sec : référentiels (Chantiers › Réglages) et estimations, report au budget d'un chantier. */
const express = require('express');
const { z } = require('../../lib/zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { NATURES, LOTS, PARAMS, BASES } = require('../../lib/debourse');
const debourse = require('../../services/debourse');
const chantiers = require('../../services/chantiers');

const code = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._-]+$/, 'Code : lettres, chiffres, tiret, point');
const resourceSchema = z.object({
  code, nature: z.enum(Object.keys(NATURES)), label: z.string().trim().min(2).max(160), unit: z.string().trim().min(1).max(30),
  unit_price: z.number().int().min(0).max(1e9), loss_pct: z.number().min(0).max(50), article_id: z.number().int().positive().nullable().optional(),
  price_checked: z.boolean().optional(), active: z.boolean().optional(),
});
const workSchema = z.object({
  code, lot: z.enum(Object.keys(LOTS)), label: z.string().trim().min(2).max(200), unit: z.string().trim().min(1).max(30), active: z.boolean().optional(),
  composition: z.array(z.object({ resource_id: z.number().int().positive(), quantity: z.number().positive().max(1e6) })).max(40),
});
const paramsSchema = z.object(Object.fromEntries(Object.keys(PARAMS).map(k => [k, k === 'logements' ? z.number().optional().nullable() : z.number()])));
const modelSchema = z.object({
  label: z.string().trim().min(2).max(160), property_type_id: z.number().int().positive().nullable().optional(), description: z.string().trim().max(500).nullable().optional(),
  params: paramsSchema, with_roof: z.boolean(), active: z.boolean().optional(),
  lines: z.array(z.object({ work_id: z.number().int().positive(), base: z.enum(Object.keys(BASES)), ratio: z.number().min(0).max(1e5) })).max(80),
});
const pct = z.number().min(0).max(30);
const optId = z.number().int().positive().nullable().optional();
const estimateSchema = z.object({
  model_id: z.number().int().positive(), label: z.string().trim().min(2).max(200).optional(), params: paramsSchema, units: z.number().int().min(1).max(500).optional(),
  with_roof: z.boolean().optional(), site_pct: pct.optional(), contingency_pct: pct.optional(), notes: z.string().trim().max(1000).nullable().optional(),
  project_id: optId, worksite_id: optId, property_type_id: optId,
});
const quantity = z.number().min(0).max(1e7);

module.exports = function debourseRoutes(db) {
  const r = express.Router();
  const settings = requirePermission('chantiers:settings');
  const write = requirePermission('chantiers:estimate');
  // Lecture : qui voit les chantiers, estime ou règle les référentiels ; le conducteur d'un chantier voit les estimations
  const read = ah(async (req, res, next) => {
    if (['chantiers:read', 'chantiers:estimate', 'chantiers:settings', 'chantiers:budget', 'direction:read'].some(p => req.can(p))) return next();
    if (await db('worksites').where({ manager_id: req.user.id }).first('id')) return next();
    throw new HttpError(403, 'Droits insuffisants.');
  });

  r.get('/refs', read, ah(async (req, res) => res.json(await debourse.refs(db))));

  // ─── Référentiels (Chantiers › Réglages) ──────────────────
  r.post('/ressources', settings, ah(async (req, res) => { await debourse.saveResource(db, parse(resourceSchema, req.body)); res.status(201).json(await debourse.resources(db)); }));
  r.patch('/ressources/:id', settings, ah(async (req, res) => { await debourse.saveResource(db, parse(resourceSchema.partial(), req.body), idParam(req)); res.json(await debourse.resources(db)); }));
  r.delete('/ressources/:id', settings, ah(async (req, res) => { await debourse.removeResource(db, idParam(req)); res.json(await debourse.resources(db)); }));
  r.post('/ouvrages', settings, ah(async (req, res) => { await debourse.saveWork(db, parse(workSchema, req.body)); res.status(201).json(await debourse.works(db)); }));
  r.patch('/ouvrages/:id', settings, ah(async (req, res) => { await debourse.saveWork(db, parse(workSchema.partial(), req.body), idParam(req)); res.json(await debourse.works(db)); }));
  r.delete('/ouvrages/:id', settings, ah(async (req, res) => { await debourse.removeWork(db, idParam(req)); res.json(await debourse.works(db)); }));
  r.post('/modeles', settings, ah(async (req, res) => { await debourse.saveModel(db, parse(modelSchema, req.body)); res.status(201).json(await debourse.models(db)); }));
  r.patch('/modeles/:id', settings, ah(async (req, res) => { await debourse.saveModel(db, parse(modelSchema.partial(), req.body), idParam(req)); res.json(await debourse.models(db)); }));
  r.delete('/modeles/:id', settings, ah(async (req, res) => { await debourse.removeModel(db, idParam(req)); res.json(await debourse.models(db)); }));

  // ─── Estimations ──────────────────────────────────────────
  r.get('/estimations', read, ah(async (req, res) => res.json(await debourse.listEstimates(db, { worksite_id: Number(req.query.worksite_id) || null, project_id: Number(req.query.project_id) || null }))));
  r.post('/apercu', write, ah(async (req, res) => res.json(await debourse.preview(db, parse(estimateSchema, req.body)))));
  r.post('/estimations', write, ah(async (req, res) => res.status(201).json(await debourse.createEstimate(db, parse(estimateSchema, req.body), req.user))));
  r.get('/estimations/:id', read, ah(async (req, res) => res.json(await debourse.getEstimate(db, idParam(req)))));
  r.patch('/estimations/:id', write, ah(async (req, res) => {
    const data = parse(estimateSchema.omit({ model_id: true }).partial().extend({
      quantities: z.array(z.object({ key: z.string().max(10), quantity: quantity.nullable() })).max(200).optional(),
      remove: z.array(z.string().max(10)).max(200).optional(),
      add: z.array(z.object({ work_id: z.number().int().positive(), quantity })).max(50).optional(),
    }), req.body);
    res.json(await debourse.updateEstimate(db, idParam(req), data, req.user));
  }));
  r.post('/estimations/:id/prix', write, ah(async (req, res) => res.json(await debourse.repriceEstimate(db, idParam(req), req.user))));
  r.delete('/estimations/:id', write, ah(async (req, res) => { await debourse.removeEstimate(db, idParam(req)); res.json({ ok: true }); }));
  // Report au budget : droit « Budget de tous les chantiers » ou conducteur du chantier (même règle que les lignes de budget)
  r.post('/estimations/:id/budget', write, ah(async (req, res) => {
    const { worksite_id, with_costs } = parse(z.object({ worksite_id: z.number().int().positive(), with_costs: z.boolean().optional() }), req.body);
    const w = await chantiers.managedWorksite(db, worksite_id, { user: req.user, can: p => req.can(p) }, 'chantiers:budget');
    res.json(await debourse.toBudget(db, idParam(req), w, { withCosts: with_costs !== false }));
  }));
  return r;
};
