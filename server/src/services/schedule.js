/**
 * Échéancier de paiement d'un dossier : génération selon le financement (règles dans lib/domain),
 * saisie manuelle, et état de chaque échéance au vu des versements réels.
 */
const { HttpError, isoDay } = require('../lib/http');
const { buildSchedule, allocatePayments, FINANCING_PLANS } = require('../lib/domain');
const { totals } = require('./sales');

async function saveSchedule(trx, saleId, lines) {
  await trx('payment_schedule').where({ sale_id: saleId }).del();
  if (lines.length) {
    await trx('payment_schedule').insert(lines.map((l, i) => ({
      sale_id: saleId, seq: i + 1, kind: l.kind, label: l.label, due_date: l.due_date, amount_fcfa: l.amount_fcfa,
    })));
  }
}

/** (Re)génère l'échéancier type du dossier. Sans financement connu, l'échéancier est vidé. */
async function regenerateSchedule(trx, sale, options = {}) {
  const start = isoDay(options.start_date || sale.reserved_at) || isoDay(new Date());
  const lines = buildSchedule({ price_fcfa: sale.price_fcfa, financing: sale.financing, start_date: start, options });
  await saveSchedule(trx, sale.id, lines);
  return lines;
}

/** Échéancier saisi à la main : la somme des échéances doit égaler le prix convenu. */
async function replaceSchedule(trx, sale, lines) {
  const sum = lines.reduce((s, l) => s + l.amount_fcfa, 0);
  if (sum !== Number(sale.price_fcfa)) {
    throw new HttpError(400, `Le total des échéances (${sum.toLocaleString('fr-FR')} FCFA) doit égaler le prix convenu (${Number(sale.price_fcfa).toLocaleString('fr-FR')} FCFA).`);
  }
  const sorted = [...lines].map(l => ({ ...l, due_date: isoDay(l.due_date) })).sort((a, b) => a.due_date.localeCompare(b.due_date));
  await saveSchedule(trx, sale.id, sorted);
}

/** Échéancier avec l'état de chaque ligne, les retards et la prochaine échéance. */
async function scheduleStatus(db, sale, t) {
  const rows = await db('payment_schedule').where({ sale_id: sale.id }).orderBy('seq');
  const paid = t ? t.paid_fcfa : (await totals(db, sale)).paid_fcfa;
  const lines = rows.map(r => ({ id: r.id, seq: r.seq, kind: r.kind, label: r.label, due_date: isoDay(r.due_date), amount_fcfa: Number(r.amount_fcfa) }));
  const plan = FINANCING_PLANS[sale.financing];
  return { financing_label: plan ? plan.label : null, ...allocatePayments(lines, paid) };
}

module.exports = { regenerateSchedule, replaceSchedule, scheduleStatus };
