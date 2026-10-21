/**
 * ERP · Commercial (équipe) : tableau de bord, pipeline et fiches prospects (activités, historique),
 * parc immobilier (îlots, bâtiments, étages, lots), dossiers de vente, appels de fonds VEFA, objectifs.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, isoDay, isoTime } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const {
  LEAD_STAGES, PIPELINE_STAGES, STAGE_PROBABILITY, LOST_REASONS, ACTIVITY_KINDS, LEAD_KINDS, LOT_TYPES, BUILDING_KINDS,
  TARGET_METRICS, LOT_STATUSES, LOT_STATUS_LABELS, SITE_STAGES, SITE_STAGE_LABELS, VEFA_LEGAL_CAPS, DEFAULT_VEFA_PLAN, FINANCING_PLANS,
} = require('../../lib/domain');
const cm = require('../../services/commercial');
const vefa = require('../../services/vefa');
const { totals } = require('../../services/sales');
const { scheduleStatus } = require('../../services/schedule');
const { progressIndex } = require('../../services/clients');

const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois attendu au format AAAA-MM');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const when = z.string().min(10).refine(v => !Number.isNaN(Date.parse(v)), 'Date invalide');
const insertedId = r => (typeof r === 'object' ? r.id : r);

module.exports = function commercialRoutes(db) {
  const r = express.Router();
  const read = requirePermission('commercial:read');
  // Les appels de fonds se consultent avec le module ou avec le droit de les gérer (conducteur de travaux)
  const vefaRead = (req, res, next) => (req.can('commercial:read') || req.can('vefa:write') ? next() : next(new HttpError(403, 'Droits insuffisants.')));

  async function ownLead(req, id = idParam(req)) {
    const lead = await cm.scopeLeads(db('leads as ld'), req.user).where('ld.id', id).select('ld.*').first();
    if (!lead) throw new HttpError(404, 'Prospect introuvable.');
    return lead;
  }

  // ─── Référentiels ─────────────────────────────────────────
  r.get('/meta', vefaRead, ah(async (req, res) => {
    res.json({
      stages: LEAD_STAGES.map(s => ({ id: s, label: cm.STAGE_LABELS[s], probability: STAGE_PROBABILITY[s] })),
      pipeline_stages: PIPELINE_STAGES, lost_reasons: LOST_REASONS, activity_kinds: ACTIVITY_KINDS, lead_kinds: LEAD_KINDS,
      lot_types: LOT_TYPES, building_kinds: BUILDING_KINDS, target_metrics: TARGET_METRICS,
      lot_statuses: LOT_STATUSES.map(s => ({ id: s, label: LOT_STATUS_LABELS[s] })),
      site_stages: SITE_STAGES.map(s => ({ id: s, label: SITE_STAGE_LABELS[s] })),
      vefa_caps: VEFA_LEGAL_CAPS, vefa_default: DEFAULT_VEFA_PLAN,
      financings: Object.fromEntries(Object.entries(FINANCING_PLANS).map(([k, p]) => [k, p.label])),
      sellers: await cm.sellers(db),
      projects: await db('projects').orderBy('name').select('id', 'name', 'category'),
    });
  }));

  r.get('/dashboard', read, ah(async (req, res) => res.json(await cm.dashboard(db, req.user))));

  // ─── Pipeline et fiche prospect ───────────────────────────
  r.get('/pipeline', read, requirePermission('leads:read'), ah(async (req, res) => {
    res.json(await cm.pipeline(db, req.user, { ...req.query, include_lost: req.query.include_lost === '1' }));
  }));

  r.get('/leads/:id', read, requirePermission('leads:read'), ah(async (req, res) => {
    const lead = await ownLead(req);
    const [planned, history, sales, project, lot, assigned] = await Promise.all([
      db('lead_activities as a').leftJoin('users as u', 'u.id', 'a.assigned_to').where('a.lead_id', lead.id).whereNull('a.done_at')
        .select('a.*', 'u.name as assigned_name').orderBy('a.due_at'),
      cm.leadHistory(db, lead.id),
      db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id').where('s.lead_id', lead.id)
        .select('s.id', 's.status', 's.price_fcfa', 's.vefa', 's.financing', 'l.code as lot_code', 'l.id as lot_id', 'l.project_id', 'l.ilot', 'p.name as project_name').orderBy('s.id', 'desc'),
      lead.project_id ? db('projects').where({ id: lead.project_id }).first('id', 'name') : null,
      lead.lot_id ? db('lots').where({ id: lead.lot_id }).first('id', 'code', 'price_fcfa', 'status') : null,
      lead.assigned_to ? db('users').where({ id: lead.assigned_to }).first('id', 'name') : null,
    ]);
    const progress = await progressIndex(db);
    const salesOut = [];
    for (const s of sales) {
      salesOut.push({ ...s, vefa: !!s.vefa, price_fcfa: Number(s.price_fcfa), ...(await totals(db, s)), progress_pct: progress.lot({ id: s.lot_id, project_id: s.project_id, ilot: s.ilot })?.progress_pct ?? 0 });
    }
    res.json({
      ...lead, is_diaspora: !!lead.is_diaspora, created_at: isoTime(lead.created_at), lost_at: isoTime(lead.lost_at),
      expected_revenue_fcfa: lead.expected_revenue_fcfa == null ? null : Number(lead.expected_revenue_fcfa),
      probability: STAGE_PROBABILITY[lead.stage], project, lot, assigned_name: assigned?.name || null,
      activities: planned.map(cm.serializeActivity), history, sales: salesOut,
      // Avancement du chantier pour un client (code client), comme sur l'ancienne plateforme
      client_progress: lead.client_code ? progress.client(sales, lead.project_id) : null,
    });
  }));

  r.patch('/leads/:id', read, requirePermission('leads:write'), ah(async (req, res) => {
    const lead = await ownLead(req);
    const data = parse(z.object({
      name: z.string().trim().min(2).max(160), email: z.string().trim().toLowerCase().email().nullable(), phone: optText(40),
      country: optText(80), is_diaspora: z.boolean(), kind: z.enum(Object.keys(LEAD_KINDS)).nullable(),
      priority: z.number().int().min(0).max(3), expected_revenue_fcfa: z.number().int().min(0).nullable(),
      financing: z.enum(['apport', 'diaspora', 'credit', 'comptant']).nullable(),
      project_id: z.number().int().positive().nullable(), lot_id: z.number().int().positive().nullable(),
      assigned_to: z.number().int().positive().nullable(),
    }).partial(), req.body);
    if (!cm.seesAllLeads(req.user) && data.assigned_to && data.assigned_to !== req.user.id) {
      throw new HttpError(403, 'Un commercial ne peut attribuer un prospect qu’à lui-même.');
    }
    await db.transaction(async trx => {
      await trx('leads').where({ id: lead.id }).update({ ...data, updated_at: new Date() });
      if (data.assigned_to !== undefined && data.assigned_to !== lead.assigned_to) {
        const u = data.assigned_to ? await trx('users').where({ id: data.assigned_to }).first('name') : null;
        await cm.logActivity(trx, lead.id, { kind: 'systeme', summary: u ? `Attribué à ${u.name}` : 'Plus de commercial attribué', userId: req.user.id });
      }
    });
    res.json(await db('leads').where({ id: lead.id }).first());
  }));

  r.post('/leads/:id/stage', read, requirePermission('leads:write'), ah(async (req, res) => {
    const lead = await ownLead(req);
    const data = parse(z.object({
      stage: z.enum(LEAD_STAGES), lost_reason: z.enum(Object.keys(LOST_REASONS)).optional(), lost_note: optText(255),
    }), req.body);
    if (data.stage === lead.stage) throw new HttpError(409, 'Le prospect est déjà à cette étape.');
    if (data.stage === 'perdu' && !data.lost_reason) throw new HttpError(400, 'Indiquez le motif de la perte.');
    res.json(await cm.changeStage(db, lead, data, req.user.id));
  }));

  // ─── Activités ────────────────────────────────────────────
  const activityFields = {
    kind: z.enum(Object.keys(ACTIVITY_KINDS)), summary: optText(200), note: optText(5000),
    due_at: when.optional().nullable(), assigned_to: z.number().int().positive().optional().nullable(),
  };

  r.get('/activities', read, ah(async (req, res) => {
    const q = cm.scopeLeads(db('lead_activities as a').join('leads as ld', 'ld.id', 'a.lead_id'), req.user)
      .leftJoin('users as u', 'u.id', 'a.assigned_to').leftJoin('projects as p', 'p.id', 'ld.project_id')
      .whereNull('a.done_at').whereNot('ld.stage', 'perdu');
    if (req.query.mine !== '0') q.where('a.assigned_to', req.user.id);
    else if (req.query.assigned_to) q.where('a.assigned_to', Number(req.query.assigned_to));
    const rows = await q.select('a.*', 'ld.name as lead_name', 'ld.phone as lead_phone', 'ld.stage as lead_stage', 'p.name as project_name', 'u.name as assigned_name')
      .orderBy('a.due_at').limit(500);
    res.json(rows.map(cm.serializeActivity));
  }));

  r.post('/leads/:id/activities', read, requirePermission('leads:write'), ah(async (req, res) => {
    const lead = await ownLead(req);
    const data = parse(z.object(activityFields), req.body);
    if (data.kind !== 'note' && !data.due_at) throw new HttpError(400, 'Indiquez la date de l’activité.');
    // Une note s'inscrit directement dans l'historique
    const row = {
      lead_id: lead.id, kind: data.kind, summary: data.summary || ACTIVITY_KINDS[data.kind], note: data.note,
      due_at: data.due_at ? new Date(data.due_at) : null, done_at: data.kind === 'note' ? new Date() : null,
      assigned_to: data.assigned_to || lead.assigned_to || req.user.id, created_by: req.user.id,
    };
    if (data.kind === 'note' && !data.note) throw new HttpError(400, 'Note vide.');
    const [id] = await db('lead_activities').insert(row);
    await db('leads').where({ id: lead.id }).update({ updated_at: new Date() });
    res.status(201).json(cm.serializeActivity(await db('lead_activities').where({ id: insertedId(id) }).first()));
  }));

  async function ownActivity(req) {
    const a = await cm.scopeLeads(db('lead_activities as a').join('leads as ld', 'ld.id', 'a.lead_id'), req.user)
      .where('a.id', idParam(req)).select('a.*').first();
    if (!a) throw new HttpError(404, 'Activité introuvable.');
    return a;
  }

  // « Fait » (avec compte rendu), et éventuellement « planifier la suivante »
  r.post('/activities/:id/done', read, requirePermission('leads:write'), ah(async (req, res) => {
    const a = await ownActivity(req);
    if (a.done_at) throw new HttpError(409, 'Activité déjà réalisée.');
    const data = parse(z.object({
      outcome: optText(5000),
      next: z.object(activityFields).optional(),
    }), req.body);
    if (data.next && !data.next.due_at) throw new HttpError(400, 'Indiquez la date de l’activité suivante.');
    await db.transaction(async trx => {
      await trx('lead_activities').where({ id: a.id }).update({ done_at: new Date(), outcome: data.outcome, created_by: a.created_by || req.user.id, updated_at: new Date() });
      if (data.next) {
        await trx('lead_activities').insert({
          lead_id: a.lead_id, kind: data.next.kind, summary: data.next.summary || ACTIVITY_KINDS[data.next.kind], note: data.next.note,
          due_at: new Date(data.next.due_at), assigned_to: data.next.assigned_to || a.assigned_to || req.user.id, created_by: req.user.id,
        });
      }
      await trx('leads').where({ id: a.lead_id }).update({ updated_at: new Date() });
    });
    res.json({ ok: true });
  }));

  r.patch('/activities/:id', read, requirePermission('leads:write'), ah(async (req, res) => {
    const a = await ownActivity(req);
    const data = parse(z.object(activityFields).partial(), req.body);
    const patch = { ...data, updated_at: new Date() };
    if (data.due_at) patch.due_at = new Date(data.due_at);
    await db('lead_activities').where({ id: a.id }).update(patch);
    res.json(cm.serializeActivity(await db('lead_activities').where({ id: a.id }).first()));
  }));

  r.delete('/activities/:id', read, requirePermission('leads:write'), ah(async (req, res) => {
    const a = await ownActivity(req);
    if (a.done_at) throw new HttpError(409, 'Une activité réalisée reste dans l’historique.');
    await db('lead_activities').where({ id: a.id }).del();
    res.json({ ok: true });
  }));

  // ─── Parc immobilier ──────────────────────────────────────
  r.get('/property', read, requirePermission('lots:read'), ah(async (req, res) => {
    const projectId = Number(req.query.project_id);
    if (!projectId) throw new HttpError(400, 'Choisissez un programme.');
    const project = await db('projects').where({ id: projectId }).first('id', 'name', 'category', 'city');
    if (!project) throw new HttpError(404, 'Projet introuvable.');
    const [buildings, lots, plan] = await Promise.all([
      db('buildings').where({ project_id: projectId }).orderBy(['ilot', 'code']),
      db('lots as l').leftJoin('sales as s', b => b.on('s.lot_id', 'l.id').andOnIn('s.status', ['en_cours', 'solde']))
        .leftJoin('leads as ld', 'ld.id', 's.lead_id').where('l.project_id', projectId)
        .select('l.id', 'l.code', 'l.ilot', 'l.status', 'l.price_fcfa', 'l.surface_m2', 'l.lot_type', 'l.building_id', 'l.floor', 'l.rooms',
          'l.title_number', 'l.tantiemes', 's.id as sale_id', 's.vefa', 'ld.name as buyer_name'),
      vefa.getPlan(db, projectId),
    ]);
    const stock = lots.filter(l => ['disponible', 'desistement'].includes(l.status));
    res.json({
      project, buildings, vefa_plan: plan,
      lots: lots.map(l => ({ ...l, price_fcfa: l.price_fcfa == null ? null : Number(l.price_fcfa), surface_m2: l.surface_m2 == null ? null : Number(l.surface_m2), vefa: !!l.vefa })),
      summary: {
        lots: lots.length,
        by_status: lots.reduce((o, l) => ({ ...o, [l.status]: (o[l.status] || 0) + 1 }), {}),
        stock_value_fcfa: stock.reduce((s, l) => s + Number(l.price_fcfa || 0), 0),
        stock_surface_m2: Math.round(stock.reduce((s, l) => s + Number(l.surface_m2 || 0), 0)),
      },
    });
  }));

  const buildingSchema = z.object({
    code: z.string().trim().min(1, 'Donnez un code au bâtiment.').max(40), name: optText(160), ilot: optText(40),
    kind: z.enum(Object.keys(BUILDING_KINDS)).optional(), floors: z.number().int().min(0).max(60).optional(), notes: optText(500),
  });

  r.post('/projects/:id/buildings', read, requirePermission('property:write'), ah(async (req, res) => {
    const projectId = idParam(req);
    if (!(await db('projects').where({ id: projectId }).first())) throw new HttpError(404, 'Projet introuvable.');
    const data = parse(buildingSchema, req.body);
    if (await db('buildings').where({ project_id: projectId, code: data.code }).first()) throw new HttpError(409, 'Un bâtiment porte déjà ce code dans ce programme.');
    const [id] = await db('buildings').insert({ ...data, project_id: projectId });
    res.status(201).json(await db('buildings').where({ id: insertedId(id) }).first());
  }));

  r.patch('/buildings/:id', read, requirePermission('property:write'), ah(async (req, res) => {
    const b = await db('buildings').where({ id: idParam(req) }).first();
    if (!b) throw new HttpError(404, 'Bâtiment introuvable.');
    const data = parse(buildingSchema.partial(), req.body);
    if (data.code && data.code !== b.code && await db('buildings').where({ project_id: b.project_id, code: data.code }).first()) {
      throw new HttpError(409, 'Un bâtiment porte déjà ce code dans ce programme.');
    }
    await db('buildings').where({ id: b.id }).update({ ...data, updated_at: new Date() });
    res.json(await db('buildings').where({ id: b.id }).first());
  }));

  // Supprimer un bâtiment ne supprime aucun lot : ils redeviennent « sans bâtiment »
  r.delete('/buildings/:id', read, requirePermission('property:write'), ah(async (req, res) => {
    const b = await db('buildings').where({ id: idParam(req) }).first();
    if (!b) throw new HttpError(404, 'Bâtiment introuvable.');
    await db.transaction(async trx => {
      await trx('lots').where({ building_id: b.id }).update({ building_id: null, floor: null, updated_at: new Date() });
      await trx('buildings').where({ id: b.id }).del();
    });
    res.json({ ok: true });
  }));

  const lotPropertySchema = z.object({
    lot_type: z.enum(Object.keys(LOT_TYPES)).nullable(), building_id: z.number().int().positive().nullable(),
    floor: z.number().int().min(-3).max(60).nullable(), rooms: z.number().int().min(0).max(30).nullable(),
    title_number: optText(80), tantiemes: z.number().int().min(0).max(100000).nullable(),
    surface_m2: z.number().min(0).max(1e7).nullable(), price_fcfa: z.number().int().min(0).nullable(), ilot: optText(40),
  }).partial();

  async function checkBuilding(lot, data) {
    if (!data.building_id) return;
    const b = await db('buildings').where({ id: data.building_id }).first();
    if (!b || b.project_id !== lot.project_id) throw new HttpError(400, 'Ce bâtiment n’appartient pas au programme du lot.');
    const floor = data.floor ?? lot.floor;
    if (floor != null && floor > b.floors) throw new HttpError(400, `Le bâtiment ${b.code} n’a que ${b.floors} étage(s) au-dessus du rez-de-chaussée.`);
    if (b.ilot && data.ilot === undefined) data.ilot = b.ilot;
  }

  r.patch('/lots/:id', read, requirePermission('property:write'), ah(async (req, res) => {
    const lot = await db('lots').where({ id: idParam(req) }).first();
    if (!lot) throw new HttpError(404, 'Lot introuvable.');
    const data = parse(lotPropertySchema, req.body);
    await checkBuilding(lot, data);
    if (data.building_id === null) data.floor = null;
    await db('lots').where({ id: lot.id }).update({ ...data, updated_at: new Date() });
    res.json(await db('lots').where({ id: lot.id }).first());
  }));

  // Affectation groupée : plusieurs lots dans un bâtiment / à un étage / d'un même type
  r.post('/lots/bulk', read, requirePermission('property:write'), ah(async (req, res) => {
    const { lot_ids, ...data } = parse(lotPropertySchema.pick({ lot_type: true, building_id: true, floor: true }).extend({
      lot_ids: z.array(z.number().int().positive()).min(1).max(500),
    }), req.body);
    const lots = await db('lots').whereIn('id', lot_ids);
    if (lots.length !== lot_ids.length) throw new HttpError(400, 'Lot introuvable.');
    if (new Set(lots.map(l => l.project_id)).size > 1) throw new HttpError(400, 'Les lots doivent appartenir au même programme.');
    await checkBuilding(lots[0], data);
    if (data.building_id === null) data.floor = null;
    await db('lots').whereIn('id', lot_ids).update({ ...data, updated_at: new Date() });
    res.json({ updated: lots.length });
  }));

  // ─── Dossiers de vente ────────────────────────────────────
  // progress : index d'avancement du chantier (progressIndex), calculé une fois par requête
  async function saleRow(s, progress) {
    const t = await totals(db, s);
    const st = s.status === 'desiste' ? { overdue_fcfa: 0, overdue_count: 0, next_due: null } : await scheduleStatus(db, s, t);
    return {
      id: s.id, status: s.status, vefa: !!s.vefa, financing: s.financing, price_fcfa: Number(s.price_fcfa), reserved_at: isoDay(s.reserved_at), signed_at: isoDay(s.signed_at),
      lot_id: s.lot_id, lot_code: s.lot_code, ilot: s.ilot, project_id: s.project_id, project_name: s.project_name,
      lead_id: s.lead_id, client_name: s.client_name, client_code: s.client_code, assigned_name: s.assigned_name,
      ...t, overdue_fcfa: st.overdue_fcfa, overdue_count: st.overdue_count, next_due: st.next_due,
      progress_pct: progress.lot({ id: s.lot_id, project_id: s.project_id, ilot: s.ilot })?.progress_pct ?? 0,
    };
  }

  const salesQuery = () => db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id')
    .join('leads as ld', 'ld.id', 's.lead_id').leftJoin('users as u', 'u.id', 'ld.assigned_to')
    .select('s.*', 'l.code as lot_code', 'l.ilot', 'l.project_id', 'p.name as project_name', 'ld.name as client_name', 'ld.client_code', 'u.name as assigned_name');

  r.get('/sales', read, requirePermission('sales:read'), ah(async (req, res) => {
    const q = cm.scopeLeads(salesQuery(), req.user);
    if (req.query.project_id) q.where('l.project_id', Number(req.query.project_id));
    if (req.query.status) q.where('s.status', String(req.query.status));
    if (req.query.vefa === '1') q.where('s.vefa', true);
    if (req.query.q) {
      const s = `%${String(req.query.q).trim()}%`;
      q.where(b => b.where('ld.name', 'like', s).orWhere('ld.client_code', 'like', s).orWhere('l.code', 'like', s));
    }
    const rows = await q.orderBy('s.id', 'desc').limit(1000);
    const progress = await progressIndex(db);
    const out = [];
    for (const s of rows) out.push(await saleRow(s, progress));
    res.json(req.query.overdue === '1' ? out.filter(s => s.overdue_count > 0) : out);
  }));

  r.get('/sales/:id', read, requirePermission('sales:read'), ah(async (req, res) => {
    const s = await cm.scopeLeads(salesQuery(), req.user).where('s.id', idParam(req)).first();
    if (!s) throw new HttpError(404, 'Dossier introuvable.');
    const t = await totals(db, s);
    const [payments, schedule] = await Promise.all([
      db('payments as p').leftJoin('users as u', 'u.id', 'p.recorded_by').where('p.sale_id', s.id)
        .select('p.*', 'u.name as recorded_by_name').orderBy([{ column: 'p.paid_at', order: 'desc' }, { column: 'p.id', order: 'desc' }]),
      scheduleStatus(db, s, t),
    ]);
    res.json({ ...(await saleRow(s, await progressIndex(db))), notes: s.notes, schedule, payments: payments.map(p => ({ ...p, paid_at: isoDay(p.paid_at), amount_fcfa: Number(p.amount_fcfa) })) });
  }));

  // ─── VEFA : plans et appels de fonds ──────────────────────
  r.get('/vefa/plans/:id', vefaRead, ah(async (req, res) => res.json(await vefa.getPlan(db, idParam(req)))));

  r.put('/vefa/plans/:id', requirePermission('vefa:write'), ah(async (req, res) => {
    const projectId = idParam(req);
    if (!(await db('projects').where({ id: projectId }).first())) throw new HttpError(404, 'Projet introuvable.');
    const data = parse(z.object({
      milestones: z.array(z.object({
        stage: z.enum(['signature', ...SITE_STAGES]), label: z.string().trim().min(2).max(160), pct: z.number().positive().max(100),
      })).min(1).max(12),
      due_days: z.number().int().min(0).max(120).default(15),
    }), req.body);
    res.json(await vefa.savePlan(db, projectId, data, req.user.id));
  }));

  // Liste des appels de fonds (émis et à venir) avec leur état de paiement
  r.get('/vefa/calls', vefaRead, ah(async (req, res) => {
    const q = salesQuery().where('s.vefa', true).whereIn('s.status', ['en_cours', 'solde']);
    if (req.query.project_id) q.where('l.project_id', Number(req.query.project_id));
    const sales = await q.orderBy('s.id');
    const rows = [];
    for (const s of sales) {
      const st = await scheduleStatus(db, s, await totals(db, s));
      const lineBy = Object.fromEntries(st.lines.map(l => [l.seq, l]));
      for (const c of st.calls) {
        const line = lineBy[c.seq];
        rows.push({
          ...c, sale_id: s.id, lot_code: s.lot_code, ilot: s.ilot, project_name: s.project_name, client_name: s.client_name, client_code: s.client_code,
          payment_status: c.status === 'appele' ? line?.status || 'a_venir' : null, paid_fcfa: line ? line.paid_fcfa ?? null : null,
        });
      }
    }
    const filter = String(req.query.filter || '');
    const out = filter === 'retard' ? rows.filter(r2 => r2.payment_status === 'en_retard')
      : filter === 'appele' ? rows.filter(r2 => r2.status === 'appele' && r2.payment_status !== 'payee')
        : filter === 'a_venir' ? rows.filter(r2 => r2.status === 'a_venir') : rows;
    res.json(out);
  }));

  // Avancement par îlot / bâtiment : étape la plus avancée déclarée au journal de chantier
  r.get('/vefa/progress', vefaRead, ah(async (req, res) => {
    const projectId = Number(req.query.project_id);
    if (!projectId) throw new HttpError(400, 'Choisissez un programme.');
    const updates = await db('site_updates').where({ project_id: projectId }).select('ilot', 'lot_id', 'stage', 'published_at');
    const best = list => list.map(u => u.stage).sort((a, b) => SITE_STAGES.indexOf(b) - SITE_STAGES.indexOf(a))[0] || null;
    const ilots = [...new Set((await db('lots').where({ project_id: projectId }).whereNotNull('ilot').pluck('ilot')))].sort((a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true }));
    res.json({
      project: best(updates.filter(u => !u.ilot && !u.lot_id)),
      ilots: ilots.map(i => ({ ilot: i, stage: best(updates.filter(u => u.ilot === i && !u.lot_id)) })),
    });
  }));

  // Constat d'achèvement d'une étape (projet entier, un îlot, un bâtiment ou un lot)
  r.post('/vefa/milestones', requirePermission('vefa:write'), ah(async (req, res) => {
    const data = parse(z.object({
      project_id: z.number().int().positive(), stage: z.enum(SITE_STAGES), date: day,
      ilot: optText(40), building_id: z.number().int().positive().optional().nullable(), lot_id: z.number().int().positive().optional().nullable(),
    }), req.body);
    if (!(await db('projects').where({ id: data.project_id }).first())) throw new HttpError(404, 'Projet introuvable.');
    res.json(await vefa.recordMilestone(db, {
      projectId: data.project_id, ilot: data.ilot, buildingId: data.building_id, lotId: data.lot_id, stage: data.stage, date: data.date, userId: req.user.id,
    }));
  }));

  // ─── Objectifs ────────────────────────────────────────────
  r.get('/targets', read, ah(async (req, res) => {
    const m = parse(month, req.query.month || cm.monthKey(new Date()));
    const report = await cm.targetsReport(db, m);
    if (!cm.seesAllLeads(req.user) && !req.can('targets:write')) report.rows = report.rows.filter(x => x.user_id === req.user.id);
    res.json(report);
  }));

  r.put('/targets', requirePermission('targets:write'), ah(async (req, res) => {
    const data = parse(z.object({
      month, user_id: z.number().int().positive(),
      ca_fcfa: z.number().int().min(0).nullable().optional(), ventes: z.number().int().min(0).nullable().optional(),
      rdv: z.number().int().min(0).nullable().optional(), encaissements_fcfa: z.number().int().min(0).nullable().optional(),
    }), req.body);
    if (!(await db('users').where({ id: data.user_id }).first())) throw new HttpError(404, 'Utilisateur introuvable.');
    const row = { ...data, set_by: req.user.id, updated_at: new Date() };
    const existing = await db('sales_targets').where({ user_id: data.user_id, month: data.month }).first();
    if (existing) await db('sales_targets').where({ id: existing.id }).update(row);
    else await db('sales_targets').insert(row);
    res.json(await cm.targetsReport(db, data.month));
  }));

  return r;
};
