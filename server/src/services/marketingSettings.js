/**
 * Réglages du Marketing & Communication : nombres (plafond en FCFA, taux, alerte, jetons, préparation hebdomadaire) dans
 * app_settings via lib/domain.js (MODULE_SETTINGS.marketing) ; texte (modèle, ton, consignes, mots interdits, canaux,
 * arrêt d'urgence) dans marketing_settings. La clé de l'IA n'est JAMAIS enregistrée ici : elle vient de ANTHROPIC_API_KEY (server/.env).
 */
const moduleSettings = require('./moduleSettings');
const { json } = require('../lib/http');
const { CHANNELS, MODELS, DEFAULT_MODEL } = require('../lib/marketing');

const DEFAULTS = { model: DEFAULT_MODEL, tone: '', brand_notes: '', banned_words: [], channels: ['facebook', 'linkedin', 'instagram', 'whatsapp'], emergency_stop: false };

async function textSettings(db) {
  const rows = await db('marketing_settings').select('key', 'value');
  const raw = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const channels = json(raw.channels, null);
  return {
    model: MODELS[raw.model] ? raw.model : DEFAULTS.model,
    tone: raw.tone || '',
    brand_notes: raw.brand_notes || '',
    banned_words: json(raw.banned_words, []).filter(w => typeof w === 'string' && w.trim()).map(w => w.trim()),
    channels: Array.isArray(channels) ? channels.filter(c => CHANNELS[c]) : DEFAULTS.channels,
    emergency_stop: raw.emergency_stop === '1',
  };
}

async function putText(db, key, value) {
  const row = { value: value == null ? null : String(value), updated_at: new Date() };
  if (await db('marketing_settings').where({ key }).first()) await db('marketing_settings').where({ key }).update(row);
  else await db('marketing_settings').insert({ key, ...row });
}

async function saveTextSettings(db, data) {
  const map = {
    model: data.model, tone: data.tone, brand_notes: data.brand_notes,
    banned_words: data.banned_words == null ? undefined : JSON.stringify(data.banned_words),
    channels: data.channels == null ? undefined : JSON.stringify(data.channels),
    emergency_stop: data.emergency_stop == null ? undefined : data.emergency_stop ? '1' : '0',
  };
  for (const [k, v] of Object.entries(map)) if (v !== undefined) await putText(db, k, v);
  return textSettings(db);
}

/** Nombres et texte réunis. */
async function all(db) {
  return { ...(await moduleSettings.values(db, 'marketing')), ...(await textSettings(db)) };
}

module.exports = { textSettings, saveTextSettings, all, DEFAULTS };
