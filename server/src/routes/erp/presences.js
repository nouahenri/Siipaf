/** ERP · RH › Présences : pointage en ligne et sur borne, feuilles de présence de chantier, heures supplémentaires. */
const express = require('express');
const { z } = require('../../lib/zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const rh = require('../../services/rh');
const presences = require('../../services/presences');
const { rateLimit } = require('express-rate-limit');
const { isTest } = require('../../config');
const { PRESENCE_ACTIONS } = require('../../lib/domain');
const { GEO_ALERTS } = require('../../lib/rh');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois attendu au format AAAA-MM');
const hm = z.string().regex(/^\d{2}:\d{2}$/, 'Heure au format HH:MM');
const projectId = z.number().int().positive().optional().nullable();
// Position de l'appareil qui pointe et précision annoncée (mètres)
const position = {
  latitude: z.number().min(-90).max(90).optional().nullable(), longitude: z.number().min(-180).max(180).optional().nullable(),
  accuracy: z.number().min(0).max(100000).optional().nullable(),
};
const zoneSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(), radius_m: z.number().int().min(5).max(5000).nullable().optional(),
});

module.exports = function presencesRoutes(db) {
  const r = express.Router();
  const sheets = requirePermission('presence:sheets');
  const kiosk = requirePermission('presence:kiosk');
  const correct = requirePermission('presence:correct');
  const canPoint = req => PRESENCE_ACTIONS.some(p => req.can(p)) || req.can('rh:overtime');

  async function me(req) {
    const e = await rh.employeeOf(db, req.user.id);
    if (!e) throw new HttpError(404, 'Aucune fiche employé n’est reliée à votre compte : adressez-vous au service RH.');
    return e;
  }

  // ─── Mon pointage ─────────────────────────────────────────
  r.get('/me/attendance', ah(async (req, res) => {
    const e = await me(req);
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const rows = (await presences.monthAttendances(db, e.id, month)).filter(a => a.check_in.startsWith(month)).sort((a, b) => b.check_in.localeCompare(a.check_in));
    // Ses départs oubliés encore à corriger (quel que soit le mois) : affichés dans Mon espace
    const forgotten = (await presences.query(db).where('a.employee_id', e.id).whereNull('a.check_out').whereNotNull('a.forgotten_at').orderBy('a.check_in', 'desc')).map(presences.serialize);
    res.json({ open: await presences.openOf(db, e.id), forgotten, month, rows, has_pin: !!e.attendance_pin_hash, hours: Math.round(rows.reduce((t, a) => t + (a.hours || 0), 0) * 100) / 100 });
  }));
  r.post('/me/attendance', requirePermission('self:pointage'), ah(async (req, res) => {
    const e = await me(req);
    const data = parse(z.object({ project_id: projectId, worksite_id: projectId, place_id: projectId, ...position }), req.body);
    res.json(await presences.toggle(db, e, { ...data, source: 'web', userId: req.user.id })); // position ignorée sans la géolocalisation des réglages
  }));
  r.put('/me/pin', requirePermission('self:pointage'), ah(async (req, res) => {
    const e = await me(req);
    const { pin } = parse(z.object({ pin: z.string() }), req.body);
    await presences.setPin(db, e.id, pin);
    res.json({ ok: true });
  }));

  // ─── Borne de pointage (tablette ouverte par un compte autorisé) ──
  // Limite par compte et par adresse (audit du 30/10) : une tablette de chantier pointe des dizaines de personnes, pas des milliers d'essais
  const kioskLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, limit: isTest ? 100000 : 80, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, // seuls les échecs comptent : la file du matin n'est pas freinée
    keyGenerator: req => `${req.user?.id}|${req.ip}`, message: { error: 'Trop d’essais sur la borne, patientez quelques minutes.' },
  });
  r.post('/attendance/kiosk', kiosk, kioskLimiter, ah(async (req, res) => {
    const data = parse(z.object({ matricule: z.string().trim().min(3).max(20), pin: z.string().min(4).max(6), project_id: projectId, worksite_id: projectId, place_id: projectId, ...position }), req.body);
    res.json(await presences.kiosk(db, data, req.user.id));
  }));
  r.put('/employees/:id/pin', requirePermission('rh:pin'), ah(async (req, res) => {
    const { pin } = parse(z.object({ pin: z.string() }), req.body);
    await presences.setPin(db, idParam(req), pin);
    res.json({ ok: true });
  }));

  // ─── Pointages (service RH, conducteurs, responsable pour son équipe) ──
  r.get('/attendance', ah(async (req, res) => {
    const q = presences.query(db).orderBy('a.check_in', 'desc');
    if (!req.can('rh:read') && !canPoint(req)) {
      const e = await me(req);
      q.where(w => w.where('e.manager_id', e.id).orWhere('e.id', e.id));
    } else presences.applyScope(q, await presences.scopeOf(db, req)); // chantiers conduits et équipe, sans « Voir le personnel »
    const from = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? new Date(`${req.query.from}T00:00:00Z`) : new Date(Date.now() - 7 * 86400000);
    const to = req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? new Date(new Date(`${req.query.to}T00:00:00Z`).getTime() + 86400000) : new Date(Date.now() + 86400000);
    // Départs oubliés à corriger : tous, quel que soit leur jour ; sinon la période choisie
    if (req.query.controle === 'oubli') q.whereNull('a.check_out').whereNotNull('a.forgotten_at');
    else q.where('a.check_in', '>=', from).where('a.check_in', '<', to);
    if (req.query.employee_id) q.where('a.employee_id', Number(req.query.employee_id));
    if (req.query.project_id) q.where('a.project_id', Number(req.query.project_id));
    if (req.query.worksite_id) q.where('a.worksite_id', Number(req.query.worksite_id));
    if (req.query.place_id) q.where('a.place_id', Number(req.query.place_id));
    // Contrôle du lieu : pointages hors zone, imprécis ou sans position (à l'arrivée ou au départ)
    if (req.query.controle === 'alerte') q.where(w => w.whereIn('a.geo_status', GEO_ALERTS).orWhereIn('a.out_geo_status', GEO_ALERTS));
    if (req.query.controle === 'hors_zone') q.where(w => w.where('a.geo_status', 'hors_zone').orWhere('a.out_geo_status', 'hors_zone'));
    res.json((await q.limit(1000)).map(presences.serialize));
  }));

  r.get('/attendance/today', ah(async (req, res) => {
    if (!req.can('rh:read') && !canPoint(req)) throw new HttpError(403, 'Droits insuffisants.');
    res.json(await presences.today(db, new Date(), await presences.scopeOf(db, req)));
  }));

  // Personne ne saisit, ne corrige ni ne supprime ses propres pointages (heures supplémentaires → paie) : audit du 29/10
  const notMine = async (req, employeeIds) => {
    if (req.user.role === 'super_admin') return;
    const own = await db('employees').whereIn('id', [].concat(employeeIds)).where({ user_id: req.user.id }).first('id');
    if (own) throw new HttpError(403, 'Vos propres pointages se font à la borne ou dans Mon espace ; une correction passe par un collègue habilité.');
  };
  // Feuille déjà enregistrée (jour + lieu ou chantier) : rechargée par l'écran pour être complétée ou corrigée
  r.get('/attendance/sheet', sheets, ah(async (req, res) => {
    const id = v => (/^\d+$/.test(v || '') ? Number(v) : null);
    const date = parse(day, req.query.date);
    res.json(await presences.getSheet(db, { date, project_id: id(req.query.project_id), worksite_id: id(req.query.worksite_id), place_id: id(req.query.place_id) }, await presences.scopeOf(db, req)));
  }));
  r.post('/attendance/sheet', sheets, ah(async (req, res) => {
    const data = parse(z.object({
      date: day, project_id: projectId, worksite_id: projectId, place_id: projectId,
      rows: z.array(z.object({ employee_id: z.number().int().positive(), periods: z.array(z.tuple([hm, hm])).max(3), note: z.string().trim().max(255).optional() })).min(1).max(300),
    }), req.body);
    if (data.date > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Feuille de présence d’un jour à venir.');
    await notMine(req, data.rows.map(x => x.employee_id));
    await assertScope(req, data, data.rows.map(x => x.employee_id));
    res.status(201).json({ created: await presences.saveSheet(db, data, req.user.id) });
  }));

  // Sans « Voir le personnel », on ne saisit ni ne corrige que les pointages de ses chantiers et de son équipe (audit du 30/10)
  const assertScope = async (req, place, employeeIds) => {
    if (!(await presences.inScope(db, await presences.scopeOf(db, req), place, employeeIds))) {
      throw new HttpError(403, 'Vous gérez les pointages des chantiers que vous conduisez et ceux de votre équipe.');
    }
  };
  const manualSchema = z.object({
    employee_id: z.number().int().positive(), check_in: z.string().min(10), check_out: z.string().min(10).optional().nullable(),
    project_id: projectId, worksite_id: projectId, place_id: projectId, note: z.string().trim().min(3, 'Motif de la correction obligatoire').max(255),
  });
  r.post('/attendance', correct, ah(async (req, res) => {
    const data = parse(manualSchema, req.body);
    await notMine(req, data.employee_id);
    await assertScope(req, data, data.employee_id);
    res.status(201).json(await presences.upsertManual(db, data, req.user.id));
  }));
  r.patch('/attendance/:id', correct, ah(async (req, res) => {
    const a = await db('hr_attendances').where({ id: idParam(req) }).first();
    if (!a) throw new HttpError(404, 'Pointage introuvable.');
    await notMine(req, a.employee_id);
    await assertScope(req, a, a.employee_id);
    const data = parse(manualSchema.omit({ employee_id: true }).partial().extend({ note: manualSchema.shape.note }), req.body);
    if (data.worksite_id !== undefined || data.project_id !== undefined) await assertScope(req, { worksite_id: data.worksite_id ?? null, project_id: data.project_id ?? null }, a.employee_id);
    res.json(await presences.upsertManual(db, { employee_id: a.employee_id, check_in: a.check_in, check_out: a.check_out, ...(data.project_id !== undefined || data.worksite_id !== undefined || data.place_id !== undefined ? {} : { project_id: a.project_id, worksite_id: a.worksite_id, place_id: a.place_id }), ...data, id: a.id }, req.user.id));
  }));
  r.delete('/attendance/:id', correct, ah(async (req, res) => {
    const a = await db('hr_attendances').where({ id: idParam(req) }).first('employee_id', 'worksite_id', 'project_id');
    if (!a) throw new HttpError(404, 'Pointage introuvable.');
    await notMine(req, a.employee_id);
    await assertScope(req, a, a.employee_id);
    if (!(await db('hr_attendances').where({ id: idParam(req) }).del())) throw new HttpError(404, 'Pointage introuvable.');
    res.json({ ok: true });
  }));

  // ─── Positions de pointage (RH › Réglages) ────────────────
  // Lecture : service RH et réglages RH ; modification : « Positions de pointage » (choix du client du 02/11 : responsable RH,
  // responsable des exploitations, super administrateur)
  r.get('/attendance/zones', ah(async (req, res) => {
    if (!['rh:read', 'rh:rules', 'presence:zones'].some(p => req.can(p))) throw new HttpError(403, 'Droits insuffisants.');
    res.json(await presences.zones(db));
  }));
  // Changer une position existante : en attente du super administrateur (sauf s'il la fait lui-même)
  r.put('/attendance/zones/:kind(lieu|chantier)/:id', requirePermission('presence:zones'), ah(async (req, res) => {
    const result = await presences.setZone(db, req.params.kind, idParam(req), parse(zoneSchema, req.body), req.user);
    res.json({ ...result, ...(await presences.zones(db)) });
  }));
  r.post('/attendance/zones/requests/:id/decide', ah(async (req, res) => {
    const data = parse(z.object({ action: z.enum(['valider', 'refuser', 'annuler']), note: z.string().trim().max(255).optional().nullable() }), req.body);
    res.json(await presences.decideZone(db, idParam(req), data, req.user));
  }));

  // ─── Heures supplémentaires ───────────────────────────────
  r.get('/overtime', ah(async (req, res) => {
    if (!req.can('rh:read') && !canPoint(req)) throw new HttpError(403, 'Droits insuffisants.');
    const p = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : new Date().toISOString().slice(0, 7);
    const sc = await presences.scopeOf(db, req);
    res.json(await presences.overtimeReport(db, p, { withPay: req.can('paie:read'), employeeIds: sc ? await presences.scopedEmployeeIds(db, sc) : null }));
  }));
  r.post('/overtime/approve', requirePermission('rh:overtime'), ah(async (req, res) => {
    const data = parse(z.object({ period, employee_ids: z.array(z.number().int().positive()).min(1).max(500).optional() }), req.body);
    res.json(await presences.approveOvertime(db, data.period, data.employee_ids || null, req.user.id));
  }));

  return r;
};
