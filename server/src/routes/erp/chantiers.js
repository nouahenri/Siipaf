/** ERP · Chantiers : chantiers d'un programme, phases (Gantt), tâches (Kanban), budget par poste. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { WORKSITE_STATUSES, WORKSITE_ZONES, TASK_STATUSES, SITE_STAGES, CHANTIER_SETTINGS, DECLARATION_STATUSES } = require('../../lib/domain');
const chantiers = require('../../services/chantiers');
const suivi = require('../../services/chantiersSuivi');
const sousTraitance = require('../../services/chantiersSousTraitance');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

// Formulaires avec pièces jointes (multipart) : vides et nombres convertis ici
const blank = v => (v === '' || v == null || v === 'null' ? null : v);
const mOpt = s => z.preprocess(blank, s.nullable()).optional();
const mNum = s => z.preprocess(v => (blank(v) == null ? null : Number(v)), s.nullable()).optional();
const journalSchema = z.object({
  // Météo : code de la liste réglable (contrôlé par le service)
  day, weather: mOpt(z.string().trim().max(30)), headcount: mNum(z.number().int().min(0).max(5000)),
  work_done: mOpt(z.string().trim().max(4000)), incidents: mOpt(z.string().trim().max(4000)), notes: mOpt(z.string().trim().max(4000)),
});
const progressSchema = z.object({
  stage: z.enum(SITE_STAGES), progress_pct: z.preprocess(v => Number(v), z.number().int().min(0).max(100)), title: z.string().trim().min(3).max(160),
  body: mOpt(z.string().trim().max(4000)), ilot: mOpt(z.string().trim().max(40)), lot_id: mNum(z.number().int().positive()),
  visible_client: z.preprocess(v => !(v === false || v === 'false' || v === '0'), z.boolean()).optional(), published_at: mOpt(day),
});
// Situation de travaux : avancement cumulé (%) ou montant cumulé HT si le marché n'a pas de montant
const situationSchema = z.object({
  period_end: day, cumulative_pct: mNum(z.number().min(0).max(100)), cumulative_amount: mNum(z.number().int().min(0)), note: mOpt(z.string().trim().max(2000)),
});
const stageSchema = z.object({ stage: z.enum(SITE_STAGES), reached_on: day, note: mOpt(z.string().trim().max(2000)) });

const optDay = day.nullable().optional();
const optId = z.number().int().positive().nullable().optional();
const optText = n => z.string().trim().max(n).nullable().optional();

const worksiteSchema = z.object({
  project_id: z.number().int().positive(), name: z.string().trim().min(2).max(160),
  zone_kind: z.enum(Object.keys(WORKSITE_ZONES)).optional(), zone: z.array(z.union([z.string().max(40), z.number().int().positive()])).max(2000).optional(),
  manager_id: optId, status: z.enum(Object.keys(WORKSITE_STATUSES)).optional(),
  planned_start: optDay, planned_end: optDay, actual_start: optDay, actual_end: optDay, description: optText(4000),
  stages: z.array(z.enum(SITE_STAGES)).optional(), // phases de départ (création seulement)
});
const phaseSchema = z.object({
  stage: z.enum(SITE_STAGES).nullable().optional(), label: z.string().trim().min(2).max(160),
  planned_start: optDay, planned_end: optDay, actual_start: optDay, actual_end: optDay,
  progress_pct: z.number().int().min(0).max(100).optional(), depends_on_id: optId, notes: optText(2000),
});
const taskSchema = z.object({
  title: z.string().trim().min(2).max(200), description: optText(4000), status: z.enum(Object.keys(TASK_STATUSES)).optional(),
  phase_id: optId, milestone: z.boolean().optional(), employee_id: optId, supplier_id: optId, team: optText(120),
  start_on: optDay, due_on: optDay, done_on: optDay,
});
const budgetSchema = z.object({
  category: z.string().trim().min(1).max(30), label: z.string().trim().min(2).max(160), phase_id: optId, // poste de la liste réglable
  amount_fcfa: z.number().int().min(0), notes: optText(1000),
});

module.exports = function chantiersRoutes(db) {
  const r = express.Router();
  const viewer = req => ({ user: req.user, can: p => req.can(p) });
  const managed = req => chantiers.managedWorksite(db, idParam(req), viewer(req));
  const sendDetail = async (req, res, w, status = 200) => res.status(status).json(await chantiers.detail(db, await chantiers.loadWorksite(db, w.id), viewer(req)));
  const sendFile = (res, row, fallback) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.file_name || fallback)}`);
    res.sendFile(suivi.filePath(row), err => err && !res.headersSent && res.sendStatus(404));
  };
  const childId = (req, key) => {
    const n = Number(req.params[key]);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identifiant invalide.');
    return n;
  };

  r.get('/badges', ah(async (req, res) => res.json(await chantiers.badges(db, viewer(req)))));
  r.get('/refs', ah(async (req, res) => res.json({ ...(await chantiers.refs(db)), settings: await chantiers.settings(db), setting_fields: CHANTIER_SETTINGS, list_kinds: chantiers.LIST_KINDS, declaration_statuses: DECLARATION_STATUSES })));
  // Listes réglables : postes du budget, météo du journal
  const listKind = z.enum(Object.keys(chantiers.LIST_KINDS));
  r.post('/reglages/listes', requirePermission('chantiers:write'), ah(async (req, res) => {
    const { kind, label } = parse(z.object({ kind: listKind, label: z.string().trim().min(2).max(120) }), req.body);
    await chantiers.addListItem(db, kind, label);
    res.status(201).json(await chantiers.listItems(db, kind, { all: true }));
  }));
  r.put('/reglages/listes/:kind/ordre', requirePermission('chantiers:write'), ah(async (req, res) => {
    const kind = parse(listKind, req.params.kind);
    await chantiers.reorderList(db, kind, parse(z.object({ ids: z.array(z.number().int().positive()) }), req.body).ids);
    res.json(await chantiers.listItems(db, kind, { all: true }));
  }));
  r.patch('/reglages/listes/:itemId', requirePermission('chantiers:write'), ah(async (req, res) => {
    const kind = await chantiers.updateListItem(db, childId(req, 'itemId'), parse(z.object({ label: z.string().trim().min(2).max(120), active: z.boolean() }).partial(), req.body));
    res.json(await chantiers.listItems(db, kind, { all: true }));
  }));
  r.delete('/reglages/listes/:itemId', requirePermission('chantiers:write'), ah(async (req, res) => {
    const kind = await chantiers.removeListItem(db, childId(req, 'itemId'));
    res.json(await chantiers.listItems(db, kind, { all: true }));
  }));
  /** Programmes et chantiers non clos : listes « Lieu / chantier » des pointages, du Parc et des achats. */
  r.get('/lieux', ah(async (req, res) => res.json(await chantiers.places(db))));
  r.put('/reglages', requirePermission('chantiers:write'), ah(async (req, res) => {
    const shape = Object.fromEntries(Object.entries(CHANTIER_SETTINGS).map(([k, x]) => [k, x.options ? z.enum(Object.keys(x.options)) : z.number().int().min(x.min).max(x.max)]));
    res.json(await chantiers.saveSettings(db, parse(z.object(shape).partial(), req.body)));
  }));
  r.get('/programmes/:id', ah(async (req, res) => res.json(await chantiers.programme(db, idParam(req)))));

  // ─── Étapes déclarées : vue de la Direction, fichiers (avant les routes /:id) ──
  const direction = requirePermission('chantiers:direction');
  r.get('/etapes', ah(async (req, res) => {
    if (!chantiers.seesAll(viewer(req))) throw new HttpError(403, 'Accès refusé.');
    res.json(await suivi.declarations(db, { status: req.query.status || null, projectId: Number(req.query.project_id) || null }));
  }));
  r.post('/etapes/:declId/declarer', direction, ah(async (req, res) => {
    const data = parse(z.object({ reached_on: day.optional(), note: z.string().trim().max(2000).nullable().optional() }), req.body);
    res.json(await suivi.declare(db, { id: childId(req, 'declId'), reached_on: data.reached_on, note: data.note || null }, { userId: req.user.id }));
  }));
  r.post('/etapes/:declId/refuser', direction, ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Motif du refus obligatoire').max(500) }), req.body);
    await suivi.refuse(db, childId(req, 'declId'), reason, req.user.id);
    res.json({ ok: true });
  }));
  r.get('/etapes/:declId/fichier', ah(async (req, res) => {
    const d = await db('stage_declarations').where({ id: childId(req, 'declId') }).first();
    if (!d) throw new HttpError(404, 'Pièce introuvable.');
    if (d.worksite_id) await chantiers.visibleWorksite(db, d.worksite_id, viewer(req));
    else if (!chantiers.seesAll(viewer(req))) throw new HttpError(404, 'Pièce introuvable.');
    sendFile(res, d, 'piece');
  }));
  // Situations vérifiées, à valider par la Direction (encart de la liste) ; pièce jointe d'une situation
  r.get('/situations', direction, ah(async (req, res) => res.json(await sousTraitance.toValidate(db))));
  r.get('/situations/:sitId/fichier', ah(async (req, res) => {
    const s = await db('worksite_situations').where({ id: childId(req, 'sitId') }).first();
    if (!s) throw new HttpError(404, 'Pièce introuvable.');
    await chantiers.visibleWorksite(db, s.worksite_id, viewer(req));
    sendFile(res, s, 'situation');
  }));
  r.get('/journal/photos/:photoId', ah(async (req, res) => {
    const f = await db('worksite_journal_files as f').join('worksite_journal as j', 'j.id', 'f.journal_id').where('f.id', childId(req, 'photoId')).first('f.*', 'j.worksite_id');
    if (!f) throw new HttpError(404, 'Photo introuvable.');
    await chantiers.visibleWorksite(db, f.worksite_id, viewer(req));
    sendFile(res, f, 'photo');
  }));

  r.get('/', ah(async (req, res) => {
    res.json(await chantiers.list(db, viewer(req), { status: req.query.status ?? 'ouverts', projectId: Number(req.query.project_id) || null, q: String(req.query.q || '').trim() }));
  }));
  r.post('/', requirePermission('chantiers:write'), ah(async (req, res) => {
    const w = await chantiers.create(db, parse(worksiteSchema, req.body), req.user);
    await sendDetail(req, res, w, 201);
  }));
  r.get('/:id', ah(async (req, res) => res.json(await chantiers.detail(db, await chantiers.visibleWorksite(db, idParam(req), viewer(req)), viewer(req)))));
  r.patch('/:id', ah(async (req, res) => {
    const w = await managed(req);
    const data = parse(worksiteSchema.omit({ stages: true, project_id: true }).partial(), req.body);
    // Seul un gestionnaire des chantiers change le conducteur (le conducteur ne se désigne pas un remplaçant)
    if (data.manager_id !== undefined && Number(data.manager_id || 0) !== Number(w.manager_id || 0) && !req.can('chantiers:write')) {
      throw new HttpError(403, 'Seul un gestionnaire des chantiers change le conducteur.');
    }
    await sendDetail(req, res, await chantiers.update(db, w, data, req.user));
  }));
  r.delete('/:id', requirePermission('chantiers:write'), ah(async (req, res) => {
    await chantiers.remove(db, await managed(req));
    res.status(204).end();
  }));

  // ─── Phases ───────────────────────────────────────────────
  r.post('/:id/phases', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.savePhase(db, w, parse(phaseSchema, req.body));
    await sendDetail(req, res, w, 201);
  }));
  r.patch('/:id/phases/:phaseId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.savePhase(db, w, parse(phaseSchema.partial(), req.body), childId(req, 'phaseId'));
    await sendDetail(req, res, w);
  }));
  r.delete('/:id/phases/:phaseId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.deletePhase(db, w, childId(req, 'phaseId'));
    await sendDetail(req, res, w);
  }));
  r.put('/:id/phases/ordre', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.reorderPhases(db, w, parse(z.object({ ids: z.array(z.number().int().positive()) }), req.body).ids);
    await sendDetail(req, res, w);
  }));

  // ─── Tâches ───────────────────────────────────────────────
  r.post('/:id/taches', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.saveTask(db, w, parse(taskSchema, req.body), req.user);
    await sendDetail(req, res, w, 201);
  }));
  r.patch('/:id/taches/:taskId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.saveTask(db, w, parse(taskSchema.partial(), req.body), req.user, childId(req, 'taskId'));
    await sendDetail(req, res, w);
  }));
  r.delete('/:id/taches/:taskId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.deleteTask(db, w, childId(req, 'taskId'));
    await sendDetail(req, res, w);
  }));

  // ─── Budget ───────────────────────────────────────────────
  r.post('/:id/budget', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.saveBudgetLine(db, w, parse(budgetSchema, req.body));
    await sendDetail(req, res, w, 201);
  }));
  r.patch('/:id/budget/:lineId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.saveBudgetLine(db, w, parse(budgetSchema.partial(), req.body), childId(req, 'lineId'));
    await sendDetail(req, res, w);
  }));
  r.delete('/:id/budget/:lineId', ah(async (req, res) => {
    const w = await managed(req);
    await chantiers.deleteBudgetLine(db, w, childId(req, 'lineId'));
    await sendDetail(req, res, w);
  }));

  // ─── Journal quotidien ────────────────────────────────────
  const multipart = upload => (req, res, next) => upload(req, res, err => next(err));
  const guarded = fn => ah(async (req, res) => { try { await fn(req, res); } catch (e) { await suivi.removeFiles(req.files || (req.file ? [req.file] : [])); throw e; } });
  r.get('/:id/journal', ah(async (req, res) => res.json(await suivi.journal(db, await chantiers.visibleWorksite(db, idParam(req), viewer(req))))));
  r.post('/:id/journal', multipart(suivi.journalUpload()), guarded(async (req, res) => {
    const w = await managed(req);
    await suivi.saveJournal(db, w, parse(journalSchema, req.body), { files: req.files || [], userId: req.user.id });
    res.status(201).json(await suivi.journal(db, w));
  }));
  r.delete('/:id/journal/photos/:photoId', ah(async (req, res) => {
    const w = await managed(req);
    await suivi.deleteJournalPhoto(db, w, childId(req, 'photoId'));
    res.json(await suivi.journal(db, w));
  }));

  // ─── Points d'avancement pour les acquéreurs ──────────────
  r.get('/:id/avancement', ah(async (req, res) => res.json(await suivi.progressPoints(db, await chantiers.visibleWorksite(db, idParam(req), viewer(req))))));
  r.post('/:id/avancement', multipart(suivi.progressUpload()), guarded(async (req, res) => {
    const w = await managed(req);
    const n = await suivi.publishProgress(db, w, parse(progressSchema, req.body), { files: req.files || [], userId: req.user.id });
    res.status(201).json({ published: n, points: await suivi.progressPoints(db, w) });
  }));

  // ─── Étapes : signalées par le conducteur, déclarées par la Direction ──
  r.get('/:id/etapes', ah(async (req, res) => {
    const w = await chantiers.visibleWorksite(db, idParam(req), viewer(req));
    res.json(await suivi.declarations(db, { worksiteId: w.id }));
  }));
  r.post('/:id/etapes', multipart(suivi.declarationUpload()), guarded(async (req, res) => {
    const w = await chantiers.visibleWorksite(db, idParam(req), viewer(req));
    const data = parse(stageSchema.extend({ declare: z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean()).optional() }), req.body);
    // La Direction déclare directement ; le conducteur signale
    if (data.declare) {
      if (!req.can('chantiers:direction')) throw new HttpError(403, 'Seule la Direction déclare une étape atteinte.');
      res.status(201).json(await suivi.declare(db, { worksite: w, stage: data.stage, reached_on: data.reached_on, note: data.note || null }, { file: req.file, userId: req.user.id }));
      return;
    }
    if (!chantiers.canManage(w, viewer(req))) throw new HttpError(403, 'Seuls le conducteur du chantier et les gestionnaires signalent une étape.');
    res.status(201).json({ id: await suivi.signal(db, w, data, { file: req.file, userId: req.user.id }) });
  }));

  // ─── Sous-traitants : marchés et situations de travaux ────
  r.get('/:id/sous-traitants', ah(async (req, res) => res.json(await sousTraitance.markets(db, await chantiers.visibleWorksite(db, idParam(req), viewer(req))))));
  const situationDone = async (req, res, w, status = 200) => res.status(status).json(await sousTraitance.markets(db, w));
  r.post('/:id/marches/:contractId/situations', multipart(suivi.declarationUpload()), guarded(async (req, res) => {
    const w = await managed(req);
    await sousTraitance.create(db, w, childId(req, 'contractId'), parse(situationSchema, req.body), { file: req.file, userId: req.user.id });
    await situationDone(req, res, w, 201);
  }));
  r.patch('/:id/situations/:sitId', multipart(suivi.declarationUpload()), guarded(async (req, res) => {
    const w = await managed(req);
    await sousTraitance.update(db, w, childId(req, 'sitId'), parse(situationSchema.partial(), req.body), { file: req.file });
    await situationDone(req, res, w);
  }));
  r.delete('/:id/situations/:sitId', ah(async (req, res) => {
    const w = await managed(req);
    await sousTraitance.remove(db, w, childId(req, 'sitId'));
    await situationDone(req, res, w);
  }));
  r.post('/:id/situations/:sitId/verifier', ah(async (req, res) => {
    const w = await managed(req);
    await sousTraitance.verify(db, w, childId(req, 'sitId'), req.user.id);
    await situationDone(req, res, w);
  }));
  r.post('/:id/situations/:sitId/brouillon', ah(async (req, res) => {
    const w = await chantiers.visibleWorksite(db, idParam(req), viewer(req));
    if (!chantiers.canManage(w, viewer(req)) && !req.can('chantiers:direction')) throw new HttpError(403, 'Accès refusé.');
    await sousTraitance.toDraft(db, w, childId(req, 'sitId'));
    await situationDone(req, res, w);
  }));
  r.post('/:id/situations/:sitId/valider', direction, ah(async (req, res) => {
    const w = await chantiers.loadWorksite(db, idParam(req));
    await sousTraitance.validate(db, w, childId(req, 'sitId'), req.user.id);
    await situationDone(req, res, w);
  }));
  r.post('/:id/situations/:sitId/refuser', direction, ah(async (req, res) => {
    const w = await chantiers.loadWorksite(db, idParam(req));
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Motif du refus obligatoire').max(500) }), req.body);
    await sousTraitance.refuse(db, w, childId(req, 'sitId'), reason, req.user.id);
    await situationDone(req, res, w);
  }));

  // ─── Livraisons promises et retards ───────────────────────
  r.get('/:id/livraisons', ah(async (req, res) => res.json(await suivi.deliveries(db, await chantiers.visibleWorksite(db, idParam(req), viewer(req))))));
  // Date promise : relève du dossier de vente (droit sales:write, comme dans le dashboard), même hors des chantiers du compte
  r.patch('/:id/livraisons/:saleId', requirePermission('sales:write'), ah(async (req, res) => {
    const w = await chantiers.loadWorksite(db, idParam(req));
    const { promised_delivery_on } = parse(z.object({ promised_delivery_on: day.nullable() }), req.body);
    await suivi.setPromised(db, w, childId(req, 'saleId'), promised_delivery_on);
    res.json(await suivi.deliveries(db, w));
  }));

  return r;
};
