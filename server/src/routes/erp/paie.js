/** ERP · Paie (module Comptabilité) : employés, paies mensuelles, bulletins, barème, récapitulatifs CNPS et DGI. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, isoDay } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { CONTRACT_TYPES, DEPARTMENTS, MARITAL, PAY_METHODS, DEFAULT_PAYROLL } = require('../../lib/paie');
const paie = require('../../services/paie');
const rh = require('../../services/rh');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const money = z.number().int().min(0);
const insertedId = r => (typeof r === 'object' ? r.id : r);

module.exports = function paieRoutes(db) {
  const r = express.Router();
  const seeStaff = (req, res, next) => (req.can('rh:read') || req.can('paie:read') ? next() : next(new HttpError(403, 'Droits insuffisants.')));
  const read = requirePermission('paie:read');

  r.get('/meta', seeStaff, ah(async (req, res) => {
    res.json({
      contract_types: CONTRACT_TYPES, departments: DEPARTMENTS, marital: MARITAL, pay_methods: PAY_METHODS,
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

  const employeeSchema = z.object({
    last_name: z.string().trim().min(1).max(80), first_name: z.string().trim().min(1).max(80), gender: z.enum(['F', 'M']).optional().nullable(),
    birth_date: day.optional().nullable(), nationality: optText(60), expatriate: z.boolean().optional(), phone: optText(40),
    email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)), address: optText(255),
    id_number: optText(60), cnps_number: optText(40), marital_status: z.enum(Object.keys(MARITAL)).optional(), children: z.number().int().min(0).max(20).optional(),
    tax_parts: z.number().min(1).max(5).multipleOf(0.5).optional().nullable(), job_title: z.string().trim().min(2).max(120),
    department: z.enum(Object.keys(DEPARTMENTS)).optional(), category: optText(40), contract_type: z.enum(Object.keys(CONTRACT_TYPES)).optional(),
    hire_date: day, end_date: day.optional().nullable(), base_salary: money, housing_allowance: money.optional(), transport_allowance: money.optional(),
    other_allowance: money.optional(), accident_rate: z.number().min(0).max(10).optional().nullable(), pay_method: z.enum(Object.keys(PAY_METHODS)).optional(),
    bank_account: optText(80), project_id: z.number().int().positive().optional().nullable(), user_id: z.number().int().positive().optional().nullable(),
    active: z.boolean().optional(), notes: optText(500),
    // Dossier RH (aussi modifiables depuis le module RH, sans les éléments de salaire)
    manager_id: z.number().int().positive().optional().nullable(), trial_end_date: day.optional().nullable(), birth_place: optText(80),
    emergency_contact: optText(160), leave_opening_days: z.number().min(-60).max(200).optional().nullable(), leave_opening_date: day.optional().nullable(),
  });

  async function checkUser(userId, selfId = null) {
    if (!userId) return;
    if (!(await db('users').where({ id: userId }).first())) throw new HttpError(404, 'Compte du dashboard introuvable.');
    const taken = await db('employees').where({ user_id: userId }).whereNot('id', selfId || 0).first();
    if (taken) throw new HttpError(409, `Ce compte est déjà relié à ${taken.first_name} ${taken.last_name}.`);
  }

  r.post('/employees', requirePermission('paie:employees'), ah(async (req, res) => {
    const data = parse(employeeSchema, req.body);
    await checkUser(data.user_id);
    const id = await db.transaction(async trx => {
      const newId = insertedId((await trx('employees').insert({ ...data, matricule: await paie.nextMatricule(trx) }))[0]);
      await trx('hr_career_events').insert({ employee_id: newId, date: data.hire_date, kind: 'embauche', label: `Embauche : ${data.job_title}`, details: JSON.stringify({ contract_type: data.contract_type || 'cdi' }), created_by: req.user.id });
      return newId;
    });
    res.status(201).json(paie.serializeEmployee(await db('employees').where({ id }).first(), { withPay: true }));
  }));

  r.patch('/employees/:id', requirePermission('paie:employees'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(employeeSchema.partial(), req.body);
    if (data.user_id !== undefined) await checkUser(data.user_id, id);
    if (data.manager_id === id) throw new HttpError(400, 'Un employé ne peut pas être son propre responsable.');
    const before = await db('employees').where({ id }).first();
    if (!before) throw new HttpError(404, 'Employé introuvable.');
    await db.transaction(async trx => {
      await trx('employees').where({ id }).update({ ...data, updated_at: new Date() });
      await rh.logChanges(trx, rh.normEmployee(before), data, req.user.id);
    });
    res.json(paie.serializeEmployee(await db('employees').where({ id }).first(), { withPay: true }));
  }));

  // Fiches créées à partir des comptes du dashboard (même personne, aucune ressaisie du nom ni de l'e-mail)
  r.post('/employees/from-users', requirePermission('paie:employees'), ah(async (req, res) => {
    const { user_ids, hire_date } = parse(z.object({ user_ids: z.array(z.number().int().positive()).min(1).max(200), hire_date: day }), req.body);
    const ROLE_JOBS = { super_admin: 'Direction', commercial: 'Commercial(e)', editeur: 'Chargé(e) de communication', conducteur_travaux: 'Conducteur de travaux', comptable: 'Comptable', resp_exploitation: 'Responsable des exploitations' };
    const DEPTS = { super_admin: 'direction', commercial: 'commercial', editeur: 'administratif', conducteur_travaux: 'technique', comptable: 'comptabilite', resp_exploitation: 'direction' };
    let created = 0;
    await db.transaction(async trx => {
      for (const uid of user_ids) {
        const u = await trx('users').where({ id: uid }).first();
        if (!u || await trx('employees').where({ user_id: uid }).first()) continue;
        const [first, ...rest] = u.name.trim().split(/\s+/);
        await trx('employees').insert({
          matricule: await paie.nextMatricule(trx), user_id: u.id, first_name: first, last_name: rest.join(' ') || first, email: u.email, phone: u.phone || null,
          job_title: ROLE_JOBS[u.role] || 'Employé(e)', department: DEPTS[u.role] || 'administratif', hire_date, base_salary: 0,
        });
        created++;
      }
    });
    res.status(201).json({ created });
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

  r.patch('/payslips/:id', requirePermission('paie:prepare'), ah(async (req, res) => {
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
