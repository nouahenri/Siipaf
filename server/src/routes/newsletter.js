/** Newsletter (dashboard) : campagnes, aperçu, e-mail de test, lancement et suivi de l'envoi, débit d'envoi. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../lib/http');
const { requirePermission } = require('../auth');
const { CAMPAIGN_STATUSES } = require('../lib/newsletter');
const nl = require('../services/newsletter');

const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const fields = {
  subject: z.string().trim().min(3, 'Objet : 3 caractères minimum.').max(160), preheader: optText(200), heading: optText(200),
  body: z.string().max(20000).optional().nullable(), image_media_id: z.number().int().positive().optional().nullable(),
  cta_label: optText(60), cta_url: z.string().trim().max(500).optional().nullable().transform(v => v || null)
    .refine(v => !v || /^https?:\/\//i.test(v), 'Le lien du bouton doit commencer par https://'),
};

module.exports = function newsletterRoutes(db) {
  const r = express.Router();
  const read = requirePermission('newsletter:read');
  const write = requirePermission('newsletter:write');
  const send = requirePermission('newsletter:send');

  r.get('/newsletter/campaigns', read, ah(async (req, res) => {
    const rows = await db('newsletter_campaigns').orderBy('id', 'desc').limit(200);
    res.json({ statuses: CAMPAIGN_STATUSES, rows: rows.map(nl.serialize) });
  }));
  r.post('/newsletter/campaigns', write, ah(async (req, res) => {
    const data = parse(z.object(fields), req.body);
    const [id] = await db('newsletter_campaigns').insert({ ...data, created_by: req.user.id });
    res.status(201).json(await nl.detail(db, nl.insertedId(id)));
  }));
  r.get('/newsletter/campaigns/:id', read, ah(async (req, res) => res.json(await nl.detail(db, idParam(req)))));
  r.patch('/newsletter/campaigns/:id', write, ah(async (req, res) => {
    const c = await db('newsletter_campaigns').where({ id: idParam(req) }).first();
    if (!c) throw new HttpError(404, 'Campagne introuvable.');
    if (c.status !== 'brouillon') throw new HttpError(409, 'Campagne lancée : elle ne se modifie plus (dupliquez-la).');
    await db('newsletter_campaigns').where({ id: c.id }).update({ ...parse(z.object(fields).partial(), req.body), updated_at: new Date() });
    res.json(await nl.detail(db, c.id));
  }));
  r.delete('/newsletter/campaigns/:id', write, ah(async (req, res) => {
    const c = await db('newsletter_campaigns').where({ id: idParam(req) }).first();
    if (!c) throw new HttpError(404, 'Campagne introuvable.');
    if (!['brouillon', 'annulee'].includes(c.status)) throw new HttpError(409, 'Seul un brouillon ou une campagne annulée se supprime.');
    await db('newsletter_campaigns').where({ id: c.id }).del();
    res.json({ ok: true });
  }));
  r.post('/newsletter/campaigns/:id/duplicate', write, ah(async (req, res) => {
    const c = await db('newsletter_campaigns').where({ id: idParam(req) }).first();
    if (!c) throw new HttpError(404, 'Campagne introuvable.');
    const { subject, preheader, heading, body, image_media_id, cta_label, cta_url } = c;
    const [id] = await db('newsletter_campaigns').insert({ subject: `${subject} (copie)`.slice(0, 160), preheader, heading, body, image_media_id, cta_label, cta_url, created_by: req.user.id });
    res.status(201).json(await nl.detail(db, nl.insertedId(id)));
  }));

  // Aperçu : HTML de l'e-mail tel que reçu (affiché dans un cadre du dashboard). Aucun script ; images du logo et
  // de la médiathèque servies par l'adresse de l'espace client (autre sous-domaine) ; liens ouverts dans un onglet.
  r.get('/newsletter/campaigns/:id/preview', read, ah(async (req, res) => {
    const c = await nl.getCampaign(db, idParam(req));
    res.set('Cache-Control', 'no-store')
      .set('Content-Security-Policy', "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; frame-ancestors 'self'")
      .type('html').send(nl.render(c).html.replace('<head>', '<head><base target="_blank">'));
  }));
  r.post('/newsletter/campaigns/:id/test', write, ah(async (req, res) => {
    const { to } = parse(z.object({ to: z.string().trim().toLowerCase().email('E-mail invalide') }), req.body);
    res.json(await nl.sendTest(db, idParam(req), to));
  }));
  r.post('/newsletter/campaigns/:id/launch', send, ah(async (req, res) => {
    const total = await nl.launch(db, idParam(req), req.user.id);
    nl.tick(db).catch(() => {}); // premier lot tout de suite
    res.json({ total, campaign: await nl.detail(db, idParam(req)) });
  }));
  r.post('/newsletter/campaigns/:id/:action(pause|resume|cancel)', send, ah(async (req, res) => {
    await nl.setStatus(db, idParam(req), req.params.action);
    if (req.params.action === 'resume') nl.tick(db).catch(() => {});
    res.json(await nl.detail(db, idParam(req)));
  }));

  r.get('/newsletter/settings', read, ah(async (req, res) => res.json(await nl.getSettings(db))));
  r.put('/newsletter/settings', send, ah(async (req, res) => {
    const data = parse(z.object({
      per_minute: z.number().int().min(1).max(100), per_hour: z.number().int().min(1).max(5000),
      sender_name: z.string().trim().min(2).max(80), reply_to: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)),
    }).partial(), req.body);
    res.json(await nl.saveSettings(db, data));
  }));

  return r;
};
