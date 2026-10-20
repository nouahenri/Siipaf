/** Contenu éditable du site (diaporama, textes, réglages) et médiathèque. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, json } = require('../lib/http');
const { requirePermission } = require('../auth');
const { uploadsDir } = require('../config');
const { slotById, imageAssignments, imagePlacements, assignImage } = require('../services/siteImages');

// Clés de contenu connues et leur forme
const heroSlide = z.object({
  media_id: z.number().int().positive().nullable(),
  badge: z.string().max(120).optional(),
  title: z.string().max(160),
  title_em: z.string().max(120).optional(),
  text: z.string().max(300).optional(),
  cta_label: z.string().max(60).optional(),
  cta_href: z.string().max(255).optional(),
  cta2_label: z.string().max(60).optional(),
  cta2_href: z.string().max(255).optional(),
  active: z.boolean().default(true),
});
const CONTENT_SCHEMAS = {
  hero: z.object({ slides: z.array(heroSlide).max(12), autoplay_ms: z.number().int().min(2000).max(20000).default(5000) }),
  ticker: z.object({ items: z.array(z.object({ text: z.string().max(200), href: z.string().max(255).optional() })).max(20) }),
  stats: z.object({ items: z.array(z.object({ value: z.number(), unit: z.string().max(20).optional(), label: z.string().max(60) })).max(8) }),
  site: z.object({
    phone: z.string().max(40).optional(),
    phone2: z.string().max(40).optional(),
    email: z.string().max(190).optional(),
    address: z.string().max(255).optional(),
    whatsapp: z.string().max(40).optional(),
    socials: z.record(z.string().max(255)).optional(),
  }),
};

const ALLOWED_MIME = {
  // Pas de SVG : il peut contenir du script exécuté depuis notre propre domaine
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'application/pdf': '.pdf', 'video/mp4': '.mp4',
  // Vidéos de chantier filmées au téléphone (iPhone : .mov ; Android : .mp4 ou .webm)
  'video/quicktime': '.mov', 'video/webm': '.webm',
};

module.exports = function contentRoutes(db) {
  const r = express.Router();

  r.get('/content', ah(async (req, res) => {
    const rows = await db('site_content');
    res.json(Object.fromEntries(rows.map(row => [row.key, json(row.value)])));
  }));

  r.put('/content/:key', requirePermission('content:write'), ah(async (req, res) => {
    const schema = CONTENT_SCHEMAS[req.params.key];
    if (!schema) throw new HttpError(404, 'Clé de contenu inconnue.');
    const value = parse(schema, req.body);
    const row = { key: req.params.key, value: JSON.stringify(value), updated_by: req.user.id, updated_at: new Date() };
    await db('site_content').insert(row).onConflict('key').merge();
    res.json(value);
  }));

  // ─── Médiathèque ──────────────────────────────────────────
  r.get('/media-placements', requirePermission('content:write'), ah(async (req, res) => {
    res.json(await imagePlacements(db));
  }));

  r.get('/media-placements/default/:slot', requirePermission('content:write'), ah(async (req, res) => {
    const slot = slotById(req.params.slot);
    if (!slot) throw new HttpError(404, 'Emplacement inconnu.');
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(path.resolve(__dirname, '../../..', slot.fallback));
  }));

  r.put('/media-placements/:slot', requirePermission('content:write'), ah(async (req, res) => {
    const data = parse(z.object({ media_id: z.number().int().positive().nullable(), alt: z.string().trim().max(255).optional() }), req.body);
    res.json(await assignImage(db, req.params.slot, data, req.user.id));
  }));

  fs.mkdirSync(uploadsDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ALLOWED_MIME[file.mimetype]}`),
    }),
    limits: { fileSize: 200 * 1024 * 1024, files: 10 },
    fileFilter: (req, file, cb) => cb(ALLOWED_MIME[file.mimetype] ? null : new HttpError(400, `Type de fichier non accepté : ${file.mimetype}`), !!ALLOWED_MIME[file.mimetype]),
  });

  r.get('/media', requirePermission('projects:read'), ah(async (req, res) => {
    const q = db('media').orderBy('id', 'desc').limit(Math.min(Number(req.query.limit) || 100, 500));
    if (req.query.type === 'image') q.where('mime', 'like', 'image/%');
    if (req.query.type === 'pdf') q.where({ mime: 'application/pdf' });
    if (req.query.type === 'video') q.where('mime', 'like', 'video/%');
    res.json((await q).map(m => ({ ...m, url: `/uploads/${m.filename}` })));
  }));

  r.post('/media', requirePermission('media:write'), upload.array('files', 10), ah(async (req, res) => {
    const meta = req.body.meta ? JSON.parse(req.body.meta) : [];
    const out = [];
    for (const [i, f] of (req.files || []).entries()) {
      const m = meta[i] || {};
      const row = {
        filename: f.filename, original_name: f.originalname.slice(0, 255), mime: f.mimetype, size: f.size,
        width: Number(m.width) || null, height: Number(m.height) || null, alt: m.alt ? String(m.alt).slice(0, 255) : null,
        uploaded_by: req.user.id,
      };
      const [id] = await db('media').insert(row);
      out.push({ id, ...row, url: `/uploads/${f.filename}` });
    }
    if (!out.length) throw new HttpError(400, 'Aucun fichier reçu.');
    res.status(201).json(out);
  }));

  r.patch('/media/:id', requirePermission('media:write'), ah(async (req, res) => {
    const data = parse(z.object({ alt: z.string().max(255).nullable() }), req.body);
    const n = await db('media').where({ id: idParam(req) }).update(data);
    if (!n) throw new HttpError(404, 'Fichier introuvable.');
    res.json({ ok: true });
  }));

  r.delete('/media/:id', requirePermission('media:write'), ah(async (req, res) => {
    const id = idParam(req);
    const m = await db('media').where({ id }).first();
    if (!m) throw new HttpError(404, 'Fichier introuvable.');
    const used = await db('projects').where({ cover_media_id: id }).first()
      || await db('site_plans').where({ media_id: id }).first();
    if (used) throw new HttpError(409, 'Ce fichier est utilisé par un projet ou un plan de masse.');
    const assignments = await imageAssignments(db);
    if (Object.values(assignments).some(a => a.media_id === id)) {
      throw new HttpError(409, 'Cette image est affectée à une section du site. Retirez son affectation avant de la supprimer.');
    }
    const hero = await db('site_content').where({ key: 'hero' }).first();
    if ((json(hero?.value, {}).slides || []).some(s => s.media_id === id)) {
      throw new HttpError(409, 'Cette image est utilisée dans le diaporama d’accueil. Retirez-la du diaporama avant de la supprimer.');
    }
    await db('media').where({ id }).del();
    fs.rm(path.join(uploadsDir, path.basename(m.filename)), { force: true }, () => {});
    res.json({ ok: true });
  }));

  return r;
};
