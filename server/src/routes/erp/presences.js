/** ERP · RH › Présences : pointage en ligne et sur borne, feuilles de présence de chantier, heures supplémentaires. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const rh = require('../../services/rh');
const presences = require('../../services/presences');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois attendu au format AAAA-MM');
const hm = z.string().regex(/^\d{2}:\d{2}$/, 'Heure au format HH:MM');
const projectId = z.number().int().positive().optional().nullable();

module.exports = function presencesRoutes(db) {
  const r = express.Router();
  const pointer = requirePermission('presence:write');
  const canPoint = req => req.can('presence:write') || req.can('rh:overtime');

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
    res.json({ open: await presences.openOf(db, e.id), month, rows, has_pin: !!e.attendance_pin_hash, hours: Math.round(rows.reduce((t, a) => t + (a.hours || 0), 0) * 100) / 100 });
  }));
  r.post('/me/attendance', requirePermission('self:pointage'), ah(async (req, res) => {
    const e = await me(req);
    const s = await rh.getSettings(db);
    const data = parse(z.object({ project_id: projectId, latitude: z.number().min(-90).max(90).optional().nullable(), longitude: z.number().min(-180).max(180).optional().nullable() }), req.body);
    res.json(await presences.toggle(db, e, { ...data, latitude: s.geolocation ? data.latitude ?? null : null, longitude: s.geolocation ? data.longitude ?? null : null, source: 'web', userId: req.user.id }));
  }));
  r.put('/me/pin', requirePermission('self:pointage'), ah(async (req, res) => {
    const e = await me(req);
    const { pin } = parse(z.object({ pin: z.string() }), req.body);
    await presences.setPin(db, e.id, pin);
    res.json({ ok: true });
  }));

  // ─── Borne de pointage (tablette ouverte par un compte autorisé) ──
  r.post('/attendance/kiosk', pointer, ah(async (req, res) => {
    const data = parse(z.object({ matricule: z.string().trim().min(3).max(20), pin: z.string().min(4).max(6), project_id: projectId }), req.body);
    res.json(await presences.kiosk(db, data, req.user.id));
  }));
  r.put('/employees/:id/pin', requirePermission('rh:files'), ah(async (req, res) => {
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
    }
    const from = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? new Date(`${req.query.from}T00:00:00Z`) : new Date(Date.now() - 7 * 86400000);
    const to = req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? new Date(new Date(`${req.query.to}T00:00:00Z`).getTime() + 86400000) : new Date(Date.now() + 86400000);
    q.where('a.check_in', '>=', from).where('a.check_in', '<', to);
    if (req.query.employee_id) q.where('a.employee_id', Number(req.query.employee_id));
    if (req.query.project_id) q.where('a.project_id', Number(req.query.project_id));
    res.json((await q.limit(1000)).map(presences.serialize));
  }));

  r.get('/attendance/today', ah(async (req, res) => {
    if (!req.can('rh:read') && !canPoint(req)) throw new HttpError(403, 'Droits insuffisants.');
    res.json(await presences.today(db));
  }));

  r.post('/attendance/sheet', pointer, ah(async (req, res) => {
    const data = parse(z.object({
      date: day, project_id: projectId,
      rows: z.array(z.object({ employee_id: z.number().int().positive(), periods: z.array(z.tuple([hm, hm])).max(3), note: z.string().trim().max(255).optional() })).min(1).max(300),
    }), req.body);
    if (data.date > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Feuille de présence d’un jour à venir.');
    res.status(201).json({ created: await presences.saveSheet(db, data, req.user.id) });
  }));

  const manualSchema = z.object({
    employee_id: z.number().int().positive(), check_in: z.string().min(10), check_out: z.string().min(10).optional().nullable(),
    project_id: projectId, note: z.string().trim().min(3, 'Motif de la correction obligatoire').max(255),
  });
  r.post('/attendance', pointer, ah(async (req, res) => res.status(201).json(await presences.upsertManual(db, parse(manualSchema, req.body), req.user.id))));
  r.patch('/attendance/:id', pointer, ah(async (req, res) => {
    const a = await db('hr_attendances').where({ id: idParam(req) }).first();
    if (!a) throw new HttpError(404, 'Pointage introuvable.');
    const data = parse(manualSchema.partial().extend({ note: manualSchema.shape.note }), req.body);
    res.json(await presences.upsertManual(db, { employee_id: a.employee_id, check_in: a.check_in, check_out: a.check_out, project_id: a.project_id, ...data, id: a.id }, req.user.id));
  }));
  r.delete('/attendance/:id', pointer, ah(async (req, res) => {
    if (!(await db('hr_attendances').where({ id: idParam(req) }).del())) throw new HttpError(404, 'Pointage introuvable.');
    res.json({ ok: true });
  }));

  // ─── Heures supplémentaires ───────────────────────────────
  r.get('/overtime', ah(async (req, res) => {
    if (!req.can('rh:read') && !canPoint(req)) throw new HttpError(403, 'Droits insuffisants.');
    const p = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : new Date().toISOString().slice(0, 7);
    res.json(await presences.overtimeReport(db, p, { withPay: req.can('paie:read') }));
  }));
  r.post('/overtime/approve', requirePermission('rh:overtime'), ah(async (req, res) => {
    const data = parse(z.object({ period, employee_ids: z.array(z.number().int().positive()).min(1).max(500).optional() }), req.body);
    res.json(await presences.approveOvertime(db, data.period, data.employee_ids || null, req.user.id));
  }));

  return r;
};
