/** ERP · Paie (module Comptabilité) : employés, paies mensuelles, bulletins, barème, récapitulatifs CNPS et DGI. */
const express = require('express');
const { z } = require('../../lib/zod');
const { ah, parse, idParam, HttpError, isoDay } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { CONTRACT_TYPES, DEPARTMENTS, MARITAL, PAY_METHODS, DEFAULT_PAYROLL, ID_TYPES } = require('../../lib/paie');
const paie = require('../../services/paie');
const employees = require('../../services/employees');
const rh = require('../../services/rh');
const departures = require('../../services/departures');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const money = z.number().int().min(0);

module.exports = function paieRoutes(db) {
  const r = express.Router();
  const seeStaff = (req, res, next) => (req.can('rh:read') || req.can('paie:read') ? next() : next(new HttpError(403, 'Droits insuffisants.')));
  const read = requirePermission('paie:read');

  r.get('/meta', seeStaff, ah(async (req, res) => {
    res.json({
      contract_types: CONTRACT_TYPES, departments: DEPARTMENTS, marital: MARITAL, pay_methods: PAY_METHODS, id_types: ID_TYPES,
      directions: require('../../lib/org').DIRECTIONS, department_directions: require('../../lib/org').departmentDirections(),
      settings: req.can('paie:read') ? await paie.getSettings(db) : null, defaults: req.can('paie:read') ? DEFAULT_PAYROLL : null,
      projects: await db('projects').orderBy('name').select('id', 'name'),
      users: await db('users as u').leftJoin('employees as e', 'e.user_id', 'u.id').where('u.active', true).orderBy('u.name').select('u.id', 'u.name', 'u.email', 'u.role', 'e.id as employee_id'),
    });
  }));

  // ─── Employés ─────────────────────────────────────────────
  r.get('/employees', seeStaff, ah(async (req, res) => {
    const q = db('employees as e').leftJoin('users as u', 'u.id', 'e.user_id').leftJoin('projects as p', 'p.id', 'e.project_id')
      .select('e.*', 'u.name as user_name', 'u.email as user_email', 'p.name as project_name').orderBy(['e.last_name', 'e.first_name']);
    if (req.query.active !== 'all') q.where('e.active', req.query.active === '0' ? false : true);
    const withPay = req.can('paie:read');
    res.json((await q).map(e => paie.serializeEmployee(e, { withPay })));
  }));

  const { employeeSchema } = employees;

  // La fiche se crée dans RH › Personnel (demande du client du 02/11) ; même service et mêmes règles ici
  r.post('/employees', requirePermission('paie:employees'), ah(async (req, res) => {
    const data = parse(employeeSchema.extend({ base_salary: employeeSchema.shape.base_salary.default(0) }), req.body);
    const id = await employees.create(db, data, { user: req.user, can: p => req.can(p) });
    res.status(201).json(paie.serializeEmployee(await db('employees').where({ id }).first(), { withPay: true }));
  }));

  // Même formulaire et même règle que Ressources humaines › Personnel (services/employees)
  r.patch('/employees/:id', requirePermission('paie:employees'), ah(async (req, res) => {
    const { after } = await employees.update(db, idParam(req), parse(employeeSchema.partial(), req.body), { user: req.user, can: p => req.can(p) });
    res.json(paie.serializeEmployee(after, { withPay: true }));
  }));

  r.post('/employees/from-users', requirePermission('paie:employees'), ah(async (req, res) => {
    // Un matricule attribué par le service RH pour chaque compte (demande du client du 03/11)
    const { people, hire_date } = parse(z.object({ people: z.array(z.object({ user_id: z.number().int().positive(), matricule: employees.matricule })).min(1).max(200), hire_date: day }), req.body);
    res.status(201).json({ created: await employees.createFromUsers(db, people, hire_date, { user: req.user }) });
  }));

  // ─── Paies mensuelles ─────────────────────────────────────
  r.get('/runs', read, ah(async (req, res) => {
    const runs = await db('payroll_runs').orderBy('period', 'desc');
    const sums = await db('payslips').groupBy('run_id').select('run_id').count({ n: '*' }).sum({ gross: 'gross' }).sum({ net: 'net' }).sum({ cost: 'employer_cost' });
    const by = Object.fromEntries(sums.map(s => [s.run_id, s]));
    res.json(runs.map(r2 => ({ ...r2, paid_at: isoDay(r2.paid_at), employees: Number(by[r2.id]?.n || 0), gross: Number(by[r2.id]?.gross || 0), net: Number(by[r2.id]?.net || 0), employer_cost: Number(by[r2.id]?.cost || 0) })));
  }));

  r.post('/runs', requirePermission('paie:prepare'), ah(async (req, res) => {
    const { period } = parse(z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois attendu au format AAAA-MM') }), req.body);
    const run = await paie.createRun(db, period, req.user.id);
    res.status(201).json(await paie.runDetail(db, run.id));
  }));

  r.get('/runs/:id', read, ah(async (req, res) => res.json(await paie.runDetail(db, idParam(req)))));
  r.post('/runs/:id/refresh', requirePermission('paie:prepare'), ah(async (req, res) => { await paie.refreshRun(db, idParam(req)); res.json(await paie.runDetail(db, idParam(req))); }));
  r.post('/runs/:id/validate', requirePermission('paie:validate'), ah(async (req, res) => res.json(await paie.validateRun(db, idParam(req), req.user.id))));
  r.post('/runs/:id/pay', requirePermission('paie:pay'), ah(async (req, res) => {
    const { date } = parse(z.object({ date: day }), req.body);
    res.json(await paie.payRun(db, idParam(req), { date }, req.user.id));
  }));
  r.delete('/runs/:id', requirePermission('paie:prepare'), ah(async (req, res) => {
    const run = await db('payroll_runs').where({ id: idParam(req) }).first();
    if (!run) throw new HttpError(404, 'Paie introuvable.');
    if (run.status !== 'brouillon') throw new HttpError(409, 'Une paie validée ne se supprime pas (contrepassez son écriture si besoin).');
    await db('payroll_runs').where({ id: run.id }).del();
    res.json({ ok: true });
  }));

  r.patch('/payslips/:id', requirePermission('paie:inputs'), ah(async (req, res) => {
    const inputs = parse(z.object({
      days_worked: z.number().min(0).max(30), overtime: money, bonus: money, non_taxable: money, advance: money,
    }).partial(), req.body);
    const slip = await paie.updatePayslip(db, idParam(req), inputs);
    res.json((await paie.runDetail(db, slip.run_id)).slips.find(s => s.id === slip.id));
  }));

  // ─── Barème ───────────────────────────────────────────────
  r.get('/settings', read, ah(async (req, res) => res.json(await paie.getSettings(db))));
  r.put('/settings', requirePermission('paie:settings'), ah(async (req, res) => {
    const pct = z.number().min(0).max(100);
    const data = parse(z.object({
      smig: money, cnps_pension_employee: pct, cnps_pension_employer: pct, cnps_pension_ceiling: money, family_rate: pct, maternity_rate: pct,
      accident_rate: pct, small_ceiling: money, cmu_employee: money, cmu_employer: money, cmu_family: z.boolean(),
      its_brackets: z.array(z.tuple([money.nullable(), pct])).min(1).max(12), ricf_per_half_part: money, max_parts: z.number().min(1).max(10),
      cnps_deductible_from_its: z.boolean(), employer_tax_local: pct, employer_tax_expat: pct, apprenticeship_tax: pct, training_tax: pct,
      transport_exempt_ceiling: money, accounts: z.record(z.string().trim().min(2).max(12)),
    }).partial(), req.body);
    res.json(await paie.saveSettings(db, data));
  }));

  return r;
};
