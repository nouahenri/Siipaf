/**
 * Appel de l'IA (SDK officiel @anthropic-ai/sdk) du Marketing & Communication, avec les garde-fous du document de stratégie :
 * - clé lue dans ANTHROPIC_API_KEY (server/.env), jamais affichée, journalisée ni renvoyée au navigateur ;
 * - mode démonstration (gabarits sur les vrais faits) sans clé, en arrêt d'urgence ou à la demande ;
 * - plafond mensuel en FCFA (taux dollar → FCFA réglable) : au-delà, refus net (409), sans bascule silencieuse ;
 * - sortie structurée par un outil imposé (tool_choice) validée par zod, une relance au plus ;
 * - coût, jetons et contexte envoyé consignés dans marketing_generations.
 * Les tests n'appellent jamais le réseau : setClient(fauxClient).
 */
const { HttpError, toDate } = require('../lib/http');
const { MODELS, TOOL_NAME, TOOL_SCHEMAS, costMicroUsd, microUsdToFcfa, monthOf } = require('../lib/marketing');
const { PROMPT_VERSION } = require('../lib/marketingPrompts');
const settingsService = require('./marketingSettings');
const { inform } = require('./notifications');

let override = null;
/** Remplace le client de l'IA (tests) ; setClient(null) rétablit le client réel. */
const setClient = client => { override = client; };

const apiKey = () => String(process.env.ANTHROPIC_API_KEY || '').trim();
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
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[clé masquée]').replace(/x-api-key[^\s,;]*/gi, '[en-tête masqué]').slice(0, 400);
}

function getClient() {
  if (override) return override;
  const mod = require('@anthropic-ai/sdk'); // chargé à la demande : le module reste utilisable sans le SDK en démonstration
  const Anthropic = mod.Anthropic || mod.default || mod;
  return new Anthropic({ apiKey: apiKey(), maxRetries: 1, timeout: 120000 });
}

/** 'ia' si la clé existe, sans arrêt d'urgence et sans démonstration forcée ; sinon 'demo'. */
async function resolveMode(db, forced = null, settings = null) {
  const s = settings || (await settingsService.all(db));
  if (forced === 'demo') return { mode: 'demo', reason: 'Démonstration demandée.' };
  if (s.emergency_stop) return { mode: 'demo', reason: 'Arrêt d’urgence actif : l’IA est suspendue.' };
  if (!apiKey()) return { mode: 'demo', reason: 'Aucune clé de l’IA enregistrée : mode démonstration.' };
  return { mode: 'ia', reason: null };
}

/** Réservations restées « en cours » après un arrêt du serveur : libérées au bout de 15 minutes. */
async function sweepStale(db) {
  const limit = Date.now() - 15 * 60 * 1000;
  for (const g of await db('marketing_generations').where({ status: 'en_cours' }).select('id', 'created_at')) {
    const at = toDate(g.created_at);
    if (!at || at.getTime() < limit) await db('marketing_generations').where({ id: g.id }).update({ status: 'erreur', error: 'Interrompue (serveur arrêté)', cost_micro_usd: 0 });
  }
}

async function monthSpendMicro(db, month = monthOf()) {
  await sweepStale(db);
  const row = await db('marketing_generations').where({ month }).whereIn('status', ['ok', 'invalide', 'erreur', 'en_cours']).sum({ s: 'cost_micro_usd' }).first();
  return Number(row?.s || 0);
}

/** Dépense du mois, plafond et état de l'IA (tableau de bord et Réglages). */
async function usage(db, month = monthOf()) {
  const s = await settingsService.all(db);
  const spent = await monthSpendMicro(db, month);
  const spentFcfa = microUsdToFcfa(spent, s.marketing_usd_fcfa);
  const mode = await resolveMode(db, null, s);
  const [{ n }] = await db('marketing_generations').where({ month, mode: 'ia' }).whereIn('status', ['ok', 'invalide', 'erreur']).count({ n: '*' });
  return {
    month, spent_micro_usd: spent, spent_usd: Math.round(spent / 1e4) / 100, spent_fcfa: spentFcfa, cap_fcfa: s.marketing_cap_fcfa, usd_fcfa: s.marketing_usd_fcfa,
    pct: s.marketing_cap_fcfa > 0 ? Math.min(100, Math.round((spentFcfa / s.marketing_cap_fcfa) * 100)) : 100,
    alert_pct: s.marketing_alert_pct, calls: Number(n), model: s.model, models: MODELS, emergency_stop: s.emergency_stop,
    mode: mode.mode, mode_reason: mode.reason, key: keyInfo(),
  };
}

/** Alertes à la Direction générale : seuil atteint puis plafond atteint (ou demande refusée faute de marge), une fois par mois. */
async function alertIfNeeded(db, month, { refused = false } = {}) {
  const u = await usage(db, month);
  if (refused || (u.cap_fcfa > 0 && u.spent_fcfa >= u.cap_fcfa)) {
    await inform(db, 'marketing.plafond', { title: 'Plafond mensuel de dépense de l’IA atteint', body: `${u.spent_fcfa.toLocaleString('fr-FR')} FCFA dépensés sur ${u.cap_fcfa.toLocaleString('fr-FR')} FCFA : l’IA est suspendue (mode démonstration) jusqu’au mois prochain ou jusqu’à ce que vous releviez le plafond dans Réglages.`, link: '/marketing/reglages', key: `marketing-plafond:${month}` });
  } else if (u.cap_fcfa > 0 && u.pct >= u.alert_pct) {
    await inform(db, 'marketing.plafond', { title: `Dépense de l’IA à ${u.pct} % du plafond mensuel`, body: `${u.spent_fcfa.toLocaleString('fr-FR')} FCFA sur ${u.cap_fcfa.toLocaleString('fr-FR')} FCFA ce mois-ci.`, link: '/marketing', key: `marketing-alerte:${month}` });
  }
}

const insertedId = r => (typeof r === 'object' ? r.id : r);
const blocks = res => (Array.isArray(res?.content) ? res.content : []);

/**
 * Exécute une génération. `demo()` fabrique la sortie de démonstration ; `schema` (zod) valide la sortie de l'IA.
 * Renvoie { generation_id, mode, output, cost_micro_usd }. Lève 409 (plafond), 422 (sortie invalide) ou 502 (IA indisponible).
 */
async function run(db, { step, campaign = null, content = null, user = null, forced = null, weekOf = null, system, prompt, schema, demo, facts }) {
  const s = await settingsService.all(db);
  const { mode } = await resolveMode(db, forced, s);
  const month = monthOf();
  const base = {
    campaign_id: campaign?.id || null, content_id: content?.id || null, step, mode, month, week_of: weekOf, prompt_version: PROMPT_VERSION,
    requested_by: user?.id || null, context: JSON.stringify(facts || null),
  };

  if (mode === 'demo') {
    const output = demo();
    const id = insertedId((await db('marketing_generations').insert({ ...base, status: 'ok', output: JSON.stringify(output) }))[0]);
    return { generation_id: id, mode, output, cost_micro_usd: 0 };
  }

  const model = s.model;
  const capMicro = Math.round((s.marketing_cap_fcfa / s.marketing_usd_fcfa) * 1e6);
  const maxOut = s.marketing_max_output_tokens;
  const estimate = () => costMicroUsd(model, { tokens_in: Math.ceil((system.length + prompt.length) / 2.5), tokens_out: maxOut });
  const room = async (already = 0) => s.marketing_cap_fcfa > 0 && (await monthSpendMicro(db, month)) + already + estimate() <= capMicro;

  if (!(await room())) {
    await db('marketing_generations').insert({ ...base, model, status: 'refuse_plafond', error: 'Plafond mensuel de dépense atteint', cost_micro_usd: 0 });
    await alertIfNeeded(db, month, { refused: true });
    throw new HttpError(409, s.marketing_cap_fcfa > 0
      ? `Plafond mensuel de dépense de l’IA atteint (${s.marketing_cap_fcfa.toLocaleString('fr-FR')} FCFA). Relevez-le dans Réglages ou utilisez le mode démonstration.`
      : 'La dépense de l’IA est bloquée (plafond à 0 FCFA). Réglez un plafond dans Réglages ou utilisez le mode démonstration.', { code: 'plafond' });
  }

  const id = insertedId((await db('marketing_generations').insert({ ...base, model, status: 'en_cours', cost_micro_usd: estimate() }))[0]);
  const used = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0 };
  const add = u => {
    used.tokens_in += u?.input_tokens || 0; used.tokens_out += u?.output_tokens || 0;
    used.tokens_cache_read += u?.cache_read_input_tokens || 0; used.tokens_cache_write += u?.cache_creation_input_tokens || 0;
  };
  const finish = async (patch) => {
    await db('marketing_generations').where({ id }).update({ ...used, cost_micro_usd: costMicroUsd(model, used), ...patch });
    await alertIfNeeded(db, month);
  };

  const tool = { name: TOOL_NAME, description: 'Renvoie les éléments préparés, conformes au schéma.', input_schema: TOOL_SCHEMAS[step] };
  const messages = [{ role: 'user', content: prompt }];
  let issues = null;
  try {
    const client = getClient();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0 && !(await room(costMicroUsd(model, used) - estimate()))) break; // pas de relance au-delà du plafond
      const res = await client.messages.create({
        model, max_tokens: maxOut, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages,
        tools: [tool], tool_choice: { type: 'tool', name: TOOL_NAME },
      });
      add(res?.usage);
      const use = blocks(res).find(b => b.type === 'tool_use');
      const parsed = use ? schema.safeParse(use.input) : { success: false, error: { issues: [{ path: [], message: 'aucun appel de l’outil dans la réponse' }] } };
      if (parsed.success) {
        await finish({ status: 'ok', output: JSON.stringify(parsed.data) });
        return { generation_id: id, mode, output: parsed.data, cost_micro_usd: costMicroUsd(model, used) };
      }
      issues = parsed.error.issues.slice(0, 6).map(i => `${i.path.join('.') || 'sortie'} : ${i.message}`).join(' ; ');
      if (use) messages.push({ role: 'assistant', content: res.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Sortie invalide, corrige et renvoie l’outil : ${issues}` }] });
      else break;
    }
  } catch (err) {
    const message = clean(err);
    await finish({ status: 'erreur', error: message });
    throw new HttpError(502, `L’IA est momentanément indisponible : ${message}`);
  }
  await finish({ status: 'invalide', error: clean(issues || 'Sortie invalide') });
  throw new HttpError(422, 'La réponse de l’IA est inutilisable (format invalide) : rien n’a été créé. Réessayez ou utilisez le mode démonstration.');
}

module.exports = { setClient, keyInfo, clean, resolveMode, usage, monthSpendMicro, run, sweepStale };
