/** Prospects, rendez-vous, messages de contact et newsletter (dashboard). */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../lib/http');
const { requirePermission } = require('../auth');
const { LEAD_STAGES } = require('../lib/domain');
const { findOrCreateLead } = require('../services/lots');
const { syncLead, recordDeletion } = require('../services/portfolio');

const page = req => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  return { limit, offset };
};

const csvCell = v => {
  const s = v == null ? '' : String(v);
  // Neutralise les formules Excel (=, +, -, @) et échappe les guillemets
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (rows, cols) => '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => csvCell(r[c])).join(';'))].join('\n');

module.exports = function crmRoutes(db) {
  const r = express.Router();

  // ─── Prospects ────────────────────────────────────────────
  // Un commercial ne voit que ses prospects et ceux non assignés
  const { seesAllLeads } = require('../services/commercial');
  const scopeLeads = (q, user) => {
    if (!seesAllLeads(user)) q.where(b => b.where('ld.assigned_to', user.id).orWhereNull('ld.assigned_to'));
    return q;
  };

  // Prospect OU client, jamais les deux : un client a un code client (page Clients), un prospect n'en a pas
  const onlyType = (q, type) => {
    if (type === 'prospects') q.whereNull('ld.client_code');
    else if (type === 'clients') q.whereNotNull('ld.client_code');
    return q;
  };

  r.get('/leads', requirePermission('leads:read'), ah(async (req, res) => {
    const { limit, offset } = page(req);
    const q = scopeLeads(db('leads as ld'), req.user)
      .leftJoin('projects as p', 'p.id', 'ld.project_id')
      .leftJoin('lots as l', 'l.id', 'ld.lot_id')
      .leftJoin('users as u', 'u.id', 'ld.assigned_to');
    onlyType(q, req.query.type);
    if (req.query.stage) q.whereIn('ld.stage', String(req.query.stage).split(','));
    if (req.query.project_id) q.where('ld.project_id', Number(req.query.project_id));
    if (req.query.assigned_to === 'aucun') q.whereNull('ld.assigned_to');
    else if (req.query.assigned_to) q.where('ld.assigned_to', Number(req.query.assigned_to));
    if (req.query.q) {
      const s = `%${String(req.query.q).trim()}%`;
      q.where(b => b.where('ld.name', 'like', s).orWhere('ld.email', 'like', s).orWhere('ld.phone', 'like', s));
    }
    const [{ total }] = await q.clone().count({ total: '*' });
    const rows = await q.select('ld.*', 'p.name as project_name', 'l.code as lot_code', 'u.name as assigned_name')
      .orderBy('ld.updated_at', 'desc').limit(limit).offset(offset);
    res.json({ total: Number(total), rows });
  }));

  r.get('/leads/:id', requirePermission('leads:read'), ah(async (req, res) => {
    const id = idParam(req);
    const lead = await scopeLeads(db('leads as ld'), req.user).where('ld.id', id).select('ld.*').first();
    if (!lead) throw new HttpError(404, 'Prospect introuvable.');
    // Fiche ouverte par l'équipe : le prospect n'est plus « nouveau » (compteur du menu Prospects)
    if (!lead.seen_at) await db('leads').where({ id }).whereNull('seen_at').update({ seen_at: new Date() });
    const [options, appointments, messages] = await Promise.all([
      db('lot_options as o').join('lots as l', 'l.id', 'o.lot_id').where('o.lead_id', id).select('o.*', 'l.code as lot_code').orderBy('o.id', 'desc'),
      db('appointments').where({ lead_id: id }).orderBy('starts_at', 'desc'),
      db('contact_messages').where({ lead_id: id }).orderBy('id', 'desc'),
    ]);
    res.json({ ...lead, options, appointments, messages });
  }));

  const leadSchema = z.object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().toLowerCase().email().nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    country: z.string().trim().max(80).nullable().optional(),
    is_diaspora: z.boolean().optional(),
    stage: z.enum(LEAD_STAGES).optional(),
    financing: z.enum(['apport', 'diaspora', 'credit', 'comptant']).nullable().optional(),
    project_id: z.number().int().positive().nullable().optional(),
    lot_id: z.number().int().positive().nullable().optional(),
    assigned_to: z.number().int().positive().nullable().optional(),
    message: z.string().max(4000).nullable().optional(),
    property_type: z.string().trim().max(160).nullable().optional(),
  });

  r.post('/leads', requirePermission('leads:write'), ah(async (req, res) => {
    const data = parse(leadSchema, req.body);
    if (!seesAllLeads(req.user) && data.assigned_to && data.assigned_to !== req.user.id) {
      throw new HttpError(403, 'Un commercial ne peut assigner un prospect qu’à lui-même.');
    }
    const lead = await db.transaction(async trx => {
      const found = await findOrCreateLead(trx, { ...data, source: 'admin', created_by: req.user.id });
      const patch = {};
      if (data.stage) patch.stage = data.stage;
      // Attribué d'office à celui qui a établi le contact ; une personne déjà connue garde son commercial
      if (found.created || !found.assigned_to) patch.assigned_to = data.assigned_to ?? (seesAllLeads(req.user) ? null : req.user.id);
      if (Object.keys(patch).length) await trx('leads').where({ id: found.id }).update(patch);
      await syncLead(trx, found.id, { by: req.user.id, reason: found.created ? 'creation' : 'attribution' });
      return found;
    });
    res.status(201).json(await db('leads').where({ id: lead.id }).first());
  }));

  r.patch('/leads/:id', requirePermission('leads:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(leadSchema.partial(), req.body);
    const lead = await scopeLeads(db('leads as ld'), req.user).where('ld.id', id).select('ld.*').first();
    if (!lead) throw new HttpError(404, 'Prospect introuvable.');
    if (!seesAllLeads(req.user) && data.assigned_to && data.assigned_to !== req.user.id) {
      throw new HttpError(403, 'Un commercial ne peut assigner un prospect qu’à lui-même.');
    }
    await db.transaction(async trx => {
      await trx('leads').where({ id }).update({ ...data, updated_at: new Date() });
      await syncLead(trx, id, { by: req.user.id });
    });
    // Historique du prospect (ERP · Commercial) : le changement d'étape y est inscrit
    if (data.stage && data.stage !== lead.stage) {
      const { logActivity, STAGE_LABELS } = require('../services/commercial');
      await logActivity(db, id, { kind: 'etape', summary: `Étape : ${STAGE_LABELS[lead.stage]} → ${STAGE_LABELS[data.stage]}`, userId: req.user.id });
    }
    res.json(await db('leads').where({ id }).first());
  }));

  // Suppression (doublon, demande d'effacement) : jamais si la personne a eu un dossier d'acquisition
  // ou détient une option en cours ; ses rendez-vous, accès client et messages partent avec elle.
  r.delete('/leads/:id', requirePermission('leads:delete'), ah(async (req, res) => {
    const id = idParam(req);
    const lead = await db('leads').where({ id }).first();
    if (!lead) throw new HttpError(404, 'Prospect introuvable.');
    if (await db('sales').where({ lead_id: id }).first()) {
      throw new HttpError(409, 'Cette personne a un dossier d’acquisition : elle ne peut pas être supprimée.');
    }
    if (await db('lot_options').where({ lead_id: id, state: 'active' }).first()) {
      throw new HttpError(409, 'Cette personne a une option en cours sur un lot : annulez-la d’abord.');
    }
    await db.transaction(async trx => {
      await recordDeletion(trx, lead, req.user.id); // compte en perte pour son commercial
      await trx('leads').where({ id }).del();
    });
    res.json({ ok: true });
  }));

  r.get('/leads.csv', requirePermission('leads:read'), ah(async (req, res) => {
    const rows = await onlyType(scopeLeads(db('leads as ld'), req.user), req.query.type)
      .leftJoin('projects as p', 'p.id', 'ld.project_id')
      .select('ld.id', 'ld.name', 'ld.email', 'ld.phone', 'ld.country', 'ld.stage', 'ld.source', 'ld.financing', 'p.name as projet', 'ld.created_at')
      .orderBy('ld.id');
    res.type('text/csv').attachment('prospects.csv').send(toCsv(rows, ['id', 'name', 'email', 'phone', 'country', 'stage', 'source', 'financing', 'projet', 'created_at']));
  }));

  // ─── Rendez-vous ──────────────────────────────────────────
  r.get('/appointments', requirePermission('appointments:read'), ah(async (req, res) => {
    const q = db('appointments as a')
      .join('leads as ld', 'ld.id', 'a.lead_id')
      .leftJoin('users as u', 'u.id', 'a.assigned_to')
      .leftJoin('projects as p', 'p.id', 'a.project_id')
      .select('a.*', 'ld.name as lead_name', 'ld.phone as lead_phone', 'ld.email as lead_email', 'u.name as assigned_name', 'p.name as project_name')
      .orderBy('a.starts_at');
    if (req.query.from) q.where('a.starts_at', '>=', new Date(String(req.query.from)));
    if (req.query.to) q.where('a.starts_at', '<', new Date(String(req.query.to)));
    if (req.query.status) q.whereIn('a.status', String(req.query.status).split(','));
    if (!seesAllLeads(req.user)) q.where(b => b.where('a.assigned_to', req.user.id).orWhereNull('a.assigned_to'));
    res.json(await q);
  }));

  const apptSchema = z.object({
    lead_id: z.number().int().positive(),
    assigned_to: z.number().int().positive().nullable().optional(),
    project_id: z.number().int().positive().nullable().optional(),
    lot_id: z.number().int().positive().nullable().optional(),
    kind: z.enum(['visite', 'appel', 'bureau', 'visio']).optional(),
    status: z.enum(['demande', 'confirme', 'effectue', 'annule', 'absent']).optional(),
    starts_at: z.coerce.date(),
    duration_min: z.number().int().min(5).max(480).optional(),
    notes: z.string().max(4000).nullable().optional(),
  });

  r.post('/appointments', requirePermission('appointments:write'), ah(async (req, res) => {
    const data = parse(apptSchema, req.body);
    if (!(await db('leads').where({ id: data.lead_id }).first())) throw new HttpError(404, 'Prospect introuvable.');
    const [id] = await db('appointments').insert({ ...data, source: 'admin', assigned_to: data.assigned_to ?? req.user.id });
    res.status(201).json(await db('appointments').where({ id }).first());
  }));

  r.patch('/appointments/:id', requirePermission('appointments:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(apptSchema.partial(), req.body);
    const n = await db('appointments').where({ id }).update({ ...data, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Rendez-vous introuvable.');
    // Une visite effectuée fait avancer le prospect à l'étape « visite »
    const appt = await db('appointments').where({ id }).first();
    if (data.status === 'effectue' && appt.kind === 'visite') {
      await db('leads').where({ id: appt.lead_id, stage: 'prospection' }).update({ stage: 'visite', updated_at: new Date() });
    }
    res.json(appt);
  }));

  // ─── Messages de contact ──────────────────────────────────
  r.get('/contacts', requirePermission('contacts:read'), ah(async (req, res) => {
    const { limit, offset } = page(req);
    const q = db('contact_messages as m').leftJoin('projects as p', 'p.id', 'm.project_id');
    if (req.query.status) q.whereIn('m.status', String(req.query.status).split(','));
    const [{ total }] = await q.clone().count({ total: '*' });
    const rows = await q.select('m.*', 'p.name as project_name').orderBy('m.id', 'desc').limit(limit).offset(offset);
    res.json({ total: Number(total), rows });
  }));

  r.patch('/contacts/:id', requirePermission('contacts:read'), ah(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['nouveau', 'traite', 'archive']) }), req.body);
    const n = await db('contact_messages').where({ id: idParam(req) }).update({ status });
    if (!n) throw new HttpError(404, 'Message introuvable.');
    res.json({ ok: true });
  }));

  // ─── Newsletter ───────────────────────────────────────────
  r.get('/newsletter', requirePermission('newsletter:read'), ah(async (req, res) => {
    const q = db('newsletter_subscribers').orderBy('id', 'desc');
    if (req.query.status) q.where({ status: String(req.query.status) });
    const rows = await q.select('id', 'email', 'status', 'source', 'created_at');
    res.json(rows);
  }));

  r.get('/newsletter.csv', requirePermission('newsletter:read'), ah(async (req, res) => {
    const rows = await db('newsletter_subscribers').where({ status: 'actif' }).select('email', 'created_at').orderBy('id');
    res.type('text/csv').attachment('newsletter.csv').send(toCsv(rows, ['email', 'created_at']));
  }));

  r.patch('/newsletter/:id', requirePermission('newsletter:write'), ah(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['actif', 'desinscrit']) }), req.body);
    const n = await db('newsletter_subscribers').where({ id: idParam(req) }).update({ status, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Abonné introuvable.');
    res.json({ ok: true });
  }));

  // ─── Indicateurs du tableau de bord ───────────────────────
  r.get('/stats', ah(async (req, res) => {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const pendingTestimonials = req.can('testimonials:write') ? Number((await db('testimonials').where({ status: 'en_attente' }).count({ n: '*' }))[0].n) : 0;
    const unreadClientMessages = req.can('client_messages') ? Number((await db('client_messages').where({ sender: 'client' }).whereNull('read_at').count({ n: '*' }))[0].n) : 0;
    const [lotsByStatus, leadsByStage, newLeads, prevLeads, newMessages, upcoming, subscribers] = await Promise.all([
      db('lots').select('status').count({ n: '*' }).groupBy('status'),
      req.can('leads:read') ? db('leads').select('stage').count({ n: '*' }).groupBy('stage') : [],
      req.can('leads:read') ? db('leads').where('created_at', '>=', since).count({ n: '*' }) : [{ n: 0 }],
      req.can('leads:read') ? db('leads').where('created_at', '>=', new Date(since.getTime() - 30 * 24 * 3600 * 1000)).where('created_at', '<', since).count({ n: '*' }) : [{ n: 0 }],
      req.can('contacts:read') ? db('contact_messages').where({ status: 'nouveau' }).count({ n: '*' }) : [{ n: 0 }],
      req.can('appointments:read') ? db('appointments').where('starts_at', '>=', new Date()).whereIn('status', ['demande', 'confirme']).count({ n: '*' }) : [{ n: 0 }],
      db('newsletter_subscribers').where({ status: 'actif' }).count({ n: '*' }),
    ]);
    const obj = rows => Object.fromEntries(rows.map(r => [r.status || r.stage, Number(r.n)]));
    res.json({
      lots: obj(lotsByStatus),
      leads: obj(leadsByStage),
      new_leads_30d: Number(newLeads[0].n),
      new_leads_prev_30d: Number(prevLeads[0].n),
      new_messages: Number(newMessages[0].n),
      upcoming_appointments: Number(upcoming[0].n),
      newsletter_active: Number(subscribers[0].n),
      pending_testimonials: pendingTestimonials,
      unread_client_messages: unreadClientMessages,
      new_leads: req.can('leads:read') ? await countNewLeads(req.user) : 0,
    });
  }));

  // ─── Notifications « nouveau prospect » (cloche du dashboard) ───
  // Prospects nouveaux pour l'équipe : demande venue du site dont personne n'a encore ouvert la fiche
  const countNewLeads = async user => Number((await scopeLeads(db('leads as ld'), user).whereNull('ld.seen_at').whereNotNull('ld.alert_at').count({ n: '*' }))[0].n);

  r.get('/notifications', requirePermission('leads:read'), ah(async (req, res) => {
    const me = await db('users').where({ id: req.user.id }).first('notifications_seen_at');
    const since = me && me.notifications_seen_at ? new Date(me.notifications_seen_at) : new Date(0);
    // Un prospect saisi par soi-même ne sonne pas sa propre cloche
    const q = scopeLeads(db('leads as ld'), req.user).whereNotNull('ld.alert_at')
      .where(b => b.whereNull('ld.created_by').orWhereNot('ld.created_by', req.user.id));
    const [[{ n }], rows, newLeads] = await Promise.all([
      q.clone().where('ld.alert_at', '>', since).count({ n: '*' }),
      q.clone().leftJoin('projects as p', 'p.id', 'ld.project_id').leftJoin('users as u', 'u.id', 'ld.created_by')
        .select('ld.id', 'ld.name', 'ld.phone', 'ld.source', 'ld.property_type', 'ld.alert_at', 'ld.seen_at', 'ld.client_code',
          'p.name as project_name', 'u.name as created_by_name')
        .orderBy('ld.alert_at', 'desc').limit(15),
      countNewLeads(req.user),
    ]);
    res.json({
      unread: Number(n), new_leads: newLeads, seen_until: since,
      items: rows.map(x => ({ ...x, unread: new Date(x.alert_at) > since })),
    });
  }));

  r.post('/notifications/seen', requirePermission('leads:read'), ah(async (req, res) => {
    await db('users').where({ id: req.user.id }).update({ notifications_seen_at: new Date() });
    res.json({ ok: true });
  }));

  /**
   * Activité mois par mois (12 derniers mois par défaut) : prospects, réservations,
   * encaissements, rendez-vous ; plus les totaux financiers et l'origine des prospects.
   * Le regroupement se fait en JavaScript pour rester identique sous MySQL et SQLite.
   */
  r.get('/stats/timeline', ah(async (req, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 12, 3), 36);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const keyOf = v => { const d = new Date(typeof v === 'number' || /^\d+$/.test(v) ? Number(v) : v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const series = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      series.push({ month: keyOf(d), leads: 0, reservations: 0, encaissements: 0, rdv: 0 });
    }
    const byKey = Object.fromEntries(series.map(s => [s.month, s]));
    const role = req.user.role;
    const add = (rows, field, valueOf = () => 1) => rows.forEach(row => { const s = byKey[keyOf(row.d)]; if (s) s[field] += valueOf(row); });

    const seeLeads = req.can('leads:read');
    const seeSales = req.can('sales:read');
    const [leads, sales, payments, appts, sources, sold] = await Promise.all([
      seeLeads ? db('leads').where('created_at', '>=', start).select('created_at as d') : [],
      seeSales ? db('sales').where('created_at', '>=', start).select('created_at as d') : [],
      seeSales ? db('payments').where('paid_at', '>=', start).select('paid_at as d', 'amount_fcfa') : [],
      req.can('appointments:read') ? db('appointments').where('starts_at', '>=', start).select('starts_at as d') : [],
      seeLeads ? db('leads').select('source').count({ n: '*' }).groupBy('source') : [],
      seeSales ? db('sales as s').leftJoin(db('payments').select('sale_id').sum({ paid: 'amount_fcfa' }).groupBy('sale_id').as('p'), 'p.sale_id', 's.id')
        .whereIn('s.status', ['en_cours', 'solde']).select(db.raw('coalesce(sum(s.price_fcfa), 0) as ca'), db.raw('coalesce(sum(p.paid), 0) as paid'), db.raw('count(*) as n')) : [{ ca: 0, paid: 0, n: 0 }],
    ]);
    add(leads, 'leads');
    add(sales, 'reservations');
    add(appts, 'rdv');
    add(payments, 'encaissements', row => Number(row.amount_fcfa));

    // 7 derniers jours : prospects et rendez-vous par jour
    const dayKey = v => { const d = new Date(typeof v === 'number' || /^\d+$/.test(v) ? Number(v) : v); return d.toISOString().slice(0, 10); };
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const week = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
      week.push({ day: dayKey(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))), leads: 0, rdv: 0 });
    }
    const byDay = Object.fromEntries(week.map(w => [w.day, w]));
    const localDay = v => { const d = new Date(typeof v === 'number' || /^\d+$/.test(v) ? Number(v) : v); return dayKey(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); };
    const [weekLeads, weekAppts, byProject, recent] = await Promise.all([
      seeLeads ? db('leads').where('created_at', '>=', weekStart).select('created_at as d') : [],
      req.can('appointments:read') ? db('appointments').where('created_at', '>=', weekStart).select('created_at as d') : [],
      seeSales ? db('payments as p').join('sales as s', 's.id', 'p.sale_id').join('lots as l', 'l.id', 's.lot_id').join('projects as pr', 'pr.id', 'l.project_id')
        .select('pr.name').sum({ total: 'p.amount_fcfa' }).groupBy('pr.id', 'pr.name') : [],
      seeSales ? db('payments as p').join('sales as s', 's.id', 'p.sale_id').join('leads as b', 'b.id', 's.lead_id').join('lots as l', 'l.id', 's.lot_id').join('projects as pr', 'pr.id', 'l.project_id')
        .select('p.id', 'p.amount_fcfa', 'p.paid_at', 'p.method', 'b.name as buyer', 'l.code as lot', 'pr.name as project', 'l.id as lot_id')
        .orderBy([{ column: 'p.paid_at', order: 'desc' }, { column: 'p.id', order: 'desc' }]).limit(6) : [],
    ]);
    weekLeads.forEach(r => { const w = byDay[localDay(r.d)]; if (w) w.leads++; });
    weekAppts.forEach(r => { const w = byDay[localDay(r.d)]; if (w) w.rdv++; });

    const ca = Number(sold[0].ca), paid = Number(sold[0].paid);
    res.json({
      series,
      week,
      by_project: byProject.map(p => ({ name: p.name, total: Number(p.total) })).sort((a, b) => b.total - a.total),
      recent_payments: recent.map(p => ({ ...p, amount_fcfa: Number(p.amount_fcfa) })),
      finance: seeSales ? { chiffre_affaires: ca, encaisse: paid, reste: Math.max(0, ca - paid), dossiers_actifs: Number(sold[0].n) } : null,
      sources: Object.fromEntries(sources.map(s => [s.source, Number(s.n)])),
    });
  }));

  return r;
};
