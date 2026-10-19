/**
 * Côté dashboard de l'espace client : accès des acquéreurs, journal de chantier
 * et messagerie avec les clients.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, json, isoTime } = require('../lib/http');
const { requirePermission } = require('../auth');
const { sendMail } = require('../lib/mailer');
const { clientAppUrl } = require('../config');
const { SITE_STAGES } = require('../lib/domain');
const { grantAccess, accessStatus, siteUpdatesQuery, serializeUpdate } = require('../services/clients');
const { totals } = require('../services/sales');
const { scheduleStatus } = require('../services/schedule');

module.exports = function clientAdminRoutes(db) {
  const r = express.Router();

  // ─── Clients (prospects devenus acquéreurs : ils ont un code client) ─────
  r.get('/clients', requirePermission('sales:read'), ah(async (req, res) => {
    const [leads, sales, accounts, unread] = await Promise.all([
      db('leads').whereNotNull('client_code').orderBy('client_code', 'desc'),
      db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id')
        .select('s.*', 'l.code as lot_code', 'l.ilot', 'p.name as project_name').orderBy('s.id'),
      db('client_accounts').select('lead_id', 'active', 'must_change_password', 'last_login_at'),
      db('client_messages').where({ sender: 'client' }).whereNull('read_at').select('lead_id').count({ n: '*' }).groupBy('lead_id'),
    ]);
    const salesByLead = {};
    for (const sale of sales) {
      const t = await totals(db, sale);
      const sch = sale.status === 'desiste' ? { overdue_fcfa: 0, overdue_count: 0, next_due: null } : await scheduleStatus(db, sale, t);
      (salesByLead[sale.lead_id] ||= []).push({
        id: sale.id, lot_id: sale.lot_id, lot_code: sale.lot_code, ilot: sale.ilot, project_name: sale.project_name,
        status: sale.status, financing: sale.financing, price_fcfa: Number(sale.price_fcfa), ...t,
        overdue_fcfa: sch.overdue_fcfa, overdue_count: sch.overdue_count, next_due: sch.next_due,
      });
    }
    const accessBy = Object.fromEntries(accounts.map(a => [a.lead_id, { active: !!a.active, must_change_password: !!a.must_change_password, last_login_at: isoTime(a.last_login_at) }]));
    const unreadBy = Object.fromEntries(unread.map(u => [u.lead_id, Number(u.n)]));
    res.json(leads.map(l => {
      const ds = salesByLead[l.id] || [];
      const live = ds.filter(d => d.status !== 'desiste');
      return {
        lead_id: l.id, name: l.name, client_code: l.client_code, phone: l.phone, email: l.email, country: l.country,
        is_diaspora: !!l.is_diaspora, stage: l.stage, sales: ds,
        price_fcfa: live.reduce((n, d) => n + d.price_fcfa, 0), paid_fcfa: live.reduce((n, d) => n + d.paid_fcfa, 0),
        overdue_fcfa: live.reduce((n, d) => n + d.overdue_fcfa, 0), overdue_count: live.reduce((n, d) => n + d.overdue_count, 0),
        status: !live.length ? 'desiste' : live.every(d => d.status === 'solde') ? 'solde' : 'en_cours',
        access: accessBy[l.id] || null, unread_messages: unreadBy[l.id] || 0,
      };
    }));
  }));

  // ─── Accès à l'espace client ──────────────────────────────
  r.get('/leads/:id/client-access', requirePermission('leads:read'), ah(async (req, res) => {
    res.json({ access: await accessStatus(db, idParam(req)) });
  }));

  // Ouvre l'accès ou génère un nouveau mot de passe provisoire (affiché une seule fois)
  r.post('/leads/:id/client-access', requirePermission('client_access:write'), ah(async (req, res) => {
    const { notify } = parse(z.object({ notify: z.boolean().default(true) }), req.body || {});
    const out = await grantAccess(db, { leadId: idParam(req), user: req.user, notify });
    res.status(201).json({ access: out.account, temporary_password: out.password, emailed: out.emailed });
  }));

  r.patch('/leads/:id/client-access', requirePermission('client_access:write'), ah(async (req, res) => {
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const n = await db('client_accounts').where({ lead_id: idParam(req) }).update({ active, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Ce client n’a pas encore d’accès.');
    res.json({ access: await accessStatus(db, idParam(req)) });
  }));

  // ─── Journal de chantier ──────────────────────────────────
  const updateFields = {
    ilot: z.string().trim().max(40).nullable(),
    lot_id: z.number().int().positive().nullable(),
    stage: z.enum(SITE_STAGES),
    progress_pct: z.number().int().min(0).max(100),
    title: z.string().trim().min(2).max(160),
    body: z.string().trim().max(5000).nullable(),
    media: z.array(z.number().int().positive()).max(30),
    visible_client: z.boolean(),
    published_at: z.coerce.date(),
  };

  async function checkScope(projectId, data) {
    if (data.lot_id) {
      const lot = await db('lots').where({ id: data.lot_id, project_id: projectId }).first();
      if (!lot) throw new HttpError(400, 'Ce lot n’appartient pas au projet.');
      data.ilot = null; // un point « lot » ne vise que ce lot
    }
    if (data.media && data.media.length) {
      const found = await db('media').whereIn('id', data.media).pluck('id');
      if (found.length !== new Set(data.media).size) throw new HttpError(400, 'Média introuvable dans la médiathèque.');
    }
  }

  const toRow = data => ({ ...data, ...(data.media ? { media: JSON.stringify(data.media) } : {}) });

  async function adminUpdate(u) {
    const base = await serializeUpdate(db, u);
    const lot = u.lot_id ? await db('lots').where({ id: u.lot_id }).select('code').first() : null;
    return { ...base, project_id: u.project_id, lot_id: u.lot_id, lot_code: lot ? lot.code : null, visible_client: !!u.visible_client, media_ids: json(u.media, []) };
  }

  r.get('/projects/:id/site-updates', requirePermission('projects:read'), ah(async (req, res) => {
    const rows = await db('site_updates').where({ project_id: idParam(req) })
      .orderBy([{ column: 'published_at', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(200);
    res.json(await Promise.all(rows.map(adminUpdate)));
  }));

  // Ce que voit l'acquéreur d'un lot (projet + îlot + lot), points masqués compris
  r.get('/lots/:id/site-updates', requirePermission('lots:read'), ah(async (req, res) => {
    const lot = await db('lots').where({ id: idParam(req) }).first();
    if (!lot) throw new HttpError(404, 'Lot introuvable.');
    const rows = await siteUpdatesQuery(db, lot, { onlyVisible: false }).limit(200);
    res.json(await Promise.all(rows.map(adminUpdate)));
  }));

  r.post('/projects/:id/site-updates', requirePermission('site_updates:write'), ah(async (req, res) => {
    const projectId = idParam(req);
    if (!(await db('projects').where({ id: projectId }).first())) throw new HttpError(404, 'Projet introuvable.');
    const data = parse(z.object(updateFields).partial({ ilot: true, lot_id: true, body: true, media: true, visible_client: true, published_at: true }), req.body);
    await checkScope(projectId, data);
    const [id] = await db('site_updates').insert({ ...toRow(data), project_id: projectId, created_by: req.user.id });
    res.status(201).json(await adminUpdate(await db('site_updates').where({ id }).first()));
  }));

  r.patch('/site-updates/:id', requirePermission('site_updates:write'), ah(async (req, res) => {
    const id = idParam(req);
    const u = await db('site_updates').where({ id }).first();
    if (!u) throw new HttpError(404, 'Point d’avancement introuvable.');
    const data = parse(z.object(updateFields).partial(), req.body);
    await checkScope(u.project_id, data);
    await db('site_updates').where({ id }).update({ ...toRow(data), updated_at: new Date() });
    res.json(await adminUpdate(await db('site_updates').where({ id }).first()));
  }));

  r.delete('/site-updates/:id', requirePermission('site_updates:write'), ah(async (req, res) => {
    const n = await db('site_updates').where({ id: idParam(req) }).del();
    if (!n) throw new HttpError(404, 'Point d’avancement introuvable.');
    res.json({ ok: true });
  }));

  // ─── Messagerie clients ───────────────────────────────────
  r.get('/client-messages', requirePermission('client_messages'), ah(async (req, res) => {
    const last = db('client_messages').select('lead_id').max({ last_id: 'id' }).count({ total: '*' })
      .sum({ unread: db.raw("case when sender = 'client' and read_at is null then 1 else 0 end") }).groupBy('lead_id').as('t');
    const rows = await db(last).join('client_messages as m', 'm.id', 't.last_id').join('leads as l', 'l.id', 't.lead_id')
      .select('t.lead_id', 't.total', 't.unread', 'l.name', 'l.client_code', 'm.body as last_body', 'm.sender as last_sender', 'm.created_at as last_at')
      .orderBy('t.last_id', 'desc');
    res.json(rows.map(t => ({
      lead_id: t.lead_id, name: t.name, client_code: t.client_code, total: Number(t.total), unread: Number(t.unread) || 0,
      last: { body: t.last_body.slice(0, 160), sender: t.last_sender, created_at: isoTime(t.last_at) },
    })));
  }));

  r.get('/leads/:id/messages', requirePermission('client_messages'), ah(async (req, res) => {
    const leadId = idParam(req);
    const rows = await db('client_messages as m').leftJoin('users as u', 'u.id', 'm.user_id').where('m.lead_id', leadId)
      .select('m.*', 'u.name as author').orderBy([{ column: 'm.created_at', order: 'asc' }, { column: 'm.id', order: 'asc' }]).limit(500);
    await db('client_messages').where({ lead_id: leadId, sender: 'client' }).whereNull('read_at').update({ read_at: new Date() });
    res.json(rows.map(m => ({
      id: m.id, sender: m.sender, body: m.body, sale_id: m.sale_id, author: m.author || null,
      created_at: isoTime(m.created_at), read_at: isoTime(m.read_at),
    })));
  }));

  r.post('/leads/:id/messages', requirePermission('client_messages'), ah(async (req, res) => {
    const leadId = idParam(req);
    const data = parse(z.object({
      body: z.string().trim().min(1, 'Message vide.').max(4000),
      sale_id: z.number().int().positive().optional(),
    }), req.body);
    const lead = await db('leads').where({ id: leadId }).first();
    if (!lead || !lead.client_code) throw new HttpError(404, 'Client introuvable.');
    if (data.sale_id && !(await db('sales').where({ id: data.sale_id, lead_id: leadId }).first())) throw new HttpError(400, 'Ce dossier n’appartient pas au client.');
    const [id] = await db('client_messages').insert({ lead_id: leadId, sale_id: data.sale_id || null, sender: 'equipe', user_id: req.user.id, body: data.body });
    // Le client est prévenu par e-mail (sans le contenu, qui reste dans son espace)
    const access = await db('client_accounts').where({ lead_id: leadId, active: true }).first();
    if (access && lead.email) {
      sendMail({
        to: lead.email,
        subject: 'Nouveau message de SIIPAF dans votre espace client',
        text: `Bonjour ${lead.name},\n\nL’équipe SIIPAF vous a écrit. Lisez et répondez depuis votre espace client :\n${clientAppUrl}\n\nSIIPAF SA`,
      }).catch(() => {});
    }
    const m = await db('client_messages').where({ id }).first();
    res.status(201).json({ id: m.id, sender: 'equipe', body: m.body, sale_id: m.sale_id, author: req.user.name, created_at: isoTime(m.created_at), read_at: null });
  }));

  return r;
};
