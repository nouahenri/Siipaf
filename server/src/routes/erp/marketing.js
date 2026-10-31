/**
 * ERP · Marketing & Communication. Lecture : marketing:read ; préparation et rédaction : marketing:generate ; validation,
 * refus, planifié / publié : marketing:validate (responsable de la communication) ; réglages, arrêt d'urgence et validation
 * des campagnes : marketing:settings (Direction générale). Le serveur contrôle chaque action, un bouton masqué ne suffit pas.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { MODULE_SETTINGS } = require('../../lib/domain');
const { CHANNELS, KINDS, SEGMENTS, CAMPAIGN_STATUSES, CONTENT_STATUSES, STEPS, MODELS, addDays, mondayOf, todayStr } = require('../../lib/marketing');
const marketing = require('../../services/marketing');
const ai = require('../../services/marketingAi');
const settingsService = require('../../services/marketingSettings');
const moduleSettings = require('../../services/moduleSettings');
const { buildContext } = require('../../services/marketingContext');
const M = require('../../lib/meta');
const meta = require('../../services/meta');
const metaSettings = require('../../services/metaSettings');
const metaAudiences = require('../../services/metaAudiences');
const targeting = require('../../services/metaTargeting');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const channelEnum = z.enum(Object.keys(CHANNELS));
const optId = z.number().int().positive().nullable().optional();

const campaignSchema = z.object({
  name: z.string().trim().min(3).max(160),
  objective: z.string().trim().max(500).nullable().optional(),
  segment: z.enum(Object.keys(SEGMENTS)).default('residence_principale'),
  project_id: optId, offer_id: optId,
  cta_label: z.string().trim().max(60).nullable().optional(),
  landing_path: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_\-./]{0,150}$/, 'Page du site : nom de page sans adresse complète (ex. contact.html)').optional(),
  starts_on: day.nullable().optional(), ends_on: day.nullable().optional(),
}).refine(d => !d.starts_on || !d.ends_on || d.ends_on >= d.starts_on, { message: 'La fin précède le début.', path: ['ends_on'] });

const generateSchema = z.object({
  step: z.enum(['concept', 'contenus']),
  channels: z.array(channelEnum).max(7).optional(),
  weeks: z.number().int().min(1).max(4).optional(),
  count: z.number().int().min(1).max(30).optional(),
  mode: z.enum(['ia', 'demo']).optional(),
}).strict();

const contentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(10).max(4000),
  subject: z.string().trim().max(200).nullable(),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(12),
  cta: z.string().trim().max(200).nullable(),
  visual_idea: z.string().trim().max(800).nullable(),
  scheduled_for: day.nullable(),
}).partial().strict();

const numericFields = Object.keys(MODULE_SETTINGS.marketing);
const settingsSchema = z.object({
  ...Object.fromEntries(numericFields.map(k => [k, z.number().int().min(MODULE_SETTINGS.marketing[k].min).max(MODULE_SETTINGS.marketing[k].max)])),
  model: z.enum(Object.keys(MODELS)),
  tone: z.string().trim().max(400),
  brand_notes: z.string().trim().max(1500),
  banned_words: z.array(z.string().trim().min(1).max(60)).max(40),
  channels: z.array(channelEnum).min(1).max(7),
}).partial().strict();

module.exports = function marketingRoutes(db) {
  const r = express.Router();
  const G = requirePermission('marketing:generate');
  const V = requirePermission('marketing:validate');
  const S = requirePermission('marketing:settings');
  r.use(requirePermission('marketing:read'));
  const can = req => p => req.can(p);

  // ─── Lectures ───────────────────────────────────────────────────────────

  r.get('/badges', ah(async (req, res) => res.json(await marketing.badges(db, can(req)))));
  r.get('/dashboard', ah(async (req, res) => res.json(await marketing.dashboard(db))));

  r.get('/refs', ah(async (req, res) => {
    const [projects, offers, mode, s] = await Promise.all([
      db('projects').where({ published: true }).whereNull('archived_at').orderBy('sort').select('id', 'name', 'city', 'category'),
      db('project_offers').orderBy(['project_id', 'sort']).select('id', 'project_id', 'label'),
      ai.resolveMode(db),
      settingsService.textSettings(db),
    ]);
    res.json({
      channels: Object.fromEntries(Object.entries(CHANNELS).map(([k, c]) => [k, { label: c.label, medium: c.medium, kinds: c.kinds, limit: c.limit }])),
      kinds: KINDS, segments: SEGMENTS, campaign_statuses: CAMPAIGN_STATUSES, content_statuses: CONTENT_STATUSES, steps: STEPS,
      projects: projects.map(p => ({ ...p, offers: offers.filter(o => o.project_id === p.id).map(o => ({ id: o.id, label: o.label })) })),
      default_channels: s.channels, mode: mode.mode, mode_reason: mode.reason, week_start: addDays(mondayOf(todayStr()), 7),
    });
  }));

  r.get('/campaigns', ah(async (req, res) => res.json(await marketing.listCampaigns(db, { status: req.query.status ? String(req.query.status) : null }))));
  r.get('/campaigns/:id', ah(async (req, res) => res.json(await marketing.campaignDetail(db, idParam(req)))));

  r.get('/contents', ah(async (req, res) => {
    const q = req.query;
    res.json(await marketing.listContents(db, {
      campaignId: Number(q.campaign_id) || null, status: q.status ? String(q.status) : null, channel: q.channel ? String(q.channel) : null,
      from: /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : null, to: /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : null,
    }));
  }));
  r.get('/contents/:id', ah(async (req, res) => res.json(await marketing.contentDetail(db, idParam(req)))));

  r.get('/calendar', ah(async (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : mondayOf(todayStr());
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : addDays(from, 27);
    res.json(await marketing.calendar(db, from, to));
  }));

  /** Faits envoyés à l'IA : ce que l'IA « sait » (jamais de prospects ni de clients). */
  r.get('/facts', ah(async (req, res) => res.json(await buildContext(db, { projectId: Number(req.query.project_id) || null }))));

  r.get('/usage', ah(async (req, res) => res.json({ usage: await ai.usage(db), generations: await marketing.generationsList(db) })));

  // ─── Campagnes ──────────────────────────────────────────────────────────

  r.post('/campaigns', G, ah(async (req, res) => res.status(201).json(await marketing.createCampaign(db, parse(campaignSchema, req.body), req.user))));
  r.patch('/campaigns/:id', G, ah(async (req, res) => res.json(await marketing.updateCampaign(db, idParam(req), parse(campaignSchema.innerType().partial().strict(), req.body), req.user))));
  r.post('/campaigns/:id/generate', G, ah(async (req, res) => {
    const d = parse(generateSchema, req.body);
    const id = idParam(req);
    const mode = d.mode === 'demo' ? 'demo' : null;
    res.status(201).json(d.step === 'concept'
      ? await marketing.generateConcept(db, id, req.user, { mode })
      : await marketing.generateContents(db, id, req.user, { channels: d.channels, weeks: d.weeks || 1, count: d.count || null, mode }));
  }));
  r.post('/campaigns/:id/contents', G, ah(async (req, res) => {
    const d = parse(z.object({
      channel: channelEnum, kind: z.enum(Object.keys(KINDS)).default('post'), title: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(4000),
      subject: z.string().trim().max(200).nullable().optional(), hashtags: z.array(z.string().trim().min(1).max(60)).max(12).optional(), cta: z.string().trim().max(200).nullable().optional(),
      visual_idea: z.string().trim().max(800).nullable().optional(), scheduled_for: day.nullable().optional(),
    }).strict(), req.body);
    res.status(201).json(await marketing.createManual(db, idParam(req), d, req.user));
  }));
  r.post('/campaigns/:id/submit', G, ah(async (req, res) => res.json(await marketing.submitCampaign(db, idParam(req), req.user))));
  // Validation des campagnes : supervision de la Direction générale
  r.post('/campaigns/:id/validate', S, ah(async (req, res) => res.json(await marketing.validateCampaign(db, idParam(req), req.user))));
  r.post('/campaigns/:id/archive', S, ah(async (req, res) => res.json(await marketing.archiveCampaign(db, idParam(req), req.user))));

  // ─── Contenus ───────────────────────────────────────────────────────────

  r.patch('/contents/:id', G, ah(async (req, res) => res.json(await marketing.editContent(db, idParam(req), parse(contentSchema, req.body), req.user))));
  r.post('/contents/:id/regenerate', G, ah(async (req, res) => {
    const d = parse(z.object({ instruction: z.string().trim().max(500).optional(), mode: z.enum(['ia', 'demo']).optional() }).strict(), req.body || {});
    res.json(await marketing.regenerate(db, idParam(req), { instruction: d.instruction || null, mode: d.mode === 'demo' ? 'demo' : null }, req.user));
  }));
  r.post('/contents/:id/submit', G, ah(async (req, res) => res.json(await marketing.submitContent(db, idParam(req), req.user))));
  r.post('/contents/:id/newsletter', G, requirePermission('newsletter:campaigns'), ah(async (req, res) => res.status(201).json(await marketing.newsletterDraft(db, idParam(req), req.user))));
  r.post('/contents/:id/validate', V, ah(async (req, res) => res.json(await marketing.validateContent(db, idParam(req), req.user))));
  r.post('/contents/:id/reject', V, ah(async (req, res) => res.json(await marketing.rejectContent(db, idParam(req), parse(z.object({ reason: z.string().trim().min(3, 'Indiquez le motif du refus.').max(500) }).strict(), req.body).reason, req.user))));
  r.post('/contents/:id/schedule', V, ah(async (req, res) => res.json(await marketing.scheduleContent(db, idParam(req), parse(z.object({ scheduled_for: day }).strict(), req.body).scheduled_for, req.user))));
  r.post('/contents/:id/publish', V, ah(async (req, res) => {
    const d = parse(z.object({ published_url: z.string().trim().url().max(500).nullable().optional().or(z.literal('').transform(() => null)), published_at: day.optional() }).strict(), req.body || {});
    res.json(await marketing.publishContent(db, idParam(req), d, req.user));
  }));
  r.post('/contents/:id/archive', V, ah(async (req, res) => res.json(await marketing.archiveContent(db, idParam(req), req.user))));

  // ─── Réglages et supervision (Direction générale) ───────────────────────

  const settingsView = async () => {
    const [values, text, usage] = await Promise.all([moduleSettings.values(db, 'marketing'), settingsService.textSettings(db), ai.usage(db)]);
    return {
      values, fields: Object.fromEntries(Object.entries(MODULE_SETTINGS.marketing).map(([k, f]) => [k, { ...f, perm: undefined }])), text,
      models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { label: m.label, in: m.in, out: m.out }])), channels: Object.fromEntries(Object.entries(CHANNELS).map(([k, c]) => [k, c.label])),
      // Jamais la clé : seulement sa présence et ses 4 derniers caractères
      key: usage.key, usage,
    };
  };
  r.get('/settings', S, ah(async (req, res) => res.json(await settingsView())));
  r.put('/settings', S, ah(async (req, res) => {
    const d = parse(settingsSchema, req.body);
    const numbers = Object.fromEntries(Object.entries(d).filter(([k]) => numericFields.includes(k)));
    if (Object.keys(numbers).length) await moduleSettings.save(db, 'marketing', numbers);
    await settingsService.saveTextSettings(db, d);
    await db('marketing_events').insert({ action: 'settings', user_id: req.user.id, note: `Réglages modifiés : ${Object.keys(d).join(', ')}`.slice(0, 500) });
    res.json(await settingsView());
  }));
  r.post('/settings/emergency-stop', S, ah(async (req, res) => {
    const { active } = parse(z.object({ active: z.boolean() }).strict(), req.body);
    await settingsService.saveTextSettings(db, { emergency_stop: active });
    await db('marketing_events').insert({ action: 'settings', user_id: req.user.id, note: active ? 'Arrêt d’urgence de l’IA activé.' : 'Arrêt d’urgence de l’IA levé.' });
    res.json(await settingsView());
  }));

  // ─── Meta : connecteurs, journal, audiences (Direction générale) ─────────
  // Les secrets (jetons, secret de l'application) sont chiffrés en base et ne sont JAMAIS renvoyés : présence et 4 derniers caractères seulement.

  r.get('/meta/overview', ah(async (req, res) => res.json(await meta.overview(db))));
  r.get('/meta/settings', S, ah(async (req, res) => res.json(await metaSettings.view(db))));
  r.put('/meta/settings', S, ah(async (req, res) => {
    const patch = parse(M.settingsPatchSchema, req.body);
    const changed = await metaSettings.save(db, patch);
    // Le journal garde les noms des réglages modifiés, jamais leurs valeurs
    if (changed.length) await db('marketing_events').insert({ action: 'settings', user_id: req.user.id, note: `Connecteurs Meta modifiés : ${changed.join(', ')}`.slice(0, 500) });
    res.json(await metaSettings.view(db));
  }));
  r.post('/meta/test', S, ah(async (req, res) => res.json(await meta.testConnection(db, req.user))));
  r.post('/meta/subscribe', S, ah(async (req, res) => res.json(await meta.subscribe(db, req.user))));
  r.get('/meta/events', S, ah(async (req, res) => res.json(await meta.events(db, { kind: req.query.kind ? String(req.query.kind) : null, limit: Number(req.query.limit) || 60 }))));

  const scopeSchema = z.enum(Object.keys(metaAudiences.SCOPES));
  r.get('/meta/audiences', S, ah(async (req, res) => {
    const creds = await metaSettings.credentials(db);
    res.json({
      scopes: await metaAudiences.preview(db), audiences: await metaAudiences.list(db), min_lookalike: metaAudiences.MIN_LOOKALIKE,
      connected: !!(creds.ad_account_id && (creds.ads_token || creds.page_token)),
      interactions: Object.entries(metaAudiences.INTERACTIONS).map(([key, d]) => ({ key, label: d.label, ready: !!creds[d.needs], needs: M.ID_FIELDS[d.needs] })),
    });
  }));
  r.get('/meta/audiences/export.csv', S, ah(async (req, res) => {
    const out = await metaAudiences.exportCsv(db, parse(scopeSchema, String(req.query.scope || 'tous')), req.user);
    res.set('Cache-Control', 'no-store').type('text/csv').attachment(out.filename).send(out.csv);
  }));
  r.post('/meta/audiences/upload', S, ah(async (req, res) => {
    const d = parse(z.object({ scope: scopeSchema, name: z.string().trim().max(120).optional() }).strict(), req.body);
    res.status(201).json(await metaAudiences.uploadList(db, d, req.user));
  }));
  r.post('/meta/audiences/interaction', S, ah(async (req, res) => {
    const d = parse(z.object({ preset: z.enum(Object.keys(metaAudiences.INTERACTIONS)) }).strict(), req.body);
    res.status(201).json(await metaAudiences.createInteraction(db, d.preset, req.user));
  }));
  r.post('/meta/audiences/:id/lookalike', S, ah(async (req, res) => {
    const d = parse(z.object({ country: z.string().regex(/^[A-Z]{2}$/, 'Code pays à deux lettres (ex. CI)').default('CI'), ratio: z.number().min(0.01).max(0.2).default(0.01) }).strict(), req.body || {});
    res.status(201).json(await metaAudiences.createLookalike(db, idParam(req), d, req.user));
  }));

  // ─── Ciblage Meta et annonces d'une campagne (l'IA propose, la responsable de la communication valide) ─────

  r.get('/campaigns/:id/targetings', ah(async (req, res) => res.json(await targeting.list(db, idParam(req)))));
  r.post('/campaigns/:id/targetings/generate', G, ah(async (req, res) => {
    const d = parse(z.object({ mode: z.enum(['ia', 'demo']).optional() }).strict(), req.body || {});
    res.status(201).json(await targeting.generate(db, idParam(req), req.user, { mode: d.mode === 'demo' ? 'demo' : null }));
  }));
  r.patch('/targetings/:id', G, ah(async (req, res) => {
    const d = parse(z.object({ params: M.targetingParamsSchema.optional(), ads: z.array(M.adSchema).min(1).max(5).optional(), rationale: z.string().trim().max(800).nullable().optional() }).strict(), req.body);
    res.json(await targeting.edit(db, idParam(req), d, req.user));
  }));
  r.post('/targetings/:id/submit', G, ah(async (req, res) => res.json(await targeting.submit(db, idParam(req), req.user))));
  r.post('/targetings/:id/validate', V, ah(async (req, res) => res.json(await targeting.validate(db, idParam(req), req.user))));
  r.post('/targetings/:id/reject', V, ah(async (req, res) => res.json(await targeting.reject(db, idParam(req), parse(z.object({ reason: z.string().trim().min(3, 'Indiquez le motif du refus.').max(500) }).strict(), req.body).reason, req.user))));
  r.post('/targetings/:id/archive', V, ah(async (req, res) => res.json(await targeting.archive(db, idParam(req), req.user))));

  r.use((req, res, next) => next(new HttpError(404, 'Route inconnue.')));
  return r;
};
