/** ERP · Administration générale : vue Direction (synthèse de tous les services). */
const express = require('express');
const { ah } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { overview } = require('../../services/direction');

module.exports = function directionRoutes(db) {
  const r = express.Router();
  r.get('/overview', requirePermission('direction:read'), ah(async (req, res) => res.json(await overview(db))));
  return r;
};
