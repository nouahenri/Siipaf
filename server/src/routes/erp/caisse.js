/** ERP · Comptabilité › Caisse : point de caisse du jour, saisie des entrées et sorties, arrêté du soir, natures. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { z } = require('../../lib/zod');
const { ah, parse, idParam, HttpError, isoDay } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { uploadsDir } = require('../../config');
const caisse = require('../../services/caisse');

// Justificatif d'une opération de caisse (reçu, facture, bon), privé : hors de la partie publique de /uploads
const filesDir = path.join(uploadsDir, 'private', 'caisse');
const FILE_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };
function fileUpload() {
  fs.mkdirSync(filesDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({ destination: filesDir, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${FILE_MIME[file.mimetype]}`) }),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(FILE_MIME[file.mimetype] ? null : new HttpError(400, 'Justificatif : envoyez un PDF ou une image (JPEG, PNG, WebP, HEIC), 15 Mo au plus.'), !!FILE_MIME[file.mimetype]),
  }).single('file');
}
const removeFile = filename => (filename ? fs.promises.unlink(path.join(filesDir, path.basename(filename))).catch(() => {}) : null);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);

module.exports = function caisseRoutes(db) {
  const r = express.Router();
  const read = requirePermission('compta:read', 'caisse:write');
  const write = requirePermission('caisse:write');
  // Natures : la trésorière en ajoute en saisissant ; la Comptabilité les règle aussi dans ses Réglages
  const natures = requirePermission('caisse:write', 'compta:settings');

  r.get('/meta', read, ah(async (req, res) => {
    const [journal, list, projects, employees, suppliers, settings] = await Promise.all([
      caisse.cashJournal(db).catch(() => null), caisse.natures(db), db('projects').orderBy('name').select('id', 'name'),
      db('employees').where({ active: true }).orderBy(['last_name', 'first_name']).select('id', 'last_name', 'first_name', 'matricule'),
      db('suppliers').where({ active: true }).orderBy('name').select('id', 'name'),
      require('../../services/compta').getSettings(db),
    ]);
    res.json({
      journal, natures: list, projects, suppliers, denominations: caisse.DENOMINATIONS, today: isoDay(new Date()),
      employees: employees.map(e => ({ id: e.id, name: `${e.last_name} ${e.first_name}`, matricule: e.matricule })),
      accounts: { cash_shortage: settings.accounts.cash_shortage, cash_surplus: settings.accounts.cash_surplus },
    });
  }));

  r.get('/day', read, ah(async (req, res) => {
    const date = req.query.date ? parse(day, String(req.query.date)) : isoDay(new Date());
    res.json(await caisse.dayBook(db, date, { showCancelled: req.query.annulees === '1' }));
  }));

  r.get('/days', read, ah(async (req, res) => {
    const to = req.query.to ? parse(day, String(req.query.to)) : isoDay(new Date());
    const from = req.query.from ? parse(day, String(req.query.from)) : isoDay(new Date(new Date(`${to}T12:00:00Z`).getTime() - 30 * 864e5));
    res.json(await caisse.recentDays(db, { from, to }));
  }));

  // ─── Entrées et sorties ───────────────────────────────────
  r.post('/movements', write, ah(async (req, res) => {
    const data = parse(z.object({
      date: day, direction: z.enum(['entree', 'sortie']), nature_id: z.number().int().positive(), amount: z.number().int().positive().max(1e12),
      label: z.string().trim().min(2).max(200), beneficiary: optText(160), partner_id: z.number().int().positive().optional().nullable(),
      project_id: z.number().int().positive().optional().nullable(), reference: optText(60),
    }), req.body);
    const m = await caisse.addMovement(db, data, req.user);
    res.status(201).json({ ...m, date: isoDay(m.date) });
  }));

  r.delete('/movements/:id', write, ah(async (req, res) => {
    const m = await caisse.removeMovement(db, idParam(req), req.user);
    await removeFile(m.document_filename);
    res.json({ ok: true });
  }));

  // Justificatif : déposé ou remplacé tant que la journée n'est pas arrêtée
  r.put('/movements/:id/document', write, fileUpload(), ah(async (req, res) => {
    const drop = () => removeFile(req.file?.filename);
    const m = await db('cash_movements').where({ id: idParam(req) }).first();
    if (!m) { await drop(); throw new HttpError(404, 'Mouvement introuvable.'); }
    if (!req.file) throw new HttpError(400, 'Aucun fichier reçu.');
    if (await db('cash_closings').where({ date: isoDay(m.date) }).first('id') && m.document_filename) { await drop(); throw new HttpError(409, 'Journée arrêtée : le justificatif ne se remplace plus.'); }
    await db('cash_movements').where({ id: m.id }).update({ document_filename: req.file.filename, document_name: req.file.originalname.slice(0, 255), document_mime: req.file.mimetype, document_size: req.file.size });
    await removeFile(m.document_filename);
    res.json({ ok: true });
  }));

  r.get('/movements/:id/document', read, ah(async (req, res) => {
    const m = await db('cash_movements').where({ id: idParam(req) }).first('document_filename', 'document_name', 'document_mime');
    if (!m?.document_filename) throw new HttpError(404, 'Aucun justificatif.');
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(m.document_name || 'justificatif')}`);
    res.type(m.document_mime).sendFile(path.join(filesDir, path.basename(m.document_filename)), err => err && !res.headersSent && res.sendStatus(404));
  }));

  // ─── Arrêté du soir ───────────────────────────────────────
  r.post('/closings', write, ah(async (req, res) => {
    const data = parse(z.object({
      date: day, counted: z.number().int().min(0).optional().nullable(), denominations: z.record(z.number().int().min(0).max(1e7)).optional().nullable(), note: optText(500),
    }), req.body);
    await caisse.closeDay(db, data, req.user);
    res.status(201).json(await caisse.dayBook(db, data.date));
  }));

  r.delete('/closings/:date', requirePermission('compta:validate'), ah(async (req, res) => {
    const date = parse(day, req.params.date);
    await caisse.reopenDay(db, date, req.user);
    res.json(await caisse.dayBook(db, date));
  }));

  // ─── Natures des opérations ───────────────────────────────
  const natureSchema = z.object({
    label: z.string().trim().min(2).max(120), direction: z.enum(['entree', 'sortie']), account: z.string().trim().min(2).max(12),
    active: z.boolean().optional(), sort: z.number().int().min(0).max(10000).optional(),
  });
  r.post('/natures', natures, ah(async (req, res) => res.status(201).json(await caisse.saveNature(db, null, parse(natureSchema, req.body)))));
  r.patch('/natures/:id', natures, ah(async (req, res) => res.json(await caisse.saveNature(db, idParam(req), parse(natureSchema.partial(), req.body)))));

  return r;
};
