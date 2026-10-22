/** ERP · Administration générale › Courrier arrivée / départ : registre, scan, affectation, suite donnée, relances. */
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { MAIL_DIRECTIONS, MAIL_SUITES, MAIL_NATURES, MAIL_CHANNELS, MAIL_STATUSES } = require('../../lib/domain');
const { DEPARTMENTS } = require('../../lib/paie');
const courrier = require('../../services/courrier');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
// Les champs arrivent en multipart (scan joint) : vides, booléens et nombres convertis ici
const opt = s => z.preprocess(v => (v === '' || v == null || v === 'null' ? null : v), s.nullable()).optional();
const bool = z.preprocess(v => v === true || v === 'true' || v === '1' || v === 1, z.boolean());
const optId = z.preprocess(v => (v === '' || v == null || v === 'null' ? null : Number(v)), z.number().int().positive().nullable()).optional();
const mailSchema = z.object({
  direction: z.enum(['arrivee', 'depart']), date: day, letter_date: opt(day), letter_ref: opt(z.string().trim().max(100)),
  correspondent: z.string().trim().min(2).max(200), subject: z.string().trim().min(3).max(300),
  nature: z.string().max(20).optional(), channel: z.string().max(20).optional(),
  confidential: bool.optional(), urgent: bool.optional(), notes: opt(z.string().trim().max(2000)), reply_to_id: optId,
});
const assignSchema = z.object({
  suite: z.enum(Object.keys(MAIL_SUITES)), assigned_to: optId, assigned_department: opt(z.string().max(20)),
  due_date: opt(day), instructions: opt(z.string().trim().max(1000)),
});

module.exports = function courrierRoutes(db) {
  const r = express.Router();
  const v = req => courrier.viewer(db, req.user, p => req.can(p));
  const cleanup = req => req.file && fs.promises.unlink(req.file.path).catch(() => {});
  const guarded = fn => ah(async (req, res) => { try { await fn(req, res); } catch (e) { await cleanup(req); throw e; } });

  r.get('/badges', ah(async (req, res) => res.json(await courrier.badges(db, await v(req)))));

  r.get('/refs', ah(async (req, res) => {
    const label = o => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, typeof x === 'string' ? x : x.label]));
    const users = req.can('courrier:assign') || req.can('courrier:write')
      ? await db('users').where({ active: true }).orderBy('name').select('id', 'name', 'role') : [];
    res.json({
      directions: label(MAIL_DIRECTIONS), suites: MAIL_SUITES, natures: MAIL_NATURES, channels: MAIL_CHANNELS, statuses: MAIL_STATUSES,
      departments: DEPARTMENTS, users,
    });
  }));

  /**
   * Registre : tout le courrier pour le secrétariat et la direction (confidentiel réduit au n° d'ordre),
   * sinon ses seuls courriers affectés. Filtres : direction, status, year, mine=1, late=1, q (texte).
   */
  r.get('/', ah(async (req, res) => {
    const viewer = await v(req);
    const registry = ['courrier:read', 'courrier:write', 'courrier:assign'].some(p => req.can(p));
    const q = courrier.query(db).orderBy('m.date', 'desc').orderBy('m.id', 'desc');
    const mine = w => {
      w.where('m.assigned_to', viewer.userId);
      if (viewer.department) w.orWhere(x => x.whereNull('m.assigned_to').where('m.assigned_department', viewer.department));
    };
    if (!registry || req.query.mine === '1') q.where(mine);
    if (req.query.direction) q.where('m.direction', String(req.query.direction));
    if (req.query.status) q.whereIn('m.status', String(req.query.status).split(','));
    if (req.query.year) q.where('m.year', Number(req.query.year));
    if (req.query.late === '1') q.where('m.status', 'affecte').where('m.due_date', '<', new Date().toISOString().slice(0, 10));
    let rows = (await q.limit(2000)).map(m => courrier.serialize(m, viewer));
    const text = String(req.query.q || '').trim().toLowerCase();
    if (text) {
      rows = rows.filter(m => [m.number, m.subject, m.correspondent, m.letter_ref, m.assigned_to_name].some(x => x && String(x).toLowerCase().includes(text)));
    }
    res.json(rows);
  }));

  r.post('/', courrier.scanUpload(), guarded(async (req, res) => {
    const id = await courrier.create(db, parse(mailSchema, req.body), { file: req.file, user: req.user, can: p => req.can(p) });
    res.status(201).json(await courrier.detail(db, id, await v(req)));
  }));

  async function visible(req) {
    const m = await courrier.load(db, idParam(req));
    const viewer = await v(req);
    const s = courrier.serialize(m, viewer);
    if (s.masked && !['courrier:read', 'courrier:write', 'courrier:assign'].some(p => req.can(p))) throw new HttpError(404, 'Courrier introuvable.');
    return { m, viewer, s };
  }

  r.get('/:id', ah(async (req, res) => {
    const { m, viewer } = await visible(req);
    res.json(await courrier.detail(db, m.id, viewer));
  }));
  r.patch('/:id', courrier.scanUpload(), guarded(async (req, res) => {
    const { m, viewer } = await visible(req);
    await courrier.update(db, m, parse(mailSchema.partial(), req.body), { file: req.file, v: viewer });
    res.json(await courrier.detail(db, m.id, viewer));
  }));
  r.post('/:id/assign', requirePermission('courrier:assign'), ah(async (req, res) => {
    const { m, viewer } = await visible(req);
    await courrier.assign(db, m, parse(assignSchema, req.body), { user: req.user });
    res.json(await courrier.detail(db, m.id, viewer));
  }));
  r.post('/:id/done', ah(async (req, res) => {
    const { m, viewer } = await visible(req);
    const { note } = parse(z.object({ note: z.string().trim().max(2000).optional() }), req.body || {});
    await courrier.done(db, m, note || null, { v: viewer, user: req.user });
    res.json(await courrier.detail(db, m.id, viewer));
  }));
  r.post('/:id/reopen', requirePermission('courrier:assign'), ah(async (req, res) => {
    const { m, viewer } = await visible(req);
    await courrier.reopen(db, m);
    res.json(await courrier.detail(db, m.id, viewer));
  }));
  r.post('/:id/cancel', ah(async (req, res) => {
    const { m, viewer } = await visible(req);
    const { reason } = parse(z.object({ reason: z.string().trim().max(500).optional() }), req.body || {});
    await courrier.cancel(db, m, reason || null, { v: viewer });
    res.json(await courrier.detail(db, m.id, viewer));
  }));

  r.get('/:id/scan', ah(async (req, res) => {
    const { m, s } = await visible(req);
    if (s.masked) throw new HttpError(403, 'Courrier confidentiel.');
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(m.scan_name || 'scan')}`);
    res.sendFile(courrier.scanPath(m), err => err && !res.headersSent && res.sendStatus(404));
  }));

  return r;
};
