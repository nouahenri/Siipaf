/**
 * ERP · Juridique (choix du client du 23/10). Le juriste (droit juridique:write) date les six étapes de chaque vente
 * jusqu'à l'acte, suit les litiges et les cautions ; la Direction voit tout ; le commercial voit l'avancement de ses
 * ventes. Les impayés sont signalés au commercial dès le premier jour de retard, puis proposés au Juridique au-delà
 * du seuil réglé dans Juridique › Réglages. Règles dans lib/domain.js (DEED_STEPS, LITIGATION_*, GUARANTEE_*…).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, isoDay, isoTime } = require('../lib/http');
const { uploadsDir, erpUrl } = require('../config');
const {
  DEED_STEPS, DEED_STEP_KEYS, deedProgress, deedStepRefusal, LITIGATION_ORIGINS, LITIGATION_STAGES, LITIGATION_OUTCOMES, litigationReminder,
  GUARANTEE_DIRECTIONS, GUARANTEE_STATUSES, guaranteeDeadline, LEGAL_SETTINGS, unpaidAge, contractAlertStage, daysBetween, addMonths,
  LEAD_STAGES, LOT_STATUS_LABELS,
} = require('../lib/domain');
const { DEPARTMENTS } = require('../lib/paie');
const { sendMail } = require('../lib/mailer');
const { notify, usersWith, resolve, inform } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const today = () => new Date().toISOString().slice(0, 10);
const fr = d => (d ? d.split('-').reverse().join('/') : '');
const money = n => `${Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const ACTIVE_SALES = ['en_cours', 'solde'];

// ─── Fichiers (pièces des litiges, cautions) ──────────────────────────────
const filesDir = path.join(uploadsDir, 'private', 'juridique');
const FILE_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
function fileUpload() {
  fs.mkdirSync(filesDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({ destination: filesDir, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${FILE_MIME[file.mimetype]}`) }),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(FILE_MIME[file.mimetype] ? null : new HttpError(400, 'Fichier : PDF ou image (JPEG, PNG, WebP).'), !!FILE_MIME[file.mimetype]),
  }).single('file');
}
const removeFile = name => name && fs.promises.unlink(path.join(filesDir, path.basename(name))).catch(() => {});
const filePath = row => {
  if (!row?.file_filename) throw new HttpError(404, 'Pas de fichier joint.');
  return path.join(filesDir, path.basename(row.file_filename));
};
const fileFields = file => (file ? { file_filename: file.filename, file_name: file.originalname.slice(0, 255), file_mime: file.mimetype } : {});

/** Référence annuelle lisible : LIT-2026-0001, GAR-2026-0001. */
async function nextReference(trx, table, prefix, date) {
  const p = `${prefix}-${date.slice(0, 4)}-`;
  const last = await trx(table).where('reference', 'like', `${p}%`).orderBy('reference', 'desc').first('reference');
  return `${p}${String(last ? Number(last.reference.slice(p.length)) + 1 : 1).padStart(4, '0')}`;
}

/** Droits de lecture : juriste et Direction partout. */
const isLegal = v => v.can('juridique:read') || v.can('juridique:write') || v.can('direction:read');

// ─── Réglages ─────────────────────────────────────────────────────────────

async function settings(db) {
  const rows = await db('app_settings').whereIn('key', Object.keys(LEGAL_SETTINGS)).select('key', 'value');
  const out = Object.fromEntries(Object.entries(LEGAL_SETTINGS).map(([k, s]) => [k, s.default]));
  for (const r of rows) if (r.value != null && r.value !== '' && Number.isFinite(Number(r.value))) out[r.key] = Number(r.value);
  return out;
}
async function saveSettings(db, values) {
  await require('./settings').saveSettings(db, values);
  return settings(db);
}

// ─── Circuit de la vente jusqu'à l'acte ───────────────────────────────────

const deedQuery = db => db('sales as s')
  .join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id').join('leads as c', 'c.id', 's.lead_id')
  .leftJoin('users as u', 'u.id', 'c.assigned_to').leftJoin('legal_sale_files as f', 'f.sale_id', 's.id')
  .leftJoin('suppliers as n', 'n.id', 'f.notary_supplier_id')
  .select('s.id', 's.status', 's.price_fcfa', 's.reserved_at', 's.signed_at', 's.vefa', 's.lead_id', 'l.id as lot_id', 'l.code as lot_code', 'l.ilot',
    'l.status as lot_status', 'p.id as project_id', 'p.name as project_name', 'c.name as client_name', 'c.client_code', 'c.phone as client_phone',
    'c.email as client_email', 'c.assigned_to', 'u.name as commercial_name', 'f.reservation_on', 'f.pieces_on', 'f.notaire_on', 'f.notary_supplier_id',
    'f.notary_ref', 'f.projet_on', 'f.deed_number', 'f.remise_on', 'f.notes as legal_notes', 'f.updated_at as legal_updated_at', 'n.name as notary_name');

const deedDates = r => ({
  reservation: isoDay(r.reservation_on), pieces: isoDay(r.pieces_on), notaire: isoDay(r.notaire_on), projet: isoDay(r.projet_on),
  acte: isoDay(r.signed_at), remise: isoDay(r.remise_on),
});

function serializeDeed(r) {
  const p = deedProgress(deedDates(r));
  return {
    sale_id: r.id, status: r.status, price_fcfa: Number(r.price_fcfa), reserved_at: isoDay(r.reserved_at), vefa: !!r.vefa,
    lot_id: r.lot_id, lot_code: r.lot_code, ilot: r.ilot, lot_status: r.lot_status, lot_status_label: LOT_STATUS_LABELS[r.lot_status] || r.lot_status,
    project_id: r.project_id, project_name: r.project_name, lead_id: r.lead_id, client_name: r.client_name, client_code: r.client_code,
    client_phone: r.client_phone, client_email: r.client_email, commercial_id: r.assigned_to, commercial_name: r.commercial_name,
    notary_supplier_id: r.notary_supplier_id, notary_name: r.notary_name, notary_ref: r.notary_ref, deed_number: r.deed_number,
    notes: r.legal_notes, updated_at: isoTime(r.legal_updated_at), ...p,
  };
}

/** Ventes en cours (ou soldées) et leur avancement ; filtre par étape en cours ou texte. */
async function deeds(db, { step = null, q = '', commercialId = null } = {}) {
  const query = deedQuery(db).whereIn('s.status', ACTIVE_SALES).orderBy('s.reserved_at', 'desc');
  if (commercialId) query.where('c.assigned_to', commercialId);
  let rows = (await query.limit(3000)).map(serializeDeed);
  if (step) rows = rows.filter(d => (step === 'termine' ? !d.current : d.current === step));
  const text = String(q || '').trim().toLowerCase();
  if (text) rows = rows.filter(d => [d.client_name, d.client_code, d.project_name, d.lot_code, d.notary_name, d.deed_number].some(x => x && String(x).toLowerCase().includes(text)));
  return rows;
}

async function deedDetail(db, saleId) {
  const r = await deedQuery(db).where('s.id', saleId).first();
  if (!r) throw new HttpError(404, 'Dossier de vente introuvable.');
  const litigations = await db('litigations').where({ sale_id: saleId }).orderBy('id', 'desc').select('id', 'reference', 'title', 'status', 'stage');
  return { ...serializeDeed(r), litigations: litigations.map(l => ({ ...l, stage_label: LITIGATION_STAGES[l.stage] })) };
}

/** Le prospect avance dans le circuit de vente, jamais en arrière. */
async function advanceLead(trx, leadId, stage, userId) {
  const lead = await trx('leads').where({ id: leadId }).first('stage');
  if (!lead || ['perdu', 'livraison', 'sav'].includes(lead.stage) || LEAD_STAGES.indexOf(lead.stage) >= LEAD_STAGES.indexOf(stage)) return;
  await trx('leads').where({ id: leadId }).update({ stage, updated_at: new Date() });
  await require('./portfolio').syncLead(trx, leadId, { by: userId });
}

/** Pièce du dossier de vente mise à l'état voulu, sans revenir en arrière (a_fournir → en_cours → signe → delivre). */
async function documentAtLeast(trx, saleId, type, status, userId) {
  const order = ['a_fournir', 'en_cours', 'signe', 'delivre'];
  const doc = await trx('sale_documents').where({ sale_id: saleId, type }).orderBy('id').first();
  if (!doc || order.indexOf(doc.status) >= order.indexOf(status)) return;
  await trx('sale_documents').where({ id: doc.id }).update({ status, updated_by: userId, updated_at: new Date() });
}

/**
 * Acte signé (depuis le Juridique ou le dashboard) : le lot réservé passe « vendu », la pièce « Acte notarié » est
 * signée, le prospect passe à l'étape Notaire. À appeler dans la transaction qui pose la date.
 */
async function deedSigned(trx, sale, userId) {
  const lot = await trx('lots').where({ id: sale.lot_id }).first();
  if (lot?.status === 'reserve') {
    await trx('lots').where({ id: lot.id }).update({ status: 'vendu', updated_at: new Date() });
    await trx('lot_status_history').insert({ lot_id: lot.id, from_status: 'reserve', to_status: 'vendu', user_id: userId, lead_id: sale.lead_id, reason: 'Acte notarié signé' });
  }
  await documentAtLeast(trx, sale.id, 'acte_notarie', 'signe', userId);
  await advanceLead(trx, sale.lead_id, 'notaire', userId);
}

/**
 * Prévient de l'acte signé (choix du client) : le commercial du client, le comptable, la Direction (cloche) et le
 * client (e-mail ; l'acte apparaît signé dans son espace). À appeler après la transaction.
 */
async function announceDeed(db, saleId, userId) {
  const d = await deedDetail(db, saleId);
  const what = `${d.client_name} — ${d.project_name}, lot ${d.lot_code}`;
  const date = fr(d.steps.find(s => s.key === 'acte').date);
  const base = { event: 'acte.signe', title: `Acte signé le ${date} : ${what}`, body: d.notary_name ? `Notaire : ${d.notary_name}${d.deed_number ? ` · acte n° ${d.deed_number}` : ''}` : null, key: `acte:${saleId}`, except: userId };
  await notify(db, { ...base, to: d.commercial_id, module: 'commercial', link: '/commercial/ventes', priority: 'info' });
  // Circuit d'information : Direction générale, exploitation, Comptabilité (écriture « CA à l'acte »), SAV (réglable)
  await inform(db, 'acte.signe', {
    title: base.title, body: base.body, key: base.key, except: userId,
    link: `/juridique/actes?fiche=${saleId}`, links: { compta: '/compta/ecritures', sav: '/sav/reserves' },
  });
  if (d.client_email) {
    await sendMail({
      to: d.client_email,
      subject: '[SIIPAF] Votre acte de vente est signé',
      text: `Bonjour ${d.client_name},\n\nL’acte de vente de votre bien (${d.project_name}, lot ${d.lot_code}) a été signé le ${date}${d.notary_name ? ` chez ${d.notary_name}` : ''}.\nVous le retrouvez dans votre espace client, rubrique Documents. Une expédition de l’acte vous sera remise par nos soins.\n\nL’équipe SIIPAF`,
    });
  }
}

/**
 * Date (ou efface) une étape et les informations qui l'accompagnent (notaire, référence de l'étude, n° d'acte).
 * Effets : réservation signée → pièce « Contrat de réservation » signée, prospect à l'étape Contrat ; transmis au
 * notaire → prospect à l'étape Notaire ; acte → deedSigned ; expédition remise → pièce « Acte notarié » délivrée.
 */
async function setStep(db, saleId, { key, date = null, notary_supplier_id, notary_ref, deed_number, notes }, user) {
  let signedNow = false;
  await db.transaction(async trx => {
    const sale = await trx('sales').where({ id: saleId }).first();
    if (!sale) throw new HttpError(404, 'Dossier de vente introuvable.');
    if (sale.status === 'desiste') throw new HttpError(409, 'Dossier désisté : le circuit de l’acte est arrêté.');
    let file = await trx('legal_sale_files').where({ sale_id: saleId }).first();
    if (!file) {
      await trx('legal_sale_files').insert({ sale_id: saleId, updated_by: user.id });
      file = await trx('legal_sale_files').where({ sale_id: saleId }).first();
    }
    const dates = deedDates({ ...file, signed_at: sale.signed_at });
    if (key) {
      const refusal = deedStepRefusal(dates, key, date);
      // Dossier repris avec un acte déjà signé : l'expédition peut être remise sans dater les étapes d'avant
      if (refusal && !(key === 'remise' && date && dates.acte && date >= dates.acte)) throw new HttpError(409, refusal);
    }
    if (key === 'notaire' && date && !(notary_supplier_id || file.notary_supplier_id)) throw new HttpError(400, 'Choisissez le notaire (fiche fournisseur de la Comptabilité).');
    if (notary_supplier_id && !(await trx('suppliers').where({ id: notary_supplier_id }).first())) throw new HttpError(404, 'Notaire introuvable.');

    const patch = { updated_by: user.id, updated_at: new Date() };
    if (notary_supplier_id !== undefined) patch.notary_supplier_id = notary_supplier_id;
    if (notary_ref !== undefined) patch.notary_ref = notary_ref;
    if (deed_number !== undefined) patch.deed_number = deed_number;
    if (notes !== undefined) patch.notes = notes;
    if (key && key !== 'acte') patch[`${key}_on`] = date;
    await trx('legal_sale_files').where({ id: file.id }).update(patch);

    if (key === 'acte') {
      await trx('sales').where({ id: saleId }).update({ signed_at: date, updated_at: new Date() });
      if (!dates.acte) { await deedSigned(trx, sale, user.id); signedNow = true; }
    }
    if (key === 'reservation' && date) {
      await documentAtLeast(trx, saleId, 'contrat_reservation', 'signe', user.id);
      await advanceLead(trx, sale.lead_id, 'contrat', user.id);
    }
    if (key === 'notaire' && date) await advanceLead(trx, sale.lead_id, 'notaire', user.id);
    if (key === 'remise' && date) await documentAtLeast(trx, saleId, 'acte_notarie', 'delivre', user.id);
  });
  if (signedNow) await announceDeed(db, saleId, user.id);
  return deedDetail(db, saleId);
}

// ─── Litiges ──────────────────────────────────────────────────────────────

const litigationQuery = db => db('litigations as g')
  .leftJoin('users as o', 'o.id', 'g.owner_id').leftJoin('suppliers as s', 's.id', 'g.supplier_id')
  .leftJoin('sav_tickets as t', 't.id', 'g.sav_ticket_id').leftJoin('contracts as c', 'c.id', 'g.contract_id')
  .leftJoin('employees as e', 'e.id', 'g.employee_id').leftJoin('sales as v', 'v.id', 'g.sale_id').leftJoin('leads as cl', 'cl.id', 'v.lead_id')
  .leftJoin('lots as lt', 'lt.id', 'v.lot_id').leftJoin('projects as p', 'p.id', 'lt.project_id')
  .select('g.*', 'o.name as owner_name', 's.name as supplier_name', 't.ref as sav_ref', 't.title as sav_title', 'c.reference as contract_reference',
    'c.title as contract_title', 'e.first_name as employee_first_name', 'e.last_name as employee_last_name', 'cl.name as client_name',
    'lt.code as lot_code', 'p.name as project_name');

/** Voit un litige : juriste, Direction, juriste en charge, ou un membre du service concerné. */
const canSeeLitigation = (l, v) => isLegal(v) || l.owner_id === v.userId || (!!l.department && l.department === v.department);

function serializeLitigation(l, day = today()) {
  const next = isoDay(l.next_date);
  return {
    id: l.id, reference: l.reference, origin: l.origin, origin_label: LITIGATION_ORIGINS[l.origin] || l.origin, title: l.title, opponent: l.opponent,
    amount_fcfa: l.amount_fcfa == null ? null : Number(l.amount_fcfa), stage: l.stage, stage_label: LITIGATION_STAGES[l.stage] || l.stage,
    status: l.status, outcome: l.outcome, outcome_label: LITIGATION_OUTCOMES[l.outcome] || null,
    department: l.department, department_label: DEPARTMENTS[l.department] || null, owner_id: l.owner_id, owner_name: l.owner_name,
    lawyer: l.lawyer, court: l.court, next_date: next, next_label: l.next_label, days_left: next ? daysBetween(day, next) : null,
    opened_on: isoDay(l.opened_on), closed_on: isoDay(l.closed_on), close_note: l.close_note, notes: l.notes,
    sale_id: l.sale_id, sale_label: l.sale_id ? [l.client_name, l.project_name, l.lot_code && `lot ${l.lot_code}`].filter(Boolean).join(' · ') : null,
    sav_ticket_id: l.sav_ticket_id, sav_label: l.sav_ticket_id ? `${l.sav_ref} — ${l.sav_title}` : null,
    supplier_id: l.supplier_id, supplier_name: l.supplier_name,
    contract_id: l.contract_id, contract_label: l.contract_id ? `${l.contract_reference} — ${l.contract_title}` : null,
    employee_id: l.employee_id, employee_name: l.employee_id ? `${l.employee_first_name || ''} ${l.employee_last_name || ''}`.trim() : null,
  };
}

async function loadLitigation(db, id) {
  const l = await litigationQuery(db).where('g.id', id).first();
  if (!l) throw new HttpError(404, 'Litige introuvable.');
  return l;
}

async function litigationDetail(db, id) {
  const l = await loadLitigation(db, id);
  const events = await db('litigation_events as e').leftJoin('users as u', 'u.id', 'e.created_by').where('e.litigation_id', id)
    .orderBy([{ column: 'e.date', order: 'desc' }, { column: 'e.id', order: 'desc' }]).select('e.*', 'u.name as created_by_name');
  return {
    ...serializeLitigation(l),
    events: events.map(e => ({
      id: e.id, stage: e.stage, stage_label: LITIGATION_STAGES[e.stage] || e.stage, date: isoDay(e.date), note: e.note, created_by_name: e.created_by_name,
      file_url: e.file_filename ? `/api/admin/erp/juridique/litiges/evenements/${e.id}/fichier` : null, file_name: e.file_name,
    })),
  };
}

async function litigations(db, v, { status = 'ouvert', origin = null, q = '' } = {}) {
  const query = litigationQuery(db).orderBy('g.reference', 'desc');
  if (!isLegal(v)) query.where(w => { w.where('g.owner_id', v.userId); if (v.department) w.orWhere('g.department', v.department); });
  if (status) query.where('g.status', status);
  if (origin) query.where('g.origin', origin);
  let rows = (await query.limit(2000)).map(l => serializeLitigation(l));
  const text = String(q || '').trim().toLowerCase();
  if (text) rows = rows.filter(l => [l.reference, l.title, l.opponent, l.sale_label, l.supplier_name, l.lawyer].some(x => x && String(x).toLowerCase().includes(text)));
  return rows;
}

/** Contrôles des liens d'un litige (vente, réclamation, fournisseur, contrat, employé, juriste). */
async function litigationFields(db, data, current = {}) {
  const m = { ...current, ...data };
  if (!LITIGATION_ORIGINS[m.origin]) throw new HttpError(400, 'Origine du litige inconnue.');
  if (m.department && !DEPARTMENTS[m.department]) throw new HttpError(400, 'Service inconnu.');
  const links = [['sale_id', 'sales', 'Dossier de vente'], ['sav_ticket_id', 'sav_tickets', 'Réclamation'], ['supplier_id', 'suppliers', 'Fournisseur'], ['contract_id', 'contracts', 'Contrat'], ['employee_id', 'employees', 'Employé']];
  for (const [k, table, label] of links) if (data[k] && !(await db(table).where({ id: data[k] }).first('id'))) throw new HttpError(404, `${label} introuvable.`);
  if (data.owner_id && !(await db('users').where({ id: data.owner_id, active: true }).first())) throw new HttpError(400, 'Juriste introuvable ou inactif.');
  return data;
}

async function createLitigation(db, data, user) {
  const row = await litigationFields(db, data);
  const opened = row.opened_on || today();
  const id = await db.transaction(async trx => {
    const [i] = await trx('litigations').insert({ ...row, opened_on: opened, stage: row.stage || 'amiable', reference: await nextReference(trx, 'litigations', 'LIT', opened), created_by: user.id });
    const lid = insertedId(i);
    await trx('litigation_events').insert({ litigation_id: lid, stage: row.stage || 'amiable', date: opened, note: 'Ouverture du dossier', created_by: user.id });
    return lid;
  });
  const l = await litigationDetail(db, id);
  // Litige ouvert : le juriste et la Direction sont prévenus (cloche) ; le juriste nommé aussi
  await inform(db, 'litige.ouvert', {
    direct: [l.owner_id].filter(Boolean), except: user.id,
    title: `Litige ouvert : ${l.reference} — ${l.title}`, body: `${l.origin_label} · ${l.opponent}${l.amount_fcfa ? ` · ${money(l.amount_fcfa)}` : ''}`,
    link: `/juridique/litiges?fiche=${id}`, priority: 'action', key: `litige:${id}:ouvert`,
  });
  if (row.sale_id && row.origin === 'impaye') await resolve(db, `impaye-jur:${row.sale_id}:`);
  return l;
}

async function updateLitigation(db, l, data) {
  if (l.status !== 'ouvert') throw new HttpError(409, 'Litige clos : rouvrez-le pour le modifier.');
  const row = await litigationFields(db, data, l);
  await db('litigations').where({ id: l.id }).update({ ...row, updated_at: new Date() });
}

/** Nouvelle étape datée (mise en demeure, audience…) ; « Clos » ferme le dossier avec son issue. */
async function addEvent(db, l, { stage, date, note, outcome, next_date, next_label }, { file, userId }) {
  if (l.status !== 'ouvert') throw new HttpError(409, 'Litige clos : rouvrez-le pour ajouter une étape.');
  if (!LITIGATION_STAGES[stage]) throw new HttpError(400, 'Étape inconnue.');
  if (stage === 'clos' && !LITIGATION_OUTCOMES[outcome]) throw new HttpError(400, 'Indiquez l’issue du litige.');
  await db.transaction(async trx => {
    await trx('litigation_events').insert({ litigation_id: l.id, stage, date, note: note || null, created_by: userId, ...fileFields(file) });
    const patch = { stage, updated_at: new Date() };
    if (stage === 'clos') Object.assign(patch, { status: 'clos', outcome, closed_on: date, close_note: note || null, next_date: null, next_label: null });
    else if (next_date !== undefined) Object.assign(patch, { next_date: next_date || null, next_label: next_date ? next_label || null : null });
    await trx('litigations').where({ id: l.id }).update(patch);
  });
  if (stage === 'clos') await resolve(db, `litige:${l.id}:`);
}

async function reopenLitigation(db, l, userId) {
  if (l.status === 'ouvert') throw new HttpError(409, 'Litige déjà ouvert.');
  const stage = (await db('litigation_events').where({ litigation_id: l.id }).whereNot('stage', 'clos').orderBy([{ column: 'date', order: 'desc' }, { column: 'id', order: 'desc' }]).first('stage'))?.stage || 'amiable';
  await db.transaction(async trx => {
    await trx('litigations').where({ id: l.id }).update({ status: 'ouvert', stage, outcome: null, closed_on: null, close_note: null, updated_at: new Date() });
    await trx('litigation_events').insert({ litigation_id: l.id, stage, date: today(), note: 'Dossier rouvert', created_by: userId });
  });
}

// ─── Cautions et retenues de garantie ─────────────────────────────────────

const guaranteeQuery = db => db('guarantees as g')
  .join('guarantee_kinds as k', 'k.id', 'g.kind_id').leftJoin('suppliers as s', 's.id', 'g.supplier_id')
  .leftJoin('contracts as c', 'c.id', 'g.contract_id').leftJoin('users as o', 'o.id', 'g.owner_id')
  .select('g.*', 'k.label as kind_label', 's.name as supplier_name', 'c.reference as contract_reference', 'c.title as contract_title', 'o.name as owner_name');

/** Voit les cautions : juriste, Direction, et la Comptabilité (elle paie les retenues libérées). */
const canSeeGuarantees = v => isLegal(v) || v.can('compta:read');

function serializeGuarantee(g, day = today()) {
  const x = {
    ...g, amount_fcfa: Number(g.amount_fcfa), issued_on: isoDay(g.issued_on), expires_on: isoDay(g.expires_on), reception_on: isoDay(g.reception_on),
    release_on: isoDay(g.release_on), closed_on: isoDay(g.closed_on), created_at: isoTime(g.created_at), updated_at: isoTime(g.updated_at),
  };
  const deadline = guaranteeDeadline(x);
  return {
    ...x, file_filename: undefined, direction_label: GUARANTEE_DIRECTIONS[g.direction], status_label: GUARANTEE_STATUSES[g.status],
    counterparty_name: g.supplier_name || g.counterparty, contract_label: g.contract_id ? `${g.contract_reference} — ${g.contract_title}` : null,
    deadline: deadline ? { ...deadline, days_left: daysBetween(day, deadline.date) } : null,
    file_url: g.file_filename ? `/api/admin/erp/juridique/cautions/${g.id}/fichier` : null,
  };
}

async function loadGuarantee(db, id) {
  const g = await guaranteeQuery(db).where('g.id', id).first();
  if (!g) throw new HttpError(404, 'Caution introuvable.');
  return g;
}

async function guarantees(db, { status = 'active', direction = null, contractId = null, q = '' } = {}) {
  const query = guaranteeQuery(db).orderBy('g.reference', 'desc');
  if (status) query.where('g.status', status);
  if (direction) query.where('g.direction', direction);
  if (contractId) query.where('g.contract_id', contractId);
  let rows = (await query.limit(2000)).map(g => serializeGuarantee(g));
  const text = String(q || '').trim().toLowerCase();
  if (text) rows = rows.filter(g => [g.reference, g.kind_label, g.counterparty_name, g.bank, g.contract_label].some(x => x && String(x).toLowerCase().includes(text)));
  return rows;
}

/**
 * Contrôles et calculs : le sens vient de la sorte ; une retenue est libérée à la fin du délai de garantie, comptée
 * depuis la réception (date proposée, modifiable) ; une caution porte sa date d'expiration.
 */
async function guaranteeFields(db, data, current = {}) {
  const m = { ...current, ...data };
  const kind = await db('guarantee_kinds').where({ id: m.kind_id }).first();
  if (!kind) throw new HttpError(400, 'Sorte de caution inconnue.');
  if (!current.id && !kind.active) throw new HttpError(400, 'Cette sorte de caution est archivée.');
  if (!m.supplier_id && !m.counterparty) throw new HttpError(400, 'Indiquez le tiers (fournisseur ou nom).');
  if (data.supplier_id && !(await db('suppliers').where({ id: data.supplier_id }).first())) throw new HttpError(404, 'Fournisseur introuvable.');
  if (data.contract_id && !(await db('contracts').where({ id: data.contract_id }).first())) throw new HttpError(404, 'Contrat introuvable.');
  if (data.owner_id && !(await db('users').where({ id: data.owner_id, active: true }).first())) throw new HttpError(400, 'Responsable introuvable ou inactif.');
  const out = { ...data, direction: kind.direction };
  if (kind.direction === 'retenue') {
    const reception = isoDay(m.reception_on);
    if (reception && !m.release_on) out.release_on = addMonths(reception, (await settings(db)).legal_warranty_months);
  } else if (m.expires_on && m.issued_on && isoDay(m.expires_on) < isoDay(m.issued_on)) throw new HttpError(400, 'L’expiration précède l’émission.');
  return out;
}

async function createGuarantee(db, data, { file, userId }) {
  const row = await guaranteeFields(db, data);
  const date = row.issued_on || row.reception_on || today();
  return db.transaction(async trx => {
    const [i] = await trx('guarantees').insert({ ...row, reference: await nextReference(trx, 'guarantees', 'GAR', date), created_by: userId, ...fileFields(file) });
    return insertedId(i);
  });
}

async function updateGuarantee(db, g, data, { file }) {
  if (g.status !== 'active') throw new HttpError(409, 'Caution close : remettez-la en cours pour la modifier.');
  const row = await guaranteeFields(db, data, { ...g, reception_on: isoDay(g.reception_on), release_on: 'release_on' in data ? data.release_on : isoDay(g.release_on) });
  if (file) { await removeFile(g.file_filename); Object.assign(row, fileFields(file)); }
  await db('guarantees').where({ id: g.id }).update({ ...row, updated_at: new Date() });
}

async function closeGuarantee(db, g, { status, date, note }) {
  if (g.status !== 'active') throw new HttpError(409, 'Caution déjà close.');
  await db('guarantees').where({ id: g.id }).update({ status, closed_on: date, close_note: note || null, updated_at: new Date() });
  await resolve(db, `caution:${g.id}:`);
}
async function reopenGuarantee(db, g) {
  if (g.status === 'active') throw new HttpError(409, 'Caution déjà en cours.');
  await db('guarantees').where({ id: g.id }).update({ status: 'active', closed_on: null, close_note: null, updated_at: new Date() });
}

// ─── Impayés ──────────────────────────────────────────────────────────────

/**
 * Ventes en retard de paiement (plus ancienne échéance impayée), avec le seuil de transmission au Juridique et le
 * litige ouvert s'il y en a un. `transmitted` : retard au moins égal au seuil.
 */
async function unpaid(db, { day = today(), commercialId = null } = {}) {
  const { scheduleStatus } = require('./schedule');
  const { totals } = require('./sales');
  const { legal_unpaid_days: threshold } = await settings(db);
  const q = deedQuery(db).where('s.status', 'en_cours');
  if (commercialId) q.where('c.assigned_to', commercialId);
  const rows = await q;
  const open = await db('litigations').where({ status: 'ouvert' }).whereNotNull('sale_id').select('id', 'sale_id', 'reference');
  const openBySale = Object.fromEntries(open.map(l => [l.sale_id, l]));
  const out = [];
  for (const r of rows) {
    const sale = await db('sales').where({ id: r.id }).first();
    const age = unpaidAge((await scheduleStatus(db, sale, await totals(db, sale))).lines, day);
    if (!age || age.days < 1) continue;
    const l = openBySale[r.id];
    out.push({
      sale_id: r.id, client_name: r.client_name, client_code: r.client_code, client_phone: r.client_phone, project_name: r.project_name, lot_code: r.lot_code,
      commercial_id: r.assigned_to, commercial_name: r.commercial_name, price_fcfa: Number(r.price_fcfa), oldest_due: age.due_date, days_late: age.days,
      overdue_fcfa: age.overdue_fcfa, overdue_count: age.count, transmitted: age.days >= threshold, litigation: l ? { id: l.id, reference: l.reference } : null,
    });
  }
  return { threshold, items: out.sort((a, b) => b.days_late - a.days_late) };
}

// ─── Courrier affecté au service Juridique ────────────────────────────────

/** Courriers affectés au service Juridique : en cours, et traités depuis 30 jours (choix du client du 23/10). */
async function departmentMail(db, user, can) {
  const courrier = require('./courrier');
  const v = await courrier.viewer(db, user, can);
  const since = new Date(Date.now() - 30 * 86400000);
  const rows = await courrier.query(db).where('m.assigned_department', 'juridique')
    .where(w => w.where('m.status', 'affecte').orWhere(x => x.where('m.status', 'traite').where('m.done_at', '>=', since)))
    .orderBy('m.date', 'desc').limit(50);
  return rows.map(m => courrier.serialize(m, v));
}

// ─── Tableau de bord, pastilles ───────────────────────────────────────────

async function overview(db, user, can) {
  const day = today();
  const v = { userId: user.id, can };
  const [deedRows, lits, gars, unpaidList, mail] = await Promise.all([
    deeds(db), litigations(db, v, { status: 'ouvert' }), guarantees(db, { status: 'active' }), unpaid(db, { day }), departmentMail(db, user, can),
  ]);
  const byStep = Object.fromEntries([...DEED_STEPS.map(s => [s.key, 0]), ['termine', 0]]);
  for (const d of deedRows) byStep[d.current || 'termine']++;
  const byStage = {};
  for (const l of lits) byStage[l.stage] = (byStage[l.stage] || 0) + 1;
  // Échéances des 30 prochains jours (dépassées comprises) : litiges et cautions
  const agenda = [
    ...lits.filter(l => l.next_date && l.days_left <= 30).map(l => ({ kind: 'litige', label: l.next_label || 'Échéance du litige', title: `${l.reference} — ${l.title}`, date: l.next_date, days_left: l.days_left, link: `/juridique/litiges?fiche=${l.id}` })),
    ...gars.filter(g => g.deadline && g.deadline.days_left <= 30).map(g => ({ kind: 'caution', label: g.deadline.label, title: `${g.reference} — ${g.kind_label} · ${g.counterparty_name || ''}`, date: g.deadline.date, days_left: g.deadline.days_left, amount_fcfa: g.amount_fcfa, link: `/juridique/cautions?fiche=${g.id}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const transmitted = unpaidList.items.filter(u => u.transmitted);
  return {
    deeds: { total: deedRows.length, by_step: byStep, steps: DEED_STEPS, waiting_notary: deedRows.filter(d => d.current === 'projet' || d.current === 'acte').length },
    litigations: { open: lits.length, by_stage: byStage, stages: LITIGATION_STAGES, amount_fcfa: lits.reduce((t, l) => t + (l.amount_fcfa || 0), 0) },
    guarantees: {
      active: gars.length, received_fcfa: gars.filter(g => g.direction === 'recue').reduce((t, g) => t + g.amount_fcfa, 0),
      given_fcfa: gars.filter(g => g.direction === 'donnee').reduce((t, g) => t + g.amount_fcfa, 0), retained_fcfa: gars.filter(g => g.direction === 'retenue').reduce((t, g) => t + g.amount_fcfa, 0),
    },
    unpaid: { threshold: unpaidList.threshold, late: unpaidList.items.length, transmitted: transmitted.length, to_handle: transmitted.filter(u => !u.litigation).slice(0, 10), to_handle_total: transmitted.filter(u => !u.litigation).length },
    agenda: agenda.slice(0, 20), agenda_total: agenda.length, mail,
  };
}

async function badges(db, user, can) {
  const day = today();
  const n = async q => Number((await q.count({ n: '*' }).first()).n || 0);
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const legal = isLegal({ can });
  const e = await db('employees').where({ user_id: user.id }).first('department');
  const [litDue, mailOpen] = await Promise.all([
    n(db('litigations').where({ status: 'ouvert' }).where('next_date', '<=', soon).modify(q => { if (!legal) q.where(w => { w.where('owner_id', user.id); if (e?.department) w.orWhere('department', e.department); }); })),
    n(db('mail_items').where({ status: 'affecte', assigned_department: 'juridique' })),
  ]);
  const gars = legal || can('compta:read') ? (await guarantees(db, { status: 'active' })).filter(g => g.deadline && g.deadline.days_left <= 30).length : 0;
  const owned = await n(db('litigations').where({ status: 'ouvert' }).where(w => { w.where('owner_id', user.id); if (e?.department) w.orWhere('department', e.department); }));
  return { litigations_due: litDue, guarantees_due: gars, mail: e?.department === 'juridique' || legal ? mailOpen : 0, litigations_mine: owned, count: litDue + gars, day };
}

// ─── Tâche horaire ────────────────────────────────────────────────────────

/**
 * Chaque heure, sans doublon (clé de la notification) : échéances des litiges (veille, jour), cautions et retenues
 * (30 puis 7 jours avant), impayés (commercial dès le 1er jour, Juridique au seuil réglé).
 */
async function tick(db, day = today()) {
  const stats = { litigations: 0, guarantees: 0, unpaid_commercial: 0, unpaid_legal: 0 };
  const jurists = await usersWith(db, 'juridique:write');
  const legal = await settings(db); // rappels des cautions (Juridique › Réglages)

  for (const raw of await litigationQuery(db).where('g.status', 'ouvert').whereNotNull('g.next_date')) {
    const l = serializeLitigation(raw, day);
    const kind = litigationReminder(l.next_date, day);
    if (!kind) continue;
    const title = `Litige ${l.reference} : ${l.next_label || 'échéance'} ${kind === 'veille' ? 'demain' : l.days_left === 0 ? 'aujourd’hui' : `dépassée depuis ${-l.days_left} jour(s)`} (${fr(l.next_date)})`;
    const n = await notify(db, {
      to: l.owner_id ? [l.owner_id] : jurists, module: 'juridique', event: `litige.${kind}`, title, body: `${l.title} · ${l.opponent}`,
      link: `/juridique/litiges?fiche=${l.id}`, priority: kind === 'veille' ? 'action' : 'urgent', key: `litige:${l.id}:${kind}:${l.next_date}`,
      email: { subject: `[SIIPAF] ${title}`, text: u => `Bonjour ${u.name},\n\n${title}\n${l.title} — partie adverse : ${l.opponent}\n\nOuvrir dans l’ERP : ${erpUrl}/juridique/litiges?fiche=${l.id}` },
    });
    if (n) stats.litigations++;
  }

  const accountants = await usersWith(db, 'achats:write');
  for (const g of await guarantees(db, { status: 'active' })) {
    if (!g.deadline) continue;
    const stage = contractAlertStage(g.deadline.date, day, [legal.legal_alert_first_days, legal.legal_alert_second_days]);
    if (!stage || daysBetween(g.deadline.date, day) > 30) continue;
    const left = g.deadline.days_left;
    const when = left < 0 ? `dépassée depuis ${-left} jour(s)` : left === 0 ? 'aujourd’hui' : `dans ${left} jour(s)`;
    const title = `${g.reference} : ${g.deadline.label.toLowerCase()} le ${fr(g.deadline.date)}`;
    // La retenue libérée se rembourse au sous-traitant : le comptable est prévenu avec le juriste
    const n = await notify(db, {
      to: [...(g.owner_id ? [g.owner_id] : []), ...jurists, ...(g.direction === 'retenue' ? accountants : [])], module: 'juridique', event: 'caution.echeance',
      title, body: `${g.kind_label} · ${g.counterparty_name || '—'} · ${money(g.amount_fcfa)} — ${when}`, link: `/juridique/cautions?fiche=${g.id}`,
      priority: left <= 7 ? 'urgent' : 'action', key: `caution:${g.id}:${g.deadline.date}:${stage}`,
      email: { subject: `[SIIPAF] ${title}`, text: u => `Bonjour ${u.name},\n\n${g.deadline.label} (${when}) : ${g.reference} — ${g.kind_label}\nTiers : ${g.counterparty_name || '—'}${g.bank ? ` · banque : ${g.bank}` : ''}\nMontant : ${money(g.amount_fcfa)}\n\nOuvrir dans l’ERP : ${erpUrl}/juridique/cautions?fiche=${g.id}` },
    });
    if (n) stats.guarantees++;
  }

  for (const u of (await unpaid(db, { day })).items) {
    const what = `${u.client_name} — ${u.project_name}, lot ${u.lot_code}`;
    // Le commercial du client et les services du circuit (Comptabilité par défaut, pour le recouvrement)
    if (await inform(db, 'echeance.impayee', {
      direct: u.commercial_id ? [u.commercial_id] : [], title: `Échéance impayée : ${what}`,
      body: `${money(u.overdue_fcfa)} en retard depuis le ${fr(u.oldest_due)}`, link: '/commercial/ventes', links: { compta: '/compta' }, key: `impaye:${u.sale_id}:${u.oldest_due}`,
    }) && u.commercial_id) stats.unpaid_commercial++;
    if (u.transmitted && !u.litigation && await inform(db, 'impaye.transmis', {
      direct: jurists, title: `Impayé de ${u.days_late} jours transmis au Juridique : ${what}`,
      body: `${money(u.overdue_fcfa)} en retard · commercial : ${u.commercial_name || '—'}`, link: '/juridique/impayes', priority: 'action', key: `impaye-jur:${u.sale_id}:${u.oldest_due}`,
    })) stats.unpaid_legal++;
  }
  return stats;
}

module.exports = {
  fileUpload, removeFile, filePath, isLegal, settings, saveSettings,
  deeds, deedDetail, setStep, deedSigned, announceDeed, DEED_STEP_KEYS,
  litigations, loadLitigation, litigationDetail, canSeeLitigation, createLitigation, updateLitigation, addEvent, reopenLitigation,
  guarantees, loadGuarantee, serializeGuarantee, canSeeGuarantees, createGuarantee, updateGuarantee, closeGuarantee, reopenGuarantee,
  unpaid, departmentMail, overview, badges, tick,
};
