/** Import de prospects et de clients depuis un fichier CSV / Excel (lu dans le dashboard). */
const express = require('express');
const { z } = require('zod');
const { ah, parse, HttpError } = require('../lib/http');
const { runImport } = require('../services/importer');

const cell = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]).optional();
const rowSchema = z.object({
  _line: z.number().int().optional(),
  legacy_number: cell, name: cell, first_name: cell, phone: cell, email: cell, country: cell, diaspora: cell, project: cell, financing: cell, stage: cell, notes: cell,
  lot: cell, ilot: cell, property_type: cell, price: cell, reserved_at: cell, paid: cell, paid_at: cell, client_code: cell,
});

module.exports = function importRoutes(db) {
  const r = express.Router();
  r.post('/import', ah(async (req, res) => {
    const data = parse(z.object({
      mode: z.enum(['prospects', 'clients']),
      rows: z.array(rowSchema).min(1).max(3000),
      dry_run: z.boolean().default(true),
      create_lots: z.boolean().default(true),
      open_access: z.boolean().default(false), // clients : ouvre l'espace client avec un mot de passe provisoire
    }), req.body);
    const perm = data.mode === 'clients' ? 'sales:write' : 'leads:write';
    if (!req.can(perm)) throw new HttpError(403, 'Droits insuffisants pour cet import.');
    if (data.open_access && !req.can('client_access:write')) throw new HttpError(403, 'Droits insuffisants pour ouvrir les espaces clients.');
    res.json(await runImport(db, {
      mode: data.mode, rows: data.rows, dryRun: data.dry_run, createLots: data.create_lots, openAccess: data.open_access, user: req.user,
    }));
  }));
  return r;
};
