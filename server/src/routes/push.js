/**
 * Notifications push (dashboard › Ventes › Notifications push) : téléphones où l'application SIIPAF est installée avec
 * « Recevoir des notifications push » activé (connectés ou non), répartis par ville préférée ; envoi d'une annonce à tous
 * ou à une ville, avec le programme ouvert au toucher ; historique des envois.
 * Les notifications du dossier client (messages, paiements, chantier…) partent seules depuis l'ERP (services/push.js).
 */
const express = require('express');
const { ah, parse, HttpError } = require('../lib/http');
const { requirePermission } = require('../auth');
const push = require('../services/push');

module.exports = function pushRoutes(db) {
  const r = express.Router();
  const read = requirePermission('push:read');
  const send = requirePermission('push:send');

  r.get('/push', read, ah(async (req, res) => {
    const [total, byCity, cities, projects, rows] = await Promise.all([
      db('app_devices').count({ n: '*' }).first(),
      db('app_devices').whereNotNull('city_id').groupBy('city_id').select('city_id').count({ n: '*' }),
      db('ref_items').where({ kind: 'ville' }).orderBy(['sort', 'label']).select('id', 'label'),
      db('projects').where({ published: true }).whereNull('archived_at').orderBy('name').select('id', 'name', 'city_id'),
      db('app_announcements as a').leftJoin('projects as p', 'p.id', 'a.project_id').leftJoin('ref_items as v', 'v.id', 'a.city_id').leftJoin('users as u', 'u.id', 'a.created_by')
        .orderBy('a.id', 'desc').limit(50).select('a.*', 'p.name as project_name', 'v.label as city_label', 'u.name as author'),
    ]);
    const counts = new Map(byCity.map(r => [r.city_id, Number(r.n)]));
    res.json({
      devices: Number(total?.n || 0),
      cities: cities.map(c => ({ ...c, devices: counts.get(c.id) || 0 })),
      projects, rows,
    });
  }));
  r.post('/push', send, ah(async (req, res) => {
    const data = parse(push.announceSchema, req.body);
    const { id, recipients } = await push.announce(db, data, req.user.id);
    if (!recipients) throw new HttpError(409, data.city_id ? 'Aucun téléphone inscrit pour cette ville : rien n’a été envoyé.' : 'Aucun téléphone inscrit aux notifications : rien n’a été envoyé.');
    res.status(201).json({ id, recipients });
  }));

  return r;
};
