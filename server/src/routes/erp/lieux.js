/** Lieux hors programmes (siège, bureaux, dépôts) : liste pour tous les formulaires, réglage par lieux:write. */
const express = require('express');
const { z } = require('../../lib/zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const lieux = require('../../services/lieux');

const schema = z.object({
  kind: z.enum(Object.keys(lieux.PLACE_KINDS)), kind_other: z.string().trim().max(80).nullable().optional(), name: z.string().trim().min(2).max(160),
  address: z.string().trim().max(255).nullable().optional(), city_id: z.number().int().positive().nullable().optional(),
  location_id: z.number().int().positive().nullable().optional(), active: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
  radius_m: z.number().int().min(5).max(5000).nullable().optional(),
});

// Position et rayon du contrôle de pointage : privilège « Positions de pointage » en plus de la gestion des lieux
const ZONE_KEYS = ['latitude', 'longitude', 'radius_m'];
const zoneRight = (req, data) => {
  if (ZONE_KEYS.some(k => data[k] !== undefined) && !req.can('presence:zones')) throw new HttpError(403, 'La position de pointage d’un lieu se règle avec le privilège « Positions de pointage ».');
  return data;
};

module.exports = function lieuxRoutes(db) {
  const r = express.Router();
  const write = requirePermission('lieux:write');
  /** Programmes (et chantiers) et lieux actifs : listes « Imputation » des achats, dépenses, frais, pointages, contrats. */
  r.get('/choix', ah(async (req, res) => res.json(await lieux.choices(db))));
  r.get('/', ah(async (req, res) => res.json({ kinds: lieux.PLACE_KINDS, places: await lieux.list(db, { all: req.query.tous === '1' }), ...(await lieux.geography(db)) })));
  r.post('/', write, ah(async (req, res) => {
    await lieux.save(db, zoneRight(req, parse(schema, req.body)));
    res.status(201).json(await lieux.list(db, { all: true }));
  }));
  r.patch('/:id', write, ah(async (req, res) => {
    const data = zoneRight(req, parse(schema.partial(), req.body));
    const zone = Object.fromEntries(ZONE_KEYS.filter(k => data[k] !== undefined).map(k => [k, data[k]]));
    for (const k of ZONE_KEYS) delete data[k];
    await lieux.save(db, data, idParam(req));
    // Position : même circuit que RH › Réglages (changer une position existante attend le super administrateur)
    if (Object.keys(zone).length) await require('../../services/presences').setZone(db, 'lieu', idParam(req), { latitude: null, longitude: null, radius_m: null, ...zone }, req.user);
    res.json(await lieux.list(db, { all: true })); // modification en attente : zone_pending du lieu
  }));
  r.delete('/:id', write, ah(async (req, res) => {
    await lieux.remove(db, idParam(req));
    res.json(await lieux.list(db, { all: true }));
  }));
  return r;
};
