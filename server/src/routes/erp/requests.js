/** ERP · Administration générale › Demandes internes : demande, validations, prise en charge, clôture. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { REQUEST_KINDS, REQUEST_SERVICES, REQUEST_STATUSES } = require('../../lib/domain');
const { getSetting } = require('../../services/settings');
const requests = require('../../services/requests');
const departments = require('../../services/departments');
const { DEPARTMENTS } = require('../../lib/paie');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

module.exports = function requestRoutes(db) {
  const r = express.Router();
  const v = req => ({ userId: req.user.id, can: p => req.can(p), superAdmin: req.user.role === 'super_admin', depts: req.depts });
  // Service du compte et services qu'il dirige (demandes au nom du service)
  r.use(ah(async (req, res, next) => { req.depts = await departments.departmentsOf(db, req.user.id); next(); }));

  r.get('/refs', ah(async (req, res) => {
    const handle = req.can('demandes:handle');
    res.json({
      kinds: REQUEST_KINDS, statuses: REQUEST_STATUSES, services: Object.fromEntries(Object.entries(REQUEST_SERVICES).map(([k, s]) => [k, s.label])), threshold: await getSetting(db, 'request_dg_threshold'),
      departments: DEPARTMENTS, my_departments: req.depts,
      projects: await db('projects').orderBy('name').select('id', 'name'),
      suppliers: handle ? await db('suppliers').where({ active: true }).orderBy('name').select('id', 'name') : [],
    });
  }));
  r.get('/badges', ah(async (req, res) => res.json(await requests.badges(db, v(req)))));
  // Barre latérale de chaque module : « Mon espace » (fiche employé) et « Demandes du service » (membre ou chef)
  r.get('/espace', ah(async (req, res) => res.json({
    has_employee: !!(await db('employees').where({ user_id: req.user.id }).first('id')),
    departments: req.depts, waiting: await requests.departmentWaiting(db, v(req)),
  })));

  // Bons de commande soumis par les Achats : le validateur ou la Direction les voit et décide ici aussi
  const appro = require('../../services/appro');
  const deciders = requirePermission('appro:validate', 'appro:direction');
  r.get('/commandes', deciders, ah(async (req, res) => res.json(await appro.ordersToValidate(db, v(req)))));
  r.get('/commandes/:id', deciders, ah(async (req, res) => res.json(await appro.detail(db, 'order', idParam(req)))));
  r.post('/commandes/:id/valider', deciders, ah(async (req, res) => res.json(await appro.approveOrder(db, idParam(req), { userId: req.user.id, superAdmin: req.user.role === 'super_admin', can: req.can }))));
  r.post('/commandes/:id/refuser', deciders, ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Indiquez le motif du refus.').max(255) }), req.body);
    res.json(await appro.approveOrder(db, idParam(req), { userId: req.user.id, superAdmin: req.user.role === 'super_admin', can: req.can }, { refuse: true, reason }));
  }));
  r.get('/', ah(async (req, res) => res.json(await requests.list(db, v(req), { scope: String(req.query.scope || 'mine'), status: req.query.status || null, service: req.query.service ? String(req.query.service) : null, department: req.query.department ? String(req.query.department) : null }))));

  r.post('/', requirePermission('self:demandes'), ah(async (req, res) => {
    const data = parse(z.object({
      kind: z.enum(Object.keys(REQUEST_KINDS)), kind_other: z.string().trim().max(100).nullable().optional(), title: z.string().trim().min(3).max(200),
      details: z.string().trim().max(4000).nullable().optional(), quantity: z.string().trim().max(60).nullable().optional(),
      estimated_amount: z.number().int().min(0).nullable().optional(), project_id: z.number().int().positive().nullable().optional(),
      worksite_id: z.number().int().positive().nullable().optional(), place_id: z.number().int().positive().nullable().optional(),
      location: z.string().trim().max(120).nullable().optional(), needed_by: day.nullable().optional(), urgency: z.enum(['normale', 'urgente']).optional(),
      service: z.enum(Object.keys(REQUEST_SERVICES)).nullable().optional(),
      department: z.enum(Object.keys(DEPARTMENTS)).nullable().optional(),
    }), req.body);
    const id = await requests.create(db, data, { user: req.user });
    const row = await requests.load(db, id);
    res.status(201).json({ ...requests.serialize(row), rights: requests.rights(row, v(req)) });
  }));

  async function visible(req) {
    const row = await requests.load(db, idParam(req));
    if (!requests.canSee(row, v(req))) throw new HttpError(404, 'Demande introuvable.');
    return row;
  }
  const out = (req, row) => ({ ...requests.serialize(row), rights: requests.rights(row, v(req)) });

  r.get('/:id', ah(async (req, res) => res.json(out(req, await visible(req)))));
  r.post('/:id/decision', ah(async (req, res) => {
    const data = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }), req.body);
    res.json(out(req, await requests.decide(db, await visible(req), { approve: data.approve, note: data.note || null }, v(req))));
  }));
  r.post('/:id/prendre', ah(async (req, res) => res.json(out(req, await requests.take(db, await visible(req), v(req))))));
  r.post('/:id/cloturer', ah(async (req, res) => {
    const data = parse(z.object({
      outcome: z.enum(['traitee', 'refusee']), note: z.string().trim().max(500).optional(), invoice: z.boolean().optional(),
      supplier_id: z.number().int().positive().optional(), amount_ttc: z.number().int().positive().optional(), vat_rate: z.number().min(0).max(100).optional(),
      expense_account: z.string().trim().max(12).optional(), date: day.optional(), due_date: day.optional(), supplier_ref: z.string().trim().max(60).optional(),
    }), req.body);
    res.json(out(req, await requests.close(db, await visible(req), data, v(req))));
  }));
  r.post('/:id/annuler', ah(async (req, res) => {
    const row = await visible(req);
    await requests.cancel(db, row, v(req));
    res.json(out(req, await requests.load(db, row.id)));
  }));

  return r;
};
