/**
 * Audiences publicitaires Meta (Marketing › Réglages › Audiences, droit marketing:settings).
 * (a) Audiences d'interaction : construites PAR META (visiteurs du site via le pixel, personnes ayant interagi avec la page ou le
 *     compte Instagram) ; SIIPAF ne reçoit aucune identité. Créées par l'API si le compte publicitaire est connecté.
 * (b) Centres d'intérêt immobilier : paramètres proposés par l'IA pour chaque campagne (services/metaTargeting.js).
 * (c) Audience similaire : liste de clients et de prospects HACHÉE en SHA-256 (e-mail et téléphone normalisés au format Meta), téléchargeable
 *     en CSV et envoyée par l'API au compte publicitaire si connecté ; l'audience similaire est ensuite créée à partir d'elle.
 * Aucune donnée en clair ne quitte le serveur : seuls des condensés SHA-256 sont exportés ou envoyés. Chaque export et chaque envoi est
 * journalisé (qui, quand, combien de personnes) et la Direction générale en est informée.
 */
const { HttpError, isoTime } = require('../lib/http');
const { CLIENT_STAGES } = require('../lib/domain');
const M = require('../lib/meta');
const graph = require('./metaGraph');
const cfg = require('./metaSettings');
const { inform } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const SCOPES = { clients: 'Clients (acquéreurs)', prospects: 'Prospects en cours', tous: 'Clients et prospects en cours' };
const BATCH = 10000;
const MIN_LOOKALIKE = 100; // seuil de Meta pour créer une audience similaire

/** Audiences d'interaction : règles construites par Meta (aucune identité reçue). */
const INTERACTIONS = {
  site_30j: { label: 'Visiteurs du site (30 jours)', needs: 'pixel_id', build: c => ({ subtype: 'WEBSITE', retention_days: 30, prefill: true, rule: JSON.stringify({ inclusion: { operator: 'or', rules: [{ event_sources: [{ id: c.pixel_id, type: 'pixel' }], retention_seconds: 30 * 86400, filter: { operator: 'and', filters: [{ field: 'url', operator: 'i_contains', value: 'siipaf' }] } }] } }) }) },
  programme_30j: { label: 'Visiteurs d’une page de programme (30 jours)', needs: 'pixel_id', build: c => ({ subtype: 'WEBSITE', retention_days: 30, prefill: true, rule: JSON.stringify({ inclusion: { operator: 'or', rules: [{ event_sources: [{ id: c.pixel_id, type: 'pixel' }], retention_seconds: 30 * 86400, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'ViewContent' }] } }] } }) }) },
  instagram_90j: { label: 'Personnes ayant interagi avec le compte Instagram (90 jours)', needs: 'instagram_id', build: c => ({ subtype: 'ENGAGEMENT', prefill: true, rule: JSON.stringify({ inclusion: { operator: 'or', rules: [{ event_sources: [{ id: c.instagram_id, type: 'ig_business' }], retention_seconds: 90 * 86400, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'ig_business_profile_all' }] } }] } }) }) },
  page_90j: { label: 'Personnes ayant interagi avec la page Facebook (90 jours)', needs: 'page_id', build: c => ({ subtype: 'ENGAGEMENT', prefill: true, rule: JSON.stringify({ inclusion: { operator: 'or', rules: [{ event_sources: [{ id: c.page_id, type: 'page' }], retention_seconds: 90 * 86400, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'page_engaged' }] } }] } }) }) },
};

/** Personnes éligibles : clients (étapes de client) et/ou prospects en cours, jamais les prospects perdus. */
async function people(db, scope) {
  if (!SCOPES[scope]) throw new HttpError(400, 'Périmètre inconnu.');
  const q = db('leads').whereNot('stage', 'perdu').select('id', 'email', 'phone', 'stage');
  if (scope === 'clients') q.whereIn('stage', CLIENT_STAGES);
  else if (scope === 'prospects') q.whereNotIn('stage', CLIENT_STAGES);
  return q;
}

/** Nombre de personnes exploitables par périmètre (au moins un e-mail ou un téléphone valide), sans aucun condensé. */
async function preview(db) {
  const out = {};
  for (const scope of Object.keys(SCOPES)) {
    const rows = await people(db, scope);
    const usable = rows.filter(r => M.hashPerson(r));
    out[scope] = { label: SCOPES[scope], people: rows.length, usable: usable.length, with_email: usable.filter(r => M.normalizeEmail(r.email)).length, with_phone: usable.filter(r => M.normalizePhone(r.phone)).length };
  }
  return out;
}

async function journal(db, kind, user, detail, extra = {}) {
  await db('meta_events').insert({ kind, status: extra.status || 'ok', detail: String(detail).slice(0, 500), user_id: user?.id || null });
}

/** Fichier CSV haché (en-tête email,phone) ; l'export est journalisé et la Direction générale informée. */
async function exportCsv(db, scope, user) {
  const rows = await people(db, scope);
  const { csv, count } = M.audienceCsv(rows);
  if (!count) throw new HttpError(409, 'Aucune personne exploitable (e-mail ou téléphone valide) dans ce périmètre.');
  await journal(db, 'export', user, `Export CSV haché (SHA-256) : ${count} personne(s), périmètre « ${SCOPES[scope]} ».`);
  await inform(db, 'meta.audience_exportee', { title: `Liste d’audience exportée par ${user.name}`, body: `${count} personne(s) — ${SCOPES[scope]} (condensés SHA-256, aucune donnée en clair).`, link: '/marketing/reglages', key: `meta-export:${Date.now()}`, except: user.id }).catch(() => {});
  return { csv, count, filename: `audience-meta-${scope}-${new Date().toISOString().slice(0, 10)}.csv` };
}

function requireAds(creds) {
  if (!creds.ad_account_id || !(creds.ads_token || creds.page_token)) {
    throw new HttpError(409, 'Compte publicitaire non connecté : renseignez l’identifiant du compte publicitaire et un jeton dans Réglages, ou téléchargez le fichier et importez-le dans le Gestionnaire de publicités.', { code: 'non_connecte' });
  }
}
const failure = (err, creds) => new HttpError(502, `Meta a refusé la demande : ${graph.clean(err, creds)}`);

async function list(db) {
  const rows = await db('meta_audiences as a').leftJoin('users as u', 'u.id', 'a.created_by').orderBy('a.id', 'desc').limit(50)
    .select('a.*', 'u.name as created_by_name');
  return rows.map(a => ({ ...a, scope_label: SCOPES[a.scope] || a.scope, created_at: isoTime(a.created_at) }));
}

/** Envoie la liste hachée au compte publicitaire (audience personnalisée), par lots de 10 000. */
async function uploadList(db, { scope, name }, user) {
  const creds = await cfg.credentials(db);
  requireAds(creds);
  const rows = await people(db, scope);
  const seen = new Set();
  const data = [];
  for (const r of rows) {
    const h = M.hashPerson(r);
    if (!h) continue;
    const k = `${h.email}|${h.phone}`;
    if (seen.has(k)) continue;
    seen.add(k);
    data.push([h.email, h.phone]);
  }
  if (!data.length) throw new HttpError(409, 'Aucune personne exploitable (e-mail ou téléphone valide) dans ce périmètre.');
  const title = String(name || '').trim().slice(0, 120) || `SIIPAF — ${SCOPES[scope]} — ${new Date().toISOString().slice(0, 10)}`;
  let metaId;
  try {
    const created = await graph.createCustomAudience(creds, { name: title, subtype: 'CUSTOM', description: 'Liste de clients et prospects SIIPAF (identifiants hachés SHA-256)', customer_file_source: 'USER_PROVIDED_ONLY' });
    metaId = created.id;
    for (let i = 0; i < data.length; i += BATCH) await graph.addAudienceUsers(creds, metaId, data.slice(i, i + BATCH));
  } catch (err) {
    await journal(db, 'audience', user, `Envoi de l’audience « ${title} » refusé : ${graph.clean(err, creds)}`, { status: 'erreur' });
    throw failure(err, creds);
  }
  const id = insertedId((await db('meta_audiences').insert({ kind: 'liste', name: title, scope, size: data.length, meta_audience_id: String(metaId), status: 'cree', created_by: user.id, detail: `${data.length} personne(s) envoyée(s), condensés SHA-256` }))[0]);
  await journal(db, 'audience', user, `Audience « ${title} » envoyée à Meta : ${data.length} personne(s) (condensés SHA-256).`);
  await inform(db, 'meta.audience_exportee', { title: `Liste d’audience envoyée à Meta par ${user.name}`, body: `${data.length} personne(s) — ${SCOPES[scope]} (condensés SHA-256).`, link: '/marketing/reglages', key: `meta-audience:${id}`, except: user.id }).catch(() => {});
  return (await list(db)).find(a => a.id === id);
}

/** Audience d'interaction construite par Meta (pixel, Instagram, page) : aucune identité transmise à SIIPAF. */
async function createInteraction(db, preset, user) {
  const def = INTERACTIONS[preset];
  if (!def) throw new HttpError(400, 'Modèle d’audience inconnu.');
  const creds = await cfg.credentials(db);
  requireAds(creds);
  if (!creds[def.needs]) throw new HttpError(409, `Renseignez d’abord « ${M.ID_FIELDS[def.needs]} » dans Réglages.`);
  const title = `SIIPAF — ${def.label}`;
  let created;
  try { created = await graph.createCustomAudience(creds, { name: title, description: 'Audience d’interaction construite par Meta (aucune identité transmise à SIIPAF)', ...def.build(creds) }); } catch (err) {
    await journal(db, 'audience', user, `Audience « ${title} » refusée : ${graph.clean(err, creds)}`, { status: 'erreur' });
    throw failure(err, creds);
  }
  const id = insertedId((await db('meta_audiences').insert({ kind: 'interaction', name: title, scope: preset, size: 0, meta_audience_id: String(created.id), status: 'cree', created_by: user.id, detail: 'Construite par Meta' }))[0]);
  await journal(db, 'audience', user, `Audience d’interaction « ${title} » créée.`);
  return (await list(db)).find(a => a.id === id);
}

/** Audience similaire à partir d'une liste déjà envoyée (au moins 100 personnes). */
async function createLookalike(db, originId, { country = 'CI', ratio = 0.01 } = {}, user) {
  const origin = await db('meta_audiences').where({ id: originId, kind: 'liste' }).first();
  if (!origin) throw new HttpError(404, 'Liste d’origine introuvable : envoyez d’abord la liste au compte publicitaire.');
  if (origin.size < MIN_LOOKALIKE) throw new HttpError(409, `Meta exige au moins ${MIN_LOOKALIKE} personnes dans la liste d’origine (celle-ci en compte ${origin.size}).`);
  const creds = await cfg.credentials(db);
  requireAds(creds);
  const title = `SIIPAF — Similaire à « ${origin.name} » (${country}, ${Math.round(ratio * 100)} %)`.slice(0, 160);
  let created;
  try { created = await graph.createLookalike(creds, { name: title, originId: origin.meta_audience_id, country, ratio }); } catch (err) {
    await journal(db, 'audience', user, `Audience similaire « ${title} » refusée : ${graph.clean(err, creds)}`, { status: 'erreur' });
    throw failure(err, creds);
  }
  const id = insertedId((await db('meta_audiences').insert({ kind: 'similaire', name: title, scope: origin.scope, size: 0, meta_audience_id: String(created.id), origin_id: origin.id, status: 'cree', created_by: user.id, detail: `Pays ${country}, ${Math.round(ratio * 100)} %` }))[0]);
  await journal(db, 'audience', user, `Audience similaire « ${title} » créée.`);
  return (await list(db)).find(a => a.id === id);
}

module.exports = { SCOPES, INTERACTIONS, MIN_LOOKALIKE, people, preview, exportCsv, uploadList, createInteraction, createLookalike, list };
