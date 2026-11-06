/**
 * « Sita », conseillère IA du site public.
 * - Public (site) : GET /api/public/sita/config (identité, textes, pages, sans aucun secret), POST /api/public/sita/message
 *   (limite de débit par visiteur et par adresse, champ piège anti-robots, message borné).
 * * - Voix (06/11/2026) : GET /api/public/sita/voix/:id?v=<visiteur> (réponse de Sita de ce visiteur) et /sita/voix/accueil :
 *   audio WAV de Gemini, gardé sur le disque ; refus 409 → l'appareil lit avec sa propre voix.
 * - Dashboard › Contenu du site › Assistante du site : GET/PUT /api/admin/assistant (droit site:assistant), essai de voix
 *   POST /api/admin/assistant/voix-essai.
 * - ERP › Service commercial › Conversations de Sita : /api/admin/erp/commercial/sita (droit commercial:read, cloisonné comme les prospects).
 */
const crypto = require('crypto');
const express = require('express');
const { z } = require('../lib/zod');
const { ah, parse, idParam } = require('../lib/http');
const { requirePermission } = require('../auth');
const { jwtSecret } = require('../config');
const sita = require('../services/sita');
const sitaVoice = require('../services/sitaVoice');
const { fromMobileApp } = require('../auth/client');

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
    res.set('Cache-Control', 'private, max-age=60'); // navigateur seulement : jamais le cache partagé de l'hébergeur
    res.json(c.enabled ? c : { enabled: false });
  }));
  const visitorQ = z.object({ v: z.string().trim().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Identifiant de visiteur invalide.') });
  const sendWav = (res, file) => { res.set('Cache-Control', 'private, max-age=86400'); res.type('audio/wav'); res.sendFile(file); };
  r.get('/sita/voix/accueil', ah(async (req, res) => {
    const { v } = parse(visitorQ, req.query);
    await sita.throttle(db, { visitorKey: v, ip: req.ip });
    sendWav(res, await sitaVoice.forGreeting(db));
  }));
  r.get('/sita/voix/:id', ah(async (req, res) => {
    const { v } = parse(visitorQ, req.query);
    await sita.throttle(db, { visitorKey: v, ip: req.ip });
    sendWav(res, await sitaVoice.forMessage(db, { visitorKey: v, messageId: idParam(req) }));
  }));
  r.post('/sita/message', ah(async (req, res) => {
    const d = parse(messageSchema, req.body);
    const ip = req.ip;
    await sita.throttle(db, { visitorKey: d.visitor_id, ip });
    // Application mobile SIIPAF : canal « mobile » (prospects classés « Application mobile »)
    const out = await sita.handleMessage(db, { visitorKey: d.visitor_id, message: d.message, page: d.page, utm: d.utm, lang: d.lang, ipHash: ipHash(ip), ...(fromMobileApp(req) ? { channel: 'mobile' } : {}) });
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
  const sampleSchema = z.object({ gender: z.enum(['femme', 'homme']), voice: z.string().max(40), style: z.string().max(300).optional() }).strict();
  r.post('/assistant/voix-essai', S, ah(async (req, res) => {
    const file = await sitaVoice.sample(db, parse(sampleSchema, req.body));
    res.set('Cache-Control', 'no-store'); res.type('audio/wav'); res.sendFile(file);
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
