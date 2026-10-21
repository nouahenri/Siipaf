/** ERP · RH › Recrutement : postes, candidatures par étapes, entretiens, embauche. */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { RECRUIT_STAGES, RECRUIT_SOURCES, REFUSE_REASONS, JOB_STATUSES } = require('../../lib/rh');
const { CONTRACT_TYPES, DEPARTMENTS } = require('../../lib/paie');
const recrutement = require('../../services/recrutement');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const optNum = z.preprocess(v => (v === '' || v == null || v === 'null' ? null : Number(v)), z.number().int().min(0).nullable());
const insertedId = r => (typeof r === 'object' ? r.id : r);

module.exports = function recrutementRoutes(db) {
  const r = express.Router();
  const read = requirePermission('rh:read');
  const write = requirePermission('recrutement:write');
  const cleanup = req => req.file && fs.promises.unlink(req.file.path).catch(() => {});

  // ─── Postes ───────────────────────────────────────────────
  const jobSchema = z.object({
    title: z.string().trim().min(3).max(160), department: z.enum(Object.keys(DEPARTMENTS)), project_id: z.number().int().positive().optional().nullable(),
    contract_type: z.enum(Object.keys(CONTRACT_TYPES)), openings: z.number().int().min(1).max(50), location: optText(120), description: optText(10000),
    status: z.enum(Object.keys(JOB_STATUSES)).optional(), published: z.boolean().optional(), recruiter_id: z.number().int().positive().optional().nullable(),
    closing_date: day.optional().nullable(),
  });
  r.get('/jobs', read, ah(async (req, res) => res.json(await recrutement.jobs(db, { all: req.query.all === '1' }))));
  r.post('/jobs', write, ah(async (req, res) => {
    const [id] = await db('hr_jobs').insert(parse(jobSchema, req.body));
    res.status(201).json(recrutement.serializeJob(await db('hr_jobs').where({ id: insertedId(id) }).first()));
  }));
  r.patch('/jobs/:id', write, ah(async (req, res) => {
    const data = parse(jobSchema.partial(), req.body);
    if (data.status && data.status !== 'ouvert') data.published = false;
    if (!(await db('hr_jobs').where({ id: idParam(req) }).update({ ...data, updated_at: new Date() }))) throw new HttpError(404, 'Poste introuvable.');
    res.json(recrutement.serializeJob(await db('hr_jobs').where({ id: idParam(req) }).first()));
  }));

  // ─── Candidatures ─────────────────────────────────────────
  r.get('/applicants', read, ah(async (req, res) => {
    const q = recrutement.applicantQuery(db).orderBy('a.created_at', 'desc');
    if (req.query.job_id === 'none') q.whereNull('a.job_id');
    else if (req.query.job_id) q.where('a.job_id', Number(req.query.job_id));
    if (req.query.refused !== '1') q.whereNull('a.refuse_reason');
    else q.whereNotNull('a.refuse_reason');
    if (req.query.q) q.where(w => w.where('a.name', 'like', `%${req.query.q}%`).orWhere('a.email', 'like', `%${req.query.q}%`));
    res.json({ stages: RECRUIT_STAGES, rows: (await q.limit(500)).map(recrutement.serializeApplicant) });
  }));

  const applicantSchema = z.object({
    job_id: z.preprocess(v => (v === '' || v == null || v === 'null' ? null : Number(v)), z.number().int().positive().nullable()).optional(),
    name: z.string().trim().min(3).max(160), email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)),
    phone: optText(40), source: z.enum(Object.keys(RECRUIT_SOURCES)).optional(), expected_salary: optNum.optional(), proposed_salary: optNum.optional(),
    available_from: day.optional().nullable().or(z.literal('').transform(() => null)), message: optText(5000),
    rating: z.preprocess(v => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(0).max(3)).optional(),
    interviewer_id: z.preprocess(v => (v === '' || v == null || v === 'null' ? null : Number(v)), z.number().int().positive().nullable()).optional(),
    interview_at: z.string().optional().nullable().transform(v => (v ? new Date(v) : null)),
  });
  r.post('/applicants', write, recrutement.cvUpload(), ah(async (req, res) => {
    try {
      const id = await recrutement.createApplicant(db, parse(applicantSchema, req.body), { file: req.file, userId: req.user.id });
      res.status(201).json(await recrutement.applicant(db, id));
    } catch (e) { await cleanup(req); throw e; }
  }));
  r.get('/applicants/:id', read, ah(async (req, res) => res.json(await recrutement.applicant(db, idParam(req)))));
  r.patch('/applicants/:id', write, recrutement.cvUpload(), ah(async (req, res) => {
    try {
      const a = await db('hr_applicants').where({ id: idParam(req) }).first();
      if (!a) throw new HttpError(404, 'Candidature introuvable.');
      const data = parse(applicantSchema.partial(), req.body);
      const patch = { ...data, updated_at: new Date() };
      if (req.file) {
        if (a.cv_filename) await fs.promises.unlink(path.join(recrutement.cvDir, path.basename(a.cv_filename))).catch(() => {});
        Object.assign(patch, { cv_filename: req.file.filename, cv_name: req.file.originalname.slice(0, 255), cv_mime: req.file.mimetype });
      }
      await db('hr_applicants').where({ id: a.id }).update(patch);
      if (data.interview_at && String(data.interview_at) !== String(a.interview_at)) {
        await recrutement.log(db, a.id, { kind: 'entretien', summary: `Entretien prévu le ${data.interview_at.toISOString().slice(0, 16).replace('T', ' à ')}`, userId: req.user.id });
      }
      res.json(await recrutement.applicant(db, a.id));
    } catch (e) { await cleanup(req); throw e; }
  }));
  r.post('/applicants/:id/move', write, ah(async (req, res) => {
    const data = parse(z.object({
      stage: z.enum(Object.keys(RECRUIT_STAGES)).optional(), refuse_reason: z.enum(Object.keys(REFUSE_REASONS)).optional(), note: optText(2000),
    }).refine(v => v.stage || v.refuse_reason || v.note, 'Étape, motif de refus ou note attendu.'), req.body);
    res.json(await recrutement.move(db, idParam(req), data, req.user.id));
  }));
  r.post('/applicants/:id/hire', write, ah(async (req, res) => {
    const data = parse(z.object({
      hire_date: day, base_salary: z.number().int().min(0).optional(), trial_end_date: day.optional().nullable(),
      contract_type: z.enum(Object.keys(CONTRACT_TYPES)).optional(), job_title: z.string().trim().min(2).max(120).optional(),
    }), req.body);
    const employeeId = await recrutement.hire(db, idParam(req), data, req.user.id);
    res.status(201).json({ employee_id: employeeId, applicant: await recrutement.applicant(db, idParam(req)) });
  }));
  r.delete('/applicants/:id', write, ah(async (req, res) => {
    const a = await db('hr_applicants').where({ id: idParam(req) }).first();
    if (!a) throw new HttpError(404, 'Candidature introuvable.');
    if (a.employee_id) throw new HttpError(409, 'Candidat embauché : la candidature reste au dossier.');
    await db('hr_applicants').where({ id: a.id }).del();
    if (a.cv_filename) await fs.promises.unlink(path.join(recrutement.cvDir, path.basename(a.cv_filename))).catch(() => {});
    res.json({ ok: true });
  }));
  r.get('/applicants/:id/cv', read, ah(async (req, res) => {
    const a = await db('hr_applicants').where({ id: idParam(req) }).first();
    if (!a?.cv_filename) throw new HttpError(404, 'Pas de CV.');
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.cv_name || 'cv')}`);
    res.sendFile(path.join(recrutement.cvDir, path.basename(a.cv_filename)), err => err && !res.headersSent && res.sendStatus(404));
  }));

  return r;
};

/** Page carrières du site : offres publiées et dépôt de candidature (anti-spam : champ piège et limite de débit). */
module.exports.publicCareers = function publicCareers(db) {
  const rateLimit = require('express-rate-limit');
  const { notifyTeam } = require('../../lib/mailer');
  const isTest = process.env.NODE_ENV === 'test';
  const r = express.Router();
  const cleanup = req => req.file && fs.promises.unlink(req.file.path).catch(() => {});
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: isTest ? 1000 : 10, standardHeaders: true, legacyHeaders: false });

  r.get('/emplois', ah(async (req, res) => {
    const rows = await db('hr_jobs').where({ published: true, status: 'ouvert' }).orderBy('created_at', 'desc')
      .select('id', 'title', 'department', 'contract_type', 'location', 'description', 'closing_date', 'openings');
    res.json(rows.map(j => ({ ...recrutement.serializeJob(j), department_label: DEPARTMENTS[j.department], contract_label: CONTRACT_TYPES[j.contract_type] })));
  }));

  r.post('/candidatures', limiter, recrutement.cvUpload(), ah(async (req, res) => {
    try {
      const data = parse(z.object({
        job_id: z.preprocess(v => (v === '' || v == null ? null : Number(v)), z.number().int().positive().nullable()),
        name: z.string().trim().min(3, 'Nom complet').max(160), email: z.string().trim().toLowerCase().email('E-mail invalide'),
        phone: z.string().trim().min(8, 'Téléphone').max(40), message: optText(3000), website: z.string().max(0, 'Spam').optional(),
      }), req.body);
      if (!req.file) throw new HttpError(400, 'Joignez votre CV (PDF ou Word).');
      const { website, ...fields } = data;
      const id = await recrutement.createApplicant(db, { ...fields, source: fields.job_id ? 'site_web' : 'spontanee' }, { file: req.file, fromSite: true });
      const job = fields.job_id ? await db('hr_jobs').where({ id: fields.job_id }).first('title') : null;
      notifyTeam(`Nouvelle candidature : ${fields.name}`, `${fields.name} a postulé ${job ? `au poste « ${job.title} »` : '(candidature spontanée)'} depuis le site.\nÀ traiter dans l’ERP › RH › Recrutement.`);
      res.status(201).json({ ok: true, id });
    } catch (e) { await cleanup(req); throw e; }
  }));
  return r;
};
