/** ERP · Administration générale : vue Direction (synthèse de tous les services) et compteurs du menu. */
const express = require('express');
const { ah } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { overview } = require('../../services/direction');
const courrier = require('../../services/courrier');
const contracts = require('../../services/contracts');
const parc = require('../../services/parc');
const docs = require('../../services/docs');
const requests = require('../../services/requests');

module.exports = function directionRoutes(db) {
  const r = express.Router();
  r.get('/overview', requirePermission('direction:read'), ah(async (req, res) => res.json(await overview(db))));
  // Pastilles du menu et accès du destinataire d'un courrier ou du responsable d'un contrat (sans droit particulier)
  r.get('/badges', ah(async (req, res) => {
    const can = p => req.can(p);
    const [mail, ctr, assets, req2, scope] = await Promise.all([
      courrier.badges(db, await courrier.viewer(db, req.user, can)), contracts.badges(db, { userId: req.user.id, can }), parc.badges(db, { userId: req.user.id, can }),
      requests.badges(db, { userId: req.user.id, can, superAdmin: req.user.role === 'super_admin' }), docs.scopeOf(db, req.user, can),
    ]);
    res.json({
      ...mail, contracts_due: ctr.due, contracts_late: ctr.late, contracts_owned: ctr.owned,
      parc_count: assets.late + assets.requests, parc_due: assets.due, parc_late: assets.late, parc_requests: assets.requests,
      requests_count: req2.to_approve + req2.to_handle, requests_to_approve: req2.to_approve, requests_to_handle: req2.to_handle,
      docs_can_publish: docs.canPublish(scope),
    });
  }));
  return r;
};
