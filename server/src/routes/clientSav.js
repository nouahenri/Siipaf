/**
 * Espace client · « Mes demandes » (/api/client/sav) : l'acquéreur signale un problème sur son bien,
 * suit son traitement, échange avec l'équipe et donne son avis. Cloisonné sur l'acquéreur connecté.
 */
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../lib/http');
const { requireClient } = require('../auth/client');
const { isTest } = require('../config');
const { notifyTeam } = require('../lib/mailer');
const { SAV_CATEGORIES, SAV_STATUS_LABELS, SAV_OPEN_STATUSES, WARRANTIES } = require('../lib/domain');
const { ownSale } = require('../services/clients');
const sav = require('../services/sav');
const { notify, usersWith, inform } = require('../services/notifications');

const ids = z.array(z.number().int().positive()).max(6).optional();

module.exports = function clientSavRoutes(db) {
  const r = express.Router();
  const authed = requireClient(db);
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: isTest ? 1000 : 30, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Trop de demandes, réessayez dans quelques minutes.' },
  });

  async function ownTicket(req) {
    const t = await db('sav_tickets').where({ id: idParam(req), lead_id: req.client.lead_id }).first();
    if (!t) throw new HttpError(404, 'Demande introuvable.');
    return t;
  }

  r.get('/meta', authed, (req, res) => res.json({
    categories: SAV_CATEGORIES, status_labels: SAV_STATUS_LABELS, open_statuses: SAV_OPEN_STATUSES,
    warranties: Object.fromEntries(Object.entries(WARRANTIES).map(([k, w]) => [k, w.label])),
  }));

  r.get('/', authed, ah(async (req, res) => {
    const rows = await db('sav_tickets as t').leftJoin('lots as l', 'l.id', 't.lot_id').leftJoin('projects as p', 'p.id', 't.project_id')
      .where('t.lead_id', req.client.lead_id)
      .select('t.id', 't.ref', 't.title', 't.category', 't.status', 't.warranty', 't.sale_id', 't.created_at', 't.updated_at',
        't.resolved_at', 't.satisfaction', 'l.code as lot_code', 'p.name as project_name')
      .orderBy('t.id', 'desc').limit(200);
    res.json(rows);
  }));

  r.post('/', authed, limiter, ah(async (req, res) => {
    const data = parse(z.object({
      sale_id: z.number().int().positive({ message: 'Choisissez le bien concerné.' }),
      category: z.enum(Object.keys(SAV_CATEGORIES), { errorMap: () => ({ message: 'Choisissez le type de problème.' }) }),
      title: z.string().trim().min(3, 'Résumez le problème en quelques mots.').max(160),
      description: z.string().trim().max(5000).optional(),
      location: z.string().trim().max(120).optional(),
      media_ids: ids,
    }), req.body);
    await ownSale(db, req.client.lead_id, data.sale_id);
    data.media_ids = await sav.checkFiles(db, data.media_ids, { leadId: req.client.lead_id });
    // Le client ne choisit ni la priorité ni le responsable : l'équipe qualifie la demande
    const t = await sav.createTicket(db, { ...data, priority: 'normale' }, { source: 'client' });
    const lead = await db('leads').where({ id: req.client.lead_id }).first();
    notifyTeam(`Réclamation ${t.ref} — ${lead.client_code}`, `${lead.name} (${lead.client_code}) a signalé un problème depuis l’espace client :\n\n${t.title}\n${t.description || ''}`).catch(() => {});
    // Les comptes qui attribuent les réclamations et les services du circuit (SAV, exploitation)
    await inform(db, 'reclamation.ouverte', {
      direct: await usersWith(db, 'sav:assign'), title: `Nouvelle réclamation ${t.ref} — ${lead.name}`,
      body: t.title, link: `/sav/reclamations?t=${t.id}`, priority: 'action', key: `sav:${t.id}:ouverte`,
    });
    res.status(201).json(await sav.ticketDetail(db, t.id, { forClient: true }));
  }));

  r.get('/:id(\\d+)', authed, ah(async (req, res) => {
    const t = await ownTicket(req);
    res.json(await sav.ticketDetail(db, t.id, { forClient: true }));
  }));

  r.post('/:id(\\d+)/comments', authed, limiter, ah(async (req, res) => {
    const t = await ownTicket(req);
    const data = parse(z.object({ body: z.string().trim().min(1, 'Message vide.').max(4000), media_ids: ids }), req.body);
    if (t.status === 'clos' || t.status === 'rejete') throw new HttpError(409, 'Cette demande est close : ouvrez-en une nouvelle si le problème persiste.');
    const media = await sav.checkFiles(db, data.media_ids, { leadId: req.client.lead_id });
    await sav.addComment(db, t.id, { author: 'client', body: data.body, media });
    notifyTeam(`Réclamation ${t.ref} : réponse du client`, data.body).catch(() => {});
    await notify(db, {
      to: t.assigned_to || await usersWith(db, 'sav:assign'), module: 'sav', event: 'reclamation.reponse_client',
      title: `Réclamation ${t.ref} : réponse du client`, body: data.body, link: `/sav/reclamations?t=${t.id}`, priority: 'action',
    });
    res.status(201).json(await sav.ticketDetail(db, t.id, { forClient: true }));
  }));

  r.post('/:id(\\d+)/rating', authed, ah(async (req, res) => {
    const t = await ownTicket(req);
    const data = parse(z.object({
      satisfaction: z.number().int().min(1, 'Note de 1 à 5.').max(5, 'Note de 1 à 5.'),
      comment: z.string().trim().max(500).optional(),
    }), req.body);
    if (t.satisfaction) throw new HttpError(409, 'Vous avez déjà donné votre avis sur cette demande.');
    await sav.rate(db, t.id, { satisfaction: data.satisfaction, comment: data.comment || null });
    res.json(await sav.ticketDetail(db, t.id, { forClient: true }));
  }));

  // ─── Photos ───────────────────────────────────────────────
  r.post('/files', authed, limiter, sav.photoUpload(), ah(async (req, res) => {
    const created = await sav.saveFiles(db, req.files, { leadId: req.client.lead_id });
    res.status(201).json(Object.values(await sav.filesById(db, created, 'client')));
  }));

  r.get('/files/:id(\\d+)', authed, ah(async (req, res) => {
    const f = await db('sav_files').where({ id: idParam(req), lead_id: req.client.lead_id }).first();
    if (!f) throw new HttpError(404, 'Fichier introuvable.');
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.join(sav.savFilesDir, path.basename(f.filename)), err => err && !res.headersSent && res.sendStatus(404));
  }));

  return r;
};
