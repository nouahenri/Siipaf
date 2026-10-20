/**
 * ERP · Comptabilité : écritures (brouillon → validée, numérotation chronologique, intangibilité, contrepassation),
 * écritures automatiques tirées des données du dashboard et de l'ERP (versements, appels de fonds, ventes, achats),
 * états (journal, grand livre, balance, bilan, compte de résultat, TVA, marge par programme) et export Sage.
 */
const { HttpError, isoDay, json } = require('../lib/http');
const {
  DEFAULT_SETTINGS, METHOD_JOURNAL, checkEntry, splitVat, BALANCE_SHEET, INCOME_STATEMENT, sageDate,
} = require('../lib/compta');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const day = v => isoDay(v);

// ─── Réglages ───────────────────────────────────────────────
async function getSettings(db) {
  const row = await db('app_settings').where({ key: 'compta' }).first();
  const saved = json(row?.value, {}) || {};
  return { ...DEFAULT_SETTINGS, ...saved, accounts: { ...DEFAULT_SETTINGS.accounts, ...(saved.accounts || {}) }, sage: { ...DEFAULT_SETTINGS.sage, ...(saved.sage || {}) } };
}
async function saveSettings(db, patch) {
  const current = await getSettings(db);
  const next = { ...current, ...patch, accounts: { ...current.accounts, ...(patch.accounts || {}) }, sage: { ...current.sage, ...(patch.sage || {}) } };
  for (const code of Object.values(next.accounts)) {
    if (!(await db('acc_accounts').where({ code }).first())) throw new HttpError(400, `Compte ${code} absent du plan comptable.`);
  }
  const row = { key: 'compta', value: JSON.stringify(next), updated_at: new Date() };
  if (await db('app_settings').where({ key: 'compta' }).first()) await db('app_settings').where({ key: 'compta' }).update(row);
  else await db('app_settings').insert(row);
  return next;
}

// ─── Comptes, journaux, exercices ───────────────────────────
async function accountId(trx, code) {
  const a = await trx('acc_accounts').where({ code }).first('id', 'active');
  if (!a) throw new HttpError(400, `Compte ${code} absent du plan comptable.`);
  return a.id;
}

async function fiscalYearFor(trx, date) {
  return trx('acc_fiscal_years').where('start_date', '<=', date).where('end_date', '>=', date).orderBy('start_date', 'desc').first();
}

/** Une écriture ne peut être créée, modifiée ou validée que dans un exercice ouvert, après la date de verrouillage. */
function assertWritable(fy, date) {
  if (!fy) throw new HttpError(409, `Aucun exercice comptable ne couvre le ${date}. Créez-le dans « Paramètres ».`);
  if (fy.status === 'cloture') throw new HttpError(409, `L’exercice ${fy.label} est clôturé.`);
  if (fy.lock_date && date <= day(fy.lock_date)) throw new HttpError(409, `La période est verrouillée jusqu’au ${day(fy.lock_date)}.`);
}

// ─── Écritures ──────────────────────────────────────────────
/**
 * Crée une écriture (brouillon, ou validée si `validate`). `lines` : { account (code) | account_id, debit, credit,
 * partner_type, partner_id, label, project_id, lot_id }. `source_key` rend l'opération idempotente.
 */
async function createEntry(trx, { journal, date, label, ref = null, source = 'manuel', source_key = null, project_id = null, lines, userId = null, validate = false, reversal_of = null }) {
  const errors = checkEntry(lines);
  if (errors.length) throw new HttpError(400, errors.join(' '));
  const j = typeof journal === 'object' ? journal : await trx('acc_journals').where(Number.isInteger(journal) ? { id: journal } : { code: journal }).first();
  if (!j) throw new HttpError(400, 'Journal inconnu.');
  const fy = await fiscalYearFor(trx, date);
  assertWritable(fy, date);
  const [id] = await trx('acc_entries').insert({
    journal_id: j.id, fiscal_year_id: fy.id, date, label: String(label).slice(0, 255), ref, source, source_key, project_id, reversal_of, created_by: userId,
  });
  const entryId = insertedId(id);
  let sort = 0;
  for (const l of lines) {
    await trx('acc_lines').insert({
      entry_id: entryId, account_id: l.account_id || await accountId(trx, l.account), partner_type: l.partner_type || null, partner_id: l.partner_id || null,
      label: (l.label || label || '').slice(0, 255), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
      project_id: l.project_id ?? project_id ?? null, lot_id: l.lot_id || null, sort: sort++,
    });
  }
  if (validate) await validateEntry(trx, entryId, userId);
  return trx('acc_entries').where({ id: entryId }).first();
}

/** Validation : numéro chronologique définitif (journal-exercice-n°), l'écriture devient intangible. */
async function validateEntry(trx, entryId, userId) {
  const e = await trx('acc_entries').where({ id: entryId }).first();
  if (!e) throw new HttpError(404, 'Écriture introuvable.');
  if (e.status === 'valide') return e;
  const fy = await trx('acc_fiscal_years').where({ id: e.fiscal_year_id }).first();
  assertWritable(fy, day(e.date));
  const lines = await trx('acc_lines').where({ entry_id: e.id });
  const errors = checkEntry(lines.map(l => ({ debit: Number(l.debit), credit: Number(l.credit) })));
  if (errors.length) throw new HttpError(400, errors.join(' '));
  const j = await trx('acc_journals').where({ id: e.journal_id }).first();
  const prefix = `${j.code}-${fy.label}-`;
  const last = await trx('acc_entries').where('number', 'like', `${prefix}%`).orderBy('number', 'desc').first('number');
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  await trx('acc_entries').where({ id: e.id }).update({ status: 'valide', number: `${prefix}${String(n).padStart(5, '0')}`, validated_by: userId, validated_at: new Date(), updated_at: new Date() });
  return trx('acc_entries').where({ id: e.id }).first();
}

/** Remplace les lignes d'un brouillon. Une écriture validée ne se modifie pas : on la contrepasse. */
async function updateDraft(trx, entryId, data) {
  const e = await trx('acc_entries').where({ id: entryId }).first();
  if (!e) throw new HttpError(404, 'Écriture introuvable.');
  if (e.status === 'valide') throw new HttpError(409, 'Écriture validée : elle ne peut plus être modifiée. Contrepassez-la.');
  const date = data.date || day(e.date);
  const fy = await fiscalYearFor(trx, date);
  assertWritable(fy, date);
  if (data.lines) {
    const errors = checkEntry(data.lines);
    if (errors.length) throw new HttpError(400, errors.join(' '));
    await trx('acc_lines').where({ entry_id: e.id }).del();
    let sort = 0;
    for (const l of data.lines) {
      await trx('acc_lines').insert({
        entry_id: e.id, account_id: l.account_id || await accountId(trx, l.account), partner_type: l.partner_type || null, partner_id: l.partner_id || null,
        label: (l.label || data.label || e.label).slice(0, 255), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
        project_id: l.project_id ?? null, lot_id: l.lot_id || null, sort: sort++,
      });
    }
  }
  const patch = { updated_at: new Date(), fiscal_year_id: fy.id };
  for (const k of ['date', 'label', 'ref', 'project_id']) if (data[k] !== undefined) patch[k] = data[k];
  if (data.journal_id) patch.journal_id = data.journal_id;
  await trx('acc_entries').where({ id: e.id }).update(patch);
  return trx('acc_entries').where({ id: e.id }).first();
}

async function deleteDraft(trx, entryId) {
  const e = await trx('acc_entries').where({ id: entryId }).first();
  if (!e) throw new HttpError(404, 'Écriture introuvable.');
  if (e.status === 'valide') throw new HttpError(409, 'Une écriture validée ne se supprime pas : contrepassez-la.');
  await trx('acc_entries').where({ id: e.id }).del();
}

/** Contrepassation : écriture inverse (débit ↔ crédit) liée à l'origine, à la date choisie. */
async function reverseEntry(trx, entryId, { date, userId, validate = false }) {
  const e = await trx('acc_entries').where({ id: entryId }).first();
  if (!e) throw new HttpError(404, 'Écriture introuvable.');
  if (e.status !== 'valide') throw new HttpError(409, 'Seule une écriture validée se contrepasse ; un brouillon se modifie ou se supprime.');
  if (await trx('acc_entries').where({ reversal_of: e.id }).first()) throw new HttpError(409, 'Cette écriture a déjà été contrepassée.');
  const lines = await trx('acc_lines').where({ entry_id: e.id }).orderBy('sort');
  return createEntry(trx, {
    journal: e.journal_id, date: date || day(new Date()), label: `Contrepassation ${e.number} — ${e.label}`.slice(0, 255), ref: e.number,
    source: 'contrepassation', source_key: e.source_key ? `reverse:${e.source_key}` : null, project_id: e.project_id, reversal_of: e.id, userId, validate,
    lines: lines.map(l => ({ account_id: l.account_id, partner_type: l.partner_type, partner_id: l.partner_id, label: l.label, debit: Number(l.credit), credit: Number(l.debit), project_id: l.project_id, lot_id: l.lot_id })),
  });
}

/** Écriture avec ses lignes (comptes, tiers, programmes). */
async function entryDetail(db, entryId) {
  const e = await db('acc_entries as e').join('acc_journals as j', 'j.id', 'e.journal_id').leftJoin('users as u', 'u.id', 'e.validated_by')
    .where('e.id', entryId).first('e.*', 'j.code as journal_code', 'j.label as journal_label', 'u.name as validated_by_name');
  if (!e) throw new HttpError(404, 'Écriture introuvable.');
  const lines = await db('acc_lines as l').join('acc_accounts as a', 'a.id', 'l.account_id').leftJoin('projects as p', 'p.id', 'l.project_id')
    .where('l.entry_id', e.id).orderBy('l.sort').select('l.*', 'a.code as account_code', 'a.label as account_label', 'p.name as project_name');
  const names = await partnerNames(db, lines);
  const reversed = await db('acc_entries').where({ reversal_of: e.id }).first('id', 'number');
  return {
    ...e, date: day(e.date), reversed_by: reversed || null,
    lines: lines.map(l => ({ ...l, debit: Number(l.debit), credit: Number(l.credit), partner_name: names[`${l.partner_type}:${l.partner_id}`] || null })),
  };
}

async function partnerNames(db, lines) {
  const ids = kind => [...new Set(lines.filter(l => l.partner_type === kind && l.partner_id).map(l => l.partner_id))];
  const [clients, suppliers] = await Promise.all([
    ids('client').length ? db('leads').whereIn('id', ids('client')).select('id', 'name', 'client_code') : [],
    ids('fournisseur').length ? db('suppliers').whereIn('id', ids('fournisseur')).select('id', 'name') : [],
  ]);
  return {
    ...Object.fromEntries(clients.map(c => [`client:${c.id}`, `${c.name}${c.client_code ? ` (${c.client_code})` : ''}`])),
    ...Object.fromEntries(suppliers.map(s => [`fournisseur:${s.id}`, s.name])),
  };
}

// ─── Écritures automatiques (données du dashboard et de l'ERP) ─────────────────
const saleLabel = s => `${s.client_name} — ${s.project_name}, lot ${s.lot_code}`;
const saleAccount = (settings, s) => (s.lot_type === 'parcelle' || s.project_category === 'lotissement' ? settings.accounts.sale_land : settings.accounts.sale_housing);

/** Lignes « vente constatée » : client (ou avances) au débit, produit HT et TVA au crédit. */
function revenueLines(settings, s, ttc, debits) {
  const { ht, vat } = splitVat(ttc, settings.vat_sales_rate);
  const common = { partner_type: 'client', partner_id: s.lead_id, project_id: s.project_id, lot_id: s.lot_id };
  const lines = debits.filter(d => d.amount > 0).map(d => ({ account: d.account, debit: d.amount, ...common }));
  lines.push({ account: saleAccount(settings, s), credit: ht, project_id: s.project_id, lot_id: s.lot_id });
  if (vat) lines.push({ account: settings.accounts.vat_collected, credit: vat, project_id: s.project_id, lot_id: s.lot_id });
  return lines;
}

/**
 * Synchronise la comptabilité avec les opérations commerciales : une écriture par versement, par appel de fonds
 * émis (VEFA à l'avancement) et par vente constatée (acte ou livraison). Les opérations hors exercice ouvert sont
 * ignorées (comptées), un versement supprimé fait disparaître son brouillon ou contrepasse son écriture validée.
 */
async function syncAutoEntries(db, userId = null) {
  const settings = await getSettings(db);
  const stats = { created: 0, skipped: 0, reversed: 0, removed: 0, errors: [] };
  const years = await db('acc_fiscal_years').where({ status: 'ouvert' });
  if (!years.length) return { ...stats, no_fiscal_year: true };
  const inOpenYear = date => years.some(y => date >= day(y.start_date) && date <= day(y.end_date) && !(y.lock_date && date <= day(y.lock_date)));
  const has = new Set((await db('acc_entries').whereNotNull('source_key').pluck('source_key')));
  const sales = await db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id').join('leads as ld', 'ld.id', 's.lead_id')
    .select('s.*', 'l.code as lot_code', 'l.lot_type', 'l.project_id', 'p.name as project_name', 'p.category as project_category', 'ld.name as client_name');
  const saleBy = Object.fromEntries(sales.map(s => [s.id, s]));
  const validate = !!settings.auto_validate;
  const make = async (key, entry) => {
    if (has.has(key)) return;
    if (!inOpenYear(entry.date)) { stats.skipped++; return; }
    try {
      await db.transaction(trx => createEntry(trx, { ...entry, source_key: key, userId, validate }));
      has.add(key); stats.created++;
    } catch (e) { stats.errors.push(`${key} : ${e.message}`); }
  };

  // 1. Ventes constatées : acte définitif (échéancier) ou livraison (VEFA en mode « livraison »)
  const recognized = {};
  for (const s of sales) {
    if (s.status === 'desiste') continue;
    const mode = s.vefa ? settings.revenue_vefa : settings.revenue_echeancier;
    const at = s.vefa ? (mode === 'livraison' ? day(s.delivered_at) : null) : (mode === 'acte' ? day(s.signed_at) : null);
    if (!at) continue;
    recognized[s.id] = at;
    const paidBefore = (await db('payments').where({ sale_id: s.id }).select('amount_fcfa', 'paid_at'))
      .filter(p => day(p.paid_at) <= at).reduce((t, p) => t + Number(p.amount_fcfa), 0);
    const price = Number(s.price_fcfa);
    const advance = Math.min(paidBefore, price);
    await make(`sale_revenue:${s.id}`, {
      journal: 'VT', date: at, label: `Vente constatée — ${saleLabel(s)}`, ref: s.client_code || null, source: 'vente', project_id: s.project_id,
      lines: revenueLines(settings, s, price, [{ account: settings.accounts.client_advance, amount: advance }, { account: settings.accounts.client, amount: price - advance }]),
    });
  }

  // 2. Appels de fonds émis (VEFA à l'avancement) : facture client
  if (settings.revenue_vefa === 'avancement') {
    const calls = await db('fund_calls').where({ status: 'appele' }).select('*');
    for (const c of calls) {
      const s = saleBy[c.sale_id];
      if (!s || s.status === 'desiste') continue;
      await make(`fund_call:${c.id}`, {
        journal: 'VT', date: day(c.called_at), label: `Appel de fonds « ${c.label} » (${Number(c.pct)} %) — ${saleLabel(s)}`, ref: s.client_code || null, source: 'appel_fonds', project_id: s.project_id,
        lines: revenueLines(settings, s, Number(c.amount_fcfa), [{ account: settings.accounts.client, amount: Number(c.amount_fcfa) }]),
      });
    }
  }

  // 3. Versements des clients (saisis par le comptable dans le dashboard ou l'ERP)
  const journals = Object.fromEntries((await db('acc_journals as j').leftJoin('acc_accounts as a', 'a.id', 'j.account_id').select('j.*', 'a.code as account_code')).map(j => [j.code, j]));
  const payments = await db('payments').select('*');
  for (const p of payments) {
    const s = saleBy[p.sale_id];
    if (!s) continue;
    const date = day(p.paid_at);
    const j = journals[METHOD_JOURNAL[p.method] || 'BQ'];
    if (!j?.account_code) { stats.errors.push(`payment:${p.id} : le journal ${METHOD_JOURNAL[p.method]} n’a pas de compte de trésorerie.`); continue; }
    const amount = Number(p.amount_fcfa);
    const common = { partner_type: 'client', partner_id: s.lead_id, project_id: s.project_id, lot_id: s.lot_id };
    let lines;
    if (!s.vefa && settings.revenue_echeancier === 'encaissement') {
      // La vente est constatée au fil des encaissements : trésorerie / produit HT et TVA
      lines = [{ account: j.account_code, debit: amount, project_id: s.project_id }, ...revenueLines(settings, s, amount, [])];
    } else {
      const invoiced = s.vefa ? settings.revenue_vefa === 'avancement' || (recognized[s.id] && date >= recognized[s.id]) : recognized[s.id] && date >= recognized[s.id];
      lines = [{ account: j.account_code, debit: amount, project_id: s.project_id }, { account: invoiced ? settings.accounts.client : settings.accounts.client_advance, credit: amount, ...common }];
    }
    await make(`payment:${p.id}`, {
      journal: j, date, label: `Versement ${p.method === 'mobile_money' ? 'Mobile Money' : p.method} — ${saleLabel(s)}`, ref: p.reference || null, source: 'versement', project_id: s.project_id, lines,
    });
  }

  // 4. Versement supprimé dans le dashboard : brouillon effacé, écriture validée contrepassée
  const paymentIds = new Set(payments.map(p => `payment:${p.id}`));
  const orphans = await db('acc_entries').where({ source: 'versement' }).whereNotNull('source_key');
  for (const e of orphans) {
    if (paymentIds.has(e.source_key)) continue;
    if (e.status !== 'valide') { await db('acc_entries').where({ id: e.id }).del(); stats.removed++; continue; }
    if (has.has(`reverse:${e.source_key}`)) continue;
    try { await db.transaction(trx => reverseEntry(trx, e.id, { date: day(new Date()), userId })); stats.reversed++; } catch (err) { stats.errors.push(`${e.source_key} : ${err.message}`); }
  }
  return stats;
}

// ─── Achats ─────────────────────────────────────────────────
async function nextPurchaseNumber(trx, date) {
  const prefix = `ACH-${date.slice(0, 4)}-`;
  const last = await trx('purchase_invoices').where('number', 'like', `${prefix}%`).orderBy('number', 'desc').first('number');
  return `${prefix}${String(last ? Number(last.number.slice(prefix.length)) + 1 : 1).padStart(4, '0')}`;
}

/** Validation d'une facture d'achat : écriture AC (charge HT par programme + TVA récupérable / fournisseur TTC). */
async function validatePurchase(db, invoiceId, userId) {
  const settings = await getSettings(db);
  return db.transaction(async trx => {
    const inv = await trx('purchase_invoices as i').join('suppliers as s', 's.id', 'i.supplier_id').where('i.id', invoiceId).first('i.*', 's.name as supplier_name');
    if (!inv) throw new HttpError(404, 'Facture introuvable.');
    if (inv.status !== 'brouillon') throw new HttpError(409, 'Facture déjà validée.');
    const date = day(inv.date);
    const lines = [{ account_id: inv.expense_account_id, debit: Number(inv.amount_ht), project_id: inv.project_id }];
    if (Number(inv.vat_amount)) lines.push({ account: settings.accounts.vat_deductible, debit: Number(inv.vat_amount), project_id: inv.project_id });
    lines.push({ account: settings.accounts.supplier, credit: Number(inv.amount_ttc), partner_type: 'fournisseur', partner_id: inv.supplier_id, project_id: inv.project_id });
    await createEntry(trx, {
      journal: 'AC', date, label: `${inv.supplier_name} — ${inv.label}`, ref: inv.supplier_ref || inv.number, source: 'achat', source_key: `purchase:${inv.id}`,
      project_id: inv.project_id, lines, userId, validate: !!settings.auto_validate,
    });
    await trx('purchase_invoices').where({ id: inv.id }).update({ status: 'validee', updated_at: new Date() });
    return trx('purchase_invoices').where({ id: inv.id }).first();
  });
}

/** Règlement fournisseur : écriture de trésorerie (fournisseur / banque, caisse ou Mobile Money). */
async function payPurchase(db, invoiceId, { date, amount, journal_id, reference }, userId) {
  const settings = await getSettings(db);
  return db.transaction(async trx => {
    const inv = await trx('purchase_invoices as i').join('suppliers as s', 's.id', 'i.supplier_id').where('i.id', invoiceId).first('i.*', 's.name as supplier_name');
    if (!inv) throw new HttpError(404, 'Facture introuvable.');
    if (inv.status !== 'validee') throw new HttpError(409, 'Validez la facture avant de la régler.');
    const [{ paid }] = await trx('purchase_payments').where({ invoice_id: inv.id }).sum({ paid: 'amount' });
    const rest = Number(inv.amount_ttc) - (Number(paid) || 0);
    if (amount > rest) throw new HttpError(400, `Le règlement dépasse le reste à payer (${rest.toLocaleString('fr-FR')} FCFA).`);
    const j = await trx('acc_journals as j').join('acc_accounts as a', 'a.id', 'j.account_id').where('j.id', journal_id).first('j.*', 'a.code as account_code');
    if (!j || !['banque', 'caisse', 'mobile'].includes(j.kind)) throw new HttpError(400, 'Choisissez un journal de trésorerie (banque, caisse, Mobile Money).');
    const [pid] = await trx('purchase_payments').insert({ invoice_id: inv.id, date, amount, journal_id, reference: reference || null, created_by: userId });
    await createEntry(trx, {
      journal: j, date, label: `Règlement ${inv.supplier_name} — ${inv.label}`, ref: reference || inv.number, source: 'reglement', source_key: `purchase_payment:${insertedId(pid)}`,
      project_id: inv.project_id, userId, validate: !!settings.auto_validate,
      lines: [
        { account: settings.accounts.supplier, debit: amount, partner_type: 'fournisseur', partner_id: inv.supplier_id, project_id: inv.project_id },
        { account: j.account_code, credit: amount, project_id: inv.project_id },
      ],
    });
    return { paid_fcfa: (Number(paid) || 0) + amount, remaining_fcfa: rest - amount };
  });
}

// ─── États ──────────────────────────────────────────────────
/** Lignes d'écritures d'une période (validées seulement, ou brouillons compris). */
function linesQuery(db, { from, to, includeDraft = false, fiscalYearId = null }) {
  const q = db('acc_lines as l').join('acc_entries as e', 'e.id', 'l.entry_id').join('acc_accounts as a', 'a.id', 'l.account_id');
  if (!includeDraft) q.where('e.status', 'valide');
  if (fiscalYearId) q.where('e.fiscal_year_id', fiscalYearId);
  if (from) q.where('e.date', '>=', from);
  if (to) q.where('e.date', '<=', to);
  return q;
}

/** Balance : total débit, crédit et solde par compte. */
async function trialBalance(db, opts) {
  const rows = await linesQuery(db, opts).groupBy('a.id', 'a.code', 'a.label', 'a.class')
    .select('a.code', 'a.label', 'a.class').sum({ debit: 'l.debit' }).sum({ credit: 'l.credit' }).orderBy('a.code');
  return rows.map(r => {
    const debit = Number(r.debit) || 0, credit = Number(r.credit) || 0;
    return { code: r.code, label: r.label, class: r.class, debit, credit, balance: debit - credit };
  }).filter(r => r.debit || r.credit);
}

/** Grand livre d'un compte (ou d'une racine) avec solde progressif ; report des mouvements antérieurs de l'exercice. */
async function generalLedger(db, { account, from, to, includeDraft, fiscalYearId }) {
  const base = () => linesQuery(db, { includeDraft, fiscalYearId }).where('a.code', 'like', `${account}%`);
  const [prior] = from ? await base().where('e.date', '<', from).sum({ d: 'l.debit' }).sum({ c: 'l.credit' }) : [{ d: 0, c: 0 }];
  const q = base().leftJoin('acc_journals as j', 'j.id', 'e.journal_id').leftJoin('projects as p', 'p.id', 'l.project_id');
  if (from) q.where('e.date', '>=', from);
  if (to) q.where('e.date', '<=', to);
  const rows = await q.select('l.*', 'e.date', 'e.number', 'e.status', 'e.label as entry_label', 'e.id as entry_id', 'j.code as journal_code', 'a.code as account_code', 'p.name as project_name')
    .orderBy([{ column: 'e.date' }, { column: 'e.id' }, { column: 'l.sort' }]).limit(5000);
  const names = await partnerNames(db, rows);
  let running = (Number(prior.d) || 0) - (Number(prior.c) || 0);
  const opening = running;
  return {
    opening,
    lines: rows.map(r => {
      running += Number(r.debit) - Number(r.credit);
      return {
        id: r.id, entry_id: r.entry_id, date: day(r.date), number: r.number, status: r.status, journal_code: r.journal_code, account_code: r.account_code,
        label: r.label || r.entry_label, partner_name: names[`${r.partner_type}:${r.partner_id}`] || null, project_name: r.project_name,
        debit: Number(r.debit), credit: Number(r.credit), balance: running,
      };
    }),
    closing: running,
  };
}

const sumPrefixes = (balance, prefixes, side) => balance
  .filter(b => prefixes.some(p => b.code.startsWith(p)))
  .reduce((t, b) => t + (side === 'debit' ? Math.max(0, b.balance) : side === 'credit' ? Math.max(0, -b.balance) : b.balance), 0);

/** Compte de résultat et bilan simplifiés (regroupements SYSCOHADA à faire valider). */
async function financialStatements(db, opts) {
  const tb = await trialBalance(db, opts);
  const income = INCOME_STATEMENT.map(g => {
    const raw = sumPrefixes(tb, g.prefixes);
    // Produits (sign 1) : solde créditeur, affiché positif ; charges (sign -1) : solde débiteur, affiché positif
    return { key: g.key, label: g.label, sign: g.sign, value: g.sign === 1 ? -raw : raw };
  });
  const result = -tb.filter(b => b.class >= 6 && b.class <= 8).reduce((t, b) => t + b.balance, 0);
  const actif = BALANCE_SHEET.actif.map(g => ({ key: g.key, label: g.label, value: g.side ? sumPrefixes(tb, g.prefixes, g.side) : sumPrefixes(tb, g.prefixes) }));
  const passif = BALANCE_SHEET.passif.map(g => ({ key: g.key, label: g.label, value: g.side ? sumPrefixes(tb, g.prefixes, g.side) : -sumPrefixes(tb, g.prefixes) }));
  passif.push({ key: 'resultat', label: 'Résultat de l’exercice (en cours)', value: result });
  return {
    income, result,
    revenue: -sumPrefixes(tb, ['70']),
    actif, passif,
    total_actif: actif.reduce((t, g) => t + g.value, 0), total_passif: passif.reduce((t, g) => t + g.value, 0),
  };
}

/** TVA par mois : collectée (443) et récupérable (445), à payer ou crédit. */
async function vatReport(db, opts) {
  const rows = await linesQuery(db, opts).where(q => q.where('a.code', 'like', '443%').orWhere('a.code', 'like', '445%')).select('a.code', 'e.date', 'l.debit', 'l.credit');
  const months = {};
  for (const r of rows) {
    const m = day(r.date).slice(0, 7);
    months[m] ||= { month: m, collected: 0, deductible: 0 };
    if (r.code.startsWith('443')) months[m].collected += Number(r.credit) - Number(r.debit);
    else months[m].deductible += Number(r.debit) - Number(r.credit);
  }
  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({ ...m, due: m.collected - m.deductible }));
}

/** Marge par programme (comptabilité analytique) : produits (classe 7) et charges (classe 6) affectés au projet. */
async function projectMargins(db, opts) {
  const rows = await linesQuery(db, opts).leftJoin('projects as p', 'p.id', 'l.project_id').whereIn('a.class', [6, 7])
    .groupBy('l.project_id', 'p.name', 'a.class').select('l.project_id', 'p.name', 'a.class').sum({ d: 'l.debit' }).sum({ c: 'l.credit' });
  const by = {};
  for (const r of rows) {
    const k = r.project_id || 0;
    by[k] ||= { project_id: r.project_id, name: r.name || 'Non affecté (frais généraux)', produits: 0, charges: 0 };
    if (r.class === 7) by[k].produits += Number(r.c) - Number(r.d);
    else by[k].charges += Number(r.d) - Number(r.c);
  }
  return Object.values(by).map(p => ({ ...p, marge: p.produits - p.charges, taux: p.produits ? Math.round(((p.produits - p.charges) / p.produits) * 1000) / 10 : null }))
    .sort((a, b) => b.produits - a.produits);
}

/** Soldes par tiers (clients ou fournisseurs). */
async function partnerBalances(db, kind, opts) {
  const rows = await linesQuery(db, opts).where('l.partner_type', kind).groupBy('l.partner_id').select('l.partner_id').sum({ d: 'l.debit' }).sum({ c: 'l.credit' });
  const names = await partnerNames(db, rows.map(r => ({ partner_type: kind, partner_id: r.partner_id })));
  return rows.map(r => ({ partner_id: r.partner_id, name: names[`${kind}:${r.partner_id}`] || `#${r.partner_id}`, debit: Number(r.d), credit: Number(r.c), balance: Number(r.d) - Number(r.c) }))
    .filter(r => r.balance).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

/** Soldes des comptes de trésorerie (journaux banque, caisse, Mobile Money). */
async function treasury(db, opts) {
  const journals = await db('acc_journals as j').join('acc_accounts as a', 'a.id', 'j.account_id').whereIn('j.kind', ['banque', 'caisse', 'mobile']).where('j.active', true)
    .select('j.id', 'j.code', 'j.label', 'j.kind', 'a.code as account_code');
  const out = [];
  for (const j of journals) {
    const [all] = await linesQuery(db, opts).where('a.code', j.account_code).sum({ d: 'l.debit' }).sum({ c: 'l.credit' });
    out.push({ ...j, balance: (Number(all.d) || 0) - (Number(all.c) || 0) });
  }
  return out;
}

/** Export pour Sage (format paramétrable) : une ligne par ligne d'écriture validée. */
async function sageExport(db, { from, to }) {
  const settings = await getSettings(db);
  const { separator: sep, date_format: fmt, decimal, header } = settings.sage;
  const rows = await linesQuery(db, { from, to }).join('acc_journals as j', 'j.id', 'e.journal_id')
    .select('l.*', 'e.date', 'e.number', 'e.label as entry_label', 'e.ref', 'j.code as journal_code', 'a.code as account_code')
    .orderBy([{ column: 'e.date' }, { column: 'e.number' }, { column: 'l.sort' }]);
  const [clients, suppliers] = await Promise.all([
    db('leads').whereNotNull('client_code').select('id', 'client_code'),
    db('suppliers').select('id'),
  ]);
  const clientCode = Object.fromEntries(clients.map(c => [c.id, c.client_code]));
  const tiers = l => (l.partner_type === 'client' ? clientCode[l.partner_id] || `C${l.partner_id}` : l.partner_type === 'fournisseur' ? `F${String(l.partner_id).padStart(5, '0')}` : '');
  const cell = v => { const s = v == null ? '' : String(v); return /[";\n,]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s; };
  const money = n => (n ? String(n).replace('.', decimal) : '');
  const lines = rows.map(l => [l.journal_code, sageDate(day(l.date), fmt), l.number, l.account_code, tiers(l), (l.label || l.entry_label).slice(0, 69), money(Number(l.debit)), money(Number(l.credit)), l.ref || ''].map(cell).join(sep));
  const head = ['Journal', 'Date', 'Piece', 'Compte general', 'Compte tiers', 'Libelle', 'Debit', 'Credit', 'Reference'].join(sep);
  return { count: rows.length, csv: `﻿${header ? `${head}\n` : ''}${lines.join('\n')}\n` };
}

/** Génère les à-nouveaux de l'exercice suivant : soldes des classes 1 à 5, résultat en 131 / 139. */
async function openingFromPrevious(db, { fromYearId, toYearId, userId }) {
  const [from, to] = await Promise.all([db('acc_fiscal_years').where({ id: fromYearId }).first(), db('acc_fiscal_years').where({ id: toYearId }).first()]);
  if (!from || !to) throw new HttpError(404, 'Exercice introuvable.');
  if (await db('acc_entries').where({ source_key: `opening:${to.id}` }).first()) throw new HttpError(409, 'Les à-nouveaux de cet exercice existent déjà.');
  const tb = await trialBalance(db, { fiscalYearId: from.id });
  const lines = tb.filter(b => b.class <= 5 && b.balance).map(b => ({ account: b.code, debit: b.balance > 0 ? b.balance : 0, credit: b.balance < 0 ? -b.balance : 0, label: `À-nouveau ${b.code}` }));
  const result = -tb.filter(b => b.class >= 6 && b.class <= 8).reduce((t, b) => t + b.balance, 0);
  if (result) lines.push(result > 0 ? { account: '131', credit: result, label: 'Résultat de l’exercice précédent (bénéfice)' } : { account: '139', debit: -result, label: 'Résultat de l’exercice précédent (perte)' });
  return db.transaction(trx => createEntry(trx, {
    journal: 'AN', date: day(to.start_date), label: `À-nouveaux ${to.label} (reprise de ${from.label})`, source: 'an', source_key: `opening:${to.id}`, lines, userId,
  }));
}

module.exports = {
  getSettings, saveSettings, fiscalYearFor, assertWritable, createEntry, validateEntry, updateDraft, deleteDraft, reverseEntry, entryDetail,
  syncAutoEntries, nextPurchaseNumber, validatePurchase, payPurchase,
  trialBalance, generalLedger, financialStatements, vatReport, projectMargins, partnerBalances, treasury, sageExport, openingFromPrevious, linesQuery,
};
