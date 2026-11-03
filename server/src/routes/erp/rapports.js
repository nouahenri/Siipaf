/** ERP · Rapports des tableaux de bord (Exporter, Imprimer) : un rapport par module, période au choix (services/rapports). */
const express = require('express');
const { ah } = require('../../lib/http');
const rapports = require('../../services/rapports');

module.exports = function rapportsRoutes(db) {
  const r = express.Router();
  r.get('/:module', ah(async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await rapports.report(db, req.params.module, req.query, { user: req.user, can: p => req.can(p) }));
  }));
  return r;
};
