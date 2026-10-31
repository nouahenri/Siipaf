/**
 * ERP · Marketing & Communication : listes de référence, schémas de la sortie de l'IA et contrôles déterministes
 * appliqués à tout contenu (préparé par l'IA, par un gabarit de démonstration ou écrit à la main).
 * Gouvernance : docs/strategie-commercial-ia-siipaf.md §7 (A4), §16 et §17. L'IA propose, un humain valide.
 */
const { z } = require('zod');

const CHANNELS = {
  facebook: { label: 'Facebook', medium: 'social', kinds: ['post', 'story', 'script_video'], limit: 1200 },
  linkedin: { label: 'LinkedIn', medium: 'social', kinds: ['post', 'article'], limit: 1800 },
  instagram: { label: 'Instagram', medium: 'social', kinds: ['post', 'story', 'script_video'], limit: 1000 },
  tiktok: { label: 'TikTok', medium: 'social', kinds: ['script_video'], limit: 900 },
  whatsapp: { label: 'WhatsApp', medium: 'messagerie', kinds: ['message'], limit: 700 },
  email: { label: 'E-mail (newsletter)', medium: 'email', kinds: ['email'], limit: 2500 },
  site: { label: 'Site siipaf.com', medium: 'site', kinds: ['article'], limit: 3000 },
};
const KINDS = { post: 'Publication', story: 'Story', script_video: 'Script vidéo', message: 'Message', email: 'E-mail', article: 'Article' };
const SEGMENTS = {
  residence_principale: 'Résidence principale',
  diaspora: 'Acquéreurs à distance (diaspora)',
  investisseur: 'Investisseurs',
  entreprise: 'Entreprises et organisations',
  parrainage: 'Clients satisfaits (parrainage)',
};
const CAMPAIGN_STATUSES = { brouillon: 'Brouillon', a_valider: 'Soumise à la Direction', validee: 'Validée', archivee: 'Archivée' };
const CONTENT_STATUSES = { brouillon: 'Brouillon', a_valider: 'À valider', valide: 'Validé', planifie: 'Planifié', publie: 'Publié', archive: 'Archivé' };
const STEPS = { concept: 'Concept de campagne', contenus: 'Calendrier et contenus', variante: 'Nouvelle version d’un contenu', semaine: 'Préparation hebdomadaire' };

// Tarifs en dollars par million de jetons (à vérifier sur la grille Anthropic avant la mise en production)
const MODELS = {
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (équilibré, par défaut)', in: 3, out: 15, cache_read: 0.3, cache_write: 3.75 },
  'claude-opus-5-5': { label: 'Claude Opus 5.5 (plus soigné, plus cher)', in: 5, out: 25, cache_read: 0.5, cache_write: 6.25 },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (rapide, économique)', in: 1, out: 5, cache_read: 0.1, cache_write: 1.25 },
};
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const TOOL_NAME = 'proposer_contenus';

/** Coût en micro-dollars (1 jeton coûte autant de micro-dollars que le tarif par million). */
function costMicroUsd(model, usage) {
  const p = MODELS[model] || MODELS[DEFAULT_MODEL];
  return Math.round((usage.tokens_in || 0) * p.in + (usage.tokens_out || 0) * p.out
    + (usage.tokens_cache_read || 0) * p.cache_read + (usage.tokens_cache_write || 0) * p.cache_write);
}
const microUsdToFcfa = (micro, rate) => Math.round((Number(micro) / 1e6) * rate);

// ─── Sortie structurée de l'IA ────────────────────────────────────────────

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const itemSchema = z.object({
  channel: z.enum(Object.keys(CHANNELS)),
  kind: z.enum(Object.keys(KINDS)),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(10).max(4000),
  subject: z.string().trim().max(200).nullish(),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  cta: z.string().trim().max(200).nullish(),
  visual_idea: z.string().trim().max(800).nullish(),
  scheduled_for: day.nullish(),
  fact_refs: z.array(z.string().max(20)).max(20).default([]),
});
const contentsSchema = z.object({ items: z.array(itemSchema).min(1).max(30) });
const conceptSchema = z.object({
  angle: z.string().trim().min(5).max(400),
  key_message: z.string().trim().min(5).max(400),
  audience: z.string().trim().min(3).max(300),
  proof_points: z.array(z.string().trim().min(3).max(300)).min(1).max(8),
  cta: z.string().trim().min(2).max(120),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  tone_notes: z.string().trim().max(400).nullish(),
});

// Schémas JSON de l'outil imposé à l'IA (tool_choice forcé) ; la validation réelle est celle de zod ci-dessus
const str = (extra = {}) => ({ type: 'string', ...extra });
const ITEM_JSON = {
  type: 'object',
  properties: {
    channel: str({ enum: Object.keys(CHANNELS) }), kind: str({ enum: Object.keys(KINDS) }), title: str({ description: 'Titre interne court' }),
    body: str({ description: 'Texte prêt à publier, en français' }), subject: str({ description: 'Objet (e-mail) ou accroche' }),
    hashtags: { type: 'array', items: str() }, cta: str({ description: 'Appel à l’action' }), visual_idea: str({ description: 'Idée de visuel à partir de visuels approuvés' }),
    scheduled_for: str({ description: 'Jour de publication AAAA-MM-JJ' }), fact_refs: { type: 'array', items: str(), description: 'Références des faits utilisés (p1, o3, t2…)' },
  },
  required: ['channel', 'kind', 'title', 'body'],
};
const TOOL_SCHEMAS = {
  contenus: { type: 'object', properties: { items: { type: 'array', items: ITEM_JSON, minItems: 1, maxItems: 30 } }, required: ['items'] },
  concept: {
    type: 'object',
    properties: {
      angle: str(), key_message: str(), audience: str(), proof_points: { type: 'array', items: str(), minItems: 1 }, cta: str(),
      hashtags: { type: 'array', items: str() }, tone_notes: str(),
    },
    required: ['angle', 'key_message', 'audience', 'proof_points', 'cta'],
  },
};
TOOL_SCHEMAS.variante = TOOL_SCHEMAS.contenus;
TOOL_SCHEMAS.semaine = TOOL_SCHEMAS.contenus;

// ─── Contrôles déterministes après génération ─────────────────────────────

const URGENCY = /(derni[èe]re?s? chances?|derni[èe]res? places?|derniers? lots?|offre limit[ée]e|ne (?:le |la |les )?ratez pas|plus que \d+|vite\b|d[èe]p[êe]chez|avant qu['’]il (?:ne )?soit trop tard|dernier jour|stock limit[ée]|profitez (?:vite|maintenant)|urgent|dernier moment|ne tardez pas|il ne reste que)/i;
const PROMISE = /(rentabilit[ée] garantie|rendement garanti|gains? garantis?|plus-value garantie|revenus? garantis?|sans (?:aucun )?risque|investissement s[ûu]r à 100|doubl(?:ez|er) votre (?:argent|investissement)|devenez riche|profit assur[ée])/i;
const SUPERLATIVE = /(le meilleur promoteur|la meilleure|n°\s?1|num[ée]ro (?:un|1)|leader (?:incontest|du march)|unique sur le march[ée]|imbattable|sans concurrence)/i;
const PERSONAL = /(\b0?[1-9](?:[\s.-]?\d{2}){4}\b|\b\+?225[\s.-]?\d{8,10}\b|[\w.+-]+@[\w-]+\.[\w.-]+)/; // téléphone ou e-mail d'une personne (hors coordonnées de SIIPAF)
const COMPANY_CONTACTS = /(01[\s.-]?02[\s.-]?27[\s.-]?95[\s.-]?95|info@siipaf\.com)/i;

function parseNumber(raw) {
  let s = String(raw).replace(/[\s  ]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
const AMOUNT = /(\d{1,3}(?:[\s  .]\d{3})+|\d+(?:[.,]\d+)?)\s*(millions?|mio|M)?\s*(?:de\s+)?(?:FCFA|F\s?CFA|XOF|francs?\s+CFA)/gi;
const PERCENT = /(\d+(?:[.,]\d+)?)\s*(?:%|pour\s?cent)/gi;

/** Montants en FCFA (avec « millions » développé) cités dans un texte. */
function amountsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(AMOUNT)) {
    const n = parseNumber(m[1]);
    if (n == null) continue;
    out.push({ value: m[2] ? n * 1e6 : n, rounded: !!m[2], raw: m[0].trim() });
  }
  return out;
}
const percentsIn = text => [...String(text || '').matchAll(PERCENT)].map(m => ({ value: parseNumber(m[1]), raw: m[0].trim() })).filter(p => p.value != null);

/** Montants et pourcentages que les faits autorisent à citer. */
function allowedFigures(facts) {
  const amounts = [];
  const percents = [];
  const walk = (v, key) => {
    if (v == null) return;
    if (typeof v === 'number') {
      if (/pct|percent/i.test(key || '')) percents.push(v);
      else if (/fcfa|monthly|deposit|price/i.test(key || '')) amounts.push(v);
    } else if (typeof v === 'string') {
      amountsIn(v).forEach(a => amounts.push(a.value));
      percentsIn(v).forEach(p => percents.push(p.value));
    } else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  walk(facts);
  return { amounts, percents };
}

/**
 * Avertissements d'un contenu : montants ou pourcentages absents des faits, fausse urgence, promesse de gain, superlatif
 * non prouvé, mot interdit par la marque, coordonnées d'une personne. Un contenu avec avertissements ne peut pas être soumis.
 */
function checkContent(version, facts, { banned = [] } = {}) {
  const text = [version.subject, version.body, version.cta, (version.hashtags || []).join(' ')].filter(Boolean).join('\n');
  const { amounts, percents } = allowedFigures(facts);
  const warnings = [];
  for (const a of amountsIn(text)) {
    const ok = amounts.some(v => v === a.value || (a.rounded && v > 0 && Math.abs(v - a.value) / v <= 0.06));
    if (!ok) warnings.push(`Montant non vérifié : « ${a.raw} » ne figure pas dans les données du catalogue.`);
  }
  for (const p of percentsIn(text)) {
    if (!percents.some(v => Math.abs(v - p.value) <= 0.5)) warnings.push(`Pourcentage non vérifié : « ${p.raw} » ne figure pas dans les données du catalogue.`);
  }
  const hit = (re, msg) => { const m = text.match(re); if (m) warnings.push(`${msg} : « ${m[0]} ».`); };
  hit(URGENCY, 'Fausse urgence à retirer');
  hit(PROMISE, 'Promesse de gain interdite');
  hit(SUPERLATIVE, 'Superlatif non prouvé');
  const personal = text.replace(new RegExp(COMPANY_CONTACTS.source, 'gi'), '').replace(AMOUNT, '').match(PERSONAL);
  if (personal) warnings.push(`Coordonnées personnelles à retirer : « ${personal[0]} ».`);
  for (const w of banned) {
    if (w && text.toLowerCase().includes(w.toLowerCase())) warnings.push(`Mot interdit par la marque : « ${w} ».`);
  }
  return [...new Set(warnings)];
}

const WHATSAPP_FOOTER = '— SIIPAF SA. Vous recevez ce message car vous avez accepté d’être contacté(e). Pour ne plus en recevoir, répondez STOP.';
/** WhatsApp : identification de SIIPAF, rappel du consentement et désinscription ajoutés par le code, pas laissés au modèle. */
function withConsentFooter(channel, body) {
  if (channel !== 'whatsapp') return body;
  return /\bSTOP\b|d[ée]sinscri|ne plus recevoir/i.test(body) && /SIIPAF/i.test(body) ? body : `${body.trim()}\n\n${WHATSAPP_FOOTER}`;
}

/** Lundi (AAAA-MM-JJ) de la semaine d'une date. */
function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}
const addDays = (dateStr, n) => { const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);
/** Jour de la semaine, 1 = lundi … 7 = dimanche. */
const weekday = dateStr => ((new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Code de campagne (utm_campaign) tiré d'un nom : « Rentrée 2026 — Ahoutoué » → rentree-2026-ahoutoue. */
function campaignCode(name) {
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'campagne';
}

module.exports = {
  CHANNELS, KINDS, SEGMENTS, CAMPAIGN_STATUSES, CONTENT_STATUSES, STEPS, MODELS, DEFAULT_MODEL, TOOL_NAME, TOOL_SCHEMAS,
  itemSchema, contentsSchema, conceptSchema, costMicroUsd, microUsdToFcfa, checkContent, amountsIn, percentsIn, allowedFigures,
  withConsentFooter, WHATSAPP_FOOTER, mondayOf, addDays, todayStr, monthOf, weekday, campaignCode,
};
