/**
 * ERP · RH : dossiers du personnel, congés et absences (libre-service de chaque employé relié à un compte du
 * dashboard, approbation par le responsable direct puis le service RH), jours fériés, objectifs et entretiens.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, isoDay } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const {
  LEAVE_TYPES, PERMISSION_EVENTS, LEAVE_STATUSES, LEAVE_ACTIVE, DOCUMENT_KINDS, CAREER_EVENTS, POSITION_CHANGE_REASONS, OBJECTIVE_STATUSES, OBJECTIVE_METRICS, REVIEW_RATINGS, DEFAULT_RH,
  EXPENSE_STATUSES, ATTENDANCE_SOURCES, RECRUIT_STAGES, RECRUIT_SOURCES, REFUSE_REASONS, JOB_STATUSES, RESUME_KINDS, TRAINING_STATUSES,
  OBJECTIVE_PERIODS, parsePeriod, periodRange,
} = require('../../lib/rh');
const kpiService = require('../../services/kpi');
const { CONTRACT_TYPES, DEPARTMENTS, MARITAL } = require('../../lib/paie');
const rh = require('../../services/rh');
const paie = require('../../services/paie');
const performance = require('../../services/performance');
const departures = require('../../services/departures');
const positions = require('../../services/positions');
const employees = require('../../services/employees');
const { listRoles } = require('../../services/roles');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const insertedId = r => (typeof r === 'object' ? r.id : r);
const yearOf = v => { const y = Number(v) || new Date().getFullYear(); if (y < 2000 || y > 2100) throw new HttpError(400, 'Année invalide.'); return y; };

const leaveSchema = z.object({
  type: z.enum(Object.keys(LEAVE_TYPES)), event: z.enum(Object.keys(PERMISSION_EVENTS)).optional().nullable(),
  start_date: day, end_date: day, start_half: z.boolean().optional(), end_half: z.boolean().optional(),
  reason: optText(500), document_id: z.number().int().positive().optional().nullable(),
});

module.exports = function rhRoutes(db) {
  const r = express.Router();
  const read = requirePermission('rh:read');

  /** Accès au dossier d'un employé : service RH, l'employé lui-même, ou son responsable direct. */
  async function access(req, e) {
    if (req.can('rh:read')) return 'rh';
    if (e.user_id && e.user_id === req.user.id) return 'self';
    if (await rh.isManagerOf(db, req.user.id, e)) return 'manager';
    throw new HttpError(403, 'Droits insuffisants.');
  }
  const ctx = req => ({ user: req.user, can: p => req.can(p) });

  r.get('/meta', ah(async (req, res) => {
    const me = await rh.employeeOf(db, req.user.id);
    const team = me ? await db('employees').where({ manager_id: me.id, active: true }).count({ n: '*' }).first() : { n: 0 };
    res.json({
      leave_types: LEAVE_TYPES, events: PERMISSION_EVENTS, statuses: LEAVE_STATUSES, document_kinds: DOCUMENT_KINDS, career_events: CAREER_EVENTS,
      objective_statuses: OBJECTIVE_STATUSES, objective_metrics: OBJECTIVE_METRICS, objective_periods: OBJECTIVE_PERIODS, ratings: REVIEW_RATINGS,
      expense_statuses: EXPENSE_STATUSES, attendance_sources: ATTENDANCE_SOURCES, recruit_stages: RECRUIT_STAGES, recruit_sources: RECRUIT_SOURCES,
      refuse_reasons: REFUSE_REASONS, job_statuses: JOB_STATUSES, resume_kinds: RESUME_KINDS, training_statuses: TRAINING_STATUSES,
      contract_types: CONTRACT_TYPES, departments: DEPARTMENTS, marital: MARITAL,
      settings: await rh.getSettings(db), defaults: DEFAULT_RH,
      me: me ? { id: me.id, name: `${me.last_name} ${me.first_name}`, matricule: me.matricule } : null,
      team_size: Number(team?.n || 0),
      projects: await db('projects').orderBy('name').select('id', 'name'),
      employees: req.can('rh:read') || req.can('presence:write') ? await db('employees').where({ active: true }).orderBy(['last_name', 'first_name']).select('id', 'matricule', 'last_name', 'first_name', 'department', 'user_id') : [],
    });
  }));

  r.get('/dashboard', read, ah(async (req, res) => res.json(await rh.dashboard(db))));

  // ─── Postes (RH › Réglages) ────────────────────────────────
  /** Liste des postes : pour les formulaires (fiche, compte, paie) et les réglages ; rôles proposables joints. */
  r.get('/positions', ah(async (req, res) => {
    if (!['rh:read', 'rh:files', 'paie:read', 'paie:employees', 'users:read', 'users:edit'].some(p => req.can(p))) throw new HttpError(403, 'Droits insuffisants.');
    // Super administrateur : droits fixes, proposable pour un poste par un super administrateur seulement (choix du client du 25/10)
    const roles = (await listRoles(db)).map(x => ({ id: x.id, label: x.label, reserved: x.id === 'super_admin' }));
    res.json({ positions: await positions.list(db, { all: req.query.all === '1' }), roles, reasons: POSITION_CHANGE_REASONS });
  }));
  const positionSchema = z.object({
    title: z.string().trim().min(2).max(120), department: z.enum(Object.keys(DEPARTMENTS)), category: optText(40),
    default_role: z.string().trim().max(40).optional().nullable().transform(v => v || null), active: z.boolean().optional(),
  });
  // Chef de chaque service (demandes au nom du service, choix du client du 29/10)
  r.get('/department-heads', ah(async (req, res) => res.json(await require('../../services/departments').heads(db))));
  r.put('/department-heads/:department', requirePermission('rh:settings'), ah(async (req, res) => {
    const { employee_id } = parse(z.object({ employee_id: z.number().int().positive().nullable() }), req.body);
    res.json(await require('../../services/departments').setHead(db, req.params.department, employee_id, { userId: req.user.id }));
  }));

  r.post('/positions', requirePermission('rh:settings'), ah(async (req, res) => {
    const id = await positions.create(db, parse(positionSchema, req.body), req.user);
    res.status(201).json(await db('hr_positions').where({ id }).first());
  }));
  r.patch('/positions/:id', requirePermission('rh:settings'), ah(async (req, res) => {
    const p = await db('hr_positions').where({ id: idParam(req) }).first();
    if (!p) throw new HttpError(404, 'Poste introuvable.');
    await positions.update(db, p, parse(positionSchema.partial(), req.body), req.user);
    res.json(await db('hr_positions').where({ id: p.id }).first());
  }));

  r.post('/positions/:id/merge', requirePermission('rh:settings'), ah(async (req, res) => {
    const { into } = parse(z.object({ into: z.number().int().positive() }), req.body);
    const [from, target] = await Promise.all([db('hr_positions').where({ id: idParam(req) }).first(), db('hr_positions').where({ id: into }).first()]);
    if (!from || !target) throw new HttpError(404, 'Poste introuvable.');
    await positions.merge(db, from, target);
    res.json({ ok: true });
  }));

  /** Changement de poste daté (promotion, mutation…) : appliqué à la date d'effet. */
  r.post('/employees/:id/position', requirePermission('rh:files'), ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    const data = parse(z.object({
      position_id: z.number().int().positive(), department: z.enum(Object.keys(DEPARTMENTS)).optional(), effective_date: day,
      reason: z.enum(Object.keys(POSITION_CHANGE_REASONS)), note: optText(500), category: optText(40),
      base_salary: z.number().int().min(0).max(1000000000).optional().nullable(), change_manager: z.boolean().optional(),
      manager_id: z.number().int().positive().optional().nullable(), team_ids: z.array(z.number().int().positive()).max(200).optional(),
      role: z.string().trim().max(40).optional().nullable(), reset_overrides: z.boolean().optional(),
    }), req.body);
    const id = await positions.changePosition(db, e, data, { user: req.user, can: p => req.can(p) });
    const change = (await positions.changesOf(db, e.id)).find(c => c.id === id);
    res.status(201).json(change);
  }));
  // Salaire d'un changement de poste : seulement avec le droit Paie (« Voir le personnel » est sans les salaires)
  r.get('/employees/:id/position-changes', requirePermission('rh:read'), ah(async (req, res) => {
    const rows = await positions.changesOf(db, idParam(req));
    res.json(req.can('paie:read') ? rows : rows.map(c => ({ ...c, base_salary: null })));
  }));
  r.delete('/position-changes/:id', requirePermission('rh:files'), ah(async (req, res) => {
    const c = await db('hr_position_changes').where({ id: idParam(req) }).first();
    if (!c) throw new HttpError(404, 'Changement introuvable.');
    await positions.cancel(db, c);
    res.json({ ok: true });
  }));

  /** Pastilles du menu RH : demandes à traiter par le compte connecté, et ce qu'il peut ouvrir. */
  r.get('/badges', ah(async (req, res) => {
    const me = await rh.employeeOf(db, req.user.id);
    const team = me ? Number((await db('employees').where({ manager_id: me.id, active: true }).count({ n: '*' }).first())?.n || 0) : 0;
    const approvals = (await rh.toApprove(db, ctx(req))).length;
    const expenses = req.can('frais:approve') || team
      ? (await db('hr_expenses as x').join('employees as e', 'e.id', 'x.employee_id').where('x.status', 'soumise')
        .modify(q => { if (!req.can('frais:approve')) q.where('e.manager_id', me.id); }).where(w => w.whereNull('e.user_id').orWhereNot('e.user_id', req.user.id)).count({ n: '*' }).first()).n
      : 0;
    const toPost = req.can('frais:post') ? Number((await db('hr_expenses').whereIn('status', ['approuvee', 'comptabilisee']).count({ n: '*' }).first()).n) : 0;
    res.json({ has_employee: !!me, team_size: team, approvals, expenses: Number(expenses || 0) + toPost });
  }));

  // ─── Libre-service : mon dossier, mes congés ──────────────
  async function myEmployee(req) {
    const me = await rh.employeeOf(db, req.user.id);
    if (!me) throw new HttpError(404, 'Aucune fiche employé n’est reliée à votre compte : adressez-vous au service RH.');
    return me;
  }

  r.get('/me', ah(async (req, res) => {
    const me = await myEmployee(req);
    const year = yearOf(req.query.year);
    const [balance, leaves, objectives, review, manager] = await Promise.all([
      rh.balanceOf(db, me), rh.leaveQuery(db).where('l.employee_id', me.id).orderBy('l.start_date', 'desc'),
      // Lignes du score : les objectifs mensuels d'un même indicateur sont regroupés sur l'année
      performance.scorecard(db, me, year).then(c => c.lines), db('hr_reviews').where({ employee_id: me.id, year }).first(),
      me.manager_id ? db('employees').where({ id: me.manager_id }).first('last_name', 'first_name') : null,
    ]);
    res.json({
      employee: paie.serializeEmployee(me, { withPay: false }), manager: manager ? `${manager.last_name} ${manager.first_name}` : null,
      balance, leaves: leaves.map(rh.serializeLeave), objectives, review: review || null, year,
    });
  }));

  r.post('/me/leaves/preview', requirePermission('self:conges'), ah(async (req, res) => {
    const me = await myEmployee(req);
    res.json(await rh.checkLeave(db, me, parse(leaveSchema, req.body)));
  }));
  r.post('/me/leaves', requirePermission('self:conges'), ah(async (req, res) => {
    const me = await myEmployee(req);
    const data = parse(leaveSchema, req.body);
    if (data.document_id && !(await db('hr_documents').where({ id: data.document_id, employee_id: me.id }).first())) throw new HttpError(400, 'Justificatif introuvable.');
    res.status(201).json(await rh.createLeave(db, me, data, { user: req.user }));
  }));

  // Justificatif déposé par l'employé lui-même (certificat médical, attestation…)
  r.post('/me/documents', requirePermission('self:conges'), rh.documentUpload(), ah(async (req, res) => {
    const me = await myEmployee(req);
    res.status(201).json(await saveDocument(req, me.id, { kinds: ['certificat_medical', 'attestation', 'autre'] }));
  }));

  r.put('/me/review/:year', requirePermission('self:conges'), ah(async (req, res) => {
    const me = await myEmployee(req);
    const year = yearOf(req.params.year);
    const { self_comment } = parse(z.object({ self_comment: z.string().trim().max(5000) }), req.body);
    const row = await db('hr_reviews').where({ employee_id: me.id, year }).first();
    if (row?.status === 'finalise') throw new HttpError(409, 'Entretien finalisé.');
    if (row) await db('hr_reviews').where({ id: row.id }).update({ self_comment, updated_at: new Date() });
    else await db('hr_reviews').insert({ employee_id: me.id, year, self_comment });
    res.json(await db('hr_reviews').where({ employee_id: me.id, year }).first());
  }));

  // ─── Approbations (responsable direct, service RH) ────────
  r.get('/approvals', ah(async (req, res) => res.json(await rh.toApprove(db, ctx(req)))));
  r.post('/leaves/:id/decide', ah(async (req, res) => {
    const data = parse(z.object({ action: z.enum(['approve', 'refuse', 'cancel']), note: optText(500) }), req.body);
    res.json(await rh.decideLeave(db, idParam(req), data, ctx(req)));
  }));

  // ─── Congés et absences (service RH, responsable pour son équipe) ──
  r.get('/leaves', ah(async (req, res) => {
    const q = rh.leaveQuery(db).orderBy('l.start_date', 'desc');
    if (!req.can('rh:read')) {
      const me = await myEmployee(req);
      q.where(w => w.where('e.manager_id', me.id).orWhere('e.id', me.id));
    }
    if (req.query.status) q.whereIn('l.status', String(req.query.status).split(','));
    if (req.query.type) q.whereIn('l.type', String(req.query.type).split(','));
    if (req.query.employee_id) q.where('l.employee_id', Number(req.query.employee_id));
    if (req.query.department) q.where('e.department', String(req.query.department));
    const rows = (await q).map(rh.serializeLeave);
    const from = req.query.from || null, to = req.query.to || null;
    res.json(rows.filter(l => (!from || l.end_date >= from) && (!to || l.start_date <= to)).slice(0, 500));
  }));

  /** Planning du mois : absences actives (approuvées et en attente) et jours fériés. */
  r.get('/calendar', ah(async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`, to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const q = rh.leaveQuery(db).whereIn('l.status', LEAVE_ACTIVE);
    const people = db('employees').where({ active: true }).orderBy(['last_name', 'first_name']).select('id', 'matricule', 'last_name', 'first_name', 'department', 'hire_date', 'end_date');
    if (!req.can('rh:read')) {
      const me = await myEmployee(req);
      q.where(w => w.where('e.manager_id', me.id).orWhere('e.id', me.id));
      people.where(w => w.where('manager_id', me.id).orWhere('id', me.id));
    }
    const leaves = (await q).map(rh.serializeLeave).filter(l => l.start_date <= to && l.end_date >= from);
    res.json({ month, from, to, holidays: await rh.holidays(db, from, to), employees: await people, leaves });
  }));

  r.post('/leaves/preview', requirePermission('conges:manage'), ah(async (req, res) => {
    const { employee_id, ...data } = parse(leaveSchema.extend({ employee_id: z.number().int().positive() }), req.body);
    res.json(await rh.checkLeave(db, await rh.getEmployee(db, employee_id), data, { asHr: true }));
  }));
  r.post('/leaves', requirePermission('conges:manage'), ah(async (req, res) => {
    const { employee_id, approve, ...data } = parse(leaveSchema.extend({ employee_id: z.number().int().positive(), approve: z.boolean().optional() }), req.body);
    const e = await rh.getEmployee(db, employee_id);
    if (approve && !req.can('conges:approve')) throw new HttpError(403, 'Saisir une absence déjà approuvée demande le droit « Approuver les congés ».');
    if (e.user_id === req.user.id && req.user.role !== 'super_admin') throw new HttpError(403, 'Votre propre absence se demande depuis Mon espace.');
    if (data.document_id && !(await db('hr_documents').where({ id: data.document_id, employee_id }).first())) throw new HttpError(400, 'Justificatif introuvable.');
    res.status(201).json(await rh.createLeave(db, e, data, { user: req.user, asHr: true, approve: !!approve }));
  }));

  // ─── Dossiers du personnel ────────────────────────────────
  r.get('/employees', read, ah(async (req, res) => {
    const q = db('employees as e').leftJoin('users as u', 'u.id', 'e.user_id').leftJoin('projects as p', 'p.id', 'e.project_id').leftJoin('employees as m', 'm.id', 'e.manager_id')
      .select('e.*', 'u.name as user_name', 'p.name as project_name', 'm.last_name as manager_last', 'm.first_name as manager_first').orderBy(['e.last_name', 'e.first_name']);
    if (req.query.active !== 'all') q.where('e.active', req.query.active === '0' ? false : true);
    const settings = await rh.getSettings(db);
    const today = new Date().toISOString().slice(0, 10);
    const absent = (await db('hr_leaves').where('status', 'approuvee').select('employee_id', 'type', 'start_date', 'end_date'))
      .filter(l => isoDay(l.start_date) <= today && isoDay(l.end_date) >= today);
    const rows = await q;
    const out = [];
    for (const e of rows) {
      const n = rh.normEmployee(e);
      const b = await rh.balanceOf(db, n, { settings });
      const off = absent.find(l => l.employee_id === e.id);
      out.push({ ...paie.serializeEmployee(e, { withPay: req.can('paie:read') }), manager_name: e.manager_last ? `${e.manager_last} ${e.manager_first}` : null, leave_available: b.available, leave_balance: b.balance, absent: off ? LEAVE_TYPES[off.type]?.label : null });
    }
    res.json(out);
  }));

  // Bilan de départ d'un employé sorti : compte, matériel, dossiers encore à régler (service RH et direction)
  r.get('/employees/:id/departure', requirePermission('rh:read', 'direction:read'), ah(async (req, res) => {
    res.json(await departures.departureReport(db, await rh.getEmployee(db, idParam(req))));
  }));

  r.get('/employees/:id', ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    const level = await access(req, e);
    const year = yearOf(req.query.year);
    const withPay = req.can('paie:read');
    const [balance, leaves, adjustments, documents, career, objectives, reviews, manager, user] = await Promise.all([
      rh.balanceOf(db, e), rh.leaveQuery(db).where('l.employee_id', e.id).orderBy('l.start_date', 'desc'),
      db('hr_leave_adjustments as a').leftJoin('users as u', 'u.id', 'a.created_by').where('a.employee_id', e.id).orderBy('a.date', 'desc').select('a.*', 'u.name as created_by_name'),
      level === 'manager' ? [] : db('hr_documents as d').leftJoin('users as u', 'u.id', 'd.uploaded_by').where('d.employee_id', e.id).orderBy('d.created_at', 'desc').select('d.*', 'u.name as uploaded_by_name'),
      rh.careerOf(db, e.id, { withPay }), rh.objectivesOf(db, e, year), db('hr_reviews').where({ employee_id: e.id }).orderBy('year', 'desc'),
      e.manager_id ? db('employees').where({ id: e.manager_id }).first('id', 'last_name', 'first_name') : null,
      e.user_id ? db('users').where({ id: e.user_id }).first('id', 'name', 'email', 'role') : null,
    ]);
    res.json({
      access: level, year, employee: paie.serializeEmployee(e, { withPay }), manager, user, balance,
      leaves: leaves.map(rh.serializeLeave), adjustments: adjustments.map(a => ({ ...a, date: isoDay(a.date), days: Number(a.days) })),
      documents: documents.map(d => ({ ...d, expires_at: isoDay(d.expires_at), url: `/api/admin/erp/rh/documents/${d.id}/file` })), career, objectives, reviews,
    });
  }));

  // Fiche employé : même formulaire et même règle que Comptabilité › Employés (services/employees) ;
  // salaire et paiement restent au droit « Gérer les fiches salariés »
  r.patch('/employees/:id', requirePermission('rh:files', 'paie:employees'), ah(async (req, res) => {
    const { after } = await employees.update(db, idParam(req), parse(employees.employeeSchema.partial(), req.body), { user: req.user, can: p => req.can(p) });
    res.json(paie.serializeEmployee(after, { withPay: req.can('paie:read') }));
  }));

  r.post('/employees/:id/adjustments', requirePermission('conges:manage'), ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    if (e.user_id === req.user.id && req.user.role !== 'super_admin') throw new HttpError(403, 'Personne n’ajuste son propre solde de congés.');
    const data = parse(z.object({ date: day, days: z.number().min(-100).max(100).refine(v => v !== 0, 'Nombre de jours non nul'), label: z.string().trim().min(3).max(200) }), req.body);
    await db('hr_leave_adjustments').insert({ ...data, employee_id: e.id, created_by: req.user.id });
    res.status(201).json(await rh.balanceOf(db, e));
  }));
  r.delete('/adjustments/:id', requirePermission('conges:manage'), ah(async (req, res) => {
    const adj = await db('hr_leave_adjustments as a').join('employees as e', 'e.id', 'a.employee_id').where('a.id', idParam(req)).first('a.id', 'e.user_id');
    if (!adj) throw new HttpError(404, 'Ajustement introuvable.');
    if (adj.user_id === req.user.id && req.user.role !== 'super_admin') throw new HttpError(403, 'Personne n’ajuste son propre solde de congés.');
    await db('hr_leave_adjustments').where({ id: adj.id }).del();
    res.json({ ok: true });
  }));

  r.post('/employees/:id/career', requirePermission('rh:files'), ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    const data = parse(z.object({ date: day, kind: z.enum(Object.keys(CAREER_EVENTS)), label: z.string().trim().min(3).max(255) }), req.body);
    const [id] = await db('hr_career_events').insert({ ...data, employee_id: e.id, details: JSON.stringify({}), created_by: req.user.id });
    res.status(201).json(await db('hr_career_events').where({ id: insertedId(id) }).first());
  }));
  r.delete('/career/:id', requirePermission('rh:files'), ah(async (req, res) => {
    if (!(await db('hr_career_events').where({ id: idParam(req) }).del())) throw new HttpError(404, 'Événement introuvable.');
    res.json({ ok: true });
  }));

  // ─── Documents du dossier (privés) ────────────────────────
  async function saveDocument(req, employeeId, { kinds = Object.keys(DOCUMENT_KINDS) } = {}) {
    if (!req.file) throw new HttpError(400, 'Aucun fichier reçu.');
    const drop = () => fs.promises.unlink(req.file.path).catch(() => {});
    try {
      const data = parse(z.object({
        kind: z.enum(kinds).default('autre'), label: z.string().trim().max(160).optional(), expires_at: day.optional().nullable().or(z.literal('').transform(() => null)),
      }), req.body);
      const [id] = await db('hr_documents').insert({
        employee_id: employeeId, kind: data.kind, label: data.label || DOCUMENT_KINDS[data.kind], expires_at: data.expires_at || null,
        filename: req.file.filename, original_name: req.file.originalname.slice(0, 255), mime: req.file.mimetype, size: req.file.size, uploaded_by: req.user.id,
      });
      const d = await db('hr_documents').where({ id: insertedId(id) }).first();
      return { ...d, expires_at: isoDay(d.expires_at), url: `/api/admin/erp/rh/documents/${d.id}/file` };
    } catch (err) { await drop(); throw err; }
  }

  r.post('/employees/:id/documents', requirePermission('rh:files'), rh.documentUpload(), ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req)).catch(err => { if (req.file) fs.promises.unlink(req.file.path).catch(() => {}); throw err; });
    res.status(201).json(await saveDocument(req, e.id));
  }));

  r.get('/documents/:id/file', ah(async (req, res) => {
    const d = await db('hr_documents').where({ id: idParam(req) }).first();
    if (!d) throw new HttpError(404, 'Document introuvable.');
    const level = await access(req, await rh.getEmployee(db, d.employee_id));
    if (level === 'manager') throw new HttpError(403, 'Droits insuffisants.');
    res.set('Cache-Control', 'private, no-store');
    const inline = /^(application\/pdf|image\/)/.test(d.mime || '') ? 'inline' : 'attachment';
    res.set('Content-Disposition', `${inline}; filename*=UTF-8''${encodeURIComponent(d.original_name || d.filename)}`);
    res.sendFile(path.join(rh.hrFilesDir, path.basename(d.filename)), err => err && !res.headersSent && res.sendStatus(404));
  }));

  r.delete('/documents/:id', requirePermission('rh:files'), ah(async (req, res) => {
    const d = await db('hr_documents').where({ id: idParam(req) }).first();
    if (!d) throw new HttpError(404, 'Document introuvable.');
    await db('hr_documents').where({ id: d.id }).del();
    await fs.promises.unlink(path.join(rh.hrFilesDir, path.basename(d.filename))).catch(() => {});
    res.json({ ok: true });
  }));

  // ─── Objectifs et entretiens annuels ──────────────────────
  async function canCoach(req, e) {
    if (req.can('evaluation:write')) return true;
    if (await rh.isManagerOf(db, req.user.id, e)) return true;
    throw new HttpError(403, 'Seuls le responsable direct et le service RH fixent les objectifs.');
  }
  const objectiveSchema = z.object({
    year: z.number().int().min(2000).max(2100), title: z.string().trim().min(3).max(200), description: optText(1000),
    kpi_id: z.number().int().positive().optional().nullable(), metric: z.enum(Object.keys(OBJECTIVE_METRICS)).optional(),
    period: z.enum(Object.keys(OBJECTIVE_PERIODS)).default('annee'), period_index: z.number().int().min(1).max(12).optional().nullable(),
    target_value: z.number().int().min(0).optional().nullable(),
    weight: z.number().int().min(1).max(10).default(1), progress: z.number().int().min(0).max(100).optional(), status: z.enum(Object.keys(OBJECTIVE_STATUSES)).optional(),
    due_date: day.optional().nullable(),
  });
  /** Période affichée (?annee=&periode=annee|trimestre|mois&n=, ou ?year= pour une année). */
  const periodOf = req => {
    const p = parsePeriod(req.query);
    if (!p) throw new HttpError(400, 'Période invalide (année, trimestre 1 à 4 ou mois 1 à 12).');
    return p;
  };
  const scoreRow = (e, card) => ({
    employee_id: e.id, matricule: e.matricule, name: `${e.last_name} ${e.first_name}`, job_title: e.job_title, department: e.department,
    objectives: card.objectives, lines: card.lines, score: card.score, achieved: card.achieved, late: card.late,
  });

  /** Campagne de la période : objectifs et entretien de chaque employé (service RH) ou de l'équipe (responsable). */
  r.get('/objectives', ah(async (req, res) => {
    const P = periodOf(req);
    const q = db('employees').where({ active: true }).orderBy(['last_name', 'first_name']);
    if (!req.can('rh:read')) {
      const me = await myEmployee(req);
      q.where({ manager_id: me.id });
    }
    const people = (await q).map(rh.normEmployee);
    const reviews = await db('hr_reviews').where({ year: P.year });
    const out = [];
    const ctx = {};
    for (const e of people) out.push({ ...scoreRow(e, await performance.scorecard(db, e, P, ctx)), review: reviews.find(v => v.employee_id === e.id) || null });
    res.json({ year: P.year, period: P, rows: out });
  }));

  /** Performance par service (service RH : toute l'entreprise ; responsable : son équipe). */
  r.get('/performance', ah(async (req, res) => {
    const P = periodOf(req);
    let ids = null;
    if (!req.can('rh:read')) {
      const me = await myEmployee(req);
      ids = await db('employees').where({ manager_id: me.id }).pluck('id');
      if (!ids.length) throw new HttpError(403, 'Droits insuffisants.');
    }
    res.json(await performance.departmentReport(db, P, { employeeIds: ids }));
  }));

  /** Indicateurs individuels de la période (dossier, Mon espace), regroupés par famille selon le service. */
  r.get('/employees/:id/indicators', ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    await access(req, e);
    const P = periodOf(req);
    const card = await performance.scorecard(db, e, P, { withIndicators: true });
    res.json({ year: P.year, period: P, score: card.score, achieved: card.achieved, late: card.late, objectives: card.objectives.filter(o => o.status !== 'abandonne').length, groups: performance.indicatorGroups(e, card.values) });
  }));

  /** Objectifs d'un employé sur une période (lignes du score et objectifs un par un). */
  r.get('/employees/:id/objectives', ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    const level = await access(req, e);
    const P = periodOf(req);
    const card = await performance.scorecard(db, e, P);
    res.json({ ...scoreRow(e, card), period: P, access: level, has_account: !!e.user_id, has_project: !!e.project_id });
  }));

  /**
   * Courbes d'objectifs et de performance d'un employé : ?granularite=semaine|mois|trimestre|annee&du=AAAA-MM-JJ&au=AAAA-MM-JJ
   * (par défaut : l'année en cours, par mois).
   */
  r.get('/employees/:id/performance', ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    await access(req, e);
    const y = new Date().getFullYear();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.du || '') ? req.query.du : `${y}-01-01`;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.au || '') ? req.query.au : `${y}-12-31`;
    if (to < from) throw new HttpError(400, 'La fin de la période précède son début.');
    const g = String(req.query.granularite || 'mois');
    if (!performance.GRANULARITIES.includes(g)) throw new HttpError(400, 'Découpage : semaine, mois, trimestre ou année.');
    if (g === 'semaine' && (new Date(to) - new Date(from)) / 86400000 > 731) throw new HttpError(400, 'Par semaine : deux ans au plus.');
    res.json(await performance.series(db, e, { granularity: g, from, to }));
  }));

  r.post('/employees/:id/objectives', ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    await canCoach(req, e);
    const data = parse(objectiveSchema, req.body);
    // Indicateur du référentiel (ou, pour un appel qui ne donne que le calcul, l'indicateur de ce calcul)
    if (!data.kpi_id && data.metric && data.metric !== 'manuel') data.kpi_id = (await db('hr_kpis').where({ metric: data.metric }).first('id'))?.id || null;
    if (data.kpi_id) data.metric = (await kpiService.kpiFor(db, data.kpi_id, 'individuel')).metric;
    else data.metric = 'manuel';
    data.period_index = kpiService.checkPeriod(data.period, data.period_index ?? null);
    const metric = OBJECTIVE_METRICS[data.metric];
    if (metric.needs === 'user' && !e.user_id) throw new HttpError(400, `${metric.label} : reliez d’abord la fiche au compte du dashboard de l’employé.`);
    if (metric.needs === 'project' && !e.project_id) throw new HttpError(400, `${metric.label} : affectez d’abord l’employé à un programme.`);
    if (data.metric !== 'manuel' && data.target_value == null) throw new HttpError(400, 'Indiquez la valeur cible de l’indicateur.');
    if (!data.due_date) data.due_date = periodRange(data.year, data.period, data.period_index).to;
    const [id] = await db('hr_objectives').insert({ ...data, employee_id: e.id, created_by: req.user.id });
    if (data.metric === 'manuel' && data.progress) await db('hr_objective_checkins').insert({ objective_id: insertedId(id), date: new Date().toISOString().slice(0, 10), progress: data.progress, user_id: req.user.id });
    res.status(201).json(await db('hr_objectives').where({ id: insertedId(id) }).first());
  }));
  r.patch('/objectives/:id', ah(async (req, res) => {
    const o = await db('hr_objectives').where({ id: idParam(req) }).first();
    if (!o) throw new HttpError(404, 'Objectif introuvable.');
    await canCoach(req, await rh.getEmployee(db, o.employee_id));
    // Indicateur et période fixés à la création ; cible ou poids changés à la main : l'objectif n'est plus repris par le modèle
    const data = parse(objectiveSchema.partial().omit({ year: true, kpi_id: true, metric: true, period: true, period_index: true }), req.body);
    const changed = (data.target_value !== undefined && (data.target_value ?? null) !== (o.target_value == null ? null : Number(o.target_value))) || (data.weight !== undefined && data.weight !== o.weight);
    if (o.metric !== 'manuel' && data.target_value === null) throw new HttpError(400, 'Indiquez la valeur cible de l’indicateur.');
    await db.transaction(async trx => {
      await trx('hr_objectives').where({ id: o.id }).update({ ...data, ...(changed ? { adjusted: true } : {}), updated_at: new Date() });
      // Point d'avancement du jour (un seul par jour) : il trace la courbe des objectifs suivis à la main
      if (data.progress != null && data.progress !== Number(o.progress) && (data.metric || o.metric) === 'manuel') {
        const date = new Date().toISOString().slice(0, 10);
        const history = await trx('hr_objective_checkins').where({ objective_id: o.id }).select('id', 'date');
        // Premier suivi : l'avancement d'origine est daté du jour de création de l'objectif
        if (!history.length && Number(o.progress) > 0) await trx('hr_objective_checkins').insert({ objective_id: o.id, date: isoDay(o.created_at) || date, progress: o.progress, user_id: o.created_by });
        const same = history.find(c => isoDay(c.date) === date);
        if (same) await trx('hr_objective_checkins').where({ id: same.id }).update({ progress: data.progress, user_id: req.user.id, updated_at: new Date() });
        else await trx('hr_objective_checkins').insert({ objective_id: o.id, date, progress: data.progress, user_id: req.user.id });
      }
    });
    res.json(await db('hr_objectives').where({ id: o.id }).first());
  }));
  r.delete('/objectives/:id', ah(async (req, res) => {
    const o = await db('hr_objectives').where({ id: idParam(req) }).first();
    if (!o) throw new HttpError(404, 'Objectif introuvable.');
    await canCoach(req, await rh.getEmployee(db, o.employee_id));
    await db('hr_objectives').where({ id: o.id }).del();
    res.json({ ok: true });
  }));

  r.put('/employees/:id/reviews/:year', ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    await canCoach(req, e);
    const year = yearOf(req.params.year);
    const data = parse(z.object({
      rating: z.number().int().min(1).max(5).optional().nullable(), manager_comment: z.string().trim().max(5000).optional().nullable(),
      strengths: optText(1000), improvements: optText(1000), training_needs: optText(1000), finalize: z.boolean().optional(),
    }), req.body);
    const { finalize, ...fields } = data;
    const row = await db('hr_reviews').where({ employee_id: e.id, year }).first();
    if (row?.status === 'finalise') throw new HttpError(409, 'Entretien déjà finalisé.');
    if (finalize && !(fields.rating ?? row?.rating)) throw new HttpError(400, 'Donnez une appréciation globale avant de finaliser.');
    const patch = { ...fields, reviewer_id: req.user.id, updated_at: new Date(), ...(finalize ? { status: 'finalise', finalized_at: new Date() } : {}) };
    if (row) await db('hr_reviews').where({ id: row.id }).update(patch);
    else await db('hr_reviews').insert({ ...patch, employee_id: e.id, year });
    if (finalize) await db('hr_career_events').insert({ employee_id: e.id, date: new Date().toISOString().slice(0, 10), kind: 'autre', label: `Entretien annuel ${year} finalisé`, details: JSON.stringify({}), created_by: req.user.id });
    res.json(await db('hr_reviews').where({ employee_id: e.id, year }).first());
  }));

  // ─── Jours fériés et réglages ─────────────────────────────
  r.get('/holidays', ah(async (req, res) => {
    const year = yearOf(req.query.year);
    res.json(await rh.holidays(db, `${year}-01-01`, `${year}-12-31`));
  }));
  r.post('/holidays', requirePermission('rh:settings'), ah(async (req, res) => {
    const data = parse(z.object({ date: day, label: z.string().trim().min(2).max(80) }), req.body);
    if ((await rh.holidays(db)).some(h => h.date === data.date)) throw new HttpError(409, 'Ce jour est déjà férié.');
    const [id] = await db('hr_holidays').insert(data);
    res.status(201).json({ id: insertedId(id), ...data });
  }));
  r.post('/holidays/seed', requirePermission('rh:settings'), ah(async (req, res) => {
    const { year } = parse(z.object({ year: z.number().int().min(2000).max(2100) }), req.body);
    res.json({ created: await rh.seedHolidays(db, year) });
  }));
  r.delete('/holidays/:id', requirePermission('rh:settings'), ah(async (req, res) => {
    if (!(await db('hr_holidays').where({ id: idParam(req) }).del())) throw new HttpError(404, 'Jour férié introuvable.');
    res.json({ ok: true });
  }));

  r.get('/settings', read, ah(async (req, res) => res.json(await rh.getSettings(db))));
  r.put('/settings', requirePermission('rh:settings'), ah(async (req, res) => {
    const data = parse(z.object({
      accrual_per_month: z.number().min(0.1).max(5), seniority_bonus: z.array(z.tuple([z.number().int().min(1).max(50), z.number().min(0).max(30)])).max(12),
      child_bonus_days: z.number().min(0).max(5), child_bonus_young_age: z.number().int().min(0).max(30), child_bonus_from_child: z.number().int().min(1).max(10),
      round_up: z.boolean(), min_months_before_leave: z.number().int().min(0).max(24), allow_negative: z.boolean(), min_continuous_days: z.number().int().min(0).max(30),
      working_days: z.array(z.number().int().min(0).max(6)).min(1).max(7), permission_min_months: z.number().int().min(0).max(24), permission_max_days: z.number().int().min(0).max(60),
      maternity_days: z.number().int().min(0).max(365), paternity_days: z.number().int().min(0).max(60), approval: z.enum(['manager_then_rh', 'rh']),
      weekly_hours: z.number().min(1).max(60), hourly_divisor: z.number().min(1).max(400),
      overtime_tiers: z.array(z.tuple([z.number().int().min(1).max(40).nullable(), z.number().min(0).max(300)])).min(1).max(5),
      night_rate: z.number().min(0).max(300), sunday_rate: z.number().min(0).max(300), sunday_night_rate: z.number().min(0).max(300),
      night_start: z.number().int().min(0).max(23), night_end: z.number().int().min(0).max(23), overtime_year_cap: z.number().int().min(0).max(1000),
      geolocation: z.boolean(), break_minutes: z.number().int().min(0).max(180), break_after_hours: z.number().min(0).max(12),
      overtime_exempt_departments: z.array(z.enum(Object.keys(DEPARTMENTS))),
      expense_categories: z.record(z.object({ label: z.string().trim().min(2).max(80), account: z.string().trim().regex(/^\d{2,12}$/, 'Compte de 2 à 12 chiffres') })),
      expense_payable_account: z.string().trim().regex(/^\d{2,12}$/, 'Compte de 2 à 12 chiffres'),
    }).partial(), req.body);
    res.json(await rh.saveSettings(db, data));
  }));

  return r;
};
