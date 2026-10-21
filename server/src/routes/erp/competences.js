/**
 * ERP · RH › Compétences et formations (référence : Odoo Compétences, CV et formation) : référentiel de
 * compétences par type et niveaux, compétences et CV de chaque employé (l'employé complète le sien), habilitations
 * à renouveler, plan de formation (coût, FDFP, participants), organigramme tiré du responsable direct.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, isoDay, json } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { RESUME_KINDS, TRAINING_STATUSES } = require('../../lib/rh');
const rh = require('../../services/rh');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optDay = day.optional().nullable().or(z.literal('').transform(() => null));
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const insertedId = r => (typeof r === 'object' ? r.id : r);

module.exports = function competencesRoutes(db) {
  const r = express.Router();
  const read = requirePermission('rh:read');
  const write = requirePermission('formation:write');

  /** Le service RH, ou l'employé pour son propre CV et ses compétences. */
  async function editable(req, employeeId) {
    const e = await rh.getEmployee(db, employeeId);
    const level = await rh.accessLevel(db, req, e, 'formation:write');
    if (level === 'manager') throw new HttpError(403, 'Seuls l’employé et le service RH modifient ce profil.');
    return e;
  }

  // ─── Référentiel ──────────────────────────────────────────
  r.get('/skills', ah(async (req, res) => {
    const [types, skills] = await Promise.all([db('hr_skill_types').orderBy('name'), db('hr_skills').orderBy('name')]);
    res.json(types.map(t => ({ ...t, levels: json(t.levels, []), skills: skills.filter(s => s.type_id === t.id) })));
  }));
  r.post('/skill-types', write, ah(async (req, res) => {
    const data = parse(z.object({ name: z.string().trim().min(2).max(80), levels: z.array(z.string().trim().min(1).max(40)).min(2).max(8) }), req.body);
    if (await db('hr_skill_types').where({ name: data.name }).first()) throw new HttpError(409, 'Ce type existe déjà.');
    const [id] = await db('hr_skill_types').insert({ name: data.name, levels: JSON.stringify(data.levels) });
    res.status(201).json({ id: insertedId(id), ...data, skills: [] });
  }));
  r.patch('/skill-types/:id', write, ah(async (req, res) => {
    const data = parse(z.object({ name: z.string().trim().min(2).max(80), levels: z.array(z.string().trim().min(1).max(40)).min(2).max(8) }).partial(), req.body);
    const t = await db('hr_skill_types').where({ id: idParam(req) }).first();
    if (!t) throw new HttpError(404, 'Type introuvable.');
    if (data.levels) {
      const max = await db('hr_employee_skills as es').join('hr_skills as s', 's.id', 'es.skill_id').where('s.type_id', t.id).max({ m: 'es.level' }).first();
      if (max?.m != null && Number(max.m) >= data.levels.length) throw new HttpError(409, 'Des employés ont un niveau qui disparaîtrait : gardez au moins autant de niveaux.');
    }
    await db('hr_skill_types').where({ id: t.id }).update({ ...data, ...(data.levels ? { levels: JSON.stringify(data.levels) } : {}) });
    res.json({ ok: true });
  }));
  r.post('/skills', write, ah(async (req, res) => {
    const data = parse(z.object({ type_id: z.number().int().positive(), name: z.string().trim().min(2).max(80) }), req.body);
    if (await db('hr_skills').where(data).first()) throw new HttpError(409, 'Cette compétence existe déjà.');
    const [id] = await db('hr_skills').insert(data);
    res.status(201).json({ id: insertedId(id), ...data });
  }));
  r.delete('/skills/:id', write, ah(async (req, res) => {
    if (await db('hr_employee_skills').where({ skill_id: idParam(req) }).first()) throw new HttpError(409, 'Compétence attribuée à des employés : retirez-la d’abord de leur profil.');
    await db('hr_skills').where({ id: idParam(req) }).del();
    res.json({ ok: true });
  }));

  // ─── Profil d'un employé : compétences et CV ──────────────
  async function profile(employeeId) {
    const [skills, resume] = await Promise.all([
      db('hr_employee_skills as es').join('hr_skills as s', 's.id', 'es.skill_id').join('hr_skill_types as t', 't.id', 's.type_id').where('es.employee_id', employeeId)
        .orderBy(['t.name', 's.name']).select('es.*', 's.name as skill_name', 't.id as type_id', 't.name as type_name', 't.levels'),
      db('hr_resume_lines').where({ employee_id: employeeId }).orderBy([{ column: 'start_date', order: 'desc' }, { column: 'id', order: 'desc' }]),
    ]);
    return {
      skills: skills.map(s => { const levels = json(s.levels, []); return { ...s, levels: undefined, level_label: levels[s.level], level_count: levels.length, expires_at: isoDay(s.expires_at) }; }),
      resume: resume.map(l => ({ ...l, start_date: isoDay(l.start_date), end_date: isoDay(l.end_date), kind_label: RESUME_KINDS[l.kind] })),
    };
  }
  r.get('/employees/:id/profile', ah(async (req, res) => {
    const e = await rh.getEmployee(db, idParam(req));
    await rh.accessLevel(db, req, e);
    res.json(await profile(e.id));
  }));
  r.put('/employees/:id/skills/:skillId', ah(async (req, res) => {
    const e = await editable(req, idParam(req));
    const skillId = Number(req.params.skillId);
    const s = await db('hr_skills as s').join('hr_skill_types as t', 't.id', 's.type_id').where('s.id', skillId).first('s.id', 't.levels');
    if (!s) throw new HttpError(404, 'Compétence introuvable.');
    const data = parse(z.object({ level: z.number().int().min(0).max(json(s.levels, []).length - 1), expires_at: optDay }), req.body);
    const existing = await db('hr_employee_skills').where({ employee_id: e.id, skill_id: skillId }).first();
    if (existing) await db('hr_employee_skills').where({ id: existing.id }).update({ ...data, updated_at: new Date() });
    else await db('hr_employee_skills').insert({ ...data, employee_id: e.id, skill_id: skillId });
    res.json(await profile(e.id));
  }));
  r.delete('/employees/:id/skills/:skillId', ah(async (req, res) => {
    const e = await editable(req, idParam(req));
    await db('hr_employee_skills').where({ employee_id: e.id, skill_id: Number(req.params.skillId) }).del();
    res.json(await profile(e.id));
  }));
  const resumeSchema = z.object({
    kind: z.enum(Object.keys(RESUME_KINDS)), title: z.string().trim().min(2).max(200), organisation: optText(160),
    start_date: optDay, end_date: optDay, description: optText(1000),
  });
  r.post('/employees/:id/resume', ah(async (req, res) => {
    const e = await editable(req, idParam(req));
    const data = parse(resumeSchema, req.body);
    if (data.start_date && data.end_date && data.end_date < data.start_date) throw new HttpError(400, 'La fin précède le début.');
    await db('hr_resume_lines').insert({ ...data, employee_id: e.id });
    res.status(201).json(await profile(e.id));
  }));
  r.delete('/resume/:id', ah(async (req, res) => {
    const l = await db('hr_resume_lines').where({ id: idParam(req) }).first();
    if (!l) throw new HttpError(404, 'Ligne introuvable.');
    await editable(req, l.employee_id);
    await db('hr_resume_lines').where({ id: l.id }).del();
    res.json(await profile(l.employee_id));
  }));

  /** Matrice des compétences : qui sait faire quoi, à quel niveau (recherche d'un profil pour un chantier). */
  r.get('/skills/matrix', read, ah(async (req, res) => {
    const q = db('hr_employee_skills as es').join('employees as e', 'e.id', 'es.employee_id').join('hr_skills as s', 's.id', 'es.skill_id').join('hr_skill_types as t', 't.id', 's.type_id')
      .where('e.active', true).select('es.employee_id', 'es.skill_id', 'es.level', 'es.expires_at', 'e.last_name', 'e.first_name', 'e.department', 's.name as skill_name', 't.levels');
    if (req.query.skill_id) q.where('es.skill_id', Number(req.query.skill_id));
    res.json((await q).map(x => ({ ...x, expires_at: isoDay(x.expires_at), level_label: json(x.levels, [])[x.level], levels: undefined, employee_name: `${x.last_name} ${x.first_name}` })));
  }));

  // ─── Plan de formation ────────────────────────────────────
  const trainingSchema = z.object({
    title: z.string().trim().min(3).max(200), provider: optText(160), kind: z.enum(['interne', 'externe']), skill_id: z.number().int().positive().optional().nullable(),
    start_date: day, end_date: day, hours: z.number().min(0).max(2000).optional().nullable(), location: optText(160), cost: z.number().int().min(0).default(0),
    fdfp: z.boolean().optional(), status: z.enum(Object.keys(TRAINING_STATUSES)).optional(),
  });
  async function trainingRows(where = {}) {
    const rows = await db('hr_trainings as t').leftJoin('hr_skills as s', 's.id', 't.skill_id').where(where).orderBy('t.start_date', 'desc').select('t.*', 's.name as skill_name');
    const parts = await db('hr_training_participants as p').join('employees as e', 'e.id', 'p.employee_id').whereIn('p.training_id', rows.map(t => t.id))
      .select('p.*', 'e.last_name', 'e.first_name', 'e.matricule');
    return rows.map(t => ({
      ...t, start_date: isoDay(t.start_date), end_date: isoDay(t.end_date), hours: t.hours == null ? null : Number(t.hours), cost: Number(t.cost), fdfp: !!t.fdfp,
      status_label: TRAINING_STATUSES[t.status], participants: parts.filter(p => p.training_id === t.id).map(p => ({ ...p, employee_name: `${p.last_name} ${p.first_name}` })),
    }));
  }
  r.get('/trainings', ah(async (req, res) => {
    if (req.can('rh:read')) return res.json(await trainingRows());
    const me = await rh.employeeOf(db, req.user.id);
    if (!me) throw new HttpError(403, 'Droits insuffisants.');
    const mine = await db('hr_training_participants').where({ employee_id: me.id }).pluck('training_id');
    res.json((await trainingRows()).filter(t => mine.includes(t.id)));
  }));
  r.post('/trainings', write, ah(async (req, res) => {
    const data = parse(trainingSchema, req.body);
    if (data.end_date < data.start_date) throw new HttpError(400, 'La fin précède le début.');
    const [id] = await db('hr_trainings').insert(data);
    res.status(201).json((await trainingRows({ 't.id': insertedId(id) }))[0]);
  }));
  r.patch('/trainings/:id', write, ah(async (req, res) => {
    const t = await db('hr_trainings').where({ id: idParam(req) }).first();
    if (!t) throw new HttpError(404, 'Formation introuvable.');
    if (t.status === 'realisee') throw new HttpError(409, 'Formation réalisée : elle figure déjà aux dossiers.');
    const data = parse(trainingSchema.partial().omit({ status: true }), req.body);
    await db('hr_trainings').where({ id: t.id }).update({ ...data, updated_at: new Date() });
    res.json((await trainingRows({ 't.id': t.id }))[0]);
  }));
  r.put('/trainings/:id/participants', write, ah(async (req, res) => {
    const t = await db('hr_trainings').where({ id: idParam(req) }).first();
    if (!t) throw new HttpError(404, 'Formation introuvable.');
    if (t.status === 'realisee') throw new HttpError(409, 'Formation réalisée.');
    const { employee_ids } = parse(z.object({ employee_ids: z.array(z.number().int().positive()).max(200) }), req.body);
    await db.transaction(async trx => {
      await trx('hr_training_participants').where({ training_id: t.id }).whereNotIn('employee_id', employee_ids).del();
      const have = await trx('hr_training_participants').where({ training_id: t.id }).pluck('employee_id');
      const add = employee_ids.filter(id => !have.includes(id));
      if (add.length) await trx('hr_training_participants').insert(add.map(employee_id => ({ training_id: t.id, employee_id })));
    });
    res.json((await trainingRows({ 't.id': t.id }))[0]);
  }));
  /**
   * Clôture : présence de chaque participant ; pour les présents, ligne au CV, événement « Formation » au
   * dossier et compétence visée ajoutée (niveau de départ) si elle manque.
   */
  r.post('/trainings/:id/complete', write, ah(async (req, res) => {
    const t = await db('hr_trainings').where({ id: idParam(req) }).first();
    if (!t) throw new HttpError(404, 'Formation introuvable.');
    if (t.status !== 'planifiee') throw new HttpError(409, 'Formation déjà close.');
    const { attendance } = parse(z.object({ attendance: z.array(z.object({ employee_id: z.number().int().positive(), present: z.boolean(), evaluation: optText(500) })) }), req.body);
    await db.transaction(async trx => {
      for (const a of attendance) {
        const p = await trx('hr_training_participants').where({ training_id: t.id, employee_id: a.employee_id }).first();
        if (!p) throw new HttpError(400, 'Participant non inscrit.');
        await trx('hr_training_participants').where({ id: p.id }).update({ status: a.present ? 'present' : 'absent', evaluation: a.evaluation, updated_at: new Date() });
        if (!a.present) continue;
        await trx('hr_resume_lines').insert({ employee_id: a.employee_id, kind: t.kind === 'interne' ? 'interne' : 'formation', title: t.title, organisation: t.provider || 'SIIPAF', start_date: isoDay(t.start_date), end_date: isoDay(t.end_date) });
        await trx('hr_career_events').insert({ employee_id: a.employee_id, date: isoDay(t.end_date), kind: 'formation', label: `Formation suivie : ${t.title}`, details: JSON.stringify({ training_id: t.id }) });
        if (t.skill_id && !(await trx('hr_employee_skills').where({ employee_id: a.employee_id, skill_id: t.skill_id }).first())) {
          await trx('hr_employee_skills').insert({ employee_id: a.employee_id, skill_id: t.skill_id, level: 0 });
        }
      }
      await trx('hr_trainings').where({ id: t.id }).update({ status: 'realisee', updated_at: new Date() });
    });
    res.json((await trainingRows({ 't.id': t.id }))[0]);
  }));
  r.post('/trainings/:id/cancel', write, ah(async (req, res) => {
    const n = await db('hr_trainings').where({ id: idParam(req), status: 'planifiee' }).update({ status: 'annulee', updated_at: new Date() });
    if (!n) throw new HttpError(409, 'Seule une formation planifiée s’annule.');
    res.json({ ok: true });
  }));

  /**
   * Bilan de l'année : coût des formations et heures, comparés à la taxe de formation continue (FDFP) versée
   * avec les salaires — repère pour demander le financement des actions de formation.
   */
  r.get('/trainings/summary', read, ah(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const rows = (await trainingRows()).filter(t => t.start_date.startsWith(String(year)) && t.status !== 'annulee');
    const slips = await db('payslips as s').join('payroll_runs as r', 'r.id', 's.run_id').where('r.period', 'like', `${year}-%`).whereNot('r.status', 'brouillon').select('s.result');
    const fdfpTax = req.can('paie:read') ? slips.reduce((t, s) => t + (json(s.result, {})?.employer?.training || 0), 0) : null;
    res.json({
      year, trainings: rows.length, done: rows.filter(t => t.status === 'realisee').length, cost: rows.reduce((t, x) => t + x.cost, 0),
      hours: rows.reduce((t, x) => t + (x.hours || 0) * x.participants.filter(p => p.status !== 'absent').length, 0),
      fdfp_requested: rows.filter(t => t.fdfp).reduce((t, x) => t + x.cost, 0), training_tax_paid: fdfpTax,
    });
  }));

  // ─── Organigramme ─────────────────────────────────────────
  r.get('/orgchart', ah(async (req, res) => {
    const people = await db('employees as e').leftJoin('projects as p', 'p.id', 'e.project_id').where('e.active', true)
      .select('e.id', 'e.matricule', 'e.last_name', 'e.first_name', 'e.job_title', 'e.department', 'e.manager_id', 'p.name as project_name').orderBy(['e.last_name', 'e.first_name']);
    const ids = new Set(people.map(p => p.id));
    // Garde contre une hiérarchie en boucle saisie avant les contrôles
    const node = (p, seen = new Set()) => ({ ...p, name: `${p.last_name} ${p.first_name}`, reports: seen.has(p.id) ? [] : people.filter(c => c.manager_id === p.id).map(c => node(c, new Set([...seen, p.id]))) });
    res.json(people.filter(p => !p.manager_id || !ids.has(p.manager_id)).map(p => node(p)));
  }));

  return r;
};
