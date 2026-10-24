/**
 * Parc auto et matériel ↔ Comptabilité (choix du client du 23/10). Chaque dépense saisie dans le Parc part aussitôt
 * en comptabilité : facture d'achat en brouillon (fournisseur), écriture de trésorerie en brouillon (espèces, Mobile
 * Money) ou consommation d'une carte carburant prépayée ; une avance de l'employé passe par sa note de frais. Une
 * seule validation : celle du comptable. Registre des immobilisations (amortissement linéaire au prorata, dotations
 * à la clôture, sortie de l'actif) et échéances administratives à prévoir en trésorerie.
 */
const { HttpError, isoDay, isoTime } = require('../lib/http');
const {
  ASSET_KINDS, ASSET_COST_KINDS, ASSET_PAYMENT_MODES, COST_ACCOUNTING_STATUSES, costAccountingStatus, depreciationAt, depreciationFor, addDays, daysBetween,
} = require('../lib/domain');
const { splitVat } = require('../lib/compta');
const ct = require('./compta');
const { notify, usersWith, resolve } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const today = () => new Date().toISOString().slice(0, 10);
const fr = d => (d ? d.split('-').reverse().join('/') : '');
const money = n => `${Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;

/** Compte de charge d'une nature de dépense (Comptabilité › Paramètres › comptes du parc). */
const costAccount = (settings, kind) => settings.accounts[`parc_${kind}`] || settings.accounts.parc_autre || settings.accounts.expense_default;
const fixedAccount = (settings, kind) => settings.accounts[`immo_${kind}`] || settings.accounts.immo_autre;

// ─── Dépenses ───────────────────────────────────────────────

/** Dépenses avec l'état de leur pièce comptable (facture ou écriture). */
const costQuery = db => db('asset_costs as c').join('assets as a', 'a.id', 'c.asset_id')
  .leftJoin('purchase_invoices as i', 'i.id', 'c.purchase_invoice_id').leftJoin('acc_entries as e', 'e.id', 'c.entry_id')
  .leftJoin('projects as p', 'p.id', 'c.project_id').leftJoin('worksites as w', 'w.id', 'c.worksite_id').leftJoin('places as pl', 'pl.id', 'c.place_id').leftJoin('suppliers as s', 's.id', 'c.supplier_id')
  .leftJoin('fuel_cards as f', 'f.id', 'c.fuel_card_id').leftJoin('employees as m', 'm.id', 'c.employee_id').leftJoin('users as u', 'u.id', 'c.created_by')
  .select('c.*', 'a.code as asset_code', 'a.name as asset_name', 'a.plate as asset_plate', 'i.number as invoice_number', 'i.status as invoice_status',
    'e.number as entry_number', 'e.status as entry_status', 'p.name as project_name', 'w.reference as worksite_reference', 'w.name as worksite_name', 'pl.name as place_name', 's.name as supplier_name', 'f.label as card_label',
    'm.last_name as employee_last_name', 'm.first_name as employee_first_name', 'u.name as created_by_name');

function serializeCost(c) {
  const doc_status = c.accounting === 'facture' ? c.invoice_status || null : c.accounting === 'ecriture' ? c.entry_status || null : null;
  const status = costAccountingStatus({ ...c, doc_status });
  return {
    id: c.id, asset_id: c.asset_id, asset_code: c.asset_code, asset_name: c.asset_name, asset_plate: c.asset_plate, kind: c.kind, kind_label: ASSET_COST_KINDS[c.kind] || c.kind,
    date: isoDay(c.date), amount: Number(c.amount), label: c.label, liters: c.liters == null ? null : Number(c.liters), meter_value: c.meter_value == null ? null : Number(c.meter_value),
    project_id: c.project_id, project_name: c.project_name, worksite_id: c.worksite_id || null, worksite_label: c.worksite_reference ? `${c.worksite_reference} — ${c.worksite_name}` : null, place_id: c.place_id || null, place_name: c.place_name || null, plan_id: c.plan_id,
    payment_mode: c.payment_mode, payment_label: ASSET_PAYMENT_MODES[c.payment_mode]?.label || null, accounting: c.accounting,
    supplier_id: c.supplier_id, supplier_name: c.supplier_name, vat_rate: Number(c.vat_rate || 0), fuel_card_id: c.fuel_card_id, card_label: c.card_label,
    employee_id: c.employee_id, employee_name: c.employee_last_name ? `${c.employee_last_name} ${c.employee_first_name || ''}`.trim() : null,
    purchase_invoice_id: c.purchase_invoice_id, invoice_number: c.invoice_number, entry_id: c.entry_id, entry_number: c.entry_number,
    status, status_label: status ? COST_ACCOUNTING_STATUSES[status] : 'Hors comptabilité (saisie antérieure)',
    rejected_at: isoTime(c.rejected_at), reject_reason: c.reject_reason, created_by_name: c.created_by_name,
  };
}

async function loadCost(db, id) {
  const c = await costQuery(db).where('c.id', id).first();
  if (!c) throw new HttpError(404, 'Dépense introuvable.');
  return c;
}

/** Solde d'une carte carburant : recharges moins pleins non rejetés. */
async function cardBalance(db, cardId) {
  const [{ loaded }] = await db('fuel_card_loads').where({ card_id: cardId }).sum({ loaded: 'amount' });
  const [{ used }] = await db('asset_costs').where({ fuel_card_id: cardId }).whereNull('rejected_at').sum({ used: 'amount' });
  return Number(loaded || 0) - Number(used || 0);
}

/**
 * Contrôles d'une nouvelle dépense selon son paiement (avant toute écriture) : fournisseur, carte et son solde,
 * employé (par défaut, le détenteur du bien).
 */
async function checkPayment(db, asset, data) {
  const mode = ASSET_PAYMENT_MODES[data.payment_mode];
  if (!mode) throw new HttpError(400, 'Indiquez comment la dépense a été payée.');
  if (data.purchase_invoice_id) return { ...data, accounting: 'facture' }; // rattachée à une facture déjà saisie en Comptabilité
  if (data.payment_mode === 'fournisseur') {
    if (!data.supplier_id) throw new HttpError(400, 'Facture du fournisseur : choisissez le fournisseur (fichier de la Comptabilité).');
    if (!(await db('suppliers').where({ id: data.supplier_id }).first())) throw new HttpError(404, 'Fournisseur introuvable.');
  }
  if (data.payment_mode === 'carte') {
    const card = data.fuel_card_id && await db('fuel_cards').where({ id: data.fuel_card_id, active: true }).first();
    if (!card) throw new HttpError(400, 'Choisissez la carte carburant utilisée.');
    const left = await cardBalance(db, card.id);
    if (Number(data.amount) > left) throw new HttpError(409, `Solde de la carte insuffisant (${money(left)}) : faites-la recharger par la Comptabilité.`);
  }
  if (data.payment_mode === 'employe') {
    const employee = data.employee_id || asset.employee_id;
    if (!employee) throw new HttpError(400, 'Avance de l’employé : choisissez l’employé qui a payé.');
    data = { ...data, employee_id: employee };
  }
  if (!Number(data.amount)) throw new HttpError(400, 'Indiquez le montant de la dépense.');
  return { ...data, accounting: mode.accounting };
}

/** Pièce comptable de la dépense, dans la transaction qui l'enregistre. */
async function bookCost(trx, asset, costId, data, userId) {
  const settings = await ct.getSettings(trx);
  const account = costAccount(settings, data.kind);
  const label = `${asset.code} ${asset.name} — ${ASSET_COST_KINDS[data.kind]}${data.label ? ` : ${data.label}` : ''}`.slice(0, 255);
  const patch = {};
  if (data.accounting === 'facture' && !data.purchase_invoice_id) {
    const acc = await trx('acc_accounts').where({ code: account }).first('id');
    if (!acc) throw new HttpError(400, `Compte ${account} absent du plan comptable (Comptabilité › Paramètres › comptes du parc).`);
    const { ht, vat } = splitVat(Number(data.amount), data.vat_rate || 0);
    const [i] = await trx('purchase_invoices').insert({
      number: await ct.nextPurchaseNumber(trx, data.date), supplier_id: data.supplier_id, supplier_ref: asset.code, date: data.date, label,
      project_id: data.project_id || null, worksite_id: data.worksite_id || null, worksite_category: data.worksite_id ? 'engins' : null, place_id: data.place_id || null, expense_account_id: acc.id, amount_ht: ht, vat_rate: data.vat_rate || 0, vat_amount: vat, amount_ttc: Number(data.amount),
      status: 'brouillon', created_by: userId,
    });
    patch.purchase_invoice_id = insertedId(i);
  }
  if (data.accounting === 'ecriture') {
    const mode = ASSET_PAYMENT_MODES[data.payment_mode];
    let credit;
    if (data.payment_mode === 'carte') {
      const card = await trx('fuel_cards').where({ id: data.fuel_card_id }).first();
      credit = { account: settings.accounts.fuel_card, partner_type: 'fournisseur', partner_id: card.supplier_id };
    } else {
      const j = await trx('acc_journals as j').join('acc_accounts as a', 'a.id', 'j.account_id').where('j.code', mode.journal).first('a.code');
      if (!j) throw new HttpError(400, `Journal ${mode.journal} sans compte de trésorerie (Comptabilité › Paramètres › journaux).`);
      credit = { account: j.code };
    }
    const e = await ct.createEntry(trx, {
      journal: mode.journal, date: data.date, label, ref: asset.code, source: 'parc', source_key: `parc_cost:${costId}`, project_id: data.project_id || null, place_id: data.place_id || null, userId,
      lines: [{ account, debit: Number(data.amount), project_id: data.project_id || null }, { ...credit, credit: Number(data.amount), project_id: data.project_id || null }],
    });
    patch.entry_id = e.id;
  }
  if (Object.keys(patch).length) await trx('asset_costs').where({ id: costId }).update(patch);
}

/** Le comptable est prévenu d'une dépense à valider (cloche). */
async function announceCost(db, costId, userId) {
  const c = serializeCost(await loadCost(db, costId));
  if (c.status !== 'a_valider') return;
  await notify(db, {
    to: await usersWith(db, 'achats:write'), except: userId, module: 'compta', event: 'parc.depense',
    title: `Dépense du parc à valider : ${c.asset_code} — ${c.kind_label}`, body: `${money(c.amount)} · ${c.payment_label}${c.project_name ? ` · ${c.project_name}` : ''}`,
    link: `/compta/parc?onglet=valider`, priority: 'action', key: `parc_cost:${c.id}`,
  });
}

/** Validation par le comptable : la facture (écriture d'achat) ou l'écriture de la dépense. */
async function validateCost(db, id, user) {
  const c = serializeCost(await loadCost(db, id));
  if (c.status !== 'a_valider') throw new HttpError(409, 'Cette dépense n’est pas à valider.');
  if (c.accounting === 'facture') await ct.validatePurchase(db, c.purchase_invoice_id, user.id);
  else await db.transaction(trx => ct.validateEntry(trx, c.entry_id, user.id));
  await resolve(db, `parc_cost:${c.id}`);
  return serializeCost(await loadCost(db, id));
}

/** Rejet : la pièce en brouillon est supprimée, la dépense reste au Parc marquée « rejetée » avec le motif. */
async function rejectCost(db, id, reason, user) {
  const c = serializeCost(await loadCost(db, id));
  if (c.status !== 'a_valider') throw new HttpError(409, 'Seule une dépense à valider peut être rejetée.');
  await db.transaction(async trx => {
    if (c.accounting === 'facture') await trx('purchase_invoices').where({ id: c.purchase_invoice_id, status: 'brouillon' }).del();
    else await ct.deleteDraft(trx, c.entry_id);
    await trx('asset_costs').where({ id: c.id }).update({ rejected_at: new Date(), reject_reason: reason, updated_at: new Date() });
  });
  await resolve(db, `parc_cost:${c.id}`);
  const raw = await db('asset_costs').where({ id: c.id }).first('created_by');
  await notify(db, {
    to: raw.created_by, except: user.id, module: 'administration', event: 'parc.depense_rejetee', title: `Dépense rejetée par la Comptabilité : ${c.asset_code} — ${c.kind_label}`,
    body: `${money(c.amount)} · ${reason}`, link: `/administration/parc?fiche=${c.asset_id}`, priority: 'action', key: `parc_cost_rejet:${c.id}`,
  });
  return serializeCost(await loadCost(db, id));
}

/** Suppression depuis le Parc : impossible une fois validée (contrepasser en Comptabilité) ; la pièce en brouillon part avec. */
async function deleteCost(db, id) {
  const c = serializeCost(await loadCost(db, id));
  if (c.status === 'validee') throw new HttpError(409, 'Dépense validée en comptabilité : elle ne se supprime plus (le comptable contrepasse son écriture).');
  await db.transaction(async trx => {
    if (c.status === 'a_valider' && c.accounting === 'facture') {
      // Facture créée par le Parc (et non rattachée à une facture saisie en Comptabilité) : supprimée avec la dépense
      const inv = await trx('purchase_invoices').where({ id: c.purchase_invoice_id, status: 'brouillon' }).first();
      if (inv && inv.supplier_ref === c.asset_code) await trx('purchase_invoices').where({ id: inv.id }).del();
    }
    if (c.status === 'a_valider' && c.accounting === 'ecriture') await ct.deleteDraft(trx, c.entry_id);
    await trx('asset_costs').where({ id: c.id }).del();
  });
  await resolve(db, `parc_cost:${c.id}`);
  return c.asset_id;
}

async function pendingCosts(db, { status = 'a_valider' } = {}) {
  const rows = (await costQuery(db).whereNotNull('c.accounting').orderBy('c.date', 'desc').orderBy('c.id', 'desc').limit(1000)).map(serializeCost);
  return status ? rows.filter(c => c.status === status) : rows;
}

// ─── Cartes carburant ───────────────────────────────────────

async function cards(db) {
  const rows = await db('fuel_cards as f').join('suppliers as s', 's.id', 'f.supplier_id').orderBy('f.label').select('f.*', 's.name as supplier_name');
  const out = [];
  for (const f of rows) {
    const loads = await db('fuel_card_loads as l').leftJoin('acc_journals as j', 'j.id', 'l.journal_id').leftJoin('acc_entries as e', 'e.id', 'l.entry_id')
      .where('l.card_id', f.id).orderBy('l.date', 'desc').limit(20).select('l.*', 'j.code as journal_code', 'e.number as entry_number', 'e.status as entry_status');
    out.push({
      ...f, active: !!f.active, balance: await cardBalance(db, f.id),
      loads: loads.map(l => ({ id: l.id, date: isoDay(l.date), amount: Number(l.amount), journal_code: l.journal_code, reference: l.reference, entry_number: l.entry_number, entry_status: l.entry_status })),
    });
  }
  return out;
}

async function saveCard(db, data, id = null) {
  if (data.supplier_id && !(await db('suppliers').where({ id: data.supplier_id }).first())) throw new HttpError(404, 'Station (fournisseur) introuvable.');
  if (id) {
    if (!(await db('fuel_cards').where({ id }).update({ ...data, updated_at: new Date() }))) throw new HttpError(404, 'Carte introuvable.');
    return id;
  }
  return insertedId((await db('fuel_cards').insert(data))[0]);
}

/** Recharge (avance versée à la station) : écriture de trésorerie, avance fournisseur / banque, caisse ou Mobile Money. */
async function loadCard(db, cardId, { date, amount, journal_id, reference }, user) {
  const settings = await ct.getSettings(db);
  return db.transaction(async trx => {
    const card = await trx('fuel_cards as f').join('suppliers as s', 's.id', 'f.supplier_id').where('f.id', cardId).first('f.*', 's.name as supplier_name');
    if (!card) throw new HttpError(404, 'Carte introuvable.');
    const j = await trx('acc_journals as j').join('acc_accounts as a', 'a.id', 'j.account_id').where('j.id', journal_id).first('j.*', 'a.code as account_code');
    if (!j || !['banque', 'caisse', 'mobile'].includes(j.kind)) throw new HttpError(400, 'Choisissez un journal de trésorerie (banque, caisse, Mobile Money).');
    const [i] = await trx('fuel_card_loads').insert({ card_id: card.id, date, amount, journal_id, reference: reference || null, created_by: user.id });
    const loadId = insertedId(i);
    const e = await ct.createEntry(trx, {
      journal: j, date, label: `Recharge ${card.label} — ${card.supplier_name}`, ref: reference || null, source: 'parc', source_key: `fuel_load:${loadId}`, userId: user.id,
      validate: !!settings.auto_validate,
      lines: [{ account: settings.accounts.fuel_card, debit: amount, partner_type: 'fournisseur', partner_id: card.supplier_id }, { account: j.account_code, credit: amount }],
    });
    await trx('fuel_card_loads').where({ id: loadId }).update({ entry_id: e.id });
  });
}

// ─── Immobilisations ────────────────────────────────────────

const fixedRow = (a, settings, day, fy) => {
  const x = {
    fixed_value: a.fixed_value == null ? null : Number(a.fixed_value), in_service_on: isoDay(a.in_service_on), depreciation_years: a.depreciation_years || settings.depreciation_years[a.kind] || null,
    prior_depreciation: Number(a.prior_depreciation || 0), prior_as_of: isoDay(a.prior_as_of), disposed_on: isoDay(a.disposed_on),
  };
  const cumul = depreciationAt(x, day);
  return {
    id: a.id, code: a.code, name: a.name, kind: a.kind, kind_label: ASSET_KINDS[a.kind]?.label || a.kind, plate: a.plate, status: a.status,
    ...x, own_years: a.depreciation_years || null, purchase_invoice_id: a.purchase_invoice_id, disposal_price: a.disposal_price == null ? null : Number(a.disposal_price),
    disposal_entry_id: a.disposal_entry_id, account: fixedAccount(settings, a.kind), cumul, net: x.fixed_value == null ? null : x.fixed_value - cumul,
    year_dotation: fy ? depreciationFor(x, isoDay(fy.start_date), isoDay(fy.end_date)) : null,
    purchase_amount: a.purchase_amount == null ? null : Number(a.purchase_amount), acquired_on: isoDay(a.acquired_on),
  };
};

/** Registre : biens immobilisés (et biens du parc encore à compléter), cumul et valeur nette au jour, dotation de l'exercice. */
async function register(db, { day = today() } = {}) {
  const settings = await ct.getSettings(db);
  const fy = await db('acc_fiscal_years').where('start_date', '<=', day).where('end_date', '>=', day).first();
  const assets = await db('assets').orderBy('code');
  const rows = assets.map(a => fixedRow(a, settings, day, fy));
  const fixed = rows.filter(r => r.fixed_value);
  const posted = fy ? await db('acc_entries').where({ source_key: `dotations:${fy.id}` }).first('id', 'number', 'status') : null;
  return {
    day, fiscal_year: fy ? { id: fy.id, label: fy.label, start_date: isoDay(fy.start_date), end_date: isoDay(fy.end_date), status: fy.status } : null,
    dotations_entry: posted || null, years: settings.depreciation_years,
    totals: { value: fixed.reduce((t, r) => t + r.fixed_value, 0), cumul: fixed.reduce((t, r) => t + r.cumul, 0), net: fixed.reduce((t, r) => t + r.net, 0), year_dotation: fixed.reduce((t, r) => t + (r.year_dotation || 0), 0) },
    fixed, to_complete: rows.filter(r => !r.fixed_value && r.status !== 'reforme').map(r => ({ id: r.id, code: r.code, name: r.name, kind: r.kind, kind_label: r.kind_label, purchase_amount: r.purchase_amount, acquired_on: r.acquired_on })),
  };
}

async function updateFixed(db, assetId, data) {
  const a = await db('assets').where({ id: assetId }).first();
  if (!a) throw new HttpError(404, 'Bien introuvable.');
  if (a.disposal_entry_id) throw new HttpError(409, 'Bien sorti de l’actif : sa fiche d’immobilisation ne se modifie plus.');
  const m = { ...a, ...data };
  if (m.fixed_value && !m.in_service_on) throw new HttpError(400, 'Indiquez la date de mise en service.');
  if (Number(m.prior_depreciation || 0) > Number(m.fixed_value || 0)) throw new HttpError(400, 'Les amortissements déjà pratiqués dépassent la valeur d’origine.');
  if (Number(m.prior_depreciation || 0) && !m.prior_as_of) throw new HttpError(400, 'Indiquez à quelle date les amortissements déjà pratiqués sont arrêtés.');
  if (data.purchase_invoice_id && !(await db('purchase_invoices').where({ id: data.purchase_invoice_id }).first())) throw new HttpError(404, 'Facture d’achat introuvable.');
  await db('assets').where({ id: a.id }).update({ ...data, updated_at: new Date() });
}

/**
 * Dotations aux amortissements d'un exercice (681 / 284), en une écriture d'opérations diverses, une ligne par bien.
 * Recalculée tant qu'elle est en brouillon ; une fois validée, elle ne bouge plus.
 */
async function postDotations(db, fyId, user) {
  const settings = await ct.getSettings(db);
  const fy = await db('acc_fiscal_years').where({ id: fyId }).first();
  if (!fy) throw new HttpError(404, 'Exercice introuvable.');
  const start = isoDay(fy.start_date), end = isoDay(fy.end_date);
  const lines = [];
  let total = 0;
  for (const a of await db('assets').whereNotNull('fixed_value').orderBy('code')) {
    const r = fixedRow(a, settings, end, fy);
    if (r.disposal_entry_id && r.disposed_on && r.disposed_on < start) continue;
    const amount = depreciationFor(r, start, end);
    if (!amount) continue;
    total += amount;
    lines.push({ account: settings.accounts.depreciation, credit: amount, label: `Amortissement ${a.code} ${a.name}`.slice(0, 255), project_id: a.project_id || null });
  }
  if (!total) throw new HttpError(400, 'Aucune dotation à passer sur cet exercice (aucun bien immobilisé en service).');
  return db.transaction(async trx => {
    const existing = await trx('acc_entries').where({ source_key: `dotations:${fy.id}` }).first();
    if (existing?.status === 'valide') throw new HttpError(409, 'Les dotations de cet exercice sont déjà validées.');
    if (existing) await ct.deleteDraft(trx, existing.id);
    return ct.createEntry(trx, {
      journal: 'OD', date: end, label: `Dotations aux amortissements du parc — exercice ${fy.label}`, source: 'parc', source_key: `dotations:${fy.id}`, userId: user.id,
      lines: [{ account: settings.accounts.depreciation_expense, debit: total }, ...lines],
    });
  });
}

/**
 * Sortie de l'actif (cession ou réforme) : écriture d'opérations diverses — amortissements cumulés (284) et valeur
 * nette (81) au débit, valeur d'origine au crédit ; le prix de cession éventuel est encaissé (journal choisi, 82).
 */
async function dispose(db, assetId, { date, price = 0, journal_id = null }, user) {
  const settings = await ct.getSettings(db);
  const a = await db('assets').where({ id: assetId }).first();
  if (!a) throw new HttpError(404, 'Bien introuvable.');
  if (!a.fixed_value) throw new HttpError(400, 'Ce bien n’est pas immobilisé.');
  if (a.disposal_entry_id) throw new HttpError(409, 'Bien déjà sorti de l’actif.');
  const r = fixedRow({ ...a, disposed_on: date }, settings, date, null);
  return db.transaction(async trx => {
    const label = `Sortie de l’actif ${a.code} ${a.name}`.slice(0, 255);
    const lines = [{ account: fixedAccount(settings, a.kind), credit: r.fixed_value }];
    if (r.cumul) lines.push({ account: settings.accounts.depreciation, debit: r.cumul });
    if (r.net) lines.push({ account: settings.accounts.disposal_value, debit: r.net });
    if (price) {
      const j = await trx('acc_journals as j').join('acc_accounts as x', 'x.id', 'j.account_id').where('j.id', journal_id).first('x.code');
      if (!j) throw new HttpError(400, 'Prix de cession : choisissez le journal de trésorerie qui l’encaisse.');
      lines.push({ account: j.code, debit: price }, { account: settings.accounts.disposal_income, credit: price });
    }
    const e = await ct.createEntry(trx, { journal: 'OD', date, label, source: 'parc', source_key: `disposal:${a.id}`, userId: user.id, lines });
    await trx('assets').where({ id: a.id }).update({ disposed_on: date, disposal_price: price || null, disposal_entry_id: e.id, status: 'reforme', updated_at: new Date() });
    return e;
  });
}

// ─── Échéances à payer ──────────────────────────────────────

/** Échéances administratives du parc (assurance, visite, vignette…) des `days` prochains jours, avec le montant à prévoir. */
async function payables(db, { days = 60, day = today() } = {}) {
  const rows = await db('asset_documents as d').join('assets as a', 'a.id', 'd.asset_id').whereNot('a.status', 'reforme').whereNotNull('d.expires_on')
    .select('d.id', 'd.label', 'd.kind', 'd.expires_on', 'd.amount_estimate', 'a.id as asset_id', 'a.code', 'a.name', 'a.plate');
  const items = rows.map(d => ({ ...d, expires_on: isoDay(d.expires_on), amount_estimate: d.amount_estimate == null ? null : Number(d.amount_estimate), days_left: daysBetween(day, isoDay(d.expires_on)) }))
    .filter(d => d.days_left <= days && d.days_left >= -30).sort((x, y) => x.expires_on.localeCompare(y.expires_on));
  return { days, total: items.reduce((t, d) => t + (d.amount_estimate || 0), 0), unknown: items.filter(d => d.amount_estimate == null).length, items };
}

/** Clôture : les dotations de l'exercice doivent être passées s'il y a des biens immobilisés à amortir. */
async function checkClosing(db, fy) {
  const settings = await ct.getSettings(db);
  const start = isoDay(fy.start_date), end = isoDay(fy.end_date);
  const due = (await db('assets').whereNotNull('fixed_value')).reduce((t, a) => t + depreciationFor(fixedRow(a, settings, end, fy), start, end), 0);
  if (due && !(await db('acc_entries').where({ source_key: `dotations:${fy.id}`, status: 'valide' }).first())) {
    throw new HttpError(409, `Passez et validez d’abord les dotations aux amortissements du parc (${money(due)}) : Comptabilité › Parc auto et matériel › Immobilisations.`);
  }
}

module.exports = {
  costQuery, serializeCost, loadCost, cardBalance, checkPayment, bookCost, announceCost, validateCost, rejectCost, deleteCost, pendingCosts,
  cards, saveCard, loadCard, register, updateFixed, postDotations, dispose, payables, checkClosing, addDays, fr,
};
