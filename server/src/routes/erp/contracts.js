/** ERP · Administration générale › Contrats et échéances : contrats, pièces à renouveler, échéances, factures préparées. */
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { CONTRACT_KINDS, CONTRACT_FREQUENCIES, CONTRACT_STATUSES, CONTRACT_DOC_KINDS } = require('../../lib/domain');
const contracts = require('../../services/contracts');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
// Les champs arrivent en multipart (fichier du contrat) : vides, booléens et nombres convertis ici
const blank = v => (v === '' || v == null || v === 'null' ? null : v);
const opt = s => z.preprocess(blank, s.nullable()).optional();
const num = s => z.preprocess(v => (blank(v) == null ? null : Number(v)), s.nullable()).optional();
const bool = z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean());
const contractSchema = z.object({
  kind: z.enum(Object.keys(CONTRACT_KINDS)), kind_other: opt(z.string().trim().max(100)), title: z.string().trim().min(3).max(200),
  supplier_id: num(z.number().int().positive()), counterparty: opt(z.string().trim().max(160)), project_id: num(z.number().int().positive()),
  owner_id: num(z.number().int().positive()), start_date: day, end_date: opt(day), tacit_renewal: bool.optional(),
  renewal_months: num(z.number().int().min(1).max(120)), notice_days: num(z.number().int().min(0).max(730)),
  contract_amount: num(z.number().int().min(0)), retention_pct: num(z.number().min(0).max(100)),
  frequency: opt(z.enum(Object.keys(CONTRACT_FREQUENCIES))), amount_ttc: num(z.number().int().positive()), vat_rate: num(z.number().min(0).max(100)),
  expense_account: opt(z.string().trim().max(12)), next_payment_date: opt(day), revision_date: opt(day), revision_note: opt(z.string().trim().max(255)),
  notes: opt(z.string().trim().max(4000)),
});
const docSchema = z.object({ kind: z.enum(Object.keys(CONTRACT_DOC_KINDS)), label: z.string().trim().min(2).max(160), expires_on: opt(day) });

module.exports = function contractRoutes(db) {
  const r = express.Router();
  const v = req => ({ userId: req.user.id, can: p => req.can(p) });
  const cleanup = req => req.file && fs.promises.unlink(req.file.path).catch(() => {});
  const guarded = fn => ah(async (req, res) => { try { await fn(req, res); } catch (e) { await cleanup(req); throw e; } });
  const write = requirePermission('contrats:write');
  // vat_rate : 0 par défaut (colonne non nulle)
  const clean = data => ({ ...data, ...(data.vat_rate === null ? { vat_rate: 0 } : {}) });

  r.get('/badges', ah(async (req, res) => res.json(await contracts.badges(db, v(req)))));

  r.get('/refs', ah(async (req, res) => {
    const can = req.can('contrats:write');
    const [suppliers, projects, users] = can ? await Promise.all([
      db('suppliers').where({ active: true }).orderBy('name').select('id', 'name', 'kind'),
      db('projects').orderBy('name').select('id', 'name'),
      db('users').where({ active: true }).orderBy('name').select('id', 'name'),
    ]) : [[], [], []];
    res.json({ kinds: CONTRACT_KINDS, frequencies: CONTRACT_FREQUENCIES, statuses: CONTRACT_STATUSES, doc_kinds: CONTRACT_DOC_KINDS, suppliers, projects, users });
  }));

  /** Échéances des contrats visibles dans les `days` jours (dépassées comprises). */
  r.get('/echeances', ah(async (req, res) => {
    res.json(await contracts.upcoming(db, v(req), { days: Math.min(Number(req.query.days) || 60, 400) }));
  }));

  r.get('/', ah(async (req, res) => {
    const q = contracts.query(db).orderBy('c.reference', 'desc');
    if (!req.can('contrats:read') && !req.can('contrats:write')) q.where('c.owner_id', req.user.id);
    if (req.query.status) q.whereIn('c.status', String(req.query.status).split(','));
    if (req.query.kind) q.where('c.kind', String(req.query.kind));
    if (req.query.supplier_id) q.where('c.supplier_id', Number(req.query.supplier_id));
    const rows = await q.limit(2000);
    const docs = await contracts.docsByContract(db, rows.map(c => c.id));
    let out = rows.map(c => contracts.serialize(c, docs[c.id] || []));
    const text = String(req.query.q || '').trim().toLowerCase();
    if (text) out = out.filter(c => [c.reference, c.title, c.counterparty_name, c.kind_label, c.project_name].some(x => x && String(x).toLowerCase().includes(text)));
    res.json(out);
  }));

  r.post('/', write, contracts.fileUpload(), guarded(async (req, res) => {
    const id = await contracts.create(db, clean(parse(contractSchema, req.body)), { file: req.file, userId: req.user.id });
    res.status(201).json(await contracts.detail(db, id));
  }));

  async function visible(req) {
    const c = await contracts.load(db, idParam(req));
    if (!contracts.canSee(c, v(req))) throw new HttpError(404, 'Contrat introuvable.');
    return c;
  }

  r.get('/:id', ah(async (req, res) => res.json(await contracts.detail(db, (await visible(req)).id))));
  r.patch('/:id', write, contracts.fileUpload(), guarded(async (req, res) => {
    const c = await contracts.load(db, idParam(req));
    await contracts.update(db, c, clean(parse(contractSchema.partial(), req.body)), { file: req.file });
    res.json(await contracts.detail(db, c.id));
  }));
  r.post('/:id/close', write, ah(async (req, res) => {
    const c = await contracts.load(db, idParam(req));
    const data = parse(z.object({ status: z.enum(['resilie', 'termine']), date: day, reason: z.string().trim().max(255).optional() }), req.body);
    await contracts.close(db, c, data);
    res.json(await contracts.detail(db, c.id));
  }));
  r.post('/:id/reopen', write, ah(async (req, res) => {
    const c = await contracts.load(db, idParam(req));
    await contracts.reopen(db, c);
    res.json(await contracts.detail(db, c.id));
  }));
  r.get('/:id/fichier', ah(async (req, res) => {
    const c = await visible(req);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(c.file_name || 'contrat')}`);
    res.sendFile(contracts.filePath(c), err => err && !res.headersSent && res.sendStatus(404));
  }));

  // ─── Pièces à renouveler ──────────────────────────────────
  r.post('/:id/documents', write, contracts.fileUpload(), guarded(async (req, res) => {
    const c = await contracts.load(db, idParam(req));
    await contracts.addDocument(db, c, parse(docSchema, req.body), { file: req.file, userId: req.user.id });
    res.status(201).json(await contracts.detail(db, c.id));
  }));
  async function loadDoc(req) {
    const d = await db('contract_documents').where({ id: idParam(req) }).first();
    if (!d) throw new HttpError(404, 'Pièce introuvable.');
    return d;
  }
  r.patch('/documents/:id', write, contracts.fileUpload(), guarded(async (req, res) => {
    const d = await loadDoc(req);
    await contracts.updateDocument(db, d, parse(docSchema.partial(), req.body), { file: req.file });
    res.json(await contracts.detail(db, d.contract_id));
  }));
  r.delete('/documents/:id', write, ah(async (req, res) => {
    const d = await loadDoc(req);
    await contracts.deleteDocument(db, d);
    res.json(await contracts.detail(db, d.contract_id));
  }));
  r.get('/documents/:id/fichier', ah(async (req, res) => {
    const d = await loadDoc(req);
    const c = await contracts.load(db, d.contract_id);
    if (!contracts.canSee(c, v(req))) throw new HttpError(404, 'Pièce introuvable.');
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.file_name || 'piece')}`);
    res.sendFile(contracts.filePath(d), err => err && !res.headersSent && res.sendStatus(404));
  }));

  return r;
};
