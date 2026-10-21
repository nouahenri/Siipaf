/** ERP · Client & SAV (équipe) : réclamations, réserves à la livraison, interventions, indicateurs. */
const path = require('path');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, json } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const {
  SAV_CATEGORIES, SAV_PRIORITIES, SAV_STATUSES, SAV_STATUS_LABELS, SAV_OPEN_STATUSES, SAV_TRANSITIONS,
  WARRANTIES, SAV_INTERVENTION_STATUSES, warrantyDates,
} = require('../../lib/domain');
const sav = require('../../services/sav');

const category = z.enum(Object.keys(SAV_CATEGORIES));
const priority = z.enum(Object.keys(SAV_PRIORITIES));
const ids = z.array(z.number().int().positive()).max(12).optional();
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

const page = req => ({
  limit: Math.min(Number(req.query.limit) || 25, 200),
  offset: Math.max(Number(req.query.offset) || 0, 0),
});

module.exports = function savRoutes(db) {
  const r = express.Router();
  const read = requirePermission('sav:read');
  // Actions du SAV (Rôles & privilèges) : créer, traiter, attribuer, réserves, interventions
  const create = requirePermission('sav:create');
  const handle = requirePermission('sav:handle');
  const reservesRight = requirePermission('sav:reserves');
  const interventionsRight = requirePermission('sav:interventions');
  const anyWrite = requirePermission('sav:create', 'sav:handle', 'sav:reserves', 'sav:interventions');

  // Référentiels utiles aux écrans (libellés, passages de statut, techniciens)
  r.get('/meta', read, ah(async (req, res) => {
    const techs = db('role_permissions').whereIn('permission', ['sav:handle', 'sav:interventions']).select('role');
    const users = await db('users').where({ active: true })
      .where(q => q.whereIn('role', techs).orWhere('role', 'super_admin')).orderBy('name').select('id', 'name', 'role');
    res.json({
      categories: SAV_CATEGORIES, priorities: SAV_PRIORITIES, statuses: SAV_STATUSES, status_labels: SAV_STATUS_LABELS,
      open_statuses: SAV_OPEN_STATUSES, transitions: SAV_TRANSITIONS, warranties: WARRANTIES,
      intervention_statuses: SAV_INTERVENTION_STATUSES, technicians: users,
      projects: await db('projects').orderBy('name').select('id', 'name'),
    });
  }));

  r.get('/stats', read, ah(async (req, res) => res.json(await sav.savStats(db))));

  // ─── Réclamations ─────────────────────────────────────────
  r.get('/tickets', read, ah(async (req, res) => {
    const { limit, offset } = page(req);
    const q = db('sav_tickets as t')
      .leftJoin('leads as ld', 'ld.id', 't.lead_id')
      .leftJoin('lots as l', 'l.id', 't.lot_id')
      .leftJoin('projects as p', 'p.id', 't.project_id')
      .leftJoin('users as u', 'u.id', 't.assigned_to');
    if (req.query.status) q.whereIn('t.status', String(req.query.status).split(','));
    if (req.query.open === '1') q.whereIn('t.status', SAV_OPEN_STATUSES);
    if (req.query.priority) q.whereIn('t.priority', String(req.query.priority).split(','));
    if (req.query.category) q.where('t.category', String(req.query.category));
    if (req.query.project_id) q.where('t.project_id', Number(req.query.project_id));
    if (req.query.assigned_to) q.where('t.assigned_to', Number(req.query.assigned_to));
    if (req.query.sale_id) q.where('t.sale_id', Number(req.query.sale_id));
    if (req.query.overdue === '1') q.whereIn('t.status', SAV_OPEN_STATUSES).where('t.due_at', '<', new Date());
    if (req.query.q) {
      const s = `%${String(req.query.q).trim()}%`;
      q.where(b => b.where('t.ref', 'like', s).orWhere('t.title', 'like', s).orWhere('ld.name', 'like', s)
        .orWhere('ld.client_code', 'like', s).orWhere('l.code', 'like', s));
    }
    const [{ total }] = await q.clone().count({ total: '*' });
    const rows = await q.select('t.id', 't.ref', 't.title', 't.category', 't.priority', 't.status', 't.source', 't.warranty',
      't.due_at', 't.created_at', 't.updated_at', 't.resolved_at', 't.satisfaction', 't.sale_id', 't.lead_id', 't.assigned_to',
      'ld.name as client_name', 'ld.client_code', 'l.code as lot_code', 'p.name as project_name', 'u.name as assigned_name')
      .orderBy([{ column: 't.updated_at', order: 'desc' }, { column: 't.id', order: 'desc' }]).limit(limit).offset(offset);
    const now = Date.now();
    res.json({
      total: Number(total),
      rows: rows.map(t => ({ ...t, overdue: SAV_OPEN_STATUSES.includes(t.status) && !!t.due_at && new Date(t.due_at).getTime() < now })),
    });
  }));

  r.post('/tickets', create, ah(async (req, res) => {
    const data = parse(z.object({
      sale_id: z.number().int().positive().optional(),
      lead_id: z.number().int().positive().optional(),
      category, priority: priority.optional(),
      title: z.string().trim().min(3, 'Donnez un titre à la réclamation.').max(160),
      description: optText(5000), location: optText(120),
      source: z.enum(['equipe', 'livraison', 'client']).optional(),
      assigned_to: z.number().int().positive().optional().nullable(),
      media_ids: ids,
    }), req.body);
    if (data.assigned_to && !req.can('sav:assign')) throw new HttpError(403, 'Attribuer une réclamation demande le droit « Attribuer les réclamations ».');
    data.media_ids = await sav.checkFiles(db, data.media_ids);
    const t = await sav.createTicket(db, data, { userId: req.user.id, source: data.source || 'equipe' });
    await sav.shareFiles(db, data.media_ids, t.lead_id);
    res.status(201).json(await sav.ticketDetail(db, t.id));
  }));

  r.get('/tickets/:id', read, ah(async (req, res) => res.json(await sav.ticketDetail(db, idParam(req)))));

  r.patch('/tickets/:id', requirePermission('sav:handle', 'sav:assign'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object({
      category: category.optional(), priority: priority.optional(),
      title: z.string().trim().min(3).max(160).optional(),
      description: optText(5000), location: optText(120),
      warranty: z.enum([...Object.keys(WARRANTIES), 'engagement_lotisseur', 'hors_garantie']).optional().nullable(),
      assigned_to: z.number().int().positive().optional().nullable(),
    }).partial(), req.body);
    const t = await db('sav_tickets').where({ id }).first();
    if (!t) throw new HttpError(404, 'Réclamation introuvable.');
    if (data.assigned_to !== undefined && data.assigned_to !== t.assigned_to && !req.can('sav:assign')) throw new HttpError(403, 'Attribuer une réclamation demande le droit « Attribuer les réclamations ».');
    if (Object.keys(data).some(k => k !== 'assigned_to') && !req.can('sav:handle')) throw new HttpError(403, 'Modifier une réclamation demande le droit « Traiter les réclamations ».');
    const patch = { ...data, updated_at: new Date() };
    // Un changement de priorité recalcule l'échéance depuis la date de dépôt
    if (data.priority && data.priority !== t.priority) patch.due_at = sav.dueFrom(data.priority, new Date(t.created_at));
    await db.transaction(async trx => {
      await trx('sav_tickets').where({ id }).update(patch);
      if (data.assigned_to !== undefined && data.assigned_to !== t.assigned_to) {
        const u = data.assigned_to ? await trx('users').where({ id: data.assigned_to }).first('name') : null;
        if (data.assigned_to && !u) throw new HttpError(400, 'Utilisateur inconnu.');
        await sav.addEvent(trx, id, { kind: 'assign', author: 'equipe', userId: req.user.id, body: u ? `Confiée à ${u.name}.` : 'Plus de responsable.', internal: true });
      }
      if (data.priority && data.priority !== t.priority) {
        await sav.addEvent(trx, id, { kind: 'system', author: 'equipe', userId: req.user.id, body: `Priorité : ${SAV_PRIORITIES[data.priority].label}.`, internal: true });
      }
    });
    res.json(await sav.ticketDetail(db, id));
  }));

  r.post('/tickets/:id/status', handle, ah(async (req, res) => {
    const { status, note } = parse(z.object({ status: z.enum(SAV_STATUSES), note: optText(1000) }), req.body);
    await sav.changeStatus(db, idParam(req), status, { userId: req.user.id, note });
    res.json(await sav.ticketDetail(db, idParam(req)));
  }));

  r.post('/tickets/:id/comments', handle, ah(async (req, res) => {
    const data = parse(z.object({
      body: z.string().trim().min(1, 'Message vide.').max(4000), internal: z.boolean().default(false), media_ids: ids,
    }), req.body);
    const id = idParam(req);
    const media = await sav.checkFiles(db, data.media_ids);
    const t = await sav.addComment(db, id, { author: 'equipe', userId: req.user.id, body: data.body, internal: data.internal, media });
    if (!data.internal) await sav.shareFiles(db, media, t.lead_id);
    res.status(201).json(await sav.ticketDetail(db, id));
  }));

  // ─── Livraison et réserves ────────────────────────────────
  // Dossiers d'acquisition, pour rattacher une réclamation ou saisir un PV de livraison
  r.get('/sales', read, ah(async (req, res) => {
    const q = db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id')
      .join('leads as ld', 'ld.id', 's.lead_id').whereNot('s.status', 'desiste');
    if (req.query.q) {
      const s = `%${String(req.query.q).trim()}%`;
      q.where(b => b.where('ld.name', 'like', s).orWhere('ld.client_code', 'like', s).orWhere('l.code', 'like', s).orWhere('ld.phone', 'like', s));
    }
    if (req.query.delivered === '1') q.whereNotNull('s.delivered_at');
    const rows = await q.select('s.id', 's.status', 's.delivered_at', 's.lead_id', 'ld.name as client_name', 'ld.client_code',
      'l.code as lot_code', 'l.ilot', 'p.name as project_name').orderBy('s.id', 'desc').limit(Math.min(Number(req.query.limit) || 20, 100));
    res.json(rows);
  }));

  r.get('/sales/:id', read, ah(async (req, res) => {
    const id = idParam(req);
    const s = await db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id')
      .join('leads as ld', 'ld.id', 's.lead_id').where('s.id', id)
      .first('s.id', 's.status', 's.delivered_at', 's.lead_id', 'ld.name as client_name', 'ld.client_code', 'ld.phone as client_phone',
        'l.code as lot_code', 'l.ilot', 'p.name as project_name');
    if (!s) throw new HttpError(404, 'Dossier introuvable.');
    const [reserves, tickets] = await Promise.all([
      db('sav_reserves').where({ sale_id: id }).orderBy('id'),
      db('sav_tickets').where({ sale_id: id }).orderBy('id', 'desc').select('id', 'ref', 'title', 'status', 'priority', 'created_at'),
    ]);
    const files = await sav.filesById(db, reserves.flatMap(x => json(x.media, [])), 'equipe');
    res.json({
      ...s, warranty_ends: s.delivered_at ? warrantyDates(s.delivered_at) : null, tickets,
      reserves: reserves.map(x => ({ ...x, media: json(x.media, []).map(i => files[i]).filter(Boolean) })),
    });
  }));

  // Date du procès-verbal de livraison : point de départ des garanties
  r.patch('/sales/:id/delivery', reservesRight, ah(async (req, res) => {
    const { delivered_at } = parse(z.object({ delivered_at: day.nullable() }), req.body);
    const n = await db('sales').where({ id: idParam(req) }).update({ delivered_at, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Dossier introuvable.');
    if (delivered_at) {
      const sale = await db('sales').where({ id: idParam(req) }).first('lead_id');
      await db('leads').where({ id: sale.lead_id }).whereIn('stage', ['contrat', 'notaire', 'paiement', 'choix_bien']).update({ stage: 'livraison', updated_at: new Date() });
    }
    res.json({ delivered_at, warranty_ends: delivered_at ? warrantyDates(delivered_at) : null });
  }));

  r.get('/reserves', read, ah(async (req, res) => {
    const q = db('sav_reserves as r').join('sales as s', 's.id', 'r.sale_id').join('leads as ld', 'ld.id', 's.lead_id')
      .leftJoin('lots as l', 'l.id', 'r.lot_id').leftJoin('projects as p', 'p.id', 'l.project_id');
    if (req.query.status) q.where('r.status', String(req.query.status));
    if (req.query.project_id) q.where('l.project_id', Number(req.query.project_id));
    const rows = await q.select('r.*', 'ld.name as client_name', 'ld.client_code', 'l.code as lot_code', 'p.name as project_name')
      .orderBy([{ column: 'r.status', order: 'desc' }, { column: 'r.deadline', order: 'asc' }, { column: 'r.id', order: 'asc' }]).limit(500);
    const today = new Date().toISOString().slice(0, 10);
    const day10 = v => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
    res.json(rows.map(x => ({ ...x, media: json(x.media, []), late: x.status === 'ouverte' && !!x.deadline && day10(x.deadline) < today })));
  }));

  r.post('/sales/:id/reserves', reservesRight, ah(async (req, res) => {
    const data = parse(z.object({
      label: z.string().trim().min(2, 'Décrivez la réserve.').max(255), location: optText(120),
      category: category.optional().nullable(), noted_at: day.optional(), deadline: day.optional().nullable(),
      note: optText(500), media_ids: ids,
    }), req.body);
    const sale = await db('sales').where({ id: idParam(req) }).first('lead_id');
    if (!sale) throw new HttpError(404, 'Dossier introuvable.');
    data.media_ids = await sav.checkFiles(db, data.media_ids);
    await sav.shareFiles(db, data.media_ids, sale.lead_id);
    res.status(201).json(await sav.createReserve(db, idParam(req), data));
  }));

  r.patch('/reserves/:id', reservesRight, ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object({
      status: z.enum(['ouverte', 'levee']).optional(), label: z.string().trim().min(2).max(255).optional(),
      location: optText(120), deadline: day.optional().nullable(), note: optText(500),
    }), req.body);
    const { status, note, ...rest } = data;
    if (Object.keys(rest).length) {
      const n = await db('sav_reserves').where({ id }).update({ ...rest, updated_at: new Date() });
      if (!n) throw new HttpError(404, 'Réserve introuvable.');
    }
    if (status) await sav.setReserveStatus(db, id, status, { userId: req.user.id, note });
    else if (note !== undefined) await db('sav_reserves').where({ id }).update({ note, updated_at: new Date() });
    const row = await db('sav_reserves').where({ id }).first();
    if (!row) throw new HttpError(404, 'Réserve introuvable.');
    res.json({ ...row, media: json(row.media, []) });
  }));

  r.post('/reserves/:id/ticket', create, ah(async (req, res) => {
    const t = await sav.reserveToTicket(db, idParam(req), { userId: req.user.id });
    res.status(201).json(await sav.ticketDetail(db, t.id));
  }));

  // ─── Interventions ────────────────────────────────────────
  r.get('/interventions', read, ah(async (req, res) => {
    const q = db('sav_interventions as i')
      .leftJoin('sav_tickets as t', 't.id', 'i.ticket_id')
      .leftJoin('sav_reserves as rs', 'rs.id', 'i.reserve_id')
      .leftJoin('sales as s', function () { this.on('s.id', '=', db.raw('coalesce(t.sale_id, rs.sale_id)')); })
      .leftJoin('leads as ld', 'ld.id', 's.lead_id')
      .leftJoin('lots as l', 'l.id', 's.lot_id')
      .leftJoin('projects as p', 'p.id', 'l.project_id')
      .leftJoin('users as u', 'u.id', 'i.technician_id');
    if (req.query.from) q.where('i.scheduled_at', '>=', new Date(String(req.query.from)));
    if (req.query.to) q.where('i.scheduled_at', '<', new Date(String(req.query.to)));
    if (req.query.status) q.where('i.status', String(req.query.status));
    if (req.query.technician_id) q.where('i.technician_id', Number(req.query.technician_id));
    if (req.query.ticket_id) q.where('i.ticket_id', Number(req.query.ticket_id));
    const rows = await q.select('i.*', 't.ref as ticket_ref', 't.title as ticket_title', 'rs.label as reserve_label',
      'ld.name as client_name', 'ld.phone as client_phone', 'l.code as lot_code', 'p.name as project_name', 'u.name as technician_name')
      .orderBy('i.scheduled_at').limit(500);
    res.json(rows.map(i => ({ ...i, media_before: json(i.media_before, []), media_after: json(i.media_after, []) })));
  }));

  const interventionBase = {
    scheduled_at: z.string().min(10).refine(v => !Number.isNaN(Date.parse(v)), 'Date invalide'),
    duration_min: z.number().int().min(15).max(24 * 60),
    technician_id: z.number().int().positive().nullable(),
    contractor: optText(160),
    cost_fcfa: z.number().int().min(0).nullable(),
  };

  r.post('/interventions', interventionsRight, ah(async (req, res) => {
    const data = parse(z.object({
      ticket_id: z.number().int().positive().optional(), reserve_id: z.number().int().positive().optional(),
      ...interventionBase, duration_min: interventionBase.duration_min.optional(),
      technician_id: interventionBase.technician_id.optional(), cost_fcfa: interventionBase.cost_fcfa.optional(),
    }), req.body);
    res.status(201).json(await sav.createIntervention(db, data, { userId: req.user.id }));
  }));

  r.patch('/interventions/:id', interventionsRight, ah(async (req, res) => {
    const data = parse(z.object({
      ...interventionBase, status: z.enum(SAV_INTERVENTION_STATUSES), report: optText(5000),
      media_before: z.array(z.number().int().positive()).max(12), media_after: z.array(z.number().int().positive()).max(12),
    }).partial(), req.body);
    const i = await db('sav_interventions as i').leftJoin('sav_tickets as t', 't.id', 'i.ticket_id').where('i.id', idParam(req)).first('i.id', 't.lead_id');
    if (!i) throw new HttpError(404, 'Intervention introuvable.');
    if (data.media_before) data.media_before = await sav.checkFiles(db, data.media_before);
    if (data.media_after) data.media_after = await sav.checkFiles(db, data.media_after);
    await sav.shareFiles(db, [...(data.media_before || []), ...(data.media_after || [])], i.lead_id);
    const row = await sav.updateIntervention(db, i.id, data, { userId: req.user.id });
    res.json({ ...row, media_before: json(row.media_before, []), media_after: json(row.media_after, []) });
  }));

  // ─── Photos ───────────────────────────────────────────────
  r.post('/files', anyWrite, sav.photoUpload(), ah(async (req, res) => {
    const leadId = Number(req.body.lead_id) || null;
    const created = await sav.saveFiles(db, req.files, { leadId, userId: req.user.id });
    res.status(201).json(Object.values(await sav.filesById(db, created, 'equipe')));
  }));

  r.get('/files/:id', read, ah(async (req, res) => {
    const f = await db('sav_files').where({ id: idParam(req) }).first();
    if (!f) throw new HttpError(404, 'Fichier introuvable.');
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.join(sav.savFilesDir, path.basename(f.filename)), err => err && !res.headersSent && res.sendStatus(404));
  }));

  return r;
};
