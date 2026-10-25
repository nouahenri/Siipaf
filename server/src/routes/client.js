/**
 * API de l'espace client (/api/client) : connexion par code client ou téléphone, dossiers, échéancier,
 * documents, chantier et messagerie. Chaque requête est cloisonnée sur l'acquéreur connecté.
 */
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, isoTime } = require('../lib/http');
const { checkPassword, hashPassword } = require('../auth');
const { issueClientSession, clearClientSession, requireClient } = require('../auth/client');
const { isTest, uploadsDir } = require('../config');
const { notifyTeam } = require('../lib/mailer');
const { CLIENT_PASSWORD_MIN } = require('../lib/domain');
const {
  findAccountByLogin, requestReset, resetPassword, clientSales, clientSaleDetail, clientDocumentFile,
  ownSale, saleContext, siteUpdatesQuery, serializeUpdate, progressIndex,
} = require('../services/clients');

// Ancien nom du champ d'identifiant : « code »
const withLogin = body => ({ ...(body || {}), login: body?.login ?? body?.code });

const newPassword = z.string().min(CLIENT_PASSWORD_MIN, `Le mot de passe doit faire au moins ${CLIENT_PASSWORD_MIN} caractères.`).max(200);

module.exports = function clientRoutes(db) {
  const r = express.Router();
  const limiter = (limit, minutes = 15) => rateLimit({
    windowMs: minutes * 60 * 1000, limit: isTest ? 1000 : limit, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' },
  });
  const authed = requireClient(db);
  const pending = requireClient(db, { allowPending: true });

  async function profile(account) {
    const lead = await db('leads as l').leftJoin('projects as p', 'p.id', 'l.project_id').where('l.id', account.lead_id).select('l.*', 'p.name as project_name').first();
    const [[{ n }], sales, progress] = await Promise.all([
      db('client_messages').where({ lead_id: lead.id, sender: 'equipe' }).whereNull('read_at').count({ n: '*' }),
      db('sales as s').join('lots as l', 'l.id', 's.lot_id').where('s.lead_id', lead.id).select('s.status', 's.lot_id', 'l.project_id', 'l.ilot'),
      progressIndex(db),
    ]);
    return {
      client_code: lead.client_code, name: lead.name, email: lead.email, phone: lead.phone, country: lead.country,
      // Bien souscrit tant que le dossier d'acquisition n'est pas ouvert (clients repris de l'ancienne plateforme)
      property_type: lead.property_type || null, project_name: lead.project_name || null,
      progress: progress.client(sales, lead.project_id), // avancement global du chantier
      must_change_password: !!account.must_change_password, unread_messages: Number(n),
    };
  }

  // ─── Connexion ────────────────────────────────────────────
  r.post('/login', limiter(10), ah(async (req, res) => {
    // « login » : code client ou numéro de téléphone (« code » accepté pour les anciennes versions de l'écran)
    const { login, password } = parse(z.object({
      login: z.string().trim().min(4, 'Code client ou numéro de téléphone requis').max(40),
      password: z.string().min(1, 'Mot de passe requis').max(200),
    }), withLogin(req.body));
    const account = await findAccountByLogin(db, login);
    // Même message dans tous les cas pour ne pas révéler les comptes existants
    if (!account || !account.active || !(await checkPassword(password, account.password_hash))) {
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect.');
    }
    await db('client_accounts').where({ id: account.id }).update({ last_login_at: new Date() });
    issueClientSession(res, account);
    res.json({ client: await profile(account) });
  }));

  r.post('/logout', (req, res) => {
    clearClientSession(res);
    res.json({ ok: true });
  });

  r.get('/me', pending, ah(async (req, res) => res.json({ client: await profile(req.client) })));

  r.post('/password', pending, ah(async (req, res) => {
    const { current, next } = parse(z.object({ current: z.string().min(1), next: newPassword }), req.body);
    if (!(await checkPassword(current, req.client.password_hash))) throw new HttpError(400, 'Mot de passe actuel incorrect.');
    if (current === next) throw new HttpError(400, 'Choisissez un mot de passe différent du mot de passe provisoire.');
    await db('client_accounts').where({ id: req.client.id }).update({
      password_hash: await hashPassword(next), must_change_password: false, updated_at: new Date(),
    });
    res.json({ client: await profile({ ...req.client, must_change_password: false }) });
  }));

  r.post('/password/forgot', limiter(5), ah(async (req, res) => {
    const { login } = parse(z.object({ login: z.string().trim().min(4).max(40) }), withLogin(req.body));
    await requestReset(db, login);
    res.json({ ok: true, message: 'Si cet identifiant correspond à un accès avec une adresse e-mail, un lien de réinitialisation vient d’être envoyé.' });
  }));

  r.post('/password/reset', limiter(10), ah(async (req, res) => {
    const { token, password } = parse(z.object({ token: z.string().min(32).max(128), password: newPassword }), req.body);
    const account = await resetPassword(db, token, password);
    issueClientSession(res, account);
    res.json({ client: await profile({ ...account, must_change_password: false }) });
  }));

  // ─── Dossiers ─────────────────────────────────────────────
  r.get('/dossiers', authed, ah(async (req, res) => res.json(await clientSales(db, req.client.lead_id))));

  r.get('/dossiers/:id', authed, ah(async (req, res) => res.json(await clientSaleDetail(db, req.client.lead_id, idParam(req)))));

  r.get('/dossiers/:id/chantier', authed, ah(async (req, res) => {
    const sale = await ownSale(db, req.client.lead_id, idParam(req));
    const { lot, property } = await saleContext(db, sale);
    const updates = await siteUpdatesQuery(db, lot).limit(100);
    res.json({ property, updates: await Promise.all(updates.map(u => serializeUpdate(db, u))) });
  }));

  // ─── Travaux modificatifs (TMA) et livraison du lot ──────
  r.post('/dossiers/:id/tma', authed, limiter(10), ah(async (req, res) => {
    const sale = await ownSale(db, req.client.lead_id, idParam(req));
    const data = parse(z.object({ title: z.string().trim().min(3, 'Décrivez les travaux en quelques mots.').max(200), description: z.string().trim().max(4000).optional() }), req.body);
    await require('../services/chantiersLivraison').createChange(db, { sale_id: sale.id, ...data }, { source: 'client' });
    res.status(201).json(await clientSaleDetail(db, req.client.lead_id, sale.id));
  }));
  r.post('/tma/:id/reponse', authed, limiter(20), ah(async (req, res) => {
    const data = parse(z.object({ accept: z.boolean(), note: z.string().trim().max(500).optional() }), req.body);
    const t = await require('../services/chantiersLivraison').answerChange(db, { leadId: req.client.lead_id, id: idParam(req), accept: data.accept, note: data.note || null });
    res.json(await clientSaleDetail(db, req.client.lead_id, t.sale_id));
  }));
  r.get('/livraison/:id/pv', authed, ah(async (req, res) => {
    const sale = await ownSale(db, req.client.lead_id, idParam(req));
    const h = await db('lot_handovers').where({ sale_id: sale.id }).first();
    if (!h?.file_filename) throw new HttpError(404, 'Procès-verbal indisponible.');
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(h.file_name || 'pv-reception')}`);
    res.sendFile(require('../services/chantiersSuivi').filePath(h), err => err && !res.headersSent && res.sendStatus(404));
  }));

  r.get('/documents/:id/fichier', authed, ah(async (req, res) => {
    const doc = await clientDocumentFile(db, req.client.lead_id, idParam(req));
    const ext = path.extname(doc.original_name || doc.filename);
    res.set('Cache-Control', 'private, no-store');
    if (req.query.preview === '1') {
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(doc.mime)) {
        throw new HttpError(415, 'Ce format ne permet pas d’aperçu. Téléchargez le document pour le consulter.');
      }
      res.attachment(`${doc.label}${ext}`);
      res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
      res.type(doc.mime);
      return res.sendFile(path.join(uploadsDir, path.basename(doc.filename)), err => {
        if (err && !res.headersSent) res.status(404).json({ error: 'Fichier indisponible.' });
      });
    }
    res.download(path.join(uploadsDir, path.basename(doc.filename)), `${doc.label}${ext}`, err => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Fichier indisponible.' });
    });
  }));

  // ─── Messagerie ───────────────────────────────────────────
  r.get('/messages', authed, ah(async (req, res) => {
    const leadId = req.client.lead_id;
    const rows = await db('client_messages as m').leftJoin('users as u', 'u.id', 'm.user_id')
      .where('m.lead_id', leadId).select('m.*', 'u.name as author').orderBy([{ column: 'm.created_at', order: 'asc' }, { column: 'm.id', order: 'asc' }]).limit(500);
    await db('client_messages').where({ lead_id: leadId, sender: 'equipe' }).whereNull('read_at').update({ read_at: new Date() });
    res.json(rows.map(m => ({
      id: m.id, sender: m.sender, body: m.body, sale_id: m.sale_id, created_at: isoTime(m.created_at),
      author: m.sender === 'equipe' ? (m.author ? m.author.split(' ')[0] : 'Équipe SIIPAF') : null,
      read: m.sender === 'client' ? !!m.read_at : true,
    })));
  }));

  r.post('/messages', authed, limiter(30), ah(async (req, res) => {
    const data = parse(z.object({
      body: z.string().trim().min(1, 'Message vide.').max(4000),
      sale_id: z.number().int().positive().optional(),
    }), req.body);
    if (data.sale_id) await ownSale(db, req.client.lead_id, data.sale_id);
    const [id] = await db('client_messages').insert({ lead_id: req.client.lead_id, sale_id: data.sale_id || null, sender: 'client', body: data.body });
    const lead = await db('leads').where({ id: req.client.lead_id }).first();
    notifyTeam(`Message client ${lead.client_code}`, `${lead.name} (${lead.client_code}) a écrit depuis l’espace client :\n\n${data.body}`).catch(() => {});
    const m = await db('client_messages').where({ id }).first();
    res.status(201).json({ id: m.id, sender: 'client', body: m.body, sale_id: m.sale_id, created_at: isoTime(m.created_at), author: null, read: false });
  }));

  return r;
};
