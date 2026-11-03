/**
 * ERP · Directions et services (RH › Réglages et Administration générale › Réglages, mêmes données). Lecture pour tout compte
 * connecté (la liste sert partout dans l'ERP) ; ajout, modification, archivage, fusion et suppression avec le privilège
 * « Directions et services » (org:structure).
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
  r.delete('/:id', write, ah(async (req, res) => {
    await organisation.remove(db, idParam(req));
    res.json(await organisation.list(db));
  }));
  return r;
};
