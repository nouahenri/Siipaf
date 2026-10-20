/**
 * ERP · Paie : paies mensuelles et bulletins calculés selon le barème (lib/paie.js), écriture de paie au journal PA
 * et paiement des salaires (banque, caisse, Mobile Money) dans la comptabilité, récapitulatifs CNPS et DGI.
 */
const { HttpError, isoDay, json } = require('../lib/http');
const { DEFAULT_PAYROLL, computePayslip, checkPayroll, suggestedParts } = require('../lib/paie');
const compta = require('./compta');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const lastDay = period => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const PAY_JOURNAL = { virement: 'BQ', cheque: 'BQ', especes: 'CA', mobile_money: 'MM' };

async function getSettings(db) {
  const row = await db('app_settings').where({ key: 'paie' }).first();
  const saved = json(row?.value, {}) || {};
  return { ...DEFAULT_PAYROLL, ...saved, accounts: { ...DEFAULT_PAYROLL.accounts, ...(saved.accounts || {}) } };
}
async function saveSettings(db, patch) {
  const next = { ...(await getSettings(db)), ...patch };
  next.accounts = { ...DEFAULT_PAYROLL.accounts, ...(patch.accounts || (await getSettings(db)).accounts) };
  const errors = checkPayroll(next);
  if (errors.length) throw new HttpError(400, errors.join(' '));
  const row = { key: 'paie', value: JSON.stringify(next), updated_at: new Date() };
  if (await db('app_settings').where({ key: 'paie' }).first()) await db('app_settings').where({ key: 'paie' }).update(row);
  else await db('app_settings').insert(row);
  return next;
}

async function nextMatricule(trx) {
  const last = await trx('employees').where('matricule', 'like', 'EMP-%').orderBy('matricule', 'desc').first('matricule');
  return `EMP-${String(last ? Number(last.matricule.slice(4)) + 1 : 1).padStart(4, '0')}`;
}

/** Fiche employé pour l'affichage ; les éléments de salaire ne sont donnés qu'aux personnes autorisées à voir la paie. */
function serializeEmployee(e, { withPay }) {
  const out = {
    ...e, expatriate: !!e.expatriate, active: !!e.active, birth_date: isoDay(e.birth_date), hire_date: isoDay(e.hire_date), end_date: isoDay(e.end_date),
    tax_parts: e.tax_parts == null ? null : Number(e.tax_parts), suggested_parts: suggestedParts(e), accident_rate: e.accident_rate == null ? null : Number(e.accident_rate),
  };
  for (const k of ['base_salary', 'housing_allowance', 'transport_allowance', 'other_allowance']) out[k] = withPay ? Number(e[k]) : undefined;
  if (!withPay) { delete out.bank_account; delete out.tax_parts; delete out.accident_rate; }
  return out;
}

/** Jours payés sur 30 quand l'embauche ou la sortie tombe dans le mois. */
function daysInPeriod(e, period) {
  const start = `${period}-01`, end = lastDay(period);
  const hire = isoDay(e.hire_date), leave = isoDay(e.end_date);
  let from = 1, to = 30;
  if (hire > start) from = Math.min(30, Number(hire.slice(8, 10)));
  if (leave && leave < end) to = Math.min(30, Number(leave.slice(8, 10)));
  return Math.max(0, to - from + 1);
}

async function eligibleEmployees(trx, period) {
  const start = `${period}-01`, end = lastDay(period);
  const rows = await trx('employees').where({ active: true }).where('hire_date', '<=', end);
  return rows.filter(e => !e.end_date || isoDay(e.end_date) >= start);
}

/** Prépare la paie d'un mois : un bulletin par employé présent dans le mois (prorata d'entrée / sortie). */
async function createRun(db, period, userId) {
  const settings = await getSettings(db);
  return db.transaction(async trx => {
    if (await trx('payroll_runs').where({ period }).first()) throw new HttpError(409, `La paie de ${period} existe déjà.`);
    const employees = await eligibleEmployees(trx, period);
    if (!employees.length) throw new HttpError(400, 'Aucun employé actif sur ce mois.');
    const [id] = await trx('payroll_runs').insert({ period, created_by: userId });
    const runId = insertedId(id);
    for (const e of employees) {
      const inputs = { days_worked: daysInPeriod(e, period), overtime: 0, bonus: 0, non_taxable: 0, advance: 0 };
      const result = computePayslip(e, inputs, settings);
      await trx('payslips').insert({
        run_id: runId, employee_id: e.id, inputs: JSON.stringify(inputs), result: JSON.stringify(result),
        employee: JSON.stringify(snapshot(e)), gross: result.gross, net: result.net, employer_cost: result.employer_cost,
      });
    }
    return trx('payroll_runs').where({ id: runId }).first();
  });
}

const snapshot = e => ({
  id: e.id, matricule: e.matricule, name: `${e.last_name} ${e.first_name}`, job_title: e.job_title, department: e.department, contract_type: e.contract_type,
  cnps_number: e.cnps_number, hire_date: isoDay(e.hire_date), marital_status: e.marital_status, children: e.children, pay_method: e.pay_method,
  bank_account: e.bank_account, project_id: e.project_id, category: e.category,
});

async function assertDraft(trx, runId) {
  const run = await trx('payroll_runs').where({ id: runId }).first();
  if (!run) throw new HttpError(404, 'Paie introuvable.');
  if (run.status !== 'brouillon') throw new HttpError(409, 'Paie validée : les bulletins sont définitifs.');
  return run;
}

/** Éléments variables d'un bulletin (jours, heures supplémentaires, primes, avance) ; le bulletin est recalculé. */
async function updatePayslip(db, slipId, inputs) {
  const settings = await getSettings(db);
  return db.transaction(async trx => {
    const slip = await trx('payslips').where({ id: slipId }).first();
    if (!slip) throw new HttpError(404, 'Bulletin introuvable.');
    await assertDraft(trx, slip.run_id);
    const e = await trx('employees').where({ id: slip.employee_id }).first();
    const merged = { ...json(slip.inputs, {}), ...inputs };
    const result = computePayslip(e, merged, settings);
    if (result.net < 0) throw new HttpError(400, 'Le net à payer deviendrait négatif : réduisez l’avance retenue.');
    await trx('payslips').where({ id: slip.id }).update({
      inputs: JSON.stringify(merged), result: JSON.stringify(result), employee: JSON.stringify(snapshot(e)), gross: result.gross, net: result.net, employer_cost: result.employer_cost, updated_at: new Date(),
    });
    return trx('payslips').where({ id: slip.id }).first();
  });
}

/** Recalcule tous les bulletins d'une paie en brouillon (fiche employé ou barème modifiés) et ajoute les nouveaux employés. */
async function refreshRun(db, runId) {
  const settings = await getSettings(db);
  return db.transaction(async trx => {
    const run = await assertDraft(trx, runId);
    const employees = await eligibleEmployees(trx, run.period);
    const slips = await trx('payslips').where({ run_id: run.id });
    const byEmp = Object.fromEntries(slips.map(s => [s.employee_id, s]));
    for (const e of employees) {
      const s = byEmp[e.id];
      const inputs = s ? json(s.inputs, {}) : { days_worked: daysInPeriod(e, run.period), overtime: 0, bonus: 0, non_taxable: 0, advance: 0 };
      const result = computePayslip(e, inputs, settings);
      const row = { inputs: JSON.stringify(inputs), result: JSON.stringify(result), employee: JSON.stringify(snapshot(e)), gross: result.gross, net: result.net, employer_cost: result.employer_cost, updated_at: new Date() };
      if (s) await trx('payslips').where({ id: s.id }).update(row);
      else await trx('payslips').insert({ ...row, run_id: run.id, employee_id: e.id });
    }
    const ids = new Set(employees.map(e => e.id));
    const gone = slips.filter(s => !ids.has(s.employee_id)).map(s => s.id);
    if (gone.length) await trx('payslips').whereIn('id', gone).del();
    return trx('payroll_runs').where({ id: run.id }).first();
  });
}

/** Totaux d'une paie : par rubrique et par programme (affectation des employés). */
function totals(slips) {
  const t = { gross: 0, taxable: 0, salaries: 0, allowances: 0, cnps_employee: 0, cmu_employee: 0, its: 0, advance: 0, net: 0, employer_social: 0, employer_taxes: 0, employer_cost: 0,
    pension_base: 0, small_base: 0, pension_employer: 0, family: 0, maternity: 0, accident: 0, cmu_employer: 0, salary_tax: 0, apprenticeship: 0, training: 0 };
  for (const s of slips) {
    const r = s.result;
    t.gross += r.gross; t.taxable += r.taxable; t.cnps_employee += r.cnps_employee; t.cmu_employee += r.cmu_employee; t.its += r.its; t.advance += r.advance; t.net += r.net;
    t.allowances += r.transport + r.non_taxable; t.salaries += r.gross - r.transport - r.non_taxable;
    t.employer_social += r.employer_social; t.employer_taxes += r.employer_taxes; t.employer_cost += r.employer_cost;
    t.pension_base += r.pension_base; t.small_base += r.small_base; t.pension_employer += r.employer.pension; t.family += r.employer.family; t.maternity += r.employer.maternity;
    t.accident += r.employer.accident; t.cmu_employer += r.employer.cmu; t.salary_tax += r.employer.salary_tax; t.apprenticeship += r.employer.apprenticeship; t.training += r.employer.training;
  }
  return t;
}

async function runDetail(db, runId) {
  const run = await db('payroll_runs').where({ id: runId }).first();
  if (!run) throw new HttpError(404, 'Paie introuvable.');
  const slips = (await db('payslips').where({ run_id: run.id }).orderBy('id')).map(s => ({
    ...s, inputs: json(s.inputs, {}), result: json(s.result, {}), employee: json(s.employee, {}), gross: Number(s.gross), net: Number(s.net), employer_cost: Number(s.employer_cost),
  })).sort((a, b) => a.employee.name.localeCompare(b.employee.name, 'fr'));
  const entries = await db('acc_entries').where('source_key', 'like', `payroll%:${run.id}`).select('id', 'number', 'status', 'source_key');
  return { ...run, paid_at: isoDay(run.paid_at), slips, totals: totals(slips), entries };
}

/**
 * Validation : bulletins figés et écriture de paie (journal PA, fin de mois) — charges par programme d'affectation,
 * net à payer par salarié (422), CNPS et CMU (431), ITS (4471), impôts patronaux et FDFP (4472), avances (421).
 */
async function validateRun(db, runId, userId) {
  const ps = await getSettings(db);
  const cs = await compta.getSettings(db);
  const detail = await runDetail(db, runId);
  if (detail.status !== 'brouillon') throw new HttpError(409, 'Paie déjà validée.');
  if (!detail.slips.length) throw new HttpError(400, 'Paie sans bulletin.');
  const a = ps.accounts;
  const byProject = {};
  for (const s of detail.slips) {
    const k = s.employee.project_id || 0;
    byProject[k] ||= { salaries: 0, allowances: 0, social: 0, taxes: 0 };
    const r = s.result;
    byProject[k].salaries += r.gross - r.transport - r.non_taxable;
    byProject[k].allowances += r.transport + r.non_taxable;
    byProject[k].social += r.employer_social;
    byProject[k].taxes += r.employer_taxes;
  }
  const lines = [];
  for (const [k, v] of Object.entries(byProject)) {
    const project_id = Number(k) || null;
    if (v.salaries) lines.push({ account: a.salaries, debit: v.salaries, project_id, label: 'Salaires et primes' });
    if (v.allowances) lines.push({ account: a.allowances, debit: v.allowances, project_id, label: 'Indemnités (transport, non imposables)' });
    if (v.social) lines.push({ account: a.social_charges, debit: v.social, project_id, label: 'Charges sociales patronales (CNPS, CMU)' });
    if (v.taxes) lines.push({ account: a.payroll_taxes, debit: v.taxes, project_id, label: 'Impôts patronaux sur salaires et FDFP' });
  }
  for (const s of detail.slips) {
    if (s.net) lines.push({ account: a.net_payable, credit: s.net, partner_type: 'employe', partner_id: s.employee_id, label: `Net à payer — ${s.employee.name}` });
    if (s.result.advance) lines.push({ account: a.advances, credit: s.result.advance, partner_type: 'employe', partner_id: s.employee_id, label: `Avance retenue — ${s.employee.name}` });
  }
  const t = detail.totals;
  const cnps = t.cnps_employee + t.cmu_employee + t.employer_social;
  if (cnps) lines.push({ account: a.cnps, credit: cnps, label: 'CNPS : cotisations salariales et patronales, CMU' });
  if (t.its) lines.push({ account: a.its, credit: t.its, label: 'ITS retenu à la source' });
  if (t.employer_taxes) lines.push({ account: a.employer_taxes, credit: t.employer_taxes, label: 'Contribution employeur, taxe d’apprentissage, formation continue' });
  await db.transaction(async trx => {
    await compta.createEntry(trx, {
      journal: 'PA', date: lastDay(detail.period), label: `Paie de ${detail.period}`, ref: `PAIE-${detail.period}`, source: 'paie', source_key: `payroll:${detail.id}`,
      lines, userId, validate: !!cs.auto_validate,
    });
    await trx('payroll_runs').where({ id: detail.id }).update({ status: 'valide', validated_by: userId, validated_at: new Date(), updated_at: new Date() });
  });
  return runDetail(db, runId);
}

/** Paiement des salaires : une écriture de trésorerie par moyen de paiement (422 / banque, caisse, Mobile Money). */
async function payRun(db, runId, { date }, userId) {
  const ps = await getSettings(db);
  const cs = await compta.getSettings(db);
  const detail = await runDetail(db, runId);
  if (detail.status !== 'valide') throw new HttpError(409, detail.status === 'paye' ? 'Salaires déjà payés.' : 'Validez la paie avant de payer les salaires.');
  const groups = {};
  for (const s of detail.slips) if (s.net) (groups[PAY_JOURNAL[s.employee.pay_method] || 'BQ'] ||= []).push(s);
  await db.transaction(async trx => {
    for (const [code, slips] of Object.entries(groups)) {
      const j = await trx('acc_journals as j').join('acc_accounts as a', 'a.id', 'j.account_id').where('j.code', code).first('j.*', 'a.code as account_code');
      if (!j) throw new HttpError(400, `Journal ${code} sans compte de trésorerie.`);
      const total = slips.reduce((t, s) => t + s.net, 0);
      await compta.createEntry(trx, {
        journal: j, date, label: `Salaires de ${detail.period} — ${j.label}`, ref: `PAIE-${detail.period}`, source: 'paie', source_key: `payroll_pay_${code}:${detail.id}`, userId, validate: !!cs.auto_validate,
        lines: [...slips.map(s => ({ account: ps.accounts.net_payable, debit: s.net, partner_type: 'employe', partner_id: s.employee_id, label: `Salaire ${detail.period} — ${s.employee.name}` })), { account: j.account_code, credit: total }],
      });
    }
    await trx('payroll_runs').where({ id: detail.id }).update({ status: 'paye', paid_at: date, updated_at: new Date() });
  });
  return runDetail(db, runId);
}

module.exports = { getSettings, saveSettings, nextMatricule, serializeEmployee, createRun, updatePayslip, refreshRun, runDetail, validateRun, payRun, daysInPeriod, lastDay };
