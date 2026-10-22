/**
 * ERP · Administration générale › Contrats et échéances. Les services généraux et le juridique saisissent (droit
 * contrats:write), le comptable consulte, le responsable nommé de chaque contrat le voit et reçoit ses alertes avec le
 * responsable d'exploitation (30 puis 7 jours avant). Chaque paiement périodique prépare une facture d'achat en
 * brouillon en Comptabilité. Règles dans lib/domain.js (CONTRACT_*, contractDeadlines, contractPaymentsDue…).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, isoDay } = require('../lib/http');
const { uploadsDir, erpUrl } = require('../config');
const {
  CONTRACT_KINDS, CONTRACT_FREQUENCIES, CONTRACT_STATUSES, CONTRACT_DOC_KINDS,
  contractDeadlines, contractAlertStage, renewedEnd, contractPaymentsDue, daysBetween,
} = require('../lib/domain');
const { splitVat } = require('../lib/compta');
const { nextPurchaseNumber } = require('./compta');
const { notify, usersWith } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const filesDir = path.join(uploadsDir, 'private', 'contrats');
const FILE_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const today = () => new Date().toISOString().slice(0, 10);
const fr = d => (d ? d.split('-').reverse().join('/') : '');

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

const query = db => db('contracts as c')
  .leftJoin('suppliers as s', 's.id', 'c.supplier_id').leftJoin('projects as p', 'p.id', 'c.project_id')
  .leftJoin('users as o', 'o.id', 'c.owner_id').leftJoin('acc_accounts as a', 'a.id', 'c.expense_account_id')
  .select('c.*', 's.name as supplier_name', 'p.name as project_name', 'o.name as owner_name', 'o.email as owner_email', 'a.code as expense_account');

const DAY_FIELDS = ['start_date', 'end_date', 'next_payment_date', 'revision_date', 'closed_on'];
function normalize(c) {
  const out = { ...c, tacit_renewal: !!c.tacit_renewal };
  for (const k of DAY_FIELDS) out[k] = isoDay(c[k]);
  for (const k of ['contract_amount', 'amount_ttc']) out[k] = c[k] == null ? null : Number(c[k]);
  for (const k of ['retention_pct', 'vat_rate']) out[k] = c[k] == null ? null : Number(c[k]);
  return out;
}
const docRow = d => ({
  id: d.id, kind: d.kind, kind_label: CONTRACT_DOC_KINDS[d.kind] || d.kind, label: d.label, expires_on: isoDay(d.expires_on),
  file_url: d.file_filename ? `/api/admin/erp/contrats/documents/${d.id}/fichier` : null, file_name: d.file_name,
});

/** Échéances d'un contrat avec le nombre de jours restants (négatif : dépassée). */
function deadlinesOf(c, docs, day = today()) {
  return contractDeadlines(c, docs).map(d => ({ ...d, days_left: daysBetween(day, d.date) }));
}

function serialize(raw, docs = [], invoices = null) {
  const c = normalize(raw);
  const deadlines = deadlinesOf(c, docs);
  const watch = deadlines.filter(d => d.kind !== 'paiement');
  return {
    ...c, kind_label: c.kind === 'autre' && c.kind_other ? c.kind_other : CONTRACT_KINDS[c.kind] || c.kind, status_label: CONTRACT_STATUSES[c.status],
    frequency_label: CONTRACT_FREQUENCIES[c.frequency]?.label || null, counterparty_name: c.supplier_name || c.counterparty,
    file_url: c.file_filename ? `/api/admin/erp/contrats/${c.id}/fichier` : null, file_filename: undefined, owner_email: undefined,
    documents: docs.map(docRow), deadlines, next_deadline: watch[0] || null, ...(invoices ? { invoices } : {}),
  };
}

async function docsByContract(db, ids) {
  const rows = ids.length ? await db('contract_documents').whereIn('contract_id', ids).orderBy('expires_on') : [];
  const by = {};
  for (const d of rows) (by[d.contract_id] ||= []).push({ ...d, expires_on: isoDay(d.expires_on) });
  return by;
}

async function load(db, id) {
  const c = await query(db).where('c.id', id).first();
  if (!c) throw new HttpError(404, 'Contrat introuvable.');
  return c;
}

/** Voit un contrat : droits contrats:read / contrats:write, ou son responsable. */
const canSee = (c, { userId, can }) => can('contrats:read') || can('contrats:write') || c.owner_id === userId;

async function detail(db, id) {
  const c = await load(db, id);
  const docs = (await docsByContract(db, [c.id]))[c.id] || [];
  const invoices = (await db('contract_invoices as ci').leftJoin('purchase_invoices as i', 'i.id', 'ci.purchase_invoice_id').where('ci.contract_id', c.id)
    .orderBy('ci.due_date', 'desc').select('ci.due_date', 'i.id', 'i.number', 'i.status', 'i.amount_ttc'))
    .map(i => ({ ...i, due_date: isoDay(i.due_date), amount_ttc: i.amount_ttc == null ? null : Number(i.amount_ttc) }));
  return serialize(c, docs, invoices);
}

async function nextReference(trx, date) {
  const prefix = `CTR-${date.slice(0, 4)}-`;
  const last = await trx('contracts').where('reference', 'like', `${prefix}%`).orderBy('reference', 'desc').first('reference');
  return `${prefix}${String(last ? Number(last.reference.slice(prefix.length)) + 1 : 1).padStart(4, '0')}`;
}

/** Contrôles et résolution des champs (compte de charge, fournisseur requis pour préparer les factures). */
async function fields(db, data, current = {}) {
  const m = { ...current, ...data };
  if (!CONTRACT_KINDS[m.kind]) throw new HttpError(400, 'Type de contrat inconnu.');
  if (m.kind === 'autre' && !m.kind_other) throw new HttpError(400, 'Précisez la nature du contrat.');
  if (!m.supplier_id && !m.counterparty) throw new HttpError(400, 'Indiquez le cocontractant (fournisseur ou nom).');
  if (m.supplier_id && !(await db('suppliers').where({ id: m.supplier_id }).first())) throw new HttpError(404, 'Fournisseur introuvable.');
  if (m.end_date && m.end_date < m.start_date) throw new HttpError(400, 'La fin du contrat précède son début.');
  if (m.owner_id && !(await db('users').where({ id: m.owner_id, active: true }).first())) throw new HttpError(400, 'Responsable introuvable ou inactif.');
  const out = { ...data };
  if ('expense_account' in data) {
    delete out.expense_account;
    if (data.expense_account) {
      const acc = await db('acc_accounts').where({ code: data.expense_account }).first();
      if (!acc || ![2, 6].includes(acc.class)) throw new HttpError(400, 'Compte de charge : classe 6 (ou 2 pour une immobilisation).');
      out.expense_account_id = acc.id;
    } else out.expense_account_id = null;
  }
  if (m.frequency) {
    if (!CONTRACT_FREQUENCIES[m.frequency]) throw new HttpError(400, 'Périodicité inconnue.');
    if (!m.amount_ttc || !m.next_payment_date) throw new HttpError(400, 'Paiement périodique : montant et date de la prochaine échéance.');
    if (!m.supplier_id) throw new HttpError(400, 'Paiement périodique : choisissez le fournisseur (fichier de la Comptabilité) pour préparer ses factures.');
    const accountId = 'expense_account_id' in out ? out.expense_account_id : current.expense_account_id;
    if (!accountId) {
      const s = await db('suppliers').where({ id: m.supplier_id }).first('expense_account_id');
      if (!s?.expense_account_id) throw new HttpError(400, 'Paiement périodique : indiquez le compte de charge (ou réglez-le sur la fiche du fournisseur).');
      out.expense_account_id = s.expense_account_id;
    }
  }
  return out;
}

async function create(db, data, { file, userId }) {
  const row = await fields(db, data);
  const id = await db.transaction(async trx => {
    const [i] = await trx('contracts').insert({ ...row, reference: await nextReference(trx, data.start_date), created_by: userId, ...fileFields(file) });
    return insertedId(i);
  });
  return id;
}

async function update(db, c, data, { file }) {
  if (c.status !== 'actif') throw new HttpError(409, 'Contrat clos : il ne se modifie plus.');
  const current = normalize(c);
  const row = await fields(db, data, { ...current, expense_account_id: c.expense_account_id });
  if (file) { await removeFile(c.file_filename); Object.assign(row, fileFields(file)); }
  await db('contracts').where({ id: c.id }).update({ ...row, updated_at: new Date() });
}

/** Résiliation ou fin : le contrat ne prépare plus de factures ni d'alertes. */
async function close(db, c, { status, date, reason }) {
  if (c.status !== 'actif') throw new HttpError(409, 'Contrat déjà clos.');
  if (status === 'resilie' && !reason) throw new HttpError(400, 'Indiquez le motif de la résiliation.');
  await db('contracts').where({ id: c.id }).update({ status, closed_on: date, close_reason: reason || null, updated_at: new Date() });
}
async function reopen(db, c) {
  if (c.status === 'actif') throw new HttpError(409, 'Contrat déjà en cours.');
  await db('contracts').where({ id: c.id }).update({ status: 'actif', closed_on: null, close_reason: null, updated_at: new Date() });
}

/** Échéances de tous les contrats visibles, de la plus proche à la plus lointaine (dépassées d'abord). */
async function upcoming(db, v, { days = 60 } = {}) {
  const q = query(db).where('c.status', 'actif');
  if (!v.can('contrats:read') && !v.can('contrats:write')) q.where('c.owner_id', v.userId);
  const rows = await q;
  const docs = await docsByContract(db, rows.map(c => c.id));
  const out = [];
  for (const raw of rows) {
    const c = normalize(raw);
    for (const d of deadlinesOf(c, docs[c.id] || [])) {
      if (d.days_left <= days) out.push({ ...d, contract_id: c.id, reference: c.reference, title: c.title, counterparty_name: raw.supplier_name || c.counterparty, owner_name: raw.owner_name, amount_ttc: d.kind === 'paiement' ? c.amount_ttc : null });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function badges(db, v) {
  const list = await upcoming(db, v, { days: 30 });
  const watched = list.filter(d => d.kind !== 'paiement');
  const owned = Number((await db('contracts').where({ owner_id: v.userId, status: 'actif' }).count({ n: '*' }).first()).n || 0);
  return { due: watched.length, late: watched.filter(d => d.days_left < 0).length, owned };
}

/** Destinataires des alertes : le responsable du contrat et les responsables d'exploitation (sinon les gestionnaires). */
async function alertRecipients(db, c) {
  return db('users').where({ active: true }).where(w => { w.where('role', 'resp_exploitation'); if (c.owner_id) w.orWhere('id', c.owner_id); }).select('id', 'name', 'email');
}

/** Facture d'achat en brouillon pour une échéance de paiement (une seule par échéance). */
async function prepareInvoice(db, c, due) {
  return db.transaction(async trx => {
    if (await trx('contract_invoices').where({ contract_id: c.id, due_date: due }).first()) return null;
    const { ht, vat } = splitVat(c.amount_ttc, c.vat_rate);
    const [i] = await trx('purchase_invoices').insert({
      number: await nextPurchaseNumber(trx, due), supplier_id: c.supplier_id, supplier_ref: c.reference, date: due, due_date: due,
      label: `${c.title} — échéance du ${fr(due)}`.slice(0, 255), project_id: c.project_id || null, expense_account_id: c.expense_account_id,
      amount_ht: ht, vat_rate: c.vat_rate || 0, vat_amount: vat, amount_ttc: c.amount_ttc, status: 'brouillon',
    });
    const invoiceId = insertedId(i);
    await trx('contract_invoices').insert({ contract_id: c.id, due_date: due, purchase_invoice_id: invoiceId });
    return invoiceId;
  });
}

/**
 * Tâche quotidienne (lancée chaque heure, sans effet une fois faite) : renouvellement tacite ou fin des contrats échus,
 * factures des paiements à venir (7 jours avant), alertes 30 puis 7 jours avant chaque échéance suivie.
 */
async function tick(db, day = today()) {
  const stats = { renewed: 0, ended: 0, invoices: 0, alerts: 0 };
  const rows = await query(db).where('c.status', 'actif');
  for (const raw of rows) {
    let c = normalize(raw);
    const end = renewedEnd(c, day);
    if (end) {
      await db('contracts').where({ id: c.id }).update({ end_date: end, updated_at: new Date() });
      c = { ...c, end_date: end };
      stats.renewed++;
    } else if (c.end_date && c.end_date < day && !c.tacit_renewal) {
      // Les dernières échéances de paiement avant la fin sont encore préparées
      await payments(c);
      await db('contracts').where({ id: c.id }).update({ status: 'termine', closed_on: c.end_date, close_reason: 'Arrivé à son terme', updated_at: new Date() });
      stats.ended++;
      continue;
    }
    await payments(c);
    const docs = (await docsByContract(db, [c.id]))[c.id] || [];
    for (const d of contractDeadlines(c, docs)) {
      if (d.kind === 'paiement') continue;
      const stage = contractAlertStage(d.date, day);
      if (!stage || daysBetween(d.date, day) > 30) continue; // pas d'alerte pour une échéance oubliée depuis longtemps
      // Chaque palier une fois ; le palier de 30 jours est sauté si celui de 7 jours est déjà passé
      const done = (await db('contract_alerts').where({ contract_id: c.id, deadline_key: d.key, due_date: d.date }).pluck('stage')).map(Number);
      if (done.some(s => s <= stage)) continue;
      await db('contract_alerts').insert({ contract_id: c.id, deadline_key: d.key, due_date: d.date, stage });
      const left = daysBetween(day, d.date);
      const when = left < 0 ? `dépassée depuis ${-left} jour(s)` : left === 0 ? 'aujourd’hui' : `dans ${left} jour(s)`;
      await notify(db, {
        to: await alertRecipients(db, raw), module: 'administration', event: 'contrat.echeance',
        title: `Contrat ${c.reference} : ${d.label.toLowerCase()} le ${fr(d.date)}`, body: `${c.title} — ${when}`,
        link: `/administration/contrats?fiche=${c.id}`, priority: left <= 7 ? 'urgent' : 'action', key: `contrat:${c.id}:${d.key}:${d.date}:${stage}`,
        email: {
          subject: `[SIIPAF] Contrat ${c.reference} : ${d.label.toLowerCase()} le ${fr(d.date)}`,
          text: u => `Bonjour ${u.name},\n\n${d.label} (${when}) pour le contrat ${c.reference} — ${c.title}\nCocontractant : ${raw.supplier_name || c.counterparty || '—'}\nÉchéance : ${fr(d.date)}\n\nOuvrir dans l’ERP : ${erpUrl}/administration/contrats?fiche=${c.id}`,
        },
      });
      stats.alerts++;
    }
  }
  return stats;

  async function payments(c) {
    const { dates, next } = contractPaymentsDue(c, day);
    if (!dates.length) return;
    for (const due of dates) {
      if (!(await prepareInvoice(db, c, due))) continue;
      stats.invoices++;
      // Le comptable valide la facture préparée (lien Contrats → Comptabilité)
      await notify(db, {
        to: await usersWith(db, 'achats:write'), module: 'compta', event: 'contrat.facture_preparee',
        title: `Facture à valider : ${c.reference} — échéance du ${fr(due)}`, body: c.title,
        link: '/compta/achats', priority: 'action', key: `contrat:${c.id}:facture:${due}`,
      });
    }
    await db('contracts').where({ id: c.id }).update({ next_payment_date: next, updated_at: new Date() });
  }
}

async function addDocument(db, c, data, { file, userId }) {
  if (!CONTRACT_DOC_KINDS[data.kind]) throw new HttpError(400, 'Type de pièce inconnu.');
  const [i] = await db('contract_documents').insert({ ...data, contract_id: c.id, created_by: userId, ...fileFields(file) });
  return insertedId(i);
}
/** Renouvellement d'une pièce : nouvelle date d'expiration et, au besoin, le nouveau fichier. */
async function updateDocument(db, d, data, { file }) {
  if (data.kind && !CONTRACT_DOC_KINDS[data.kind]) throw new HttpError(400, 'Type de pièce inconnu.');
  const patch = { ...data, updated_at: new Date() };
  if (file) { await removeFile(d.file_filename); Object.assign(patch, fileFields(file)); }
  await db('contract_documents').where({ id: d.id }).update(patch);
}
async function deleteDocument(db, d) {
  await db('contract_documents').where({ id: d.id }).del();
  await removeFile(d.file_filename);
}

module.exports = {
  fileUpload, removeFile, filePath, query, load, detail, serialize, docsByContract, canSee, create, update, close, reopen,
  upcoming, badges, tick, addDocument, updateDocument, deleteDocument,
};
