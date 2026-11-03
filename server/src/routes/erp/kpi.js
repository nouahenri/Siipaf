/**
 * ERP · RH › Performance et entretiens › Référentiel KPI (demande du client du 27/10) : indicateurs, modèles d'objectifs
 * par service et par poste et leur application, objectifs collectifs des services, part des objectifs collectifs dans le
 * score d'un service. Gestion réservée au droits « kpi:indicators », « kpi:templates » et « kpi:department » (service RH et Direction) ; lecture du référentiel par
 * tout compte de l'ERP (formulaires d'objectifs des responsables).
 */
const express = require('express');
const { z } = require('../../lib/zod');
const { departmentKey } = require('../../lib/org');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { KPI_LEVELS, OBJECTIVE_PERIODS, OBJECTIVE_STATUSES, OBJECTIVE_METRICS, periodRange } = require('../../lib/rh');
const { DEPARTMENTS } = require('../../lib/paie');
const kpi = require('../../services/kpi');
const rh = require('../../services/rh');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const insertedId = r => (typeof r === 'object' ? r.id : r);
const pctField = z.number().int().min(0).max(100);

const kpiSchema = z.object({
  name: z.string().trim().min(3).max(120), family: z.string().trim().min(2).max(60), metric: z.enum(Object.keys(OBJECTIVE_METRICS)).default('manuel'),
  level: z.enum(Object.keys(KPI_LEVELS)).default('tous'), description: optText(500), warn_pct: pctField.default(50), ok_pct: pctField.default(100), active: z.boolean().optional(),
});
const lineSchema = z.object({
  kpi_id: z.number().int().positive(), period: z.enum(Object.keys(OBJECTIVE_PERIODS)).default('annee'),
  target_value: z.number().int().min(0).nullable().optional(), weight: z.number().int().min(1).max(10).default(1),
});
const scopeSchema = z.object({
  scope: z.enum(['service', 'poste']), department: departmentKey.optional().nullable(), position_id: z.number().int().positive().optional().nullable(),
});
const collectiveSchema = z.object({
  department: departmentKey, year: z.number().int().min(2000).max(2100), period: z.enum(Object.keys(OBJECTIVE_PERIODS)).default('annee'),
  period_index: z.number().int().min(1).max(12).optional().nullable(), kpi_id: z.number().int().positive().optional().nullable(),
  title: z.string().trim().min(3).max(200), description: optText(1000), target_value: z.number().int().min(0).optional().nullable(),
  weight: z.number().int().min(1).max(10).default(1), progress: z.number().int().min(0).max(100).optional(), status: z.enum(Object.keys(OBJECTIVE_STATUSES)).optional(),
  due_date: day.optional().nullable(),
});

module.exports = function kpiRoutes(db) {
  const r = express.Router();
  const indicators = requirePermission('kpi:indicators');
  const templates = requirePermission('kpi:templates');
  const department = requirePermission('kpi:department');
  const canSee = (req, res, next) => (['kpi:indicators', 'kpi:templates', 'kpi:department', 'rh:read'].some(p => req.can(p)) ? next() : next(new HttpError(403, 'Droits insuffisants.')));

  // ─── Indicateurs ──────────────────────────────────────────
  r.get('/kpis', ah(async (req, res) => {
    const settings = await rh.getSettings(db);
    res.json({
      kpis: await kpi.listKpis(db), levels: KPI_LEVELS, periods: OBJECTIVE_PERIODS, collective_pct: settings.service_collective_pct ?? 50,
      metrics: Object.fromEntries(Object.entries(OBJECTIVE_METRICS).filter(([k]) => k !== 'manuel').map(([k, m]) => [k, { label: m.label, group: m.group, unit: m.unit, service_only: m.level === 'service' }])),
    });
  }));
  r.post('/kpis', indicators, ah(async (req, res) => res.status(201).json(kpi.serializeKpi(await kpi.createKpi(db, parse(kpiSchema, req.body))))));
  r.patch('/kpis/:id', indicators, ah(async (req, res) => {
    const k = await kpi.getKpi(db, idParam(req));
    res.json(kpi.serializeKpi(await kpi.updateKpi(db, k, parse(kpiSchema.partial(), req.body))));
  }));

  /** Part des objectifs collectifs dans le score d'un service (le reste : moyenne des employés). */
  r.put('/kpi-settings', indicators, ah(async (req, res) => {
    const { service_collective_pct } = parse(z.object({ service_collective_pct: pctField }), req.body);
    const s = await rh.saveSettings(db, { service_collective_pct });
    res.json({ collective_pct: s.service_collective_pct });
  }));

  // ─── Modèles d'objectifs ──────────────────────────────────
  r.get('/kpi-templates', canSee, ah(async (req, res) => res.json(await kpi.listTemplates(db))));
  r.put('/kpi-templates', templates, ah(async (req, res) => {
    const data = parse(scopeSchema.extend({ lines: z.array(lineSchema).max(40) }), req.body);
    await kpi.saveTemplate(db, data, req.user);
    res.json(await kpi.listTemplates(db));
  }));
  /**
   * Application des modèles pour une année : à un service, à un poste, ou à tout le personnel. Sans `confirm`, seulement
   * l'aperçu (objectifs à créer, à mettre à jour, conservés, impossibles).
   */
  r.post('/kpi-templates/apply', templates, ah(async (req, res) => {
    const data = parse(scopeSchema.partial().extend({ year: z.number().int().min(2000).max(2100), confirm: z.boolean().optional() }), req.body);
    const employees = await kpi.employeesFor(db, data);
    res.json({ ...(await kpi.apply(db, { employees, year: data.year, user: req.user, dryRun: !data.confirm })), confirmed: !!data.confirm });
  }));

  // ─── Objectifs collectifs des services ────────────────────
  async function collectiveData(data, current = null) {
    const next = { ...(current || {}), ...data };
    next.period_index = kpi.checkPeriod(next.period, next.period_index ?? null);
    if (data.kpi_id !== undefined || !current) {
      if (next.kpi_id) {
        const k = await kpi.kpiFor(db, next.kpi_id, 'service');
        next.metric = k.metric;
      } else next.metric = 'manuel';
    }
    if (next.metric !== 'manuel' && next.target_value == null) throw new HttpError(400, 'Indiquez la valeur cible de l’indicateur.');
    if (!next.due_date && !current) next.due_date = periodRange(next.year, next.period, next.period_index).to;
    return next;
  }
  r.post('/department-objectives', department, ah(async (req, res) => {
    const data = await collectiveData(parse(collectiveSchema, req.body));
    const [id] = await db('hr_department_objectives').insert({ ...data, created_by: req.user.id });
    res.status(201).json(await db('hr_department_objectives').where({ id: insertedId(id) }).first());
  }));
  r.patch('/department-objectives/:id', department, ah(async (req, res) => {
    const o = await db('hr_department_objectives').where({ id: idParam(req) }).first();
    if (!o) throw new HttpError(404, 'Objectif introuvable.');
    const patch = parse(collectiveSchema.partial().omit({ department: true, year: true }), req.body);
    const next = await collectiveData(patch, o);
    const fields = ['period', 'period_index', 'kpi_id', 'metric', 'title', 'description', 'target_value', 'weight', 'progress', 'status', 'due_date'];
    await db('hr_department_objectives').where({ id: o.id }).update({ ...Object.fromEntries(fields.filter(f => f in patch || ['period_index', 'metric'].includes(f)).map(f => [f, next[f]])), updated_at: new Date() });
    res.json(await db('hr_department_objectives').where({ id: o.id }).first());
  }));
  r.delete('/department-objectives/:id', department, ah(async (req, res) => {
    if (!(await db('hr_department_objectives').where({ id: idParam(req) }).del())) throw new HttpError(404, 'Objectif introuvable.');
    res.json({ ok: true });
  }));

  return r;
};
