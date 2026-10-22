/**
 * ERP · Administration générale › Documents internes. La direction et les services généraux publient pour tous
 * (docs:publish), un chef de service publie pour son service ; chaque destinataire accuse « J'ai lu et compris »
 * depuis Mon espace, avant le délai fixé (relance la veille puis une fois le délai passé). Une nouvelle version
 * redemande la lecture. Les PV portent des actions (responsable, échéance) suivies jusqu'à leur réalisation.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, isoDay, isoTime, json } = require('../lib/http');
const { uploadsDir } = require('../config');
const { DOC_KINDS, DOC_AUDIENCES, DOC_STATUSES, DOC_ACTION_STATUSES, docReference, readReminder } = require('../lib/domain');
const { DEPARTMENTS } = require('../lib/paie');
const { notify, resolve } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const filesDir = path.join(uploadsDir, 'private', 'documents');
const FILE_MIME = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};
const today = () => new Date().toISOString().slice(0, 10);
const fr = d => (d ? d.split('-').reverse().join('/') : '');

function fileUpload() {
  fs.mkdirSync(filesDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({ destination: filesDir, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${FILE_MIME[file.mimetype]}`) }),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(FILE_MIME[file.mimetype] ? null : new HttpError(400, 'Fichier : PDF, Word, Excel, PowerPoint ou image.'), !!FILE_MIME[file.mimetype]),
  }).single('file');
}
const filePath = row => {
  if (!row?.file_filename) throw new HttpError(404, 'Pas de fichier joint.');
  return path.join(filesDir, path.basename(row.file_filename));
};
const fileFields = file => (file ? { file_filename: file.filename, file_name: file.originalname.slice(0, 255), file_mime: file.mimetype } : {});

/** Ce que peut faire un compte : publier pour tous (docs:publish) ou, chef de service, pour son service. */
async function scopeOf(db, user, can) {
  const e = await db('employees').where({ user_id: user.id }).first('id', 'department');
  const team = e ? Number((await db('employees').where({ manager_id: e.id, active: true }).count({ n: '*' }).first()).n || 0) : 0;
  return { userId: user.id, all: can('docs:publish'), chief: team > 0, department: e?.department || null, can };
}
const canPublish = s => s.all || (s.chief && !!s.department);

const query = db => db('internal_docs as d').leftJoin('users as u', 'u.id', 'd.author_id').select('d.*', 'u.name as author_name');

function serialize(d) {
  return {
    ...d, ack_required: !!d.ack_required, ack_deadline: isoDay(d.ack_deadline), meeting_date: isoDay(d.meeting_date), published_at: isoTime(d.published_at),
    audience_departments: json(d.audience_departments, []), audience_users: json(d.audience_users, []),
    kind_label: DOC_KINDS[d.kind]?.label, status_label: DOC_STATUSES[d.status], audience_label: DOC_AUDIENCES[d.audience],
    department_label: DEPARTMENTS[d.department] || null, file_url: d.file_filename ? `/api/admin/erp/documents/${d.id}/fichier` : null,
    file_filename: undefined,
  };
}

async function load(db, id) {
  const d = await query(db).where('d.id', id).first();
  if (!d) throw new HttpError(404, 'Document introuvable.');
  return d;
}

/** Peut gérer ce document : droit docs:publish, ou le chef de service qui l'a écrit. */
const canManage = (d, s) => s.all || (d.author_id === s.userId && canPublish(s));

/** Le voit : gestionnaires, ou destinataire d'un document publié. */
async function canSee(db, d, s) {
  if (canManage(d, s)) return true;
  if (d.status !== 'publie' && d.status !== 'archive') return false;
  return !!(await db('internal_doc_recipients').where({ doc_id: d.id, user_id: s.userId }).first());
}

/** Destinataires : comptes actifs reliés à une fiche employé active (tous, par service) ou personnes nommées. */
async function recipientsOf(db, d) {
  const doc = serialize(d);
  if (doc.audience === 'personnes') {
    return (await db('users').whereIn('id', doc.audience_users.length ? doc.audience_users : [0]).where({ active: true }).select('id')).map(u => u.id);
  }
  const q = db('employees as e').join('users as u', 'u.id', 'e.user_id').where({ 'e.active': true, 'u.active': true });
  if (doc.audience === 'services') q.whereIn('e.department', doc.audience_departments.length ? doc.audience_departments : ['-']);
  return (await q.select('u.id')).map(u => u.id);
}

function checkFields(data, s) {
  if (data.kind && !DOC_KINDS[data.kind]) throw new HttpError(400, 'Sorte de document inconnue.');
  if (data.audience && !DOC_AUDIENCES[data.audience]) throw new HttpError(400, 'Diffusion inconnue.');
  for (const dep of data.audience_departments || []) if (!DEPARTMENTS[dep]) throw new HttpError(400, 'Service inconnu.');
  if (!s.all) {
    // Chef de service : son service seulement
    if (data.audience && data.audience !== 'services') throw new HttpError(403, 'Un chef de service diffuse à son service.');
    if (data.audience_departments && (data.audience_departments.length !== 1 || data.audience_departments[0] !== s.department)) throw new HttpError(403, 'Un chef de service diffuse à son service.');
  }
}
const encode = data => {
  const out = { ...data };
  if ('audience_departments' in out) out.audience_departments = JSON.stringify(out.audience_departments || []);
  if ('audience_users' in out) out.audience_users = JSON.stringify(out.audience_users || []);
  return out;
};

async function create(db, data, { file, s }) {
  if (!canPublish(s)) throw new HttpError(403, 'Publication : direction, services généraux ou chef de service.');
  const row = { audience: s.all ? 'tous' : 'services', ...data };
  if (!s.all) row.audience_departments = [s.department];
  checkFields(row, s);
  if (!DOC_KINDS[row.kind].ack) row.ack_required = false;
  const year = new Date().getUTCFullYear();
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async trx => {
        const prefix = `${DOC_KINDS[row.kind].prefix}-${year}-`;
        const last = await trx('internal_docs').where('reference', 'like', `${prefix}%`).orderBy('reference', 'desc').first('reference');
        const [id] = await trx('internal_docs').insert({
          ...encode(row), reference: docReference(row.kind, year, last ? Number(last.reference.slice(prefix.length)) + 1 : 1),
          department: s.department, author_id: s.userId, ...fileFields(file),
        });
        return insertedId(id);
      });
    } catch (e) {
      if (attempt >= 4 || !/unique|duplicate/i.test(e.message)) throw e;
    }
  }
}

/** Brouillon : tout se modifie. Publié : titre, délai et diffusion seulement (le contenu passe par une nouvelle version). */
async function update(db, d, data, { file, s }) {
  if (!canManage(d, s)) throw new HttpError(403, 'Droits insuffisants.');
  checkFields(data, s);
  const patch = { ...data };
  delete patch.kind;
  if (d.status !== 'brouillon') {
    for (const k of ['body', 'meeting_date']) delete patch[k];
    if (file) throw new HttpError(409, 'Document publié : publiez une nouvelle version pour changer son contenu.');
  }
  await db('internal_docs').where({ id: d.id }).update({ ...encode(patch), ...fileFields(file), updated_at: new Date() });
  if (d.status === 'publie' && ('audience' in data || 'audience_departments' in data || 'audience_users' in data)) await syncRecipients(db, d.id, { notifyNew: true });
}

/** Fige les destinataires ; les nouveaux venus sont prévenus. */
async function syncRecipients(db, id, { notifyNew = false, title = null } = {}) {
  const d = await load(db, id);
  const ids = await recipientsOf(db, d);
  const current = (await db('internal_doc_recipients').where({ doc_id: id }).pluck('user_id')).map(Number);
  const added = ids.filter(u => !current.includes(u));
  const removed = current.filter(u => !ids.includes(u));
  if (removed.length) await db('internal_doc_recipients').where({ doc_id: id }).whereIn('user_id', removed).del();
  for (const u of added) await db('internal_doc_recipients').insert({ doc_id: id, user_id: u });
  if (notifyNew) await announce(db, d, added, title);
  return ids;
}

async function announce(db, d, to, title = null) {
  const doc = serialize(d);
  if (!to.length) return;
  await notify(db, {
    to, except: d.author_id, module: 'rh', event: 'document.publie',
    title: title || `${doc.kind_label} : ${doc.title}`,
    body: doc.ack_required ? `À lire et à confirmer${doc.ack_deadline ? ` avant le ${fr(doc.ack_deadline)}` : ''}.` : 'Disponible dans Mon espace.',
    link: `/rh/moi?document=${d.id}`, priority: doc.ack_required ? 'action' : 'info', key: `doc:${d.id}:v${d.version}:publie`, email: doc.ack_required,
  });
}

async function publish(db, d, { s }) {
  if (!canManage(d, s)) throw new HttpError(403, 'Droits insuffisants.');
  if (d.status !== 'brouillon') throw new HttpError(409, 'Document déjà publié.');
  if (!d.body && !d.file_filename) throw new HttpError(400, 'Écrivez le texte ou joignez le fichier avant de publier.');
  const doc = serialize(d);
  if (doc.audience === 'personnes' && !doc.audience_users.length) throw new HttpError(400, 'Choisissez les destinataires.');
  if (doc.audience === 'services' && !doc.audience_departments.length) throw new HttpError(400, 'Choisissez au moins un service.');
  if (doc.ack_deadline && doc.ack_deadline < today()) throw new HttpError(400, 'Le délai de lecture est déjà passé.');
  await db.transaction(async trx => {
    await trx('internal_docs').where({ id: d.id }).update({ status: 'publie', published_at: new Date(), updated_at: new Date() });
    await trx('internal_doc_versions').insert({ doc_id: d.id, version: d.version, body: d.body, file_filename: d.file_filename, file_name: d.file_name, file_mime: d.file_mime, published_by: s.userId });
  });
  const ids = await syncRecipients(db, d.id);
  await announce(db, await load(db, d.id), ids);
}

/** Nouvelle version d'un document publié (procédure révisée…) : chacun relit et confirme de nouveau. */
async function newVersion(db, d, data, { file, s }) {
  if (!canManage(d, s)) throw new HttpError(403, 'Droits insuffisants.');
  if (d.status !== 'publie') throw new HttpError(409, 'Seul un document publié reçoit une nouvelle version.');
  if (!data.change_note) throw new HttpError(400, 'Résumez ce qui change.');
  if (data.ack_deadline && data.ack_deadline < today()) throw new HttpError(400, 'Le délai de lecture est déjà passé.');
  const version = d.version + 1;
  const patch = { version, published_at: new Date(), updated_at: new Date(), ack_deadline: data.ack_deadline ?? null, ...fileFields(file) };
  if (data.body !== undefined) patch.body = data.body;
  await db.transaction(async trx => {
    await trx('internal_docs').where({ id: d.id }).update(patch);
    const n = { ...d, ...patch };
    await trx('internal_doc_versions').insert({ doc_id: d.id, version, change_note: data.change_note, body: n.body, file_filename: n.file_filename, file_name: n.file_name, file_mime: n.file_mime, published_by: s.userId });
  });
  const fresh = await load(db, d.id);
  const ids = await syncRecipients(db, d.id);
  await resolve(db, `doc:${d.id}:v${d.version}:`);
  await announce(db, fresh, ids, `Nouvelle version ${version} : ${fresh.title}`);
}

async function archive(db, d, { s }) {
  if (!canManage(d, s)) throw new HttpError(403, 'Droits insuffisants.');
  await db('internal_docs').where({ id: d.id }).update({ status: d.status === 'archive' ? 'publie' : 'archive', updated_at: new Date() });
  if (d.status !== 'archive') await resolve(db, `doc:${d.id}:`);
}

async function markRead(db, d, userId) {
  if (d.status !== 'publie') throw new HttpError(409, 'Document non publié.');
  if (!(await db('internal_doc_recipients').where({ doc_id: d.id, user_id: userId }).first())) throw new HttpError(403, 'Ce document ne vous est pas adressé.');
  if (!(await db('internal_doc_reads').where({ doc_id: d.id, version: d.version, user_id: userId }).first())) {
    await db('internal_doc_reads').insert({ doc_id: d.id, version: d.version, user_id: userId });
  }
  await db('notifications').where({ user_id: userId }).where('dedupe_key', 'like', `doc:${d.id}:v${d.version}:%`).whereNull('read_at').update({ read_at: new Date() });
}

/** Suivi des lectures de la version en cours : qui a lu, quand, qui est en retard. */
async function tracking(db, d) {
  const rows = await db('internal_doc_recipients as r').join('users as u', 'u.id', 'r.user_id')
    .leftJoin('internal_doc_reads as x', function on() { this.on('x.doc_id', 'r.doc_id').andOn('x.user_id', 'r.user_id').andOn('x.version', db.raw('?', [d.version])); })
    .leftJoin('employees as e', 'e.user_id', 'u.id')
    .where('r.doc_id', d.id).orderBy('u.name').select('u.id', 'u.name', 'e.department', 'x.read_at');
  const deadline = isoDay(d.ack_deadline);
  const late = !!deadline && deadline < today();
  const people = rows.map(r => ({ user_id: r.id, name: r.name, department_label: DEPARTMENTS[r.department] || null, read_at: isoTime(r.read_at), late: late && !r.read_at }));
  return { total: people.length, read: people.filter(p => p.read_at).length, late: people.filter(p => p.late).length, people };
}

async function detail(db, id, s) {
  const d = await load(db, id);
  const doc = serialize(d);
  const [versions, actions, mine] = await Promise.all([
    db('internal_doc_versions as v').leftJoin('users as u', 'u.id', 'v.published_by').where('v.doc_id', id).orderBy('v.version', 'desc')
      .select('v.version', 'v.change_note', 'v.published_at', 'u.name as published_by_name'),
    db('internal_doc_actions as a').leftJoin('users as u', 'u.id', 'a.owner_id').where('a.doc_id', id).orderBy('a.id').select('a.*', 'u.name as owner_name'),
    db('internal_doc_reads').where({ doc_id: id, version: d.version, user_id: s.userId }).first('read_at'),
  ]);
  const manage = canManage(d, s);
  return {
    ...doc, can_manage: manage, my_read_at: isoTime(mine?.read_at), is_recipient: !!(await db('internal_doc_recipients').where({ doc_id: id, user_id: s.userId }).first()),
    versions: versions.map(v => ({ ...v, published_at: isoTime(v.published_at) })),
    actions: actions.map(a => ({ ...a, due_date: isoDay(a.due_date), done_at: isoTime(a.done_at), status_label: DOC_ACTION_STATUSES[a.status], late: a.status === 'a_faire' && !!a.due_date && isoDay(a.due_date) < today() })),
    tracking: manage && d.status !== 'brouillon' ? await tracking(db, d) : null,
  };
}

/** Documents publiés adressés à un compte (Mon espace), non lus d'abord. */
async function inbox(db, userId) {
  const rows = await query(db).join('internal_doc_recipients as r', 'r.doc_id', 'd.id').where('r.user_id', userId).where('d.status', 'publie')
    .leftJoin('internal_doc_reads as x', function on() { this.on('x.doc_id', 'd.id').andOn('x.user_id', 'r.user_id').andOn('x.version', 'd.version'); })
    .select('x.read_at as my_read_at').orderBy('d.published_at', 'desc');
  return rows.map(d => {
    const doc = serialize(d);
    return { ...doc, body: undefined, my_read_at: isoTime(d.my_read_at), to_read: doc.ack_required && !d.my_read_at, late: doc.ack_required && !d.my_read_at && !!doc.ack_deadline && doc.ack_deadline < today() };
  }).sort((a, b) => Number(b.to_read) - Number(a.to_read));
}

// ─── Actions des PV ─────────────────────────────────────────
async function addAction(db, d, data, { s }) {
  if (!canManage(d, s)) throw new HttpError(403, 'Droits insuffisants.');
  if (d.kind !== 'pv') throw new HttpError(400, 'Les actions se rattachent à un PV de réunion.');
  const [i] = await db('internal_doc_actions').insert({ ...data, doc_id: d.id });
  const id = insertedId(i);
  if (d.status === 'publie' && data.owner_id) await notifyAction(db, d, { id, ...data }, s.userId);
  return id;
}
async function notifyAction(db, d, a, except) {
  await notify(db, {
    to: a.owner_id, except, module: 'administration', event: 'pv.action', title: `Action à mener (${d.reference}) : ${a.label}`,
    body: a.due_date ? `Échéance : ${fr(a.due_date)}` : null, link: `/administration/documents?fiche=${d.id}`, priority: 'action',
    key: `pvaction:${a.id}:affectee`, email: true,
  });
}
async function updateAction(db, a, d, data, { s }) {
  const owner = a.owner_id === s.userId;
  if (!canManage(d, s) && !owner) throw new HttpError(403, 'Droits insuffisants.');
  // Le responsable de l'action ne fait que la déclarer faite (ou la rouvrir)
  const patch = canManage(d, s) ? { ...data } : { status: data.status, done_note: data.done_note };
  if (patch.status === 'fait') Object.assign(patch, { done_at: new Date() });
  if (patch.status === 'a_faire') Object.assign(patch, { done_at: null });
  await db('internal_doc_actions').where({ id: a.id }).update({ ...patch, updated_at: new Date() });
  if (patch.status === 'fait') await resolve(db, `pvaction:${a.id}:`);
  if (canManage(d, s) && data.owner_id && data.owner_id !== a.owner_id && d.status === 'publie') await notifyAction(db, d, { ...a, ...data }, s.userId);
}

/** Actions des PV confiées à un compte (Mon espace). */
async function myActions(db, userId) {
  const rows = await db('internal_doc_actions as a').join('internal_docs as d', 'd.id', 'a.doc_id').where('a.owner_id', userId).where('d.status', 'publie')
    .orderBy('a.status').orderBy('a.due_date').select('a.*', 'd.reference', 'd.title as doc_title');
  return rows.map(a => ({ ...a, due_date: isoDay(a.due_date), done_at: isoTime(a.done_at), late: a.status === 'a_faire' && !!a.due_date && isoDay(a.due_date) < today() }));
}

/** Relances du jour : accusés de lecture (veille, retard) et actions des PV (veille, retard), une fois chacune. */
async function tick(db, day = today()) {
  let sent = 0;
  for (const d of await db('internal_docs').where({ status: 'publie', ack_required: true }).whereNotNull('ack_deadline')) {
    const deadline = isoDay(d.ack_deadline);
    const kind = readReminder(deadline, day);
    if (!kind) continue;
    const unread = await db('internal_doc_recipients as r').leftJoin('internal_doc_reads as x', function on() { this.on('x.doc_id', 'r.doc_id').andOn('x.user_id', 'r.user_id').andOn('x.version', db.raw('?', [d.version])); })
      .where('r.doc_id', d.id).whereNull('x.id').pluck('r.user_id');
    if (!unread.length) continue;
    sent += await notify(db, {
      to: unread, module: 'rh', event: `document.${kind}`, link: `/rh/moi?document=${d.id}`, priority: kind === 'retard' ? 'urgent' : 'action',
      title: kind === 'retard' ? `Lecture en retard : ${d.title}` : `À lire avant le ${fr(deadline)} : ${d.title}`,
      body: 'Ouvrez le document et confirmez « J’ai lu et compris ».', key: `doc:${d.id}:v${d.version}:${kind}`, email: true,
    });
    if (kind === 'retard') {
      await notify(db, {
        to: d.author_id, module: 'administration', event: 'document.retard', link: `/administration/documents?fiche=${d.id}`, priority: 'action',
        title: `${unread.length} lecture(s) en retard : ${d.reference}`, body: d.title, key: `doc:${d.id}:v${d.version}:auteur-retard`,
      });
    }
  }
  const actions = await db('internal_doc_actions as a').join('internal_docs as d', 'd.id', 'a.doc_id').where({ 'a.status': 'a_faire', 'd.status': 'publie' })
    .whereNotNull('a.due_date').whereNotNull('a.owner_id').select('a.*', 'd.reference', 'd.author_id');
  for (const a of actions) {
    const kind = readReminder(isoDay(a.due_date), day);
    if (!kind) continue;
    sent += await notify(db, {
      to: kind === 'retard' ? [a.owner_id, a.author_id] : a.owner_id, module: 'administration', event: `pv.action.${kind}`,
      title: kind === 'retard' ? `Action en retard (${a.reference}) : ${a.label}` : `Action à mener avant le ${fr(isoDay(a.due_date))} : ${a.label}`,
      link: `/administration/documents?fiche=${a.doc_id}`, priority: kind === 'retard' ? 'urgent' : 'action', key: `pvaction:${a.id}:${kind}`, email: true,
    });
  }
  return sent;
}

async function badges(db, userId) {
  const inboxRows = await inbox(db, userId);
  const actions = await myActions(db, userId);
  return { to_read: inboxRows.filter(d => d.to_read).length, actions: actions.filter(a => a.status === 'a_faire').length };
}

module.exports = {
  fileUpload, filePath, scopeOf, canPublish, canManage, canSee, query, serialize, load, detail, create, update, publish, newVersion, archive,
  markRead, tracking, inbox, addAction, updateAction, myActions, tick, badges,
};
