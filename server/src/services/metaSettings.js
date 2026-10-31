/**
 * Réglages des connecteurs Meta (Marketing › Réglages, droit marketing:settings). Les identifiants non secrets et les options sont
 * enregistrés en clair dans `meta_settings` ; les secrets (secret de l'application, jetons de page et du compte publicitaire, jeton
 * de vérification des webhooks) y sont CHIFFRÉS (lib/secrets.js, AES-256-GCM) et ne sortent jamais du serveur : la vue montre
 * seulement « présent … 4 derniers caractères ». `credentials()` (usage interne des services Meta) est la seule fonction qui les déchiffre.
 * Tant que rien n'est saisi, tout reste « non connecté » : aucun appel réseau, aucune erreur.
 */
const { json } = require('../lib/http');
const { clientAppUrl } = require('../config');
const secrets = require('../lib/secrets');
const M = require('../lib/meta');

async function load(db) {
  const rows = await db('meta_settings').select('key', 'value', 'secret');
  return Object.fromEntries(rows.map(r => [r.key, r]));
}

/** Réglages non secrets, complétés par les valeurs par défaut. */
function plain(rows) {
  const out = { ...M.DEFAULTS };
  for (const key of Object.keys(M.DEFAULTS)) {
    const row = rows[key];
    if (!row || row.value == null) continue;
    const def = M.DEFAULTS[key];
    if (typeof def === 'boolean') out[key] = row.value === '1';
    else if (typeof def === 'number') out[key] = Number.isFinite(Number(row.value)) ? Number(row.value) : def;
    else out[key] = String(row.value);
  }
  return out;
}

async function settings(db) {
  return plain(await load(db));
}

/** Réglages + secrets déchiffrés : réservé aux services Meta du serveur, jamais renvoyé tel quel. */
async function credentials(db) {
  const rows = await load(db);
  const out = plain(rows);
  for (const key of Object.keys(M.SECRET_FIELDS)) out[key] = rows[key]?.value ? secrets.decrypt(rows[key].value) || '' : '';
  return out;
}

async function put(db, key, value, secret = false) {
  const row = { value: value == null ? null : String(value), secret, updated_at: new Date() };
  if (await db('meta_settings').where({ key }).first()) await db('meta_settings').where({ key }).update(row);
  else await db('meta_settings').insert({ key, ...row });
}

/** Enregistre un lot de modifications validé. Secret à null : effacé ; absent : conservé. Renvoie les clés modifiées. */
async function save(db, patch) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key in M.SECRET_FIELDS) {
      if (value === null) await db('meta_settings').where({ key }).del();
      else await put(db, key, secrets.encrypt(value), true);
    } else if (typeof M.DEFAULTS[key] === 'boolean') await put(db, key, value ? '1' : '0');
    else await put(db, key, value);
    changed.push(key);
  }
  return changed;
}

/** Connecteurs : renseigné ou non, et résultat du dernier test (jamais de secret). */
function connectorStates(creds, lastTest) {
  const has = k => !!creds[k];
  return Object.entries(M.CONNECTORS).map(([key, c]) => {
    const missing = c.needs.filter(n => !has(n));
    if (c.tokenAny && !c.tokenAny.some(has)) missing.push(c.tokenAny.map(k => M.SECRET_FIELDS[k] || k).join(' ou '));
    const tested = lastTest?.results?.[key];
    const configured = missing.length === 0;
    const state = !configured ? 'non_configure' : tested ? tested.state : 'a_tester';
    return { key, label: c.label, used_for: c.usedFor, configured, state, detail: configured ? tested?.detail || null : `À renseigner : ${missing.map(n => M.ID_FIELDS[n] || M.SECRET_FIELDS[n] || n).join(', ')}`, tested_at: tested ? lastTest.at : null };
  });
}

const webhookUrl = () => `${clientAppUrl}/api/public/meta/webhook`;

async function lastTest(db) {
  return json((await db('meta_settings').where({ key: 'last_test' }).first())?.value, null);
}
async function lastError(db) {
  return json((await db('meta_settings').where({ key: 'last_error' }).first())?.value, null);
}

/** Vue pour l'écran Réglages : valeurs non secrètes, secrets masqués, connecteurs, adresses à déclarer chez Meta. */
async function view(db) {
  const rows = await load(db);
  const creds = await credentials(db);
  const test = await lastTest(db);
  const connectors = connectorStates(creds, test);
  const values = plain(rows);
  return {
    values,
    secrets: Object.fromEntries(Object.keys(M.SECRET_FIELDS).map(k => [k, { ...secrets.mask(creds[k]), unreadable: !!rows[k]?.value && !creds[k] }])),
    labels: { ids: M.ID_FIELDS, secrets: M.SECRET_FIELDS, flags: M.FLAG_FIELDS },
    connectors, connected: connectors.some(c => c.configured),
    webhook: { url: webhookUrl(), verify_ready: !!creds.verify_token, signature_ready: !!creds.app_secret, fields: { page: ['leadgen', 'feed', 'messages', 'messaging_postbacks'], instagram: ['messages', 'comments'] } },
    last_test: test ? { at: test.at } : null, last_error: await lastError(db), defaults: { comment_reply_text: M.DEFAULT_COMMENT_REPLY },
  };
}

/** Dernière erreur d'un connecteur (affichée au tableau de bord) : message nettoyé, jamais de jeton. */
async function recordError(db, where, message) {
  await put(db, 'last_error', JSON.stringify({ at: new Date().toISOString(), where, message: String(message).slice(0, 300) }));
}
async function clearError(db) {
  await db('meta_settings').where({ key: 'last_error' }).del();
}
async function saveTest(db, results) {
  await put(db, 'last_test', JSON.stringify({ at: new Date().toISOString(), results }));
}

module.exports = { settings, credentials, save, view, connectorStates, lastTest, lastError, recordError, clearError, saveTest, webhookUrl };
