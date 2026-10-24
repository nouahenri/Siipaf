/** ERP · Chantiers : chantiers d'un programme, phases (Gantt), tâches (Kanban), budget par poste. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { WORKSITE_STATUSES, WORKSITE_ZONES, TASK_STATUSES, BUDGET_CATEGORIES, SITE_STAGES, CHANTIER_SETTINGS } = require('../../lib/domain');
const chantiers = require('../../services/chantiers');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optDay = day.nullable().optional();
const optId = z.number().int().positive().nullable().optional();
const optText = n => z.string().trim().max(n).nullable().optional();

const worksiteSchema = z.object({
  project_id: z.number().int().positive(), name: z.string().trim().min(2).max(160),
  zone_kind: z.enum(Object.keys(WORKSITE_ZONES)).optional(), zone: z.array(z.union([z.string().max(40), z.number().int().positive()])).max(2000).optional(),
  manager_id: optId, status: z.enum(Object.keys(WORKSITE_STATUSES)).optional(),
  planned_start: optDay, planned_end: optDay, actual_start: optDay, actual_end: optDay, description: optText(4000),
  stages: z.array(z.enum(SITE_STAGES)).optional(), // phases de départ (création seulement)
});
const phaseSchema = z.object({
  stage: z.enum(SITE_STAGES).nullable().optional(), label: z.string().trim().min(2).max(160),
  planned_start: optDay, planned_end: optDay, actual_start: optDay, actual_end: optDay,
  progress_pct: z.number().int().min(0).max(100).optional(), depends_on_id: optId, notes: optText(2000),
});
const taskSchema = z.object({
  title: z.string().trim().min(2).max(200), description: optText(4000), status: z.enum(Object.keys(TASK_STATUSES)).optional(),
  phase_id: optId, milestone: z.boolean().optional(), employee_id: optId, supplier_id: optId, team: optText(120),
  start_on: optDay, due_on: optDay, done_on: optDay,
});
const budgetSchema = z.object({
  category: z.enum(Object.keys(BUDGET_CATEGORIES)), label: z.string().trim().min(2).max(160), phase_id: optId,
  amount_fcfa: z.number().int().min(0), notes: optText(1000),
});

module.exports = function chantiersRoutes(db) {
  const r = express.Router();
  const viewer = req => ({ user: req.user, can: p => req.can(p) });
  const managed = req => chantiers.managedWorksite(db, idParam(req), viewer(req));
  const sendDetail = async (req, res, w, status = 200) => res.status(status).json(await chantiers.detail(db, await chantiers.loadWorksite(db, w.id), viewer(req)));
  const childId = (req, key) => {
    const n = Number(req.params[key]);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identifiant invalide.');
    return n;
  };

  r.get('/badges', ah(async (req, res) => res.json(await chantiers.badges(db, viewer(req)))));
  r.get('/refs', ah(async (req, res) => res.json({ ...(await chantiers.refs(db)), settings: await chantiers.settings(db), setting_fields: CHANTIER_SETTINGS })));
  /** Programmes et chantiers non clos : listes « Lieu / chantier » des pointages, du Parc et des achats. */
  r.get('/lieux', ah(async (req, res) => res.json(await chantiers.places(db))));
  r.put('/reglages', requirePermission('chantiers:write'), ah(async (req, res) => {
    const shape = Object.fromEntries(Object.entries(CHANTIER_SETTINGS).map(([k, x]) => [k, z.number().int().min(x.min).max(x.max)]));
    res.json(await chantiers.saveSettings(db, parse(z.object(shape).partial(), req.body)));
  }));
  r.get('/programmes/:id', ah(async (req, res) => res.json(await chantiers.programme(db, idParam(req)))));

  r.get('/', ah(async (req, res) => {
    res.json(await chantiers.list(db, viewer(req), { status: req.query.status ?? 'ouverts', projectId: Number(req.query.project_id) || null, q: String(req.query.q || '').trim() }));
  }));
  r.post('/', requirePermission('chantiers:write'), ah(async (req, res) => {
    const w = await chantiers.create(db, parse(worksiteSchema, req.body), req.user);
    await sendDetail(req, res, w, 201);
  }));
  r.get('/:id', ah(async (req, res) => res.json(await chantiers.detail(db, await chantiers.visibleWorksite(db, idParam(req), viewer(req)), viewer(req)))));
  r.patch('/:id', ah(async (req, res) => {
    const w = await managed(req);
    const data = parse(worksiteSchema.omit({ stages: true, project_id: true }).partial(), req.body);
    // Seul un gestionnaire des chantiers change le conducteur (le conducteur ne se désigne pas un remplaçant)
    if (data.manager_id !== undefined && Number(data.manager_id || 0) !== Number(w.manager_id || 0) && !req.can('chantiers:write')) {
      throw new HttpError(403, 'Seul un gestionnaire des chantiers change le conducteur.');
    }
    await sendDetail(req, res, await chantiers.update(db, w, data, req.user));
  }));
  r.delete('/:id', requirePermission('chantiers:write'), ah(async (req, res) => {
    await chantiers.remove(db, await managed(req));
    res.status(204).end();
  }));

  // ─── Phases ───────────────────────────────────────────────
  r.post('/:id/phases', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.savePhase(db, w, parse(phaseSchema, req.body));
    await sendDetail(req, res, w, 201);
  }));
  r.patch('/:id/phases/:phaseId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.savePhase(db, w, parse(phaseSchema.partial(), req.body), childId(req, 'phaseId'));
    await sendDetail(req, res, w);
  }));
  r.delete('/:id/phases/:phaseId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.deletePhase(db, w, childId(req, 'phaseId'));
    await sendDetail(req, res, w);
  }));
  r.put('/:id/phases/ordre', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.reorderPhases(db, w, parse(z.object({ ids: z.array(z.number().int().positive()) }), req.body).ids);
    await sendDetail(req, res, w);
  }));

  // ─── Tâches ───────────────────────────────────────────────
  r.post('/:id/taches', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.saveTask(db, w, parse(taskSchema, req.body), req.user);
    await sendDetail(req, res, w, 201);
  }));
  r.patch('/:id/taches/:taskId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.saveTask(db, w, parse(taskSchema.partial(), req.body), req.user, childId(req, 'taskId'));
    await sendDetail(req, res, w);
  }));
  r.delete('/:id/taches/:taskId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.deleteTask(db, w, childId(req, 'taskId'));
    await sendDetail(req, res, w);
  }));

  // ─── Budget ───────────────────────────────────────────────
  r.post('/:id/budget', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.saveBudgetLine(db, w, parse(budgetSchema, req.body));
    await sendDetail(req, res, w, 201);
  }));
  r.patch('/:id/budget/:lineId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.saveBudgetLine(db, w, parse(budgetSchema.partial(), req.body), childId(req, 'lineId'));
    await sendDetail(req, res, w);
  }));
  r.delete('/:id/budget/:lineId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.deleteBudgetLine(db, w, childId(req, 'lineId'));
    await sendDetail(req, res, w);
  }));

  return r;
};
