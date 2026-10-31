/**
 * Acquisition par les canaux officiels Meta : traitement des webhooks, test de connexion, journal et tableau de bord.
 * Aucune identité n'est collectée sur d'autres pages : seuls arrivent (1) les formulaires de publicité remplis pour SIIPAF (Lead Ads),
 * (2) les messages privés adressés à la page Facebook ou au compte Instagram de SIIPAF, (3) les commentaires publiés sous ses
 * publications. Chaque événement est traité UNE fois (unicité type + identifiant externe dans `meta_events`) et journalisé.
 * - Formulaire de publicité : champs lus via l'API Graph, fiche créée/complétée par findOrCreateLead (source « meta_lead »),
 *   annoncée comme tout prospect entrant ; campagne rattachée si l'annonce porte un code de campagne.
 * - Message : même moteur que Sita (sita.handleMessage : faits publiés, garde-fous, outils, plafond FCFA, arrêt d'urgence), réponse
 *   envoyée dans la fenêtre de 24 h de Meta ; conversation visible dans ERP › Service commercial › Conversations de Sita.
 * - Commentaire : réponse courte et fixe qui invite à écrire en privé (jamais de donnée personnelle en public, pas d'IA).
 * Non connecté (aucun identifiant) : aucune requête n'est faite et rien ne casse. Le client HTTP est injectable (metaGraph.setHttp).
 */
const { HttpError, toDate, isoTime } = require('../lib/http');
const { monthOf, microUsdToFcfa } = require('../lib/marketing');
const M = require('../lib/meta');
const S = require('../lib/sita');
const graph = require('./metaGraph');
const cfg = require('./metaSettings');
const sita = require('./sita');
const { findOrCreateLead } = require('./lots');
const liaisons = require('./liaisons');
const { logActivity } = require('./commercial');
const { inform } = require('./notifications');
const { notifyTeam } = require('../lib/mailer');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const clip = (v, n) => (v == null || v === '' ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, n) || null);
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ─── Journal et idempotence ───────────────────────────────────────────────

/**
 * Réserve l'événement : `fresh` vrai la première fois (ou pour une nouvelle tentative d'un événement `retry` resté en erreur),
 * faux pour un doublon (Meta renvoie parfois deux fois le même événement).
 */
async function claim(db, kind, externalId, fields = {}, { retry = false } = {}) {
  const row = { kind, external_id: externalId ? String(externalId).slice(0, 100) : null, status: 'recu', ...fields };
  try {
    return { id: insertedId((await db('meta_events').insert(row))[0]), fresh: true };
  } catch (err) {
    if (!row.external_id) throw err;
    const existing = await db('meta_events').where({ kind, external_id: row.external_id }).first();
    if (!existing) throw err;
    if (retry && existing.status === 'erreur') {
      await db('meta_events').where({ id: existing.id }).update({ status: 'recu', updated_at: new Date() });
      return { id: existing.id, fresh: true, retried: true };
    }
    return { id: existing.id, fresh: false };
  }
}
const finish = (db, id, status, detail = null, extra = {}) => db('meta_events').where({ id }).update({ status, detail: clip(detail, 500), updated_at: new Date(), ...extra });

// Codes d'erreur de l'API Graph qui signalent un jeton ou une permission en défaut (et non un problème propre à un message)
const AUTH_CODES = new Set([190, 102, 463, 467, 458, 459, 460, 200, 10, 4, 17, 32, 368]);

/** Panne de connexion : dernière erreur gardée pour le tableau de bord, Direction et responsable de la communication prévenues (une fois par jour et par connecteur). */
async function connectionFailure(db, where, err, creds) {
  const message = graph.clean(err, creds);
  await cfg.recordError(db, where, message).catch(() => {});
  const day = new Date().toISOString().slice(0, 10);
  await inform(db, 'meta.connexion_erreur', {
    title: `Connexion Meta en erreur : ${where}`, body: message, link: '/marketing/reglages', key: `meta-erreur:${where}:${day}`,
  }).catch(() => {});
}
const isAuthFailure = err => err instanceof graph.MetaError && (err.status === 401 || err.status === 403 || AUTH_CODES.has(Number(err.code)));

// ─── Formulaires de publicité (Lead Ads) ──────────────────────────────────

async function handleLead(db, creds, value, entryId) {
  const leadgenId = value?.leadgen_id;
  if (!leadgenId) return null;
  const c = await claim(db, 'lead', leadgenId, { channel: 'facebook' }, { retry: true });
  if (!c.fresh) return { duplicate: true };
  if (!creds.lead_ads_enabled) { await finish(db, c.id, 'ignore', 'Formulaires de publicité désactivés dans les réglages.'); return { ignored: true }; }
  if (!creds.page_token) {
    await finish(db, c.id, 'erreur', 'Jeton d’accès de la page non renseigné : le formulaire n’a pas pu être lu.');
    await connectionFailure(db, 'Formulaires de publicité', 'Jeton d’accès de la page non renseigné', creds);
    return { error: true };
  }
  try {
    const data = await graph.getLead(creds, leadgenId);
    const f = M.parseLeadFields(data.field_data);
    if (!f.email && !f.phone) { await finish(db, c.id, 'ignore', 'Ni e-mail ni téléphone dans le formulaire : fiche non créée.'); return { ignored: true }; }
    const name = f.name || (f.email ? f.email.split('@')[0] : 'Prospect Meta');

    // Campagne : code (utm_campaign) retrouvé dans l'annonce, l'ensemble, la campagne Meta ou un champ caché du formulaire
    const campaigns = await db('marketing_campaigns').select('id', 'code');
    const code = M.findCampaignCode([data.ad_name, data.adset_name, data.campaign_name, f.campaign_hint], campaigns.map(x => x.code));
    const campaign = code ? campaigns.find(x => x.code === code) : null;
    const utm = campaign ? { campaign_id: campaign.id, utm_medium: 'social_payant', utm_content: clip(data.ad_id, 80) } : null;

    // Programme cité dans une réponse du formulaire
    const projects = await db('projects').where({ published: true }).whereNull('archived_at').select('id', 'name', 'slug');
    const answers = plain(f.extra.map(x => x.value).join(' '));
    const project = answers ? projects.find(p => answers.includes(plain(p.name)) || answers.includes(p.slug)) : null;

    const message = [
      `[Formulaire de publicité Meta] ${data.platform === 'ig' ? 'Instagram' : data.platform === 'fb' ? 'Facebook' : 'Facebook / Instagram'}`,
      [data.ad_name && `Annonce : ${data.ad_name}`, data.adset_name && `Ensemble : ${data.adset_name}`, data.campaign_name && `Campagne Meta : ${data.campaign_name}`].filter(Boolean).join(' · '),
      ...f.extra.map(x => `${x.label} : ${x.value}`), f.city ? `Ville : ${f.city}` : null,
    ].filter(Boolean).join('\n').slice(0, 1500);
    const lead = await db.transaction(trx => findOrCreateLead(trx, {
      name, email: f.email || null, phone: f.phone || null, country: f.country || null, project_id: project?.id || null, message, source: 'meta_lead', utm,
    }));
    await logActivity(db, lead.id, { kind: 'note', summary: 'Formulaire de publicité Meta reçu', note: `${message}\n\nIdentifiant du formulaire : ${leadgenId}` });
    notifyTeam('Nouveau prospect via Meta (formulaire de publicité)', `${name} — ${f.phone || ''} ${f.email || ''}\n${message}`);
    await liaisons.announceInbound(db, lead, { what: lead.created ? 'formulaire de publicité Meta rempli' : 'a rempli un formulaire de publicité Meta', source: 'meta_lead' }).catch(() => {});
    liaisons.acknowledge({ name, email: f.email }, 'Nous avons bien reçu votre demande — SIIPAF', ['Merci de votre intérêt pour nos programmes : votre demande est bien reçue.', 'Un conseiller SIIPAF vous contacte très prochainement. Une question ? +225 01 02 27 95 95.']);
    await finish(db, c.id, 'ok', lead.created ? `Fiche créée${campaign ? ` · campagne « ${campaign.code} »` : ''}` : 'Fiche existante complétée', { lead_id: lead.id });
    await cfg.clearError(db).catch(() => {});
    return { lead_id: lead.id, created: !!lead.created, campaign_id: campaign?.id || null };
  } catch (err) {
    await finish(db, c.id, 'erreur', graph.clean(err, creds));
    if (isAuthFailure(err)) await connectionFailure(db, 'Formulaires de publicité', err, creds);
    return { error: true };
  }
}

// ─── Messages privés (Messenger, Instagram) ───────────────────────────────

async function handleMessageEvent(db, creds, channel, m) {
  const sender = String(m?.sender?.id || '');
  if (!sender || m.message?.is_echo) return null; // écho d'un message envoyé par la page, accusés de lecture : ignorés
  if (sender === creds.page_id || sender === creds.instagram_id) return null;
  const text = S.cleanMessage(m.message?.text || m.postback?.title || '');
  if (!m.message && !m.postback) return null;
  const mid = m.message?.mid || `pb-${sender}-${m.timestamp || ''}`;
  const c = await claim(db, 'message', mid, { channel });
  if (!c.fresh) return { duplicate: true };
  if (!creds.messages_enabled) { await finish(db, c.id, 'ignore', 'Réponse aux messages désactivée dans les réglages.'); return { ignored: true }; }
  if (!creds.page_token) {
    await finish(db, c.id, 'erreur', 'Jeton d’accès de la page non renseigné : réponse impossible.');
    await connectionFailure(db, channel === 'instagram' ? 'Messages Instagram' : 'Messages Messenger', 'Jeton d’accès de la page non renseigné', creds);
    return { error: true };
  }
  const settings = await sita.getSettings(db);
  if (!settings.enabled) { await finish(db, c.id, 'ignore', 'Sita n’est pas activée (Contenu du site › Assistante du site) : aucune réponse envoyée.'); return { ignored: true }; }
  // Fenêtre de 24 h : une réponse ne part que si le message reçu a moins de 24 h
  const sentAt = Number(m.timestamp) || Date.now();
  if (Date.now() - sentAt > M.MESSAGE_WINDOW_MS - 5 * 60 * 1000) { await finish(db, c.id, 'ignore', 'Hors de la fenêtre de réponse de 24 h de Meta : aucune réponse envoyée.'); return { ignored: true }; }
  if (!sita.limiter.take(`m:${channel}:${sender}`, S.getLimits().visitor).ok) { await finish(db, c.id, 'ignore', 'Trop de messages en peu de temps : pas de réponse.'); return { ignored: true }; }

  try {
    let reply;
    let conversationId = null;
    if (!text) {
      reply = 'Je ne peux lire que les messages écrits pour le moment. Pouvez-vous m’écrire votre question en quelques mots ?';
    } else {
      const ref = clip(m.referral?.ref || m.postback?.referral?.ref, 60);
      const out = await sita.handleMessage(db, {
        channel, visitorKey: `${channel}-${sender}`, externalId: sender, message: text, lang: S.looksEnglish(text) ? 'en' : 'fr',
        utm: ref ? { campaign: ref, medium: 'messagerie_payante' } : undefined,
      });
      conversationId = out.conversation_id;
      reply = out.reply;
      const wa = out.actions.find(a => a.type === 'whatsapp');
      if (wa) reply += `\n\n${wa.label} : ${wa.url}`;
    }
    if (conversationId) await db('sita_conversations').where({ id: conversationId }).update({ window_until: new Date(sentAt + M.MESSAGE_WINDOW_MS) });
    await graph.sendMessage(creds, { recipientId: sender, text: reply });
    const conv = conversationId ? await db('sita_conversations').where({ id: conversationId }).first('lead_id') : null;
    await finish(db, c.id, 'ok', 'Réponse envoyée.', { conversation_id: conversationId, lead_id: conv?.lead_id || null });
    return { conversation_id: conversationId };
  } catch (err) {
    await finish(db, c.id, 'erreur', graph.clean(err, creds));
    if (isAuthFailure(err)) await connectionFailure(db, channel === 'instagram' ? 'Messages Instagram' : 'Messages Messenger', err, creds);
    return { error: true };
  }
}

// ─── Commentaires publics ─────────────────────────────────────────────────

const LINK_RE = /(https?:\/\/|www\.)/i;

/** Réponse courte et fixe qui invite à écrire en privé : jamais d'IA, jamais le nom ni une donnée de la personne. */
async function handleComment(db, creds, channel, v) {
  const facebook = channel === 'facebook';
  const commentId = facebook ? v.comment_id : v.id;
  const from = String(v.from?.id || '');
  const text = String((facebook ? v.message : v.text) || '').trim();
  if (!commentId || (from && (from === creds.page_id || from === creds.instagram_id))) return null; // vide ou commentaire de la page elle-même
  const topLevel = facebook ? !v.parent_id || v.parent_id === v.post_id : !v.parent_id;
  const c = await claim(db, 'comment', commentId, { channel });
  if (!c.fresh) return { duplicate: true };
  if (!creds.comments_enabled) { await finish(db, c.id, 'ignore', 'Réponse aux commentaires désactivée dans les réglages.'); return { ignored: true }; }
  if (!creds.page_token) { await finish(db, c.id, 'erreur', 'Jeton d’accès de la page non renseigné : réponse impossible.'); return { error: true }; }
  if (!topLevel) { await finish(db, c.id, 'ignore', 'Réponse à un autre commentaire : pas de réponse automatique.'); return { ignored: true }; }
  if (text.length < 2 || LINK_RE.test(text)) { await finish(db, c.id, 'ignore', 'Commentaire vide ou contenant un lien : pas de réponse automatique.'); return { ignored: true }; }
  // Dates comparées en JavaScript (selon la base, les horodatages sont des dates, des nombres ou du texte)
  const since = Date.now() - 3600 * 1000;
  const recent = (await db('meta_events').where({ kind: 'comment', status: 'ok' }).orderBy('id', 'desc').limit(creds.comment_reply_max_per_hour + 1).select('updated_at')).filter(r => (toDate(r.updated_at)?.getTime() || 0) >= since);
  if (recent.length >= creds.comment_reply_max_per_hour) { await finish(db, c.id, 'ignore', 'Limite horaire de réponses atteinte.'); return { ignored: true }; }
  try {
    await graph.replyToComment(creds, { channel, commentId, message: creds.comment_reply_text });
    await finish(db, c.id, 'ok', 'Réponse publique envoyée (invitation à écrire en privé).');
    return { replied: true };
  } catch (err) {
    await finish(db, c.id, 'erreur', graph.clean(err, creds));
    if (isAuthFailure(err)) await connectionFailure(db, 'Commentaires', err, creds);
    return { error: true };
  }
}

// ─── Webhook ──────────────────────────────────────────────────────────────

/** Traite un POST de Meta (déjà authentifié par sa signature). Renvoie le nombre d'événements par issue. */
async function processWebhook(db, body) {
  const creds = await cfg.credentials(db);
  const out = { events: 0, ok: 0, duplicates: 0, ignored: 0, errors: 0 };
  const object = body?.object === 'instagram' ? 'instagram' : body?.object === 'page' ? 'page' : null;
  if (!object) return out;
  const tally = r => {
    if (r === null || r === undefined) return;
    out.events += 1;
    if (r.duplicate) out.duplicates += 1; else if (r.ignored) out.ignored += 1; else if (r.error) out.errors += 1; else out.ok += 1;
  };
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    // Seuls les événements de NOTRE page et de NOTRE compte Instagram sont traités
    const own = String(entry?.id || '') && [creds.page_id, creds.instagram_id].filter(Boolean).includes(String(entry.id));
    if (!own) continue;
    for (const ch of Array.isArray(entry.changes) ? entry.changes : []) {
      try {
        if (ch.field === 'leadgen') tally(await handleLead(db, creds, ch.value, entry.id));
        else if (object === 'page' && ch.field === 'feed' && ch.value?.item === 'comment' && ch.value?.verb === 'add') tally(await handleComment(db, creds, 'facebook', ch.value));
        else if (object === 'instagram' && ch.field === 'comments') tally(await handleComment(db, creds, 'instagram', ch.value || {}));
      } catch (err) { out.events += 1; out.errors += 1; await cfg.recordError(db, 'Webhook', graph.clean(err, creds)).catch(() => {}); }
    }
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      try { tally(await handleMessageEvent(db, creds, object === 'instagram' ? 'instagram' : 'messenger', m)); } catch (err) { out.events += 1; out.errors += 1; await cfg.recordError(db, 'Webhook', graph.clean(err, creds)).catch(() => {}); }
    }
  }
  return out;
}

// ─── Test de connexion ────────────────────────────────────────────────────

const NEEDED_SCOPES = {
  leads_retrieval: 'formulaires de publicité', pages_messaging: 'Messenger', pages_manage_metadata: 'abonnement de la page', pages_read_engagement: 'commentaires',
  pages_manage_engagement: 'réponse aux commentaires', instagram_manage_messages: 'messages Instagram', instagram_manage_comments: 'commentaires Instagram', ads_management: 'audiences',
};

/** Teste chaque connecteur renseigné (appel minimal à l'API Graph). Les connecteurs non renseignés ne font aucun appel. */
async function testConnection(db, user = null) {
  const creds = await cfg.credentials(db);
  const results = {};
  const attempt = async (key, fn) => {
    const missing = cfg.connectorStates(creds, null).find(x => x.key === key);
    if (!missing.configured) { results[key] = { state: 'non_configure', detail: missing.detail }; return; }
    try { results[key] = { state: 'ok', detail: (await fn()) || 'Connexion établie.' }; } catch (err) { results[key] = { state: 'erreur', detail: graph.clean(err, creds) }; }
  };
  await attempt('app', async () => `Application « ${(await graph.getApp(creds)).name || creds.app_id} ».`);
  await attempt('page', async () => {
    const page = await graph.getPage(creds);
    if (String(page.id) !== String(creds.page_id)) throw new Error('Le jeton ne correspond pas à l’identifiant de page saisi.');
    const notes = [`Page « ${page.name} ».`];
    if (creds.app_id && creds.app_secret) {
      const info = (await graph.debugToken(creds, creds.page_token).catch(() => null))?.data;
      if (info) {
        if (info.is_valid === false) throw new Error('Jeton expiré ou révoqué : générez-en un nouveau.');
        notes.push(info.expires_at ? `Jeton valable jusqu’au ${new Date(info.expires_at * 1000).toLocaleDateString('fr-FR')}.` : 'Jeton sans date d’expiration.');
        const lacking = Object.keys(NEEDED_SCOPES).filter(s => !(info.scopes || []).includes(s) && !(s === 'ads_management'));
        if (Array.isArray(info.scopes) && lacking.length) notes.push(`Autorisations manquantes : ${lacking.join(', ')}.`);
      }
    }
    const sub = await graph.getPageSubscription(creds).catch(() => null);
    if (sub) notes.push(sub.data?.length ? `Page abonnée : ${(sub.data[0].subscribed_fields || []).join(', ') || 'aucun champ'}.` : 'Page non abonnée aux événements : utilisez « Abonner la page ».');
    return notes.join(' ');
  });
  await attempt('instagram', async () => `Compte Instagram « ${(await graph.getInstagram(creds)).username || creds.instagram_id} ».`);
  await attempt('ads', async () => { const a = await graph.getAdAccount(creds); return `Compte publicitaire « ${a.name || a.id} ».`; });
  await attempt('pixel', async () => `Pixel « ${(await graph.getPixel(creds)).name || creds.pixel_id} ».`);
  await attempt('webhook', async () => {
    const base = 'Jeton de vérification et secret enregistrés.';
    if (!(creds.app_id && creds.app_secret)) return base;
    const subs = await graph.getSubscriptions(creds).catch(() => null);
    const url = cfg.webhookUrl();
    const registered = (subs?.data || []).some(s => s.callback_url === url);
    return registered ? `${base} Adresse déclarée chez Meta.` : `${base} Adresse non déclarée chez Meta : ${url}`;
  });
  await cfg.saveTest(db, results);
  await db('meta_events').insert({ kind: 'test', status: Object.values(results).some(r => r.state === 'erreur') ? 'erreur' : 'ok', detail: clip(Object.entries(results).map(([k, r]) => `${k} : ${r.state}`).join(' · '), 500), user_id: user?.id || null });
  const failed = Object.entries(results).filter(([, r]) => r.state === 'erreur');
  if (failed.length) await connectionFailure(db, 'Test de connexion', failed.map(([k, r]) => `${M.CONNECTORS[k].label} : ${r.detail}`).join(' · '), creds);
  else await cfg.clearError(db).catch(() => {});
  return { at: new Date().toISOString(), connectors: cfg.connectorStates(creds, { at: new Date().toISOString(), results }) };
}

/** Abonne la page aux événements du webhook (formulaires, messages, commentaires). */
async function subscribe(db, user = null) {
  const creds = await cfg.credentials(db);
  if (!creds.page_id || !creds.page_token) throw new HttpError(409, 'Renseignez d’abord l’identifiant et le jeton de la page.');
  const fields = ['leadgen', 'feed', 'messages', 'messaging_postbacks'];
  try { await graph.subscribePage(creds, fields); } catch (err) { throw new HttpError(502, `Abonnement refusé par Meta : ${graph.clean(err, creds)}`); }
  await db('meta_events').insert({ kind: 'test', status: 'ok', detail: `Page abonnée aux événements : ${fields.join(', ')}`, user_id: user?.id || null });
  return { subscribed: fields };
}

// ─── Journal et tableau de bord ───────────────────────────────────────────

const KIND_LABELS = { lead: 'Formulaire de publicité', message: 'Message', comment: 'Commentaire', test: 'Test de connexion', export: 'Export d’audience', audience: 'Audience envoyée à Meta' };
const STATUS_LABELS = { recu: 'En cours', ok: 'Traité', ignore: 'Ignoré', erreur: 'Erreur' };

async function events(db, { kind = null, limit = 60 } = {}) {
  const q = db('meta_events as e').leftJoin('users as u', 'u.id', 'e.user_id').orderBy('e.id', 'desc').limit(Math.min(Number(limit) || 60, 200))
    .select('e.id', 'e.kind', 'e.status', 'e.channel', 'e.lead_id', 'e.conversation_id', 'e.detail', 'e.created_at', 'u.name as user_name');
  if (kind) q.where('e.kind', kind);
  return (await q).map(e => ({ ...e, kind_label: KIND_LABELS[e.kind] || e.kind, status_label: STATUS_LABELS[e.status] || e.status, created_at: isoTime(e.created_at) }));
}

/** Prospects par canal Meta, coût de l'IA de ces conversations, état des connecteurs. */
async function overview(db) {
  const creds = await cfg.credentials(db);
  const month = monthOf();
  const from = `${month}-01`;
  const sitaSettings = await sita.getSettings(db);
  const count = async (q) => Number((await q.count({ n: '*' }).first())?.n || 0);
  const convs = async (channel, since = null) => {
    const base = () => { const q = db('sita_conversations').where({ channel }); if (since) q.where('created_at', '>=', since); return q; };
    return { conversations: await count(base()), prospects: await count(base().whereNotNull('lead_id')) };
  };
  const leadAds = { month: await count(db('leads').where({ source: 'meta_lead' }).where('created_at', '>=', from)), total: await count(db('leads').where({ source: 'meta_lead' })) };
  const [msgrM, msgrT, igM, igT, siteM, siteT] = await Promise.all([convs('messenger', from), convs('messenger'), convs('instagram', from), convs('instagram'), convs('site', from), convs('site')]);
  const siteForms = { month: await count(db('leads').whereIn('source', ['site', 'plan']).where('created_at', '>=', from)), total: await count(db('leads').whereIn('source', ['site', 'plan'])) };
  const cost = Number((await db('sita_messages as m').join('sita_conversations as c', 'c.id', 'm.conversation_id').where('m.month', month).whereNot('c.channel', 'site').sum({ s: 'm.cost_micro_usd' }).first())?.s || 0);
  const errors = (await db('meta_events').where({ status: 'erreur' }).orderBy('id', 'desc').limit(500).select('created_at')).filter(r => (toDate(r.created_at)?.getTime() || 0) >= Date.now() - 30 * 86400000).length;
  const states = cfg.connectorStates(creds, await cfg.lastTest(db));
  return {
    month,
    channels: [
      { key: 'lead_ads', label: 'Formulaires de publicité (Lead Ads)', prospects_month: leadAds.month, prospects_total: leadAds.total },
      { key: 'messenger', label: 'Messenger', conversations_month: msgrM.conversations, prospects_month: msgrM.prospects, conversations_total: msgrT.conversations, prospects_total: msgrT.prospects },
      { key: 'instagram', label: 'Instagram', conversations_month: igM.conversations, prospects_month: igM.prospects, conversations_total: igT.conversations, prospects_total: igT.prospects },
      { key: 'site', label: 'Site et pixel (formulaires et Sita du site)', conversations_month: siteM.conversations, prospects_month: siteForms.month + siteM.prospects, conversations_total: siteT.conversations, prospects_total: siteForms.total + siteT.prospects },
    ],
    ai_cost: { micro_usd: cost, fcfa: microUsdToFcfa(cost, sitaSettings.usd_fcfa) },
    connectors: states, connected: states.some(c => c.configured), errors_30d: Number(errors), last_error: await cfg.lastError(db),
    pixel: { configured: !!creds.pixel_id, enabled: !!creds.pixel_enabled && !!creds.pixel_id, consent_required: !!creds.pixel_consent_required },
    events: await events(db, { limit: 8 }),
  };
}

/** Configuration publique du pixel pour le site (jamais un secret) : identifiant seulement s'il est renseigné et activé. */
async function publicPixel(db) {
  const s = await cfg.settings(db);
  if (!s.pixel_enabled || !s.pixel_id) return { pixel: null };
  return { pixel: { id: s.pixel_id, consent_required: s.pixel_consent_required } };
}

module.exports = { claim, processWebhook, handleLead, handleMessageEvent, handleComment, testConnection, subscribe, events, overview, publicPixel, connectionFailure, KIND_LABELS };
