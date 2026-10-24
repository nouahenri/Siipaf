/** Lieux hors programmes (siège, bureaux, dépôts) : liste pour tous les formulaires, réglage par lieux:write. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const lieux = require('../../services/lieux');

const schema = z.object({
  kind: z.enum(Object.keys(lieux.PLACE_KINDS)), kind_other: z.string().trim().max(80).nullable().optional(), name: z.string().trim().min(2).max(160),
  address: z.string().trim().max(255).nullable().optional(), city: z.string().trim().max(80).nullable().optional(), active: z.boolean().optional(),
});

module.exports = function lieuxRoutes(db) {
  const r = express.Router();
  const write = requirePermission('lieux:write');
  /** Programmes (et chantiers) et lieux actifs : listes « Imputation » des achats, dépenses, frais, pointages, contrats. */
  r.get('/choix', ah(async (req, res) => res.json(await lieux.choices(db))));
  r.get('/', ah(async (req, res) => res.json({ kinds: lieux.PLACE_KINDS, places: await lieux.list(db, { all: req.query.tous === '1' }) })));
  r.post('/', write, ah(async (req, res) => {
    await lieux.save(db, parse(schema, req.body));
    res.status(201).json(await lieux.list(db, { all: true }));
  }));
  r.patch('/:id', write, ah(async (req, res) => {
    await lieux.save(db, parse(schema.partial(), req.body), idParam(req));
    res.json(await lieux.list(db, { all: true }));
  }));
  r.delete('/:id', write, ah(async (req, res) => {
    await lieux.remove(db, idParam(req));
    res.json(await lieux.list(db, { all: true }));
  }));
  return r;
};
