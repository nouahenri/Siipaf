/**
 * Meta · routes PUBLIQUES (sans session) :
 * - GET  /api/public/meta/webhook : vérification de l'adresse par Meta (hub.mode, hub.verify_token, hub.challenge) ;
 * - POST /api/public/meta/webhook : événements (formulaires de publicité, messages Messenger / Instagram, commentaires), authentifiés par
 *   la signature X-Hub-Signature-256 (HMAC-SHA256 du corps brut avec le secret de l'application). Sans secret enregistré ou avec une
 *   signature fausse, rien n'est traité. Meta attend une réponse rapide : hors tests, l'accusé 200 part tout de suite et le traitement
 *   (réponse de l'IA comprise) se poursuit ensuite ; en test il est attendu pour être vérifiable.
 * - GET  /api/public/meta/config : identifiant du pixel pour le site (jamais un secret), vide tant que le pixel n'est pas réglé.
 */
const express = require('express');
const { ah } = require('../lib/http');
const { isTest } = require('../config');
const M = require('../lib/meta');
const cfg = require('../services/metaSettings');
const meta = require('../services/meta');
const graph = require('../services/metaGraph');

function publicMeta(db) {
  const r = express.Router();

  r.get('/meta/webhook', ah(async (req, res) => {
    const q = req.query || {};
    const mode = q['hub.mode'] ?? q.hub?.mode;
    const token = q['hub.verify_token'] ?? q.hub?.verify_token;
    const challenge = q['hub.challenge'] ?? q.hub?.challenge;
    const creds = await cfg.credentials(db);
    if (mode === 'subscribe' && creds.verify_token && M.sameSecret(token, creds.verify_token) && /^[\w-]{1,200}$/.test(String(challenge ?? ''))) {
      return res.status(200).type('text/plain').send(String(challenge));
    }
    return res.sendStatus(403);
  }));

  r.post('/meta/webhook', ah(async (req, res) => {
    const creds = await cfg.credentials(db);
    if (!creds.app_secret) return res.status(503).json({ error: 'Webhook non connecté : secret de l’application non renseigné.' });
    if (!M.verifySignature(req.rawBody, req.get('x-hub-signature-256'), creds.app_secret)) return res.sendStatus(401);
    const work = meta.processWebhook(db, req.body);
    if (isTest) return res.status(200).json(await work);
    res.status(200).send('EVENT_RECEIVED');
    work.catch(err => console.error('[meta]', graph.clean(err, creds)));
  }));

  r.get('/meta/config', ah(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await meta.publicPixel(db));
  }));

  return r;
}

module.exports = { publicMeta };
