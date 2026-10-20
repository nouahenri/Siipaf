/** Projets, grilles de prix, plans de masse et lots (dashboard). */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, json } = require('../lib/http');
const { requirePermission } = require('../auth');
const { LOT_STATUSES, DELETABLE_LOT_STATUSES, NEW_LOT_STATUSES, PROJECT_CATEGORIES } = require('../lib/domain');
const { changeLotStatus, placeOption, throttledExpiry } = require('../services/lots');
const multer = require('multer');
const { parseCad } = require('../services/cad');

// Plans AutoCAD lus en mémoire (jamais enregistrés tels quels sur le serveur)
const cadUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 1 } });

const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const shape = z.array(point).min(3, 'Un lot doit avoir au moins 3 points.').max(200).nullable();

module.exports = function catalogRoutes(db) {
  const r = express.Router();
  const expire = throttledExpiry(db);

  // ─── Projets ──────────────────────────────────────────────
  const projectSchema = z.object({
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, 'Lettres minuscules, chiffres et tirets uniquement').max(80),
    name: z.string().trim().min(2).max(160),
    city: z.string().trim().max(80).nullable().optional(),
    location: z.string().trim().max(255).nullable().optional(),
    tagline: z.string().trim().max(255).nullable().optional(),
    description: z.string().max(10000).nullable().optional(),
    category: z.enum(Object.keys(PROJECT_CATEGORIES)).nullable().optional(),
    cover_media_id: z.number().int().positive().nullable().optional(),
    option_days: z.number().int().min(1).max(60).nullable().optional(),
    delivery: z.string().trim().max(80).nullable().optional(),
    amenities: z.array(z.string().trim().max(80)).max(40).optional(),
    published: z.boolean().optional(),
    sort: z.number().int().optional(),
  });
  const encodeProject = d => ('amenities' in d ? { ...d, amenities: JSON.stringify(d.amenities) } : d);
  const decodeProject = p => p && { ...p, amenities: json(p.amenities, []), published: !!p.published };

  r.get('/projects', requirePermission('projects:read'), ah(async (req, res) => {
    const projects = await db('projects').orderBy('sort');
    const counts = await db('lots').select('project_id', 'status').count({ n: '*' }).groupBy('project_id', 'status');
    res.json(projects.map(p => ({
      ...decodeProject(p),
      lots: Object.fromEntries(counts.filter(c => c.project_id === p.id).map(c => [c.status, Number(c.n)])),
    })));
  }));

  r.get('/projects/:id', requirePermission('projects:read'), ah(async (req, res) => {
    const id = idParam(req);
    const p = await db('projects').where({ id }).first();
    if (!p) throw new HttpError(404, 'Projet introuvable.');
    const [offers, plans] = await Promise.all([
      db('project_offers').where({ project_id: id }).orderBy('sort'),
      db('site_plans').where({ project_id: id }).orderBy('id'),
    ]);
    res.json({ ...decodeProject(p), offers, plans: plans.map(pl => ({ ...pl, published: !!pl.published })) });
  }));

  r.post('/projects', requirePermission('projects:write'), ah(async (req, res) => {
    const data = parse(projectSchema, req.body);
    if (await db('projects').where({ slug: data.slug }).first()) throw new HttpError(409, 'Cet identifiant (slug) est déjà utilisé.');
    const [id] = await db('projects').insert(encodeProject(data));
    res.status(201).json(decodeProject(await db('projects').where({ id }).first()));
  }));

  r.patch('/projects/:id', requirePermission('projects:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(projectSchema.partial(), req.body);
    if (data.slug && await db('projects').where({ slug: data.slug }).whereNot({ id }).first()) {
      throw new HttpError(409, 'Cet identifiant (slug) est déjà utilisé.');
    }
    const n = await db('projects').where({ id }).update({ ...encodeProject(data), updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Projet introuvable.');
    res.json(decodeProject(await db('projects').where({ id }).first()));
  }));

  // Remplace toute la grille de prix d'un projet (ordre = ordre du tableau)
  r.put('/projects/:id/offers', requirePermission('projects:write'), ah(async (req, res) => {
    const id = idParam(req);
    const offers = parse(z.array(z.object({
      id: z.number().int().positive().optional(),
      label: z.string().trim().min(1).max(160),
      surface: z.string().trim().max(80).nullable().optional(),
      price_fcfa: z.number().int().nonnegative().nullable().optional(),
      diaspora_price_fcfa: z.number().int().nonnegative().nullable().optional(),
    })).max(100), req.body);
    await db.transaction(async trx => {
      const keep = offers.filter(o => o.id).map(o => o.id);
      await trx('project_offers').where({ project_id: id }).whereNotIn('id', keep.length ? keep : [0]).del();
      for (const [sort, o] of offers.entries()) {
        const row = { project_id: id, label: o.label, surface: o.surface ?? null, price_fcfa: o.price_fcfa ?? null, diaspora_price_fcfa: o.diaspora_price_fcfa ?? null, sort };
        if (o.id) await trx('project_offers').where({ id: o.id, project_id: id }).update(row);
        else await trx('project_offers').insert(row);
      }
    });
    res.json(await db('project_offers').where({ project_id: id }).orderBy('sort'));
  }));

  // ─── Plans de masse ───────────────────────────────────────
  const planSchema = z.object({
    project_id: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    media_id: z.number().int().positive().nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    published: z.boolean().optional(),
  });

  // Un plan, son image et tous les lots du projet (placés sur ce plan ou encore à placer)
  r.get('/plans/:id', requirePermission('lots:read'), ah(async (req, res) => {
    const plan = await db('site_plans').where({ id: idParam(req) }).first();
    if (!plan) throw new HttpError(404, 'Plan introuvable.');
    const [project, offers, lots, media] = await Promise.all([
      db('projects').where({ id: plan.project_id }).first(),
      db('project_offers').where({ project_id: plan.project_id }).orderBy('sort'),
      db('lots').where({ project_id: plan.project_id }).where(q => q.where({ plan_id: plan.id }).orWhereNull('plan_id')).orderBy('code'),
      plan.media_id ? db('media').where({ id: plan.media_id }).first() : null,
    ]);
    res.json({
      ...plan, published: !!plan.published,
      image: media ? `/uploads/${media.filename}` : null,
      project: { id: project.id, name: project.name, slug: project.slug },
      offers,
      lots: lots.map(decodeLot),
    });
  }));

  // Lecture d'un plan AutoCAD (DWG / DXF) : renvoie la géométrie, le dashboard y détecte les parcelles
  r.post('/cad/parse', requirePermission('plans:write'), cadUpload.single('file'), ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Aucun fichier reçu.');
    res.json(await parseCad(req.file.buffer, req.file.originalname));
  }));

  r.post('/plans', requirePermission('plans:write'), ah(async (req, res) => {
    const data = parse(planSchema, req.body);
    const [id] = await db('site_plans').insert(data);
    res.status(201).json(await db('site_plans').where({ id }).first());
  }));

  r.patch('/plans/:id', requirePermission('plans:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(planSchema.omit({ project_id: true }).partial(), req.body);
    const n = await db('site_plans').where({ id }).update({ ...data, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Plan introuvable.');
    res.json(await db('site_plans').where({ id }).first());
  }));

  // ─── Lots ─────────────────────────────────────────────────
  const decodeLot = l => ({
    ...l, shape: json(l.shape), surface_m2: l.surface_m2 == null ? null : Number(l.surface_m2),
    ...('paid_fcfa' in l ? { paid_fcfa: l.sale_id ? Number(l.paid_fcfa) : null } : {}),
  });

  r.get('/lots', requirePermission('lots:read'), ah(async (req, res) => {
    await expire();
    const q = db('lots as l')
      .leftJoin('lot_options as o', function () { this.on('o.lot_id', 'l.id').andOn('o.state', db.raw('?', ['active'])); })
      .leftJoin('leads as ld', 'ld.id', 'o.lead_id')
      .leftJoin('sales as s', function () { this.on('s.lot_id', 'l.id').andOnIn('s.status', ['en_cours', 'solde']); })
      .leftJoin('leads as b', 'b.id', 's.lead_id')
      .select('l.*', 'o.expires_at as option_expires_at', 'ld.id as option_lead_id', 'ld.name as option_lead_name',
        's.id as sale_id', 's.status as sale_status', 's.price_fcfa as sale_price_fcfa', 'b.name as buyer_name',
        db.raw('(select coalesce(sum(p.amount_fcfa), 0) from payments p where p.sale_id = s.id) as paid_fcfa'))
      .orderBy(['l.project_id', 'l.code']);
    if (req.query.project_id) q.where('l.project_id', Number(req.query.project_id));
    if (req.query.plan_id) q.where('l.plan_id', Number(req.query.plan_id));
    if (req.query.status) q.whereIn('l.status', String(req.query.status).split(','));
    const salesVisible = req.can('sales:read');
    res.json((await q).map(decodeLot).map(l => (salesVisible ? l : { ...l, buyer_name: null, paid_fcfa: null, sale_price_fcfa: null, option_lead_name: null })));
  }));

  const lotFields = {
    code: z.string().trim().min(1).max(40),
    ilot: z.string().trim().max(40).nullable().optional(),
    plan_id: z.number().int().positive().nullable().optional(),
    offer_id: z.number().int().positive().nullable().optional(),
    surface_m2: z.number().nonnegative().nullable().optional(),
    price_fcfa: z.number().int().nonnegative().nullable().optional(),
    shape: shape.optional(),
    notes: z.string().max(2000).nullable().optional(),
  };
  const encodeLot = d => ('shape' in d ? { ...d, shape: d.shape ? JSON.stringify(d.shape) : null } : d);

  /**
   * Import / mise à jour en masse depuis l'éditeur de plan ou un fichier Excel/CSV :
   * un lot est identifié par son code dans le projet. Le statut n'est pas modifiable ici
   * (il passe par /lots/:id/status pour garder l'historique), sauf pour un nouveau lot.
   */
  r.put('/projects/:id/lots', requirePermission('plans:write'), ah(async (req, res) => {
    const projectId = idParam(req);
    const lots = parse(z.array(z.object({ ...lotFields, status: z.enum(LOT_STATUSES).optional() })).max(5000), req.body);
    const codes = new Set();
    for (const l of lots) {
      if (codes.has(l.code)) throw new HttpError(400, `Le code de lot « ${l.code} » apparaît deux fois.`);
      codes.add(l.code);
    }
    const summary = await db.transaction(async trx => {
      let created = 0, updated = 0;
      for (const l of lots) {
        const { status, ...fields } = l;
        const existing = await trx('lots').where({ project_id: projectId, code: l.code }).first();
        if (existing) {
          await trx('lots').where({ id: existing.id }).update({ ...encodeLot(fields), updated_at: new Date() });
          updated++;
        } else {
          const [lotId] = await trx('lots').insert({ ...encodeLot(fields), project_id: projectId, status: status || 'disponible' });
          await trx('lot_status_history').insert({ lot_id: lotId, from_status: null, to_status: status || 'disponible', user_id: req.user.id, reason: 'Création' });
          created++;
        }
      }
      return { created, updated };
    });
    res.json(summary);
  }));

  // Création d'un lot à l'unité (bouton « Nouveau lot ») : refusée si le numéro existe déjà dans le projet
  r.post('/projects/:id/lots', requirePermission('plans:write'), ah(async (req, res) => {
    const projectId = idParam(req);
    const { status, ...fields } = parse(z.object({ ...lotFields, status: z.enum(NEW_LOT_STATUSES).optional() }), req.body);
    if (!(await db('projects').where({ id: projectId }).first())) throw new HttpError(404, 'Projet introuvable.');
    if (await db('lots').where({ project_id: projectId, code: fields.code }).first()) {
      throw new HttpError(409, `Le lot « ${fields.code} » existe déjà dans ce projet.`);
    }
    const lot = await db.transaction(async trx => {
      const [lotId] = await trx('lots').insert({ ...encodeLot(fields), project_id: projectId, status: status || 'disponible' });
      await trx('lot_status_history').insert({ lot_id: lotId, from_status: null, to_status: status || 'disponible', user_id: req.user.id, reason: 'Création' });
      return trx('lots').where({ id: lotId }).first();
    });
    res.status(201).json(decodeLot(lot));
  }));

  r.patch('/lots/:id', requirePermission('plans:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object(lotFields).partial(), req.body);
    const lot = await db('lots').where({ id }).first();
    if (!lot) throw new HttpError(404, 'Lot introuvable.');
    if (data.code && data.code !== lot.code && await db('lots').where({ project_id: lot.project_id, code: data.code }).first()) {
      throw new HttpError(409, `Le lot « ${data.code} » existe déjà dans ce projet.`);
    }
    await db('lots').where({ id }).update({ ...encodeLot(data), updated_at: new Date() });
    res.json(decodeLot(await db('lots').where({ id }).first()));
  }));

  r.delete('/lots/:id', requirePermission('plans:write'), ah(async (req, res) => {
    const id = idParam(req);
    const lot = await db('lots').where({ id }).first();
    if (!lot) throw new HttpError(404, 'Lot introuvable.');
    if (!DELETABLE_LOT_STATUSES.includes(lot.status)) {
      throw new HttpError(409, 'Seul un lot disponible ou non commercialisé peut être supprimé.');
    }
    if (await db('sales').where({ lot_id: id }).first()) {
      throw new HttpError(409, 'Ce lot a un historique de vente : il ne peut pas être supprimé (passez-le en « non commercialisé »).');
    }
    await db('lots').where({ id }).del();
    res.json({ ok: true });
  }));

  r.post('/lots/:id/status', requirePermission('lots:status'), ah(async (req, res) => {
    const data = parse(z.object({
      status: z.enum(LOT_STATUSES),
      lead_id: z.number().int().positive().nullable().optional(),
      reason: z.string().trim().max(255).optional(),
    }), req.body);
    const lot = await changeLotStatus(db, { lotId: idParam(req), to: data.status, user: req.user, leadId: data.lead_id, reason: data.reason });
    res.json(decodeLot(lot));
  }));

  // Option posée par un commercial pour un prospect existant ou nouveau
  r.post('/lots/:id/option', requirePermission('lots:status'), ah(async (req, res) => {
    const data = parse(z.object({
      lead_id: z.number().int().positive().optional(),
      name: z.string().trim().min(2).max(160).optional(),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().min(6).max(40).optional(),
    }), req.body);
    let leadData = data;
    if (data.lead_id) {
      const lead = await db('leads').where({ id: data.lead_id }).first();
      if (!lead) throw new HttpError(404, 'Prospect introuvable.');
      leadData = lead;
    } else if (!data.name || (!data.email && !data.phone)) {
      throw new HttpError(400, 'Choisissez un prospect ou indiquez nom et contact.');
    }
    const result = await placeOption(db, { lotId: idParam(req), leadData: { ...leadData, source: 'admin' }, userId: req.user.id });
    res.status(201).json(result);
  }));

  r.get('/lots/:id/history', requirePermission('lots:read'), ah(async (req, res) => {
    const rows = await db('lot_status_history as h')
      .leftJoin('users as u', 'u.id', 'h.user_id')
      .leftJoin('leads as l', 'l.id', 'h.lead_id')
      .where('h.lot_id', idParam(req))
      .select('h.*', 'u.name as user_name', 'l.name as lead_name')
      .orderBy('h.id', 'desc');
    res.json(rows);
  }));

  return r;
};
