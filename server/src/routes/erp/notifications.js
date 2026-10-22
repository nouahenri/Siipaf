/** ERP · Centre de notifications : la cloche de la barre du haut (chaque compte ne voit que les siennes). */
const express = require('express');
const { z } = require('zod');
const { ah, parse } = require('../../lib/http');
const notifications = require('../../services/notifications');

module.exports = function notificationRoutes(db) {
  const r = express.Router();
  const module = z.enum(Object.keys(notifications.NOTIF_MODULES));

  r.get('/', ah(async (req, res) => {
    const q = parse(z.object({ module: module.optional(), unread: z.enum(['0', '1']).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }), req.query);
    res.json(await notifications.list(db, req.user.id, { module: q.module, unread: q.unread === '1', limit: q.limit }));
  }));

  r.post('/read', ah(async (req, res) => {
    const data = parse(z.object({ ids: z.array(z.number().int().positive()).max(200).optional(), module: module.optional() }), req.body || {});
    const n = await notifications.markRead(db, req.user.id, data);
    res.json({ ok: true, updated: n });
  }));

  return r;
};
