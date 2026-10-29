/** ERP · Administration générale : vue Direction (synthèse de tous les services) et compteurs du menu. */
const express = require('express');
const { ah, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { overview } = require('../../services/direction');
const { departmentReport } = require('../../services/performance');
const { parsePeriod } = require('../../lib/rh');
const courrier = require('../../services/courrier');
const contracts = require('../../services/contracts');
const parc = require('../../services/parc');
const docs = require('../../services/docs');
const requests = require('../../services/requests');

module.exports = function directionRoutes(db) {
  const r = express.Router();
  r.get('/overview', requirePermission('direction:read'), ah(async (req, res) => res.json(await overview(db))));
  // Performance par service sur une période choisie (année, trimestre ou mois) : mêmes calculs que RH › Performance
  r.get('/performance', requirePermission('direction:read'), ah(async (req, res) => {
    const P = parsePeriod(req.query);
    if (!P) throw new HttpError(400, 'Période invalide (année, trimestre 1 à 4 ou mois 1 à 12).');
    const rep = await departmentReport(db, P);
    res.json({ period: rep.period, overall: rep.overall.score, departments: rep.departments.map(d => ({ key: d.key, label: d.label, headcount: d.headcount, score: d.score, prev_score: d.prev_score, collective_score: d.collective_score, employees_score: d.employees_score, presence: d.presence, late: d.late })) });
  }));
  // Pastilles du menu et accès du destinataire d'un courrier ou du responsable d'un contrat (sans droit particulier)
  r.get('/badges', ah(async (req, res) => {
    const can = p => req.can(p);
    const [mail, ctr, assets, req2, scope] = await Promise.all([
      courrier.badges(db, await courrier.viewer(db, req.user, can)), contracts.badges(db, { userId: req.user.id, can }), parc.badges(db, { userId: req.user.id, can }),
      requests.badges(db, { userId: req.user.id, can, superAdmin: req.user.role === 'super_admin' }), docs.scopeOf(db, req.user, can),
    ]);
    // Bons de commande soumis par les Achats qui attendent la décision de ce compte (Demandes internes › Commandes à valider)
    const orders = (await require('../../services/appro').ordersToValidate(db, { userId: req.user.id, can, superAdmin: req.user.role === 'super_admin' })).length;
    res.json({
      ...mail, contracts_due: ctr.due, contracts_late: ctr.late, contracts_owned: ctr.owned,
      parc_count: assets.late + assets.requests, parc_due: assets.due, parc_late: assets.late, parc_requests: assets.requests,
      requests_count: req2.to_approve + req2.to_handle + orders, requests_to_approve: req2.to_approve + orders, requests_to_handle: req2.to_handle, orders_to_validate: orders,
      docs_can_publish: docs.canPublish(scope),
    });
  }));
  return r;
};
