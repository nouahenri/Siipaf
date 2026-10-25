/**
 * Échéancier de paiement d'un dossier : génération selon le financement (règles dans lib/domain),
 * saisie manuelle, et état de chaque échéance au vu des versements réels.
 */
const { HttpError, isoDay } = require('../lib/http');
const { buildSchedule, allocatePayments, saleTerms, financingLabel } = require('../lib/domain');
const { totals } = require('./sales');
const vefa = require('./vefa');

async function saveSchedule(trx, saleId, lines) {
  await trx('payment_schedule').where({ sale_id: saleId }).del();
  if (lines.length) {
    await trx('payment_schedule').insert(lines.map((l, i) => ({
      sale_id: saleId, seq: i + 1, kind: l.kind, label: l.label, due_date: l.due_date, amount_fcfa: l.amount_fcfa,
    })));
  }
}

/** (Re)génère l'échéancier type du dossier. Sans financement connu, l'échéancier est vidé. Un dossier VEFA suit ses appels de fonds. */
async function regenerateSchedule(trx, sale, options = {}) {
  if (sale.vefa) {
    await saveSchedule(trx, sale.id, []);
    await vefa.ensureCalls(trx, sale, options);
    return [];
  }
  await trx('fund_calls').where({ sale_id: sale.id }).del();
  const start = isoDay(options.start_date || sale.reserved_at) || isoDay(new Date());
  // Formule Diaspora d'un dossier récent : acompte et délai de solde du projet, figés à l'ouverture ; un choix
  // explicite du comptable (apport, mensualités) l'emporte
  const t = saleTerms(sale);
  const opts = { ...options };
  if (t) {
    if (opts.months == null) opts.months = t.months;
    if (opts.deposit_pct == null && opts.deposit_fcfa == null && t.deposit_fcfa > 0) Object.assign(opts, { deposit_fcfa: t.deposit_fcfa, deposit_label: 'Acompte' });
  }
  const lines = buildSchedule({ price_fcfa: sale.price_fcfa, financing: sale.financing, start_date: start, options: opts });
  await saveSchedule(trx, sale.id, lines);
  return lines;
}

/** Échéancier saisi à la main : la somme des échéances doit égaler le prix convenu. */
async function replaceSchedule(trx, sale, lines) {
  if (sale.vefa) throw new HttpError(409, 'Ce dossier est en VEFA : ses échéances sont les appels de fonds, émis selon l’avancement du chantier.');
  const sum = lines.reduce((s, l) => s + l.amount_fcfa, 0);
  if (sum !== Number(sale.price_fcfa)) {
    throw new HttpError(400, `Le total des échéances (${sum.toLocaleString('fr-FR')} FCFA) doit égaler le prix convenu (${Number(sale.price_fcfa).toLocaleString('fr-FR')} FCFA).`);
  }
  const sorted = [...lines].map(l => ({ ...l, due_date: isoDay(l.due_date) })).sort((a, b) => a.due_date.localeCompare(b.due_date));
  await saveSchedule(trx, sale.id, sorted);
}

/** Lignes du dossier et échéances des travaux modificatifs acceptés (TMA), dans l'ordre des dates. */
async function withTma(db, sale, lines) {
  const tma = await require('./chantiersLivraison').tmaLines(db, sale.id);
  if (!tma.length) return lines;
  return [...lines, ...tma].map((l, i) => ({ l, i })).sort((a, b) => String(a.l.due_date || '9999').localeCompare(String(b.l.due_date || '9999')) || a.i - b.i).map(x => x.l);
}

/** Échéancier avec l'état de chaque ligne, les retards et la prochaine échéance. */
async function scheduleStatus(db, sale, t) {
  if (sale.vefa) {
    const paidV = t ? t.paid_fcfa : (await totals(db, sale)).paid_fcfa;
    const { lines, calls } = await vefa.vefaLines(db, sale);
    return { financing_label: 'VEFA — appels de fonds selon l’avancement des travaux', vefa: true, calls, ...allocatePayments(await withTma(db, sale, lines), paidV) };
  }
  const rows = await db('payment_schedule').where({ sale_id: sale.id }).orderBy('seq');
  const paid = t ? t.paid_fcfa : (await totals(db, sale)).paid_fcfa;
  const lines = rows.map(r => ({ id: r.id, seq: r.seq, kind: r.kind, label: r.label, due_date: isoDay(r.due_date), amount_fcfa: Number(r.amount_fcfa) }));
  return { financing_label: financingLabel(sale), ...allocatePayments(await withTma(db, sale, lines), paid) };
}

module.exports = { regenerateSchedule, replaceSchedule, scheduleStatus };
