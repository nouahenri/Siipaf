/**
 * Acquisition par les canaux officiels Meta : listes de référence, réglages des connecteurs (validation), vérification de la
 * signature des webhooks, lecture des champs d'un formulaire de publicité, normalisation et hachage des listes d'audience
 * (format Meta), et schémas du ciblage proposé par l'IA.
 * Principe du client (31/10/2026) : canaux officiels uniquement, jamais de collecte d'identités sur d'autres pages ; tout reste
 * « non connecté » (rien ne casse) tant que les identifiants ne sont pas saisis.
 */
const crypto = require('crypto');
const { z } = require('./zod');

const GRAPH_URL = 'https://graph.facebook.com';
const DEFAULT_GRAPH_VERSION = 'v23.0';
const MESSAGE_WINDOW_MS = 24 * 3600 * 1000; // fenêtre de réponse de Meta
const MAX_TEXT = 1900; // un message Messenger / Instagram est limité à 2000 caractères

// Canaux d'une conversation de Sita
const CONVERSATION_CHANNELS = { site: 'Site', messenger: 'Messenger', instagram: 'Instagram' };

// Connecteurs : état affiché dans les Réglages et le tableau de bord
const CONNECTORS = {
  app: { label: 'Application Meta', needs: ['app_id', 'app_secret'], usedFor: 'Signature des webhooks et appels sécurisés' },
  page: { label: 'Page Facebook', needs: ['page_id', 'page_token'], usedFor: 'Formulaires de publicité, Messenger, commentaires' },
  instagram: { label: 'Compte Instagram professionnel', needs: ['instagram_id', 'page_token'], usedFor: 'Messages et commentaires Instagram' },
  ads: { label: 'Compte publicitaire', needs: ['ad_account_id'], usedFor: 'Envoi des audiences', tokenAny: ['ads_token', 'page_token'] },
  pixel: { label: 'Pixel Meta', needs: ['pixel_id'], usedFor: 'Mesure sur le site siipaf.com' },
  webhook: { label: 'Webhooks', needs: ['verify_token', 'app_secret'], usedFor: 'Réception des formulaires, messages et commentaires' },
};

// ─── Réglages ─────────────────────────────────────────────────────────────

const SECRET_FIELDS = {
  app_secret: 'Secret de l’application',
  page_token: 'Jeton d’accès de la page (longue durée)',
  ads_token: 'Jeton du compte publicitaire (facultatif)',
  verify_token: 'Jeton de vérification des webhooks',
};
const ID_FIELDS = {
  app_id: 'Identifiant de l’application', page_id: 'Identifiant de la page Facebook', instagram_id: 'Identifiant du compte Instagram professionnel',
  ad_account_id: 'Identifiant du compte publicitaire', pixel_id: 'Identifiant du pixel',
};
const FLAG_FIELDS = {
  lead_ads_enabled: 'Recevoir les formulaires de publicité (Lead Ads)',
  messages_enabled: 'Faire répondre Sita aux messages Messenger et Instagram',
  comments_enabled: 'Répondre aux commentaires publics par un message court',
  pixel_enabled: 'Activer le pixel sur le site',
  pixel_consent_required: 'Demander l’accord du visiteur avant de charger le pixel',
};
const DEFAULT_COMMENT_REPLY = 'Merci pour votre intérêt ! Écrivez-nous en message privé : un conseiller SIIPAF vous répond avec plaisir. Vous pouvez aussi nous joindre au +225 01 02 27 95 95.';

const DEFAULTS = {
  app_id: '', page_id: '', instagram_id: '', ad_account_id: '', pixel_id: '', graph_version: DEFAULT_GRAPH_VERSION,
  lead_ads_enabled: true, messages_enabled: true, comments_enabled: false, pixel_enabled: true, pixel_consent_required: true,
  comment_reply_text: DEFAULT_COMMENT_REPLY, comment_reply_max_per_hour: 20,
};

const idField = z.string().trim().regex(/^\d{0,30}$/, 'Chiffres uniquement.');
// Compte publicitaire : « act_123 » ou « 123 » acceptés, « 123 » conservé
const adAccountField = z.string().trim().transform(v => v.replace(/^act_/i, '')).pipe(z.string().regex(/^\d{0,30}$/, 'Chiffres uniquement (avec ou sans « act_ »).'));
const secretField = z.string().trim().min(8, 'Valeur trop courte.').max(600).regex(/^[^\s]+$/, 'Sans espace.').nullable();

/** Mise à jour des réglages : chaque champ est facultatif ; un secret à null est effacé, absent il est conservé. */
const settingsPatchSchema = z.object({
  app_id: idField, page_id: idField, instagram_id: idField, ad_account_id: adAccountField, pixel_id: idField,
  graph_version: z.string().trim().regex(/^v\d{1,2}\.\d$/, 'Format attendu : v23.0'),
  lead_ads_enabled: z.boolean(), messages_enabled: z.boolean(), comments_enabled: z.boolean(), pixel_enabled: z.boolean(), pixel_consent_required: z.boolean(),
  comment_reply_text: z.string().trim().min(10, 'Message trop court.').max(300),
  comment_reply_max_per_hour: z.number().int().min(1).max(200),
  app_secret: secretField, page_token: secretField, ads_token: secretField, verify_token: secretField,
}).partial().strict();

// ─── Signature des webhooks ───────────────────────────────────────────────

/** Vérifie l'en-tête X-Hub-Signature-256 (HMAC-SHA256 du corps brut avec le secret de l'application). */
function verifySignature(rawBody, header, secret) {
  if (!secret || !header || !Buffer.isBuffer(rawBody)) return false;
  const given = String(header).replace(/^sha256=/i, '').trim();
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(given, 'hex'));
}

/** appsecret_proof des appels à l'API Graph (recommandé par Meta quand le secret est connu). */
const appSecretProof = (token, secret) => crypto.createHmac('sha256', secret).update(token).digest('hex');

/** Comparaison à durée constante (jeton de vérification). */
function sameSecret(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// ─── Formulaire de publicité ──────────────────────────────────────────────

const clip = (v, n) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const firstValue = f => (Array.isArray(f?.values) ? clip(f.values[0], 400) : clip(f?.values, 400));

/**
 * Lit les champs d'un formulaire de publicité (`field_data` : [{ name, values: [...] }]). Reconnaît nom complet / prénom + nom,
 * e-mail, téléphone (préfixe « p: » de Meta retiré), pays, ville ; les autres questions sont gardées telles quelles.
 */
function parseLeadFields(fieldData) {
  const out = { name: '', email: '', phone: '', country: '', city: '', campaign_hint: '', extra: [] };
  let first = '', last = '';
  for (const f of Array.isArray(fieldData) ? fieldData : []) {
    const key = String(f?.name || '').toLowerCase();
    const value = firstValue(f);
    if (!value) continue;
    if (key === 'full_name' || key === 'nom_complet' || key === 'nom_et_prénom') out.name = value;
    else if (key === 'first_name') first = value;
    else if (key === 'last_name') last = value;
    else if (key === 'email' || key === 'work_email') out.email = value.toLowerCase();
    else if (key === 'phone_number' || key === 'phone' || key === 'work_phone_number') out.phone = value.replace(/^p:/i, '').trim();
    else if (key === 'country') out.country = value;
    else if (key === 'city') out.city = value;
    else if (/^(utm_campaign|campagne|campaign|code_campagne)$/.test(key)) out.campaign_hint = value;
    else out.extra.push({ label: clip(f.name, 80).replace(/_/g, ' '), value });
  }
  if (!out.name) out.name = [first, last].filter(Boolean).join(' ');
  return out;
}

/** Code de campagne trouvé dans des textes (nom de l'annonce, de l'ensemble, de la campagne, champ caché), le plus long d'abord. */
function findCampaignCode(texts, codes) {
  const hay = texts.filter(Boolean).map(t => String(t).toLowerCase());
  for (const code of [...codes].sort((a, b) => b.length - a.length)) {
    const c = String(code).toLowerCase();
    const re = new RegExp(`(^|[^a-z0-9-])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9-])`);
    if (hay.some(t => re.test(t))) return code;
  }
  return null;
}

// ─── Audiences : normalisation et hachage (format Meta) ───────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

/** E-mail : espaces retirés, minuscules ; null s'il n'a pas la forme d'une adresse. */
function normalizeEmail(value) {
  const e = String(value || '').trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/**
 * Téléphone au format Meta : chiffres seulement, indicatif du pays compris, sans « + » ni zéros de tête de l'indicatif.
 * Numéro ivoirien à 10 chiffres (0102279595) : indicatif 225 ajouté. Ancien format à 8 chiffres ou numéro douteux : ignoré.
 */
function normalizePhone(value) {
  const raw = String(value || '').trim();
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  const international = /^(\+|00)/.test(raw);
  if (raw.startsWith('00')) d = d.slice(2);
  if (!international) {
    if (d.length === 10) d = `225${d}`; // numéro ivoirien à 10 chiffres
    else if (!(d.startsWith('225') && d.length === 13) && d.length < 11) return null; // numéro local douteux
  }
  if (d.startsWith('225') && d.length !== 13) return null;
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

/** { email, phone } normalisés puis hachés en SHA-256 (hexadécimal minuscule) ; null si ni l'un ni l'autre n'est exploitable. */
function hashPerson({ email, phone }) {
  const e = normalizeEmail(email);
  const p = normalizePhone(phone);
  if (!e && !p) return null;
  return { email: e ? sha256(e) : '', phone: p ? sha256(p) : '' };
}

/** Lignes du fichier CSV de l'audience (en-tête « email,phone »), sans doublon. */
function audienceCsv(people) {
  const seen = new Set();
  const lines = ['email,phone'];
  for (const person of people) {
    const h = hashPerson(person);
    if (!h) continue;
    const line = `${h.email},${h.phone}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return { csv: `${lines.join('\n')}\n`, count: lines.length - 1 };
}

// ─── Ciblage proposé par l'IA ─────────────────────────────────────────────

const TARGET_SCOPES = { interaction: 'Audience d’interaction', centres_interet: 'Centres d’intérêt immobilier', similaire: 'Audience similaire' };
const TARGETING_STATUSES = { brouillon: 'Brouillon', a_valider: 'À valider', valide: 'Validé', refuse: 'Refusé', archive: 'Archivé' };
const AD_BUTTONS = { LEARN_MORE: 'En savoir plus', CONTACT_US: 'Nous contacter', SEND_MESSAGE: 'Envoyer un message', BOOK_TRAVEL: 'Réserver', GET_QUOTE: 'Demander un devis' };
// Pays où Meta impose la « catégorie publicitaire spéciale Logement » (âge, sexe et zones fines non ciblables)
const HOUSING_RESTRICTED = /(etats[- ]?unis|usa|united states|canada|\bUS\b|\bCA\b)/i;

const txt = (min, max) => z.string().trim().min(min).max(max);
const targetingParamsSchema = z.object({
  summary: txt(5, 400),
  zones: z.array(z.object({ label: txt(2, 80), kind: z.enum(['ville', 'region', 'pays']), note: z.string().trim().max(200).nullish() })).min(1).max(12),
  age_min: z.number().int().min(18).max(65),
  age_max: z.number().int().min(18).max(65),
  languages: z.array(z.enum(['fr', 'en'])).min(1).max(2),
  interests: z.array(txt(2, 80)).min(1).max(15),
  diaspora: z.object({ enabled: z.boolean(), countries: z.array(txt(2, 60)).max(10), note: z.string().trim().max(200).nullish() }),
  audiences: z.array(z.object({ kind: z.enum(Object.keys(TARGET_SCOPES)), description: txt(5, 300) })).max(6),
  exclusions: z.array(txt(2, 120)).max(8),
}).refine(p => p.age_max >= p.age_min, { message: 'L’âge maximal précède l’âge minimal.', path: ['age_max'] });
const adSchema = z.object({
  headline: txt(3, 40), primary_text: txt(10, 500), description: z.string().trim().max(60).nullish(),
  cta_button: z.enum(Object.keys(AD_BUTTONS)).default('LEARN_MORE'),
});
const targetingSchema = z.object({
  params: targetingParamsSchema,
  ads: z.array(adSchema).min(1).max(5),
  rationale: z.string().trim().max(800).nullish(),
});

const str = (extra = {}) => ({ type: 'string', ...extra });
const TARGETING_TOOL = {
  type: 'object',
  properties: {
    params: {
      type: 'object',
      properties: {
        summary: str({ description: 'Public visé en une ou deux phrases' }),
        zones: { type: 'array', items: { type: 'object', properties: { label: str(), kind: str({ enum: ['ville', 'region', 'pays'] }), note: str() }, required: ['label', 'kind'] } },
        age_min: { type: 'number' }, age_max: { type: 'number' },
        languages: { type: 'array', items: str({ enum: ['fr', 'en'] }) },
        interests: { type: 'array', items: str(), description: 'Centres d’intérêt immobilier proposés par Meta (ex. Immobilier, Investissement immobilier, Construction)' },
        diaspora: { type: 'object', properties: { enabled: { type: 'boolean' }, countries: { type: 'array', items: str() }, note: str() }, required: ['enabled', 'countries'] },
        audiences: { type: 'array', items: { type: 'object', properties: { kind: str({ enum: Object.keys(TARGET_SCOPES) }), description: str() }, required: ['kind', 'description'] } },
        exclusions: { type: 'array', items: str() },
      },
      required: ['summary', 'zones', 'age_min', 'age_max', 'languages', 'interests', 'diaspora', 'audiences', 'exclusions'],
    },
    ads: {
      type: 'array', minItems: 1, maxItems: 5,
      items: { type: 'object', properties: { headline: str({ description: '40 caractères au plus' }), primary_text: str({ description: 'Texte principal, 500 caractères au plus' }), description: str(), cta_button: str({ enum: Object.keys(AD_BUTTONS) }) }, required: ['headline', 'primary_text', 'cta_button'] },
    },
    rationale: str({ description: 'Pourquoi ce ciblage, en quelques phrases' }),
  },
  required: ['params', 'ads'],
};

/** Avertissements propres au ciblage (en plus des contrôles de texte communs au Marketing). */
function targetingWarnings(params) {
  const warnings = [];
  const abroad = (params.diaspora?.enabled ? params.diaspora.countries : []).filter(c => HOUSING_RESTRICTED.test(c));
  if (abroad.length) warnings.push(`Pays soumis à la catégorie publicitaire spéciale « Logement » de Meta (${abroad.join(', ')}) : déclarez-la à la création de l’annonce ; l’âge, le sexe et les zones fines ne seront pas ciblables dans ces pays.`);
  if (params.age_min > params.age_max) warnings.push('L’âge maximal précède l’âge minimal.');
  return warnings;
}

module.exports = {
  GRAPH_URL, DEFAULT_GRAPH_VERSION, MESSAGE_WINDOW_MS, MAX_TEXT, CONVERSATION_CHANNELS, CONNECTORS, SECRET_FIELDS, ID_FIELDS, FLAG_FIELDS, DEFAULTS,
  DEFAULT_COMMENT_REPLY, settingsPatchSchema, verifySignature, appSecretProof, sameSecret, parseLeadFields, findCampaignCode,
  normalizeEmail, normalizePhone, sha256, hashPerson, audienceCsv,
  TARGET_SCOPES, TARGETING_STATUSES, AD_BUTTONS, targetingSchema, targetingParamsSchema, adSchema, TARGETING_TOOL, targetingWarnings,
};
