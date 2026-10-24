/**
 * ERP · Chantiers, lot 4 (choix du client du 24/10) : marchés de sous-traitance et situations de travaux.
 * Le marché est un contrat de sorte « sous-traitance » rattaché au chantier (même liste que l'Administration et le
 * Juridique ; retenue de garantie par défaut réglée dans Chantiers › Réglages). Une situation est saisie par le conducteur,
 * vérifiée par lui, puis validée par la Direction (chantiers:direction) : elle devient une facture d'achat en brouillon
 * (poste « sous-traitance » du chantier, comptée dans les coûts réels) et sa retenue s'ajoute à la retenue de garantie du
 * marché dans Juridique › Cautions. Règles dans lib/domain.js (SITUATION_STATUSES, situationAmounts).
 */
const { HttpError, isoDay, isoTime } = require('../lib/http');
const { SITUATION_STATUSES, situationAmounts } = require('../lib/domain');
const { notify, usersWith } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const money = n => `${Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const FINAL = ['validee', 'refusee'];

/** Marchés du chantier : contrats de sous-traitance rattachés au chantier, avec le cumul de leurs situations. */
async function markets(db, w) {
  const rows = await db('contracts as c').leftJoin('suppliers as s', 's.id', 'c.supplier_id')
    .where({ 'c.worksite_id': w.id, 'c.kind': 'sous_traitance' }).orderBy('c.reference')
    .select('c.id', 'c.reference', 'c.title', 'c.status', 'c.supplier_id', 's.name as supplier_name', 'c.counterparty', 'c.contract_amount', 'c.retention_pct', 'c.vat_rate', 'c.start_date', 'c.end_date');
  if (!rows.length) return [];
  const sits = await db('worksite_situations').whereIn('contract_id', rows.map(r => r.id)).orderBy('number');
  const invoiceIds = sits.map(s => s.purchase_invoice_id).filter(Boolean);
  const paid = invoiceIds.length ? await db('purchase_payments').whereIn('invoice_id', invoiceIds).groupBy('invoice_id').select('invoice_id').sum({ t: 'amount' }) : [];
  return rows.map(c => {
    const mine = sits.filter(s => s.contract_id === c.id);
    const valid = mine.filter(s => s.status === 'validee');
    const sum = k => valid.reduce((t, s) => t + Number(s[k]), 0);
    const cumul = valid.length ? Number(valid[valid.length - 1].cumulative_amount) : 0;
    const amount = c.contract_amount == null ? null : Number(c.contract_amount);
    const paidTotal = valid.reduce((t, s) => t + Number(paid.find(p => p.invoice_id === s.purchase_invoice_id)?.t || 0), 0);
    return {
      id: c.id, reference: c.reference, title: c.title, status: c.status, supplier_id: c.supplier_id, supplier_name: c.supplier_name || c.counterparty || null,
      contract_amount: amount, retention_pct: c.retention_pct == null ? 0 : Number(c.retention_pct), vat_rate: Number(c.vat_rate || 0),
      cumulative_amount: cumul, progress_pct: amount ? Math.round((cumul / amount) * 1000) / 10 : null,
      invoiced_ttc: sum('amount_ttc'), retention_amount: sum('retention_amount'), net_payable: sum('net_payable'), paid_fcfa: paidTotal,
      remaining_net: sum('net_payable') - paidTotal, pending: mine.filter(s => !FINAL.includes(s.status)).length,
      situations: mine.map(serialize),
    };
  });
}

function serialize(s) {
  return {
    id: s.id, contract_id: s.contract_id, number: s.number, period_end: isoDay(s.period_end), cumulative_pct: s.cumulative_pct == null ? null : Number(s.cumulative_pct),
    cumulative_amount: Number(s.cumulative_amount), previous_amount: Number(s.previous_amount), amount_ht: Number(s.amount_ht), vat_rate: Number(s.vat_rate),
    vat_amount: Number(s.vat_amount), amount_ttc: Number(s.amount_ttc), retention_pct: Number(s.retention_pct), retention_base: s.retention_base || 'ttc', retention_amount: Number(s.retention_amount),
    net_payable: Number(s.net_payable), status: s.status, status_label: SITUATION_STATUSES[s.status], note: s.note || null, refusal_reason: s.refusal_reason || null,
    purchase_invoice_id: s.purchase_invoice_id || null, verified_at: isoTime(s.verified_at), validated_at: isoTime(s.validated_at),
    file_url: s.file_filename ? `/api/admin/erp/chantiers/situations/${s.id}/fichier` : null,
  };
}

async function loadMarket(db, w, contractId) {
  const c = await db('contracts').where({ id: contractId }).first();
  if (!c || Number(c.worksite_id) !== Number(w.id) || c.kind !== 'sous_traitance') throw new HttpError(404, 'Marché de sous-traitance introuvable sur ce chantier.');
  return c;
}

async function loadSituation(db, w, id) {
  const s = await db('worksite_situations').where({ id, worksite_id: w.id }).first();
  if (!s) throw new HttpError(404, 'Situation introuvable.');
  return s;
}

/** Cumul HT des situations validées du marché (hors celle qu'on modifie). */
const previousOf = async (db, contractId, exceptId = 0) => {
  const last = await db('worksite_situations').where({ contract_id: contractId, status: 'validee' }).whereNot({ id: exceptId }).orderBy('number', 'desc').first('cumulative_amount');
  return last ? Number(last.cumulative_amount) : 0;
};

function amountsOrThrow(c, data, previous, retentionBase) {
  const a = situationAmounts({
    retentionBase,
    contractAmount: c.contract_amount == null ? null : Number(c.contract_amount), cumulativePct: data.cumulative_pct ?? null,
    cumulativeAmount: data.cumulative_amount ?? null, previousAmount: previous, vatRate: Number(c.vat_rate || 0), retentionPct: Number(c.retention_pct || 0),
  });
  if (a.error) throw new HttpError(400, a.error);
  return a;
}

/** Nouvelle situation (brouillon) : une seule en cours par marché ; le marché doit être actif et avoir son fournisseur. */
async function create(db, w, contractId, data, { file, userId }) {
  const c = await loadMarket(db, w, contractId);
  if (c.status !== 'actif') throw new HttpError(409, 'Marché clos : il ne reçoit plus de situation.');
  if (!c.supplier_id) throw new HttpError(400, 'Rattachez d’abord le sous-traitant au marché (fiche fournisseur de la Comptabilité) : il recevra la facture.');
  if (await db('worksite_situations').where({ contract_id: c.id }).whereIn('status', ['brouillon', 'verifiee']).first()) {
    throw new HttpError(409, 'Une situation de ce marché est déjà en cours : validez-la ou refusez-la d’abord.');
  }
  const previous = await previousOf(db, c.id);
  const base = (await require('./chantiers').settings(db)).chantier_retention_base;
  const a = amountsOrThrow(c, data, previous, base);
  const last = await db('worksite_situations').where({ contract_id: c.id }).max({ n: 'number' }).first();
  const [r] = await db('worksite_situations').insert({
    contract_id: c.id, worksite_id: w.id, number: Number(last?.n || 0) + 1, period_end: data.period_end, cumulative_pct: data.cumulative_pct ?? null,
    previous_amount: previous, vat_rate: Number(c.vat_rate || 0), retention_pct: Number(c.retention_pct || 0), retention_base: base, ...a, note: data.note || null, created_by: userId,
    ...(file ? { file_filename: file.filename, file_name: file.originalname.slice(0, 255), file_mime: file.mimetype } : {}),
  });
  return insertedId(r);
}

/** Modification d'un brouillon (montants recalculés). */
async function update(db, w, id, data, { file }) {
  const s = await loadSituation(db, w, id);
  if (s.status !== 'brouillon') throw new HttpError(409, 'Seule une situation en brouillon se modifie.');
  const c = await loadMarket(db, w, s.contract_id);
  const previous = await previousOf(db, c.id, s.id);
  const input = { cumulative_pct: data.cumulative_pct !== undefined ? data.cumulative_pct : s.cumulative_pct == null ? null : Number(s.cumulative_pct) };
  input.cumulative_amount = input.cumulative_pct == null ? (data.cumulative_amount ?? Number(s.cumulative_amount)) : null;
  // Une correction de brouillon reprend le réglage en vigueur
  const base = (await require('./chantiers').settings(db)).chantier_retention_base;
  const a = amountsOrThrow(c, input, previous, base);
  const row = { ...a, retention_base: base, cumulative_pct: input.cumulative_pct, previous_amount: previous, period_end: data.period_end || s.period_end, note: data.note !== undefined ? data.note : s.note, updated_at: new Date() };
  if (file) Object.assign(row, { file_filename: file.filename, file_name: file.originalname.slice(0, 255), file_mime: file.mimetype });
  await db('worksite_situations').where({ id }).update(row);
}

async function remove(db, w, id) {
  const s = await loadSituation(db, w, id);
  if (s.status !== 'brouillon') throw new HttpError(409, 'Seule une situation en brouillon se supprime.');
  await db('worksite_situations').where({ id }).del();
}

/** Vérification par le conducteur : la Direction est prévenue. */
async function verify(db, w, id, userId) {
  const s = await loadSituation(db, w, id);
  if (s.status !== 'brouillon') throw new HttpError(409, 'Cette situation n’est plus en brouillon.');
  await db('worksite_situations').where({ id }).update({ status: 'verifiee', verified_by: userId, verified_at: new Date(), updated_at: new Date() });
  const c = await db('contracts').where({ id: s.contract_id }).first('reference', 'title');
  await notify(db, {
    to: await usersWith(db, 'chantiers:direction'), module: 'chantiers', event: 'chantier.situation_verifiee', priority: 'action', except: userId,
    title: `Situation n° ${s.number} à valider — ${c.reference}`, body: `${c.title} · ${w.reference} — ${money(s.amount_ttc)} TTC, retenue ${money(s.retention_amount)}.`,
    link: `/chantiers/${w.id}?onglet=sous-traitants`, key: `situation:${id}:verifiee`,
  });
}

/**
 * Validation par la Direction : facture d'achat en brouillon (fournisseur du marché, compte de charge du marché sinon
 * du fournisseur, chantier et poste « sous-traitance ») et retenue cumulée reportée dans la retenue de garantie du marché.
 */
async function validate(db, w, id, userId) {
  const s = await loadSituation(db, w, id);
  if (s.status !== 'verifiee') throw new HttpError(409, 'La situation doit d’abord être vérifiée par le conducteur.');
  const c = await loadMarket(db, w, s.contract_id);
  const supplier = await db('suppliers').where({ id: c.supplier_id }).first();
  const accountId = c.expense_account_id || supplier?.expense_account_id;
  if (!accountId) throw new HttpError(400, 'Indiquez le compte de charge du marché (fiche contrat) ou du sous-traitant (fiche fournisseur) pour préparer la facture.');
  const ct = require('./compta');
  const previous = await previousOf(db, c.id, s.id);
  if (previous !== Number(s.previous_amount)) throw new HttpError(409, 'Une autre situation a été validée entre-temps : renvoyez celle-ci en brouillon pour recalculer.');
  await db.transaction(async trx => {
    const [inv] = await trx('purchase_invoices').insert({
      number: await ct.nextPurchaseNumber(trx, isoDay(s.period_end)), supplier_id: c.supplier_id, supplier_ref: `${c.reference} · situation n° ${s.number}`,
      date: isoDay(s.period_end), label: `Situation n° ${s.number} — ${c.title}`.slice(0, 255), project_id: w.project_id, worksite_id: w.id,
      worksite_category: 'sous_traitance', expense_account_id: accountId, amount_ht: Number(s.amount_ht), vat_rate: Number(s.vat_rate), vat_amount: Number(s.vat_amount), amount_ttc: Number(s.amount_ttc),
      status: 'brouillon', created_by: userId,
    });
    await trx('worksite_situations').where({ id }).update({ status: 'validee', validated_by: userId, validated_at: new Date(), purchase_invoice_id: insertedId(inv), updated_at: new Date() });
  });
  await syncRetention(db, w, c, userId);
  const accounting = await usersWith(db, 'achats:write');
  await notify(db, {
    to: accounting, module: 'compta', event: 'chantier.situation_validee', priority: 'action',
    title: `Situation à comptabiliser : ${c.reference} n° ${s.number}`,
    body: `${money(s.amount_ttc)} TTC, dont retenue de garantie ${money(s.retention_amount)} à conserver : net à payer ${money(s.net_payable)}.`,
    link: '/compta/achats', key: `situation:${id}:compta`,
  });
  if (s.created_by) await notify(db, { to: s.created_by, module: 'chantiers', event: 'chantier.situation_validee', except: userId, title: `Situation n° ${s.number} validée — ${c.reference}`, link: `/chantiers/${w.id}?onglet=sous-traitants`, key: `situation:${id}:validee` });
}

/** Renvoi en brouillon d'une situation vérifiée (correction avant validation). */
async function toDraft(db, w, id) {
  const s = await loadSituation(db, w, id);
  if (s.status !== 'verifiee') throw new HttpError(409, 'Seule une situation vérifiée se renvoie en brouillon.');
  await db('worksite_situations').where({ id }).update({ status: 'brouillon', verified_by: null, verified_at: null, updated_at: new Date() });
}

async function refuse(db, w, id, reason, userId) {
  const s = await loadSituation(db, w, id);
  if (FINAL.includes(s.status)) throw new HttpError(409, 'Cette situation est déjà close.');
  await db('worksite_situations').where({ id }).update({ status: 'refusee', refusal_reason: reason, validated_by: userId, validated_at: new Date(), updated_at: new Date() });
  if (s.created_by) {
    await notify(db, {
      to: s.created_by, module: 'chantiers', event: 'chantier.situation_refusee', priority: 'action', except: userId, title: `Situation n° ${s.number} refusée`,
      body: reason, link: `/chantiers/${w.id}?onglet=sous-traitants`, key: `situation:${id}:refusee`,
    });
  }
}

/** Retenue de garantie du marché (Juridique › Cautions) : somme des retenues des situations validées. */
async function syncRetention(db, w, c, userId) {
  const total = Number((await db('worksite_situations').where({ contract_id: c.id, status: 'validee' }).sum({ t: 'retention_amount' }).first()).t || 0);
  if (!total) return;
  const juridique = require('./juridique');
  const existing = await db('guarantees').where({ contract_id: c.id, direction: 'retenue', status: 'active' }).first();
  if (existing) {
    await db('guarantees').where({ id: existing.id }).update({ amount_fcfa: total, updated_at: new Date() });
    return;
  }
  const kind = await db('guarantee_kinds').where({ direction: 'retenue', active: true }).orderBy(['sort', 'id']).first('id');
  if (!kind) return; // aucune sorte « retenue » active : réglable dans Juridique › Réglages
  await juridique.createGuarantee(db, {
    kind_id: kind.id, contract_id: c.id, supplier_id: c.supplier_id, amount_fcfa: total, owner_id: w.manager_id || null,
    notes: `Retenues des situations du chantier ${w.reference} — ${w.name}. Libérée à la fin du délai de garantie compté depuis la réception.`,
  }, { userId });
}

/** Situations vérifiées en attente de la Direction (encart de la liste des chantiers). */
async function toValidate(db) {
  const rows = await db('worksite_situations as s').join('contracts as c', 'c.id', 's.contract_id').join('worksites as w', 'w.id', 's.worksite_id')
    .leftJoin('suppliers as f', 'f.id', 'c.supplier_id').where('s.status', 'verifiee').orderBy('s.verified_at')
    .select('s.*', 'c.reference as contract_reference', 'c.title as contract_title', 'f.name as supplier_name', 'w.reference as worksite_reference', 'w.name as worksite_name');
  return rows.map(r => ({ ...serialize(r), contract_reference: r.contract_reference, contract_title: r.contract_title, supplier_name: r.supplier_name, worksite_reference: r.worksite_reference, worksite_name: r.worksite_name }));
}

const filePath = s => {
  if (!s?.file_filename) throw new HttpError(404, 'Pas de fichier joint.');
  return require('./chantiersSuivi').filePath(s);
};

module.exports = { markets, create, update, remove, verify, toDraft, validate, refuse, toValidate, loadSituation, filePath, syncRetention };
