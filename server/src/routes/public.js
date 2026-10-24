/**
 * API publique consommée par le site : projets, plans de masse, intérêt, options,
 * demandes de rendez-vous, formulaire de contact, newsletter. Aucune donnée de prospect n'en sort.
 */
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { ah, parse, HttpError, json } = require('../lib/http');
const { LOT_STATUS_LABELS, SELLABLE_STATUSES, paymentTerms, monthChoices, siteFigures } = require('../lib/domain');
const { findOrCreateLead, placeOption, throttledExpiry } = require('../services/lots');
const { notifyTeam, sendMail } = require('../lib/mailer');
const { projectRefs, stateLabels } = require('../services/refs');
const { getSettings } = require('../services/settings');
const { isTest } = require('../config');
const { publicSiteImages } = require('../services/siteImages');

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
    const rows = await db('site_content').whereIn('key', ['hero', 'site', 'ticker', 'stats', 'editorial']);
    res.json({ ...Object.fromEntries(rows.map(row => [row.key, json(row.value)])), images: await publicSiteImages(db) });
  }));

  // Position GPS du projet : carte et itinéraire sur le site (null si non renseignée)
  const geo = p => (p.latitude != null && p.longitude != null ? { lat: Number(p.latitude), lng: Number(p.longitude) } : null);

  // Documents du bien (titre foncier, ACD…) avec leur état, par projet
  const documentsOf = async projectIds => {
    if (!projectIds.length) return [];
    return db('project_refs as pr').join('ref_items as i', 'i.id', 'pr.ref_id').where('i.kind', 'document').whereIn('pr.project_id', projectIds)
      .orderBy(['i.sort', 'i.label']).select('pr.project_id', 'i.label', 'pr.state');
  };
  /** Types de biens cochés des projets (ordre de la fiche). */
  const propertyTypesOf = ids => (ids.length ? db('project_property_types as t').join('ref_items as r', 'r.id', 't.item_id')
    .whereIn('t.project_id', ids).orderBy(['t.project_id', 't.sort']).select('t.project_id', 'r.label') : []);
  // Conditions de paiement affichées sur la tuile et la fiche : acompte, délai de solde, propositions de durée
  const termsOf = (p, settings) => ({ ...paymentTerms(p, settings), balance_months_choices: monthChoices(settings.balance_months_choices) });

  r.get('/projects', ah(async (req, res) => {
    const projects = await db('projects').where({ published: true }).whereNull('archived_at').orderBy('sort');
    const [settings, docs, labels] = await Promise.all([getSettings(db), documentsOf(projects.map(p => p.id)), stateLabels(db)]);
    const [counts, plans, offers, types] = await Promise.all([
      db('lots').select('project_id', 'status').count({ n: '*' }).groupBy('project_id', 'status'),
      db('site_plans').where({ published: true }).whereNull('archived_at').select('project_id').count({ n: '*' }).groupBy('project_id'),
      // Grille de prix du dashboard : tableau des prix du site (équivalent en euros et option Diaspora calculés par le site)
      db('project_offers').select('project_id', 'label', 'designation', 'surface', 'price_fcfa', 'diaspora_price_fcfa', 'badge', 'highlights').orderBy(['project_id', 'sort']),
      db('ref_items').where({ kind: 'type_projet' }).select('id', 'label'),
    ]);
    const propertyTypes = await propertyTypesOf(projects.map(p => p.id));
    const typeLabel = id => types.find(t => t.id === id)?.label || null;
    res.json(projects.map(p => ({
      id: p.id, slug: p.slug, name: p.name, city: p.city, location: p.location, tagline: p.tagline,
      description: p.description, amenities: json(p.amenities, []), project_type: typeLabel(p.project_type_id),
      // Chiffres clés réglés dans la fiche projet (pictogramme, valeur, libellé)
      key_figures: siteFigures(p.key_figures),
      // Types de biens cochés dans la fiche projet (tuile « N types de biens » du site)
      property_types: propertyTypes.filter(t => t.project_id === p.id).map(t => t.label),
      offers: offers.filter(o => o.project_id === p.id).map(({ project_id, ...o }) => o),
      category: p.category, delivery: p.delivery, cover: mediaUrl(p.cover_media_id), geo: geo(p),
      lots: Object.fromEntries(counts.filter(c => c.project_id === p.id).map(c => [c.status, Number(c.n)])),
      // Un plan de masse publié = carte interactive consultable sur le site
      has_plan: plans.some(pl => pl.project_id === p.id),
      ...termsOf(p, settings),
      documents: docs.filter(d => d.project_id === p.id).map(d => ({ label: d.label, state: d.state || 'prevu', state_label: labels.document[d.state || 'prevu'] })),
    })));
  }));

  r.get('/projects/:slug', ah(async (req, res) => {
    await expire();
    const p = await db('projects').where({ slug: req.params.slug, published: true }).whereNull('archived_at').first();
    if (!p) throw new HttpError(404, 'Projet introuvable.');
    const [offers, plans, lots] = await Promise.all([
      db('project_offers').where({ project_id: p.id }).orderBy('sort'),
      db('site_plans').where({ project_id: p.id, published: true }).whereNull('archived_at'),
      db('lots').where({ project_id: p.id }).select('id', 'plan_id', 'offer_id', 'code', 'ilot', 'surface_m2', 'price_fcfa', 'status', 'shape'),
    ]);
    const [features, settings, labels] = await Promise.all([projectRefs(db, p.id), getSettings(db), stateLabels(db)]);
    res.json({
      id: p.id, slug: p.slug, name: p.name, city: p.city, location: p.location, tagline: p.tagline,
      description: p.description, category: p.category, delivery: p.delivery, amenities: json(p.amenities, []), geo: geo(p),
      key_figures: siteFigures(p.key_figures),
      property_types: (await propertyTypesOf([p.id])).map(t => t.label),
      // Listes de Paramètres : commodités à proximité et état de la viabilisation (lotissements)
      commodites: features.commodite.map(f => f.label),
      viabilisation: features.viabilisation.map(f => ({ label: f.label, state: f.state, state_label: labels.viabilisation[f.state] })),
      documents: features.document.map(f => ({ label: f.label, state: f.state, state_label: labels.document[f.state] })),
      ...termsOf(p, settings),
      cover: mediaUrl(p.cover_media_id), option_days: p.option_days || settings.option_days_default,
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
    property_type: z.string().trim().max(160).optional(),
  }).refine(needsReach, reachMsg);

  r.post('/contact', formLimiter, ah(async (req, res) => {
    const data = parse(contactSchema, req.body);
    const project = data.project ? await db('projects').whereRaw('LOWER(slug) = ?', [data.project.toLowerCase()]).first() : null;
    const id = await db.transaction(async trx => {
      const lead = await findOrCreateLead(trx, { ...data, project_id: project && project.id, source: 'site' });
      const [msgId] = await trx('contact_messages').insert({
        name: data.name, email: data.email || null, phone: data.phone || null, subject: data.subject || null,
        message: data.message, project_id: project ? project.id : null, lead_id: lead.id, property_type: data.property_type || null,
      });
      return msgId;
    });
    notifyTeam('Nouveau message de contact', `${data.name} — ${data.phone || ''} ${data.email || ''}\n${[project && project.name, data.property_type, data.subject].filter(Boolean).join(' · ')}\n\n${data.message}`);
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

  // Désinscription : lien des e-mails (GET) et désinscription en un clic des messageries (POST, RFC 8058)
  const unsubscribe = async token => token && await db('newsletter_subscribers').where({ unsubscribe_token: token })
    .update({ status: 'desinscrit', updated_at: new Date() });
  const page = (title, text) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — SIIPAF</title></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1d2230"><div style="max-width:480px;margin:64px auto;padding:32px;background:#fff;border-radius:12px;text-align:center">
<img src="/logo-siipaf.png" alt="SIIPAF SA" width="160" style="max-width:60%;height:auto"><div style="height:4px;background:#d2101e;margin:20px 0"></div>
<h1 style="font-size:20px;margin:0 0 12px">${title}</h1><p style="color:#4b5563;line-height:1.6;margin:0 0 20px">${text}</p>
<a href="https://siipaf.com" style="color:#d2101e">Retour au site siipaf.com</a></div></body></html>`;
  r.get('/newsletter/unsubscribe', ah(async (req, res) => {
    const updated = await unsubscribe(String(req.query.token || ''));
    res.type('html').send(updated
      ? page('Vous êtes désinscrit(e)', 'Vous ne recevrez plus la newsletter de SIIPAF. Vous pouvez vous réinscrire à tout moment depuis le site.')
      : page('Lien de désinscription invalide', 'Ce lien n’est plus valable. Écrivez-nous à info@siipaf.com pour toute demande.'));
  }));
  r.post('/newsletter/unsubscribe', ah(async (req, res) => {
    await unsubscribe(String(req.query.token || ''));
    res.json({ ok: true });
  }));

  return r;
};
