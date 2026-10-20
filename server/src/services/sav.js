/**
 * ERP · Client & SAV : réclamations, fil des échanges, réserves à la livraison, interventions,
 * indicateurs. Les règles (catégories, priorités, statuts, garanties) sont dans lib/domain.js.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { HttpError, json } = require('../lib/http');
const { uploadsDir } = require('../config');
const {
  SAV_PRIORITIES, SAV_TRANSITIONS, SAV_OPEN_STATUSES, SAV_STATUS_LABELS, warrantyFor,
} = require('../lib/domain');

const HOUR = 3600 * 1000;
const insertedId = r => (typeof r === 'object' ? r.id : r);

// ─── Photos jointes ─────────────────────────────────────────
// Rangées hors de la partie publique de /uploads (app.js bloque /uploads/private).
const savFilesDir = path.join(uploadsDir, 'private', 'sav');
const FILE_URL = { equipe: '/api/admin/erp/sav/files/', client: '/api/client/sav/files/' };

/** Vérifie que les photos existent (et, côté client, qu'il les a lui-même déposées). */
async function checkFiles(db, ids, { leadId = null } = {}) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!list.length) return [];
  const q = db('sav_files').whereIn('id', list);
  if (leadId) q.where('lead_id', leadId);
  const found = await q.pluck('id');
  if (found.length !== list.length) throw new HttpError(400, 'Photo jointe introuvable.');
  return list;
}

async function filesById(db, ids, viewer) {
  const list = [...new Set(ids.map(Number).filter(Boolean))];
  if (!list.length) return {};
  const rows = await db('sav_files').whereIn('id', list).select('id', 'mime', 'original_name', 'created_at');
  return Object.fromEntries(rows.map(f => [f.id, { id: f.id, url: FILE_URL[viewer] + f.id, mime: f.mime, name: f.original_name }]));
}
const pick = (byId, ids) => (ids || []).map(id => byId[id]).filter(Boolean);

/** Rattache au client les photos de l'équipe qu'il doit voir (jamais celles des notes internes). */
const shareFiles = (db, ids, leadId) => (ids && ids.length && leadId
  ? db('sav_files').whereIn('id', ids).whereNull('lead_id').update({ lead_id: leadId }) : Promise.resolve());

const PHOTO_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };

/** Réception des photos (6 au plus, 25 Mo chacune) ; enregistre une ligne sav_files par fichier. */
function photoUpload() {
  fs.mkdirSync(savFilesDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: savFilesDir,
      filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${PHOTO_MIME[file.mimetype]}`),
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 6 },
    fileFilter: (req, file, cb) => cb(PHOTO_MIME[file.mimetype] ? null : new HttpError(400, 'Envoyez des photos (JPEG, PNG, WebP, HEIC) ou une courte vidéo.'), !!PHOTO_MIME[file.mimetype]),
  });
  return upload.array('files', 6);
}

async function saveFiles(db, files, { leadId = null, userId = null }) {
  if (!files || !files.length) throw new HttpError(400, 'Aucun fichier reçu.');
  const out = [];
  for (const f of files) {
    const [id] = await db('sav_files').insert({
      lead_id: leadId, filename: f.filename, original_name: f.originalname.slice(0, 255), mime: f.mimetype, size: f.size, uploaded_by: userId,
    });
    out.push(insertedId(id));
  }
  return out;
}

/** Référence lisible et unique : SAV-2026-0001. */
async function nextRef(trx, now = new Date()) {
  const prefix = `SAV-${now.getFullYear()}-`;
  const last = await trx('sav_tickets').where('ref', 'like', `${prefix}%`).orderBy('ref', 'desc').first('ref');
  const n = last ? Number(last.ref.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

const dueFrom = (priority, from = new Date()) => new Date(from.getTime() + (SAV_PRIORITIES[priority] || SAV_PRIORITIES.normale).hours * HOUR);

async function addEvent(trx, ticketId, { kind, author, userId = null, body = null, internal = false, media = null }) {
  await trx('sav_events').insert({
    ticket_id: ticketId, kind, author, user_id: userId, body, internal,
    media: media && media.length ? JSON.stringify(media) : null,
  });
}

/** Contexte d'un dossier d'acquisition : acquéreur, lot, projet, date de livraison. */
async function saleContext(trx, saleId) {
  const sale = await trx('sales as s').join('lots as l', 'l.id', 's.lot_id')
    .where('s.id', saleId).select('s.id', 's.lead_id', 's.lot_id', 's.delivered_at', 'l.project_id').first();
  if (!sale) throw new HttpError(404, 'Dossier d’acquisition introuvable.');
  return sale;
}

/**
 * Crée une réclamation. Rattachée à un dossier d'acquisition (cas normal) ou au moins à un prospect.
 * La garantie applicable est déduite de la date de livraison et de la catégorie.
 */
async function createTicket(db, data, { userId = null, source = 'equipe' } = {}) {
  return db.transaction(async trx => {
    let ctx = { lead_id: data.lead_id || null, lot_id: null, project_id: null, delivered_at: null };
    if (data.sale_id) ctx = await saleContext(trx, data.sale_id);
    if (!data.sale_id && !ctx.lead_id) throw new HttpError(400, 'Rattachez la réclamation à un dossier ou à un client.');
    const now = new Date();
    const priority = data.priority || 'normale';
    const row = {
      ref: await nextRef(trx, now),
      sale_id: data.sale_id || null,
      lead_id: ctx.lead_id,
      lot_id: ctx.lot_id,
      project_id: ctx.project_id,
      category: data.category,
      priority,
      status: 'nouveau',
      title: data.title,
      description: data.description || null,
      location: data.location || null,
      source,
      warranty: data.warranty || warrantyFor(data.category, ctx.delivered_at, now),
      assigned_to: data.assigned_to || null,
      due_at: dueFrom(priority, now),
      media: data.media_ids && data.media_ids.length ? JSON.stringify(data.media_ids) : null,
      created_by: userId,
    };
    const [id] = await trx('sav_tickets').insert(row);
    const ticketId = insertedId(id);
    await addEvent(trx, ticketId, {
      kind: 'system', author: source === 'client' ? 'client' : 'systeme', userId,
      body: source === 'client' ? 'Réclamation déposée depuis l’espace client.' : 'Réclamation enregistrée.',
    });
    // Le client avance à l'étape « SAV » du circuit de vente
    if (ctx.lead_id) await trx('leads').where({ id: ctx.lead_id }).whereNot('stage', 'perdu').update({ stage: 'sav', updated_at: now });
    return trx('sav_tickets').where({ id: ticketId }).first();
  });
}

/** Change le statut selon les passages autorisés et horodate résolution / clôture. */
async function changeStatus(db, ticketId, to, { userId, note = null }) {
  return db.transaction(async trx => {
    const t = await trx('sav_tickets').where({ id: ticketId }).first();
    if (!t) throw new HttpError(404, 'Réclamation introuvable.');
    if (t.status === to) throw new HttpError(409, 'La réclamation a déjà ce statut.');
    if (!(SAV_TRANSITIONS[t.status] || []).includes(to)) {
      throw new HttpError(409, `Passage de « ${SAV_STATUS_LABELS[t.status]} » à « ${SAV_STATUS_LABELS[to]} » non autorisé.`);
    }
    const now = new Date();
    const patch = { status: to, updated_at: now };
    if (!t.first_response_at) patch.first_response_at = now;
    if (to === 'resolu') patch.resolved_at = now;
    if (to === 'clos') { patch.closed_at = now; if (!t.resolved_at) patch.resolved_at = now; }
    if (SAV_OPEN_STATUSES.includes(to)) { patch.closed_at = null; if (t.status === 'resolu' || t.status === 'clos') patch.resolved_at = null; }
    await trx('sav_tickets').where({ id: t.id }).update(patch);
    await addEvent(trx, t.id, {
      kind: 'status', author: 'equipe', userId,
      body: `${SAV_STATUS_LABELS[t.status]} → ${SAV_STATUS_LABELS[to]}${note ? ` : ${note}` : ''}`,
    });
    return trx('sav_tickets').where({ id: t.id }).first();
  });
}

/** Commentaire sur une réclamation (client, équipe, ou note interne de l'équipe). */
async function addComment(db, ticketId, { author, userId = null, body, internal = false, media = null }) {
  return db.transaction(async trx => {
    const t = await trx('sav_tickets').where({ id: ticketId }).first();
    if (!t) throw new HttpError(404, 'Réclamation introuvable.');
    await addEvent(trx, t.id, { kind: 'comment', author, userId, body, internal: author === 'equipe' && internal, media });
    const patch = { updated_at: new Date() };
    if (author === 'equipe' && !internal && !t.first_response_at) patch.first_response_at = new Date();
    // Un client qui répond sur une demande résolue la rouvre
    if (author === 'client' && t.status === 'resolu') patch.status = 'en_cours';
    await trx('sav_tickets').where({ id: t.id }).update(patch);
    return trx('sav_tickets').where({ id: t.id }).first();
  });
}

/** Note de satisfaction du client, une fois la réclamation résolue : elle la clôt. */
async function rate(db, ticketId, { satisfaction, comment = null }) {
  return db.transaction(async trx => {
    const t = await trx('sav_tickets').where({ id: ticketId }).first();
    if (!t) throw new HttpError(404, 'Réclamation introuvable.');
    if (!['resolu', 'clos'].includes(t.status)) throw new HttpError(409, 'Vous pourrez donner votre avis une fois la demande résolue.');
    const now = new Date();
    await trx('sav_tickets').where({ id: t.id }).update({
      satisfaction, satisfaction_comment: comment, status: 'clos', closed_at: t.closed_at || now, updated_at: now,
    });
    await addEvent(trx, t.id, { kind: 'system', author: 'client', body: `Avis du client : ${satisfaction}/5${comment ? ` — ${comment}` : ''}` });
    return trx('sav_tickets').where({ id: t.id }).first();
  });
}

/** Fiche complète d'une réclamation. `forClient` retire les notes internes et les noms de l'équipe. */
async function ticketDetail(db, ticketId, { forClient = false } = {}) {
  const t = await db('sav_tickets as t')
    .leftJoin('leads as ld', 'ld.id', 't.lead_id')
    .leftJoin('lots as l', 'l.id', 't.lot_id')
    .leftJoin('projects as p', 'p.id', 't.project_id')
    .leftJoin('users as u', 'u.id', 't.assigned_to')
    .leftJoin('sales as s', 's.id', 't.sale_id')
    .where('t.id', ticketId)
    .select('t.*', 'ld.name as client_name', 'ld.phone as client_phone', 'ld.email as client_email', 'ld.client_code',
      'l.code as lot_code', 'p.name as project_name', 'u.name as assigned_name', 's.delivered_at')
    .first();
  if (!t) throw new HttpError(404, 'Réclamation introuvable.');
  const evq = db('sav_events as e').leftJoin('users as u', 'u.id', 'e.user_id').where('e.ticket_id', t.id)
    .select('e.*', 'u.name as user_name').orderBy([{ column: 'e.created_at', order: 'asc' }, { column: 'e.id', order: 'asc' }]);
  // Le client voit l'étape en clair dans son espace : ni notes internes, ni journal des statuts (notes de l'équipe)
  if (forClient) evq.where('e.internal', false).whereNotIn('e.kind', ['status', 'assign']);
  const [events, interventions] = await Promise.all([
    evq,
    db('sav_interventions as i').leftJoin('users as u', 'u.id', 'i.technician_id').where('i.ticket_id', t.id)
      .select('i.*', 'u.name as technician_name').orderBy('i.scheduled_at'),
  ]);
  const media = {
    ticket: json(t.media, []),
    events: events.map(e => json(e.media, [])),
    before: interventions.map(i => json(i.media_before, [])),
    after: interventions.map(i => json(i.media_after, [])),
  };
  const files = await filesById(db, [media.ticket, ...media.events, ...media.before, ...media.after].flat(), forClient ? 'client' : 'equipe');
  const ev = events.map((e, k) => ({
    ...e, internal: !!e.internal, media: pick(files, media.events[k]),
    user_name: forClient ? (e.author === 'equipe' ? (e.user_name ? e.user_name.split(' ')[0] : 'Équipe SIIPAF') : null) : e.user_name,
  }));
  const out = {
    ...t, media: pick(files, media.ticket), events: ev,
    overdue: !!(SAV_OPEN_STATUSES.includes(t.status) && t.due_at && new Date(t.due_at) < new Date()),
    interventions: interventions.map((i, k) => ({ ...i, media_before: pick(files, media.before[k]), media_after: pick(files, media.after[k]) })),
  };
  if (forClient) {
    delete out.assigned_to; delete out.assigned_name; delete out.created_by; delete out.client_phone; delete out.client_email;
    out.interventions = out.interventions.map(i => ({
      id: i.id, scheduled_at: i.scheduled_at, duration_min: i.duration_min, status: i.status, done_at: i.done_at,
      media_after: i.status === 'realisee' ? i.media_after : [],
    }));
  }
  return out;
}

/** Indicateurs du tableau de bord SAV. */
async function savStats(db, now = new Date()) {
  const [byStatus, byCategory, byProject, open, resolvedRows, rated, reserves, upcoming] = await Promise.all([
    db('sav_tickets').select('status').count({ n: '*' }).groupBy('status'),
    db('sav_tickets').select('category').count({ n: '*' }).groupBy('category'),
    db('sav_tickets as t').leftJoin('projects as p', 'p.id', 't.project_id').whereIn('t.status', SAV_OPEN_STATUSES)
      .select('p.name').count({ n: '*' }).groupBy('p.id', 'p.name'),
    db('sav_tickets').whereIn('status', SAV_OPEN_STATUSES).select('due_at', 'priority'),
    db('sav_tickets').whereNotNull('resolved_at').select('created_at', 'resolved_at', 'due_at'),
    db('sav_tickets').whereNotNull('satisfaction').avg({ avg: 'satisfaction' }).count({ n: '*' }),
    db('sav_reserves').select('status').count({ n: '*' }).groupBy('status'),
    db('sav_interventions').where('status', 'planifiee').where('scheduled_at', '>=', now).count({ n: '*' }),
  ]);
  const time = v => new Date(typeof v === 'number' || /^\d+$/.test(v) ? Number(v) : v).getTime();
  const hours = resolvedRows.map(r => (time(r.resolved_at) - time(r.created_at)) / HOUR);
  const onTime = resolvedRows.filter(r => r.due_at && time(r.resolved_at) <= time(r.due_at)).length;
  // Réclamations ouvertes et résolues, 6 derniers mois
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, ouvertes: 0, resolues: 0 });
  }
  const key = v => { const d = new Date(time(v)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const all = await db('sav_tickets').where('created_at', '>=', new Date(now.getFullYear(), now.getMonth() - 5, 1)).select('created_at');
  all.forEach(r => { const m = months.find(x => x.month === key(r.created_at)); if (m) m.ouvertes++; });
  resolvedRows.forEach(r => { const m = months.find(x => x.month === key(r.resolved_at)); if (m) m.resolues++; });
  const obj = (rows, k) => Object.fromEntries(rows.map(r => [r[k], Number(r.n)]));
  return {
    by_status: obj(byStatus, 'status'),
    by_category: obj(byCategory, 'category'),
    open_by_project: byProject.map(p => ({ name: p.name || 'Sans projet', n: Number(p.n) })).sort((a, b) => b.n - a.n),
    open: open.length,
    overdue: open.filter(t => t.due_at && time(t.due_at) < now.getTime()).length,
    urgent: open.filter(t => t.priority === 'urgente' || t.priority === 'haute').length,
    avg_resolution_hours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
    on_time_rate: resolvedRows.length ? Math.round((onTime / resolvedRows.length) * 100) : null,
    satisfaction_avg: rated[0].n ? Math.round(Number(rated[0].avg) * 10) / 10 : null,
    satisfaction_count: Number(rated[0].n),
    reserves: obj(reserves, 'status'),
    upcoming_interventions: Number(upcoming[0].n),
    months,
  };
}

// ─── Réserves à la livraison ────────────────────────────────

async function createReserve(db, saleId, data) {
  const sale = await saleContext(db, saleId);
  const [id] = await db('sav_reserves').insert({
    sale_id: sale.id, lot_id: sale.lot_id, label: data.label, location: data.location || null, category: data.category || null,
    noted_at: data.noted_at || sale.delivered_at || new Date().toISOString().slice(0, 10),
    deadline: data.deadline || null, note: data.note || null,
    media: data.media_ids && data.media_ids.length ? JSON.stringify(data.media_ids) : null,
  });
  return db('sav_reserves').where({ id: insertedId(id) }).first();
}

/** Lève ou rouvre une réserve ; la réclamation liée, s'il y en a une, est notée. */
async function setReserveStatus(db, reserveId, status, { userId, note = null }) {
  return db.transaction(async trx => {
    const r = await trx('sav_reserves').where({ id: reserveId }).first();
    if (!r) throw new HttpError(404, 'Réserve introuvable.');
    if (r.status === status) throw new HttpError(409, status === 'levee' ? 'Réserve déjà levée.' : 'Réserve déjà ouverte.');
    const now = new Date();
    await trx('sav_reserves').where({ id: r.id }).update({
      status, lifted_at: status === 'levee' ? now : null, lifted_by: status === 'levee' ? userId : null,
      note: note ?? r.note, updated_at: now,
    });
    if (r.ticket_id) {
      await addEvent(trx, r.ticket_id, { kind: 'reserve', author: 'equipe', userId, body: `Réserve « ${r.label} » ${status === 'levee' ? 'levée' : 'rouverte'}.` });
    }
    return trx('sav_reserves').where({ id: r.id }).first();
  });
}

/** Ouvre une réclamation à partir d'une réserve (pour la suivre et y planifier des interventions). */
async function reserveToTicket(db, reserveId, { userId }) {
  const r = await db('sav_reserves').where({ id: reserveId }).first();
  if (!r) throw new HttpError(404, 'Réserve introuvable.');
  if (r.ticket_id) throw new HttpError(409, 'Cette réserve a déjà sa réclamation.');
  const ticket = await createTicket(db, {
    sale_id: r.sale_id, category: r.category || 'autre', title: r.label.slice(0, 160), location: r.location,
    description: r.note, warranty: 'parfait_achevement', media_ids: json(r.media, []),
  }, { userId, source: 'livraison' });
  await db('sav_reserves').where({ id: r.id }).update({ ticket_id: ticket.id, updated_at: new Date() });
  return ticket;
}

// ─── Interventions ──────────────────────────────────────────

/** Planifie une intervention ; une réclamation encore « nouvelle » ou « qualifiée » passe à « planifiée ». */
async function createIntervention(db, data, { userId }) {
  if (!data.ticket_id && !data.reserve_id) throw new HttpError(400, 'Rattachez l’intervention à une réclamation ou à une réserve.');
  return db.transaction(async trx => {
    let ticketId = data.ticket_id || null;
    if (data.reserve_id) {
      const r = await trx('sav_reserves').where({ id: data.reserve_id }).first();
      if (!r) throw new HttpError(404, 'Réserve introuvable.');
      ticketId = ticketId || r.ticket_id;
    }
    if (ticketId && !(await trx('sav_tickets').where({ id: ticketId }).first())) throw new HttpError(404, 'Réclamation introuvable.');
    const [id] = await trx('sav_interventions').insert({
      ticket_id: ticketId, reserve_id: data.reserve_id || null, scheduled_at: new Date(data.scheduled_at),
      duration_min: data.duration_min || 60, technician_id: data.technician_id || null, contractor: data.contractor || null,
      cost_fcfa: data.cost_fcfa ?? null, created_by: userId,
    });
    if (ticketId) {
      const t = await trx('sav_tickets').where({ id: ticketId }).first();
      const when = new Date(data.scheduled_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Abidjan' });
      await addEvent(trx, t.id, { kind: 'intervention', author: 'equipe', userId, body: `Intervention planifiée le ${when}.` });
      if (['nouveau', 'qualifie'].includes(t.status)) {
        await trx('sav_tickets').where({ id: t.id }).update({ status: 'planifie', first_response_at: t.first_response_at || new Date(), updated_at: new Date() });
      }
    }
    return trx('sav_interventions').where({ id: insertedId(id) }).first();
  });
}

/** Met à jour une intervention ; « réalisée » horodate et l'inscrit au fil de la réclamation. */
async function updateIntervention(db, id, patch, { userId }) {
  return db.transaction(async trx => {
    const i = await trx('sav_interventions').where({ id }).first();
    if (!i) throw new HttpError(404, 'Intervention introuvable.');
    const row = { updated_at: new Date() };
    for (const k of ['duration_min', 'technician_id', 'contractor', 'report', 'cost_fcfa', 'status']) if (patch[k] !== undefined) row[k] = patch[k];
    if (patch.scheduled_at) row.scheduled_at = new Date(patch.scheduled_at);
    if (patch.media_before) row.media_before = JSON.stringify(patch.media_before);
    if (patch.media_after) row.media_after = JSON.stringify(patch.media_after);
    if (patch.status === 'realisee' && i.status !== 'realisee') row.done_at = new Date();
    if (patch.status && patch.status !== 'realisee') row.done_at = null;
    await trx('sav_interventions').where({ id }).update(row);
    if (i.ticket_id && patch.status && patch.status !== i.status) {
      const body = { realisee: 'Intervention réalisée.', annulee: 'Intervention annulée.', planifiee: 'Intervention replanifiée.' }[patch.status];
      await addEvent(trx, i.ticket_id, { kind: 'intervention', author: 'equipe', userId, body: patch.report && patch.status === 'realisee' ? `${body} ${patch.report}` : body });
      const t = await trx('sav_tickets').where({ id: i.ticket_id }).first();
      if (patch.status === 'realisee' && t.status === 'planifie') await trx('sav_tickets').where({ id: t.id }).update({ status: 'en_cours', updated_at: new Date() });
    }
    return trx('sav_interventions').where({ id }).first();
  });
}

module.exports = {
  createTicket, changeStatus, addComment, rate, ticketDetail, savStats, dueFrom, addEvent, nextRef,
  createReserve, setReserveStatus, reserveToTicket, createIntervention, updateIntervention,
  checkFiles, filesById, shareFiles, photoUpload, saveFiles, savFilesDir, FILE_URL,
};
