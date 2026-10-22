/**
 * ERP · Administration générale › Courrier arrivée / départ. Le secrétariat enregistre (n° d'ordre, scan) ; la
 * direction affecte (destinataire ou service, suite à donner, délai) ; le destinataire donne la suite ou répond par un
 * courrier départ lié. Relances la veille de l'échéance et le jour du dépassement (ERP et e-mail). Règles dans
 * lib/domain.js (MAIL_*, mailVisibility, mailReminder).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, isoDay, isoTime } = require('../lib/http');
const { uploadsDir, erpUrl } = require('../config');
const { MAIL_DIRECTIONS, MAIL_SUITES, MAIL_NATURES, MAIL_CHANNELS, MAIL_STATUSES, mailNumber, mailVisibility, mailReminder } = require('../lib/domain');
const { DEPARTMENTS } = require('../lib/paie');
const { effectivePermissions, hasPermission } = require('./permissions');
const { notify, resolve } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const scansDir = path.join(uploadsDir, 'private', 'courrier');
const SCAN_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const today = () => new Date().toISOString().slice(0, 10);

function scanUpload() {
  fs.mkdirSync(scansDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({ destination: scansDir, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${SCAN_MIME[file.mimetype]}`) }),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(SCAN_MIME[file.mimetype] ? null : new HttpError(400, 'Scan : PDF ou image (JPEG, PNG, WebP).'), !!SCAN_MIME[file.mimetype]),
  }).single('scan');
}
const removeScan = filename => filename && fs.promises.unlink(path.join(scansDir, path.basename(filename))).catch(() => {});
const scanPath = m => {
  if (!m.scan_filename) throw new HttpError(404, 'Pas de scan joint.');
  return path.join(scansDir, path.basename(m.scan_filename));
};

const query = db => db('mail_items as m')
  .leftJoin('users as a', 'a.id', 'm.assigned_to').leftJoin('users as b', 'b.id', 'm.assigned_by')
  .leftJoin('users as c', 'c.id', 'm.created_by').leftJoin('users as d', 'd.id', 'm.done_by')
  .leftJoin('mail_items as r', 'r.id', 'm.reply_to_id')
  .select('m.*', 'a.name as assigned_to_name', 'a.email as assigned_to_email', 'b.name as assigned_by_name', 'c.name as created_by_name',
    'd.name as done_by_name', 'r.number as reply_to_number');

/** Contexte de visibilité d'un compte : son service (fiche employé) et ses droits. */
async function viewer(db, user, can) {
  const e = await db('employees').where({ user_id: user.id }).first('department');
  return { userId: user.id, can, department: e?.department || null };
}

function serialize(m, v, replies = []) {
  const visibility = mailVisibility(m, v);
  const base = {
    id: m.id, number: m.number, direction: m.direction, direction_label: MAIL_DIRECTIONS[m.direction]?.label, date: isoDay(m.date),
    confidential: !!m.confidential, status: m.status, status_label: MAIL_STATUSES[m.status],
  };
  if (visibility !== 'full') return { ...base, masked: true };
  const late = m.status === 'affecte' && m.due_date && isoDay(m.due_date) < today();
  return {
    ...base, masked: false, letter_date: isoDay(m.letter_date), letter_ref: m.letter_ref, correspondent: m.correspondent, subject: m.subject,
    nature: m.nature, nature_label: MAIL_NATURES[m.nature]?.label || m.nature, channel: m.channel, channel_label: MAIL_CHANNELS[m.channel] || m.channel,
    urgent: !!m.urgent, notes: m.notes,
    assigned_to: m.assigned_to, assigned_to_name: m.assigned_to_name, assigned_department: m.assigned_department,
    assigned_department_label: DEPARTMENTS[m.assigned_department] || null, suite: m.suite, suite_label: MAIL_SUITES[m.suite]?.label || null,
    due_date: isoDay(m.due_date), instructions: m.instructions, assigned_by_name: m.assigned_by_name, assigned_at: isoTime(m.assigned_at),
    done_note: m.done_note, done_by_name: m.done_by_name, done_at: isoTime(m.done_at), late: !!late,
    reply_to_id: m.reply_to_id, reply_to_number: m.reply_to_number, replies,
    created_by_name: m.created_by_name, created_at: isoTime(m.created_at),
    is_recipient: m.assigned_to ? m.assigned_to === v.userId : !!(m.assigned_department && m.assigned_department === v.department),
    scan_url: m.scan_filename ? `/api/admin/erp/courrier/${m.id}/scan` : null, scan_name: m.scan_name,
  };
}

async function load(db, id) {
  const m = await query(db).where('m.id', id).first();
  if (!m) throw new HttpError(404, 'Courrier introuvable.');
  return m;
}

async function detail(db, id, v) {
  const m = await load(db, id);
  const replies = mailVisibility(m, v) === 'full'
    ? (await db('mail_items').where({ reply_to_id: id }).orderBy('date')).map(r => ({ id: r.id, number: r.number, date: isoDay(r.date), status: r.status }))
    : [];
  return serialize(m, v, replies);
}

/** Prochain n° d'ordre du sens et de l'année (A-2026-0001…), repris en cas de collision. */
async function insertNumbered(db, row) {
  const year = Number(String(row.date).slice(0, 4));
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async trx => {
        const last = await trx('mail_items').where({ direction: row.direction, year }).max({ s: 'seq' }).first();
        const seq = Number(last?.s || 0) + 1;
        const [id] = await trx('mail_items').insert({ ...row, year, seq, number: mailNumber(row.direction, year, seq) });
        return insertedId(id);
      });
    } catch (e) {
      if (attempt >= 4 || !/unique|duplicate/i.test(e.message)) throw e;
    }
  }
}

function checkFields(data) {
  if (data.nature && !MAIL_NATURES[data.nature]) throw new HttpError(400, 'Nature de courrier inconnue.');
  if (data.channel && !MAIL_CHANNELS[data.channel]) throw new HttpError(400, 'Mode de réception ou d’envoi inconnu.');
  if (data.date && data.date > today()) throw new HttpError(400, 'La date d’arrivée ou d’envoi ne peut pas être future.');
}

/**
 * Enregistrement (secrétariat, droit courrier:write). Un départ peut répondre à une arrivée : son destinataire peut
 * alors l'enregistrer lui-même, et l'arrivée passe « traitée ».
 */
async function create(db, data, { file, user, can }) {
  checkFields(data);
  let replyTo = null;
  if (data.reply_to_id) {
    if (data.direction !== 'depart') throw new HttpError(400, 'Seul un courrier départ répond à une arrivée.');
    replyTo = await load(db, data.reply_to_id);
    if (replyTo.direction !== 'arrivee') throw new HttpError(400, 'La réponse se rattache à un courrier arrivée.');
    const v = await viewer(db, user, can);
    if (mailVisibility(replyTo, v) !== 'full') throw new HttpError(403, 'Courrier confidentiel.');
  }
  const isReplyAuthor = replyTo && replyTo.assigned_to === user.id;
  if (!can('courrier:write') && !isReplyAuthor) throw new HttpError(403, 'Enregistrement du courrier : droit « Enregistrer le courrier ».');
  const row = {
    ...data, status: data.direction === 'depart' ? 'envoye' : 'enregistre', created_by: user.id,
    ...(file ? { scan_filename: file.filename, scan_name: file.originalname.slice(0, 255), scan_mime: file.mimetype } : {}),
  };
  const id = await insertNumbered(db, row);
  if (replyTo && ['enregistre', 'affecte'].includes(replyTo.status)) {
    const number = (await db('mail_items').where({ id }).first('number')).number;
    await db('mail_items').where({ id: replyTo.id }).update({
      status: 'traite', done_note: [replyTo.done_note, `Réponse envoyée : ${number}`].filter(Boolean).join('\n'), done_by: user.id, done_at: new Date(), updated_at: new Date(),
    });
    await resolve(db, `courrier:${replyTo.id}:`);
  }
  if (row.direction === 'arrivee') {
    const m = await load(db, id);
    await notify(db, {
      to: await directionUsers(db), except: user.id, module: 'administration', event: 'courrier.a_affecter',
      title: `Courrier ${m.number} à affecter${m.urgent ? ' (urgent)' : ''}`, body: m.confidential ? 'Courrier confidentiel' : `${m.correspondent} — ${m.subject}`,
      link: `/administration/courrier?fiche=${m.id}`, priority: m.urgent ? 'urgent' : 'action', key: `courrier:${m.id}:a_affecter`,
    });
  }
  return id;
}

/** Correction d'un enregistrement (secrétariat ou direction) ; un courrier confidentiel ne se corrige que s'il est visible. */
async function update(db, m, data, { file, v }) {
  if (!v.can('courrier:write') && !v.can('courrier:assign')) throw new HttpError(403, 'Droits insuffisants.');
  if (mailVisibility(m, v) !== 'full') throw new HttpError(403, 'Courrier confidentiel.');
  if (m.status === 'annule') throw new HttpError(409, 'Courrier annulé.');
  checkFields(data);
  if (data.date && String(data.date).slice(0, 4) !== String(m.year)) throw new HttpError(400, 'Le n° d’ordre est attaché à l’année : la date doit rester dans la même année.');
  const patch = { ...data, updated_at: new Date() };
  delete patch.direction;
  delete patch.reply_to_id;
  if (file) {
    await removeScan(m.scan_filename);
    Object.assign(patch, { scan_filename: file.filename, scan_name: file.originalname.slice(0, 255), scan_mime: file.mimetype });
  }
  await db('mail_items').where({ id: m.id }).update(patch);
}

/** Affectation par la direction : destinataire (personne et/ou service), suite à donner, délai, instructions. */
async function assign(db, m, data, { user }) {
  if (m.direction !== 'arrivee') throw new HttpError(400, 'Seul un courrier arrivée s’affecte.');
  if (['annule'].includes(m.status)) throw new HttpError(409, 'Courrier annulé.');
  const suite = MAIL_SUITES[data.suite];
  if (!suite) throw new HttpError(400, 'Suite à donner inconnue.');
  if (data.assigned_department && !DEPARTMENTS[data.assigned_department]) throw new HttpError(400, 'Service inconnu.');
  const classement = data.suite === 'classement';
  if (!classement && !data.assigned_to && !data.assigned_department) throw new HttpError(400, 'Choisissez le destinataire ou le service.');
  if (data.assigned_to && !(await db('users').where({ id: data.assigned_to, active: true }).first())) throw new HttpError(400, 'Destinataire introuvable ou inactif.');
  if (['traitement', 'avis'].includes(data.suite) && !data.due_date) throw new HttpError(400, 'Indiquez le délai de traitement.');
  if (data.due_date && data.due_date < isoDay(m.date)) throw new HttpError(400, 'Le délai ne peut pas précéder l’arrivée du courrier.');
  const now = new Date();
  await db('mail_items').where({ id: m.id }).update({
    assigned_to: data.assigned_to || null, assigned_department: data.assigned_department || null, suite: data.suite,
    due_date: classement ? null : data.due_date || null, instructions: data.instructions || null, assigned_by: user.id, assigned_at: now,
    status: classement ? 'traite' : 'affecte', ...(classement ? { done_note: 'Classé', done_by: user.id, done_at: now } : { done_note: null, done_by: null, done_at: null }),
    reminded_eve_at: null, reminded_late_at: null, updated_at: now,
  });
  await resolve(db, `courrier:${m.id}:a_affecter`);
  if (!classement) await notifyAssignment(db, m.id);
}

/** Suite donnée par le destinataire (ou la direction) : pris connaissance, traité, avis donné. */
async function done(db, m, note, { v, user }) {
  if (m.status !== 'affecte') throw new HttpError(409, 'Ce courrier n’est pas en cours.');
  const recipient = mailVisibility(m, { ...v, can: () => false }) === 'full';
  if (!recipient && !v.can('courrier:assign')) throw new HttpError(403, 'Seuls le destinataire et la direction donnent la suite.');
  if (m.suite === 'avis' && !note) throw new HttpError(400, 'Écrivez votre avis.');
  await db('mail_items').where({ id: m.id }).update({ status: 'traite', done_note: note || MAIL_SUITES[m.suite]?.done || 'Traité', done_by: user.id, done_at: new Date(), updated_at: new Date() });
  await resolve(db, `courrier:${m.id}:`);
}

async function reopen(db, m) {
  if (m.status !== 'traite' || m.direction !== 'arrivee') throw new HttpError(409, 'Seul un courrier arrivée traité se rouvre.');
  await db('mail_items').where({ id: m.id }).update({ status: m.assigned_to || m.assigned_department ? 'affecte' : 'enregistre', done_at: null, done_by: null, reminded_eve_at: null, reminded_late_at: null, updated_at: new Date() });
}

/** Le n° d'ordre n'est jamais réutilisé : un enregistrement erroné est annulé, pas supprimé. */
async function cancel(db, m, reason, { v }) {
  if (m.status === 'annule') throw new HttpError(409, 'Courrier déjà annulé.');
  if (!v.can('courrier:assign') && !(v.can('courrier:write') && ['enregistre', 'envoye'].includes(m.status))) throw new HttpError(403, 'Un courrier affecté ne s’annule que par la direction.');
  if (!reason) throw new HttpError(400, 'Indiquez le motif de l’annulation.');
  await db('mail_items').where({ id: m.id }).update({ status: 'annule', done_note: `Annulé : ${reason}`, updated_at: new Date() });
}

/** Comptes qui reçoivent les alertes de la direction : droit courrier:assign. */
async function directionUsers(db) {
  const users = await db('users').where({ active: true }).select('id', 'name', 'email', 'role');
  const out = [];
  for (const u of users) if (hasPermission(await effectivePermissions(db, u), 'courrier:assign')) out.push(u);
  return out;
}

/** Destinataires d'un courrier : la personne affectée, sinon les comptes du service. */
async function recipientsOf(db, m) {
  if (m.assigned_to) return db('users').where({ id: m.assigned_to, active: true }).select('id', 'name', 'email');
  if (!m.assigned_department) return [];
  return db('employees as e').join('users as u', 'u.id', 'e.user_id').where({ 'e.department': m.assigned_department, 'e.active': true, 'u.active': true }).select('u.id', 'u.name', 'u.email');
}

const describe = m => [
  `${m.number} — ${m.confidential ? 'Courrier confidentiel' : m.subject}`,
  m.confidential ? null : `Expéditeur : ${m.correspondent}`,
  `Suite à donner : ${MAIL_SUITES[m.suite]?.label || '—'}`,
  m.due_date ? `Délai : ${isoDay(m.due_date).split('-').reverse().join('/')}` : null,
  m.instructions && !m.confidential ? `Instructions : ${m.instructions}` : null,
  '', `Ouvrir dans l’ERP : ${erpUrl}/administration/courrier?fiche=${m.id}`,
].filter(x => x != null).join('\n');

async function notifyAssignment(db, id) {
  const m = await load(db, id);
  const title = `Courrier ${m.number} à traiter${m.urgent ? ' (urgent)' : ''}`;
  await notify(db, {
    to: await recipientsOf(db, m), except: m.assigned_by, module: 'administration', event: 'courrier.affecte',
    title, body: m.confidential ? 'Courrier confidentiel' : m.subject, link: `/administration/courrier?fiche=${m.id}`,
    priority: m.urgent ? 'urgent' : 'action', key: `courrier:${m.id}:affecte:${isoTime(m.assigned_at) || ''}`,
    email: { subject: `[SIIPAF] ${title}`, text: u => `Bonjour ${u.name},\n\nUn courrier vous est affecté.\n\n${describe(m)}` },
  });
}

/** Relances du jour (ERP : compteurs ; e-mail : destinataire + direction), une seule fois par étape. */
async function tick(db, day = today()) {
  const rows = await db('mail_items').where({ status: 'affecte' }).whereNotNull('due_date');
  let sent = 0;
  let direction = null;
  for (const raw of rows) {
    const m = { ...raw, due_date: isoDay(raw.due_date) };
    const kind = mailReminder(m, day);
    if (!kind) continue;
    direction ||= await directionUsers(db);
    const title = kind === 'veille' ? `Rappel : courrier ${m.number} à traiter pour le ${m.due_date.split('-').reverse().join('/')}` : `Retard : courrier ${m.number} non traité`;
    await notify(db, {
      to: [...await recipientsOf(db, m), ...direction], module: 'administration', event: kind === 'veille' ? 'courrier.rappel' : 'courrier.retard',
      title, body: m.confidential ? 'Courrier confidentiel' : m.subject, link: `/administration/courrier?fiche=${m.id}`,
      priority: kind === 'veille' ? 'action' : 'urgent', key: `courrier:${m.id}:${kind}:${m.due_date}`,
      email: { subject: `[SIIPAF] ${title}`, text: u => `Bonjour ${u.name},\n\n${kind === 'veille' ? 'Le délai de ce courrier arrive à échéance.' : 'Le délai de ce courrier est dépassé.'}\n\n${describe(m)}` },
    });
    await db('mail_items').where({ id: m.id }).update(kind === 'veille' ? { reminded_eve_at: new Date() } : { reminded_late_at: new Date() });
    sent++;
  }
  return sent;
}

/** Compteurs du menu : à affecter (direction), à traiter (destinataire), en retard. */
async function badges(db, v) {
  const n = async q => Number((await q.count({ n: '*' }).first()).n || 0);
  const mine = q => q.where(w => {
    w.where('assigned_to', v.userId);
    if (v.department) w.orWhere(x => x.whereNull('assigned_to').where('assigned_department', v.department));
  });
  const assign = v.can('courrier:assign');
  const out = {
    to_assign: assign ? await n(db('mail_items').where({ status: 'enregistre', direction: 'arrivee' })) : 0,
    mine: await n(mine(db('mail_items').where({ status: 'affecte' }))),
    late: await n(db('mail_items').where({ status: 'affecte' }).where('due_date', '<', today()).modify(q => { if (!assign) mine(q); })),
  };
  return { ...out, count: out.to_assign + out.mine }; // pastille du menu

}

module.exports = { scanUpload, removeScan, scanPath, query, viewer, serialize, load, detail, create, update, assign, done, reopen, cancel, tick, badges, directionUsers };
