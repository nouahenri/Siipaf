/**
 * Ciblage Meta et textes d'annonce d'une campagne (Marketing › Campagne › Ciblage Meta). L'IA du Marketing PROPOSE (zones, âges,
 * langues, centres d'intérêt immobilier, diaspora, audiences, textes d'annonce) avec le même socle que le reste du module : faits
 * publiés seulement (jamais de prospect ni de client), plafond mensuel en FCFA, arrêt d'urgence, mode démonstration sans clé,
 * mêmes contrôles de véracité (montants, fausse urgence, promesse de gain, superlatifs, mots interdits). La responsable de la
 * communication valide ; rien n'est appliqué automatiquement dans Meta : les paramètres se recopient dans le Gestionnaire de publicités.
 * Statuts : brouillon (avertissements à corriger) → à valider → validé ; refusé revient à corriger ; une nouvelle proposition validée archive la précédente.
 */
const { HttpError, json, isoTime } = require('../lib/http');
const { checkContent, SEGMENTS } = require('../lib/marketing');
const M = require('../lib/meta');
const prompts = require('../lib/marketingPrompts');
const settingsService = require('./marketingSettings');
const ai = require('./marketingAi');
const { buildContext } = require('./marketingContext');
const { inform } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const money = n => `${Number(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;

const logEvent = (db, row) => db('marketing_events').insert({ campaign_id: row.campaignId, action: row.action, user_id: row.user?.id || null, is_ai: !!row.ai, note: row.note ? String(row.note).slice(0, 500) : null });

function serialize(r) {
  const w = json(r.warnings, {});
  return {
    id: r.id, campaign_id: r.campaign_id, version_no: r.version_no, status: r.status, status_label: M.TARGETING_STATUSES[r.status], origin: r.origin,
    params: json(r.params, {}), ads: json(r.ads, []), rationale: r.rationale, warnings: Array.isArray(w) ? w : w.blocking || [], notes: Array.isArray(w) ? [] : w.notes || [],
    reject_reason: r.reject_reason, created_by: r.created_by, validated_by: r.validated_by, validated_at: isoTime(r.validated_at), created_at: isoTime(r.created_at),
    validated_by_name: r.validated_by_name || null, created_by_name: r.created_by_name || null,
  };
}

async function requireTargeting(db, id) {
  const row = await db('marketing_targetings as t').leftJoin('users as v', 'v.id', 't.validated_by').leftJoin('users as c', 'c.id', 't.created_by')
    .where('t.id', id).first('t.*', 'v.name as validated_by_name', 'c.name as created_by_name');
  if (!row) throw new HttpError(404, 'Ciblage introuvable.');
  return row;
}

async function requireCampaignOpen(db, id) {
  const c = await db('marketing_campaigns').where({ id }).first();
  if (!c) throw new HttpError(404, 'Campagne introuvable.');
  if (c.status === 'archivee') throw new HttpError(409, 'Une campagne archivée ne se prépare plus.');
  return c;
}

async function list(db, campaignId) {
  const rows = await db('marketing_targetings as t').leftJoin('users as v', 'v.id', 't.validated_by').leftJoin('users as c', 'c.id', 't.created_by')
    .where('t.campaign_id', campaignId).whereNot('t.status', 'archive').orderBy('t.id', 'desc').select('t.*', 'v.name as validated_by_name', 'c.name as created_by_name');
  return rows.map(serialize);
}

/** Contrôles : textes d'annonce et résumé (bloquants) ; notes de la plateforme (informatives, non bloquantes). */
async function check(db, campaign, params, ads) {
  const { facts } = await buildContext(db, { projectId: campaign.project_id });
  const banned = (await settingsService.textSettings(db)).banned_words;
  const blocking = [];
  ads.forEach((a, i) => {
    for (const w of checkContent({ subject: a.headline, body: [a.primary_text, a.description].filter(Boolean).join('\n'), cta: null, hashtags: [] }, facts, { banned })) blocking.push(`Annonce ${i + 1} : ${w}`);
  });
  for (const w of checkContent({ subject: null, body: [params.summary, ...params.interests, ...params.audiences.map(a => a.description)].join('\n'), cta: null, hashtags: [] }, facts, { banned })) blocking.push(`Ciblage : ${w}`);
  return { blocking: [...new Set(blocking)], notes: M.targetingWarnings(params) };
}

// ─── Gabarit de démonstration (sans IA) ───────────────────────────────────

const AGES = { residence_principale: [28, 55], diaspora: [30, 60], investisseur: [30, 65], entreprise: [28, 60], parrainage: [28, 65] };

/** Ciblage de démonstration construit sur les vrais faits : villes des programmes, segment de la campagne. Aucun chiffre inventé. */
function demoTargeting({ campaign, facts }) {
  const programmes = facts.programmes || [];
  const focus = programmes[0] || null;
  const cities = [...new Set(programmes.map(p => p.ville).filter(Boolean))].slice(0, 4);
  const diaspora = campaign.segment === 'diaspora';
  const [age_min, age_max] = AGES[campaign.segment] || [28, 55];
  const cheapest = focus ? focus.offres.filter(o => o.price_fcfa).sort((a, b) => a.price_fcfa - b.price_fcfa)[0] : null;
  const name = focus?.nom || 'nos programmes';
  const where = focus?.ville ? ` à ${focus.ville}` : '';
  const ads = [
    { headline: `Découvrez ${name}`.slice(0, 40), primary_text: `${focus?.accroche ? `${focus.accroche.replace(/[.\s]+$/, '')}. ` : ''}${name}${where} : programme suivi par SIIPAF, avec des conditions d’acquisition expliquées simplement.${focus?.livraison ? ` Livraison prévue : ${focus.livraison}.` : ''}`.slice(0, 500), description: 'Visites sur rendez-vous', cta_button: 'LEARN_MORE' },
    { headline: 'Échangez avec un conseiller'.slice(0, 40), primary_text: `Une question sur ${name}${where} ? Écrivez-nous en message privé : un conseiller SIIPAF vous répond.${cheapest ? ` À partir de ${money(cheapest.price_fcfa)} (${cheapest.intitule}).` : ''}`.slice(0, 500), description: null, cta_button: 'SEND_MESSAGE' },
  ];
  const params = {
    summary: `${SEGMENTS[campaign.segment] || 'Acquéreurs'} intéressés par un achat immobilier${cities.length ? ` autour de ${cities.join(', ')}` : ' en Côte d’Ivoire'}.`,
    zones: [...(cities.length ? cities : ['Abidjan']).map(label => ({ label, kind: 'ville', note: null })), { label: 'Côte d’Ivoire', kind: 'pays', note: null }].slice(0, 6),
    age_min, age_max, languages: diaspora ? ['fr', 'en'] : ['fr'],
    interests: ['Immobilier', 'Investissement immobilier', 'Achat de maison', 'Construction'],
    diaspora: diaspora ? { enabled: true, countries: ['France', 'Belgique', 'Suisse'], note: 'Ajoutez d’autres pays de résidence selon vos remontées ; États-Unis et Canada exigent la catégorie publicitaire spéciale Logement.' } : { enabled: false, countries: [], note: null },
    audiences: [
      { kind: 'interaction', description: 'Visiteurs du site siipaf.com des 30 derniers jours et personnes ayant interagi avec la page Facebook ou le compte Instagram (audiences construites par Meta, sans identité transmise à SIIPAF).' },
      { kind: 'centres_interet', description: 'Personnes intéressées par l’immobilier et l’investissement immobilier dans les zones ci-dessus.' },
      { kind: 'similaire', description: 'Audience similaire d’une liste hachée de clients (Marketing › Réglages › Audiences), à partir de 100 personnes.' },
    ],
    exclusions: ['Clients ayant déjà acquis un bien (liste hachée de clients)'],
  };
  return { params, ads, rationale: 'Proposition de démonstration construite sur les programmes publiés et le segment de la campagne ; à affiner par la responsable de la communication.' };
}

// ─── Actions ──────────────────────────────────────────────────────────────

async function notifyToValidate(db, campaign, { key, user = null, what }) {
  return inform(db, 'marketing.a_valider', {
    title: `Ciblage Meta ${what}, à valider`, body: `Campagne « ${campaign.name} » : relisez le ciblage et les textes d'annonce.`, link: `/marketing/campagnes/${campaign.id}`, key, except: user?.id || null,
  });
}

/** Demande à l'IA (ou au gabarit) un ciblage et des annonces pour la campagne. */
async function generate(db, campaignId, user, { mode = null } = {}) {
  const campaign = await requireCampaignOpen(db, campaignId);
  const { facts } = await buildContext(db, { projectId: campaign.project_id });
  const s = await settingsService.all(db);
  const feedback = (await db('marketing_targetings').where({ campaign_id: campaignId }).whereNotNull('reject_reason').orderBy('id', 'desc').limit(3).select('reject_reason')).map(r => String(r.reject_reason).slice(0, 300));
  const brief = { ...campaign, concept: json(campaign.concept, null) };
  const run = await ai.run(db, {
    step: 'ciblage', campaign, user, forced: mode, facts, schema: M.targetingSchema,
    system: prompts.systemPrompt({ tone: s.tone, brandNotes: s.brand_notes, banned: s.banned_words }),
    prompt: prompts.targetingPrompt({ campaign: brief, facts, feedback }),
    demo: () => demoTargeting({ campaign, facts }),
  });
  const out = M.targetingSchema.safeParse(run.output);
  if (!out.success) throw new HttpError(422, 'Le ciblage préparé est inutilisable : rien n’a été créé. Réessayez ou utilisez le mode démonstration.');
  const { params, ads, rationale } = out.data;
  const checks = await check(db, campaign, params, ads);
  const [{ max }] = await db('marketing_targetings').where({ campaign_id: campaignId }).max({ max: 'version_no' });
  const status = checks.blocking.length ? 'brouillon' : 'a_valider';
  const origin = run.mode === 'ia' ? 'ia' : 'demo';
  const id = insertedId((await db('marketing_targetings').insert({
    campaign_id: campaignId, version_no: Number(max || 0) + 1, status, origin, params: JSON.stringify(params), ads: JSON.stringify(ads), rationale: rationale || null,
    warnings: JSON.stringify(checks), generation_id: run.generation_id, created_by: null,
  }))[0]);
  await logEvent(db, { campaignId, action: 'propose', ai: true, user, note: `Ciblage Meta ${origin === 'ia' ? 'préparé par l’IA' : 'de démonstration'}.` });
  if (status === 'a_valider') await notifyToValidate(db, campaign, { key: `marketing-valider:ciblage:${id}`, user, what: origin === 'ia' ? 'préparé par l’IA' : 'de démonstration préparé' });
  return { ...serialize(await requireTargeting(db, id)), generation_id: run.generation_id, mode: run.mode, cost_micro_usd: run.cost_micro_usd };
}

function guardEditable(row) {
  if (['valide', 'archive'].includes(row.status)) throw new HttpError(409, row.status === 'valide' ? 'Ce ciblage est validé : demandez-en un nouveau ou refusez-le pour le corriger.' : 'Ce ciblage est archivé.');
}

/** Correction à la main (paramètres et annonces) : revient en brouillon, contrôles refaits. */
async function edit(db, id, patch, user) {
  const row = await requireTargeting(db, id);
  guardEditable(row);
  const campaign = await requireCampaignOpen(db, row.campaign_id);
  const merged = M.targetingSchema.safeParse({ params: patch.params || json(row.params, {}), ads: patch.ads || json(row.ads, []), rationale: patch.rationale === undefined ? row.rationale : patch.rationale });
  if (!merged.success) throw new HttpError(400, 'Données invalides.', merged.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  const { params, ads, rationale } = merged.data;
  const checks = await check(db, campaign, params, ads);
  await db('marketing_targetings').where({ id }).update({
    params: JSON.stringify(params), ads: JSON.stringify(ads), rationale: rationale || null, warnings: JSON.stringify(checks), status: 'brouillon', reject_reason: null, updated_at: new Date(),
  });
  await logEvent(db, { campaignId: row.campaign_id, action: 'edit', user, note: `Ciblage Meta n° ${row.version_no} modifié.` });
  return serialize(await requireTargeting(db, id));
}

async function submit(db, id, user) {
  const row = await requireTargeting(db, id);
  if (row.status !== 'brouillon') throw new HttpError(409, 'Seul un brouillon peut être soumis à validation.');
  const campaign = await requireCampaignOpen(db, row.campaign_id);
  const checks = await check(db, campaign, json(row.params, {}), json(row.ads, []));
  await db('marketing_targetings').where({ id }).update({ warnings: JSON.stringify(checks), updated_at: new Date() });
  if (checks.blocking.length) throw new HttpError(409, 'Ce ciblage comporte des avertissements : corrigez-les avant de le soumettre.', { warnings: checks.blocking });
  await db('marketing_targetings').where({ id }).update({ status: 'a_valider', reject_reason: null });
  await logEvent(db, { campaignId: row.campaign_id, action: 'submit', user, note: `Ciblage Meta n° ${row.version_no} soumis.` });
  await notifyToValidate(db, campaign, { key: `marketing-valider:ciblage:${id}:${Date.now()}`, user, what: `soumis par ${user.name}` });
  return serialize(await requireTargeting(db, id));
}

async function validate(db, id, user) {
  const row = await requireTargeting(db, id);
  if (row.status !== 'a_valider') throw new HttpError(409, 'Seul un ciblage « à valider » peut être validé.');
  const campaign = await requireCampaignOpen(db, row.campaign_id);
  const checks = await check(db, campaign, json(row.params, {}), json(row.ads, []));
  if (checks.blocking.length) {
    await db('marketing_targetings').where({ id }).update({ status: 'brouillon', warnings: JSON.stringify(checks) });
    throw new HttpError(409, 'Ce ciblage comporte des avertissements : corrigez-les avant de le valider.', { warnings: checks.blocking });
  }
  await db.transaction(async trx => {
    await trx('marketing_targetings').where({ campaign_id: row.campaign_id, status: 'valide' }).update({ status: 'archive', updated_at: new Date() });
    await trx('marketing_targetings').where({ id }).update({ status: 'valide', validated_by: user.id, validated_at: new Date(), warnings: JSON.stringify(checks), reject_reason: null, updated_at: new Date() });
  });
  await logEvent(db, { campaignId: row.campaign_id, action: 'validate', user, note: `Ciblage Meta n° ${row.version_no} validé.` });
  if (row.created_by) await inform(db, 'marketing.valide', { direct: [row.created_by], title: `Ciblage Meta validé : ${campaign.name}`, link: `/marketing/campagnes/${campaign.id}`, key: `marketing-valide:ciblage:${id}`, except: user.id });
  return serialize(await requireTargeting(db, id));
}

async function reject(db, id, reason, user) {
  const row = await requireTargeting(db, id);
  if (!['a_valider', 'valide'].includes(row.status)) throw new HttpError(409, 'Seul un ciblage à valider ou validé peut être refusé.');
  await db('marketing_targetings').where({ id }).update({ status: 'brouillon', reject_reason: String(reason).slice(0, 500), validated_by: null, validated_at: null, updated_at: new Date() });
  await logEvent(db, { campaignId: row.campaign_id, action: 'reject', user, note: `Ciblage Meta n° ${row.version_no} refusé : ${reason}` });
  if (row.created_by) await inform(db, 'marketing.refuse', { direct: [row.created_by], title: 'Ciblage Meta refusé', body: reason, link: `/marketing/campagnes/${row.campaign_id}`, key: `marketing-refuse:ciblage:${id}:${Date.now()}`, except: user.id });
  return serialize(await requireTargeting(db, id));
}

async function archive(db, id, user) {
  const row = await requireTargeting(db, id);
  if (row.status === 'archive') return serialize(row);
  await db('marketing_targetings').where({ id }).update({ status: 'archive', updated_at: new Date() });
  await logEvent(db, { campaignId: row.campaign_id, action: 'archive', user, note: `Ciblage Meta n° ${row.version_no} archivé.` });
  return serialize(await requireTargeting(db, id));
}

module.exports = { list, generate, edit, submit, validate, reject, archive, demoTargeting, check, requireTargeting };
