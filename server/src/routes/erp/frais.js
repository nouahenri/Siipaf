/** ERP · RH › Notes de frais : saisie avec reçu, approbation, comptabilisation et remboursement. */
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const rh = require('../../services/rh');
const frais = require('../../services/frais');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
// Les champs arrivent en multipart (photo du reçu) : nombres et vides convertis ici
const num = z.preprocess(v => (v === '' || v == null ? undefined : Number(v)), z.number());
const optId = z.preprocess(v => (v === '' || v == null || v === 'null' ? null : Number(v)), z.number().int().positive().nullable());
const expenseSchema = z.object({
  date: day, category: z.string().min(2).max(20), label: z.string().trim().min(3).max(200), amount: num.pipe(z.number().int().min(1).max(100000000)),
  vat_rate: num.pipe(z.number().min(0).max(30)).optional(), paid_by: z.enum(['employe', 'societe']).optional(), project_id: optId.optional(),
});

module.exports = function fraisRoutes(db) {
  const r = express.Router();
  const ctx = req => ({ user: req.user, can: p => req.can(p) });
  const cleanup = req => req.file && fs.promises.unlink(req.file.path).catch(() => {});
  const guarded = fn => ah(async (req, res) => { try { await fn(req, res); } catch (e) { await cleanup(req); throw e; } });

  async function me(req) {
    const e = await rh.employeeOf(db, req.user.id);
    if (!e) throw new HttpError(404, 'Aucune fiche employé n’est reliée à votre compte : adressez-vous au service RH.');
    return e;
  }

  r.get('/me/expenses', ah(async (req, res) => {
    const e = await me(req);
    const s = await rh.getSettings(db);
    res.json((await frais.query(db).where('x.employee_id', e.id).orderBy('x.date', 'desc')).map(x => frais.serialize(x, s)));
  }));
  r.post('/me/expenses', requirePermission('self:frais'), frais.receiptUpload(), guarded(async (req, res) => {
    const e = await me(req);
    const id = await frais.create(db, e, parse(expenseSchema, req.body), { file: req.file, userId: req.user.id });
    res.status(201).json(await frais.detail(db, id));
  }));

  /**
   * Liste : le service RH et la comptabilité voient tout ; un responsable voit son équipe ; sinon ses propres notes.
   * `?to_do=1` : ce que le compte connecté doit traiter (approuver, comptabiliser, rembourser).
   */
  r.get('/expenses', ah(async (req, res) => {
    const s = await rh.getSettings(db);
    const q = frais.query(db).orderBy('x.date', 'desc');
    const all = req.can('rh:read') || req.can('compta:read');
    if (!all) {
      const e = await me(req);
      q.where(w => w.where('e.manager_id', e.id).orWhere('e.id', e.id));
    }
    if (req.query.status) q.whereIn('x.status', String(req.query.status).split(','));
    if (req.query.employee_id) q.where('x.employee_id', Number(req.query.employee_id));
    let rows = (await q.limit(1000)).map(x => frais.serialize(x, s));
    if (req.query.to_do === '1') {
      const out = [];
      for (const x of rows) {
        if (x.status === 'soumise' && await frais.canApprove(db, x, ctx(req))) out.push(x);
        else if (['approuvee', 'comptabilisee'].includes(x.status) && req.can('frais:post')) out.push(x);
      }
      rows = out;
    }
    res.json(rows);
  }));

  async function load(req) {
    const x = await frais.query(db).where('x.id', idParam(req)).first();
    if (!x) throw new HttpError(404, 'Note de frais introuvable.');
    return x;
  }
  async function canSee(req, x) {
    if (req.can('rh:read') || req.can('compta:read') || x.employee_user_id === req.user.id) return;
    if (await rh.isManagerOf(db, req.user.id, { manager_id: x.manager_id })) return;
    throw new HttpError(403, 'Droits insuffisants.');
  }

  r.get('/expenses/:id', ah(async (req, res) => { const x = await load(req); await canSee(req, x); res.json(await frais.detail(db, x.id)); }));
  r.patch('/expenses/:id', frais.receiptUpload(), guarded(async (req, res) => {
    const x = await load(req);
    if (x.employee_user_id !== req.user.id && !req.can('frais:approve')) throw new HttpError(403, 'Seul l’auteur modifie sa note de frais.');
    await frais.update(db, x, parse(expenseSchema.partial(), req.body), { file: req.file });
    res.json(await frais.detail(db, x.id));
  }));
  r.delete('/expenses/:id', ah(async (req, res) => {
    const x = await load(req);
    if (x.employee_user_id !== req.user.id && !req.can('frais:approve')) throw new HttpError(403, 'Droits insuffisants.');
    if (!['brouillon', 'refusee'].includes(x.status)) throw new HttpError(409, 'Seul un brouillon se supprime.');
    await db('hr_expenses').where({ id: x.id }).del();
    if (x.receipt_filename) await fs.promises.unlink(await frais.receiptPath(x)).catch(() => {});
    res.json({ ok: true });
  }));
  r.post('/expenses/:id/:action(submit|approve|refuse|post|reset)', ah(async (req, res) => {
    const data = parse(z.object({ note: z.string().trim().max(500).optional(), journal: z.enum(['BQ', 'CA', 'MM']).optional() }), req.body || {});
    res.json(await frais.transition(db, idParam(req), req.params.action, { ...ctx(req), note: data.note || null, journal: data.journal || null }));
  }));
  r.post('/expenses/reimburse', requirePermission('frais:post'), ah(async (req, res) => {
    const data = parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100), journal: z.enum(['BQ', 'CA', 'MM']), date: day }), req.body);
    res.json(await frais.reimburse(db, data.ids, { ...data, user: req.user }));
  }));

  r.get('/expenses/:id/receipt', ah(async (req, res) => {
    const x = await load(req);
    await canSee(req, x);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(x.receipt_name || 'recu')}`);
    res.sendFile(await frais.receiptPath(x), err => err && !res.headersSent && res.sendStatus(404));
  }));

  return r;
};
