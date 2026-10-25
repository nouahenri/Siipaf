/**
 * ERP · Réglages des modules sans page de réglages propre (Service commercial, Client & SAV, Administration
 * générale). Lecture pour tout compte connecté (la page montre aussi « Mes notifications ») ; chaque paramètre
 * n'est modifié que par les droits qui le portent.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, HttpError } = require('../../lib/http');
const { MODULE_SETTINGS } = require('../../lib/domain');
const moduleSettings = require('../../services/moduleSettings');

module.exports = function reglagesRoutes(db) {
  const r = express.Router();
  const canEdit = (req, f) => [].concat(f.perm).some(p => req.can(p));
  const view = async (req, module) => ({
    values: await moduleSettings.values(db, module),
    fields: Object.fromEntries(Object.entries(MODULE_SETTINGS[module]).map(([k, f]) => [k, { ...f, perm: undefined, can_edit: canEdit(req, f) }])),
  });
  const known = req => {
    if (!MODULE_SETTINGS[req.params.module]) throw new HttpError(404, 'Module inconnu.');
    return req.params.module;
  };

  r.get('/:module', ah(async (req, res) => res.json(await view(req, known(req)))));

  r.put('/:module', ah(async (req, res) => {
    const module = known(req);
    const fields = Object.entries(MODULE_SETTINGS[module]).filter(([, f]) => canEdit(req, f));
    if (!fields.length) throw new HttpError(403, 'Vous ne réglez pas les paramètres de ce module.');
    const data = parse(z.object(Object.fromEntries(fields.map(([k, f]) => [k, z.number().int().min(f.min).max(f.max)]))).partial().strict(), req.body);
    try {
      await moduleSettings.save(db, module, data);
    } catch (e) {
      if (e.status) throw new HttpError(e.status, e.message);
      throw e;
    }
    res.json(await view(req, module));
  }));

  return r;
};
