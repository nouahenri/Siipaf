/**
 * ERP · RH › Notes de frais (référence : Odoo Notes de frais) : l'employé saisit sa dépense avec la photo du reçu,
 * la soumet ; son responsable (ou le service RH) l'approuve ; le comptable la comptabilise (charge par catégorie,
 * TVA récupérable, analytique par programme) puis rembourse l'employé (banque, caisse, Mobile Money).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, isoDay, toDate } = require('../lib/http');
const { uploadsDir } = require('../config');
const { EXPENSE_STATUSES } = require('../lib/rh');
const rh = require('./rh');
const compta = require('./compta');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const receiptsDir = path.join(uploadsDir, 'private', 'frais');
const RECEIPT_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };
const PAY_JOURNALS = ['BQ', 'CA', 'MM'];

function receiptUpload() {
  fs.mkdirSync(receiptsDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({ destination: receiptsDir, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${RECEIPT_MIME[file.mimetype]}`) }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(RECEIPT_MIME[file.mimetype] ? null : new HttpError(400, 'Reçu : photo (JPEG, PNG, WebP, HEIC) ou PDF.'), !!RECEIPT_MIME[file.mimetype]),
  }).single('receipt');
}

const query = db => db('hr_expenses as x').join('employees as e', 'e.id', 'x.employee_id').leftJoin('projects as p', 'p.id', 'x.project_id').leftJoin('users as u', 'u.id', 'x.approved_by')
  .leftJoin('acc_entries as en', 'en.id', 'x.entry_id')
  .select('x.*', 'e.matricule', 'e.last_name', 'e.first_name', 'e.manager_id', 'e.user_id as employee_user_id', 'e.pay_method', 'p.name as project_name', 'u.name as approved_by_name', 'en.number as entry_number');

function serialize(x, settings) {
  const cat = settings.expense_categories[x.category];
  return {
    ...x, date: isoDay(x.date), paid_at: isoDay(x.paid_at), amount: Number(x.amount), vat_rate: Number(x.vat_rate), employee_name: `${x.last_name} ${x.first_name}`,
    category_label: cat?.label || x.category, account: cat?.account || null, status_label: EXPENSE_STATUSES[x.status]?.label,
    receipt_url: x.receipt_filename ? `/api/admin/erp/rh/expenses/${x.id}/receipt` : null, receipt_filename: undefined,
  };
}

async function detail(db, id) {
  const x = await query(db).where('x.id', id).first();
  if (!x) throw new HttpError(404, 'Note de frais introuvable.');
  return serialize(x, await rh.getSettings(db));
}

async function nextReference(trx, date) {
  const year = String(date).slice(0, 4);
  const last = await trx('hr_expenses').where('reference', 'like', `NDF-${year}-%`).orderBy('reference', 'desc').first('reference');
  return `NDF-${year}-${String(last ? Number(last.reference.slice(9)) + 1 : 1).padStart(4, '0')}`;
}

async function create(db, e, data, { file, userId }) {
  const s = await rh.getSettings(db);
  if (!s.expense_categories[data.category]) throw new HttpError(400, 'Catégorie de dépense inconnue.');
  if (data.date < e.hire_date) throw new HttpError(400, 'Dépense antérieure à l’embauche.');
  return db.transaction(async trx => {
    const [id] = await trx('hr_expenses').insert({
      ...data, employee_id: e.id, reference: await nextReference(trx, data.date), created_by: userId,
      ...(file ? { receipt_filename: file.filename, receipt_name: file.originalname.slice(0, 255), receipt_mime: file.mimetype } : {}),
    });
    return insertedId(id);
  });
}

/** Brouillon modifiable par son auteur ; une note refusée redevient modifiable. */
async function update(db, x, data, { file }) {
  if (!['brouillon', 'refusee'].includes(x.status)) throw new HttpError(409, 'Note de frais déjà soumise.');
  const s = await rh.getSettings(db);
  if (data.category && !s.expense_categories[data.category]) throw new HttpError(400, 'Catégorie de dépense inconnue.');
  const patch = { ...data, status: 'brouillon', refusal_reason: null, updated_at: new Date() };
  if (file) {
    if (x.receipt_filename) await fs.promises.unlink(path.join(receiptsDir, path.basename(x.receipt_filename))).catch(() => {});
    Object.assign(patch, { receipt_filename: file.filename, receipt_name: file.originalname.slice(0, 255), receipt_mime: file.mimetype });
  }
  await db('hr_expenses').where({ id: x.id }).update(patch);
}

/** Qui peut approuver : le responsable direct ou le service RH, jamais l'auteur (sauf super administrateur). */
async function canApprove(db, x, { user, can }) {
  if (x.employee_user_id === user.id && user.role !== 'super_admin') return false;
  if (can('frais:approve')) return true;
  return rh.isManagerOf(db, user.id, { manager_id: x.manager_id });
}

async function transition(db, id, action, { user, can, note = null, journal = null, date = null }) {
  const raw = await query(db).where('x.id', id).first();
  if (!raw) throw new HttpError(404, 'Note de frais introuvable.');
  const own = raw.employee_user_id === user.id;
  const s = await rh.getSettings(db);
  const now = new Date();
  const set = patch => db('hr_expenses').where({ id }).update({ ...patch, updated_at: now });

  if (action === 'submit') {
    if (!own && !can('frais:approve')) throw new HttpError(403, 'Seul l’employé soumet sa note de frais.');
    if (!['brouillon', 'refusee'].includes(raw.status)) throw new HttpError(409, 'Note déjà soumise.');
    if (!raw.receipt_filename) throw new HttpError(400, 'Joignez la photo du reçu avant de soumettre.');
    await set({ status: 'soumise', refusal_reason: null });
  } else if (action === 'approve' || action === 'refuse') {
    if (raw.status !== 'soumise') throw new HttpError(409, 'Cette note n’est pas à approuver.');
    if (!(await canApprove(db, raw, { user, can }))) throw new HttpError(403, own ? 'Vous ne pouvez pas approuver votre propre note.' : 'Seuls le responsable direct et le service RH approuvent.');
    if (action === 'refuse' && !note) throw new HttpError(400, 'Indiquez le motif du refus.');
    await set(action === 'approve' ? { status: 'approuvee', approved_by: user.id, approved_at: now } : { status: 'refusee', refusal_reason: note, approved_by: user.id, approved_at: now });
  } else if (action === 'post') {
    // Comptabilisation : charge HT par programme + TVA récupérable / dette envers l'employé ou trésorerie
    if (!can('frais:post')) throw new HttpError(403, 'Comptabilisation : droit « Comptabiliser les notes de frais ».');
    if (raw.status !== 'approuvee') throw new HttpError(409, 'Note non approuvée.');
    const cs = await compta.getSettings(db);
    const x = serialize(raw, s);
    const vat = x.vat_rate ? Math.round(x.amount - x.amount / (1 + x.vat_rate / 100)) : 0;
    const lines = [{ account: x.account, debit: x.amount - vat, project_id: x.project_id, label: `${x.reference} · ${x.label}` }];
    if (vat) lines.push({ account: cs.accounts.vat_deductible || '4452', debit: vat, label: `TVA ${x.reference}` });
    let journalCode = 'OD';
    if (x.paid_by === 'societe') {
      if (!PAY_JOURNALS.includes(journal)) throw new HttpError(400, 'Choisissez le journal de trésorerie qui a payé la dépense.');
      const j = await db('acc_journals as j').join('acc_accounts as a', 'a.id', 'j.account_id').where('j.code', journal).first('a.code as account_code');
      if (!j) throw new HttpError(400, `Journal ${journal} sans compte de trésorerie.`);
      lines.push({ account: j.account_code, credit: x.amount, label: `${x.reference} · ${x.employee_name}` });
      journalCode = journal;
    } else {
      lines.push({ account: s.expense_payable_account, credit: x.amount, partner_type: 'employe', partner_id: x.employee_id, label: `Frais à rembourser — ${x.employee_name}` });
    }
    await db.transaction(async trx => {
      const entry = await compta.createEntry(trx, {
        journal: journalCode, date: x.date, label: `Note de frais ${x.reference} — ${x.employee_name}`, ref: x.reference, source: 'frais', source_key: `expense:${x.id}`,
        lines, userId: user.id, validate: !!cs.auto_validate,
      });
      await trx('hr_expenses').where({ id }).update({ status: x.paid_by === 'societe' ? 'remboursee' : 'comptabilisee', entry_id: entry.id, paid_at: x.paid_by === 'societe' ? x.date : null, updated_at: now });
    });
  } else if (action === 'reset') {
    if (!(own || can('frais:approve')) || !['soumise', 'refusee'].includes(raw.status)) throw new HttpError(409, 'Note non modifiable.');
    await set({ status: 'brouillon' });
  } else throw new HttpError(400, 'Action inconnue.');
  await notifyExpense(db, raw, action, { user, note });
  return detail(db, id);
}

/** Circuit des notes de frais dans la cloche : responsable (ou service RH), puis comptable, et l'employé à chaque décision. */
async function notifyExpense(db, x, action, { user, note }) {
  const { notify, usersWith, employeeUser, resolve } = require('./notifications');
  const what = `${x.reference} — ${x.last_name} ${x.first_name} · ${Number(x.amount).toLocaleString('fr-FR')} F CFA`;
  if (action === 'submit') {
    const manager = await employeeUser(db, x.manager_id);
    const to = manager && manager.id !== x.employee_user_id ? manager : await usersWith(db, 'frais:approve');
    await notify(db, { to, except: user.id, module: 'rh', event: 'frais.soumise', title: 'Note de frais à approuver', body: what, link: '/rh/frais', priority: 'action', key: `frais:${x.id}:approve:${Date.now()}` });
  } else if (action === 'approve' || action === 'refuse') {
    await resolve(db, `frais:${x.id}:approve`);
    await notify(db, {
      to: x.employee_user_id, except: user.id, module: 'rh', event: action === 'approve' ? 'frais.approuvee' : 'frais.refusee',
      title: `Votre note de frais est ${action === 'approve' ? 'approuvée' : 'refusée'}`, body: action === 'refuse' && note ? `${x.reference} — Motif : ${note}` : what, link: '/rh/moi',
    });
    if (action === 'approve') {
      await notify(db, { to: await usersWith(db, 'frais:post'), except: user.id, module: 'compta', event: 'frais.a_comptabiliser', title: 'Note de frais à comptabiliser', body: what, link: '/rh/frais', priority: 'action', key: `frais:${x.id}:post` });
    }
  } else if (action === 'post') {
    await resolve(db, `frais:${x.id}:post`);
  }
}

/** Remboursement groupé des notes comptabilisées d'un employé : une écriture de trésorerie (422100 / banque…). */
async function reimburse(db, ids, { journal, date, user }) {
  if (!PAY_JOURNALS.includes(journal)) throw new HttpError(400, 'Journal de trésorerie inconnu.');
  const s = await rh.getSettings(db);
  const cs = await compta.getSettings(db);
  const rows = (await query(db).whereIn('x.id', ids)).map(x => serialize(x, s));
  if (rows.length !== ids.length || rows.some(x => x.status !== 'comptabilisee')) throw new HttpError(409, 'Seules les notes comptabilisées et non remboursées se remboursent.');
  if (new Set(rows.map(x => x.employee_id)).size > 1) throw new HttpError(400, 'Remboursez un employé à la fois.');
  const j = await db('acc_journals as j').join('acc_accounts as a', 'a.id', 'j.account_id').where('j.code', journal).first('j.*', 'a.code as account_code');
  if (!j) throw new HttpError(400, `Journal ${journal} sans compte de trésorerie.`);
  const total = rows.reduce((t, x) => t + x.amount, 0);
  await db.transaction(async trx => {
    await compta.createEntry(trx, {
      journal: j, date, label: `Remboursement de frais — ${rows[0].employee_name}`, ref: rows.map(x => x.reference).join(' ').slice(0, 60), source: 'frais',
      source_key: `expense_pay:${rows.map(x => x.id).sort((a, b) => a - b).join('-')}`, userId: user.id, validate: !!cs.auto_validate,
      lines: [{ account: s.expense_payable_account, debit: total, partner_type: 'employe', partner_id: rows[0].employee_id, label: `Frais remboursés — ${rows[0].employee_name}` }, { account: j.account_code, credit: total }],
    });
    await trx('hr_expenses').whereIn('id', ids).update({ status: 'remboursee', paid_at: date, updated_at: new Date() });
  });
  return { reimbursed: rows.length, total };
}

async function receiptPath(x) {
  if (!x.receipt_filename) throw new HttpError(404, 'Pas de reçu.');
  return path.join(receiptsDir, path.basename(x.receipt_filename));
}

module.exports = { receiptUpload, query, serialize, detail, create, update, transition, reimburse, receiptPath, receiptsDir, canApprove, toDate };
