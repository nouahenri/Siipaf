/**
 * ERP · Marketing & Communication (mission A4 de docs/strategie-commercial-ia-siipaf.md). L'IA est le « responsable
 * marketing » : elle prépare seule, chaque semaine (tick horaire) ou à la demande, le calendrier éditorial et les contenus.
 * La responsable de la communication relit, ajuste, valide puis marque planifié ou publié ; la Direction générale supervise
 * (dépenses, arrêt d'urgence, validation des campagnes). Aucune publication automatique : tout contenu passe par une validation humaine.
 * Statuts d'un contenu : brouillon → à valider → validé → planifié ou publié → archivé (un refus revient en brouillon avec son motif ;
 * modifier un contenu validé crée une nouvelle version et le remet à valider).
 */
const { HttpError, json, isoDay, isoTime } = require('../lib/http');
const { CLIENT_STAGES } = require('../lib/domain');
const {
  CHANNELS, KINDS, SEGMENTS, CAMPAIGN_STATUSES, CONTENT_STATUSES, STEPS, MODELS, contentsSchema, conceptSchema, checkContent, withConsentFooter,
  mondayOf, addDays, todayStr, weekday, campaignCode,
} = require('../lib/marketing');
const prompts = require('../lib/marketingPrompts');
const settingsService = require('./marketingSettings');
const ai = require('./marketingAi');
const templates = require('./marketingTemplates');
const { buildContext } = require('./marketingContext');
const { inform, notify } = require('./notifications');

const SITE_URL = (process.env.SITE_URL || 'https://siipaf.com').replace(/\/$/, '');
const insertedId = r => (typeof r === 'object' ? r.id : r);
const clip = (v, n) => (v == null || v === '' ? null : String(v).trim().slice(0, n) || null);

// ─── Journal ──────────────────────────────────────────────────────────────

const logEvent = (db, { campaignId = null, contentId = null, action, user = null, ai: isAi = false, note = null }) =>
  db('marketing_events').insert({ campaign_id: campaignId, content_id: contentId, action, user_id: user?.id || null, is_ai: !!isAi, note: clip(note, 500) });

// ─── Lien suivi ───────────────────────────────────────────────────────────

/** {site}/{page}?utm_source={canal}&utm_medium=social|email|messagerie&utm_campaign={code}&utm_content={contenu}. */
function trackedLink(campaign, content) {
  const page = String(campaign.landing_path || 'contact.html').replace(/^\/+/, '');
  const q = new URLSearchParams({ utm_source: content.channel, utm_medium: CHANNELS[content.channel]?.medium || 'autre', utm_campaign: campaign.code, utm_content: String(content.id) });
  return `${SITE_URL}/${page}${page.includes('?') ? '&' : '?'}${q.toString()}`;
}

/** Suivi des prospects : campagne retrouvée par son code (utm_campaign), écrite à la création de la fiche seulement. */
async function resolveUtm(db, utm) {
  const code = String(utm?.campaign || '').trim().toLowerCase().slice(0, 60);
  if (!code) return null;
  const c = await db('marketing_campaigns').whereRaw('LOWER(code) = ?', [code]).first('id');
  if (!c) return null;
  return { campaign_id: c.id, utm_medium: clip(utm.medium, 40), utm_content: clip(utm.content, 80) };
}

// ─── Campagnes ────────────────────────────────────────────────────────────

const serializeCampaign = (c, extra = {}) => ({
  id: c.id, code: c.code, name: c.name, objective: c.objective, segment: c.segment, segment_label: SEGMENTS[c.segment] || c.segment,
  project_id: c.project_id, offer_id: c.offer_id, cta_label: c.cta_label, landing_path: c.landing_path, status: c.status, status_label: CAMPAIGN_STATUSES[c.status],
  permanent: !!c.permanent, starts_on: isoDay(c.starts_on), ends_on: isoDay(c.ends_on), concept: json(c.concept), created_by: c.created_by,
  validated_by: c.validated_by, validated_at: isoTime(c.validated_at), created_at: isoTime(c.created_at), ...extra,
});

async function requireCampaign(db, id) {
  const c = await db('marketing_campaigns').where({ id }).first();
  if (!c) throw new HttpError(404, 'Campagne introuvable.');
  return c;
}

/** Ligne éditoriale permanente : la campagne de fond que l'IA alimente chaque semaine, supervisée par la Direction générale. */
async function ensurePermanent(db) {
  const found = await db('marketing_campaigns').where({ permanent: true }).first();
  if (found) return found;
  const [id] = await db('marketing_campaigns').insert({
    code: 'ligne-editoriale', name: 'Ligne éditoriale SIIPAF', permanent: true, status: 'validee', segment: 'residence_principale', landing_path: 'projets.html',
    objective: 'Présence régulière et factuelle de SIIPAF : programmes, points de chantier publiés, conditions d’acquisition, témoignages autorisés.', cta_label: 'Découvrir nos programmes',
  });
  await logEvent(db, { campaignId: insertedId(id), action: 'propose', ai: true, note: 'Ligne éditoriale permanente créée par l’IA.' });
  return db('marketing_campaigns').where({ id: insertedId(id) }).first();
}

async function uniqueCode(db, name) {
  const base = campaignCode(name);
  let code = base;
  for (let i = 2; await db('marketing_campaigns').where({ code }).first('id'); i++) code = `${base.slice(0, 55)}-${i}`;
  return code;
}

async function checkLinks(db, { project_id, offer_id }) {
  if (project_id && !(await db('projects').where({ id: project_id }).first('id'))) throw new HttpError(400, 'Programme inconnu.');
  if (offer_id) {
    const o = await db('project_offers').where({ id: offer_id }).first('project_id');
    if (!o) throw new HttpError(400, 'Offre inconnue.');
    if (project_id && o.project_id !== project_id) throw new HttpError(400, 'Cette offre n’appartient pas au programme choisi.');
  }
}

async function createCampaign(db, data, user) {
  await checkLinks(db, data);
  const id = insertedId((await db('marketing_campaigns').insert({
    code: await uniqueCode(db, data.name), name: data.name, objective: data.objective || null, segment: data.segment, project_id: data.project_id || null,
    offer_id: data.offer_id || null, cta_label: data.cta_label || null, landing_path: data.landing_path || 'contact.html', starts_on: data.starts_on || null,
    ends_on: data.ends_on || null, status: 'brouillon', created_by: user.id,
  }))[0]);
  await logEvent(db, { campaignId: id, action: 'propose', user, note: 'Campagne créée.' });
  return serializeCampaign(await requireCampaign(db, id));
}

async function updateCampaign(db, id, data, user) {
  const c = await requireCampaign(db, id);
  if (c.status === 'archivee') throw new HttpError(409, 'Une campagne archivée ne se modifie plus.');
  await checkLinks(db, { project_id: data.project_id === undefined ? c.project_id : data.project_id, offer_id: data.offer_id === undefined ? c.offer_id : data.offer_id });
  const patch = { updated_at: new Date() };
  for (const k of ['name', 'objective', 'segment', 'project_id', 'offer_id', 'cta_label', 'landing_path', 'starts_on', 'ends_on']) if (data[k] !== undefined) patch[k] = data[k] === '' ? null : data[k];
  // Une campagne validée dont le brief change repart à la validation de la Direction (la ligne permanente reste validée)
  if (c.status === 'validee' && !c.permanent && ['name', 'objective', 'segment', 'project_id', 'offer_id', 'cta_label', 'landing_path'].some(k => data[k] !== undefined && data[k] !== c[k])) {
    Object.assign(patch, { status: 'brouillon', validated_by: null, validated_at: null });
  }
  await db('marketing_campaigns').where({ id }).update(patch);
  await logEvent(db, { campaignId: id, action: 'edit', user, note: patch.status === 'brouillon' ? 'Brief modifié : campagne à resoumettre à la Direction.' : 'Campagne modifiée.' });
  return serializeCampaign(await requireCampaign(db, id));
}

async function submitCampaign(db, id, user) {
  const c = await requireCampaign(db, id);
  if (c.status !== 'brouillon') throw new HttpError(409, 'Seule une campagne en brouillon peut être soumise.');
  await db('marketing_campaigns').where({ id }).update({ status: 'a_valider', updated_at: new Date() });
  await logEvent(db, { campaignId: id, action: 'submit', user });
  await inform(db, 'marketing.campagne_a_valider', {
    title: `Campagne « ${c.name} » à valider`, body: `${SEGMENTS[c.segment]} — soumise par ${user.name}`, link: `/marketing/campagnes/${id}`, key: `marketing-campagne:${id}:${Date.now()}`, except: user.id,
  });
  return serializeCampaign(await requireCampaign(db, id));
}

async function validateCampaign(db, id, user) {
  const c = await requireCampaign(db, id);
  if (!['brouillon', 'a_valider'].includes(c.status)) throw new HttpError(409, 'Cette campagne est déjà validée ou archivée.');
  await db('marketing_campaigns').where({ id }).update({ status: 'validee', validated_by: user.id, validated_at: new Date(), updated_at: new Date() });
  await logEvent(db, { campaignId: id, action: 'validate', user });
  if (c.created_by && c.created_by !== user.id) {
    await notify(db, { to: [c.created_by], module: 'marketing', event: 'marketing.valide', title: `Campagne « ${c.name} » validée`, link: `/marketing/campagnes/${id}`, key: `marketing-campagne-ok:${id}`, except: user.id });
  }
  return serializeCampaign(await requireCampaign(db, id));
}

async function archiveCampaign(db, id, user) {
  const c = await requireCampaign(db, id);
  await db('marketing_campaigns').where({ id }).update({ status: 'archivee', updated_at: new Date() });
  await logEvent(db, { campaignId: id, action: 'archive', user });
  return serializeCampaign(c.status === 'archivee' ? c : await requireCampaign(db, id));
}

// ─── Contenus ─────────────────────────────────────────────────────────────

const contentQuery = db => db('marketing_contents as c').join('marketing_campaigns as k', 'k.id', 'c.campaign_id')
  .leftJoin('marketing_content_versions as v', 'v.id', 'c.current_version_id')
  .select('c.*', 'k.name as campaign_name', 'k.code as campaign_code', 'k.landing_path', 'k.status as campaign_status', 'k.project_id as campaign_project_id',
    'v.version_no', 'v.body', 'v.subject', 'v.hashtags', 'v.cta', 'v.visual_idea', 'v.origin', 'v.fact_refs', 'v.edited_by as version_editor');

const serializeContent = row => ({
  id: row.id, campaign_id: row.campaign_id, campaign_name: row.campaign_name, campaign_code: row.campaign_code, campaign_status: row.campaign_status,
  channel: row.channel, channel_label: CHANNELS[row.channel]?.label || row.channel, kind: row.kind, kind_label: KINDS[row.kind] || row.kind, title: row.title,
  status: row.status, status_label: CONTENT_STATUSES[row.status], scheduled_for: isoDay(row.scheduled_for), published_at: isoTime(row.published_at),
  published_url: row.published_url, reject_reason: row.reject_reason, warnings: json(row.warnings, []), created_by: row.created_by, validated_by: row.validated_by,
  validated_at: isoTime(row.validated_at), version_no: row.version_no, origin: row.origin, body: row.body, subject: row.subject, hashtags: json(row.hashtags, []),
  cta: row.cta, visual_idea: row.visual_idea, fact_refs: json(row.fact_refs, []),
  link: trackedLink({ code: row.campaign_code, landing_path: row.landing_path }, row),
});

async function requireContent(db, id) {
  const row = await contentQuery(db).where('c.id', id).first();
  if (!row) throw new HttpError(404, 'Contenu introuvable.');
  return row;
}

async function addVersion(trx, contentId, v, { origin, generationId = null, user = null }) {
  const [{ max }] = await trx('marketing_content_versions').where({ content_id: contentId }).max({ max: 'version_no' });
  const versionNo = Number(max || 0) + 1;
  const vid = insertedId((await trx('marketing_content_versions').insert({
    content_id: contentId, version_no: versionNo, body: v.body, subject: clip(v.subject, 200), hashtags: JSON.stringify(v.hashtags || []), cta: clip(v.cta, 200),
    visual_idea: v.visual_idea || null, origin, generation_id: generationId, fact_refs: JSON.stringify(v.fact_refs || []), edited_by: user?.id || null,
  }))[0]);
  await trx('marketing_contents').where({ id: contentId }).update({ current_version_id: vid, updated_at: new Date() });
  return { id: vid, version_no: versionNo };
}

/** Avertissements d'un texte : montants et pourcentages hors catalogue, fausse urgence, promesse de gain, mot interdit. */
async function warningsFor(db, version, projectId) {
  const { facts } = await buildContext(db, { projectId });
  return checkContent(version, facts, { banned: (await settingsService.textSettings(db)).banned_words });
}

async function createContent(db, campaign, item, { origin, generationId, user = null }) {
  const channel = item.channel;
  const kind = CHANNELS[channel].kinds.includes(item.kind) ? item.kind : CHANNELS[channel].kinds[0];
  const version = { ...item, body: withConsentFooter(channel, item.body), hashtags: item.hashtags || [] };
  const warnings = await warningsFor(db, version, campaign.project_id);
  return db.transaction(async trx => {
    const id = insertedId((await trx('marketing_contents').insert({
      campaign_id: campaign.id, channel, kind, title: item.title.slice(0, 200), status: warnings.length ? 'brouillon' : 'a_valider',
      scheduled_for: item.scheduled_for || null, warnings: JSON.stringify(warnings), created_by: user?.id || null,
    }))[0]);
    await addVersion(trx, id, version, { origin, generationId, user });
    await trx('marketing_events').insert({ campaign_id: campaign.id, content_id: id, action: 'propose', user_id: user?.id || null, is_ai: origin !== 'humain', note: warnings.length ? `${warnings.length} avertissement(s)` : null });
    return { id, status: warnings.length ? 'brouillon' : 'a_valider' };
  });
}

/** Retours de la responsable (motifs de refus récents) donnés à l'IA pour qu'elle s'améliore. */
async function feedbackFor(db, campaignId) {
  const rows = await db('marketing_contents').where({ campaign_id: campaignId }).whereNotNull('reject_reason').orderBy('updated_at', 'desc').limit(5).select('channel', 'reject_reason');
  return rows.map(r => `${CHANNELS[r.channel]?.label || r.channel} : ${String(r.reject_reason).slice(0, 300)}`);
}

async function notifyToValidate(db, count, { key, user = null, what = 'préparé(s) par l’IA' }) {
  if (!count) return 0;
  return inform(db, 'marketing.a_valider', {
    title: `${count} contenu${count > 1 ? 's' : ''} ${what}, à valider`, body: 'Relisez, ajustez et validez dans la bibliothèque de contenus.',
    link: '/marketing/contenus?statut=a_valider', key, except: user?.id || null,
  });
}

const textIssue = e => new HttpError(400, e);

/** Concept de campagne (angle, message clé, preuves) : enregistré dans la campagne, à relire par la Direction. */
async function generateConcept(db, campaignId, user, { mode = null } = {}) {
  const campaign = await requireCampaign(db, campaignId);
  if (campaign.status === 'archivee') throw new HttpError(409, 'Une campagne archivée ne se prépare plus.');
  const { facts } = await buildContext(db, { projectId: campaign.project_id });
  const s = await settingsService.all(db);
  const run = await ai.run(db, {
    step: 'concept', campaign, user, forced: mode, facts, schema: conceptSchema,
    system: prompts.systemPrompt({ tone: s.tone, brandNotes: s.brand_notes, banned: s.banned_words }),
    prompt: prompts.conceptPrompt({ campaign: serializeCampaign(campaign), facts, feedback: await feedbackFor(db, campaignId) }),
    demo: () => templates.demoConcept({ campaign, facts }),
  });
  await db('marketing_campaigns').where({ id: campaignId }).update({ concept: JSON.stringify(run.output), updated_at: new Date() });
  await logEvent(db, { campaignId, action: 'propose', ai: true, user, note: `Concept ${run.mode === 'ia' ? 'préparé par l’IA' : 'de démonstration'}.` });
  return { generation_id: run.generation_id, mode: run.mode, concept: run.output };
}

/**
 * Calendrier éditorial et contenus : `count` contenus répartis sur les canaux, de `from` à `to`. L'IA prépare, l'humain valide :
 * un contenu sans avertissement arrive « à valider », avec avertissement il reste en brouillon (soumission bloquée).
 */
async function generateContents(db, campaignId, user, { channels = null, weeks = 1, count = null, mode = null, step = 'contenus', from = null, weekOf = null } = {}) {
  const campaign = await requireCampaign(db, campaignId);
  if (campaign.status === 'archivee') throw new HttpError(409, 'Une campagne archivée ne se prépare plus.');
  const s = await settingsService.all(db);
  const chosen = (channels && channels.length ? channels : s.channels).filter(c => CHANNELS[c]);
  if (!chosen.length) throw textIssue('Choisissez au moins un canal.');
  const start = from || addDays(todayStr(), 1);
  const end = addDays(start, 7 * weeks - 1);
  const total = Math.min(30, count || s.marketing_posts_per_week * weeks);
  const { facts } = await buildContext(db, { projectId: campaign.project_id });
  const existing = (await db('marketing_contents').where({ campaign_id: campaignId }).whereNot('status', 'archive').whereBetween('scheduled_for', [start, end]).select('channel', 'title', 'scheduled_for'))
    .map(e => ({ canal: e.channel, titre: e.title, jour: isoDay(e.scheduled_for) }));
  const run = await ai.run(db, {
    step, campaign, user, forced: mode, weekOf, facts, schema: contentsSchema,
    system: prompts.systemPrompt({ tone: s.tone, brandNotes: s.brand_notes, banned: s.banned_words }),
    prompt: prompts.contentsPrompt({ campaign: serializeCampaign(campaign), facts, channels: chosen, from: start, to: end, count: total, feedback: await feedbackFor(db, campaignId), existing }),
    demo: () => templates.demoContents({ campaign, facts, channels: chosen, from: start, count: total, weeks }),
  });
  const origin = run.mode === 'ia' ? 'ia' : 'demo';
  const created = [];
  let skipped = 0;
  for (const item of run.output.items) {
    if (!chosen.includes(item.channel)) { skipped++; continue; } // canal non demandé : écarté
    const day = item.scheduled_for && item.scheduled_for >= start && item.scheduled_for <= end ? item.scheduled_for : null;
    created.push(await createContent(db, campaign, { ...item, scheduled_for: day }, { origin, generationId: run.generation_id, user: null }));
  }
  await logEvent(db, { campaignId, action: 'propose', ai: true, user, note: `${created.length} contenu(x) ${origin === 'ia' ? 'préparé(s) par l’IA' : 'de démonstration'} (${STEPS[step].toLowerCase()}).` });
  const toValidate = created.filter(c => c.status === 'a_valider').length;
  await notifyToValidate(db, toValidate, { key: `marketing-valider:gen:${run.generation_id}`, user, what: origin === 'ia' ? 'préparé(s) par l’IA' : 'de démonstration préparé(s)' });
  return { generation_id: run.generation_id, mode: run.mode, cost_micro_usd: run.cost_micro_usd, created: created.map(c => c.id), to_validate: toValidate, skipped, from: start, to: end };
}

/** Nouvelle version d'un contenu rédigée par l'IA (ou le gabarit) selon la consigne de la responsable. */
async function regenerate(db, id, { instruction = null, mode = null }, user) {
  const row = await requireContent(db, id);
  guardEditable(row);
  const campaign = await requireCampaign(db, row.campaign_id);
  const { facts } = await buildContext(db, { projectId: campaign.project_id });
  const s = await settingsService.all(db);
  const current = serializeContent(row);
  const run = await ai.run(db, {
    step: 'variante', campaign, content: row, user, forced: mode, facts, schema: contentsSchema,
    system: prompts.systemPrompt({ tone: s.tone, brandNotes: s.brand_notes, banned: s.banned_words }),
    prompt: prompts.variantPrompt({ campaign: serializeCampaign(campaign), facts, content: { canal: current.channel, type: current.kind, titre: current.title, texte: current.body, objet: current.subject }, instruction, feedback: await feedbackFor(db, campaign.id) }),
    demo: () => templates.demoVariant({ campaign, facts, content: { ...current, variant_index: Number(row.version_no) } }),
  });
  const item = run.output.items[0];
  return applyVersion(db, row, { ...item, channel: row.channel, scheduled_for: undefined }, { origin: run.mode === 'ia' ? 'ia' : 'demo', generationId: run.generation_id, user, action: 'edit', note: instruction ? `Nouvelle version demandée : ${instruction.slice(0, 200)}` : 'Nouvelle version demandée.' });
}

const guardEditable = row => {
  if (['publie', 'archive'].includes(row.status)) throw new HttpError(409, row.status === 'publie' ? 'Ce contenu est publié : créez-en un nouveau ou archivez-le.' : 'Ce contenu est archivé.');
  if (row.campaign_status === 'archivee') throw new HttpError(409, 'La campagne de ce contenu est archivée.');
};

/** Écrit une nouvelle version et replace le contenu dans le bon statut (modifié après validation : retour à valider). */
async function applyVersion(db, row, data, { origin, generationId = null, user, action, note }) {
  const next = {
    body: data.body ?? row.body, subject: data.subject === undefined ? row.subject : data.subject, hashtags: data.hashtags ?? json(row.hashtags, []),
    cta: data.cta === undefined ? row.cta : data.cta, visual_idea: data.visual_idea === undefined ? row.visual_idea : data.visual_idea,
    fact_refs: data.fact_refs ?? json(row.fact_refs, []),
  };
  next.body = withConsentFooter(row.channel, next.body);
  const warnings = await warningsFor(db, next, row.campaign_project_id);
  const wasValidated = ['valide', 'planifie'].includes(row.status);
  // Modifié après validation : nouvelle version et retour à valider ; avec avertissement, retour en brouillon (soumission bloquée)
  const status = warnings.length ? 'brouillon' : wasValidated || (row.status === 'brouillon' && origin !== 'humain') ? 'a_valider' : row.status;
  await db.transaction(async trx => {
    await addVersion(trx, row.id, next, { origin, generationId, user });
    await trx('marketing_contents').where({ id: row.id }).update({
      status, warnings: JSON.stringify(warnings), reject_reason: null,
      ...(data.title ? { title: data.title.slice(0, 200) } : {}), ...(wasValidated ? { validated_by: null, validated_at: null } : {}),
      ...(data.scheduled_for !== undefined ? { scheduled_for: data.scheduled_for || null } : {}), updated_at: new Date(),
    });
    await trx('marketing_events').insert({ campaign_id: row.campaign_id, content_id: row.id, action, user_id: user?.id || null, is_ai: origin !== 'humain', note: clip(wasValidated ? `${note} Contenu validé modifié : à valider de nouveau.` : note, 500) });
  });
  if (status === 'a_valider' && row.status !== 'a_valider') await notifyToValidate(db, 1, { key: `marketing-valider:v:${row.id}:${Date.now()}`, user, what: wasValidated ? 'modifié après validation' : 'proposé par l’IA' });
  return serializeContent(await requireContent(db, row.id));
}

/** Contenu rédigé à la main par un compte (brouillon, à soumettre) : le proposant est le compte. */
async function createManual(db, campaignId, data, user) {
  const campaign = await requireCampaign(db, campaignId);
  if (campaign.status === 'archivee') throw new HttpError(409, 'Une campagne archivée ne se prépare plus.');
  const kind = CHANNELS[data.channel].kinds.includes(data.kind) ? data.kind : CHANNELS[data.channel].kinds[0];
  const version = { ...data, body: withConsentFooter(data.channel, data.body), hashtags: data.hashtags || [] };
  const warnings = await warningsFor(db, version, campaign.project_id);
  const id = await db.transaction(async trx => {
    const cid = insertedId((await trx('marketing_contents').insert({
      campaign_id: campaignId, channel: data.channel, kind, title: data.title.slice(0, 200), status: 'brouillon', scheduled_for: data.scheduled_for || null,
      warnings: JSON.stringify(warnings), created_by: user.id,
    }))[0]);
    await addVersion(trx, cid, version, { origin: 'humain', user });
    await trx('marketing_events').insert({ campaign_id: campaignId, content_id: cid, action: 'propose', user_id: user.id, is_ai: false, note: 'Contenu rédigé à la main.' });
    return cid;
  });
  return serializeContent(await requireContent(db, id));
}

/** Modification par un humain : texte (nouvelle version) ou simples réglages (titre, jour) sans nouvelle version. */
async function editContent(db, id, data, user) {
  const row = await requireContent(db, id);
  guardEditable(row);
  const textual = ['body', 'subject', 'hashtags', 'cta', 'visual_idea'].filter(k => data[k] !== undefined && JSON.stringify(data[k]) !== JSON.stringify(k === 'hashtags' ? json(row.hashtags, []) : row[k]));
  if (!textual.length) {
    const patch = { updated_at: new Date() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.scheduled_for !== undefined) patch.scheduled_for = data.scheduled_for || null;
    await db('marketing_contents').where({ id }).update(patch);
    await logEvent(db, { campaignId: row.campaign_id, contentId: id, action: 'edit', user, note: 'Titre ou jour de publication modifié.' });
    return serializeContent(await requireContent(db, id));
  }
  return applyVersion(db, row, data, { origin: 'humain', user, action: 'edit', note: 'Texte modifié.' });
}

async function submitContent(db, id, user) {
  const row = await requireContent(db, id);
  if (row.status !== 'brouillon') throw new HttpError(409, 'Seul un brouillon peut être soumis à validation.');
  guardEditable(row);
  const warnings = await warningsFor(db, { ...row, hashtags: json(row.hashtags, []) }, row.campaign_project_id);
  await db('marketing_contents').where({ id }).update({ warnings: JSON.stringify(warnings), updated_at: new Date() });
  if (warnings.length) throw new HttpError(409, 'Ce contenu comporte des avertissements : corrigez-les avant de le soumettre.', { warnings });
  await db('marketing_contents').where({ id }).update({ status: 'a_valider', reject_reason: null });
  await logEvent(db, { campaignId: row.campaign_id, contentId: id, action: 'submit', user });
  await notifyToValidate(db, 1, { key: `marketing-valider:c:${id}:${Date.now()}`, user, what: `soumis par ${user.name}` });
  return serializeContent(await requireContent(db, id));
}

/** Humains ayant proposé ou rédigé le contenu (l'IA n'a pas de compte : son retour passe par le journal et les consignes suivantes). */
const proposers = row => [...new Set([row.created_by, row.version_editor].filter(Boolean))];

async function validateContent(db, id, user) {
  const row = await requireContent(db, id);
  if (row.status !== 'a_valider') throw new HttpError(409, 'Seul un contenu « à valider » peut être validé.');
  const warnings = await warningsFor(db, { ...row, hashtags: json(row.hashtags, []) }, row.campaign_project_id);
  if (warnings.length) {
    await db('marketing_contents').where({ id }).update({ warnings: JSON.stringify(warnings), status: 'brouillon' });
    throw new HttpError(409, 'Ce contenu comporte des avertissements : corrigez-les avant de le valider.', { warnings });
  }
  await db('marketing_contents').where({ id }).update({ status: 'valide', validated_by: user.id, validated_at: new Date(), warnings: JSON.stringify([]), reject_reason: null, updated_at: new Date() });
  await logEvent(db, { campaignId: row.campaign_id, contentId: id, action: 'validate', user, note: row.origin !== 'humain' ? `Version ${row.version_no} préparée par ${row.origin === 'ia' ? 'l’IA' : 'un gabarit de démonstration'}.` : null });
  await inform(db, 'marketing.valide', { direct: proposers(row), title: `Contenu validé : ${row.title}`, body: `${CHANNELS[row.channel].label} — validé par ${user.name}`, link: `/marketing/contenus?fiche=${id}`, key: `marketing-valide:${id}:${row.version_no}`, except: user.id });
  return serializeContent(await requireContent(db, id));
}

async function rejectContent(db, id, reason, user) {
  const row = await requireContent(db, id);
  if (!['a_valider', 'valide'].includes(row.status)) throw new HttpError(409, 'Seul un contenu à valider ou validé peut être refusé.');
  await db('marketing_contents').where({ id }).update({ status: 'brouillon', reject_reason: reason.slice(0, 500), validated_by: null, validated_at: null, updated_at: new Date() });
  await logEvent(db, { campaignId: row.campaign_id, contentId: id, action: 'reject', user, note: reason });
  await inform(db, 'marketing.refuse', { direct: proposers(row), title: `Contenu refusé : ${row.title}`, body: reason, link: `/marketing/contenus?fiche=${id}`, key: `marketing-refuse:${id}:${row.version_no}:${Date.now()}`, except: user.id });
  return serializeContent(await requireContent(db, id));
}

const needValidated = (row, what) => {
  if (!['valide', 'planifie'].includes(row.status)) throw new HttpError(409, `Un contenu doit être validé avant d’être ${what}.`);
  if (row.campaign_status !== 'validee') throw new HttpError(409, `La campagne n’est pas validée par la Direction générale : le contenu ne peut pas être ${what}.`);
};

async function scheduleContent(db, id, scheduledFor, user) {
  const row = await requireContent(db, id);
  if (row.status !== 'valide' && row.status !== 'planifie') throw new HttpError(409, 'Un contenu doit être validé avant d’être planifié.');
  needValidated(row, 'planifié');
  await db('marketing_contents').where({ id }).update({ status: 'planifie', scheduled_for: scheduledFor, updated_at: new Date() });
  await logEvent(db, { campaignId: row.campaign_id, contentId: id, action: 'schedule', user, note: `Planifié le ${scheduledFor} (publication faite à la main ou dans l’outil de la marque).` });
  return serializeContent(await requireContent(db, id));
}

async function publishContent(db, id, { published_url = null, published_at = null }, user) {
  const row = await requireContent(db, id);
  if (!['valide', 'planifie'].includes(row.status)) throw new HttpError(409, 'Un contenu doit être validé avant d’être marqué publié.');
  needValidated(row, 'marqué publié');
  await db('marketing_contents').where({ id }).update({ status: 'publie', published_at: published_at ? new Date(published_at) : new Date(), published_url: published_url || null, updated_at: new Date() });
  await logEvent(db, { campaignId: row.campaign_id, contentId: id, action: 'publish', user, note: published_url });
  return serializeContent(await requireContent(db, id));
}

async function archiveContent(db, id, user) {
  const row = await requireContent(db, id);
  await db('marketing_contents').where({ id }).update({ status: 'archive', updated_at: new Date() });
  await logEvent(db, { campaignId: row.campaign_id, contentId: id, action: 'archive', user });
  return serializeContent(await requireContent(db, id));
}

/** Brouillon de la newsletter existante (canal e-mail) : l'envoi reste celui du module Newsletter, avec son désabonnement. */
async function newsletterDraft(db, id, user) {
  const row = await requireContent(db, id);
  if (row.channel !== 'email') throw new HttpError(409, 'Seul un contenu du canal e-mail peut devenir une newsletter.');
  if (!['valide', 'planifie', 'publie'].includes(row.status)) throw new HttpError(409, 'Validez le contenu avant de créer le brouillon de newsletter.');
  const campaign = await requireCampaign(db, row.campaign_id);
  const [nid] = await db('newsletter_campaigns').insert({
    subject: (row.subject || row.title).slice(0, 160), heading: row.title.slice(0, 200), body: row.body, cta_label: clip(campaign.cta_label || 'En savoir plus', 60),
    cta_url: trackedLink(campaign, row).slice(0, 500), status: 'brouillon', created_by: user.id,
  });
  await logEvent(db, { campaignId: row.campaign_id, contentId: id, action: 'schedule', user, note: `Brouillon de newsletter n° ${insertedId(nid)} créé.` });
  return { newsletter_id: insertedId(nid) };
}

// ─── Lectures ─────────────────────────────────────────────────────────────

async function listContents(db, { campaignId = null, status = null, channel = null, from = null, to = null, limit = 300 } = {}) {
  const q = contentQuery(db).orderBy([{ column: 'c.scheduled_for', order: 'asc' }, { column: 'c.id', order: 'desc' }]).limit(Math.min(Number(limit) || 300, 500));
  if (campaignId) q.where('c.campaign_id', campaignId);
  if (status) q.where('c.status', status);
  if (channel) q.where('c.channel', channel);
  if (from) q.where('c.scheduled_for', '>=', from);
  if (to) q.where('c.scheduled_for', '<=', to);
  return (await q).map(serializeContent);
}

async function contentDetail(db, id) {
  const row = await requireContent(db, id);
  const [versions, events] = await Promise.all([
    db('marketing_content_versions as v').leftJoin('users as u', 'u.id', 'v.edited_by').where('v.content_id', id).orderBy('v.version_no', 'desc')
      .select('v.id', 'v.version_no', 'v.body', 'v.subject', 'v.hashtags', 'v.cta', 'v.visual_idea', 'v.origin', 'v.created_at', 'u.name as edited_by_name'),
    db('marketing_events as e').leftJoin('users as u', 'u.id', 'e.user_id').where('e.content_id', id).orderBy('e.id', 'desc').select('e.action', 'e.is_ai', 'e.note', 'e.created_at', 'u.name as user_name'),
  ]);
  return {
    ...serializeContent(row),
    versions: versions.map(v => ({ ...v, hashtags: json(v.hashtags, []), created_at: isoTime(v.created_at) })),
    events: events.map(e => ({ action: e.action, is_ai: !!e.is_ai, note: e.note, user_name: e.user_name, created_at: isoTime(e.created_at) })),
  };
}

async function performance(db, campaignId) {
  const leads = () => db('leads').where({ campaign_id: campaignId });
  const [[{ n: prospects }], [{ n: clients }], byMedium, byContent] = await Promise.all([
    leads().count({ n: '*' }),
    leads().whereIn('stage', CLIENT_STAGES).count({ n: '*' }),
    leads().groupBy('utm_medium').select('utm_medium').count({ n: '*' }),
    leads().whereNotNull('utm_content').groupBy('utm_content').select('utm_content').count({ n: '*' }),
  ]);
  const [{ n: sales }] = await db('sales as s').join('leads as l', 'l.id', 's.lead_id').where('l.campaign_id', campaignId).whereNot('s.status', 'desiste').count({ n: '*' });
  return {
    prospects: Number(prospects), clients: Number(clients), sales: Number(sales),
    by_medium: byMedium.map(m => ({ medium: m.utm_medium || 'non précisé', prospects: Number(m.n) })),
    by_content: byContent.map(m => ({ content_id: Number(m.utm_content) || null, prospects: Number(m.n) })),
  };
}

async function listCampaigns(db, { status = null } = {}) {
  await ensurePermanent(db);
  const q = db('marketing_campaigns').orderBy([{ column: 'permanent', order: 'desc' }, { column: 'id', order: 'desc' }]);
  if (status) q.where({ status });
  const rows = await q;
  const counts = await db('marketing_contents').groupBy('campaign_id', 'status').select('campaign_id', 'status').count({ n: '*' });
  const leads = await db('leads').whereNotNull('campaign_id').groupBy('campaign_id').select('campaign_id').count({ n: '*' });
  return rows.map(c => serializeCampaign(c, {
    contents: Object.fromEntries(counts.filter(x => x.campaign_id === c.id).map(x => [x.status, Number(x.n)])),
    prospects: Number(leads.find(l => l.campaign_id === c.id)?.n || 0),
  }));
}

async function campaignDetail(db, id) {
  const c = await requireCampaign(db, id);
  const [contents, perf, events, generations] = await Promise.all([
    listContents(db, { campaignId: id }), performance(db, id),
    db('marketing_events as e').leftJoin('users as u', 'u.id', 'e.user_id').where('e.campaign_id', id).whereNull('e.content_id').orderBy('e.id', 'desc').limit(30).select('e.action', 'e.is_ai', 'e.note', 'e.created_at', 'u.name as user_name'),
    db('marketing_generations').where({ campaign_id: id }).orderBy('id', 'desc').limit(10).select('id', 'step', 'mode', 'model', 'status', 'cost_micro_usd', 'created_at'),
  ]);
  return {
    ...serializeCampaign(c), contents, performance: perf,
    events: events.map(e => ({ ...e, is_ai: !!e.is_ai, created_at: isoTime(e.created_at) })),
    generations: generations.map(g => ({ ...g, step_label: STEPS[g.step], cost_micro_usd: Number(g.cost_micro_usd), created_at: isoTime(g.created_at) })),
  };
}

async function calendar(db, from, to) {
  const items = await listContents(db, { from, to, limit: 500 });
  return { from, to, items: items.filter(i => i.status !== 'archive') };
}

async function dashboard(db) {
  await ensurePermanent(db);
  const today = todayStr();
  const [byStatus, campaigns, upcoming, usage, last, [{ n: leadsTotal }], [{ n: leadsTracked }]] = await Promise.all([
    db('marketing_contents').groupBy('status').select('status').count({ n: '*' }),
    listCampaigns(db),
    listContents(db, { from: today, to: addDays(today, 13), limit: 40 }),
    ai.usage(db),
    db('marketing_generations').orderBy('id', 'desc').limit(8).select('id', 'campaign_id', 'step', 'mode', 'model', 'status', 'cost_micro_usd', 'week_of', 'created_at'),
    db('leads').count({ n: '*' }),
    db('leads').whereNotNull('campaign_id').count({ n: '*' }),
  ]);
  const media = await db('leads').whereNotNull('campaign_id').groupBy('utm_medium').select('utm_medium').count({ n: '*' });
  const segments = await db('leads as l').join('marketing_campaigns as k', 'k.id', 'l.campaign_id').groupBy('k.segment').select('k.segment').count({ n: '*' });
  return {
    contents: Object.fromEntries(Object.keys(CONTENT_STATUSES).map(s => [s, Number(byStatus.find(x => x.status === s)?.n || 0)])),
    campaigns: campaigns.filter(c => c.status !== 'archivee'),
    upcoming: upcoming.filter(i => !['archive', 'publie'].includes(i.status)).slice(0, 12),
    usage, leads: { total: Number(leadsTotal), tracked: Number(leadsTracked) },
    by_medium: media.map(m => ({ medium: m.utm_medium || 'non précisé', prospects: Number(m.n) })),
    by_segment: segments.map(s => ({ segment: s.segment, label: SEGMENTS[s.segment] || s.segment, prospects: Number(s.n) })),
    last_generations: last.map(g => ({ ...g, step_label: STEPS[g.step], cost_micro_usd: Number(g.cost_micro_usd), week_of: isoDay(g.week_of), created_at: isoTime(g.created_at) })),
  };
}

/** Compteurs du menu : contenus à valider (validateurs), campagnes à valider (supervision), contenus à publier. */
async function badges(db, can) {
  const today = todayStr();
  const [toValidate, campaigns, due] = await Promise.all([
    can('marketing:validate') ? db('marketing_contents').where({ status: 'a_valider' }).count({ n: '*' }).first() : { n: 0 },
    can('marketing:settings') ? db('marketing_campaigns').where({ status: 'a_valider' }).count({ n: '*' }).first() : { n: 0 },
    can('marketing:validate') ? db('marketing_contents').whereIn('status', ['valide', 'planifie']).where('scheduled_for', '<=', today).count({ n: '*' }).first() : { n: 0 },
  ]);
  return { to_validate: Number(toValidate.n), campaigns_to_validate: Number(campaigns.n), to_publish: Number(due.n), count: Number(toValidate.n) + Number(campaigns.n) };
}

async function generationsList(db, limit = 50) {
  const rows = await db('marketing_generations as g').leftJoin('marketing_campaigns as k', 'k.id', 'g.campaign_id').leftJoin('users as u', 'u.id', 'g.requested_by')
    .orderBy('g.id', 'desc').limit(Math.min(Number(limit) || 50, 200))
    .select('g.id', 'g.step', 'g.mode', 'g.model', 'g.status', 'g.tokens_in', 'g.tokens_out', 'g.cost_micro_usd', 'g.error', 'g.week_of', 'g.created_at', 'k.name as campaign_name', 'u.name as requested_by_name');
  const rate = (await settingsService.all(db)).marketing_usd_fcfa;
  return rows.map(g => ({ ...g, step_label: STEPS[g.step], cost_micro_usd: Number(g.cost_micro_usd), cost_fcfa: Math.round((Number(g.cost_micro_usd) / 1e6) * rate), week_of: isoDay(g.week_of), created_at: isoTime(g.created_at) }));
}

// ─── Tâche planifiée (chaque heure) ───────────────────────────────────────

/**
 * 1) Préparation hebdomadaire : à partir du jour réglé, l'IA prépare le calendrier et les contenus de la semaine suivante pour
 *    chaque campagne validée (ligne éditoriale permanente comprise) — une seule fois par semaine et par campagne (week_of).
 *    En arrêt d'urgence, rien n'est préparé (reprise contrôlée à la levée). Plafond atteint : tentative notée, pas de répétition.
 * 2) Rappel « à publier » : contenu validé dont le jour est venu, une fois.
 */
async function tick(db, day = todayStr()) {
  const stats = { prepared: 0, skipped: 0, reminded: 0 };
  await ai.sweepStale(db);
  const s = await settingsService.all(db);
  if (s.marketing_weekly_prep && !s.emergency_stop && weekday(day) >= s.marketing_prep_weekday) {
    await ensurePermanent(db);
    const week = addDays(mondayOf(day), 7);
    const weekEnd = addDays(week, 6);
    const campaigns = await db('marketing_campaigns').where({ status: 'validee' })
      .andWhere(q => q.whereNull('starts_on').orWhere('starts_on', '<=', weekEnd)).andWhere(q => q.whereNull('ends_on').orWhere('ends_on', '>=', week));
    for (const c of campaigns) {
      const done = await db('marketing_generations').where({ campaign_id: c.id, step: 'semaine', week_of: week }).select('status');
      if (done.some(g => ['ok', 'en_cours', 'refuse_plafond', 'invalide'].includes(g.status)) || done.filter(g => g.status === 'erreur').length >= 3) { stats.skipped++; continue; }
      try {
        await generateContents(db, c.id, null, { step: 'semaine', weeks: 1, from: week, weekOf: week, count: s.marketing_posts_per_week });
        stats.prepared++;
      } catch (e) {
        if (!e.status) console.error('[marketing]', ai.clean(e));
      }
    }
  }
  for (const c of await contentQuery(db).whereIn('c.status', ['valide', 'planifie']).where('c.scheduled_for', '<=', day).where('k.status', 'validee')) {
    const n = await inform(db, 'marketing.a_publier', {
      title: `À publier : ${c.title}`, body: `${CHANNELS[c.channel].label} — prévu le ${String(isoDay(c.scheduled_for)).split('-').reverse().join('/')}`,
      link: `/marketing/contenus?fiche=${c.id}`, key: `marketing-publier:${c.id}:${isoDay(c.scheduled_for)}`,
    });
    if (n) stats.reminded++;
  }
  return stats;
}

module.exports = {
  trackedLink, resolveUtm, serializeCampaign, ensurePermanent, createCampaign, updateCampaign, submitCampaign, validateCampaign, archiveCampaign,
  generateConcept, generateContents, createManual, regenerate, editContent, submitContent, validateContent, rejectContent, scheduleContent, publishContent, archiveContent,
  newsletterDraft, listContents, contentDetail, listCampaigns, campaignDetail, calendar, dashboard, badges, generationsList, performance, tick, requireCampaign,
  warningsFor, MODELS,
};
