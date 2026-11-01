/**
 * Appel de Gemini (Google AI Studio, API REST generateContent, sans état côté Google) pour « Sita », ALTERNATIVE à Claude :
 * - clé lue dans GEMINI_API_KEY (server/.env), envoyée dans l'en-tête x-goog-api-key (jamais dans l'adresse), jamais affichée,
 *   journalisée ni renvoyée au navigateur ;
 * - même forme d'échange que le SDK Anthropic (`messages.create`) : services/sitaAi.js garde une seule boucle (outils, contrôles,
 *   plafond) quel que soit le fournisseur. Le tour du modèle est renvoyé tel quel à Google (signatures de réflexion comprises).
 * Les tests n'appellent jamais le réseau : setHttp(fauxFetch) ou setClient(fauxClient).
 */
const { GEMINI_MODELS } = require('../lib/sita');

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 120000;

let override = null;
let http = null;
/** Remplace le client (tests) ; setClient(null) rétablit le client réel. */
const setClient = client => { override = client; };
/** Remplace fetch (tests de la conversion) ; setHttp(null) rétablit fetch. */
const setHttp = fn => { http = fn; };

const apiKey = () => String(process.env.GEMINI_API_KEY || '').trim();
/** Seule information donnée sur la clé : présente ou non, et ses 4 derniers caractères. */
function keyInfo() {
  const key = apiKey();
  return { present: !!key, last4: key ? key.slice(-4) : null };
}

/** Texte d'erreur sans aucune trace de la clé. */
function clean(value) {
  let text = String((value && value.message) || value || 'Erreur inconnue');
  const key = apiKey();
  if (key) text = text.split(key).join('[clé masquée]');
  return text.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[clé masquée]').replace(/x-goog-api-key[^\s,;]*/gi, '[en-tête masqué]').slice(0, 400);
}

/** Schéma JSON des outils → schéma de Google (types en majuscules, sous-ensemble OpenAPI). */
function toSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toSchema(v)]));
  if (s.required) out.required = s.required;
  if (s.items) out.items = toSchema(s.items);
  return out;
}

const textOfSystem = system => (Array.isArray(system) ? system.map(b => b.text || '').join('\n') : String(system || ''));
const blocksOf = content => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []);

/** Historique au format Anthropic (texte, tool_use, tool_result) → `contents` de Google. */
function toContents(messages) {
  const names = {}; // id d'appel d'outil → nom (Google veut le nom dans la réponse de l'outil)
  const ids = new Set(); // appels dont Google a fourni l'id (à lui renvoyer)
  const contents = [];
  for (const m of messages) {
    const blocks = blocksOf(m.content);
    for (const b of blocks) if (b.type === 'tool_use') { names[b.id] = b.name; if (b.gemini_id) ids.add(b.id); }
    const raw = blocks.find(b => b.type === 'gemini_raw');
    let parts;
    if (raw) parts = raw.parts; // tour du modèle renvoyé exactement comme reçu
    else {
      parts = blocks.map(b => {
        if (b.type === 'text') return b.text ? { text: b.text } : null;
        if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input || {}, ...(b.gemini_id ? { id: b.id } : {}) } };
        if (b.type === 'tool_result') {
          let response;
          try { response = JSON.parse(b.content); } catch { response = { result: String(b.content ?? '') }; }
          if (!response || typeof response !== 'object' || Array.isArray(response)) response = { result: response };
          if (b.is_error) response = { error: response };
          return { functionResponse: { name: names[b.tool_use_id] || 'outil', response, ...(ids.has(b.tool_use_id) ? { id: b.tool_use_id } : {}) } };
        }
        return null;
      }).filter(Boolean);
    }
    if (!parts.length) parts = [{ text: '(vide)' }];
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
}

/** Réponse de Google → forme Anthropic : blocs texte / tool_use, bloc `gemini_raw` (tour à renvoyer), jetons consommés. */
function fromResponse(data) {
  const cand = data?.candidates?.[0];
  if (!cand?.content) {
    const reason = data?.promptFeedback?.blockReason || cand?.finishReason || 'aucune réponse';
    throw new Error(`Gemini n’a pas répondu (${reason})`);
  }
  const parts = Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const content = [{ type: 'gemini_raw', parts }];
  parts.forEach((p, i) => {
    if (p.thought) return; // réflexion interne : jamais montrée au visiteur
    if (p.functionCall) content.push({ type: 'tool_use', id: p.functionCall.id || `gemini_${i}_${Math.random().toString(36).slice(2, 10)}`, gemini_id: !!p.functionCall.id, name: p.functionCall.name, input: p.functionCall.args || {} });
    else if (typeof p.text === 'string' && p.text) content.push({ type: 'text', text: p.text });
  });
  const u = data.usageMetadata || {};
  const cached = Number(u.cachedContentTokenCount) || 0;
  return {
    content, stop_reason: cand.finishReason || null,
    usage: {
      input_tokens: Math.max(0, (Number(u.promptTokenCount) || 0) - cached) + (Number(u.toolUsePromptTokenCount) || 0),
      output_tokens: (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0), // la réflexion est facturée en sortie
      cache_read_input_tokens: cached, cache_creation_input_tokens: 0,
    },
  };
}

/** Requête Google construite à partir des paramètres de `messages.create` (forme Anthropic). */
function toRequest({ model, max_tokens, system, messages, tools }) {
  const m = GEMINI_MODELS[model] || {};
  return {
    systemInstruction: { parts: [{ text: textOfSystem(system) }] },
    contents: toContents(messages),
    ...(tools?.length ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: toSchema(t.input_schema) })) }] } : {}),
    generationConfig: { maxOutputTokens: (max_tokens || 700) + (m.thinking_room || 0), ...(m.thinking ? { thinkingConfig: { thinkingLevel: m.thinking } } : {}) },
  };
}

async function create(params) {
  const res = await (http || fetch)(`${API}/${encodeURIComponent(params.model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
    body: JSON.stringify(toRequest(params)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Gemini ${res.status} : ${data?.error?.message || res.statusText || 'erreur'}`);
  return fromResponse(data);
}

function getClient() {
  return override || { messages: { create } };
}

module.exports = { setClient, setHttp, apiKey, keyInfo, clean, getClient, toRequest, fromResponse, toContents, toSchema };
