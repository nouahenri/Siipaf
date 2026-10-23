/**
 * ERP · RH › Recrutement (référence : Odoo Recrutement) : postes ouverts (publiables sur le site), candidatures
 * suivies par étapes avec historique, entretiens, refus motivés ; l'embauche crée la fiche employé (paie, RH)
 * et clôt le poste quand tous les postes sont pourvus.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, isoDay, isoTime } = require('../lib/http');
const { uploadsDir } = require('../config');
const { RECRUIT_STAGES, REFUSE_REASONS, RECRUIT_SOURCES } = require('../lib/rh');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const cvDir = path.join(uploadsDir, 'private', 'cv');
const CV_MIME = { 'application/pdf': '.pdf', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'image/jpeg': '.jpg', 'image/png': '.png' };
const STAGE_ORDER = Object.keys(RECRUIT_STAGES);

function cvUpload() {
  fs.mkdirSync(cvDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({ destination: cvDir, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${CV_MIME[file.mimetype]}`) }),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(CV_MIME[file.mimetype] ? null : new HttpError(400, 'CV : PDF, Word ou image.'), !!CV_MIME[file.mimetype]),
  }).single('cv');
}

const serializeJob = j => ({ ...j, published: !!j.published, closing_date: isoDay(j.closing_date) });
const serializeApplicant = a => ({
  ...a, available_from: isoDay(a.available_from), interview_at: isoTime(a.interview_at), stage_label: RECRUIT_STAGES[a.stage] || a.stage,
  source_label: RECRUIT_SOURCES[a.source] || a.source, refuse_label: a.refuse_reason ? REFUSE_REASONS[a.refuse_reason] : null,
  expected_salary: a.expected_salary == null ? null : Number(a.expected_salary), proposed_salary: a.proposed_salary == null ? null : Number(a.proposed_salary),
  cv_url: a.cv_filename ? `/api/admin/erp/rh/applicants/${a.id}/cv` : null, cv_filename: undefined,
});

async function log(trx, applicantId, { kind, summary, note = null, userId = null }) {
  await trx('hr_applicant_logs').insert({ applicant_id: applicantId, kind, summary: summary.slice(0, 255), note, user_id: userId });
}

async function jobs(db, { all = false } = {}) {
  const rows = await db('hr_jobs as j').leftJoin('users as u', 'u.id', 'j.recruiter_id').leftJoin('projects as p', 'p.id', 'j.project_id')
    .select('j.*', 'u.name as recruiter_name', 'p.name as project_name').orderBy([{ column: 'j.status' }, { column: 'j.created_at', order: 'desc' }]);
  const counts = await db('hr_applicants').groupBy('job_id', 'stage').select('job_id', 'stage').count({ n: '*' });
  const refused = await db('hr_applicants').whereNotNull('refuse_reason').groupBy('job_id').select('job_id').count({ n: '*' });
  return rows.filter(j => all || j.status !== 'ferme').map(j => {
    const by = Object.fromEntries(counts.filter(c => c.job_id === j.id).map(c => [c.stage, Number(c.n)]));
    const total = Object.values(by).reduce((t, n) => t + n, 0);
    return { ...serializeJob(j), applicants: total - Number(refused.find(r => r.job_id === j.id)?.n || 0), hired: by.embauche || 0, by_stage: by };
  });
}

const applicantQuery = db => db('hr_applicants as a').leftJoin('hr_jobs as j', 'j.id', 'a.job_id').leftJoin('users as u', 'u.id', 'a.interviewer_id')
  .select('a.*', 'j.title as job_title', 'u.name as interviewer_name');

async function applicant(db, id) {
  const a = await applicantQuery(db).where('a.id', id).first();
  if (!a) throw new HttpError(404, 'Candidature introuvable.');
  const logs = await db('hr_applicant_logs as l').leftJoin('users as u', 'u.id', 'l.user_id').where('l.applicant_id', id).orderBy('l.id', 'desc').select('l.*', 'u.name as user_name');
  return { ...serializeApplicant(a), logs: logs.map(l => ({ ...l, created_at: isoTime(l.created_at) })) };
}

async function createApplicant(db, data, { file = null, userId = null, fromSite = false }) {
  if (data.job_id) {
    const j = await db('hr_jobs').where({ id: data.job_id }).first();
    if (!j || (fromSite && (!j.published || j.status !== 'ouvert'))) throw new HttpError(404, 'Offre d’emploi introuvable ou close.');
  }
  return db.transaction(async trx => {
    const [id] = await trx('hr_applicants').insert({
      ...data, stage: 'nouveau', ...(file ? { cv_filename: file.filename, cv_name: file.originalname.slice(0, 255), cv_mime: file.mimetype } : {}),
    });
    const newId = insertedId(id);
    await log(trx, newId, { kind: 'etape', summary: fromSite ? 'Candidature reçue depuis le site' : 'Candidature enregistrée', userId });
    return newId;
  });
}

/** Changement d'étape (avant ou arrière), refus motivé, réouverture ; tout est historisé. */
async function move(db, id, { stage = null, refuse_reason = null, note = null }, userId) {
  const a = await db('hr_applicants').where({ id }).first();
  if (!a) throw new HttpError(404, 'Candidature introuvable.');
  if (a.employee_id) throw new HttpError(409, 'Candidat déjà embauché.');
  await db.transaction(async trx => {
    if (refuse_reason) {
      await trx('hr_applicants').where({ id }).update({ refuse_reason, updated_at: new Date() });
      await log(trx, id, { kind: 'etape', summary: `Candidature refusée : ${REFUSE_REASONS[refuse_reason]}`, note, userId });
    } else if (stage) {
      if (stage === 'embauche') throw new HttpError(400, 'Utilisez « Embaucher » pour créer la fiche employé.');
      await trx('hr_applicants').where({ id }).update({ stage, refuse_reason: null, updated_at: new Date() });
      await log(trx, id, { kind: 'etape', summary: a.refuse_reason ? `Candidature réactivée — ${RECRUIT_STAGES[stage]}` : `${RECRUIT_STAGES[a.stage]} → ${RECRUIT_STAGES[stage]}`, note, userId });
    } else if (note) {
      await log(trx, id, { kind: 'note', summary: 'Note', note, userId });
    }
  });
  return applicant(db, id);
}

/**
 * Embauche : crée la fiche employé (matricule, poste, service, contrat, salaire proposé, fin d'essai) à partir de
 * la candidature et du poste, ajoute l'événement « Embauche » au dossier et clôt le poste s'il est pourvu.
 */
async function hire(db, id, { hire_date, base_salary, trial_end_date = null, contract_type = null, job_title = null }, userId) {
  const paie = require('./paie');
  const a = await db('hr_applicants').where({ id }).first();
  if (!a) throw new HttpError(404, 'Candidature introuvable.');
  if (a.employee_id) throw new HttpError(409, 'Candidat déjà embauché.');
  if (a.refuse_reason) throw new HttpError(409, 'Candidature refusée : réactivez-la d’abord.');
  if (STAGE_ORDER.indexOf(a.stage) < STAGE_ORDER.indexOf('proposition')) throw new HttpError(400, 'Faites d’abord une proposition d’embauche.');
  const job = a.job_id ? await db('hr_jobs').where({ id: a.job_id }).first() : null;
  const [first, ...rest] = a.name.trim().split(/\s+/);
  return db.transaction(async trx => {
    // Le poste recruté rejoint la liste des postes (RH › Réglages)
    const post = await require('./positions').resolve(trx, { job_title: job_title || job?.title || 'Employé(e)', department: job?.department || 'administratif' });
    const title = post.job_title;
    const [eid] = await trx('employees').insert({
      matricule: await paie.nextMatricule(trx), last_name: rest.length ? rest.join(' ') : first, first_name: first, email: a.email, phone: a.phone,
      job_title: title, position_id: post.position_id, department: job?.department || 'administratif', contract_type: contract_type || job?.contract_type || 'cdi', project_id: job?.project_id || null,
      hire_date, trial_end_date, base_salary: base_salary ?? Number(a.proposed_salary || 0),
    });
    const employeeId = insertedId(eid);
    await trx('hr_career_events').insert({ employee_id: employeeId, date: hire_date, kind: 'embauche', label: `Embauche : ${title} (recrutement)`, details: JSON.stringify({ applicant_id: a.id }), created_by: userId });
    await trx('hr_applicants').where({ id }).update({ stage: 'embauche', employee_id: employeeId, updated_at: new Date() });
    await log(trx, id, { kind: 'etape', summary: `Embauché(e) — fiche employé créée`, userId });
    if (job) {
      const hired = await trx('hr_applicants').where({ job_id: job.id, stage: 'embauche' }).count({ n: '*' }).first();
      if (Number(hired.n) >= job.openings) await trx('hr_jobs').where({ id: job.id }).update({ status: 'pourvu', published: false, updated_at: new Date() });
    }
    return employeeId;
  });
}

module.exports = { cvUpload, cvDir, jobs, serializeJob, serializeApplicant, applicantQuery, applicant, createApplicant, move, hire, log };
