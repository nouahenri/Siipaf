/** Témoignages : dépôt public (à valider), affichage des publiés, modération dans le dashboard. */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../lib/http');
const { requirePermission } = require('../auth');
const { notifyTeam } = require('../lib/mailer');
const { isTest } = require('../config');

const STATUSES = ['en_attente', 'publie', 'refuse'];

const fields = {
  name: z.string().trim().min(2, 'Nom requis').max(120),
  role_label: z.string().trim().max(120).nullable().optional(),
  project_id: z.number().int().positive().nullable().optional(),
  rating: z.number().int().min(1).max(5),
  message: z.string().trim().min(20, 'Votre témoignage doit faire au moins 20 caractères.').max(1000),
};

const publicView = t => ({
  id: t.id, name: t.name, role_label: t.role_label, project: t.project_name || null, rating: t.rating,
  message: t.message, photo: t.photo_media_id ? `/uploads/by-id/${t.photo_media_id}` : null,
  featured: !!t.featured, date: t.created_at,
});

/** Routes publiques, montées sous /api/public. */
function publicTestimonials(db) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: isTest ? 1000 : 5, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Trop d’envois, réessayez plus tard.' } });

  r.get('/testimonials', ah(async (req, res) => {
    const rows = await db('testimonials as t').leftJoin('projects as p', 'p.id', 't.project_id')
      .where('t.status', 'publie').select('t.*', 'p.name as project_name')
      .orderBy([{ column: 't.featured', order: 'desc' }, { column: 't.created_at', order: 'desc' }]).limit(24);
    res.json(rows.map(publicView));
  }));

  r.post('/testimonials', limiter, ah(async (req, res) => {
    const data = parse(z.object({
      ...fields,
      email: z.string().trim().toLowerCase().email('E-mail invalide').max(190).optional().or(z.literal('').transform(() => undefined)),
      website: z.string().max(0, 'Spam').optional(), // champ piège anti-robots
    }), req.body);
    const { website, ...row } = data;
    const [id] = await db('testimonials').insert({ ...row, status: 'en_attente', source: 'site' });
    notifyTeam('Nouveau témoignage à valider', `${data.name} (${data.rating}/5)\n\n${data.message}`);
    res.status(201).json({ ok: true, id, message: 'Merci ! Votre témoignage sera publié après validation par notre équipe.' });
  }));

  return r;
}

/** Routes de modération, montées sous /api/admin. */
function adminTestimonials(db) {
  const r = express.Router();

  r.get('/testimonials', requirePermission('testimonials:write'), ah(async (req, res) => {
    const q = db('testimonials as t').leftJoin('projects as p', 'p.id', 't.project_id').leftJoin('users as u', 'u.id', 't.moderated_by')
      .select('t.*', 'p.name as project_name', 'u.name as moderated_by_name').orderBy('t.created_at', 'desc');
    if (req.query.status) q.where('t.status', String(req.query.status));
    const rows = await q;
    const counts = await db('testimonials').select('status').count({ n: '*' }).groupBy('status');
    res.json({
      rows: rows.map(t => ({ ...t, featured: !!t.featured })),
      counts: Object.fromEntries(STATUSES.map(s => [s, Number(counts.find(c => c.status === s)?.n || 0)])),
    });
  }));

  // Saisie interne (témoignage recueilli par téléphone, en agence…) : publié directement
  r.post('/testimonials', requirePermission('testimonials:write'), ah(async (req, res) => {
    const data = parse(z.object({ ...fields, photo_media_id: z.number().int().positive().nullable().optional(), featured: z.boolean().optional() }), req.body);
    const [id] = await db('testimonials').insert({ ...data, status: 'publie', source: 'admin', moderated_by: req.user.id, moderated_at: new Date() });
    res.status(201).json(await db('testimonials').where({ id }).first());
  }));

  r.patch('/testimonials/:id', requirePermission('testimonials:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object({
      ...fields,
      status: z.enum(STATUSES),
      featured: z.boolean(),
      photo_media_id: z.number().int().positive().nullable(),
    }).partial(), req.body);
    const t = await db('testimonials').where({ id }).first();
    if (!t) throw new HttpError(404, 'Témoignage introuvable.');
    const patch = { ...data, updated_at: new Date() };
    if (data.status && data.status !== t.status) Object.assign(patch, { moderated_by: req.user.id, moderated_at: new Date() });
    if (data.status && data.status !== 'publie') patch.featured = false;
    await db('testimonials').where({ id }).update(patch);
    res.json(await db('testimonials').where({ id }).first());
  }));

  r.delete('/testimonials/:id', requirePermission('testimonials:write'), ah(async (req, res) => {
    const n = await db('testimonials').where({ id: idParam(req) }).del();
    if (!n) throw new HttpError(404, 'Témoignage introuvable.');
    res.json({ ok: true });
  }));

  return r;
}

module.exports = { publicTestimonials, adminTestimonials };
