/**
 * ERP · QHSE (Qualité, Hygiène, Sécurité, Environnement). Consulter : qhse:read ; saisir les contrôles de ses chantiers : qhse:control ;
 * tous les chantiers : qhse:all ; inspections et audits : qhse:audit ; actions correctives : qhse:actions (le responsable d'une action
 * la fait avancer sans ce droit) ; valider les synthèses hebdomadaires et les audits : qhse:validate ; grilles de contrôle : qhse:settings.
 * Les seuils et délais (nombres) se règlent par la route commune /erp/reglages/qhse. Le serveur contrôle chaque action et la portée
 * (chantiers du conducteur) : un bouton masqué ne suffit pas.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, isoDay } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const Q = require('../../lib/qhse');
const svc = require('../../services/qhse');
const audits = require('../../services/qhseAudits');
const suivi = require('../../services/qhseSuivi');

const day = z.string().regex(Q.DAY_RE, 'Date attendue au format AAAA-MM-JJ');
const id = z.number().int().positive();
const optText = n => z.string().trim().max(n).nullable().optional();
const pillarEnum = z.enum(Object.keys(Q.PILLARS));
const gravityEnum = z.enum(Object.keys(Q.GRAVITIES));

const itemSchema = z.object({
  checkpoint_id: id.nullable().optional(), pillar: pillarEnum.optional(), label: optText(200),
  rating: z.number().int().min(1).max(4).nullable().optional(), answer: z.enum(Object.keys(Q.ANSWERS)).nullable().optional(), remark: optText(300),
}).strict();
const dailySchema = z.object({
  worksite_id: id, day,
  rating_qualite: z.number().int().min(1).max(4).nullable().optional(), rating_hygiene: z.number().int().min(1).max(4).nullable().optional(),
  workers_present: z.number().int().min(0).max(5000), workers_compliant: z.number().int().min(0).max(5000),
  workers: z.array(z.object({ employee_id: id.nullable().optional(), name: optText(160), issue: optText(300) }).strict()).max(100).optional(),
  items: z.array(itemSchema).max(120).optional(),
  remark_qualite: optText(2000), remark_hygiene: optText(2000), remark_securite: optText(2000), remark_environnement: optText(2000), observations: optText(2000),
}).strict();
const weeklySchema = z.object({
  rating_qualite: z.number().int().min(1).max(4).nullable(), rating_hygiene: z.number().int().min(1).max(4).nullable(),
  remark_qualite: optText(3000), remark_hygiene: optText(3000), remark_securite: optText(3000), remark_environnement: optText(3000), observations: optText(3000),
}).partial().strict();
const reason = z.object({ reason: z.string().trim().min(3, 'Indiquez le motif du refus.').max(500) }).strict();

const auditSchema = z.object({
  kind: z.enum(Object.keys(Q.AUDIT_KINDS)), place_kind: z.enum(Object.keys(Q.AUDIT_PLACES)), worksite_id: id.nullable().optional(), place_label: optText(160),
  auditor_id: id.nullable().optional(), auditor_name: optText(120), planned_on: day.nullable().optional(), objective: optText(300),
}).strict();
const resultsSchema = z.object({
  items: z.array(itemSchema).max(150), rating_qualite: z.number().int().min(1).max(4).nullable().optional(), rating_hygiene: z.number().int().min(1).max(4).nullable().optional(),
  summary: optText(4000), objective: optText(300),
}).strict();
const findingSchema = z.object({ pillar: pillarEnum, description: z.string().trim().min(3).max(500), gravity: gravityEnum }).strict();
const actionSchema = z.object({
  title: z.string().trim().min(3).max(200), description: optText(4000), pillar: pillarEnum.nullable().optional(), gravity: gravityEnum.optional(),
  owner_id: id, due_on: day.nullable().optional(), worksite_id: id.nullable().optional(), control_id: id.nullable().optional(), audit_id: id.nullable().optional(),
  finding_id: id.nullable().optional(), sav_ticket_id: id.nullable().optional(),
}).strict();
const actionPatch = z.object({
  title: z.string().trim().min(3).max(200), description: optText(4000), pillar: pillarEnum.nullable(), gravity: gravityEnum, owner_id: id, due_on: day,
}).partial().strict();
const statusSchema = z.object({ status: z.enum(Object.keys(Q.ACTION_STATUSES)), note: optText(1000), lifted_on: day.optional() }).strict();

module.exports = function qhseRoutes(db) {
  const r = express.Router();
  const viewer = req => ({ user: req.user, can: p => req.can(p) });
  const C = requirePermission('qhse:control');
  const A = requirePermission('qhse:audit');
  const X = requirePermission('qhse:actions');
  const V = requirePermission('qhse:validate');
  const S = requirePermission('qhse:settings');
  const ALL = requirePermission('qhse:all');
  const childId = (req, key) => {
    const n = Number(req.params[key]);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identifiant invalide.');
    return n;
  };
  r.use(requirePermission('qhse:read'));

  // ─── Lectures ───────────────────────────────────────────────────────────

  r.get('/badges', ah(async (req, res) => res.json(await suivi.badges(db, viewer(req)))));
  r.get('/dashboard', ah(async (req, res) => res.json(await suivi.dashboard(db, viewer(req), { days: Math.min(Math.max(Number(req.query.jours) || 30, 7), 90) }))));

  r.get('/refs', ah(async (req, res) => {
    const v = viewer(req);
    const [worksites, checkpoints, settings] = await Promise.all([svc.visibleWorksites(db, v), svc.listCheckpoints(db), svc.settings(db)]);
    // Comptes proposés comme responsable d'une action ou auditeur : seulement pour qui peut en désigner
    const users = v.can('qhse:actions') || v.can('qhse:audit')
      ? await db('users').where({ active: true }).orderBy('name').select('id', 'name') : [];
    res.json({
      pillars: Q.PILLARS, ratings: Q.RATINGS, answers: Q.ANSWERS, gravities: Q.GRAVITIES, control_kinds: Q.CONTROL_KINDS, control_statuses: Q.CONTROL_STATUSES,
      audit_kinds: Q.AUDIT_KINDS, audit_statuses: Q.AUDIT_STATUSES, audit_places: Q.AUDIT_PLACES, action_statuses: Q.ACTION_STATUSES, action_sources: Q.ACTION_SOURCES,
      worksites: worksites.map(w => ({ id: w.id, reference: w.reference, name: w.name, status: w.status, project_name: w.project_name, manager_name: w.manager_name, mine: svc.isManager(w, v) })),
      checkpoints, users, settings: { threshold: settings.threshold, hour: settings.hour, due: settings.due }, today: Q.todayStr(), week_start: Q.mondayOf(Q.todayStr()),
    });
  }));

  r.get('/worksites/:id/summary', ah(async (req, res) => {
    const v = viewer(req);
    res.json(await suivi.worksiteSummary(db, await svc.worksiteFor(db, idParam(req), v), v));
  }));
  /** Effectif du jour d'un chantier d'après les pointages (proposé comme nombre d'ouvriers présents). */
  r.get('/worksites/:id/attendance', ah(async (req, res) => {
    const d = Q.DAY_RE.test(req.query.day || '') ? req.query.day : Q.todayStr();
    const w = await svc.worksiteFor(db, idParam(req), viewer(req));
    const existing = await db('qhse_controls').where({ worksite_id: w.id, kind: 'journalier', period_start: d }).first('id');
    res.json({ ...(await svc.attendance(db, w, d)), control_id: existing?.id || null });
  }));

  r.get('/controls', ah(async (req, res) => {
    const q = req.query;
    res.json(await svc.listControls(db, viewer(req), {
      kind: Q.CONTROL_KINDS[q.kind] ? q.kind : null, worksiteId: Number(q.worksite_id) || null, status: Q.CONTROL_STATUSES[q.status] ? q.status : null,
      from: Q.DAY_RE.test(q.from || '') ? q.from : null, to: Q.DAY_RE.test(q.to || '') ? q.to : null, limit: q.limit,
    }));
  }));
  r.get('/controls/:id', ah(async (req, res) => res.json(await svc.controlDetail(db, idParam(req), viewer(req)))));

  // ─── Contrôles ──────────────────────────────────────────────────────────

  r.post('/controls/daily', C, ah(async (req, res) => {
    const v = viewer(req);
    const d = parse(dailySchema, req.body);
    const cid = await svc.saveDaily(db, await svc.worksiteFor(db, d.worksite_id, v), d, v);
    res.status(201).json(await svc.controlDetail(db, cid, v));
  }));
  r.post('/controls/weekly', C, ah(async (req, res) => {
    const v = viewer(req);
    const d = parse(z.object({ worksite_id: id, week: day }).strict(), req.body);
    const cid = await svc.openWeekly(db, await svc.worksiteFor(db, d.worksite_id, v), d.week, v);
    res.status(201).json(await svc.controlDetail(db, cid, v));
  }));
  r.patch('/controls/:id', C, ah(async (req, res) => {
    const v = viewer(req);
    await svc.saveWeekly(db, idParam(req), parse(weeklySchema, req.body), v);
    res.json(await svc.controlDetail(db, idParam(req), v));
  }));
  r.post('/controls/:id/submit', C, ah(async (req, res) => {
    const v = viewer(req);
    await svc.submitWeekly(db, idParam(req), v);
    res.json(await svc.controlDetail(db, idParam(req), v));
  }));
  r.post('/controls/:id/validate', V, ah(async (req, res) => {
    const v = viewer(req);
    await svc.decideWeekly(db, idParam(req), v, { approve: true });
    res.json(await svc.controlDetail(db, idParam(req), v));
  }));
  r.post('/controls/:id/reject', V, ah(async (req, res) => {
    const v = viewer(req);
    await svc.decideWeekly(db, idParam(req), v, { approve: false, reason: parse(reason, req.body).reason });
    res.json(await svc.controlDetail(db, idParam(req), v));
  }));

  // ─── Inspections et audits ──────────────────────────────────────────────

  r.get('/audits', ah(async (req, res) => res.json(await audits.listAudits(db, viewer(req), { status: Q.AUDIT_STATUSES[req.query.status] ? req.query.status : null, worksiteId: Number(req.query.worksite_id) || null }))));
  r.get('/audits/:id', ah(async (req, res) => res.json(await audits.auditDetail(db, idParam(req), viewer(req)))));
  r.post('/audits', A, ah(async (req, res) => {
    const v = viewer(req);
    res.status(201).json(await audits.auditDetail(db, await audits.planAudit(db, parse(auditSchema, req.body), v), v));
  }));
  const auditAction = (fn, guard = A) => [guard, ah(async (req, res) => {
    const v = viewer(req);
    await fn(idParam(req), req, v);
    res.json(await audits.auditDetail(db, idParam(req), v));
  })];
  r.post('/audits/:id/start', ...auditAction((aid, req, v) => audits.startAudit(db, aid, v)));
  r.put('/audits/:id/results', ...auditAction((aid, req, v) => audits.saveResults(db, aid, parse(resultsSchema, req.body), v)));
  r.post('/audits/:id/submit', ...auditAction((aid, req, v) => audits.submitAudit(db, aid, v)));
  r.post('/audits/:id/cancel', ...auditAction((aid, req, v) => audits.cancelAudit(db, aid, v)));
  r.post('/audits/:id/validate', ...auditAction((aid, req, v) => audits.decideAudit(db, aid, v, { approve: true }), V));
  r.post('/audits/:id/reject', ...auditAction((aid, req, v) => audits.decideAudit(db, aid, v, { approve: false, reason: parse(reason, req.body).reason }), V));

  r.post('/audits/:id/findings', A, ah(async (req, res) => {
    const v = viewer(req);
    await audits.addFinding(db, idParam(req), parse(findingSchema, req.body), v);
    res.status(201).json(await audits.auditDetail(db, idParam(req), v));
  }));
  r.patch('/findings/:id', A, ah(async (req, res) => {
    const v = viewer(req);
    const aid = await audits.updateFinding(db, idParam(req), parse(findingSchema.partial(), req.body), v);
    res.json(await audits.auditDetail(db, aid, v));
  }));
  r.delete('/findings/:id', A, ah(async (req, res) => {
    const v = viewer(req);
    const aid = await audits.removeFinding(db, idParam(req), v);
    res.json(await audits.auditDetail(db, aid, v));
  }));

  // ─── Actions correctives ────────────────────────────────────────────────

  r.get('/actions', ah(async (req, res) => {
    const q = req.query;
    res.json(await audits.listActions(db, viewer(req), {
      status: q.status ? String(q.status) : 'ouvertes', worksiteId: Number(q.worksite_id) || null, pillar: Q.PILLARS[q.pillar] ? q.pillar : null,
      ownerId: q.mine ? req.user.id : Number(q.owner_id) || null,
    }));
  }));
  r.get('/actions/:id', ah(async (req, res) => res.json(await audits.actionDetail(db, idParam(req), viewer(req)))));
  r.post('/actions', X, ah(async (req, res) => {
    const v = viewer(req);
    res.status(201).json(await audits.actionDetail(db, await audits.createAction(db, parse(actionSchema, req.body), v), v));
  }));
  r.patch('/actions/:id', ah(async (req, res) => {
    const v = viewer(req);
    await audits.updateAction(db, idParam(req), parse(actionPatch, req.body), v);
    res.json(await audits.actionDetail(db, idParam(req), v));
  }));
  /** En cours, levée (avec sa preuve), annulée, rouverte : le responsable de l'action peut la faire avancer et la lever. */
  r.post('/actions/:id/status', ah(async (req, res) => {
    const v = viewer(req);
    await audits.setActionStatus(db, idParam(req), parse(statusSchema, req.body), v);
    res.json(await audits.actionDetail(db, idParam(req), v));
  }));

  // ─── Photos et preuves ──────────────────────────────────────────────────

  /** Le propriétaire d'un fichier, visible du compte ; `writable` : le compte peut y joindre ou retirer des photos. */
  const fileOwner = async (req, kind, ownerId) => {
    const v = viewer(req);
    if (kind === 'controle') {
      const c = await svc.loadControl(db, ownerId, v);
      const open = c.kind === 'hebdomadaire' ? c.status === 'brouillon' : !(await svc.weekLocked(db, c.worksite_id, isoDay(c.period_start)));
      return { writable: v.can('qhse:control') && open };
    }
    if (kind === 'audit') return { writable: v.can('qhse:audit') && ['planifie', 'en_cours'].includes((await audits.loadAudit(db, ownerId, v)).status) };
    if (kind === 'constat') return { writable: v.can('qhse:audit') && (await audits.loadFinding(db, ownerId, v)).audit.status === 'en_cours' };
    if (kind === 'action') {
      const x = await audits.loadAction(db, ownerId, v);
      return { writable: Q.ACTION_OPEN.includes(x.status) && (Number(x.owner_id) === Number(req.user.id) || v.can('qhse:actions')) };
    }
    throw new HttpError(404, 'Élément inconnu.');
  };
  r.post('/files/:kind/:ownerId', (req, res, next) => svc.upload()(req, res, err => next(err)), async (req, res, next) => {
    try {
      const kind = String(req.params.kind);
      const ownerId = childId(req, 'ownerId');
      const files = req.files || [];
      try {
        if (!Q.FILE_OWNERS[kind]) throw new HttpError(404, 'Élément inconnu.');
        if (!files.length) throw new HttpError(400, 'Joignez au moins une photo.');
        const owner = await fileOwner(req, kind, ownerId);
        if (!owner.writable) throw new HttpError(403, 'Les photos de cet élément ne se modifient plus, ou droits insuffisants.');
        const count = Number((await db('qhse_files').where({ owner_kind: kind, owner_id: ownerId }).count({ n: '*' }).first()).n);
        if (count + files.length > 16) throw new HttpError(400, 'Seize photos au plus par élément.');
        const purpose = kind === 'action' && req.body?.purpose === 'preuve' ? 'preuve' : 'photo';
        await svc.attachFiles(db, kind, ownerId, files, { purpose, userId: req.user.id });
      } catch (e) { await svc.removeUploaded(files); throw e; }
      res.status(201).json((await svc.filesOf(db, kind, [ownerId])).get(ownerId) || []);
    } catch (e) { next(e); }
  });
  r.get('/files/:fileId', ah(async (req, res) => {
    const f = await db('qhse_files').where({ id: childId(req, 'fileId') }).first();
    if (!f) throw new HttpError(404, 'Fichier introuvable.');
    await fileOwner(req, f.owner_kind, f.owner_id); // 404 si l'élément n'est pas visible du compte
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original_name || 'photo')}`);
    res.sendFile(svc.filePath(f), err => err && !res.headersSent && res.sendStatus(404));
  }));
  r.delete('/files/:fileId', ah(async (req, res) => {
    const f = await db('qhse_files').where({ id: childId(req, 'fileId') }).first();
    if (!f) throw new HttpError(404, 'Fichier introuvable.');
    if (!(await fileOwner(req, f.owner_kind, f.owner_id)).writable) throw new HttpError(403, 'Ce fichier ne se retire plus, ou droits insuffisants.');
    await svc.removeFile(db, f);
    res.json((await svc.filesOf(db, f.owner_kind, [f.owner_id])).get(f.owner_id) || []);
  }));

  // ─── Liaisons : fiche employé (RH) et réclamation (SAV) ─────────────────

  r.get('/employees/:id/remarks', ALL, ah(async (req, res) => res.json(await suivi.employeeRemarks(db, idParam(req)))));
  r.get('/sav/:ticketId', ah(async (req, res) => res.json(await suivi.savLink(db, childId(req, 'ticketId'), viewer(req)))));

  // ─── Réglages : grilles de points de contrôle ───────────────────────────

  r.get('/checkpoints', S, ah(async (req, res) => res.json(await svc.listCheckpoints(db, { all: true }))));
  r.post('/checkpoints', S, ah(async (req, res) => res.status(201).json(await svc.addCheckpoint(db, parse(z.object({ pillar: pillarEnum, label: z.string().trim().min(3).max(200) }).strict(), req.body)))));
  r.put('/checkpoints/ordre', S, ah(async (req, res) => {
    const d = parse(z.object({ pillar: pillarEnum, ids: z.array(id) }).strict(), req.body);
    res.json(await svc.reorderCheckpoints(db, d.pillar, d.ids));
  }));
  r.patch('/checkpoints/:id', S, ah(async (req, res) => res.json(await svc.updateCheckpoint(db, idParam(req), parse(z.object({ label: z.string().trim().min(3).max(200), active: z.boolean() }).partial().strict(), req.body)))));
  r.delete('/checkpoints/:id', S, ah(async (req, res) => res.json(await svc.removeCheckpoint(db, idParam(req)))));

  r.use((req, res, next) => next(new HttpError(404, 'Route inconnue.')));
  return r;
};
