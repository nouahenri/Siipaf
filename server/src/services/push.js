/**
 * Notifications push de l'application mobile SIIPAF (service Expo : https://exp.host/--/api/v2/push/send).
 * - Un téléphone s'inscrit à la connexion (POST /api/client/push) et se désinscrit à la déconnexion.
 * - Tout message de l'équipe dans l'espace client (services/clients.js : tellClient) envoie aussi un push, selon le choix du
 *   client dans son profil (`push_prefs`). Le push ne contient jamais le détail (montants, documents) : il reste dans l'app,
 *   comme pour l'e-mail « nouveau message ».
 * - Jeton d'accès Expo facultatif (`EXPO_ACCESS_TOKEN`) si la sécurité des envois est activée sur le compte Expo.
 * - Annonces pour tous (« Recevoir des notifications push » dans Paramètres de l'app, connecté ou non) : les téléphones
 *   s'inscrivent dans `app_devices` (POST /api/public/devices) et l'équipe envoie depuis Newsletter › Notifications de l'app,
 *   à tous ou à la ville préférée choisie dans l'app ; le toucher ouvre le programme annoncé.
 * En test, rien ne part : `setTransport` permet de relire les envois.
 */
const { z } = require('../lib/zod');
const { json, HttpError } = require('../lib/http');
const { isTest } = require('../config');

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
// Catégories réglables par le client (Profil › Notifications) et écran ouvert au toucher
const PUSH_KINDS = {
  message: { label: 'Messages de votre conseiller', screen: 'messages' },
  paiements: { label: 'Versements, échéancier et appels de fonds', screen: 'paiements' },
  chantier: { label: 'Avancement du chantier et livraison', screen: 'chantier' },
  documents: { label: 'Documents et dossier juridique', screen: 'documents' },
  sav: { label: 'Service après-vente', screen: 'sav' },
};
const DEFAULT_TITLES = {
  message: 'Nouveau message de SIIPAF',
  paiements: 'Mise à jour de vos paiements',
  chantier: 'Nouvelles de votre chantier',
  documents: 'Votre dossier avance',
  sav: 'Suivi de votre demande SAV',
};
const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,120}\]$/;

const tokenSchema = z.object({ token: z.string().trim().regex(TOKEN, 'Jeton de notification invalide.'), platform: z.enum(['ios', 'android', 'web']).optional() });
const deviceSchema = tokenSchema.extend({ city_id: z.number().int().positive().nullable().optional(), language: z.enum(['fr', 'en', 'es']).optional() });
const announceSchema = z.object({
  title: z.string().trim().min(3, 'Titre : 3 caractères minimum.').max(80, 'Titre : 80 caractères au plus.'),
  body: z.string().trim().min(5, 'Texte : 5 caractères minimum.').max(240, 'Texte : 240 caractères au plus (au-delà, le téléphone le coupe).'),
  project_id: z.number().int().positive().nullable().optional(),
  city_id: z.number().int().positive().nullable().optional(),
});
const prefsSchema = z.object(Object.fromEntries(Object.keys(PUSH_KINDS).map(k => [k, z.boolean().optional()]))).strict();

let transport = async messages => {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const res = await fetch(EXPO_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
  const out = await res.json().catch(() => ({}));
  return Array.isArray(out.data) ? out.data : [];
};
/** Tests : remplace l'envoi réel (renvoie l'ancien). */
const setTransport = fn => { const old = transport; transport = fn; return old; };
let sendInTest = false;
const enableInTest = on => { sendInTest = on; };

/** Préférences du client : toutes les catégories activées par défaut. */
const readPrefs = account => {
  const p = json(account?.push_prefs, {}) || {};
  return Object.fromEntries(Object.keys(PUSH_KINDS).map(k => [k, p[k] !== false]));
};

async function register(db, accountId, { token, platform }) {
  const existing = await db('client_push_tokens').where({ token }).first();
  // Un téléphone passé d'un compte à un autre (connexion d'un autre client) change de propriétaire
  if (existing) await db('client_push_tokens').where({ id: existing.id }).update({ account_id: accountId, platform: platform || existing.platform, last_seen_at: new Date() });
  else await db('client_push_tokens').insert({ account_id: accountId, token, platform: platform || null });
}

const unregister = (db, accountId, token) => db('client_push_tokens').where({ account_id: accountId, token }).del();

async function savePrefs(db, account, patch) {
  const prefs = { ...readPrefs(account), ...patch };
  await db('client_accounts').where({ id: account.id }).update({ push_prefs: JSON.stringify(prefs), updated_at: new Date() });
  return prefs;
}

/**
 * Prépare le push vers les téléphones de l'acquéreur `leadId` (compte actif, catégorie activée) puis l'envoie sans attendre.
 * `kind` : message | paiements | chantier | documents | sav ; `saleId` : dossier à ouvrir.
 * Appelé dans une transaction, l'envoi attend sa validation (rien ne part si elle est annulée).
 * Renvoie { queued, done } : `done` donne le nombre d'envois acceptés par Expo (les tests l'attendent, les routes non).
 */
async function notifyLead(db, leadId, { kind = 'message', title, body, saleId = null } = {}) {
  if (isTest && !sendInTest) return { queued: 0, done: Promise.resolve(0) };
  const k = PUSH_KINDS[kind] ? kind : 'message';
  const account = await db('client_accounts').where({ lead_id: leadId, active: true }).first('id', 'push_prefs');
  if (!account || !readPrefs(account)[k]) return { queued: 0, done: Promise.resolve(0) };
  const tokens = await db('client_push_tokens').where({ account_id: account.id }).pluck('token');
  if (!tokens.length) return { queued: 0, done: Promise.resolve(0) };
  const messages = tokens.map(to => ({
    to, sound: 'default', channelId: 'default', priority: 'high',
    title: title || DEFAULT_TITLES[k], body: body || 'Ouvrez l’application SIIPAF pour voir le détail.',
    data: { screen: PUSH_KINDS[k].screen, sale_id: saleId || null },
  }));
  const send = () => deliver(db.isTransaction ? null : db, messages);
  const done = (db.isTransaction && db.executionPromise ? db.executionPromise.then(send, () => 0) : send()).catch(() => 0);
  return { queued: messages.length, done };
}

/** Téléphone qui reçoit les annonces (inscription ou mise à jour de la ville et de la langue). */
async function registerDevice(db, { token, platform, city_id = null, language = null }) {
  const row = { platform: platform || null, city_id: city_id || null, language: language || null, last_seen_at: new Date() };
  const existing = await db('app_devices').where({ token }).first('id');
  if (existing) await db('app_devices').where({ id: existing.id }).update(row);
  else await db('app_devices').insert({ token, ...row });
}
const removeDevice = (db, token) => db('app_devices').where({ token }).del();

/** Appareils visés par une annonce : tous, ou ceux dont la ville préférée est `cityId`. */
const audience = (db, cityId) => db('app_devices').modify(q => { if (cityId) q.where({ city_id: cityId }); });

/**
 * Annonce envoyée depuis le dashboard : enregistrée dans l'historique, puis envoyée sans attendre. Le toucher ouvre le
 * programme (`url` : /projet/<slug>) ou l'accueil. Renvoie { id, recipients, done } ; `done` met à jour le nombre
 * d'envois acceptés par Expo.
 */
async function announce(db, { title, body, project_id = null, city_id = null }, userId = null) {
  const project = project_id ? await db('projects').where({ id: project_id, published: true }).whereNull('archived_at').first('id', 'slug') : null;
  if (project_id && !project) throw new HttpError(400, 'Programme introuvable ou non publié.');
  const tokens = await audience(db, city_id).pluck('token');
  if (!tokens.length) return { id: null, recipients: 0, done: Promise.resolve(0) }; // rien n'est enregistré ni envoyé
  const [inserted] = await db('app_announcements').insert({ title, body, project_id: project?.id || null, city_id: city_id || null, recipients: tokens.length, created_by: userId });
  const id = typeof inserted === 'object' ? inserted.id : inserted;
  const messages = tokens.map(to => ({ to, sound: 'default', channelId: 'default', priority: 'high', title, body, data: { url: project ? `/projet/${project.slug}` : '/', announcement_id: id } }));
  const run = isTest && !sendInTest ? Promise.resolve(0) : deliver(db, messages);
  const done = run.then(async sent => { await db('app_announcements').where({ id }).update({ sent }); return sent; }).catch(() => 0);
  return { id, recipients: tokens.length, done };
}

async function deliver(db, messages) {
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const tickets = await transport(chunk);
    // Téléphone désinscrit (application supprimée, notifications coupées) : le jeton est effacé
    const gone = tickets.map((t, j) => (t?.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? chunk[j].to : null)).filter(Boolean);
    if (gone.length && db) {
      await db('client_push_tokens').whereIn('token', gone).del();
      await db('app_devices').whereIn('token', gone).del();
    }
    sent += tickets.filter(t => t?.status === 'ok').length;
  }
  return sent;
}

module.exports = { PUSH_KINDS, DEFAULT_TITLES, tokenSchema, deviceSchema, announceSchema, registerDevice, removeDevice, audience, announce, prefsSchema, readPrefs, register, unregister, savePrefs, notifyLead, setTransport, enableInTest };
