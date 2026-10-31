/**
 * Centre de notifications commun de l'ERP (docs/analyse-liaisons-inter-services.md §6.1). Chaque module appelle
 * `notify` au lieu d'envoyer ses e-mails lui-même : une notification par destinataire dans la cloche de l'ERP,
 * plus l'e-mail quand le module le demande. Sans doublon : une même clé n'est notifiée qu'une fois par compte.
 * Personne n'est notifié de sa propre action (`except` : un compte ou une liste de comptes), ni d'un module dont il a coupé les notifications.
 */
const { isoTime } = require('../lib/http');
const { erpUrl } = require('../config');
const { sendMail } = require('../lib/mailer');
const { effectivePermissions, hasPermission } = require('./permissions');
const { INFO_EVENTS, INFO_AUDIENCES } = require('../lib/domain');

const NOTIF_MODULES = {
  commercial: 'Service commercial', sav: 'Client & SAV', compta: 'Comptabilité', rh: 'Ressources humaines', administration: 'Administration générale',
  juridique: 'Juridique', chantiers: 'Chantiers', achats: 'Achats & stocks', marketing: 'Marketing & Communication', qhse: 'QHSE',
};
const PRIORITIES = ['info', 'action', 'urgent'];

/**
 * Pages de l'ERP réservées à certains droits : une notification ne mène que là où son destinataire peut aller (audit du 30/10 :
 * un commercial recevait /chantiers/<id> sans droit sur les chantiers). Une page absente de la liste est ouverte à tous.
 * Le test reçoit `has(droit)`, le compte et la base ; le conducteur d'un chantier ouvre le sien sans autre droit.
 */
const CHANTIERS_ANY = ['chantiers:read', 'chantiers:create', 'chantiers:plan', 'chantiers:budget', 'chantiers:settings', 'chantiers:tma', 'chantiers:stages', 'chantiers:situations', 'direction:read'];
const JURIDIQUE_ANY = ['juridique:read', 'juridique:deeds', 'juridique:litigation', 'juridique:guarantees', 'juridique:settings', 'direction:read'];
const LINK_RULES = [
  [/^\/chantiers/, async (has, u, db) => CHANTIERS_ANY.some(has) || !!(await db('worksites').where({ manager_id: u.id }).first('id'))],
  [/^\/achats/, has => has('appro:read')],
  [/^\/commercial\/pipeline/, has => has('leads:read')],
  [/^\/commercial\/rendez-vous/, has => has('appointments:read')],
  [/^\/commercial\/ventes/, has => has('commercial:read') && has('sales:read')],
  [/^\/commercial\/vefa/, has => has('commercial:read') || has('vefa:read') || has('vefa:write')],
  [/^\/commercial/, has => has('commercial:read')],
  [/^\/(compta|sav|administration)\/ventes/, has => has('sales:read')],
  [/^\/compta\/recu/, has => has('sales:read') || has('payments:write')],
  [/^\/compta\/paie/, has => has('paie:read')],
  [/^\/compta/, has => has('compta:read')],
  [/^\/sav/, has => has('sav:read')],
  [/^\/juridique\/(actes|impayes)/, has => JURIDIQUE_ANY.some(has)],
  [/^\/marketing/, has => has('marketing:read')],
  [/^\/qhse/, has => has('qhse:read')],
  [/^\/rh\/(personnel|recrutement|competences)/, has => has('rh:read')],
];
// Pages de repli, par ordre, quand le lien prévu est fermé au destinataire
const LINK_FALLBACKS = ['/commercial/ventes', '/sav/reclamations', '/compta', '/achats'];

/** Lien de la notification pour ce compte : celui prévu s'il peut l'ouvrir, sinon la première page de repli qui lui est ouverte, sinon l'accueil. */
async function linkFor(db, user, link, cache = {}) {
  if (!link) return link;
  const opens = async target => {
    const rule = LINK_RULES.find(([re]) => re.test(target));
    if (!rule) return true;
    if (!cache[user.id]) {
      const perms = await effectivePermissions(db, user);
      cache[user.id] = x => hasPermission(perms, x);
    }
    return !!(await rule[1](cache[user.id], user, db));
  };
  if (await opens(link)) return link;
  for (const f of LINK_FALLBACKS) if (await opens(f)) return f;
  return '/';
}

/** Préférences d'un compte par module : { commercial: { enabled: false, sound: 'goutte' }, … } (vide = tout activé). */
function prefsOf(u) {
  try {
    const p = u?.notif_prefs ? JSON.parse(u.notif_prefs) : {};
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch { return {}; }
}

/**
 * Comptes actifs qui ont l'un des droits donnés. Le super administrateur (tous les droits) n'est retenu que si
 * personne d'autre ne les a, pour ne pas recevoir toutes les alertes de l'entreprise.
 */
async function usersWith(db, perms) {
  const wanted = [].concat(perms);
  const users = await db('users').where({ active: true }).select('id', 'name', 'email', 'role');
  const holders = [];
  for (const u of users) {
    if (u.role === 'super_admin') continue;
    const p = await effectivePermissions(db, u);
    if (wanted.some(x => hasPermission(p, x))) holders.push(u);
  }
  return holders.length ? holders : users.filter(u => u.role === 'super_admin');
}

/**
 * Comptes qui ont l'un des droits d'une liste (chaque droit cherché séparément, doublons retirés), avec le repli sur le
 * super administrateur de `usersWith` : « l'un ou l'autre » des droits.
 */
async function usersWithAny(db, perms) {
  const found = await Promise.all([].concat(perms).map(p => usersWith(db, p)));
  return [...new Map(found.flat().map(u => [u.id, u])).values()];
}

/** Compte relié à un employé (son responsable direct, par exemple). */
async function employeeUser(db, employeeId) {
  if (!employeeId) return null;
  return db('employees as e').join('users as u', 'u.id', 'e.user_id').where({ 'e.id': employeeId, 'u.active': true }).first('u.id', 'u.name', 'u.email');
}

/**
 * Notifie des comptes. `to` : comptes ({ id, name, email }) ou identifiants, doublons et vides ignorés.
 * `email` : false (cloche seule), true (e-mail standard) ou { subject, text: u => … } (texte propre au module).
 * Renvoie le nombre de comptes notifiés.
 */
async function notify(db, { to, module, event, title, body = null, link = null, priority = 'info', key = null, except = null, email = false }) {
  const list = [].concat(to || []).filter(Boolean);
  const excepted = [].concat(except || []).map(Number); // l'auteur de l'action, et au besoin ceux déjà prévenus par ailleurs
  const ids = [...new Set(list.map(u => (typeof u === 'object' ? u.id : Number(u))).filter(id => id && !excepted.includes(id)))];
  if (!ids.length) return 0;
  const users = await db('users').whereIn('id', ids).where({ active: true }).select('id', 'name', 'email', 'role', 'notif_prefs');
  let count = 0;
  const perms = {};
  for (const u of users) {
    if (prefsOf(u)[module]?.enabled === false) continue;
    if (key && (await db('notifications').where({ user_id: u.id, dedupe_key: key }).first('id'))) continue;
    const target = await linkFor(db, u, link, perms); // lien que ce destinataire peut ouvrir
    await db('notifications').insert({
      user_id: u.id, module, event, title: title.slice(0, 255), body: body ? String(body).slice(0, 500) : null, link: target,
      priority: PRIORITIES.includes(priority) ? priority : 'info', dedupe_key: key,
    });
    count++;
    if (email && u.email) {
      const custom = typeof email === 'object' ? email : {};
      await sendMail({
        to: u.email,
        subject: custom.subject || `[SIIPAF] ${title}`,
        text: typeof custom.text === 'function' ? custom.text(u)
          : `Bonjour ${u.name},\n\n${title}${body ? `\n${body}` : ''}${target ? `\n\nOuvrir dans l’ERP : ${erpUrl}${target}` : ''}`,
      });
    }
  }
  return count;
}

const serialize = n => ({
  id: n.id, module: n.module, module_label: NOTIF_MODULES[n.module] || n.module, event: n.event, title: n.title, body: n.body,
  link: n.link, priority: n.priority, read: !!n.read_at, created_at: isoTime(n.created_at),
});

/** La cloche : dernières notifications, non lues d'abord comptées en tout et par module. */
async function list(db, userId, { module = null, unread = false, limit = 30 } = {}) {
  const q = db('notifications').where({ user_id: userId }).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(Math.min(Number(limit) || 30, 100));
  if (module) q.where({ module });
  if (unread) q.whereNull('read_at');
  const counts = await db('notifications').where({ user_id: userId }).whereNull('read_at').groupBy('module').select('module').count({ n: '*' });
  const by_module = Object.fromEntries(counts.map(c => [c.module, Number(c.n)]));
  return { unread: Object.values(by_module).reduce((a, b) => a + b, 0), by_module, items: (await q).map(serialize) };
}

/** Marque lues : des notifications choisies, celles d'un module, ou toutes. */
async function markRead(db, userId, { ids = null, module = null } = {}) {
  const q = db('notifications').where({ user_id: userId }).whereNull('read_at');
  if (ids) q.whereIn('id', ids);
  if (module) q.where({ module });
  return q.update({ read_at: new Date() });
}

/** Une notification dont la suite a été donnée (demande traitée…) est lue pour tous ses destinataires. */
async function resolve(db, keyPrefix) {
  return db('notifications').where('dedupe_key', 'like', `${keyPrefix}%`).whereNull('read_at').update({ read_at: new Date() });
}

// ─── Circuit d'information entre les services (lib/domain.js : INFO_EVENTS, INFO_AUDIENCES) ──────────────

const ROUTES_KEY = 'info_routes';

/** Services prévenus pour chaque événement : réglage enregistré (Administration générale › Circuit d'information), sinon défaut. */
async function infoRoutes(db) {
  const row = await db('app_settings').where({ key: ROUTES_KEY }).first('value');
  let saved = {};
  try { saved = row?.value ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  return Object.fromEntries(Object.entries(INFO_EVENTS).map(([event, def]) => {
    const list = Array.isArray(saved[event]) ? saved[event].filter(a => INFO_AUDIENCES[a]) : def.audiences;
    return [event, list];
  }));
}

async function saveInfoRoutes(db, routes) {
  const clean = Object.fromEntries(Object.entries(routes).filter(([e]) => INFO_EVENTS[e]).map(([e, list]) => [e, [...new Set(list)].filter(a => INFO_AUDIENCES[a])]));
  const value = JSON.stringify({ ...(await infoRoutes(db)), ...clean });
  if (await db('app_settings').where({ key: ROUTES_KEY }).first()) await db('app_settings').where({ key: ROUTES_KEY }).update({ value, updated_at: new Date() });
  else await db('app_settings').insert({ key: ROUTES_KEY, value });
  return infoRoutes(db);
}

/**
 * Comptes d'un service (les droits du service ; la Direction générale comprend le super administrateur). Comme `usersWith`,
 * un service sans titulaire retombe sur le super administrateur : une demande de transfert ne reste pas sans destinataire.
 */
async function audienceUsers(db, audience) {
  const def = INFO_AUDIENCES[audience];
  if (!def) return [];
  const users = await db('users').where({ active: true }).select('id', 'name', 'email', 'role');
  const out = [];
  for (const u of users) {
    if (u.role === 'super_admin') { if (def.superAdmin) out.push(u); continue; }
    const p = await effectivePermissions(db, u);
    if (def.perms.some(x => hasPermission(p, x))) out.push(u);
  }
  return out.length ? out : users.filter(u => u.role === 'super_admin');
}

/**
 * Informe les services d'un événement selon le circuit réglé, en plus des personnes directement visées (`direct` : comptes,
 * identifiants, ou { id, link } pour une personne qui a son propre lien). `links` : lien propre à un service
 * (ex. { compta: '/compta/ecritures' }), `directLink` : lien des personnes directes, sinon `link`. Un lien fermé à un
 * destinataire est remplacé par une page qu'il peut ouvrir (voir `linkFor`). `module` : module des personnes directes quand
 * l'événement s'adresse à plusieurs modules. Un compte présent dans plusieurs groupes ne reçoit qu'une notification (même
 * clé, à fournir pour dédoublonner) ; jamais l'auteur de l'action (`except`).
 */
async function inform(db, event, { title, body = null, link = null, links = {}, directLink = null, module = null, key = null, except = null, priority = null, direct = [], email = false, circuit = true }) {
  const def = INFO_EVENTS[event];
  if (!def) throw new Error(`Événement inconnu du circuit d'information : ${event}`);
  const dedupe = key || `${event}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const base = { module: module || def.module, event, title, body, key: dedupe, except, priority: priority || def.priority || 'info', email };
  // Contrôle supplémentaire propre aux événements qui le déclarent : rôle + privilèges individuels.
  // Les événements existants sans requiredPerms gardent exactement leur diffusion habituelle.
  let eligible = null;
  if (def.requiredPerms?.length) {
    eligible = new Set();
    for (const u of await db('users').where({ active: true }).select('id', 'role')) {
      const p = await effectivePermissions(db, u);
      if (def.requiredPerms.every(perm => hasPermission(p, perm))) eligible.add(u.id);
    }
  }
  const recipients = list => [].concat(list || []).filter(u => u && (!eligible || eligible.has(typeof u === 'object' ? u.id : Number(u))));
  const hasOwnLink = d => d && typeof d === 'object' && d.link;
  const all = [].concat(direct || []);
  let n = await notify(db, { ...base, to: recipients(all.filter(d => !hasOwnLink(d))), link: directLink || link });
  for (const d of all.filter(hasOwnLink)) n += await notify(db, { ...base, to: recipients([d]), link: d.link });
  // Chaque service la reçoit dans son module (badge de sa tuile, réglage de notifications de son module) ; `circuit: false` : les personnes directes seulement
  for (const a of circuit ? (await infoRoutes(db))[event] || [] : []) {
    n += await notify(db, { ...base, module: INFO_AUDIENCES[a].module || def.module, to: recipients(await audienceUsers(db, a)), link: links[a] || link });
  }
  return n;
}

/** Active ou coupe les notifications d'un module pour un compte, et leur son (null = son général). */
async function savePrefs(db, userId, module, { enabled, sound }) {
  const u = await db('users').where({ id: userId }).first('notif_prefs');
  const prefs = prefsOf(u);
  prefs[module] = { enabled: !!enabled, sound: sound || null };
  await db('users').where({ id: userId }).update({ notif_prefs: JSON.stringify(prefs), updated_at: new Date() });
  return prefs;
}

module.exports = { NOTIF_MODULES, prefsOf, savePrefs, notify, usersWith, usersWithAny, linkFor, employeeUser, list, markRead, resolve, infoRoutes, saveInfoRoutes, audienceUsers, inform };
