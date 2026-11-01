/**
 * Appel de l'IA de « Sita », avec DEUX fournisseurs dont chaque clé est l'alternative de l'autre (choix du client du 01/11/2026) :
 * Claude (socle du Marketing, services/marketingAi.js, clé ANTHROPIC_API_KEY) et Gemini (services/geminiAi.js, clé GEMINI_API_KEY),
 * toutes deux dans server/.env, jamais exposées, erreurs nettoyées. Le modèle réglé répond ; sans sa clé, le modèle par défaut de
 * l'autre fournisseur le remplace ; si son appel échoue avant toute action (aucun outil exécuté), l'autre fournisseur reprend la
 * même réponse. Tarifs et conversion en FCFA : lib/marketing.js et lib/sita.js (SITA_MODELS). Plafond mensuel et arrêt d'urgence
 * PROPRES à Sita (tables sita_*, réglages de l'assistante), communs aux deux fournisseurs. Les outils (tool use) sont demandés par
 * le modèle mais EXÉCUTÉS par le serveur (`execute`), qui vérifie tout. La réponse est contrôlée (montants, fausse urgence,
 * promesses, remises) : une relance au plus, sinon remplacement par une réponse prudente avec passage de main.
 * Les tests n'appellent jamais le réseau : marketingAi.setClient(fauxClient), geminiAi.setClient(fauxClient).
 */
const { costMicroUsd: costIn, microUsdToFcfa, monthOf } = require('../lib/marketing');
const marketingAi = require('./marketingAi');
const geminiAi = require('./geminiAi');
const { inform } = require('./notifications');
const { MAX_TOOL_ROUNDS, SITA_MODELS, PROVIDERS, PROVIDER_DEFAULT_MODEL, providerOf } = require('../lib/sita');

const costMicroUsd = (model, usage) => costIn(model, usage, SITA_MODELS);
const PROVIDER_API = { anthropic: marketingAi, gemini: geminiAi };
const hasKey = provider => !!PROVIDER_API[provider].apiKey();
const other = provider => (provider === 'anthropic' ? 'gemini' : 'anthropic');
/** Texte d'erreur sans aucune trace des deux clés. */
const clean = e => geminiAi.clean(marketingAi.clean(e));

/** Coût réservé par les appels en cours (même processus) : deux visiteurs en même temps ne dépassent pas le plafond. */
let inflight = 0;

/** Modèles à essayer dans l'ordre : le modèle réglé (si sa clé existe), puis celui de l'autre fournisseur (si sa clé existe). */
function modelPlan(settings) {
  const chosen = SITA_MODELS[settings.model] ? settings.model : PROVIDER_DEFAULT_MODEL.anthropic;
  const p = providerOf(chosen);
  return [hasKey(p) && chosen, hasKey(other(p)) && PROVIDER_DEFAULT_MODEL[other(p)]].filter(Boolean);
}

/** 'ia' si une des deux clés existe et sans arrêt d'urgence ; sinon 'demo' (réponses sur les faits publiés, sans IA). */
function resolveMode(settings) {
  if (settings.emergency_stop) return { mode: 'demo', reason: 'Arrêt d’urgence de Sita actif : l’IA est suspendue.' };
  const plan = modelPlan(settings);
  if (!plan.length) return { mode: 'demo', reason: 'Aucune clé de l’IA enregistrée (Claude ou Gemini) : mode démonstration.' };
  if (plan[0] !== settings.model) return { mode: 'ia', reason: `Clé ${PROVIDERS[providerOf(settings.model)]} absente : Sita répond avec ${SITA_MODELS[plan[0]].label}.`, model: plan[0] };
  return { mode: 'ia', reason: null, model: plan[0] };
}

async function monthSpendMicro(db, month = monthOf()) {
  const row = await db('sita_messages').where({ month }).sum({ s: 'cost_micro_usd' }).first();
  return Number(row?.s || 0);
}

/** Dépense du mois, plafond et état de l'assistante (réglages du dashboard). */
async function usage(db, settings, month = monthOf()) {
  const spent = await monthSpendMicro(db, month);
  const spentFcfa = microUsdToFcfa(spent, settings.usd_fcfa);
  const mode = resolveMode(settings);
  const [calls] = await db('sita_messages').where({ month, mode: 'ia', role: 'assistante' }).whereIn('status', ['ok', 'corrige', 'erreur']).count({ n: '*' });
  const [conversations] = await db('sita_conversations').where('created_at', '>=', `${month}-01`).count({ n: '*' });
  return {
    month, spent_micro_usd: spent, spent_fcfa: spentFcfa, cap_fcfa: settings.cap_fcfa, usd_fcfa: settings.usd_fcfa,
    pct: settings.cap_fcfa > 0 ? Math.min(100, Math.round((spentFcfa / settings.cap_fcfa) * 100)) : 100,
    alert_pct: settings.alert_pct, calls: Number(calls.n), conversations: Number(conversations.n), model: settings.model,
    effective_model: mode.model || null, emergency_stop: settings.emergency_stop, mode: mode.mode, mode_reason: mode.reason,
    keys: { anthropic: marketingAi.keyInfo(), gemini: geminiAi.keyInfo() },
  };
}

/** Alerte à la Direction générale : seuil atteint, puis plafond atteint (ou demande refusée), une fois par mois. */
async function alertIfNeeded(db, settings, month, { refused = false } = {}) {
  const u = await usage(db, settings, month);
  if (refused || (u.cap_fcfa > 0 && u.spent_fcfa >= u.cap_fcfa)) {
    await inform(db, 'sita.plafond', { title: 'Plafond mensuel de dépense de Sita atteint', body: `${u.spent_fcfa.toLocaleString('fr-FR')} FCFA dépensés sur ${u.cap_fcfa.toLocaleString('fr-FR')} FCFA : Sita ne répond plus avec l’IA (les visiteurs sont orientés vers l’équipe) jusqu’au mois prochain ou jusqu’à ce que vous releviez le plafond dans Contenu du site › Assistante du site.`, link: '/commercial/sita', key: `sita-plafond:${month}` });
  } else if (u.cap_fcfa > 0 && u.pct >= u.alert_pct) {
    await inform(db, 'sita.plafond', { title: `Dépense de Sita à ${u.pct} % du plafond mensuel`, body: `${u.spent_fcfa.toLocaleString('fr-FR')} FCFA sur ${u.cap_fcfa.toLocaleString('fr-FR')} FCFA ce mois-ci.`, link: '/commercial/sita', key: `sita-alerte:${month}` });
  }
}

const blocks = res => (Array.isArray(res?.content) ? res.content : []);
const textOf = res => blocks(res).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

/**
 * Une réponse de l'IA à la conversation.
 * `system` : consignes ; `messages` : historique (alternance visiteur / assistante) ; `tools` : définitions ; `execute(name, input)` :
 * exécute l'outil côté serveur et renvoie un objet { ok, … } ; `check(text)` : avertissements de la réponse.
 * Renvoie { status, text, usage, cost_micro_usd, model, tools, warnings, error }. Ne lève jamais d'erreur pour une panne de l'IA :
 * le statut dit ce qui s'est passé ('ok', 'corrige', 'refuse_plafond', 'erreur'), l'appelant choisit quoi répondre au visiteur.
 * `model` est celui qui a répondu ; coût et jetons comptent aussi l'essai du fournisseur en panne s'il y en a eu un.
 */
async function converse(db, settings, params) {
  const plan = modelPlan(settings);
  if (!plan.length) return { status: 'erreur', model: settings.model, usage: {}, cost_micro_usd: 0, tools: [], warnings: [], error: 'Aucune clé de l’IA' };
  const used = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0 };
  const failures = [];
  let spent = 0;
  for (let i = 0; i < plan.length; i++) {
    const r = await attempt(db, settings, plan[i], params, spent);
    spent += r.cost_micro_usd;
    for (const k of Object.keys(used)) used[k] += r.usage[k] || 0;
    // Relais vers l'autre fournisseur : panne avant toute action (un outil exécuté ne doit pas l'être deux fois)
    if (r.status === 'erreur' && i + 1 < plan.length && !r.tools.length) { failures.push(`${SITA_MODELS[plan[i]].label} : ${r.error}`); continue; }
    const relay = failures.length ? [`Relais : ${SITA_MODELS[plan[i]].label} a répondu (${failures.join(' ; ')})`] : [];
    return { ...r, usage: used, cost_micro_usd: spent, warnings: [...relay, ...r.warnings] };
  }
}

/** Un essai avec un modèle donné ; `before` : coût déjà engagé par un essai précédent pour le même message. */
async function attempt(db, settings, model, { system, messages, tools, execute, check }, before = 0) {
  const month = monthOf();
  const capMicro = Math.round((settings.cap_fcfa / settings.usd_fcfa) * 1e6);
  const maxOut = settings.max_output_tokens;
  const thinkingRoom = SITA_MODELS[model].thinking_room || 0; // réflexion de Gemini : facturée en sortie, comptée dans l'estimation
  const used = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0 };
  const add = u => {
    used.tokens_in += u?.input_tokens || 0; used.tokens_out += u?.output_tokens || 0;
    used.tokens_cache_read += u?.cache_read_input_tokens || 0; used.tokens_cache_write += u?.cache_creation_input_tokens || 0;
  };
  const executed = [];
  const out = (status, extra = {}) => ({ status, model, usage: { ...used }, cost_micro_usd: costMicroUsd(model, used), tools: executed, warnings: [], ...extra });

  const estimate = msgs => costMicroUsd(model, { tokens_in: Math.ceil((system.length + JSON.stringify(msgs).length) / 2.5), tokens_out: maxOut + thinkingRoom });
  // Marge disponible pour un appel de plus (dépense du mois + appels en cours + déjà dépensé ici + estimation)
  const room = async msgs => settings.cap_fcfa > 0 && (await monthSpendMicro(db, month)) + inflight + before + costMicroUsd(model, used) + estimate(msgs) <= capMicro;

  if (!(await room(messages))) {
    await alertIfNeeded(db, settings, month, { refused: true });
    return out('refuse_plafond', { error: 'Plafond mensuel de dépense atteint' });
  }
  const reserved = estimate(messages);
  inflight += reserved;
  let msgs = [...messages];
  let retried = false;
  try {
    const client = PROVIDER_API[providerOf(model)].getClient();
    for (let round = 0; round < MAX_TOOL_ROUNDS + 2; round++) {
      if (round > 0 && !(await room(msgs))) { await alertIfNeeded(db, settings, month, { refused: true }); return out('refuse_plafond', { error: 'Plafond mensuel de dépense atteint' }); }
      const res = await client.messages.create({
        model, max_tokens: maxOut, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: msgs, tools,
      });
      add(res?.usage);
      const uses = blocks(res).filter(b => b.type === 'tool_use');
      if (uses.length) {
        if (executed.length >= MAX_TOOL_ROUNDS * 2) break; // trop d'appels d'outils pour un seul message
        const results = [];
        for (const u of uses) {
          let result;
          try { result = await execute(u.name, u.input || {}); } catch (e) { result = { ok: false, error: clean(e) }; }
          executed.push({ name: u.name, ok: result?.ok !== false, result: result?.public ?? null });
          const { public: _public, ...forModel } = result || {};
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(forModel), ...(result?.ok === false ? { is_error: true } : {}) });
        }
        msgs = [...msgs, { role: 'assistant', content: res.content }, { role: 'user', content: results }];
        continue;
      }
      const text = textOf(res);
      if (!text) { msgs = [...msgs, { role: 'assistant', content: res.content?.length ? res.content : [{ type: 'text', text: '(vide)' }] }, { role: 'user', content: 'Ta réponse était vide : réponds au visiteur en quelques phrases.' }]; continue; }
      const warnings = check(text);
      if (!warnings.length) return out(retried ? 'corrige' : 'ok', { text, warnings: retried ? ['Première réponse corrigée par les contrôles'] : [] });
      if (!retried) {
        retried = true;
        msgs = [...msgs, { role: 'assistant', content: [{ type: 'text', text }] }, { role: 'user', content: `Contrôle automatique : ${warnings.join(' ; ')} Réécris ta réponse au visiteur sans ces éléments, en n’utilisant que les faits fournis, ou dis que tu ne sais pas et propose de passer la main.` }];
        continue;
      }
      return out('corrige', { text: null, warnings }); // deuxième échec : l'appelant remplace par une réponse prudente
    }
    return out('corrige', { text: null, warnings: ['Trop d’appels d’outils ou réponse vide'] });
  } catch (err) {
    return out('erreur', { error: clean(err) });
  } finally {
    inflight = Math.max(0, inflight - reserved);
    await alertIfNeeded(db, settings, month).catch(() => {});
  }
}

module.exports = { resolveMode, modelPlan, monthSpendMicro, usage, alertIfNeeded, converse, costMicroUsd };
