/**
 * « Sita », conseillère IA du site public.
 * - Public (site) : GET /api/public/sita/config (identité, textes, pages, sans aucun secret), POST /api/public/sita/message
 *   (limite de débit par visiteur et par adresse, champ piège anti-robots, message borné).
 * - Dashboard › Contenu du site › Assistante du site : GET/PUT /api/admin/assistant (droit site:assistant).
 * - ERP › Service commercial › Conversations de Sita : /api/admin/erp/commercial/sita (droit commercial:read, cloisonné comme les prospects).
 */
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam } = require('../lib/http');
const { requirePermission } = require('../auth');
const { jwtSecret } = require('../config');
const sita = require('../services/sita');

const messageSchema = z.object({
  visitor_id: z.string().trim().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Identifiant de visiteur invalide.'),
  message: z.string().max(4000), // tronqué et nettoyé par le service (600 caractères)
  page: z.object({ path: z.string().max(160).optional(), slug: z.string().max(80).optional() }).optional(),
  utm: z.object({ source: z.string().max(40).optional(), medium: z.string().max(40).optional(), campaign: z.string().max(60).optional(), content: z.string().max(80).optional() }).optional(),
  lang: z.enum(['fr', 'en']).optional(),
  website: z.string().max(0, 'Spam').optional(), // champ piège anti-robots : doit rester vide
}).strict();

const ipHash = ip => crypto.createHash('sha256').update(`${jwtSecret}|${ip || ''}`).digest('hex').slice(0, 16);

function publicSita(db) {
  const r = express.Router();
  r.get('/sita/config', ah(async (req, res) => {
    const c = await sita.publicConfig(db);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(c.enabled ? c : { enabled: false });
  }));
  r.post('/sita/message', ah(async (req, res) => {
    const d = parse(messageSchema, req.body);
    const ip = req.ip;
    await sita.throttle(db, { visitorKey: d.visitor_id, ip });
    const out = await sita.handleMessage(db, { visitorKey: d.visitor_id, message: d.message, page: d.page, utm: d.utm, lang: d.lang, ipHash: ipHash(ip) });
    res.set('Cache-Control', 'no-store');
    const { conversation_id: _internal, ...visible } = out; // l'identifiant interne de la conversation ne sort pas vers le site
    res.json(visible);
  }));
  return r;
}

const settingsPatch = require('../lib/sita').settingsSchema.partial();

function adminSita(db) {
  const r = express.Router();
  const S = requirePermission('site:assistant');
  r.get('/assistant', S, ah(async (req, res) => res.json(await sita.adminView(db))));
  r.put('/assistant', S, ah(async (req, res) => {
    const patch = parse(settingsPatch, req.body);
    await sita.saveSettings(db, patch);
    res.json(await sita.adminView(db));
  }));
  return r;
}

function erpSita(db) {
  const r = express.Router();
  r.use(requirePermission('commercial:read'));
  r.get('/', ah(async (req, res) => res.json(await sita.listConversations(db, req.user, { filter: String(req.query.filtre || 'toutes'), q: String(req.query.q || '') }))));
  r.get('/stats', ah(async (req, res) => res.json(await sita.stats(db, req.user))));
  r.get('/:id', ah(async (req, res) => res.json(await sita.conversationDetail(db, idParam(req), req.user))));
  return r;
}

module.exports = { publicSita, adminSita, erpSita };
