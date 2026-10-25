/**
 * ERP · Centre de notifications : la cloche de la barre du haut (chaque compte ne voit que les siennes), son choisi
 * par le compte, et circuit d'information entre les services (réglé par la Direction ou l'administrateur).
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, HttpError } = require('../../lib/http');
const { INFO_EVENTS, INFO_AUDIENCES, NOTIF_SOUNDS } = require('../../lib/domain');
const notifications = require('../../services/notifications');

module.exports = function notificationRoutes(db) {
  const r = express.Router();
  const module = z.enum(Object.keys(notifications.NOTIF_MODULES));

  r.get('/', ah(async (req, res) => {
    const q = parse(z.object({ module: module.optional(), unread: z.enum(['0', '1']).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }), req.query);
    const [out, me] = await Promise.all([
      notifications.list(db, req.user.id, { module: q.module, unread: q.unread === '1', limit: q.limit }),
      db('users').where({ id: req.user.id }).first('notif_sound', 'notif_prefs'),
    ]);
    res.json({ ...out, sound: me?.notif_sound || 'carillon', sounds: NOTIF_SOUNDS, prefs: notifications.prefsOf(me), modules: notifications.NOTIF_MODULES });
  }));

  r.post('/read', ah(async (req, res) => {
    const data = parse(z.object({ ids: z.array(z.number().int().positive()).max(200).optional(), module: module.optional() }), req.body || {});
    const n = await notifications.markRead(db, req.user.id, data);
    res.json({ ok: true, updated: n });
  }));

  // Son de notification du compte (cloche du dashboard et de l'ERP)
  r.put('/son', ah(async (req, res) => {
    const { sound } = parse(z.object({ sound: z.enum(Object.keys(NOTIF_SOUNDS)) }), req.body);
    await db('users').where({ id: req.user.id }).update({ notif_sound: sound, updated_at: new Date() });
    res.json({ sound });
  }));

  // Notifications d'un module : activées ou coupées, son propre (Réglages du module › Mes notifications)
  r.put('/preferences', ah(async (req, res) => {
    const data = parse(z.object({ module, enabled: z.boolean(), sound: z.enum(Object.keys(NOTIF_SOUNDS)).nullable().optional() }), req.body);
    res.json({ prefs: await notifications.savePrefs(db, req.user.id, data.module, data) });
  }));

  // ─── Circuit d'information : quels services sont prévenus de chaque événement ──
  const canRoute = req => req.can('users:write') || req.can('demandes:dg');
  r.get('/circuit', ah(async (req, res) => {
    if (!canRoute(req) && !req.can('direction:read')) throw new HttpError(403, 'Accès réservé à la Direction et à l’administrateur.');
    const routes = await notifications.infoRoutes(db);
    res.json({
      can_edit: canRoute(req), modules: notifications.NOTIF_MODULES,
      audiences: Object.fromEntries(Object.entries(INFO_AUDIENCES).map(([k, a]) => [k, { label: a.label, hint: a.hint }])),
      events: Object.entries(INFO_EVENTS).map(([key, e]) => ({ key, module: e.module, label: e.label, hint: e.recipient_hint || null, defaults: e.audiences, audiences: routes[key] })),
    });
  }));
  r.put('/circuit', ah(async (req, res) => {
    if (!canRoute(req)) throw new HttpError(403, 'Seuls la Direction générale et l’administrateur règlent le circuit d’information.');
    const data = parse(z.record(z.string(), z.array(z.enum(Object.keys(INFO_AUDIENCES)))), req.body);
    await notifications.saveInfoRoutes(db, data);
    const routes = await notifications.infoRoutes(db);
    res.json(Object.entries(INFO_EVENTS).map(([key, e]) => ({ key, module: e.module, label: e.label, defaults: e.audiences, audiences: routes[key] })));
  }));

  return r;
};
