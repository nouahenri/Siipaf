/**
 * API publique consommée par le site : projets, plans de masse, intérêt, options,
 * demandes de rendez-vous, formulaire de contact, newsletter. Aucune donnée de prospect n'en sort.
 */
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { ah, parse, HttpError, json } = require('../lib/http');
const { LOT_STATUS_LABELS, SELLABLE_STATUSES } = require('../lib/domain');
const { findOrCreateLead, placeOption, throttledExpiry } = require('../services/lots');
const { notifyTeam, sendMail } = require('../lib/mailer');
const { isTest } = require('../config');

const phone = z.string().trim().min(6, 'Téléphone trop court').max(40);
const contactFields = {
  name: z.string().trim().min(2, 'Nom requis').max(160),
  email: z.string().trim().email('E-mail invalide').max(190).optional().or(z.literal('').transform(() => undefined)),
  phone: phone.optional().or(z.literal('').transform(() => undefined)),
  country: z.string().trim().max(80).optional(),
  is_diaspora: z.boolean().optional(),
  financing: z.enum(['apport', 'diaspora', 'credit', 'comptant']).optional(),
  message: z.string().trim().max(2000).optional(),
  // champ piège anti-robots : doit rester vide
  website: z.string().max(0, 'Spam').optional(),
};
const needsReach = d => d.email || d.phone;
const reachMsg = { message: 'Indiquez un e-mail ou un téléphone.', path: ['email'] };

module.exports = function publicRoutes(db) {
  const r = express.Router();
  const expire = throttledExpiry(db);

  // Limites anti-abus sur les formulaires
  const formLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: isTest ? 1000 : 20, standardHeaders: true, legacyHeaders: false });

  const mediaUrl = id => (id ? `/uploads/by-id/${id}` : null);

  r.get('/content', ah(async (req, res) => {
    const rows = await db('site_content').whereIn('key', ['hero', 'site', 'ticker', 'stats']);
    res.json(Object.fromEntries(rows.map(row => [row.key, json(row.value)])));
  }));

  r.get('/projects', ah(async (req, res) => {
    const projects = await db('projects').where({ published: true }).orderBy('sort');
    const [counts, plans] = await Promise.all([
      db('lots').select('project_id', 'status').count({ n: '*' }).groupBy('project_id', 'status'),
      db('site_plans').where({ published: true }).select('project_id').count({ n: '*' }).groupBy('project_id'),
    ]);
    res.json(projects.map(p => ({
      id: p.id, slug: p.slug, name: p.name, city: p.city, location: p.location, tagline: p.tagline,
      category: p.category, delivery: p.delivery, cover: mediaUrl(p.cover_media_id),
      lots: Object.fromEntries(counts.filter(c => c.project_id === p.id).map(c => [c.status, Number(c.n)])),
      // Un plan de masse publié = carte interactive consultable sur le site
      has_plan: plans.some(pl => pl.project_id === p.id),
    })));
  }));

  r.get('/projects/:slug', ah(async (req, res) => {
    await expire();
    const p = await db('projects').where({ slug: req.params.slug, published: true }).first();
    if (!p) throw new HttpError(404, 'Projet introuvable.');
    const [offers, plans, lots] = await Promise.all([
      db('project_offers').where({ project_id: p.id }).orderBy('sort'),
      db('site_plans').where({ project_id: p.id, published: true }),
      db('lots').where({ project_id: p.id }).select('id', 'plan_id', 'offer_id', 'code', 'ilot', 'surface_m2', 'price_fcfa', 'status', 'shape'),
    ]);
    res.json({
      id: p.id, slug: p.slug, name: p.name, city: p.city, location: p.location, tagline: p.tagline,
      description: p.description, category: p.category, delivery: p.delivery, amenities: json(p.amenities, []),
      cover: mediaUrl(p.cover_media_id), option_days: p.option_days,
      offers,
      statuses: LOT_STATUS_LABELS,
      plans: plans.map(pl => ({
        id: pl.id, name: pl.name, image: mediaUrl(pl.media_id), width: pl.width, height: pl.height,
        lots: lots.filter(l => l.plan_id === pl.id).map(l => ({
          ...l, shape: json(l.shape), surface_m2: l.surface_m2 == null ? null : Number(l.surface_m2),
          sellable: SELLABLE_STATUSES.includes(l.status),
        })),
      })),
    });
  }));

  // Manifestation d'intérêt (sur un projet ou un lot), sans blocage du lot
  const interestSchema = z.object({
    ...contactFields,
    project_id: z.number().int().positive().optional(),
    lot_id: z.number().int().positive().optional(),
  }).refine(needsReach, reachMsg);

  r.post('/interest', formLimiter, ah(async (req, res) => {
    const data = parse(interestSchema, req.body);
    if (data.lot_id) {
      const lot = await db('lots').where({ id: data.lot_id }).first();
      if (!lot) throw new HttpError(404, 'Lot introuvable.');
      data.project_id = lot.project_id;
    }
    const lead = await db.transaction(trx => findOrCreateLead(trx, { ...data, source: data.lot_id ? 'plan' : 'site' }));
    notifyTeam('Nouvelle manifestation d’intérêt', `${data.name} — ${data.phone || ''} ${data.email || ''}\nLot : ${data.lot_id || '—'}\n${data.message || ''}`);
    res.status(201).json({ ok: true, lead_id: lead.id });
  }));

  // Pré-réservation : bloque le lot pendant la durée d'option du projet
  const optionSchema = z.object(contactFields).refine(needsReach, reachMsg);

  r.post('/lots/:id/option', formLimiter, ah(async (req, res) => {
    const data = parse(optionSchema, req.body);
    const result = await placeOption(db, { lotId: Number(req.params.id), leadData: { ...data, source: 'plan' } });
    const lot = await db('lots').where({ id: result.lot_id }).first();
    notifyTeam('Nouvelle pré-réservation', `${data.name} — ${data.phone || ''} ${data.email || ''}\nLot ${lot.code} — expire le ${result.expires_at.toLocaleString('fr-FR')}`);
    if (data.email) {
      sendMail({
        to: data.email,
        subject: `Votre pré-réservation du lot ${lot.code} — SIIPAF`,
        text: `Bonjour ${data.name},\n\nLe lot ${lot.code} vous est réservé pendant ${result.days} jours, jusqu'au ${result.expires_at.toLocaleDateString('fr-FR')}.\nUn conseiller SIIPAF vous contacte pour finaliser votre réservation.\n\nSIIPAF SA — +225 01 02 27 95 95`,
      });
    }
    res.status(201).json({ ok: true, lot_id: result.lot_id, expires_at: result.expires_at, days: result.days });
  }));

  // Demande de rendez-vous (visite, appel…) — confirmée ensuite par un conseiller
  const appointmentSchema = z.object({
    ...contactFields,
    kind: z.enum(['visite', 'appel', 'bureau', 'visio']).default('appel'),
    starts_at: z.coerce.date().refine(d => d.getTime() > Date.now(), 'La date doit être dans le futur.'),
    project_id: z.number().int().positive().optional(),
    lot_id: z.number().int().positive().optional(),
  }).refine(needsReach, reachMsg);

  r.post('/appointments', formLimiter, ah(async (req, res) => {
    const data = parse(appointmentSchema, req.body);
    const id = await db.transaction(async trx => {
      const lead = await findOrCreateLead(trx, { ...data, source: 'site' });
      const [apptId] = await trx('appointments').insert({
        lead_id: lead.id, kind: data.kind, starts_at: data.starts_at, project_id: data.project_id || null,
        lot_id: data.lot_id || null, source: 'site', notes: data.message || null,
      });
      return apptId;
    });
    notifyTeam('Demande de rendez-vous', `${data.name} — ${data.kind} le ${data.starts_at.toLocaleString('fr-FR')}`);
    res.status(201).json({ ok: true, appointment_id: id });
  }));

  const contactSchema = z.object({
    ...contactFields,
    subject: z.string().trim().max(160).optional(),
    message: z.string().trim().min(5, 'Message trop court').max(4000),
    project: z.string().trim().max(80).optional(),
  }).refine(needsReach, reachMsg);

  r.post('/contact', formLimiter, ah(async (req, res) => {
    const data = parse(contactSchema, req.body);
    const project = data.project ? await db('projects').whereRaw('LOWER(slug) = ?', [data.project.toLowerCase()]).first() : null;
    const id = await db.transaction(async trx => {
      const lead = await findOrCreateLead(trx, { ...data, project_id: project && project.id, source: 'site' });
      const [msgId] = await trx('contact_messages').insert({
        name: data.name, email: data.email || null, phone: data.phone || null, subject: data.subject || null,
        message: data.message, project_id: project ? project.id : null, lead_id: lead.id,
      });
      return msgId;
    });
    notifyTeam('Nouveau message de contact', `${data.name} — ${data.phone || ''} ${data.email || ''}\n${data.subject || ''}\n\n${data.message}`);
    res.status(201).json({ ok: true, message_id: id });
  }));

  r.post('/newsletter', formLimiter, ah(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email('E-mail invalide'), website: z.string().max(0).optional() }), req.body);
    const existing = await db('newsletter_subscribers').where({ email }).first();
    if (existing) {
      if (existing.status !== 'actif') {
        await db('newsletter_subscribers').where({ id: existing.id }).update({ status: 'actif', updated_at: new Date() });
      }
    } else {
      await db('newsletter_subscribers').insert({ email, unsubscribe_token: crypto.randomBytes(24).toString('hex') });
    }
    res.status(201).json({ ok: true });
  }));

  r.get('/newsletter/unsubscribe', ah(async (req, res) => {
    const token = String(req.query.token || '');
    const updated = token && await db('newsletter_subscribers').where({ unsubscribe_token: token })
      .update({ status: 'desinscrit', updated_at: new Date() });
    res.type('html').send(updated
      ? '<p style="font-family:sans-serif">Vous êtes désinscrit(e) de la newsletter SIIPAF.</p>'
      : '<p style="font-family:sans-serif">Lien de désinscription invalide.</p>');
  }));

  return r;
};
