/**
 * ERP · Directions et services (RH › Réglages et Administration générale › Réglages, mêmes données). Lecture pour tout compte
 * connecté (la liste sert partout dans l'ERP) ; ajout, modification, archivage, fusion et suppression avec le privilège
 * « Directions et services » (org:structure), comme le panneau d'une entrée (son personnel), la réaffectation du personnel
 * (tracée sur chaque fiche, l'employé prévenu) et l'ordre tiré du glisser-déposer.
 */
const express = require('express');
const { z } = require('../../lib/zod');
const { ah, parse, idParam } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const organisation = require('../../services/organisation');

const label = z.string().trim().min(2).max(80);
const fields = {
  label, direction_id: z.number().int().positive().nullable().optional(), module: z.string().max(30).nullable().optional(),
  sort: z.number().int().min(0).max(1000).optional(),
};

module.exports = function organisationRoutes(db) {
  const r = express.Router();
  const write = requirePermission('org:structure');
  r.get('/', ah(async (req, res) => res.json(await organisation.list(db))));
  r.post('/', write, ah(async (req, res) => {
    const data = parse(z.object({ kind: z.enum(['direction', 'service']), ...fields }), req.body);
    const id = await organisation.create(db, data);
    res.status(201).json({ id, ...(await organisation.list(db)) });
  }));
  r.patch('/:id', write, ah(async (req, res) => {
    await organisation.update(db, idParam(req), parse(z.object({ ...fields, active: z.boolean() }).partial(), req.body));
    res.json(await organisation.list(db));
  }));
  r.post('/:id/merge', write, ah(async (req, res) => {
    const { into } = parse(z.object({ into: z.number().int().positive() }), req.body);
    await organisation.merge(db, idParam(req), into);
    res.json(await organisation.list(db));
  }));
  r.put('/order', write, ah(async (req, res) => {
    const { items } = parse(z.object({ items: z.array(z.object({ id: z.number().int().positive(), direction_id: z.number().int().positive().nullable() })).min(1).max(500) }), req.body);
    await organisation.reorder(db, items);
    res.json(await organisation.list(db));
  }));
  r.post('/reassign', write, ah(async (req, res) => {
    const data = parse(z.object({ employee_ids: z.array(z.number().int().positive()).min(1).max(500), department: z.string().trim().max(20) }), req.body);
    const moved = await organisation.reassign(db, data.employee_ids, data.department, { user: req.user });
    res.json({ moved, ...(await organisation.list(db)) });
  }));
  r.get('/:id', write, ah(async (req, res) => res.json(await organisation.detail(db, idParam(req)))));
  r.delete('/:id', write, ah(async (req, res) => {
    const into = req.query.into ? Number(req.query.into) : null;
    await organisation.remove(db, idParam(req), { into: Number.isInteger(into) && into > 0 ? into : null });
    res.json(await organisation.list(db));
  }));
  return r;
};
