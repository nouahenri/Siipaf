/**
 * Voix de Sita (choix du client du 06/11/2026) : synthèse Gemini 3.8 Flash TTS des réponses de l'assistante, pour l'application
 * mobile et la bulle du site. Règles :
 * - seules les réponses de Sita sont lues, et seulement pour le visiteur de la conversation (pas de synthèse de texte libre :
 *   la route ne peut pas servir de service de voix gratuit) ; le message d'accueil a sa propre entrée ;
 * - l'audio est gardé sur le disque (server/data/sita-voix) : une réécoute ne coûte rien ;
 * - le coût s'ajoute au message (donc à la dépense du mois et au plafond de Sita) ; plafond atteint, arrêt d'urgence, voix coupée
 *   ou clé absente : refus 409 (sans détail), l'application et le site lisent alors la réponse avec la voix du téléphone ou du navigateur ;
 * - clé GEMINI_API_KEY lue dans server/.env, envoyée dans l'en-tête x-goog-api-key, jamais affichée ni journalisée.
 * Les tests n'appellent jamais le réseau : setHttp(fauxFetch), setCacheDir(dossierTemporaire).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const S = require('../lib/sita');
const { HttpError } = require('../lib/http');
const { monthOf } = require('../lib/marketing');

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 30000;
const MAX_CHARS = 1500;

let http = null;
let cacheDir = path.join(__dirname, '..', '..', 'data', 'sita-voix');
/** Remplace fetch (tests) ; setHttp(null) rétablit fetch. */
const setHttp = fn => { http = fn; };
/** Dossier des audios gardés (tests). */
const setCacheDir = dir => { cacheDir = dir; };

const apiKey = () => String(process.env.GEMINI_API_KEY || '').trim();
const clean = value => {
  let text = String((value && value.message) || value || 'Erreur inconnue');
  const key = apiKey();
  if (key) text = text.split(key).join('[clé masquée]');
  return text.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[clé masquée]').slice(0, 300);
};

/** Texte lisible à voix haute : sans liens, adresses, mise en forme ni émojis ; « FCFA » prononcé. */
function speakable(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>|~]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\bFCFA\b/g, 'francs CFA')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
}

/** En-tête WAV pour de l'audio PCM 16 bits mono (forme « audio/L16;rate=24000 » de Google). */
function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Appel de Google : renvoie l'audio WAV et les jetons consommés. */
async function synthesize(text, { name, style }) {
  const key = apiKey();
  if (!key) throw new HttpError(409, 'Voix de Sita indisponible (clé Gemini absente).');
  const body = {
    contents: [{ role: 'user', parts: [{ text: S.ttsPrompt(style, text) }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: name } } } },
  };
  // Modèle principal, puis la version « lite » si Google est surchargé ou en panne (429, 5xx, délai) : même voix, même schéma
  let json = null;
  let lastError = 'erreur inconnue';
  for (const model of [S.TTS_MODEL, S.TTS_MODEL_LITE]) {
    let res;
    try {
      res = await (http || fetch)(`${API}/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) { lastError = clean(e); continue; }
    const out = await res.json().catch(() => ({}));
    if (res.ok) { json = out; break; }
    lastError = clean(out?.error?.message || `erreur ${res.status}`);
    if (res.status !== 429 && res.status < 500) break; // demande refusée (clé, contenu) : inutile d'insister
  }
  if (!json) throw new HttpError(409, `Voix de Sita indisponible : ${lastError}`);
  const part = (json.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
  if (!part) throw new HttpError(409, 'Voix de Sita indisponible : réponse sans audio.');
  const bytes = Buffer.from(part.inlineData.data, 'base64');
  const mime = String(part.inlineData.mimeType || '').toLowerCase();
  const rate = Number((mime.match(/rate=(\d+)/) || [])[1]) || 24000;
  const wav = mime.includes('wav') || bytes.slice(0, 4).toString() === 'RIFF' ? bytes : pcmToWav(bytes, rate);
  const u = json.usageMetadata || {};
  return { wav, tokensIn: Number(u.promptTokenCount || 0), tokensOut: Number(u.candidatesTokenCount || 0) };
}

/** Voix utilisable maintenant (réglages, plafond du mois) ; sinon refus 409 pour le secours du téléphone. */
async function ensureAllowed(db, settings, text) {
  if (!settings.enabled || !settings.voice) throw new HttpError(409, 'La voix de Sita est coupée.');
  if (settings.emergency_stop) throw new HttpError(409, 'Sita est en arrêt d’urgence.');
  const { monthSpendMicro } = require('./sitaAi');
  const capMicro = Math.round((settings.cap_fcfa / settings.usd_fcfa) * 1e6);
  // Estimation prudente : 12 caractères par seconde de parole, 25 jetons audio par seconde
  const estimate = S.ttsCostMicroUsd(Math.ceil(text.length / 3), Math.ceil((text.length / 12) * 25));
  if (settings.cap_fcfa <= 0 || (await monthSpendMicro(db, monthOf())) + estimate > capMicro) {
    throw new HttpError(409, 'Plafond mensuel de Sita atteint : voix du téléphone.');
  }
}

const fileFor = (voice, text) => path.join(cacheDir, `${crypto.createHash('sha256').update(`${S.TTS_MODEL}|${voice.name}|${voice.style}|${text}`).digest('hex').slice(0, 40)}.wav`);

/** Audio gardé, sinon synthèse puis enregistrement ; `charge(coût)` reporte le coût sur la ligne concernée. */
async function cached(db, settings, text, voice, charge) {
  const file = fileFor(voice, text);
  if (fs.existsSync(file)) return file;
  await ensureAllowed(db, settings, text);
  const out = await synthesize(text, voice);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, out.wav);
  await charge(S.ttsCostMicroUsd(out.tokensIn, out.tokensOut));
  return file;
}

/** Réponse de Sita (message de la conversation de ce visiteur) → fichier WAV. */
async function forMessage(db, { visitorKey, messageId }) {
  const { getSettings } = require('./sita');
  const settings = await getSettings(db);
  const m = await db('sita_messages as m').join('sita_conversations as c', 'c.id', 'm.conversation_id')
    .where({ 'm.id': messageId, 'm.role': 'assistante', 'c.visitor_key': visitorKey }).first('m.id', 'm.content', 'm.cost_micro_usd', 'c.id as conversation_id');
  if (!m) throw new HttpError(404, 'Réponse introuvable.');
  const text = speakable(m.content);
  if (!text) throw new HttpError(404, 'Rien à lire.');
  return cached(db, settings, text, S.ttsVoice(settings), async cost => {
    await db('sita_messages').where({ id: m.id }).increment('cost_micro_usd', cost);
    await db('sita_conversations').where({ id: m.conversation_id }).increment('cost_micro_usd', cost);
  });
}

/**
 * Message d'accueil : une seule synthèse par texte et par voix (ensuite gardée). Son coût, de l'ordre d'un franc CFA, est
 * reporté sur le dernier message de Sita du mois s'il y en a un (sinon il reste hors décompte, une seule fois).
 */
async function forGreeting(db) {
  const { getSettings } = require('./sita');
  const settings = await getSettings(db);
  const text = speakable(S.fill(S.effectiveTexts(settings).greeting, { nom: settings.name }));
  return cached(db, settings, text, S.ttsVoice(settings), async cost => {
    const last = await db('sita_messages').where({ month: monthOf(), role: 'assistante' }).orderBy('id', 'desc').first('id');
    if (last) await db('sita_messages').where({ id: last.id }).increment('cost_micro_usd', cost);
  });
}

/** Essai du dashboard (« Écouter un essai ») : voix et style proposés, sans enregistrement ; réservé à site:assistant. */
async function sample(db, { gender, voice, style }) {
  const { getSettings } = require('./sita');
  const settings = await getSettings(db);
  const homme = gender === 'homme';
  if (!S.TTS_VOICES[voice] || S.TTS_VOICES[voice].gender !== (homme ? 'homme' : 'femme')) throw new HttpError(400, 'Voix inconnue pour ce genre.');
  const text = speakable(`Bonjour, je suis ${settings.name}, ${homme ? 'votre conseiller' : 'votre conseillère'} SIIPAF. Je peux vous présenter nos programmes, les prix et le financement, et organiser une visite.`);
  const v = { name: voice, style: String(style || '').trim().slice(0, 300) || (homme ? S.DEFAULT_TTS_STYLE_M : S.DEFAULT_TTS_STYLE_F) };
  return cached(db, { ...settings, enabled: true, voice: true }, text, v, async () => {});
}

module.exports = { setHttp, setCacheDir, speakable, pcmToWav, synthesize, forMessage, forGreeting, sample };
