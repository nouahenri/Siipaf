/** ERP · Administration générale › Documents internes : publication, versions, accusés de lecture, actions des PV. */
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { DOC_KINDS, DOC_AUDIENCES, DOC_STATUSES } = require('../../lib/domain');
const { DEPARTMENTS } = require('../../lib/paie');
const docs = require('../../services/docs');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
// Multipart (fichier joint) : vides, booléens et listes JSON convertis ici
const blank = v => (v === '' || v == null || v === 'null' ? null : v);
const opt = s => z.preprocess(blank, s.nullable()).optional();
const bool = z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean());
const list = s => z.preprocess(v => (typeof v === 'string' ? JSON.parse(v || '[]') : v), z.array(s).max(500));
const docSchema = z.object({
  kind: z.enum(Object.keys(DOC_KINDS)), title: z.string().trim().min(3).max(200), body: opt(z.string().max(50000)),
  audience: z.enum(Object.keys(DOC_AUDIENCES)).optional(), audience_departments: list(z.string().max(20)).optional(),
  audience_users: list(z.number().int().positive()).optional(), ack_required: bool.optional(), ack_deadline: opt(day), meeting_date: opt(day),
});
const actionSchema = z.object({
  label: z.string().trim().min(2).max(255), owner_id: z.number().int().positive().nullable().optional(), due_date: day.nullable().optional(),
  status: z.enum(['a_faire', 'fait']).optional(), done_note: z.string().trim().max(255).nullable().optional(),
});

module.exports = function docsRoutes(db) {
  const r = express.Router();
  const scope = req => docs.scopeOf(db, req.user, p => req.can(p));
  const cleanup = req => req.file && fs.promises.unlink(req.file.path).catch(() => {});
  const guarded = fn => ah(async (req, res) => { try { await fn(req, res); } catch (e) { await cleanup(req); throw e; } });

  r.get('/refs', ah(async (req, res) => {
    const s = await scope(req);
    const users = docs.canPublish(s) ? await db('users').where({ active: true }).orderBy('name').select('id', 'name') : [];
    res.json({ kinds: DOC_KINDS, audiences: DOC_AUDIENCES, statuses: DOC_STATUSES, departments: DEPARTMENTS, users, scope: { all: s.all, chief: s.chief, department: s.department, can_publish: docs.canPublish(s) } });
  }));
  r.get('/badges', ah(async (req, res) => res.json(await docs.badges(db, req.user.id))));

  /** Mon espace : documents qui me sont adressés et actions des PV qui me sont confiées. */
  r.get('/moi', ah(async (req, res) => res.json({ documents: await docs.inbox(db, req.user.id), actions: await docs.myActions(db, req.user.id) })));

  /** Gestion : tous les documents (docs:publish) ou ceux du chef de service. */
  r.get('/', ah(async (req, res) => {
    const s = await scope(req);
    if (!docs.canPublish(s)) throw new HttpError(403, 'Droits insuffisants.');
    const q = docs.query(db).orderBy('d.updated_at', 'desc').limit(1000);
    if (!s.all) q.where('d.author_id', s.userId);
    if (req.query.kind) q.where('d.kind', String(req.query.kind));
    if (req.query.status) q.whereIn('d.status', String(req.query.status).split(','));
    const rows = (await q).map(docs.serialize);
    const ids = rows.filter(d => d.status !== 'brouillon').map(d => d.id);
    const recipients = ids.length ? await db('internal_doc_recipients').whereIn('doc_id', ids).groupBy('doc_id').select('doc_id').count({ n: '*' }) : [];
    const reads = ids.length ? await db('internal_doc_reads as x').join('internal_docs as d', function on() { this.on('d.id', 'x.doc_id').andOn('d.version', 'x.version'); })
      .whereIn('x.doc_id', ids).groupBy('x.doc_id').select('x.doc_id').count({ n: '*' }) : [];
    const by = (arr, id) => Number(arr.find(x => x.doc_id === id)?.n || 0);
    const text = String(req.query.q || '').trim().toLowerCase();
    res.json(rows.filter(d => !text || [d.reference, d.title].some(x => x.toLowerCase().includes(text)))
      .map(d => ({ ...d, body: undefined, recipients: by(recipients, d.id), reads: by(reads, d.id) })));
  }));

  r.post('/', docs.fileUpload(), guarded(async (req, res) => {
    const s = await scope(req);
    const id = await docs.create(db, parse(docSchema, req.body), { file: req.file, s });
    res.status(201).json(await docs.detail(db, id, s));
  }));

  async function visible(req) {
    const s = await scope(req);
    const d = await docs.load(db, idParam(req));
    if (!(await docs.canSee(db, d, s))) throw new HttpError(404, 'Document introuvable.');
    return { d, s };
  }
  r.get('/:id', ah(async (req, res) => { const { d, s } = await visible(req); res.json(await docs.detail(db, d.id, s)); }));
  r.patch('/:id', docs.fileUpload(), guarded(async (req, res) => {
    const { d, s } = await visible(req);
    await docs.update(db, d, parse(docSchema.partial(), req.body), { file: req.file, s });
    res.json(await docs.detail(db, d.id, s));
  }));
  r.post('/:id/publier', ah(async (req, res) => { const { d, s } = await visible(req); await docs.publish(db, d, { s }); res.json(await docs.detail(db, d.id, s)); }));
  r.post('/:id/version', docs.fileUpload(), guarded(async (req, res) => {
    const { d, s } = await visible(req);
    const data = parse(z.object({ change_note: z.string().trim().min(3).max(255), body: opt(z.string().max(50000)), ack_deadline: opt(day) }), req.body);
    await docs.newVersion(db, d, data, { file: req.file, s });
    res.json(await docs.detail(db, d.id, s));
  }));
  r.post('/:id/archiver', ah(async (req, res) => { const { d, s } = await visible(req); await docs.archive(db, d, { s }); res.json(await docs.detail(db, d.id, s)); }));
  r.post('/:id/lu', ah(async (req, res) => { const { d, s } = await visible(req); await docs.markRead(db, d, req.user.id); res.json(await docs.detail(db, d.id, s)); }));
  r.delete('/:id', ah(async (req, res) => {
    const { d, s } = await visible(req);
    if (!docs.canManage(d, s) || d.status !== 'brouillon') throw new HttpError(409, 'Seul un brouillon se supprime ; un document publié s’archive.');
    await db('internal_docs').where({ id: d.id }).del();
    res.json({ ok: true });
  }));
  r.get('/:id/fichier', ah(async (req, res) => {
    const { d } = await visible(req);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.file_name || 'document')}`);
    res.sendFile(docs.filePath(d), err => err && !res.headersSent && res.sendStatus(404));
  }));

  // Actions des PV
  r.post('/:id/actions', ah(async (req, res) => {
    const { d, s } = await visible(req);
    await docs.addAction(db, d, parse(actionSchema, req.body), { s });
    res.status(201).json(await docs.detail(db, d.id, s));
  }));
  r.patch('/actions/:id', ah(async (req, res) => {
    const a = await db('internal_doc_actions').where({ id: idParam(req) }).first();
    if (!a) throw new HttpError(404, 'Action introuvable.');
    const s = await scope(req);
    const d = await docs.load(db, a.doc_id);
    await docs.updateAction(db, a, d, parse(actionSchema.partial(), req.body), { s });
    res.json(await docs.detail(db, d.id, s));
  }));

  return r;
};
