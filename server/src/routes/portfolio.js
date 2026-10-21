/**
 * Portefeuille commercial. Dashboard (saisie) : attribution / répartition / transfert, historique d'un prospect.
 * ERP › Service commercial › Objectifs et performance (pilotage) : compteurs de prospects et de clients par
 * commercial et par période, listes importées et leur bilan.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../lib/http');
const { requirePermission } = require('../auth');
const pf = require('../services/portfolio');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

module.exports = function portfolioRoutes(db) {
  const r = express.Router();
  const read = requirePermission('commercial:read'); // écrans de l'ERP

  r.get('/portefeuille', read, ah(async (req, res) => {
    const q = parse(z.object({
      granularite: z.enum(['semaine', 'mois', 'trimestre', 'annee']).default('mois'), du: day, au: day,
      commercial: z.coerce.number().int().positive().optional(),
    }), req.query);
    res.json(await pf.stats(db, req.user, { granularity: q.granularite, from: q.du, to: q.au, userId: q.commercial }));
  }));

  // Attribuer, répartir ou transférer : le responsable (droit « voir les prospects de toute l'équipe ») pour tous ;
  // un commercial peut seulement prendre pour lui des prospects non attribués.
  r.post('/leads/assign', requirePermission('leads:write'), ah(async (req, res) => {
    const data = parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000), user_id: z.number().int().positive().nullable() }), req.body);
    if (!pf.seesAllLeads(req.user)) {
      if (data.user_id !== req.user.id) throw new HttpError(403, 'Un commercial ne peut attribuer un prospect qu’à lui-même.');
      const taken = await db('leads').whereIn('id', data.ids).whereNotNull('assigned_to').whereNot('assigned_to', req.user.id).first('id');
      if (taken) throw new HttpError(403, 'Seul le responsable transfère un prospect déjà attribué.');
    }
    res.json({ changed: await pf.assign(db, data.ids, data.user_id, req.user.id) });
  }));

  r.get('/leads/:id/portefeuille', requirePermission('leads:read'), ah(async (req, res) => res.json(await pf.leadHistory(db, idParam(req)))));

  r.get('/imports', read, ah(async (req, res) => res.json(await pf.importReports(db, req.user))));
  r.get('/imports/:id', read, ah(async (req, res) => {
    const [report] = await pf.importReports(db, req.user, idParam(req));
    if (!report) throw new HttpError(404, 'Liste introuvable.');
    res.json(report);
  }));

  return r;
};
