/**
 * ERP · Chantiers, lot 3 (choix du client du 24/10) : journal quotidien, points d'avancement publiés pour les
 * acquéreurs, étapes de chantier signalées par le conducteur et déclarées par la Direction seule — seule la
 * déclaration émet les appels de fonds VEFA —, livraisons promises et retards prévus. Règles dans lib/domain.js
 * (DECLARATION_STATUSES, deliveryForecast, deliveryDelay).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, json, isoDay, isoTime } = require('../lib/http');
const { uploadsDir } = require('../config');
const {
  SITE_STAGES, SITE_STAGE_LABELS, DECLARATION_STATUSES, lotInZone, deliveryForecast, deliveryDelay, phaseState, addDays,
} = require('../lib/domain');
const { notify, usersWith, inform, resolve } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const today = () => new Date().toISOString().slice(0, 10);
const fr = d => (d ? d.split('-').reverse().join('/') : '');
const money = n => `${Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const ACTIVE = ['en_cours', 'solde'];

// ─── Fichiers : photos du journal et pièces des déclarations (privées) ─────
const filesDir = path.join(uploadsDir, 'private', 'chantiers');
const FILE_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const PHOTO_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
function upload({ dir = filesDir, mime = FILE_MIME, max = 1, field = 'file' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const m = multer({
    storage: multer.diskStorage({ destination: dir, filename: (req, f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${mime[f.mimetype]}`) }),
    limits: { fileSize: 20 * 1024 * 1024, files: max },
    fileFilter: (req, f, cb) => cb(mime[f.mimetype] ? null : new HttpError(400, mime === PHOTO_MIME ? 'Photos : JPEG, PNG ou WebP.' : 'Fichier : PDF ou image (JPEG, PNG, WebP).'), !!mime[f.mimetype]),
  });
  return max > 1 ? m.array(field, max) : m.single(field);
}
const journalUpload = () => upload({ mime: PHOTO_MIME, max: 8, field: 'photos' });
const declarationUpload = () => upload();
// Photos des points d'avancement : médiathèque publique (vue par les acquéreurs dans leur espace)
const progressUpload = () => upload({ dir: uploadsDir, mime: PHOTO_MIME, max: 8, field: 'photos' });
const fileFields = f => (f ? { file_filename: f.filename, file_name: f.originalname.slice(0, 255), file_mime: f.mimetype } : {});
const filePath = row => {
  if (!row?.file_filename) throw new HttpError(404, 'Pas de fichier joint.');
  return path.join(filesDir, path.basename(row.file_filename));
};
const removeFiles = files => Promise.all((files || []).map(f => fs.promises.unlink(f.path).catch(() => {})));

// ─── Journal quotidien ────────────────────────────────────────────────────

async function journal(db, w, { limit = 60 } = {}) {
  const meteo = Object.fromEntries((await require('./chantiers').listItems(db, 'meteo', { all: true })).map(m => [m.code, m.label]));
  const rows = await db('worksite_journal as j').leftJoin('users as u', 'u.id', 'j.created_by').where('j.worksite_id', w.id)
    .orderBy('j.day', 'desc').limit(limit).select('j.*', 'u.name as created_by_name');
  const files = rows.length ? await db('worksite_journal_files').whereIn('journal_id', rows.map(r => r.id)).orderBy('id') : [];
  // Effectif pointé ce jour-là sur le chantier (rappel à côté de l'effectif saisi)
  const days = rows.map(r => isoDay(r.day));
  const att = days.length ? await db('hr_attendances').where({ worksite_id: w.id }).select('employee_id', 'check_in') : [];
  return rows.map(r => {
    const day = isoDay(r.day);
    return {
      id: r.id, day, weather: r.weather, weather_label: meteo[r.weather] || r.weather || null, headcount: r.headcount, work_done: r.work_done, incidents: r.incidents,
      notes: r.notes, created_by_name: r.created_by_name, updated_at: isoTime(r.updated_at),
      pointed: new Set(att.filter(a => isoTime(a.check_in)?.slice(0, 10) === day).map(a => a.employee_id)).size,
      photos: files.filter(f => f.journal_id === r.id).map(f => ({ id: f.id, name: f.file_name, url: `/api/admin/erp/chantiers/journal/photos/${f.id}` })),
    };
  });
}

/** Une page de journal par jour et par chantier : la saisie du même jour complète la page existante. */
async function saveJournal(db, w, data, { files = [], userId }) {
  if (data.day > today()) { await removeFiles(files); throw new HttpError(400, 'Le journal ne se remplit pas à l’avance.'); }
  const current = await db('worksite_journal').where({ worksite_id: w.id, day: data.day }).first();
  try { await require('./chantiers').checkListCode(db, 'meteo', data.weather ?? null, current?.weather); } catch (e) { await removeFiles(files); throw e; }
  const row = { weather: data.weather ?? null, headcount: data.headcount ?? null, work_done: data.work_done ?? null, incidents: data.incidents ?? null, notes: data.notes ?? null };
  let id = current?.id;
  if (current) await db('worksite_journal').where({ id }).update({ ...row, updated_at: new Date() });
  else id = insertedId((await db('worksite_journal').insert({ ...row, worksite_id: w.id, day: data.day, created_by: userId }))[0]);
  for (const f of files) await db('worksite_journal_files').insert({ journal_id: id, ...fileFields(f) });
  // Un incident prévient les services du circuit d'information (Direction générale, exploitation par défaut)
  if (data.incidents && data.incidents !== current?.incidents) {
    await inform(db, 'chantier.incident', {
      except: userId,
      title: `Incident sur le chantier ${w.reference}`, body: `${fr(data.day)} — ${data.incidents}`.slice(0, 500), link: `/chantiers/${w.id}?onglet=journal`,
      key: `chantier-incident:${id}:${crypto.createHash('md5').update(data.incidents).digest('hex').slice(0, 8)}`,
    });
  }
  return id;
}

async function deleteJournalPhoto(db, w, photoId) {
  const f = await db('worksite_journal_files as f').join('worksite_journal as j', 'j.id', 'f.journal_id').where({ 'f.id': photoId, 'j.worksite_id': w.id }).first('f.*');
  if (!f) throw new HttpError(404, 'Photo introuvable.');
  await db('worksite_journal_files').where({ id: f.id }).del();
  await fs.promises.unlink(filePath(f)).catch(() => {});
}

// ─── Points d'avancement pour les acquéreurs (site_updates) ───────────────

/** Points d'avancement qui concernent la zone du chantier (programme entier, ses îlots ou ses lots). */
async function progressPoints(db, w) {
  const lots = await require('./chantiers').zoneLots(db, w);
  const ilots = [...new Set(lots.map(l => l.ilot).filter(Boolean).map(String))];
  const rows = await db('site_updates as u').leftJoin('lots as l', 'l.id', 'u.lot_id').leftJoin('users as c', 'c.id', 'u.created_by').where('u.project_id', w.project_id)
    .orderBy([{ column: 'u.published_at', order: 'desc' }, { column: 'u.id', order: 'desc' }]).limit(200).select('u.*', 'l.code as lot_code', 'c.name as created_by_name');
  const ids = new Set(lots.map(l => l.id));
  const media = await db('media').whereIn('id', [...new Set(rows.flatMap(r => json(r.media, []) || []))]).select('id', 'filename', 'mime');
  return rows.filter(r => (!r.ilot && !r.lot_id) || (r.lot_id ? ids.has(r.lot_id) : ilots.includes(String(r.ilot)))).map(r => ({
    id: r.id, stage: r.stage, stage_label: SITE_STAGE_LABELS[r.stage], progress_pct: r.progress_pct, title: r.title, body: r.body,
    scope_label: r.lot_id ? `Lot ${r.lot_code}` : r.ilot ? `Îlot ${r.ilot}` : 'Tout le programme', visible_client: !!r.visible_client,
    published_at: isoTime(r.published_at), created_by_name: r.created_by_name,
    photos: (json(r.media, []) || []).map(id => media.find(m => m.id === id)).filter(Boolean).map(m => ({ id: m.id, url: `/uploads/${m.filename}`, kind: String(m.mime || '').startsWith('video/') ? 'video' : 'image' })),
  }));
}

/**
 * Publication d'un point depuis l'ERP (même table que l'onglet Chantier du dashboard). Portée : toute la zone du
 * chantier (programme, ou un point par îlot, ou un point par lot) ou un îlot / un lot de la zone. N'émet aucun
 * appel de fonds : seule la Direction déclare une étape atteinte.
 */
async function publishProgress(db, w, data, { files = [], userId }) {
  const lots = await require('./chantiers').zoneLots(db, w);
  const zone = json(w.zone, []) || [];
  let targets;
  if (data.ilot) {
    if (!lots.some(l => String(l.ilot) === String(data.ilot))) { await removeFiles(files); throw new HttpError(400, 'Îlot hors de la zone du chantier.'); }
    targets = [{ ilot: String(data.ilot), lot_id: null }];
  } else if (data.lot_id) {
    if (!lots.some(l => l.id === data.lot_id)) { await removeFiles(files); throw new HttpError(400, 'Lot hors de la zone du chantier.'); }
    targets = [{ ilot: null, lot_id: data.lot_id }];
  } else if (w.zone_kind === 'programme') targets = [{ ilot: null, lot_id: null }];
  else if (w.zone_kind === 'ilots') targets = zone.map(i => ({ ilot: String(i), lot_id: null }));
  else targets = lots.map(l => ({ ilot: null, lot_id: l.id }));
  if (!targets.length) { await removeFiles(files); throw new HttpError(400, 'La zone du chantier ne contient aucun lot.'); }
  const mediaIds = [];
  for (const f of files) {
    mediaIds.push(insertedId((await db('media').insert({ filename: f.filename, original_name: f.originalname.slice(0, 255), mime: f.mimetype, size: f.size, uploaded_by: userId }))[0]));
  }
  await db.transaction(async trx => {
    for (const t of targets) {
      await trx('site_updates').insert({
        project_id: w.project_id, ...t, stage: data.stage, progress_pct: data.progress_pct, title: data.title, body: data.body || null,
        media: JSON.stringify(mediaIds), visible_client: data.visible_client !== false, published_at: data.published_at ? new Date(`${data.published_at}T12:00:00Z`) : new Date(), created_by: userId,
      });
    }
  });
  return targets.length;
}

// ─── Étapes déclarées par la Direction ────────────────────────────────────

const declQuery = db => db('stage_declarations as d').join('projects as p', 'p.id', 'd.project_id').leftJoin('worksites as w', 'w.id', 'd.worksite_id')
  .leftJoin('users as r', 'r.id', 'd.reported_by').leftJoin('users as x', 'x.id', 'd.declared_by').leftJoin('lots as l', 'l.id', 'd.lot_id').leftJoin('buildings as b', 'b.id', 'd.building_id')
  .select('d.*', 'p.name as project_name', 'w.reference as worksite_reference', 'w.name as worksite_name', 'r.name as reported_by_name', 'x.name as declared_by_name',
    'l.code as lot_code', 'b.code as building_code');

const serializeDecl = d => ({
  id: d.id, project_id: d.project_id, project_name: d.project_name, worksite_id: d.worksite_id, stage: d.stage, stage_label: SITE_STAGE_LABELS[d.stage],
  // Une étape d'un seul lot (réception du lot, lot 5) peut porter aussi son chantier : le lot prime
  scope_label: d.lot_id ? `Lot ${d.lot_code}${d.worksite_id ? ` — ${d.worksite_reference}` : ''}` : d.worksite_id ? `${d.worksite_reference} — ${d.worksite_name}` : d.building_id ? d.building_code : d.ilot ? `Îlot ${d.ilot}` : 'Tout le programme',
  reached_on: isoDay(d.reached_on), status: d.status, status_label: DECLARATION_STATUSES[d.status], note: d.note, refusal_reason: d.refusal_reason,
  reported_by_name: d.reported_by_name, reported_at: isoTime(d.reported_at), declared_by_name: d.declared_by_name, declared_at: isoTime(d.declared_at),
  calls_count: d.calls_count, calls_amount: Number(d.calls_amount), file_url: d.file_filename ? `/api/admin/erp/chantiers/etapes/${d.id}/fichier` : null,
});

/**
 * Fiche d'une déclaration : l'étape, sa portée, qui l'a signalée et décidée, la pièce, les dossiers VEFA de la portée,
 * les appels de fonds émis (lot, acquéreur, montant, échéance) et les personnes prévenues (cloche).
 */
async function declarationDetail(db, id) {
  const raw = await declQuery(db).where('d.id', id).first();
  if (!raw) throw new HttpError(404, 'Étape introuvable.');
  const d = serializeDecl(raw);
  const scoped = await declarationSales(db, raw);
  const callQuery = db('fund_calls as f').join('sales as s', 's.id', 'f.sale_id').join('leads as c', 'c.id', 's.lead_id').join('lots as l', 'l.id', 's.lot_id')
    .select('f.id', 'f.label', 'f.pct', 'f.amount_fcfa', 'f.called_at', 'f.due_date', 'f.status', 'l.code as lot_code', 'c.name as client_name', 'c.client_code')
    .orderBy(['l.code', 'f.seq']);
  // Appels liés à la déclaration ; pour les déclarations plus anciennes, ceux émis le même jour sur les dossiers de la portée
  let calls = await callQuery.clone().where('f.declaration_id', id);
  if (!calls.length && raw.status === 'declaree' && scoped.length) {
    calls = await callQuery.clone().whereNull('f.declaration_id').whereIn('f.sale_id', scoped.map(s => s.id)).where('f.status', 'appele').where('f.called_at', isoDay(raw.reached_on));
  }
  const informed = await db('notifications as n').join('users as u', 'u.id', 'n.user_id').where('n.dedupe_key', 'like', `etape:${id}:%`)
    .orderBy('n.created_at').select('u.name', 'n.module', 'n.event', 'n.created_at', 'n.read_at');
  const lots = scoped.length ? await db('lots').whereIn('id', scoped.map(s => s.lot_id)).select('id', 'code') : [];
  return {
    ...d, ilot: raw.ilot, lot_code: raw.lot_code || null, building_code: raw.building_code || null, worksite_reference: raw.worksite_reference || null, worksite_name: raw.worksite_name || null,
    vefa_dossiers: scoped.map(s => ({ sale_id: s.id, lot_code: lots.find(l => l.id === s.lot_id)?.code })),
    calls: calls.map(c => ({ ...c, pct: Number(c.pct), amount_fcfa: Number(c.amount_fcfa), called_at: isoDay(c.called_at), due_date: isoDay(c.due_date) })),
    informed: informed.map(n => ({ name: n.name, module: n.module, event: n.event, at: isoTime(n.created_at), read: !!n.read_at })),
  };
}

async function declarations(db, { worksiteId = null, projectId = null, status = null } = {}) {
  const q = declQuery(db).orderBy([{ column: 'd.reached_on', order: 'desc' }, { column: 'd.id', order: 'desc' }]).limit(300);
  if (worksiteId) q.where('d.worksite_id', worksiteId);
  if (projectId) q.where('d.project_id', projectId);
  if (status) q.where('d.status', status);
  return (await q).map(serializeDecl);
}

/** Dossiers VEFA actifs de la portée d'une déclaration : zone du chantier, ou îlot / bâtiment / lot / programme. */
async function declarationSales(trx, d) {
  if (d.lot_id) return require('./vefa').scopedSales(trx, { projectId: d.project_id, lotId: d.lot_id });
  if (d.worksite_id) {
    const w = await trx('worksites').where({ id: d.worksite_id }).first();
    const zone = { ...w, zone: json(w.zone, []) || [] };
    const rows = await trx('sales as s').join('lots as l', 'l.id', 's.lot_id').where('l.project_id', w.project_id).where('s.vefa', true).whereIn('s.status', ACTIVE)
      .select('s.*', 'l.id as lot_id_', 'l.ilot', 'l.building_id', 'l.project_id');
    return rows.filter(r => lotInZone(zone, { id: r.lot_id_, ilot: r.ilot, building_id: r.building_id, project_id: r.project_id }));
  }
  return require('./vefa').scopedSales(trx, { projectId: d.project_id, ilot: d.ilot, buildingId: d.building_id, lotId: d.lot_id });
}

/** Signalement par le conducteur : la Direction est prévenue et déclare (ou refuse). */
async function signal(db, w, data, { file, userId }) {
  if (!SITE_STAGES.includes(data.stage)) throw new HttpError(400, 'Étape de chantier inconnue.');
  if (data.reached_on > today()) throw new HttpError(400, 'Une étape ne se signale pas à l’avance.');
  if (await db('stage_declarations').where({ worksite_id: w.id, stage: data.stage }).whereNull('lot_id').whereIn('status', ['signalee', 'declaree']).first()) {
    throw new HttpError(409, 'Cette étape est déjà signalée ou déclarée pour ce chantier.');
  }
  const [r] = await db('stage_declarations').insert({
    project_id: w.project_id, worksite_id: w.id, stage: data.stage, reached_on: data.reached_on, status: 'signalee', note: data.note || null,
    reported_by: userId, reported_at: new Date(), ...fileFields(file),
  });
  const id = insertedId(r);
  // Les comptes qui déclarent (chantiers:direction) et les services du circuit (Direction générale, exploitation)
  await inform(db, 'chantier.etape_signalee', {
    direct: await usersWith(db, 'chantiers:direction'), except: userId,
    title: `Étape à déclarer : ${SITE_STAGE_LABELS[data.stage]} — ${w.reference}`, body: `${w.name} — atteinte le ${fr(data.reached_on)}. Sa déclaration émettra les appels de fonds VEFA.`,
    link: `/chantiers/${w.id}?onglet=etapes&etape=${id}`, key: `etape:${id}:signalee`,
  });
  return id;
}

/**
 * Déclaration par la Direction (d'un signalement, ou directement) : l'étape et les précédentes sont achevées pour
 * les dossiers VEFA de la portée, leurs appels sont émis (message à l'acquéreur), la phase correspondante du chantier
 * est terminée à cette date, le conducteur, les commerciaux concernés et le comptable sont prévenus.
 */
async function declare(db, { id = null, worksite = null, projectId = null, ilot = null, buildingId = null, lotId = null, stage, reached_on, note = null }, { file = null, userId }) {
  const vefa = require('./vefa');
  let d;
  if (id) {
    d = await db('stage_declarations').where({ id }).first();
    if (!d) throw new HttpError(404, 'Étape introuvable.');
    if (d.status !== 'signalee') throw new HttpError(409, 'Cette étape n’est plus à déclarer.');
    reached_on = reached_on || isoDay(d.reached_on);
  } else {
    if (!SITE_STAGES.includes(stage)) throw new HttpError(400, 'Étape de chantier inconnue.');
    if (worksite && await db('stage_declarations').where({ worksite_id: worksite.id, stage }).whereNull('lot_id').where('status', 'declaree').first()) throw new HttpError(409, 'Cette étape est déjà déclarée pour ce chantier.');
  }
  if (reached_on > today()) throw new HttpError(400, 'Une étape ne se déclare pas à l’avance.');
  const result = await db.transaction(async trx => {
    if (!id) {
      const [r] = await trx('stage_declarations').insert({
        project_id: worksite ? worksite.project_id : projectId, worksite_id: worksite?.id || null, ilot: worksite ? null : ilot || null,
        building_id: worksite ? null : buildingId || null, lot_id: worksite ? null : lotId || null, stage, reached_on, status: 'signalee', note,
        reported_by: userId, reported_at: new Date(), ...fileFields(file),
      });
      d = await trx('stage_declarations').where({ id: insertedId(r) }).first();
    }
    const upTo = SITE_STAGES.indexOf(d.stage);
    const sales = await declarationSales(trx, d);
    const calls = [];
    for (const sale of sales) {
      const emitted = await vefa.emitCalls(trx, sale, s => s !== 'signature' && SITE_STAGES.indexOf(s) <= upTo, { date: reached_on, userId, declarationId: d.id });
      calls.push(...emitted.map(c => ({ ...c, sale_id: sale.id })));
    }
    const amount = calls.reduce((t, c) => t + Number(c.amount_fcfa), 0);
    await trx('stage_declarations').where({ id: d.id }).update({
      status: 'declaree', reached_on, declared_by: userId, declared_at: new Date(), calls_count: calls.length, calls_amount: amount, updated_at: new Date(),
      ...(note && id ? { note: [d.note, note].filter(Boolean).join('\n') } : {}),
    });
    // La phase du chantier correspondant à l'étape est terminée à la date déclarée (pas pour l'étape d'un seul lot)
    if (d.worksite_id && !d.lot_id) {
      await trx('worksite_phases').where({ worksite_id: d.worksite_id, stage: d.stage }).whereNull('actual_end')
        .update({ actual_end: reached_on, progress_pct: 100, updated_at: new Date() });
      await trx('worksite_phases').where({ worksite_id: d.worksite_id, stage: d.stage }).whereNull('actual_start').update({ actual_start: reached_on });
    }
    return { declaration_id: d.id, sales: sales.length, calls: calls.length, amount_fcfa: amount, sale_ids: [...new Set(calls.map(c => c.sale_id))] };
  });
  // Prévenir : le conducteur (signalement), les commerciaux des acquéreurs appelés, le comptable
  const label = SITE_STAGE_LABELS[d.stage];
  const link = d.worksite_id ? `/chantiers/${d.worksite_id}?onglet=etapes&etape=${d.id}` : '/commercial/vefa';
  // Le conducteur qui l'a signalée et les services du circuit (Direction générale, exploitation, Comptabilité par défaut)
  const scope = d.worksite_id ? (await db('worksites').where({ id: d.worksite_id }).first('reference', 'name')) : null;
  await resolve(db, `etape:${d.id}:signalee`); // « Étape à déclarer » : suite donnée, lue pour tous
  await inform(db, 'chantier.etape_declaree', {
    direct: d.reported_by ? [d.reported_by] : [], except: userId, link, links: { compta: '/compta' }, key: `etape:${d.id}:declaree`,
    title: `Étape déclarée : ${label}${scope ? ` — ${scope.reference}` : ''}`,
    body: `${scope ? `${scope.name} · ` : ''}${result.calls} appel(s) de fonds VEFA émis (${money(result.amount_fcfa)})${result.calls ? ' : écritures à synchroniser dans la Comptabilité.' : '.'}`,
  });
  if (result.calls) {
    // Les commerciaux des acquéreurs appelés (Service commercial)
    const commercials = result.sale_ids.length ? await db('sales as s').join('leads as c', 'c.id', 's.lead_id').whereIn('s.id', result.sale_ids).whereNotNull('c.assigned_to').distinct('c.assigned_to') : [];
    await notify(db, { to: commercials.map(c => c.assigned_to), module: 'commercial', event: 'vefa.appel_emis', title: `Appels de fonds émis : ${label}`, body: 'Vos acquéreurs concernés ont reçu l’appel dans leur espace client.', link: '/commercial/vefa', key: `etape:${d.id}:commercial` });
  }
  return result;
}

async function refuse(db, id, reason, userId) {
  const d = await db('stage_declarations').where({ id }).first();
  if (!d) throw new HttpError(404, 'Étape introuvable.');
  if (d.status !== 'signalee') throw new HttpError(409, 'Cette étape n’est plus à déclarer.');
  await db('stage_declarations').where({ id }).update({ status: 'refusee', refusal_reason: reason, declared_by: userId, declared_at: new Date(), updated_at: new Date() });
  await resolve(db, `etape:${id}:signalee`);
  {
    await inform(db, 'chantier.etape_refusee', {
      direct: d.reported_by ? [d.reported_by] : [], priority: 'action', except: userId, title: `Étape refusée : ${SITE_STAGE_LABELS[d.stage]}`, body: reason,
      link: d.worksite_id ? `/chantiers/${d.worksite_id}?onglet=etapes&etape=${id}` : '/chantiers/liste', key: `etape:${id}:refusee`,
    });
  }
}

/** Étape la plus avancée déclarée pour un lot (zone d'un chantier qui le couvre, programme, îlot, bâtiment, lot). */
async function declaredStageFor(trx, lot) {
  const rows = await trx('stage_declarations as d').leftJoin('worksites as w', 'w.id', 'd.worksite_id').where('d.project_id', lot.project_id).where('d.status', 'declaree')
    .select('d.stage', 'd.worksite_id', 'd.ilot', 'd.building_id', 'd.lot_id', 'w.zone_kind', 'w.zone', 'w.project_id as w_project_id');
  const covers = d => {
    if (d.lot_id) return d.lot_id === lot.id; // étape d'un seul lot (réception), même portée par un chantier
    if (d.worksite_id) return lotInZone({ project_id: d.w_project_id, zone_kind: d.zone_kind, zone: json(d.zone, []) || [] }, lot);
    if (d.lot_id) return d.lot_id === lot.id;
    if (d.building_id) return Number(d.building_id) === Number(lot.building_id);
    if (d.ilot) return String(d.ilot) === String(lot.ilot ?? '');
    return true;
  };
  return rows.filter(covers).map(d => d.stage).sort((a, b) => SITE_STAGES.indexOf(b) - SITE_STAGES.indexOf(a))[0] || null;
}

// ─── Livraisons promises et retards ───────────────────────────────────────

/** Lots vendus de la zone : acquéreur, commercial, date promise, livraison prévue, retard (le prix n'est pas montré). */
async function deliveries(db, w, phases = null) {
  const ph = phases || await db('worksite_phases').where({ worksite_id: w.id }).select('stage', 'planned_end');
  const forecast = deliveryForecast({ planned_end: isoDay(w.planned_end) }, ph.map(p => ({ stage: p.stage, planned_end: isoDay(p.planned_end) })));
  const lots = await require('./chantiers').zoneLots(db, w);
  if (!lots.length) return { forecast, rows: [] };
  const sales = await db('sales as s').join('leads as c', 'c.id', 's.lead_id').leftJoin('users as u', 'u.id', 'c.assigned_to').whereIn('s.lot_id', lots.map(l => l.id))
    .whereIn('s.status', ACTIVE).select('s.id', 's.lot_id', 's.vefa', 's.promised_delivery_on', 's.delivered_at', 'c.name as client_name', 'c.client_code', 'u.name as commercial_name', 'c.assigned_to');
  const rows = sales.map(s => {
    const promised = isoDay(s.promised_delivery_on);
    const delivered = isoDay(s.delivered_at);
    return {
      sale_id: s.id, lot_id: s.lot_id, lot_code: lots.find(l => l.id === s.lot_id)?.code, client_name: s.client_name, client_code: s.client_code, commercial_name: s.commercial_name,
      assigned_to: s.assigned_to, vefa: !!s.vefa, promised_delivery_on: promised, delivered_at: delivered, forecast, delay_days: deliveryDelay(promised, forecast, delivered),
    };
  }).sort((a, b) => String(a.lot_code).localeCompare(String(b.lot_code), 'fr', { numeric: true }));
  // Réception du lot (lot 5) : PV et réserves ouvertes / levées
  const ids = rows.map(r => r.sale_id);
  if (ids.length) {
    const [handovers, reserves] = await Promise.all([
      db('lot_handovers').whereIn('sale_id', ids),
      db('sav_reserves').whereIn('sale_id', ids).groupBy('sale_id', 'status').select('sale_id', 'status').count({ n: '*' }),
    ]);
    for (const r of rows) {
      const h = handovers.find(x => x.sale_id === r.sale_id);
      r.handover = h ? { id: h.id, handed_on: isoDay(h.handed_on), client_signed: !!h.client_signed, file_url: h.file_filename ? `/api/admin/erp/chantiers/receptions/${h.id}/pv` : null } : null;
      const count = st => Number(reserves.find(x => x.sale_id === r.sale_id && x.status === st)?.n || 0);
      r.reserves_open = count('ouverte');
      r.reserves_lifted = count('levee');
    }
  }
  return { forecast, rows };
}

async function setPromised(db, w, saleId, date) {
  const lots = await require('./chantiers').zoneLots(db, w);
  const s = await db('sales').where({ id: saleId }).first('id', 'lot_id');
  if (!s || !lots.some(l => l.id === s.lot_id)) throw new HttpError(404, 'Dossier de vente hors de la zone du chantier.');
  await db('sales').where({ id: saleId }).update({ promised_delivery_on: date, updated_at: new Date() });
}

/**
 * Tâche horaire : phase passée en retard (conducteur, une fois par date prévue) ; livraison prévue après la date
 * promise (commercial de l'acquéreur, SAV, Direction ; une fois par date prévue).
 */
async function tick(db) {
  const open = await db('worksites').whereIn('status', ['preparation', 'en_cours', 'suspendu']);
  const day = today();
  let n = 0;
  for (const w of open) {
    const phases = await db('worksite_phases').where({ worksite_id: w.id });
    for (const p of phases) {
      const s = phaseState({ planned_start: isoDay(p.planned_start), planned_end: isoDay(p.planned_end), actual_start: isoDay(p.actual_start), actual_end: isoDay(p.actual_end), progress_pct: p.progress_pct }, day);
      if (s.state !== 'en_retard' || !w.manager_id) continue;
      // Le conducteur et les services du circuit (exploitation par défaut)
      n += await inform(db, 'chantier.phase_retard', {
        direct: [w.manager_id], title: `Phase en retard : ${p.label} — ${w.reference}`,
        body: `${w.name} — ${s.late_days} jour(s) de retard sur le planning.`, link: `/chantiers/${w.id}`, key: `phase-retard:${p.id}:${isoDay(p.planned_end) || isoDay(p.planned_start)}`,
      });
    }
    const { forecast, rows } = await deliveries(db, w, phases);
    for (const r of rows.filter(x => x.delay_days > 0)) {
      // Le commercial de l'acquéreur et les services du circuit (Direction générale, exploitation, SAV par défaut)
      n += await inform(db, 'chantier.livraison_retard', {
        direct: [r.assigned_to],
        title: `Livraison en retard prévue : lot ${r.lot_code} (${r.client_name})`, body: `Promise le ${fr(r.promised_delivery_on)}, prévue le ${fr(forecast)} (${r.delay_days} j) — ${w.reference}.`,
        link: `/chantiers/${w.id}?onglet=livraisons`, key: `livraison-retard:${r.sale_id}:${forecast}`,
      });
    }
  }
  return n;
}

module.exports = {
  declarationDetail, journalUpload, declarationUpload, progressUpload, filePath, removeFiles, journal, saveJournal, deleteJournalPhoto, progressPoints, publishProgress,
  declarations, signal, declare, refuse, declaredStageFor, deliveries, setPromised, tick, serializeDecl, declQuery, addDays,
};
