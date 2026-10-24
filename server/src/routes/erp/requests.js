/** ERP · Administration générale › Demandes internes : demande, validations, prise en charge, clôture. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { REQUEST_KINDS, REQUEST_STATUSES } = require('../../lib/domain');
const { getSetting } = require('../../services/settings');
const requests = require('../../services/requests');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

module.exports = function requestRoutes(db) {
  const r = express.Router();
  const v = req => ({ userId: req.user.id, can: p => req.can(p), superAdmin: req.user.role === 'super_admin' });

  r.get('/refs', ah(async (req, res) => {
    const handle = req.can('demandes:handle');
    res.json({
      kinds: REQUEST_KINDS, statuses: REQUEST_STATUSES, threshold: await getSetting(db, 'request_dg_threshold'),
      projects: await db('projects').orderBy('name').select('id', 'name'),
      suppliers: handle ? await db('suppliers').where({ active: true }).orderBy('name').select('id', 'name') : [],
    });
  }));
  r.get('/badges', ah(async (req, res) => res.json(await requests.badges(db, v(req)))));
  r.get('/', ah(async (req, res) => res.json(await requests.list(db, v(req), { scope: String(req.query.scope || 'mine'), status: req.query.status || null }))));

  r.post('/', requirePermission('self:demandes'), ah(async (req, res) => {
    const data = parse(z.object({
      kind: z.enum(Object.keys(REQUEST_KINDS)), kind_other: z.string().trim().max(100).nullable().optional(), title: z.string().trim().min(3).max(200),
      details: z.string().trim().max(4000).nullable().optional(), quantity: z.string().trim().max(60).nullable().optional(),
      estimated_amount: z.number().int().min(0).nullable().optional(), project_id: z.number().int().positive().nullable().optional(),
      worksite_id: z.number().int().positive().nullable().optional(), place_id: z.number().int().positive().nullable().optional(),
      location: z.string().trim().max(120).nullable().optional(), needed_by: day.nullable().optional(), urgency: z.enum(['normale', 'urgente']).optional(),
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
