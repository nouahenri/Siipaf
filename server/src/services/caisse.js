/**
 * Caisse : point de caisse du jour, comme le tient la trésorière (demande du 18/11). Solde de la veille, entrées et
 * sorties de la journée, solde du soir ; arrêté avec comptage des espèces, écart passé en écriture.
 *
 * Les montants viennent du compte du journal de caisse (571…), brouillons compris : versements en espèces, règlements
 * fournisseurs, paie, notes de frais et carburant y figurent déjà, la saisie directe de la caisse aussi. Les versements
 * clients en espèces pas encore synchronisés sont comptés à part (« écriture à synchroniser ») pour que le solde du soir
 * soit juste dès la saisie du versement.
 */
const { HttpError, isoDay } = require('../lib/http');
const ct = require('./compta');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const day = v => isoDay(v);
const today = (now = new Date()) => isoDay(now);
const money = n => `${Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const frDate = d => d.split('-').reverse().join('/');
// Billets et pièces en circulation (franc CFA, BCEAO) : billetage de l'arrêté
const DENOMINATIONS = { billets: [10000, 5000, 2000, 1000, 500], pieces: [500, 250, 200, 100, 50, 25, 10, 5] };
const GAP_KEYS = ['cash_closing:', 'reverse:cash_closing:'];
const isGapEntry = key => !!key && GAP_KEYS.some(p => key.startsWith(p));

/** Journal de caisse (le premier journal actif de type caisse) et son compte. */
async function cashJournal(db) {
  const j = await db('acc_journals as j').join('acc_accounts as a', 'a.id', 'j.account_id').where('j.kind', 'caisse').where('j.active', true).orderBy('j.id')
    .first('j.id', 'j.code', 'j.label', 'j.kind', 'a.id as account_id', 'a.code as account_code', 'a.label as account_label');
  if (!j) throw new HttpError(409, 'Aucun journal de caisse actif : créez-le dans Comptabilité › Réglages › Journaux (compte 571…).');
  return j;
}

/**
 * Exercices à parcourir pour le solde avant `date` : du plus récent au plus ancien, jusqu'à celui qui a des à-nouveaux
 * (ils reprennent tout ce qui précède). Rend les exercices et la date à partir de laquelle compter les versements.
 */
async function yearsBefore(db, date) {
  const years = await db('acc_fiscal_years').where('start_date', '<=', date).orderBy('start_date', 'desc');
  const out = [];
  for (const fy of years) {
    out.push(fy);
    if (await db('acc_entries').where({ fiscal_year_id: fy.id, source: 'an' }).first('id')) break;
  }
  return { years: out, floor: out.length ? day(out[out.length - 1].start_date) : null };
}

/** Versements clients en espèces sans écriture (« Synchroniser » ne les a pas encore passés), entre deux dates. */
async function unsyncedCash(db, { from = null, before = null, on = null }) {
  const synced = new Set(await db('acc_entries').where('source_key', 'like', 'payment:%').pluck('source_key'));
  const rows = await db('payments as p').join('sales as s', 's.id', 'p.sale_id').leftJoin('leads as l', 'l.id', 's.lead_id').where('p.method', 'especes')
    .select('p.id', 'p.paid_at', 'p.amount_fcfa', 'p.reference', 'l.name as client_name');
  return rows.filter(p => !synced.has(`payment:${p.id}`)).map(p => ({ ...p, date: day(p.paid_at), amount: Number(p.amount_fcfa) }))
    .filter(p => (!from || p.date >= from) && (!before || p.date < before) && (!on || p.date === on));
}

/**
 * Opérations annulées (demande du client du 18/11) : une écriture validée et sa contrepassation validée se neutralisent ;
 * la caisse les ignore (brouillard, soldes, journées, alertes). Elles restent dans les journaux (SYSCOHADA).
 * Filtre à appliquer à une requête qui porte l'alias `e` sur acc_entries.
 */
function notCancelled(db) {
  return q => q.whereNot(b => b.where('e.status', 'valide').where(c => c
    .whereExists(db('acc_entries as rv').whereRaw('rv.reversal_of = e.id').where('rv.status', 'valide'))
    .orWhere(o => o.whereNotNull('e.reversal_of').whereExists(db('acc_entries as og').whereRaw('og.id = e.reversal_of').where('og.status', 'valide')))));
}

/** Identifiants, parmi `ids`, des écritures d'une paire annulée. */
async function cancelledAmong(db, ids) {
  if (!ids.length) return new Set();
  const rows = await db('acc_entries as e').whereIn('e.id', ids).where('e.status', 'valide').where(c => c
    .whereExists(db('acc_entries as rv').whereRaw('rv.reversal_of = e.id').where('rv.status', 'valide'))
    .orWhere(o => o.whereNotNull('e.reversal_of').whereExists(db('acc_entries as og').whereRaw('og.id = e.reversal_of').where('og.status', 'valide')))).pluck('e.id');
  return new Set(rows);
}

/** Solde de la caisse au soir de la veille de `date` (brouillons et versements à synchroniser compris, opérations annulées exclues). */
async function balanceBefore(db, j, date) {
  const { years, floor } = await yearsBefore(db, date);
  let total = 0;
  for (const fy of years) {
    const [s] = await db('acc_lines as l').join('acc_entries as e', 'e.id', 'l.entry_id').where('l.account_id', j.account_id).where('e.fiscal_year_id', fy.id)
      .where(b => b.where('e.date', '<', date).orWhere('e.source', 'an')).modify(notCancelled(db)).sum({ d: 'l.debit' }).sum({ c: 'l.credit' });
    total += (Number(s.d) || 0) - (Number(s.c) || 0);
  }
  if (floor) total += (await unsyncedCash(db, { from: floor, before: date })).reduce((t, p) => t + p.amount, 0);
  return total;
}

const ORIGINS = {
  caisse: 'Saisie de caisse', versement: 'Versement client', reglement: 'Règlement fournisseur', paie: 'Paie', frais: 'Note de frais', parc: 'Parc auto',
  manuel: 'Écriture manuelle', contrepassation: 'Contrepassation', caisse_ecart: 'Écart de caisse', an: 'À-nouveaux', sage: 'Import Sage', achat: 'Achat',
};

/**
 * Brouillard de caisse d'une journée : solde de la veille, mouvements, totaux, solde du soir, arrêté.
 * `showCancelled` : opérations annulées affichées (signalées), jamais comptées dans les totaux ni le solde.
 */
async function dayBook(db, date, { showCancelled = false } = {}) {
  const j = await cashJournal(db);
  const opening = await balanceBefore(db, j, date);
  const lines = await db('acc_lines as l').join('acc_entries as e', 'e.id', 'l.entry_id').join('acc_journals as jj', 'jj.id', 'e.journal_id')
    .leftJoin('cash_movements as m', 'm.entry_id', 'e.id').leftJoin('cash_natures as n', 'n.id', 'm.nature_id').leftJoin('users as u', 'u.id', 'e.created_by')
    .where('l.account_id', j.account_id).where('e.date', date).whereNot('e.source', 'an')
    .orderBy([{ column: 'e.id' }, { column: 'l.sort' }])
    .select('l.id as line_id', 'l.debit', 'l.credit', 'l.label as line_label', 'e.id as entry_id', 'e.number', 'e.status', 'e.label', 'e.ref', 'e.source', 'e.source_key',
      'jj.code as journal_code', 'm.id as movement_id', 'm.beneficiary', 'm.reference as movement_ref', 'm.document_filename', 'm.document_name', 'm.document_mime',
      'n.label as nature_label', 'u.name as created_by_name');
  const cancelled = await cancelledAmong(db, [...new Set(lines.map(l => l.entry_id))]);
  const rows = lines.filter(l => showCancelled || !cancelled.has(l.entry_id)).map(l => ({
    key: `l${l.line_id}`, cancelled: cancelled.has(l.entry_id), entry_id: l.entry_id, number: l.number, status: l.status, journal_code: l.journal_code,
    source: l.source_key && l.source_key.startsWith('cash_closing:') ? 'caisse_ecart' : l.source, origin: ORIGINS[l.source_key?.startsWith('cash_closing:') ? 'caisse_ecart' : l.source] || l.source,
    label: l.label, ref: l.movement_ref || l.ref, nature: l.nature_label, beneficiary: l.beneficiary, created_by: l.created_by_name,
    receipt: Number(l.debit) || 0, expense: Number(l.credit) || 0, gap: isGapEntry(l.source_key),
    movement_id: l.movement_id || null,
    document: l.document_filename ? { name: l.document_name, url: `/api/admin/erp/compta/caisse/movements/${l.movement_id}/document`, image: /^image\/(jpeg|png|webp)$/.test(l.document_mime || '') } : null,
  }));
  for (const p of await unsyncedCash(db, { on: date })) {
    rows.push({ key: `p${p.id}`, entry_id: null, number: null, status: 'a_synchroniser', source: 'versement', origin: 'Versement client', label: `Versement en espèces — ${p.client_name || 'client'}`, ref: p.reference, receipt: p.amount, expense: 0, gap: false, payment_id: p.id, movement_id: null, document: null });
  }
  let running = opening;
  for (const r of rows) { if (!r.cancelled) running += r.receipt - r.expense; r.balance = running; }
  const counted = rows.filter(r => !r.cancelled);
  const sum = (k, f = () => true) => counted.filter(f).reduce((t, r) => t + r[k], 0);
  const receipts = sum('receipt', r => !r.gap), expenses = sum('expense', r => !r.gap);
  const theoretical = opening + receipts - expenses;
  const c = await db('cash_closings as c').leftJoin('users as u', 'u.id', 'c.closed_by').where('c.date', date).first('c.*', 'u.name as closed_by_name');
  const last = await db('cash_closings').orderBy('date', 'desc').first('date');
  const closing = c ? {
    id: c.id, opening: Number(c.opening), receipts: Number(c.receipts), expenses: Number(c.expenses), theoretical: Number(c.theoretical), counted: Number(c.counted), gap: Number(c.gap),
    denominations: c.denominations ? JSON.parse(c.denominations) : null, note: c.note, closed_by: c.closed_by_name, closed_at: c.closed_at, entry_id: c.entry_id,
    // Une opération passée en caisse à cette date après l'arrêté (paie, règlement…) : le solde du jour a changé
    changed: Number(c.theoretical) !== theoretical, reopenable: day(last.date) === date,
  } : null;
  return {
    date, journal: { id: j.id, code: j.code, label: j.label, account_code: j.account_code }, opening, receipts, expenses, theoretical,
    closing_balance: opening + sum('receipt') - sum('expense'), rows, closing, pending_sync: rows.filter(r => r.status === 'a_synchroniser').length,
    cancelled_count: cancelled.size, show_cancelled: showCancelled,
  };
}

/** Journées récentes : totaux, arrêtée ou non (jours avec des mouvements ou un arrêté). */
async function recentDays(db, { from, to }) {
  const j = await cashJournal(db);
  const rows = await db('acc_lines as l').join('acc_entries as e', 'e.id', 'l.entry_id').where('l.account_id', j.account_id).whereNot('e.source', 'an')
    .where('e.date', '>=', from).where('e.date', '<=', to).modify(notCancelled(db)).groupBy('e.date').select('e.date').sum({ d: 'l.debit' }).sum({ c: 'l.credit' });
  const by = {};
  for (const r of rows) by[day(r.date)] = { date: day(r.date), receipts: Number(r.d) || 0, expenses: Number(r.c) || 0 };
  for (const p of await unsyncedCash(db, { from, before: isoDay(new Date(new Date(`${to}T12:00:00Z`).getTime() + 864e5)) })) {
    by[p.date] = by[p.date] || { date: p.date, receipts: 0, expenses: 0 };
    by[p.date].receipts += p.amount;
  }
  const closings = await db('cash_closings').where('date', '>=', from).where('date', '<=', to).select('date', 'counted', 'gap');
  for (const c of closings) {
    const d = day(c.date);
    by[d] = by[d] || { date: d, receipts: 0, expenses: 0 };
    Object.assign(by[d], { closed: true, counted: Number(c.counted), gap: Number(c.gap) });
  }
  return Object.values(by).map(d => ({ closed: false, ...d })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Journées des `days` derniers jours (avant aujourd'hui) avec des mouvements, pas encore arrêtées. */
async function daysToClose(db, { now = new Date(), days = 7 } = {}) {
  const t = today(now);
  const from = isoDay(new Date(now.getTime() - days * 864e5));
  const yesterday = isoDay(new Date(now.getTime() - 864e5));
  if (yesterday < from) return [];
  try { return (await recentDays(db, { from, to: yesterday })).filter(d => !d.closed && d.date < t).map(d => d.date); } catch { return []; }
}

// ─── Natures ──────────────────────────────────────────────────
async function natures(db) {
  const rows = await db('cash_natures as n').join('acc_accounts as a', 'a.id', 'n.account_id').orderBy([{ column: 'n.direction', order: 'desc' }, { column: 'n.sort' }, { column: 'n.label' }])
    .select('n.*', 'a.code as account_code', 'a.label as account_label', 'a.partner_kind');
  return rows.map(n => ({ ...n, active: !!n.active }));
}

async function natureAccount(db, code) {
  const a = await db('acc_accounts').where({ code }).first();
  if (!a) throw new HttpError(400, `Compte ${code} absent du plan comptable.`);
  if (!a.active) throw new HttpError(400, `Le compte ${code} est désactivé.`);
  if (a.class === 5 && a.code.startsWith('57')) throw new HttpError(400, 'Choisissez la contrepartie de la caisse, pas un compte de caisse.');
  if (a.partner_kind === 'client') throw new HttpError(400, 'Les versements des clients se saisissent dans leur dossier de vente (moyen « Espèces ») : ils arrivent ensuite en caisse.');
  return a;
}

async function saveNature(db, id, data) {
  const row = {};
  if (data.label !== undefined) row.label = data.label;
  if (data.direction !== undefined) row.direction = data.direction;
  if (data.active !== undefined) row.active = data.active;
  if (data.sort !== undefined) row.sort = data.sort;
  if (data.account !== undefined) row.account_id = (await natureAccount(db, data.account)).id;
  if (id) {
    const n = await db('cash_natures').where({ id }).update({ ...row, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Nature introuvable.');
  } else {
    if (await db('cash_natures').where({ label: row.label, direction: row.direction }).first()) throw new HttpError(409, 'Cette nature existe déjà.');
    const [{ m } = {}] = await db('cash_natures').max({ m: 'sort' });
    const [nid] = await db('cash_natures').insert({ ...row, sort: (Number(m) || 0) + 1 });
    id = insertedId(nid);
  }
  return (await natures(db)).find(n => n.id === id);
}

// ─── Mouvements ───────────────────────────────────────────────
async function assertOpenDay(db, date, now = new Date()) {
  if (date > today(now)) throw new HttpError(400, 'Pas de mouvement de caisse à une date future.');
  if (await db('cash_closings').where({ date }).first('id')) throw new HttpError(409, `La caisse du ${frDate(date)} est arrêtée : rouvrez-la (Comptabilité) ou saisissez à une autre date.`);
}

/** Entrée ou sortie d'espèces : mouvement et écriture du journal de caisse (caisse / compte de la nature). */
async function addMovement(db, data, user, now = new Date()) {
  await assertOpenDay(db, data.date, now);
  const j = await cashJournal(db);
  const n = await db('cash_natures as n').join('acc_accounts as a', 'a.id', 'n.account_id').where('n.id', data.nature_id).first('n.*', 'a.code as account_code', 'a.partner_kind');
  if (!n || !n.active) throw new HttpError(400, 'Choisissez une nature active.');
  if (n.direction !== data.direction) throw new HttpError(400, `« ${n.label} » est une nature de ${n.direction === 'entree' ? 'recette' : 'dépense'}.`);
  let partner = { partner_type: null, partner_id: null };
  if (n.partner_kind === 'client') throw new HttpError(400, 'Les versements des clients se saisissent dans leur dossier de vente.');
  if (n.partner_kind) {
    if (!data.partner_id) throw new HttpError(400, n.partner_kind === 'employe' ? 'Choisissez l’employé concerné.' : 'Choisissez le fournisseur concerné.');
    const exists = await db(n.partner_kind === 'employe' ? 'employees' : 'suppliers').where({ id: data.partner_id }).first('id');
    if (!exists) throw new HttpError(404, n.partner_kind === 'employe' ? 'Employé introuvable.' : 'Fournisseur introuvable.');
    partner = { partner_type: n.partner_kind, partner_id: data.partner_id };
  }
  if (data.direction === 'sortie') {
    const book = await dayBook(db, data.date);
    if (data.amount > book.closing_balance) throw new HttpError(409, `La caisse n’a que ${money(book.closing_balance)} le ${frDate(data.date)} : une sortie de ${money(data.amount)} la rendrait négative.`);
  }
  const settings = await ct.getSettings(db);
  return db.transaction(async trx => {
    const [mid] = await trx('cash_movements').insert({
      date: data.date, direction: data.direction, nature_id: n.id, amount: data.amount, label: data.label, beneficiary: data.beneficiary || null, ...partner,
      project_id: data.project_id || null, reference: data.reference || null, created_by: user.id,
    });
    const id = insertedId(mid);
    const cash = { account: j.account_code, project_id: data.project_id || null };
    const other = { account_id: n.account_id, ...partner, project_id: data.project_id || null };
    const lines = data.direction === 'entree' ? [{ ...cash, debit: data.amount }, { ...other, credit: data.amount }] : [{ ...other, debit: data.amount }, { ...cash, credit: data.amount }];
    const who = data.beneficiary ? ` — ${data.beneficiary}` : '';
    const e = await ct.createEntry(trx, {
      journal: j.id, date: data.date, label: `${n.label} : ${data.label}${who}`.slice(0, 255), ref: data.reference || null, source: 'caisse', source_key: `cash:${id}`,
      project_id: data.project_id || null, lines, userId: user.id, validate: !!settings.auto_validate,
    });
    await trx('cash_movements').where({ id }).update({ entry_id: e.id });
    return trx('cash_movements').where({ id }).first();
  });
}

/** Annule une saisie de caisse (journée non arrêtée) : brouillon effacé, écriture validée contrepassée à la même date. */
async function removeMovement(db, id, user) {
  const m = await db('cash_movements').where({ id }).first();
  if (!m) throw new HttpError(404, 'Mouvement introuvable.');
  await assertOpenDay(db, day(m.date));
  await db.transaction(async trx => {
    const e = m.entry_id ? await trx('acc_entries').where({ id: m.entry_id }).first() : null;
    if (e && e.status === 'valide') await ct.reverseEntry(trx, e.id, { date: day(m.date), userId: user.id, validate: true });
    else if (e) await ct.deleteDraft(trx, e.id);
    await trx('cash_movements').where({ id }).del();
  });
  return m;
}

// ─── Arrêté du soir ───────────────────────────────────────────
function countDenominations(den) {
  const all = [...DENOMINATIONS.billets.map(v => `b${v}`), ...DENOMINATIONS.pieces.map(v => `p${v}`)];
  let total = 0;
  const kept = {};
  for (const [k, n] of Object.entries(den || {})) {
    if (!all.includes(k)) throw new HttpError(400, `Coupure inconnue : ${k}.`);
    if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'Nombre de billets ou de pièces invalide.');
    if (n) { kept[k] = n; total += n * Number(k.slice(1)); }
  }
  return { total, kept };
}

async function closeDay(db, { date, counted, denominations, note }, user, now = new Date()) {
  if (date > today(now)) throw new HttpError(400, 'On n’arrête pas la caisse d’un jour à venir.');
  if (await db('cash_closings').where({ date }).first('id')) throw new HttpError(409, `La caisse du ${frDate(date)} est déjà arrêtée.`);
  let total = counted;
  let kept = null;
  if (denominations && Object.values(denominations).some(Boolean)) {
    ({ total, kept } = countDenominations(denominations));
    if (counted != null && counted !== total) throw new HttpError(400, `Le billetage fait ${money(total)}, pas ${money(counted)}.`);
  }
  if (total == null || total < 0) throw new HttpError(400, 'Indiquez le montant compté en caisse.');
  const book = await dayBook(db, date);
  const gap = total - book.theoretical;
  const settings = await ct.getSettings(db);
  const j = await cashJournal(db);
  const id = await db.transaction(async trx => {
    const [cid] = await trx('cash_closings').insert({
      date, opening: book.opening, receipts: book.receipts, expenses: book.expenses, theoretical: book.theoretical, counted: total, gap,
      denominations: kept ? JSON.stringify(kept) : null, note: note || null, closed_by: user.id,
    });
    const closingId = insertedId(cid);
    if (gap) {
      const short = gap < 0;
      const amount = Math.abs(gap);
      const e = await ct.createEntry(trx, {
        journal: j.id, date, label: `${short ? 'Manquant' : 'Excédent'} de caisse constaté à l’arrêté du ${frDate(date)}`, source: 'caisse', source_key: `cash_closing:${closingId}`,
        lines: short ? [{ account: settings.accounts.cash_shortage, debit: amount }, { account: j.account_code, credit: amount }]
          : [{ account: j.account_code, debit: amount }, { account: settings.accounts.cash_surplus, credit: amount }],
        userId: user.id, validate: !!settings.auto_validate,
      });
      await trx('cash_closings').where({ id: closingId }).update({ entry_id: e.id });
    }
    return closingId;
  });
  const notifications = require('./notifications');
  if (!(await daysToClose(db, { now }).then(d => d.length))) await notifications.resolve(db, 'caisse:non_arretee:');
  if (gap) {
    await notifications.inform(db, 'caisse.ecart', {
      key: `caisse:ecart:${date}:${id}`, link: `/compta/caisse?date=${date}`, except: user.id,
      title: `Caisse du ${frDate(date)} : ${gap < 0 ? 'manquant' : 'excédent'} de ${money(Math.abs(gap))}`,
      body: `Solde théorique ${money(book.theoretical)}, compté ${money(total)} par ${user.name}.${note ? ` Note : ${note}` : ''}`,
    }).catch(e => console.error('[caisse] écart :', e.message));
  }
  return id;
}

/** Réouverture du dernier arrêté (Comptabilité) : l'écriture d'écart est effacée (brouillon) ou contrepassée. */
async function reopenDay(db, date, user) {
  const c = await db('cash_closings').where({ date }).first();
  if (!c) throw new HttpError(404, 'Cette journée n’est pas arrêtée.');
  const last = await db('cash_closings').orderBy('date', 'desc').first('date');
  if (day(last.date) !== date) throw new HttpError(409, `Rouvrez d’abord l’arrêté le plus récent (${frDate(day(last.date))}).`);
  await db.transaction(async trx => {
    const e = c.entry_id ? await trx('acc_entries').where({ id: c.entry_id }).first() : null;
    if (e && e.status === 'valide') await ct.reverseEntry(trx, e.id, { date, userId: user.id, validate: true });
    else if (e) await ct.deleteDraft(trx, e.id);
    await trx('cash_closings').where({ id: c.id }).del();
  });
}

// ─── Alertes (tâche horaire de la Comptabilité) ───────────────
async function ceilingTick(db, now) {
  const ceiling = await require('./moduleSettings').value(db, 'compta_cash_ceiling_fcfa');
  const key = 'cash_ceiling_state';
  const row = await db('app_settings').where({ key }).first();
  const wasOver = row?.value === 'dessus';
  const save = async value => (row ? db('app_settings').where({ key }).update({ value, updated_at: new Date() }) : db('app_settings').insert({ key, value }));
  const notifications = require('./notifications');
  let balance = 0;
  if (ceiling > 0) {
    const fy = await db('acc_fiscal_years').where('start_date', '<=', today(now)).where('end_date', '>=', today(now)).first('id');
    if (!fy) return 0;
    balance = (await dayBook(db, today(now))).closing_balance;
  }
  if (!(ceiling > 0) || balance <= ceiling) {
    if (wasOver) { await save('ok'); await notifications.resolve(db, 'caisse:plafond:'); }
    return 0;
  }
  if (wasOver) return 0;
  await save('dessus');
  return notifications.inform(db, 'caisse.plafond', {
    key: `caisse:plafond:${now.toISOString()}`, link: '/compta/caisse',
    title: `Caisse au-dessus du plafond : ${money(balance)}`,
    body: `Plafond réglé à ${money(ceiling)} (Comptabilité › Réglages) : versez l’excédent en banque.`,
  });
}

async function tick(db, now = new Date()) {
  await ceilingTick(db, now).catch(e => console.error('[caisse] plafond :', e.message));
  const pending = await daysToClose(db, { now });
  if (!pending.length) return 0;
  return require('./notifications').inform(db, 'caisse.non_arretee', {
    key: `caisse:non_arretee:${today(now)}`, link: `/compta/caisse?date=${pending[pending.length - 1]}`,
    title: pending.length === 1 ? `Caisse du ${frDate(pending[0])} à arrêter` : `${pending.length} journées de caisse à arrêter`,
    body: `Journées avec des mouvements, sans point du soir : ${pending.map(frDate).join(', ')}.`,
  });
}

module.exports = {
  DENOMINATIONS, cashJournal, dayBook, recentDays, daysToClose, natures, saveNature, addMovement, removeMovement, closeDay, reopenDay, tick, countDenominations,
};
