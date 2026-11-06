/**
 * « Sita », conseillère IA du site public : réglages (dashboard › Contenu du site › Assistante du site), configuration publique du
 * widget, conversations des visiteurs, outils exécutés par le serveur (enregistrer_prospect, proposer_rendez_vous, passer_la_main),
 * suivi dans l'ERP (Service commercial › Conversations de Sita).
 * Réutilise le socle du Marketing : faits publiés (services/marketingContext.js), client et coûts de l'IA (services/marketingAi.js via
 * services/sitaAi.js), campagne d'origine (resolveUtm), création de prospect (findOrCreateLead, source 'ia') et annonce aux responsables
 * (liaisons.announceInbound). La clé de l'IA n'est jamais lue ici ni renvoyée : seul sitaAi la touche.
 * Les messages des visiteurs sont des données : la fiche prospect n'est créée que si le nom et le téléphone ont été écrits par le visiteur.
 */
const { HttpError, json, toDate, isoTime } = require('../lib/http');
const { monthOf, microUsdToFcfa } = require('../lib/marketing');
const S = require('../lib/sita');
const { buildContext } = require('./marketingContext');
const { resolveUtm } = require('./marketing');
const { findOrCreateLead } = require('./lots');
const liaisons = require('./liaisons');
const { logActivity, seesAllLeads } = require('./commercial');
const { inform } = require('./notifications');
const { notifyTeam } = require('../lib/mailer');
const ai = require('./sitaAi');
const { demoReply } = require('./sitaDemo');
const { FINANCING_PLANS } = require('../lib/domain');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const limiter = S.createLimiter();

// ─── Réglages ─────────────────────────────────────────────────────────────

async function getSettings(db) {
  const row = await db('sita_settings').where({ key: 'config' }).first();
  return S.cleanSettings(json(row?.value, {}));
}

/** Enregistre les réglages (fusionnés avec les actuels, validés) ; renvoie les réglages effectifs. */
async function saveSettings(db, patch) {
  const current = await getSettings(db);
  const merged = { ...current, ...patch };
  merged.whatsapp_relay = String(merged.whatsapp_relay || '').replace(/\D/g, '');
  const parsed = S.settingsSchema.safeParse(merged);
  if (!parsed.success) throw new HttpError(400, 'Données invalides.', parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  const data = parsed.data;
  if (data.whatsapp_relay && (data.whatsapp_relay.length < 8 || data.whatsapp_relay.length > 15)) throw new HttpError(400, 'Numéro WhatsApp de relais invalide : indiquez-le avec l’indicatif, par exemple 2250102279595.');
  if (data.photo_media_id) {
    const m = await db('media').where({ id: data.photo_media_id }).first('id', 'mime');
    if (!m || !/^image\//.test(m.mime || '')) throw new HttpError(400, 'La photo doit être une image de la médiathèque.');
  }
  const slugs = new Set((await db('projects').select('slug')).map(p => p.slug));
  for (const k of Object.keys(data.invitations)) if (!slugs.has(k)) delete data.invitations[k];
  for (const k of Object.keys(data.invitations)) if (!data.invitations[k]) delete data.invitations[k];
  const value = JSON.stringify(data);
  if (await db('sita_settings').where({ key: 'config' }).first()) await db('sita_settings').where({ key: 'config' }).update({ value, updated_at: new Date() });
  else await db('sita_settings').insert({ key: 'config', value });
  return getSettings(db);
}

/** Numéro de relais WhatsApp : celui réglé pour Sita, sinon celui du site, sinon celui de SIIPAF. */
async function relayNumber(db, settings) {
  if (settings.whatsapp_relay) return settings.whatsapp_relay;
  const site = json((await db('site_content').where({ key: 'site' }).first())?.value, {});
  return String(site?.whatsapp || '').replace(/\D/g, '') || S.DEFAULT_RELAY;
}

/** Réglages tels que le dashboard les affiche (avec les textes par défaut, la photo et l'état de l'IA, sans aucun secret). */
async function adminView(db) {
  const settings = await getSettings(db);
  const photo = settings.photo_media_id ? await db('media').where({ id: settings.photo_media_id }).first('id', 'filename') : null;
  return {
    settings, defaults: S.effectiveTexts({ ...settings, title: '', greeting: '', invitation_default: '', invitation_programme: '' }),
    photo_url: photo ? `/uploads/by-id/${photo.id}` : null, usage: await ai.usage(db, settings),
    meta: {
      genders: S.GENDERS, tts_voices: S.TTS_VOICES, tts_default_style: { femme: S.DEFAULT_TTS_STYLE_F, homme: S.DEFAULT_TTS_STYLE_M }, tones: S.TONES, languages: S.LANGS, pages: S.PAGES, models: S.SITA_MODELS, providers: S.PROVIDERS,
      projects: (await db('projects').where({ published: true }).whereNull('archived_at').orderBy('sort').select('slug', 'name')),
      relay: await relayNumber(db, settings), hours_text: S.hoursText(settings.human_hours),
    },
  };
}

/** Configuration publique lue par le widget du site : identité et textes, jamais de plafond, de modèle, de clé ni d'arrêt d'urgence. */
async function publicConfig(db) {
  const settings = await getSettings(db);
  const t = S.effectiveTexts(settings);
  const projects = await db('projects').where({ published: true }).whereNull('archived_at').orderBy('sort').select('slug', 'name', 'category');
  const vars = { nom: settings.name };
  const invitations = {};
  for (const p of projects) invitations[p.slug] = S.fill(settings.invitations[p.slug] || t.invitation_programme, { ...vars, programme: p.name });
  return {
    enabled: settings.enabled, name: settings.name, gender: settings.gender, title: t.title,
    photo: settings.photo_media_id ? `/uploads/by-id/${settings.photo_media_id}` : null,
    greeting: S.fill(t.greeting, vars), invitation_default: S.fill(t.invitation_default, vars), invitations,
    invitation_delay_s: settings.invitation_delay_s, sound: settings.sound, voice: settings.voice, voice_natural: settings.voice && !!String(process.env.GEMINI_API_KEY || '').trim(), pages: settings.pages, languages: settings.languages,
    whatsapp: await relayNumber(db, settings), hours: S.hoursText(settings.human_hours),
    programmes: projects.map(p => ({ slug: p.slug, name: p.name })),
    notice: `${settings.name} est une assistante virtuelle (IA) de SIIPAF. Un conseiller peut prendre le relais à tout moment.`,
    consent: 'En laissant vos coordonnées dans cette discussion, vous acceptez que SIIPAF vous recontacte.',
  };
}

// ─── Faits publiés ────────────────────────────────────────────────────────

/** Faits donnés à l'IA et aux réponses de démonstration : programmes publiés, offres, prix, financement, avancement, documents. */
async function buildFacts(db) {
  const { facts } = await buildContext(db);
  const slugs = Object.fromEntries((await db('projects').select('id', 'slug')).map(p => [`p${p.id}`, p.slug]));
  const site = json((await db('site_content').where({ key: 'site' }).first())?.value, {});
  const { temoignages, ...rest } = facts; // aucun témoignage dans la conversation
  return {
    ...rest,
    programmes: rest.programmes.map(p => ({ identifiant: slugs[p.ref] || null, ...p })),
    modes_de_financement: Object.values(FINANCING_PLANS).map(p => p.label),
    contact: {
      telephone: site.phone || '+225 01 02 27 95 95', telephone_2: site.phone2 || '+225 27 22 20 50 20',
      email: site.email || 'info@siipaf.com', adresse: site.address || 'Cocody 2 Plateaux 7ème Tranche, Abidjan',
    },
  };
}

// ─── Conversations ────────────────────────────────────────────────────────

const VISITOR_KEY = /^[A-Za-z0-9_-]{16,64}$/;
// Origine du prospect : « mobile » pour une conversation dans l'application SIIPAF, « ia » ailleurs (site, Messenger, Instagram)
const leadSource = channel => (channel === 'mobile' ? 'mobile' : 'ia');
// Messenger et Instagram : « messenger-<identifiant propre à la page> » (jamais une donnée personnelle)
const META_KEY = /^(messenger|instagram)-\d{5,40}$/;

async function projectBySlug(db, slug) {
  if (!slug) return null;
  return (await db('projects').where({ slug: String(slug).slice(0, 80), published: true }).whereNull('archived_at').first('id', 'slug', 'name')) || null;
}

async function loadConversation(db, visitorKey, { page, utm, lang, ipHash, channel = 'site', externalId = null }) {
  let conv = await db('sita_conversations').where({ visitor_key: visitorKey }).first();
  const focus = await projectBySlug(db, page?.slug);
  if (conv) {
    const patch = {};
    if (focus && conv.project_id !== focus.id) patch.project_id = focus.id;
    if (page?.path && page.path !== conv.page_path) patch.page_path = page.path.slice(0, 160);
    if (lang && lang !== conv.lang) patch.lang = lang;
    if (Object.keys(patch).length) { await db('sita_conversations').where({ id: conv.id }).update(patch); conv = { ...conv, ...patch }; }
    return { conv, created: false, focus: focus || (conv.project_id ? await db('projects').where({ id: conv.project_id }).first('id', 'slug', 'name') : null) };
  }
  const tracked = await resolveUtm(db, utm);
  const row = {
    visitor_key: visitorKey, project_id: focus?.id || null, page_path: page?.path ? page.path.slice(0, 160) : null, lang: lang || 'fr',
    campaign_id: tracked?.campaign_id || null, utm_medium: tracked?.utm_medium || null, utm_content: tracked?.utm_content || null, ip_hash: ipHash || null,
    channel, external_id: externalId || null, last_message_at: new Date(),
  };
  const id = insertedId((await db('sita_conversations').insert(row))[0]);
  return { conv: { id, ...row, lead_id: null, appointment_id: null, consent_contact: false, handed_over: false, messages_count: 0, cost_micro_usd: 0, state: null, summary: null, mode: 'demo' }, created: true, focus };
}

// ─── Outils exécutés par le serveur ───────────────────────────────────────

const frDateTime = d => new Date(d).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Abidjan' });

/**
 * Fabrique les outils d'une réponse. Chacun vérifie ses entrées (le modèle n'invente ni nom ni numéro), agit, et renvoie
 * { ok, … } au modèle (`public` : ce que la conversation montre au visiteur ou à l'équipe).
 */
function makeTools(db, ctx) {
  const { settings, focus } = ctx;
  const fail = error => ({ ok: false, error });

  /** Crée ou complète la fiche : contrôle des coordonnées, consentement, source 'ia', campagne conservée. Renvoie { lead, created, first }. */
  async function saveLead(input, { summary, budget = null, financing = null }) {
    const conv = ctx.conv;
    const have = S.visitorProvided(ctx.visitorTexts, { phone: input.phone, email: input.email, name: input.name });
    if (!input.name) throw new Error('Le nom du visiteur est nécessaire : demandez-le lui.');
    if (!input.phone && !input.email) throw new Error('Un téléphone ou un e-mail est nécessaire : demandez-le au visiteur.');
    if (input.phone && !(S.phoneDigits(input.phone).length >= 8 && S.phoneDigits(input.phone).length <= 15)) throw new Error('Numéro de téléphone invalide : demandez-le de nouveau au visiteur.');
    if (input.phone && !have.phone) throw new Error('Ce numéro n’a pas été écrit par le visiteur : redemandez-le lui.');
    if (input.email && !have.email) throw new Error('Cette adresse n’a pas été écrite par le visiteur : redemandez-la lui.');
    if (!have.name) throw new Error('Ce nom n’a pas été écrit par le visiteur : redemandez-le lui.');
    if (input.consent_contact !== true) throw new Error('Le visiteur doit d’abord accepter d’être recontacté : demandez-lui son accord.');
    const project = (await projectBySlug(db, input.project_slug)) || focus;
    const utm = conv.campaign_id ? { campaign_id: conv.campaign_id, utm_medium: conv.utm_medium, utm_content: conv.utm_content } : null;
    const message = [`[Sita] ${summary}`, budget ? `Budget indiqué : ${S.fcfa(budget)}` : null, project ? `Programme : ${project.name}` : null].filter(Boolean).join('\n');
    const lead = await db.transaction(trx => findOrCreateLead(trx, {
      name: input.name, email: input.email || null, phone: input.phone || null, project_id: project?.id || null, financing: financing || null,
      message, source: leadSource(ctx.conv.channel), utm,
    }));
    const first = !conv.lead_id;
    const patch = { lead_id: lead.id, consent_contact: true, consent_at: conv.consent_at || new Date(), summary: summary.slice(0, 800), updated_at: new Date() };
    await db('sita_conversations').where({ id: conv.id }).update(patch);
    Object.assign(conv, patch);
    if (first) {
      await logActivity(db, lead.id, { kind: 'note', summary: `Conversation avec Sita (${S.channelLabel(conv.channel)})`, note: `${summary}\n\nConversation n° ${conv.id} : Service commercial › Conversations de Sita.` });
      notifyTeam(`Nouveau prospect via Sita (${S.channelLabel(conv.channel)})`, `${input.name} — ${input.phone || ''} ${input.email || ''}\n${summary}`);
      await liaisons.announceInbound(db, lead, { what: lead.created ? 'conversation avec Sita : coordonnées laissées' : 'a repris contact en discutant avec Sita', source: leadSource(ctx.conv.channel), via: S.viaLabel(conv.channel) }).catch(() => {});
      liaisons.acknowledge({ name: input.name, email: input.email }, 'Nous avons bien reçu votre demande — SIIPAF', ['Merci d’avoir échangé avec notre assistante : vos coordonnées sont bien enregistrées.', 'Un conseiller SIIPAF vous recontacte très prochainement. Une question ? +225 01 02 27 95 95.']);
    }
    return { lead, created: !!lead.created, first };
  }

  const tools = {
    async enregistrer_prospect(raw) {
      const p = S.prospectSchema.safeParse(raw);
      if (!p.success) return fail(p.error.issues.map(i => i.message).join(' ; '));
      try {
        const r = await saveLead(p.data, { summary: p.data.summary, budget: p.data.budget_fcfa, financing: p.data.financing });
        return { ok: true, message: r.created ? 'Fiche créée : un conseiller SIIPAF va recontacter le visiteur.' : 'Le visiteur était déjà connu : sa fiche est complétée et son conseiller est prévenu.', public: { lead_id: r.lead.id, created: r.created } };
      } catch (e) { return fail(e.message); }
    },

    async proposer_rendez_vous(raw) {
      const p = S.appointmentSchema.safeParse(raw);
      if (!p.success) return fail(p.error.issues.map(i => i.message).join(' ; '));
      const d = p.data;
      const iso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(d.starts_at) ? `${d.starts_at.replace(' ', 'T')}${d.starts_at.length === 16 ? ':00' : ''}Z` : d.starts_at; // heure d'Abidjan = UTC
      const when = new Date(iso);
      if (Number.isNaN(when.getTime())) return fail('Date invalide : utilisez le format AAAA-MM-JJTHH:MM.');
      const now = ctx.now || new Date();
      if (when.getTime() < now.getTime() + 2 * 3600 * 1000) return fail('Le rendez-vous doit être au moins deux heures après maintenant : proposez un autre créneau.');
      if (when.getTime() > now.getTime() + 60 * 86400000) return fail('Le rendez-vous doit être dans les 60 prochains jours.');
      if (when.getUTCDay() === 0) return fail('L’équipe ne reçoit pas le dimanche : proposez un autre jour.');
      const hm = when.getUTCHours() * 60 + when.getUTCMinutes();
      if (hm < 8 * 60 || hm > 17 * 60 + 30) return fail('Les rendez-vous ont lieu entre 08:00 et 17:30 (heure d’Abidjan) : proposez un autre horaire.');
      const project = (await projectBySlug(db, d.project_slug)) || ctx.focus;
      let leadId = ctx.conv.lead_id;
      if (!leadId) {
        try {
          const r = await saveLead({ name: d.name, phone: d.phone, email: d.email, consent_contact: d.consent_contact === true }, { summary: `Demande de rendez-vous (${S.APPOINTMENT_KINDS[d.kind]}) le ${frDateTime(when)}` });
          leadId = r.lead.id;
        } catch (e) { return fail(e.message); }
      }
      const existing = await db('appointments').where({ lead_id: leadId, starts_at: when }).first('id');
      let apptId = existing?.id;
      if (!apptId) {
        apptId = insertedId((await db('appointments').insert({
          lead_id: leadId, kind: d.kind, starts_at: when, project_id: project?.id || null, source: leadSource(ctx.conv.channel), notes: [d.note, 'Demande prise avec Sita'].filter(Boolean).join(' — '),
        }))[0]);
        notifyTeam('Demande de rendez-vous (Sita)', `${S.APPOINTMENT_KINDS[d.kind]} le ${frDateTime(when)}`);
        await liaisons.announceInbound(db, leadId, { what: `demande de rendez-vous (${S.APPOINTMENT_KINDS[d.kind]}) le ${frDateTime(when)}`, source: leadSource(ctx.conv.channel), via: S.viaLabel(ctx.conv.channel) }).catch(() => {});
        const lead = await db('leads').where({ id: leadId }).first('name', 'email');
        liaisons.acknowledge(lead, 'Votre demande de rendez-vous — SIIPAF', [`Nous avons bien reçu votre demande de rendez-vous du ${frDateTime(when)}.`, 'Un conseiller SIIPAF vous le confirmera très vite par e-mail ou par téléphone.']);
      }
      await db('sita_conversations').where({ id: ctx.conv.id }).update({ appointment_id: apptId, updated_at: new Date() });
      ctx.conv.appointment_id = apptId;
      ctx.appointment = { kind: d.kind, kind_label: S.APPOINTMENT_KINDS[d.kind], starts_at: when.toISOString() };
      return { ok: true, message: `Demande de rendez-vous enregistrée pour le ${frDateTime(when)} : l’équipe la confirmera par téléphone ou e-mail.`, public: { appointment_id: apptId } };
    },

    async passer_la_main(raw) {
      const p = S.handoverSchema.safeParse(raw);
      if (!p.success) return fail('Indiquez la raison du passage de main.');
      const number = await relayNumber(db, settings);
      const intro = `Bonjour SIIPAF, je viens de discuter avec ${settings.name} ${S.onLabel(ctx.conv.channel)}${ctx.focus ? ` à propos de ${ctx.focus.name}` : ''}. ${p.data.reason}`.slice(0, 300);
      const url = `https://wa.me/${number}?text=${encodeURIComponent(intro)}`;
      ctx.actions = ctx.actions.filter(a => a.type !== 'whatsapp').concat({ type: 'whatsapp', url, label: ctx.lang === 'en' ? 'Write to an adviser on WhatsApp' : 'Écrire à un conseiller sur WhatsApp' });
      const first = !ctx.conv.handed_over;
      await db('sita_conversations').where({ id: ctx.conv.id }).update({ handed_over: true, handed_over_at: ctx.conv.handed_over_at || new Date(), updated_at: new Date() });
      ctx.conv.handed_over = true;
      if (first) {
        const lead = ctx.conv.lead_id ? await db('leads').where({ id: ctx.conv.lead_id }).first('id', 'name', 'assigned_to') : null;
        await inform(db, 'sita.passage_main', {
          direct: lead?.assigned_to ? [lead.assigned_to] : [], key: `sita-main:${ctx.conv.id}`,
          title: lead ? `Sita passe la main : ${lead.name}` : 'Sita passe la main : un visiteur demande un conseiller',
          body: `${p.data.reason}${ctx.focus ? ` · ${ctx.focus.name}` : ''}`.slice(0, 300), link: lead ? liaisons.leadLink(lead.id) : `/commercial/sita?fiche=${ctx.conv.id}`,
        }).catch(() => {});
      }
      return { ok: true, message: `Lien WhatsApp prêt (équipe présente ${S.hoursText(settings.human_hours)}). Propose-le au visiteur.`, public: { handed_over: true } };
    },
  };
  return async (name, input) => {
    if (!tools[name]) return fail(`Outil inconnu : ${name}`);
    return tools[name](input || {});
  };
}

// ─── Échange avec un visiteur ─────────────────────────────────────────────

const en = lang => lang === 'en';
const FALLBACKS = {
  cap: lang => (en(lang) ? 'I cannot answer you right now. A SIIPAF adviser remains at your disposal: you can write to them on WhatsApp with the button below.' : 'Je ne peux pas vous répondre pour le moment. Un conseiller SIIPAF reste à votre disposition : vous pouvez lui écrire sur WhatsApp avec le bouton ci-dessous.'),
  error: lang => (en(lang) ? 'I am having a technical problem. A SIIPAF adviser can help you: write to them on WhatsApp with the button below.' : 'Je rencontre un souci technique. Un conseiller SIIPAF peut vous aider : écrivez-lui sur WhatsApp avec le bouton ci-dessous.'),
  checked: lang => (en(lang) ? 'I prefer not to give you an approximate answer on this point. A SIIPAF adviser can answer precisely: you can write to them on WhatsApp with the button below.' : 'Je préfère ne pas vous donner une information approximative sur ce point. Un conseiller SIIPAF peut vous répondre précisément : vous pouvez lui écrire sur WhatsApp avec le bouton ci-dessous.'),
  long: lang => (en(lang) ? 'We have talked a lot! For the rest, a SIIPAF adviser will take over: write to them on WhatsApp with the button below.' : 'Nous avons beaucoup échangé ! Pour la suite, un conseiller SIIPAF prend le relais : écrivez-lui sur WhatsApp avec le bouton ci-dessous.'),
};

/** Historique renvoyé à l'IA : derniers messages, alternance visiteur / assistante, commence par le visiteur. */
function modelMessages(rows) {
  const out = [];
  for (const r of rows.slice(-S.HISTORY_TURNS)) {
    const role = r.role === 'visiteur' ? 'user' : 'assistant';
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n${r.content}`;
    else out.push({ role, content: r.content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function addMessage(db, conversationId, row) {
  return insertedId((await db('sita_messages').insert({ conversation_id: conversationId, month: monthOf(), ...row }))[0]);
}

/**
 * Traite un message de visiteur : consigne, répond (IA ou démonstration), contrôle la réponse, enregistre le coût.
 * `input` : { visitorKey, message, page: { path, slug }, utm, lang, ipHash, now }.
 */
async function handleMessage(db, input) {
  const settings = await getSettings(db);
  if (!settings.enabled) throw new HttpError(403, 'L’assistante n’est pas disponible pour le moment.');
  const channel = S.CHANNELS[input.channel] ? input.channel : 'site';
  if (!(['site', 'mobile'].includes(channel) ? VISITOR_KEY : META_KEY).test(String(input.visitorKey || ''))) throw new HttpError(400, 'Identifiant de visiteur invalide.');
  const message = S.cleanMessage(input.message);
  if (!message) throw new HttpError(400, 'Écrivez votre message.');
  const lang = settings.languages.includes('en') && input.lang === 'en' ? 'en' : 'fr';
  const { conv, focus } = await loadConversation(db, input.visitorKey, { page: input.page, utm: input.utm, lang, ipHash: input.ipHash, channel, externalId: input.externalId });
  const now = input.now || new Date();
  const ctx = { settings, conv, focus, lang, now, channel, actions: [], appointment: null, visitorTexts: [] };

  await addMessage(db, conv.id, { role: 'visiteur', content: message, status: 'ok' });
  conv.messages_count += 1;
  await db('sita_conversations').where({ id: conv.id }).update({ messages_count: conv.messages_count, last_message_at: new Date(), updated_at: new Date() });
  const rows = await db('sita_messages').where({ conversation_id: conv.id }).orderBy('id').select('role', 'content');
  ctx.visitorTexts = rows.filter(r => r.role === 'visiteur').map(r => r.content);
  const execute = makeTools(db, ctx);

  let reply = null;
  let meta = { mode: 'demo', model: null, status: 'ok', usage: {}, cost_micro_usd: 0, tools: [], warnings: [], error: null };
  const facts = await buildFacts(db);
  const check = text => S.checkReply(text, facts, { visitorTexts: ctx.visitorTexts });
  const handover = async reason => { await execute('passer_la_main', { reason }); };

  if (conv.messages_count > S.MAX_VISITOR_MESSAGES) {
    reply = FALLBACKS.long(lang);
    await handover('Conversation très longue : un conseiller prend le relais');
  } else {
    const { mode } = ai.resolveMode(settings);
    if (mode === 'demo') {
      const state = json(conv.state, null);
      const out = await demoReply({ settings, facts, state, message, focus, now, execute, visitorTexts: ctx.visitorTexts });
      const warnings = check(out.text);
      await db('sita_conversations').where({ id: conv.id }).update({ state: JSON.stringify(out.state) }); // le dialogue avance même si la réponse est remplacée
      if (warnings.length) { reply = FALLBACKS.checked(lang); meta.status = 'corrige'; meta.warnings = warnings; await handover('Réponse non vérifiable en démonstration'); } else reply = out.text;
    } else {
      const system = S.systemPrompt({ settings, facts, focus, now, channel });
      const result = await ai.converse(db, settings, { system, messages: modelMessages(rows), tools: S.TOOLS, execute, check });
      meta = { ...meta, mode: 'ia', model: result.model, status: result.status, usage: result.usage, cost_micro_usd: result.cost_micro_usd, tools: result.tools, warnings: result.warnings, error: result.error || null };
      if (result.status === 'refuse_plafond') { reply = FALLBACKS.cap(lang); await handover('Sita est indisponible (plafond atteint)'); } else if (result.status === 'erreur') { reply = FALLBACKS.error(lang); await handover('Sita est momentanément indisponible'); } else if (!result.text) { reply = FALLBACKS.checked(lang); meta.status = 'corrige'; await handover('Réponse non vérifiable'); } else reply = result.text;
    }
  }

  const replyId = await addMessage(db, conv.id, {
    role: 'assistante', content: reply, mode: meta.mode, model: meta.model, prompt_version: meta.mode === 'ia' ? S.PROMPT_VERSION : null, status: meta.status,
    tokens_in: meta.usage.tokens_in || 0, tokens_out: meta.usage.tokens_out || 0, tokens_cache_read: meta.usage.tokens_cache_read || 0, tokens_cache_write: meta.usage.tokens_cache_write || 0,
    cost_micro_usd: meta.cost_micro_usd, tools: JSON.stringify(meta.tools), warnings: JSON.stringify(meta.warnings), error: meta.error,
  });
  await db('sita_conversations').where({ id: conv.id }).update({ mode: meta.mode, cost_micro_usd: Number(conv.cost_micro_usd || 0) + meta.cost_micro_usd, last_message_at: new Date() });
  return {
    reply, message_id: replyId, conversation_id: conv.id, actions: ctx.actions, lead_saved: !!conv.lead_id, appointment: ctx.appointment, handed_over: !!conv.handed_over,
    remaining: Math.max(0, S.MAX_VISITOR_MESSAGES - conv.messages_count),
  };
}

// ─── Visiteurs : limites ──────────────────────────────────────────────────

/** Limite de débit : par visiteur, par adresse, et nombre de nouvelles conversations par adresse. Lève 429 au-delà. */
async function throttle(db, { visitorKey, ip }) {
  const lim = S.getLimits();
  const known = await db('sita_conversations').where({ visitor_key: visitorKey }).first('id');
  const checks = [['i', ip, lim.ip], ['v', visitorKey, lim.visitor]];
  if (!known) checks.push(['n', ip, lim.newConversations]);
  for (const [kind, key, rule] of checks) {
    const r = limiter.take(`${kind}:${key}`, rule);
    if (!r.ok) throw new HttpError(429, 'Vous écrivez très vite : patientez quelques instants avant de poursuivre.', { retry_after: r.retry_after });
  }
}

// ─── ERP : Service commercial › Conversations de Sita ─────────────────────

function serialize(c, rate) {
  return {
    id: c.id, created_at: isoTime(c.created_at), last_message_at: isoTime(c.last_message_at), page_path: c.page_path, lang: c.lang, mode: c.mode,
    project_id: c.project_id, project_name: c.project_name || null, messages_count: c.messages_count, lead_id: c.lead_id, lead_name: c.lead_name || null,
    lead_phone: c.lead_phone || null, assigned_name: c.assigned_name || null, has_contact: !!c.lead_id, appointment_id: c.appointment_id,
    appointment_at: c.appointment_at ? isoTime(c.appointment_at) : null, appointment_kind: c.appointment_kind || null, handed_over: !!c.handed_over,
    channel: c.channel || 'site', channel_label: S.channelLabel(c.channel), window_until: c.window_until ? isoTime(c.window_until) : null,
    consent_contact: !!c.consent_contact, summary: c.summary, cost_fcfa: microUsdToFcfa(c.cost_micro_usd, rate), campaign: c.campaign_name || null,
  };
}
const base = db => db('sita_conversations as c').leftJoin('projects as p', 'p.id', 'c.project_id').leftJoin('leads as ld', 'ld.id', 'c.lead_id')
  .leftJoin('users as u', 'u.id', 'ld.assigned_to').leftJoin('appointments as a', 'a.id', 'c.appointment_id').leftJoin('marketing_campaigns as mc', 'mc.id', 'c.campaign_id')
  .select('c.*', 'p.name as project_name', 'ld.name as lead_name', 'ld.phone as lead_phone', 'u.name as assigned_name', 'a.starts_at as appointment_at', 'a.kind as appointment_kind', 'mc.name as campaign_name');
/** Même cloisonnement que les prospects : sans leads:all, seulement les conversations de ses fiches. */
const scope = (q, user) => { if (!seesAllLeads(user)) q.where('ld.assigned_to', user.id); return q; };

async function listConversations(db, user, { filter = 'toutes', q = '', limit = 100 } = {}) {
  const settings = await getSettings(db);
  const query = scope(base(db), user).orderBy('c.last_message_at', 'desc').limit(Math.min(Number(limit) || 100, 300));
  if (filter === 'coordonnees') query.whereNotNull('c.lead_id');
  else if (filter === 'rdv') query.whereNotNull('c.appointment_id');
  else if (filter === 'main') query.where('c.handed_over', true);
  else if (filter === 'sans') query.whereNull('c.lead_id');
  else if (S.CHANNELS[filter]) query.where('c.channel', filter);
  if (q) { const s = `%${String(q).trim()}%`; query.where(b => b.where('ld.name', 'like', s).orWhere('ld.phone', 'like', s).orWhere('p.name', 'like', s).orWhere('c.summary', 'like', s)); }
  const rows = await query;
  const first = rows.length ? await db('sita_messages').whereIn('conversation_id', rows.map(r => r.id)).where({ role: 'visiteur' }).orderBy('id').select('conversation_id', 'content') : [];
  return rows.map(r => ({ ...serialize(r, settings.usd_fcfa), first_message: (first.find(m => m.conversation_id === r.id)?.content || '').slice(0, 140) }));
}

async function conversationDetail(db, id, user) {
  const settings = await getSettings(db);
  const c = await scope(base(db), user).where('c.id', Number(id) || 0).first();
  if (!c) throw new HttpError(404, 'Conversation introuvable.');
  const messages = await db('sita_messages').where({ conversation_id: c.id }).orderBy('id');
  return {
    ...serialize(c, settings.usd_fcfa),
    messages: messages.map(m => ({
      id: m.id, role: m.role, content: m.content, at: isoTime(m.created_at), mode: m.mode, status: m.status, cost_fcfa: microUsdToFcfa(m.cost_micro_usd, settings.usd_fcfa),
      tools: json(m.tools, []), warnings: json(m.warnings, []),
      model_label: m.mode === 'ia' && m.model ? (S.SITA_MODELS[m.model]?.label || m.model).replace(/\s*\(.*\)$/, '') : null,
      relay: json(m.warnings, []).some(w => /^Relais : /.test(w)),
    })),
  };
}

async function stats(db, user) {
  const rows = await scope(base(db), user).where('c.created_at', '>=', `${monthOf()}-01`).select('c.lead_id', 'c.appointment_id', 'c.handed_over', 'c.channel');
  return { by_channel: Object.fromEntries(Object.keys(S.CHANNELS).map(k => [k, rows.filter(r => (r.channel || 'site') === k).length])), month: rows.length, with_contact: rows.filter(r => r.lead_id).length, with_appointment: rows.filter(r => r.appointment_id).length, handed_over: rows.filter(r => r.handed_over).length };
}

module.exports = {
  getSettings, saveSettings, adminView, publicConfig, buildFacts, relayNumber, handleMessage, throttle, limiter,
  listConversations, conversationDetail, stats, makeTools, projectBySlug, toDate,
};
