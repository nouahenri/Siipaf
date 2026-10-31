/**
 * ERP · QHSE, contrôles de chantier : contrôle JOURNALIER (qualité, hygiène, sécurité, environnement) saisi par le conducteur de
 * chaque chantier, synthèse HEBDOMADAIRE (moyennes et tendances de la semaine, observations) soumise puis validée, grilles de
 * points de contrôle réglables, photos privées. Règles pures dans lib/qhse.js.
 * Portée : qhse:all voit tous les chantiers ; sinon le conducteur (worksites.manager_id) ne voit et ne saisit que les siens.
 * Une semaine validée verrouille ses contrôles journaliers.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, json, isoDay, isoTime } = require('../lib/http');
const { uploadsDir } = require('../config');
const Q = require('../lib/qhse');
const moduleSettings = require('./moduleSettings');
const { inform, resolve } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const clip = (v, n) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
const toInt = v => (v == null || v === '' ? null : Math.round(Number(v)));

// ─── Réglages et portée ───────────────────────────────────────────────────

async function settings(db) {
  const v = await moduleSettings.values(db, 'qhse');
  return {
    threshold: v.qhse_safety_threshold_pct, hour: v.qhse_daily_check_hour, saturday: !!v.qhse_work_saturday,
    due: { critique: v.qhse_due_critique_days, majeure: v.qhse_due_majeure_days, mineure: v.qhse_due_mineure_days },
  };
}

/** Jours fériés (calendrier des Ressources humaines) sur un intervalle. */
async function holidaySet(db, from, to) {
  if (!(await db.schema.hasTable('hr_holidays'))) return new Set();
  const rows = await db('hr_holidays').whereBetween('date', [from, to]).select('date');
  return new Set(rows.map(r => isoDay(r.date)));
}
async function calendarOptions(db, from, to, s = null) {
  const set = s || (await settings(db));
  return { saturday: set.saturday, holidays: await holidaySet(db, from, to) };
}

const seesAll = v => v.can('qhse:all');
const isManager = (w, v) => Number(w.manager_id) === Number(v.user.id);

const worksiteBase = db => db('worksites as w').join('projects as p', 'p.id', 'w.project_id').leftJoin('users as u', 'u.id', 'w.manager_id')
  .select('w.id', 'w.reference', 'w.name', 'w.status', 'w.manager_id', 'w.project_id', 'w.created_at', 'p.name as project_name', 'u.name as manager_name');

/** Chantier visible du compte (tous avec qhse:all, sinon ceux dont il est le conducteur) ; 404 sinon. */
async function worksiteFor(db, id, v) {
  const w = await worksiteBase(db).where('w.id', Number(id) || 0).first();
  if (!w || !(seesAll(v) || isManager(w, v))) throw new HttpError(404, 'Chantier introuvable.');
  return w;
}

/** Chantiers visibles ; `open` : chantiers non clos (en préparation, en cours, suspendus). */
async function visibleWorksites(db, v, { open = false, status = null } = {}) {
  const { WORKSITE_OPEN } = require('../lib/domain');
  const query = worksiteBase(db).orderBy([{ column: 'p.name' }, { column: 'w.reference' }]);
  if (open) query.whereIn('w.status', WORKSITE_OPEN);
  if (status) query.where('w.status', status);
  if (!seesAll(v)) query.where('w.manager_id', v.user.id);
  return query;
}

// ─── Grilles de points de contrôle (Réglages) ─────────────────────────────

async function listCheckpoints(db, { all = false } = {}) {
  const query = db('qhse_checkpoints').orderBy([{ column: 'pillar' }, { column: 'sort' }, { column: 'id' }]);
  if (!all) query.where({ active: true });
  return (await query).map(c => ({ id: c.id, pillar: c.pillar, label: c.label, sort: c.sort, active: !!c.active }));
}
function checkPillar(pillar) {
  if (!Q.PILLARS[pillar]) throw new HttpError(400, 'Volet inconnu.');
}
async function addCheckpoint(db, { pillar, label }) {
  checkPillar(pillar);
  const text = clip(label, 200);
  if (!text || text.length < 3) throw new HttpError(400, 'Intitulé du point de contrôle trop court.');
  const same = (await db('qhse_checkpoints').where({ pillar }).select('label')).some(c => c.label.toLowerCase() === text.toLowerCase());
  if (same) throw new HttpError(409, 'Ce point de contrôle existe déjà dans ce volet.');
  const last = await db('qhse_checkpoints').where({ pillar }).max({ s: 'sort' }).first();
  await db('qhse_checkpoints').insert({ pillar, label: text, sort: Number(last?.s || 0) + 1, active: true });
  return listCheckpoints(db, { all: true });
}
async function updateCheckpoint(db, id, data) {
  const c = await db('qhse_checkpoints').where({ id }).first();
  if (!c) throw new HttpError(404, 'Point de contrôle introuvable.');
  const patch = {};
  if (data.label != null) {
    const text = clip(data.label, 200);
    if (!text || text.length < 3) throw new HttpError(400, 'Intitulé du point de contrôle trop court.');
    patch.label = text;
  }
  if (data.active != null) patch.active = !!data.active;
  if (Object.keys(patch).length) await db('qhse_checkpoints').where({ id }).update({ ...patch, updated_at: new Date() });
  return listCheckpoints(db, { all: true });
}
/** Un point jamais utilisé se supprime ; sinon il se désactive (les contrôles passés gardent son intitulé). */
async function removeCheckpoint(db, id) {
  const c = await db('qhse_checkpoints').where({ id }).first();
  if (!c) throw new HttpError(404, 'Point de contrôle introuvable.');
  if (await db('qhse_items').where({ checkpoint_id: id }).first('id')) throw new HttpError(409, 'Ce point a déjà servi dans des contrôles : désactivez-le plutôt que de le supprimer.');
  await db('qhse_checkpoints').where({ id }).del();
  return listCheckpoints(db, { all: true });
}
async function reorderCheckpoints(db, pillar, ids) {
  checkPillar(pillar);
  const rows = await db('qhse_checkpoints').where({ pillar }).select('id');
  if (ids.length !== rows.length || !rows.every(r => ids.includes(r.id))) throw new HttpError(400, 'La liste doit contenir tous les points du volet.');
  for (const [i, id] of ids.entries()) await db('qhse_checkpoints').where({ id }).update({ sort: i + 1 });
  return listCheckpoints(db, { all: true });
}

// ─── Fichiers (photos et preuves, privés) ─────────────────────────────────

const filesDir = path.join(uploadsDir, 'private', 'qhse');
const FILE_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
function upload() {
  fs.mkdirSync(filesDir, { recursive: true });
  const m = multer({
    storage: multer.diskStorage({ destination: filesDir, filename: (req, f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${FILE_MIME[f.mimetype]}`) }),
    limits: { fileSize: 15 * 1024 * 1024, files: 8 },
    fileFilter: (req, f, cb) => cb(FILE_MIME[f.mimetype] ? null : new HttpError(400, 'Photos : JPEG, PNG ou WebP (PDF accepté pour une preuve).'), !!FILE_MIME[f.mimetype]),
  });
  return m.array('photos', 8);
}
const removeUploaded = files => Promise.all((files || []).map(f => fs.promises.unlink(f.path).catch(() => {})));
const filePath = row => path.join(filesDir, path.basename(row.filename));

async function attachFiles(db, ownerKind, ownerId, files, { purpose = 'photo', userId = null } = {}) {
  for (const f of files) {
    await db('qhse_files').insert({
      owner_kind: ownerKind, owner_id: ownerId, purpose, filename: f.filename, original_name: clip(f.originalname, 255), mime: f.mimetype, size: f.size, created_by: userId,
    });
  }
}
const fileView = f => ({ id: f.id, name: f.original_name, mime: f.mime, purpose: f.purpose, url: `/api/admin/erp/qhse/files/${f.id}`, image: String(f.mime || '').startsWith('image/') });
async function filesOf(db, ownerKind, ownerIds) {
  if (!ownerIds.length) return new Map();
  const rows = await db('qhse_files').where({ owner_kind: ownerKind }).whereIn('owner_id', ownerIds).orderBy('id');
  const map = new Map();
  for (const f of rows) (map.get(f.owner_id) || map.set(f.owner_id, []).get(f.owner_id)).push(fileView(f));
  return map;
}
async function removeFile(db, row) {
  await db('qhse_files').where({ id: row.id }).del();
  await fs.promises.unlink(filePath(row)).catch(() => {});
}

// ─── Points de contrôle d'un contrôle ou d'un audit ───────────────────────

/** Contrôle et mise en forme des points renseignés : l'échelle dépend du volet, l'intitulé est conservé tel quel. */
async function normalizeItems(db, items = []) {
  const cps = new Map((await db('qhse_checkpoints').select('id', 'pillar', 'label')).map(c => [c.id, c]));
  const seen = new Set();
  return items.map((it, i) => {
    const cp = it.checkpoint_id ? cps.get(Number(it.checkpoint_id)) : null;
    if (it.checkpoint_id && !cp) throw new HttpError(400, 'Point de contrôle inconnu.');
    if (cp && seen.has(cp.id)) throw new HttpError(400, `« ${cp.label} » est renseigné deux fois.`);
    if (cp) seen.add(cp.id);
    const pillar = cp?.pillar || it.pillar;
    const label = cp?.label || clip(it.label, 200);
    if (!pillar || !Q.PILLARS[pillar] || !label) throw new HttpError(400, 'Chaque point renseigné a un volet et un intitulé.');
    if (cp && it.pillar && it.pillar !== cp.pillar) throw new HttpError(400, `« ${cp.label} » appartient au volet ${Q.PILLARS[cp.pillar].label}.`);
    const note = Q.PILLARS[pillar].scale === 'note';
    const row = { pillar, label, checkpoint_id: cp?.id ?? null, rating: note ? toInt(it.rating) : null, answer: note ? null : it.answer || null, remark: clip(it.remark, 300), sort: i };
    const refusal = Q.itemRefusal(row);
    if (refusal) throw new HttpError(400, refusal);
    return row;
  });
}
async function replaceItems(trx, ownerKind, ownerId, items) {
  await trx('qhse_items').where({ owner_kind: ownerKind, owner_id: ownerId }).del();
  for (const it of items) await trx('qhse_items').insert({ owner_kind: ownerKind, owner_id: ownerId, ...it });
}
async function itemsOf(db, ownerKind, ownerId) {
  const rows = await db('qhse_items').where({ owner_kind: ownerKind, owner_id: ownerId }).orderBy([{ column: 'sort' }, { column: 'id' }]);
  return rows.map(i => ({
    id: i.id, pillar: i.pillar, checkpoint_id: i.checkpoint_id, label: i.label, rating: i.rating, rating_label: Q.ratingLabel(i.rating), answer: i.answer, answer_label: Q.ANSWERS[i.answer] || null, remark: i.remark,
  }));
}

// ─── Effectif du jour (pointages) ─────────────────────────────────────────

/** Ouvriers pointés sur le chantier ce jour-là (Ressources humaines › Présences) : effectif proposé pour la sécurité. */
async function attendance(db, w, day) {
  const rows = await db('hr_attendances as a').join('employees as e', 'e.id', 'a.employee_id').where('a.worksite_id', w.id)
    .where('a.check_in', '>=', new Date(`${day}T00:00:00Z`)).where('a.check_in', '<', new Date(`${Q.addDays(day, 1)}T00:00:00Z`))
    .select('e.id', 'e.first_name', 'e.last_name');
  const seen = new Map();
  for (const r of rows) seen.set(r.id, { id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(' ') });
  return { day, present: seen.size, employees: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')) };
}

// ─── Contrôles : mise en forme ────────────────────────────────────────────

const controlQuery = db => db('qhse_controls as c').join('worksites as w', 'w.id', 'c.worksite_id').join('projects as p', 'p.id', 'w.project_id')
  .leftJoin('users as u', 'u.id', 'c.created_by').leftJoin('users as m', 'm.id', 'w.manager_id')
  .select('c.*', 'w.reference as worksite_reference', 'w.name as worksite_name', 'w.manager_id', 'p.name as project_name', 'u.name as created_by_name', 'm.name as manager_name');

function serializeControl(c) {
  return {
    id: c.id, worksite_id: c.worksite_id, worksite_reference: c.worksite_reference, worksite_name: c.worksite_name, project_name: c.project_name, manager_name: c.manager_name,
    kind: c.kind, kind_label: Q.CONTROL_KINDS[c.kind], period_start: isoDay(c.period_start), status: c.status, status_label: Q.CONTROL_STATUSES[c.status] || c.status,
    rating_qualite: c.rating_qualite, rating_qualite_label: Q.ratingLabel(c.rating_qualite), rating_hygiene: c.rating_hygiene, rating_hygiene_label: Q.ratingLabel(c.rating_hygiene),
    workers_present: c.workers_present, workers_compliant: c.workers_compliant, safety_pct: c.safety_pct, site_safety_pct: c.site_safety_pct, env_rate: c.env_rate,
    remark_qualite: c.remark_qualite, remark_hygiene: c.remark_hygiene, remark_securite: c.remark_securite, remark_environnement: c.remark_environnement, observations: c.observations,
    reject_reason: c.reject_reason, created_by_name: c.created_by_name, submitted_at: isoTime(c.submitted_at), validated_at: isoTime(c.validated_at), updated_at: isoTime(c.updated_at),
  };
}

async function listControls(db, v, { kind = null, worksiteId = null, from = null, to = null, status = null, limit = 100 } = {}) {
  const query = controlQuery(db).orderBy([{ column: 'c.period_start', order: 'desc' }, { column: 'c.id', order: 'desc' }]).limit(Math.min(Number(limit) || 100, 300));
  if (kind) query.where('c.kind', kind);
  if (worksiteId) query.where('c.worksite_id', worksiteId);
  if (from) query.where('c.period_start', '>=', from);
  if (to) query.where('c.period_start', '<=', to);
  if (status) query.where('c.status', status);
  if (!seesAll(v)) query.where('w.manager_id', v.user.id);
  return (await query).map(serializeControl);
}

async function loadControl(db, id, v) {
  const c = await controlQuery(db).where('c.id', Number(id) || 0).first();
  if (!c || !(seesAll(v) || Number(c.manager_id) === Number(v.user.id))) throw new HttpError(404, 'Contrôle introuvable.');
  return c;
}

/** Une semaine validée verrouille ses contrôles journaliers. */
async function weekLocked(db, worksiteId, day) {
  return !!(await db('qhse_controls').where({ worksite_id: worksiteId, kind: 'hebdomadaire', period_start: Q.mondayOf(day), status: 'valide' }).first('id'));
}

async function controlDetail(db, id, v) {
  const c = await loadControl(db, id, v);
  const day = isoDay(c.period_start);
  const [items, workers, files, actions] = await Promise.all([
    itemsOf(db, 'controle', c.id),
    db('qhse_workers').where({ control_id: c.id }).orderBy('id').select('id', 'employee_id', 'name', 'issue'),
    filesOf(db, 'controle', [c.id]),
    db('qhse_actions').where({ control_id: c.id }).orderBy('id').select('id', 'reference', 'title', 'status', 'gravity', 'due_on'),
  ]);
  const out = { ...serializeControl(c), items, workers, files: files.get(c.id) || [], actions: actions.map(a => ({ ...a, due_on: isoDay(a.due_on) })) };
  if (c.kind === 'hebdomadaire') {
    // Tant que la semaine n'est pas validée, la synthèse suit les contrôles journaliers
    if (c.status !== 'valide') {
      const w = await worksiteFor(db, c.worksite_id, v);
      out.summary = await weekData(db, w, day);
    } else out.summary = json(c.summary, null);
    out.daily = (await db('qhse_controls').where({ worksite_id: c.worksite_id, kind: 'journalier' }).whereBetween('period_start', [day, Q.addDays(day, 6)]).orderBy('period_start')
      .select('id', 'period_start', 'rating_qualite', 'rating_hygiene', 'safety_pct', 'env_rate')).map(d => ({ ...d, day: isoDay(d.period_start), rating_qualite_label: Q.ratingLabel(d.rating_qualite), rating_hygiene_label: Q.ratingLabel(d.rating_hygiene) }));
    out.editable = c.status === 'brouillon' && v.can('qhse:control');
    out.can_submit = c.status === 'brouillon' && v.can('qhse:control');
    out.can_decide = c.status === 'a_valider' && v.can('qhse:validate');
  } else {
    out.locked = await weekLocked(db, c.worksite_id, day);
    out.editable = !out.locked && v.can('qhse:control');
  }
  return out;
}

// ─── Contrôle journalier ──────────────────────────────────────────────────

async function workersList(db, list, present, compliant) {
  const clean = [];
  const missing = Math.max(0, present - compliant);
  if (list.length > missing) throw new HttpError(400, `Vous nommez ${list.length} ouvrier(s) pour ${missing} qui ne respecte(nt) pas les consignes.`);
  for (const x of list) {
    let name = clip(x.name, 160);
    let employeeId = null;
    if (x.employee_id) {
      const e = await db('employees').where({ id: Number(x.employee_id) }).first('id', 'first_name', 'last_name');
      if (!e) throw new HttpError(400, 'Employé inconnu.');
      employeeId = e.id;
      name = name || [e.first_name, e.last_name].filter(Boolean).join(' ');
    }
    if (!name) throw new HttpError(400, 'Indiquez le nom de l’ouvrier.');
    clean.push({ employee_id: employeeId, name, issue: clip(x.issue, 300) });
  }
  return clean;
}

/**
 * Enregistre (ou corrige) le contrôle du jour d'un chantier. Notes globales : celles indiquées, sinon la moyenne des points notés.
 * Sécurité : ouvriers présents et ouvriers respectant les consignes → pourcentage. Renvoie l'identifiant du contrôle.
 */
async function saveDaily(db, w, data, v) {
  const today = Q.todayStr();
  if (!Q.DAY_RE.test(data.day || '')) throw new HttpError(400, 'Jour invalide.');
  if (data.day > today) throw new HttpError(400, 'Le contrôle d’un jour à venir ne se saisit pas à l’avance.');
  if (w.status === 'clos') throw new HttpError(400, 'Ce chantier est clos.');
  if (await weekLocked(db, w.id, data.day)) throw new HttpError(409, 'La semaine de ce contrôle est validée : elle ne se modifie plus.');
  const items = await normalizeItems(db, data.items || []);
  const by = p => items.filter(i => i.pillar === p);
  const ratingQ = toInt(data.rating_qualite) ?? Q.meanRating(by('qualite').map(i => i.rating));
  const ratingH = toInt(data.rating_hygiene) ?? Q.meanRating(by('hygiene').map(i => i.rating));
  if (!Q.RATINGS[ratingQ]) throw new HttpError(400, 'Indiquez la note de la qualité (Mauvais, Passable, Bon ou Très bon).');
  if (!Q.RATINGS[ratingH]) throw new HttpError(400, 'Indiquez la note de l’hygiène (Mauvais, Passable, Bon ou Très bon).');
  const present = toInt(data.workers_present);
  const compliant = toInt(data.workers_compliant);
  if (present == null || present < 0) throw new HttpError(400, 'Indiquez le nombre d’ouvriers présents (0 si personne).');
  if (compliant == null || compliant < 0 || compliant > present) throw new HttpError(400, 'Les ouvriers respectant la sécurité ne peuvent pas dépasser les ouvriers présents.');
  const workers = await workersList(db, data.workers || [], present, compliant);

  const row = {
    rating_qualite: ratingQ, rating_hygiene: ratingH, workers_present: present, workers_compliant: compliant, safety_pct: Q.safetyPct(present, compliant),
    site_safety_pct: Q.conformityRate(by('securite').map(i => i.answer)), env_rate: Q.conformityRate(by('environnement').map(i => i.answer)),
    remark_qualite: clip(data.remark_qualite, 2000), remark_hygiene: clip(data.remark_hygiene, 2000), remark_securite: clip(data.remark_securite, 2000), remark_environnement: clip(data.remark_environnement, 2000),
    observations: clip(data.observations, 2000), updated_by: v.user.id,
  };
  const current = await db('qhse_controls').where({ worksite_id: w.id, kind: 'journalier', period_start: data.day }).first();
  const id = await db.transaction(async trx => {
    let cid = current?.id;
    if (current) await trx('qhse_controls').where({ id: cid }).update({ ...row, updated_at: new Date() });
    else cid = insertedId((await trx('qhse_controls').insert({ ...row, worksite_id: w.id, kind: 'journalier', period_start: data.day, status: 'saisi', created_by: v.user.id }))[0]);
    await replaceItems(trx, 'controle', cid, items);
    await trx('qhse_workers').where({ control_id: cid }).del();
    for (const x of workers) await trx('qhse_workers').insert({ control_id: cid, ...x });
    return cid;
  });
  await resolve(db, `qhse-manquant:${w.id}:${data.day}`);
  await alertControl(db, { id, ...row, day: data.day }, w, v.user.id);
  return id;
}

/** Alertes d'un contrôle journalier : note « Mauvais » sur la qualité ou l'hygiène, sécurité sous le seuil réglé. */
async function alertControl(db, c, w, actorId) {
  const s = await settings(db);
  const link = `/qhse/controles/${c.id}`;
  const where = `${w.reference} ${w.name} (${w.project_name}) · ${Q.frDay(c.day)}`;
  for (const [pillar, rating] of [['qualite', c.rating_qualite], ['hygiene', c.rating_hygiene]]) {
    if (rating !== Q.BAD_RATING) continue;
    await inform(db, 'qhse.note_mauvaise', {
      direct: w.manager_id, except: actorId, key: `qhse-note:${c.id}:${pillar}`, link,
      title: `Note « Mauvais » en ${Q.PILLARS[pillar].label.toLowerCase()} : ${w.reference}`, body: where,
    });
  }
  if (c.safety_pct != null && c.safety_pct < s.threshold) {
    await inform(db, 'qhse.securite_basse', {
      direct: w.manager_id, except: actorId, key: `qhse-secu:${c.id}:${c.safety_pct}`, link,
      title: `Sécurité à ${c.safety_pct} % (seuil ${s.threshold} %) : ${w.reference}`,
      body: `${c.workers_compliant} ouvrier(s) sur ${c.workers_present} respectent les consignes — ${where}`,
    });
  }
}

// ─── Contrôle hebdomadaire ────────────────────────────────────────────────

const summaryRow = c => ({
  day: isoDay(c.period_start), rating_qualite: c.rating_qualite, rating_hygiene: c.rating_hygiene, safety_pct: c.safety_pct, site_safety_pct: c.site_safety_pct,
  env_rate: c.env_rate, workers_present: c.workers_present, workers_compliant: c.workers_compliant,
});

/** Synthèse d'une semaine d'un chantier : moyennes des contrôles journaliers, tendance sur la semaine précédente, jours sans contrôle, actions. */
async function weekData(db, w, monday) {
  const sunday = Q.addDays(monday, 6);
  const today = Q.todayStr();
  const [cur, prev] = await Promise.all([
    db('qhse_controls').where({ worksite_id: w.id, kind: 'journalier' }).whereBetween('period_start', [monday, sunday]).orderBy('period_start'),
    db('qhse_controls').where({ worksite_id: w.id, kind: 'journalier' }).whereBetween('period_start', [Q.addDays(monday, -7), Q.addDays(monday, -1)]),
  ]);
  const created = w.created_at ? isoDay(w.created_at) : monday;
  const from = created > monday ? created : monday;
  const to = sunday < today ? sunday : today;
  const expected = from <= to ? Q.workingDays(from, to, await calendarOptions(db, from, to)) : [];
  const out = Q.weekSummary(cur.map(summaryRow), prev.map(summaryRow), { expected });
  const actions = await db('qhse_actions').where({ worksite_id: w.id }).whereIn('status', Q.ACTION_OPEN).select('due_on');
  return { ...out, week_start: monday, week_end: sunday, open_actions: actions.length, late_actions: actions.filter(a => a.due_on && isoDay(a.due_on) < today).length };
}

const roundOrNull = n => (n == null ? null : Math.round(n));

/** Ouvre (ou retrouve) la synthèse hebdomadaire d'un chantier pour la semaine qui contient `week`. */
async function openWeekly(db, w, week, v) {
  const monday = Q.mondayOf(week);
  if (monday > Q.mondayOf(Q.todayStr())) throw new HttpError(400, 'Cette semaine n’a pas commencé.');
  const existing = await db('qhse_controls').where({ worksite_id: w.id, kind: 'hebdomadaire', period_start: monday }).first('id');
  if (existing) return existing.id;
  const s = await weekData(db, w, monday);
  return insertedId((await db('qhse_controls').insert({
    worksite_id: w.id, kind: 'hebdomadaire', period_start: monday, status: 'brouillon',
    rating_qualite: Q.meanRating(s.qualite_avg == null ? [] : [s.qualite_avg]), rating_hygiene: Q.meanRating(s.hygiene_avg == null ? [] : [s.hygiene_avg]),
    safety_pct: roundOrNull(s.safety_avg), site_safety_pct: roundOrNull(s.site_safety_avg), env_rate: roundOrNull(s.env_avg), summary: JSON.stringify(s),
    created_by: v.user.id, updated_by: v.user.id,
  }))[0]);
}

function editableWeekly(c, v) {
  if (c.kind !== 'hebdomadaire') throw new HttpError(400, 'Ce n’est pas un contrôle hebdomadaire.');
  if (!v.can('qhse:control')) throw new HttpError(403, 'Droits insuffisants.');
  if (c.status === 'a_valider') throw new HttpError(409, 'Cette synthèse attend sa validation.');
  if (c.status === 'valide') throw new HttpError(409, 'Cette synthèse est validée : elle ne se modifie plus.');
}

async function saveWeekly(db, id, data, v) {
  const c = await loadControl(db, id, v);
  editableWeekly(c, v);
  const w = await worksiteFor(db, c.worksite_id, v);
  const s = await weekData(db, w, isoDay(c.period_start));
  const patch = { updated_by: v.user.id, updated_at: new Date(), summary: JSON.stringify(s), safety_pct: roundOrNull(s.safety_avg), site_safety_pct: roundOrNull(s.site_safety_avg), env_rate: roundOrNull(s.env_avg) };
  for (const p of ['qualite', 'hygiene']) {
    if (data[`rating_${p}`] === undefined) continue;
    const r = data[`rating_${p}`] === null ? null : toInt(data[`rating_${p}`]);
    if (r != null && !Q.RATINGS[r]) throw new HttpError(400, 'Note invalide.');
    patch[`rating_${p}`] = r;
  }
  for (const k of ['remark_qualite', 'remark_hygiene', 'remark_securite', 'remark_environnement', 'observations']) if (data[k] !== undefined) patch[k] = clip(data[k], 3000);
  await db('qhse_controls').where({ id }).update(patch);
  return id;
}

async function submitWeekly(db, id, v) {
  const c = await loadControl(db, id, v);
  editableWeekly(c, v);
  const w = await worksiteFor(db, c.worksite_id, v);
  const s = await weekData(db, w, isoDay(c.period_start));
  const rq = c.rating_qualite ?? Q.meanRating(s.qualite_avg == null ? [] : [s.qualite_avg]);
  const rh = c.rating_hygiene ?? Q.meanRating(s.hygiene_avg == null ? [] : [s.hygiene_avg]);
  if (!rq || !rh) throw new HttpError(400, 'Aucun contrôle journalier cette semaine : indiquez la note de la qualité et celle de l’hygiène avant de soumettre.');
  const now = new Date();
  await db('qhse_controls').where({ id }).update({
    status: 'a_valider', rating_qualite: rq, rating_hygiene: rh, summary: JSON.stringify(s), reject_reason: null, submitted_at: now, updated_at: now, updated_by: v.user.id,
    safety_pct: roundOrNull(s.safety_avg), site_safety_pct: roundOrNull(s.site_safety_avg), env_rate: roundOrNull(s.env_avg),
  });
  await inform(db, 'qhse.hebdo_a_valider', {
    except: v.user.id, key: `qhse-hebdo:${id}:${now.getTime()}`, link: `/qhse/hebdomadaires/${id}`,
    title: `Contrôle hebdomadaire à valider : ${w.reference}`, body: `Semaine du ${Q.frDay(c.period_start && isoDay(c.period_start))} — ${w.name} (${w.project_name}) · ${w.manager_name || 'conducteur non nommé'}`,
  });
  return id;
}

async function decideWeekly(db, id, v, { approve, reason = null }) {
  const c = await loadControl(db, id, v);
  if (c.kind !== 'hebdomadaire' || c.status !== 'a_valider') throw new HttpError(409, 'Cette synthèse n’attend pas de décision.');
  const w = await worksiteFor(db, c.worksite_id, v);
  const now = new Date();
  if (approve) {
    const s = await weekData(db, w, isoDay(c.period_start));
    await db('qhse_controls').where({ id }).update({ status: 'valide', validated_by: v.user.id, validated_at: now, summary: JSON.stringify(s), updated_at: now });
  } else {
    await db('qhse_controls').where({ id }).update({ status: 'brouillon', reject_reason: clip(reason, 500), submitted_at: null, updated_at: now });
  }
  await resolve(db, `qhse-hebdo:${id}:`);
  await inform(db, 'qhse.decision', {
    direct: [c.created_by, w.manager_id], except: v.user.id, key: `qhse-hebdo-decision:${id}:${now.getTime()}`, link: `/qhse/hebdomadaires/${id}`,
    title: `Contrôle hebdomadaire ${approve ? 'validé' : 'refusé'} : ${w.reference}`, body: approve ? `Semaine du ${Q.frDay(isoDay(c.period_start))}` : `Motif : ${reason}`,
  });
  return id;
}

module.exports = {
  settings, calendarOptions, holidaySet, seesAll, isManager, worksiteFor, visibleWorksites, worksiteBase,
  listCheckpoints, addCheckpoint, updateCheckpoint, removeCheckpoint, reorderCheckpoints,
  upload, removeUploaded, filePath, attachFiles, filesOf, fileView, removeFile, itemsOf, normalizeItems, replaceItems,
  attendance, listControls, loadControl, controlDetail, serializeControl, controlQuery, weekLocked, saveDaily, alertControl,
  weekData, openWeekly, saveWeekly, submitWeekly, decideWeekly, insertedId, clip, toInt,
};
