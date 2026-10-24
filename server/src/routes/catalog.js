/** Projets, grilles de prix, plans de masse et lots (dashboard). */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, json } = require('../lib/http');
const { requirePermission } = require('../auth');
const { LOT_STATUSES, DELETABLE_LOT_STATUSES, NEW_LOT_STATUSES, PROJECT_CATEGORIES, SITE_FIGURE_ICONS } = require('../lib/domain');
const { changeLotStatus, placeOption, throttledExpiry } = require('../services/lots');
const multer = require('multer');
const { parseCad } = require('../services/cad');
const { applyProjectRefs, applyProjectTypes, withTypeLabels, projectRefs, checkLotType } = require('../services/refs');
const { projectOffers, followsGrid, applyPriceGrid } = require('../services/priceGrid');

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
    // Conditions de paiement (vides = Paramètres › Réglages généraux) : acompte et délai de solde
    deposit_fcfa: z.number().int().min(0).max(1000000000).nullable().optional(),
    balance_months: z.number().int().min(1).max(120).nullable().optional(),
    delivery: z.string().trim().max(80).nullable().optional(),
    amenities: z.array(z.string().trim().max(80)).max(40).optional(),
    // Chiffres clés de la fiche du site (« 59 ha · Superficie ») ; la livraison vient de « Délai de livraison »
    key_figures: z.array(z.object({
      icon: z.enum(Object.keys(SITE_FIGURE_ICONS)), value: z.string().trim().min(1, 'Donnez une valeur à chaque chiffre clé.').max(40), label: z.string().trim().max(60),
    })).max(8).optional(),
    published: z.boolean().optional(),
    sort: z.number().int().optional(),
    // Listes de Paramètres : ville, localisation (de cette ville), cases cochées
    city_id: z.number().int().positive().nullable().optional(),
    location_id: z.number().int().positive().nullable().optional(),
    location_detail: z.string().trim().max(255).nullable().optional(),
    refs: z.array(z.object({ id: z.number().int().positive(), state: z.string().max(20).nullable().optional() })).max(200).optional(),
    // Type de projet et type de biens (listes de Paramètres) ; le type de projet fixe la catégorie
    project_type_id: z.number().int().positive().nullable().optional(),
    property_type_id: z.number().int().positive().nullable().optional(),
    // Plusieurs types de biens cochés (le premier devient property_type_id)
    property_type_ids: z.array(z.number().int().positive()).max(30).optional(),
    // Position GPS du projet (carte et itinéraire sur le site)
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  });
  const REF_FIELDS = ['city_id', 'location_id', 'location_detail', 'refs'];
  const TYPE_FIELDS = ['project_type_id', 'property_type_id', 'property_type_ids'];
  const splitRefs = data => {
    const fields = { ...data }, refs = {}, types = {};
    for (const k of REF_FIELDS) if (k in fields) { refs[k] = fields[k]; delete fields[k]; }
    for (const k of TYPE_FIELDS) if (k in fields) { types[k] = fields[k]; delete fields[k]; }
    return [fields, refs, types];
  };
  const encodeProject = d => ({
    ...d,
    ...('amenities' in d ? { amenities: JSON.stringify(d.amenities) } : {}),
    ...('key_figures' in d ? { key_figures: d.key_figures.length ? JSON.stringify(d.key_figures) : null } : {}),
  });
  const decodeProject = p => p && {
    ...p, amenities: json(p.amenities, []), key_figures: json(p.key_figures, []), published: !!p.published, deposit_fcfa: p.deposit_fcfa == null ? null : Number(p.deposit_fcfa),
  };

  r.get('/projects', requirePermission('projects:read'), ah(async (req, res) => {
    const projects = await withTypeLabels(db, await db('projects').orderBy('sort'));
    const counts = await db('lots').select('project_id', 'status').count({ n: '*' }).groupBy('project_id', 'status');
    res.json(projects.map(p => ({
      ...decodeProject(p),
      lots: Object.fromEntries(counts.filter(c => c.project_id === p.id).map(c => [c.status, Number(c.n)])),
    })));
  }));

  r.get('/projects/:id', requirePermission('projects:read'), ah(async (req, res) => {
    const id = idParam(req);
    const row = await db('projects').where({ id }).first();
    if (!row) throw new HttpError(404, 'Projet introuvable.');
    const [p] = await withTypeLabels(db, [row]);
    const [offers, plans, lotCount] = await Promise.all([
      db('project_offers').where({ project_id: id }).orderBy('sort'),
      db('site_plans').where({ project_id: id }).orderBy('id'),
      db('lots').where({ project_id: id }).count({ n: '*' }).first(),
    ]);
    res.json({ ...decodeProject(p), lot_count: Number(lotCount.n), refs: await projectRefs(db, id), offers, plans: plans.map(pl => ({ ...pl, published: !!pl.published })) });
  }));

  r.post('/projects', requirePermission('projects:write'), ah(async (req, res) => {
    const [data, refs, types] = splitRefs(parse(projectSchema, req.body));
    if (await db('projects').where({ slug: data.slug }).first()) throw new HttpError(409, 'Cet identifiant (slug) est déjà utilisé.');
    const id = await db.transaction(async trx => {
      const [newId] = await trx('projects').insert(encodeProject(data));
      if (Object.keys(types).length) await applyProjectTypes(trx, newId, types);
      if (Object.keys(refs).length) await applyProjectRefs(trx, newId, refs);
      return newId;
    });
    res.status(201).json(decodeProject(await db('projects').where({ id }).first()));
  }));

  r.patch('/projects/:id', requirePermission('projects:write'), ah(async (req, res) => {
    const id = idParam(req);
    const { archived, ...input } = parse(projectSchema.partial().extend({ archived: z.boolean().optional() }), req.body);
    const [data, refs, types] = splitRefs(input);
    if (data.slug && await db('projects').where({ slug: data.slug }).whereNot({ id }).first()) {
      throw new HttpError(409, 'Cet identifiant (slug) est déjà utilisé.');
    }
    await db.transaction(async trx => {
      const project = await trx('projects').where({ id }).first();
      if (!project) throw new HttpError(404, 'Projet introuvable.');
      if (archived === true) Object.assign(data, { archived_at: new Date(), published: false });
      if (archived === false) Object.assign(data, { archived_at: null, published: false });
      if (data.published && (archived === undefined ? project.archived_at : archived)) {
        throw new HttpError(409, 'Ce projet est archivé : restaurez-le avant de le publier.');
      }
      const n = await trx('projects').where({ id }).update({ ...encodeProject(data), updated_at: new Date() });
      if (!n) throw new HttpError(404, 'Projet introuvable.');
      if (Object.keys(types).length) await applyProjectTypes(trx, id, types);
      if (Object.keys(refs).length) await applyProjectRefs(trx, id, refs);
    });
    res.json(decodeProject((await withTypeLabels(db, [await db('projects').where({ id }).first()]))[0]));
  }));

  r.delete('/projects/:id', requirePermission('projects:write'), ah(async (req, res) => {
    const id = idParam(req);
    await db.transaction(async trx => {
      const project = await trx('projects').where({ id }).first();
      if (!project) throw new HttpError(404, 'Projet introuvable.');
      const lotIds = () => trx('lots').select('id').where({ project_id: id });
      const protectedLot = await trx('lots').where({ project_id: id }).whereNotIn('status', DELETABLE_LOT_STATUSES).first();
      const sale = await trx('sales').whereIn('lot_id', lotIds()).first();
      const option = await trx('lot_options').whereIn('lot_id', lotIds()).first();
      const history = await trx('lot_status_history').whereIn('lot_id', lotIds())
        .where(q => q.whereNotNull('lead_id').orWhereIn('to_status', ['option', 'reserve', 'vendu', 'desistement'])).first();
      if (protectedLot || sale || option || history) {
        throw new HttpError(409, 'Ce projet contient des lots engagés ou un historique commercial. Archivez-le pour conserver ses dossiers et versements.');
      }
      // Conserver également les liens des prospects, du chantier et du SAV.
      for (const table of ['leads', 'appointments', 'contact_messages', 'testimonials', 'site_updates']) {
        const linked = await trx(table).where({ project_id: id })
          .modify(q => { if (['leads', 'appointments'].includes(table)) q.orWhereIn('lot_id', lotIds()); }).first();
        if (linked) throw new HttpError(409, 'Ce projet est lié à des contacts ou à un suivi client. Archivez-le pour conserver cet historique.');
      }
      if (await trx.schema.hasTable('sav_tickets')) {
        const ticket = await trx('sav_tickets').where({ project_id: id }).orWhereIn('lot_id', lotIds()).first();
        if (ticket) throw new HttpError(409, 'Ce projet possède un suivi SAV. Archivez-le pour conserver cet historique.');
      }
      // Les clés étrangères suppriment ses lots libres, plans, offres et références.
      // Les fichiers de la médiathèque restent disponibles.
      await trx('projects').where({ id }).del();
    });
    res.json({ ok: true });
  }));

  // Remplace toute la grille de prix d'un projet (ordre = ordre du tableau)
  r.put('/projects/:id/offers', requirePermission('projects:write'), ah(async (req, res) => {
    const id = idParam(req);
    const offers = parse(z.array(z.object({
      id: z.number().int().positive().optional(),
      label: z.string().trim().min(1).max(160),
      // Précision affichée sur le site après le type de bien : « 2 pièces », « paiement comptant »
      designation: z.string().trim().max(120).nullable().optional(),
      surface: z.string().trim().max(80).nullable().optional(),
      price_fcfa: z.number().int().nonnegative().nullable().optional(),
      diaspora_price_fcfa: z.number().int().nonnegative().nullable().optional(),
      // Carte de prix du site : pastille (« Populaire ») et points forts, un par ligne
      badge: z.string().trim().max(40).nullable().optional(),
      highlights: z.string().trim().max(600).nullable().optional(),
    })).max(100), req.body);
    await db.transaction(async trx => {
      const keep = offers.filter(o => o.id).map(o => o.id);
      await trx('project_offers').where({ project_id: id }).whereNotIn('id', keep.length ? keep : [0]).del();
      for (const [sort, o] of offers.entries()) {
        const row = { project_id: id, label: o.label, designation: o.designation || null, surface: o.surface ?? null, price_fcfa: o.price_fcfa ?? null, diaspora_price_fcfa: o.diaspora_price_fcfa ?? null, badge: o.badge || null, highlights: o.highlights || null, sort };
        if (o.id) await trx('project_offers').where({ id: o.id, project_id: id }).update(row);
        else await trx('project_offers').insert(row);
      }
      // Grille modifiée : les lots libres qui la suivent (ou sans prix) prennent le prix de leur surface
      await applyPriceGrid(trx, id);
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
    const data = parse(planSchema.omit({ project_id: true }).partial().extend({ archived: z.boolean().optional() }), req.body);
    const plan = await db('site_plans').where({ id }).first();
    if (!plan) throw new HttpError(404, 'Plan introuvable.');
    const { archived, ...fields } = data;
    // Archiver retire le plan du site ; un plan archivé ne se publie pas (le restaurer d'abord)
    if (archived === true) Object.assign(fields, { archived_at: new Date(), published: false });
    if (archived === false) fields.archived_at = null;
    if (fields.published && (archived === undefined ? plan.archived_at : archived)) {
      throw new HttpError(409, 'Ce plan est archivé : restaurez-le avant de le publier.');
    }
    await db('site_plans').where({ id }).update({ ...fields, updated_at: new Date() });
    res.json(await db('site_plans').where({ id }).first());
  }));

  /**
   * Suppression d'un plan. Les lots ne sont jamais perdus : ils redeviennent « à placer ».
   * Avec delete_lots=1, les lots du plan encore libres (disponible ou non commercialisé, sans
   * historique de vente ni option) sont supprimés — utile après une conversion ratée.
   * Un plan publié ne se supprime pas : le dépublier ou l'archiver d'abord.
   */
  r.delete('/plans/:id', requirePermission('plans:write'), ah(async (req, res) => {
    const id = idParam(req);
    const plan = await db('site_plans').where({ id }).first();
    if (!plan) throw new HttpError(404, 'Plan introuvable.');
    if (plan.published) throw new HttpError(409, 'Ce plan est publié sur le site : dépubliez-le avant de le supprimer.');
    const withLots = req.query.delete_lots === '1' || req.query.delete_lots === 'true';
    const result = await db.transaction(async trx => {
      let deleted = 0;
      if (withLots) {
        const free = await trx('lots').where({ plan_id: id }).whereIn('status', DELETABLE_LOT_STATUSES)
          .whereNotExists(function () { this.select(1).from('sales').whereRaw('sales.lot_id = lots.id'); })
          .whereNotExists(function () { this.select(1).from('lot_options').whereRaw('lot_options.lot_id = lots.id'); })
          .pluck('id');
        for (let i = 0; i < free.length; i += 500) {
          const ids = free.slice(i, i + 500);
          await trx('lot_status_history').whereIn('lot_id', ids).del();
          deleted += await trx('lots').whereIn('id', ids).del();
        }
      }
      const unplaced = await trx('lots').where({ plan_id: id }).update({ plan_id: null, shape: null, updated_at: new Date() });
      await trx('site_plans').where({ id }).del();
      return { deleted, unplaced };
    });
    res.json({ ok: true, ...result });
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
      .leftJoin('leads as b', 'b.id', 's.lead_id').leftJoin('ref_items as pt', 'pt.id', 'l.property_type_id')
      .select('l.*', 'pt.label as property_type', 'o.expires_at as option_expires_at', 'ld.id as option_lead_id', 'ld.name as option_lead_name',
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
    // Type du bien, parmi les types cochés du projet
    property_type_id: z.number().int().positive().nullable().optional(),
    surface_m2: z.number().nonnegative().nullable().optional(),
    price_fcfa: z.number().int().nonnegative().nullable().optional(),
    shape: shape.optional(),
    notes: z.string().max(2000).nullable().optional(),
  };
  const encodeLot = d => ('shape' in d ? { ...d, shape: d.shape ? JSON.stringify(d.shape) : null } : d);
  /** Le type d'un bien doit être coché sur son projet. */
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
    // Reconversion d'un plan : les lots de ce plan absents du nouveau fichier redeviennent « à placer »
    const replacePlan = req.query.replace_plan ? Number(req.query.replace_plan) : null;
    if (replacePlan && !(await db('site_plans').where({ id: replacePlan, project_id: projectId }).first())) {
      throw new HttpError(400, 'Plan introuvable dans ce projet.');
    }
    const summary = await db.transaction(async trx => {
      let created = 0, updated = 0, unplaced = 0;
      const offers = await projectOffers(trx, projectId);
      const touched = [];
      for (const l of lots) {
        const { status, ...fields } = l;
        if (fields.property_type_id) await checkLotType(trx, projectId, fields.property_type_id);
        const existing = await trx('lots').where({ project_id: projectId, code: l.code }).first();
        if (existing) {
          // Prix envoyé : suit la grille s'il est vide ou égal à celui de la grille, sinon prix saisi à la main
          const origin = 'price_fcfa' in fields ? { price_from_grid: followsGrid(offers, { ...existing, ...fields }) } : {};
          await trx('lots').where({ id: existing.id }).update({ ...encodeLot(fields), ...origin, updated_at: new Date() });
          touched.push(existing.id);
          updated++;
        } else {
          const [lotId] = await trx('lots').insert({ ...encodeLot(fields), price_from_grid: followsGrid(offers, fields), project_id: projectId, status: status || 'disponible' });
          await trx('lot_status_history').insert({ lot_id: lotId, from_status: null, to_status: status || 'disponible', user_id: req.user.id, reason: 'Création' });
          touched.push(lotId);
          created++;
        }
      }
      if (replacePlan) {
        unplaced = await trx('lots').where({ project_id: projectId, plan_id: replacePlan }).whereNotIn('code', [...codes])
          .update({ plan_id: null, shape: null, updated_at: new Date() });
      }
      // Prix tirés de la grille (par surface) pour les lots sans prix ou qui la suivent
      const priced = await applyPriceGrid(trx, projectId, touched);
      return { created, updated, ...(replacePlan ? { unplaced } : {}), ...(priced ? { priced } : {}) };
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
      await checkLotType(trx, projectId, fields.property_type_id);
      const offers = await projectOffers(trx, projectId);
      const [lotId] = await trx('lots').insert({ ...encodeLot(fields), price_from_grid: followsGrid(offers, fields), project_id: projectId, status: status || 'disponible' });
      await trx('lot_status_history').insert({ lot_id: lotId, from_status: null, to_status: status || 'disponible', user_id: req.user.id, reason: 'Création' });
      await applyPriceGrid(trx, projectId, [lotId]);
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
    await db.transaction(async trx => {
      if ('property_type_id' in data) await checkLotType(trx, lot.project_id, data.property_type_id);
      const origin = 'price_fcfa' in data ? { price_from_grid: followsGrid(await projectOffers(trx, lot.project_id), { ...lot, ...data }) } : {};
      await trx('lots').where({ id }).update({ ...encodeLot(data), ...origin, updated_at: new Date() });
      // Surface ou type changé (ou prix vidé) : le prix suit la grille si le lot n'a pas de prix saisi à la main
      await applyPriceGrid(trx, lot.project_id, [id]);
    });
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
