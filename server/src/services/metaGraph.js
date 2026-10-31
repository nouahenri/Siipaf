/**
 * Client minimal de l'API Graph de Meta (canaux officiels uniquement). Le client HTTP est INJECTABLE : les tests appellent
 * setHttp(fauxClient) et ne touchent jamais le réseau ; par défaut, le fetch de Node. Aucun appel n'est tenté sans identifiants.
 * Les jetons ne sont jamais écrits dans un message d'erreur, un journal ou une réponse (clean). Les appels portent l'appsecret_proof
 * quand le secret de l'application est connu (recommandé par Meta).
 * `http({ method, url, path, query, body })` renvoie { status, json }.
 */
const M = require('../lib/meta');

let override = null;
/** Remplace le client HTTP (tests) ; setHttp(null) rétablit le client réel. */
const setHttp = fn => { override = fn; };

async function realHttp({ method, url, body }) {
  const res = await fetch(url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* corps vide ou non JSON */ }
  return { status: res.status, json: payload };
}

class MetaError extends Error {
  constructor(message, { status = 502, code = null, subcode = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

/** Texte sans aucun jeton ni secret connu. */
function clean(value, creds = {}) {
  let text = String((value && value.message) || value || 'Erreur inconnue');
  for (const k of ['page_token', 'ads_token', 'app_secret', 'verify_token']) if (creds[k]) text = text.split(creds[k]).join('[masqué]');
  return text.replace(/access_token=[^&\s"']+/gi, 'access_token=[masqué]').replace(/appsecret_proof=[^&\s"']+/gi, 'appsecret_proof=[masqué]').replace(/EAA[A-Za-z0-9]{20,}/g, '[jeton masqué]').slice(0, 400);
}

/** Appel de l'API Graph. `token` : jeton à employer ; `creds` : réglages (version, secret de l'application). */
async function graph(creds, { method = 'GET', path, query = {}, body = null, token }) {
  if (!token) throw new MetaError('Jeton d’accès non renseigné : connecteur non connecté.', { status: 409, code: 'non_connecte' });
  const version = creds.graph_version || M.DEFAULT_GRAPH_VERSION;
  const full = `/${version}/${String(path).replace(/^\/+/, '')}`;
  const auth = { access_token: token };
  if (creds.app_secret && !String(token).includes('|')) auth.appsecret_proof = M.appSecretProof(token, creds.app_secret);
  let url = `${M.GRAPH_URL}${full}`;
  let payload = null;
  let q = query;
  if (method === 'GET') q = { ...query, ...auth };
  else payload = { ...(body || {}), ...auth };
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])).toString();
  if (qs) url += `?${qs}`;
  let res;
  try {
    res = await (override || realHttp)({ method, url, path: full, query: q, body: payload });
  } catch (err) {
    throw new MetaError(`API Graph injoignable : ${clean(err, creds)}`, { status: 502, code: 'reseau' });
  }
  const data = res?.json ?? null;
  if (!res || res.status >= 400 || data?.error) {
    const e = data?.error || {};
    throw new MetaError(`Meta${e.code ? ` (${e.code})` : ''} : ${clean(e.message || `réponse ${res?.status}`, creds)}`, { status: res?.status >= 400 ? res.status : 502, code: e.code || null, subcode: e.error_subcode || null });
  }
  return data;
}

const pageToken = c => c.page_token;
const adsToken = c => c.ads_token || c.page_token;
const appToken = c => (c.app_id && c.app_secret ? `${c.app_id}|${c.app_secret}` : null);

// ─── Opérations ───────────────────────────────────────────────────────────

/** Formulaire de publicité reçu : champs saisis et annonce d'origine. */
const getLead = (c, leadgenId) => graph(c, {
  path: String(leadgenId), token: pageToken(c),
  query: { fields: 'created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,platform,is_organic' },
});

/** Message privé (Messenger : page ; Instagram : compte lié à la page), dans la fenêtre de 24 h. */
const sendMessage = (c, { recipientId, text }) => graph(c, {
  method: 'POST', path: `${c.page_id}/messages`, token: pageToken(c),
  body: { recipient: { id: String(recipientId) }, messaging_type: 'RESPONSE', message: { text: String(text).slice(0, M.MAX_TEXT) } },
});

/** Réponse publique à un commentaire (Facebook : /comments ; Instagram : /replies). */
const replyToComment = (c, { channel, commentId, message }) => graph(c, {
  method: 'POST', path: `${commentId}/${channel === 'instagram' ? 'replies' : 'comments'}`, token: pageToken(c), body: { message: String(message).slice(0, 500) },
});

const getPage = c => graph(c, { path: c.page_id, token: pageToken(c), query: { fields: 'id,name' } });
const getInstagram = c => graph(c, { path: c.instagram_id, token: pageToken(c), query: { fields: 'id,username' } });
const getAdAccount = c => graph(c, { path: `act_${c.ad_account_id}`, token: adsToken(c), query: { fields: 'id,name,account_status' } });
const getPixel = c => graph(c, { path: c.pixel_id, token: adsToken(c), query: { fields: 'id,name' } });
const getApp = c => graph(c, { path: c.app_id, token: appToken(c), query: { fields: 'id,name' } });
const debugToken = (c, token) => graph(c, { path: 'debug_token', token: appToken(c), query: { input_token: token } });
/** Abonne la page aux événements reçus par le webhook (formulaires, messages, commentaires). */
const subscribePage = (c, fields) => graph(c, { method: 'POST', path: `${c.page_id}/subscribed_apps`, token: pageToken(c), body: { subscribed_fields: fields.join(',') } });
const getPageSubscription = c => graph(c, { path: `${c.page_id}/subscribed_apps`, token: pageToken(c) });
const getSubscriptions = c => graph(c, { path: `${c.app_id}/subscriptions`, token: appToken(c) });

/** Audience personnalisée (liste de clients, audience d'interaction). */
const createCustomAudience = (c, body) => graph(c, { method: 'POST', path: `act_${c.ad_account_id}/customaudiences`, token: adsToken(c), body });
/** Ajoute des personnes (identifiants déjà hachés en SHA-256) à une audience. */
const addAudienceUsers = (c, audienceId, rows) => graph(c, {
  method: 'POST', path: `${audienceId}/users`, token: adsToken(c),
  body: { payload: { schema: ['EMAIL_SHA256', 'PHONE_SHA256'], data: rows } },
});
const createLookalike = (c, { name, originId, country, ratio }) => graph(c, {
  method: 'POST', path: `act_${c.ad_account_id}/customaudiences`, token: adsToken(c),
  body: { name, subtype: 'LOOKALIKE', origin_audience_id: String(originId), lookalike_spec: JSON.stringify({ type: 'similarity', country, ratio }) },
});

module.exports = {
  setHttp, MetaError, clean, graph, getLead, sendMessage, replyToComment, getPage, getInstagram, getAdAccount, getPixel, getApp, debugToken, getSubscriptions, subscribePage, getPageSubscription,
  createCustomAudience, addAudienceUsers, createLookalike,
};
