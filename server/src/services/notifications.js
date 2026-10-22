/**
 * Centre de notifications commun de l'ERP (docs/analyse-liaisons-inter-services.md §6.1). Chaque module appelle
 * `notify` au lieu d'envoyer ses e-mails lui-même : une notification par destinataire dans la cloche de l'ERP,
 * plus l'e-mail quand le module le demande. Sans doublon : une même clé n'est notifiée qu'une fois par compte.
 * Personne n'est notifié de sa propre action (`except`).
 */
const { isoTime } = require('../lib/http');
const { erpUrl } = require('../config');
const { sendMail } = require('../lib/mailer');
const { effectivePermissions, hasPermission } = require('./permissions');

const NOTIF_MODULES = {
  commercial: 'Service commercial', sav: 'Client & SAV', compta: 'Comptabilité', rh: 'Ressources humaines', administration: 'Administration générale',
};
const PRIORITIES = ['info', 'action', 'urgent'];

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
  const ids = [...new Set(list.map(u => (typeof u === 'object' ? u.id : Number(u))).filter(id => id && id !== except))];
  if (!ids.length) return 0;
  const users = await db('users').whereIn('id', ids).where({ active: true }).select('id', 'name', 'email');
  let count = 0;
  for (const u of users) {
    if (key && (await db('notifications').where({ user_id: u.id, dedupe_key: key }).first('id'))) continue;
    await db('notifications').insert({
      user_id: u.id, module, event, title: title.slice(0, 255), body: body ? String(body).slice(0, 500) : null, link,
      priority: PRIORITIES.includes(priority) ? priority : 'info', dedupe_key: key,
    });
    count++;
    if (email && u.email) {
      const custom = typeof email === 'object' ? email : {};
      await sendMail({
        to: u.email,
        subject: custom.subject || `[SIIPAF] ${title}`,
        text: typeof custom.text === 'function' ? custom.text(u)
          : `Bonjour ${u.name},\n\n${title}${body ? `\n${body}` : ''}${link ? `\n\nOuvrir dans l’ERP : ${erpUrl}${link}` : ''}`,
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

module.exports = { NOTIF_MODULES, notify, usersWith, employeeUser, list, markRead, resolve };
