/** ERP · Administration générale › Parc auto et matériel : biens, affectations, échéances, entretien, dépenses, réservations. */
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { ASSET_KINDS, ASSET_STATUSES, ASSET_ASSIGNMENT_KINDS, ASSET_DOC_KINDS, ASSET_COST_KINDS, RESERVATION_STATUSES, ASSET_PAYMENT_MODES, COST_ACCOUNTING_STATUSES, addMonths } = require('../../lib/domain');
const pc = require('../../services/parcCompta');
const parc = require('../../services/parc');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const slot = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Date et heure attendues');
const blank = v => (v === '' || v == null || v === 'null' ? null : v);
const opt = s => z.preprocess(blank, s.nullable()).optional();
const num = s => z.preprocess(v => (blank(v) == null ? null : Number(v)), s.nullable()).optional();
const assetSchema = z.object({
  kind: z.enum(Object.keys(ASSET_KINDS)), kind_other: opt(z.string().trim().max(100)), name: z.string().trim().min(2).max(160),
  brand: opt(z.string().trim().max(80)), model: opt(z.string().trim().max(80)), serial: opt(z.string().trim().max(80)), plate: opt(z.string().trim().max(30)),
  year: num(z.number().int().min(1950).max(2100)), acquired_on: opt(day), purchase_amount: num(z.number().int().min(0)),
  supplier_id: num(z.number().int().positive()), meter_value: num(z.number().min(0)), manager_id: num(z.number().int().positive()),
  pool: z.boolean().optional(), notes: opt(z.string().trim().max(4000)),
});
const docSchema = z.object({ kind: z.enum(Object.keys(ASSET_DOC_KINDS)), label: z.string().trim().min(2).max(160), reference: opt(z.string().trim().max(80)), expires_on: opt(day), amount_estimate: num(z.number().int().min(0)) });
const planSchema = z.object({
  label: z.string().trim().min(2).max(120), every_km: num(z.number().int().positive()), every_hours: num(z.number().int().positive()),
  every_months: num(z.number().int().min(1).max(120)), last_date: opt(day), last_meter: num(z.number().min(0)), active: z.boolean().optional(),
});
const costSchema = z.object({
  kind: z.enum(Object.keys(ASSET_COST_KINDS)), date: day, amount: z.number().int().min(0), label: opt(z.string().trim().max(200)),
  liters: num(z.number().positive()), meter_value: num(z.number().min(0)), project_id: num(z.number().int().positive()), worksite_id: num(z.number().int().positive()), place_id: num(z.number().int().positive()),
  plan_id: num(z.number().int().positive()), purchase_invoice_id: num(z.number().int().positive()),
  payment_mode: z.enum(Object.keys(ASSET_PAYMENT_MODES), { errorMap: () => ({ message: 'Indiquez comment la dépense a été payée.' }) }),
  supplier_id: num(z.number().int().positive()), vat_rate: z.preprocess(v => (blank(v) == null ? 0 : Number(v)), z.number().min(0).max(100)).optional(),
  fuel_card_id: num(z.number().int().positive()), employee_id: num(z.number().int().positive()),
});

module.exports = function parcRoutes(db) {
  const r = express.Router();
  const read = (req, res, next) => (req.can('parc:read') || req.can('parc:write') ? next() : next(new HttpError(403, 'Droits insuffisants.')));
  const write = requirePermission('parc:write');
  const cleanup = req => req.file && fs.promises.unlink(req.file.path).catch(() => {});
  const guarded = fn => ah(async (req, res) => { try { await fn(req, res); } catch (e) { await cleanup(req); throw e; } });
  const asset = req => parc.load(db, idParam(req));

  r.get('/badges', ah(async (req, res) => res.json(await parc.badges(db, { can: p => req.can(p), userId: req.user.id }))));

  r.get('/refs', read, ah(async (req, res) => {
    const [employees, projects, users, suppliers] = await Promise.all([
      db('employees').where({ active: true }).orderBy('last_name').select('id', 'last_name', 'first_name', 'matricule'),
      db('projects').orderBy('name').select('id', 'name'),
      db('users').where({ active: true }).orderBy('name').select('id', 'name'),
      db('suppliers').where({ active: true }).orderBy('name').select('id', 'name'),
    ]);
    res.json({
      kinds: ASSET_KINDS, statuses: ASSET_STATUSES, assignment_kinds: ASSET_ASSIGNMENT_KINDS, doc_kinds: ASSET_DOC_KINDS, cost_kinds: ASSET_COST_KINDS,
      reservation_statuses: RESERVATION_STATUSES, employees: employees.map(e => ({ id: e.id, name: `${e.last_name} ${e.first_name || ''}`.trim(), matricule: e.matricule })),
      projects, users, suppliers, payment_modes: ASSET_PAYMENT_MODES, cost_statuses: COST_ACCOUNTING_STATUSES,
      cards: (await pc.cards(db)).filter(c => c.active).map(c => ({ id: c.id, label: c.label, supplier_name: c.supplier_name, balance: c.balance })),
    });
  }));

  r.get('/assets', read, ah(async (req, res) => {
    const q = parc.query(db).orderBy('a.code');
    if (req.query.kind) q.where('a.kind', String(req.query.kind));
    if (req.query.status) q.whereIn('a.status', String(req.query.status).split(','));
    else q.whereNot('a.status', 'reforme');
    if (req.query.project_id) q.where('a.project_id', Number(req.query.project_id));
    let rows = (await q.limit(3000)).map(parc.serialize);
    const text = String(req.query.q || '').trim().toLowerCase();
    if (text) rows = rows.filter(a => [a.code, a.name, a.plate, a.brand, a.model, a.serial, a.holder].some(x => x && String(x).toLowerCase().includes(text)));
    res.json(rows);
  }));
  r.post('/assets', write, ah(async (req, res) => {
    const id = await parc.create(db, parse(assetSchema, req.body), { userId: req.user.id });
    res.status(201).json(await parc.detail(db, id));
  }));
  r.get('/assets/:id', read, ah(async (req, res) => res.json(await parc.detail(db, (await asset(req)).id))));
  r.patch('/assets/:id', write, ah(async (req, res) => {
    const a = await asset(req);
    await parc.update(db, a, parse(assetSchema.partial(), req.body));
    res.json(await parc.detail(db, a.id));
  }));
  r.post('/assets/:id/assign', write, ah(async (req, res) => {
    const a = await asset(req);
    const data = parse(z.object({
      kind: z.enum(['employe', 'chantier']), employee_id: num(z.number().int().positive()), project_id: num(z.number().int().positive()), worksite_id: num(z.number().int().positive()),
      date: day, condition: opt(z.string().trim().max(255)), meter: num(z.number().min(0)),
    }), req.body);
    await parc.assign(db, a, data, { userId: req.user.id });
    res.json(await parc.detail(db, a.id));
  }));
  r.post('/assets/:id/release', write, ah(async (req, res) => {
    const a = await asset(req);
    await parc.release(db, a, parse(z.object({ date: day, condition: opt(z.string().trim().max(255)), meter: num(z.number().min(0)) }), req.body));
    res.json(await parc.detail(db, a.id));
  }));
  r.post('/assets/:id/status', write, ah(async (req, res) => {
    const a = await asset(req);
    await parc.setStatus(db, a, parse(z.object({ status: z.enum(['disponible', 'maintenance', 'reforme']) }), req.body).status);
    res.json(await parc.detail(db, a.id));
  }));

  // Échéances administratives (fichier joint : multipart)
  r.post('/assets/:id/documents', write, parc.fileUpload(), guarded(async (req, res) => {
    const a = await asset(req);
    await parc.addDocument(db, a, parse(docSchema, req.body), { file: req.file });
    res.status(201).json(await parc.detail(db, a.id));
  }));
  const loadDoc = async req => {
    const d = await db('asset_documents').where({ id: idParam(req) }).first();
    if (!d) throw new HttpError(404, 'Échéance introuvable.');
    return d;
  };
  r.patch('/documents/:id', write, parc.fileUpload(), guarded(async (req, res) => {
    const d = await loadDoc(req);
    await parc.updateDocument(db, d, parse(docSchema.partial(), req.body), { file: req.file });
    res.json(await parc.detail(db, d.asset_id));
  }));
  r.delete('/documents/:id', write, ah(async (req, res) => {
    const d = await loadDoc(req);
    await parc.deleteDocument(db, d);
    res.json(await parc.detail(db, d.asset_id));
  }));
  r.get('/documents/:id/fichier', read, ah(async (req, res) => {
    const d = await loadDoc(req);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.file_name || 'document')}`);
    res.sendFile(parc.filePath(d), err => err && !res.headersSent && res.sendStatus(404));
  }));

  // Plans d'entretien
  r.post('/assets/:id/plans', write, ah(async (req, res) => {
    const a = await asset(req);
    await parc.addPlan(db, a, parse(planSchema, req.body));
    res.status(201).json(await parc.detail(db, a.id));
  }));
  r.patch('/plans/:id', write, ah(async (req, res) => {
    const p = await db('asset_maintenance_plans').where({ id: idParam(req) }).first();
    if (!p) throw new HttpError(404, 'Plan introuvable.');
    await parc.updatePlan(db, p, await parc.load(db, p.asset_id), parse(planSchema.partial(), req.body));
    res.json(await parc.detail(db, p.asset_id));
  }));
  r.delete('/plans/:id', write, ah(async (req, res) => {
    const p = await db('asset_maintenance_plans').where({ id: idParam(req) }).first();
    if (!p) throw new HttpError(404, 'Plan introuvable.');
    await db('asset_maintenance_plans').where({ id: p.id }).del();
    res.json(await parc.detail(db, p.asset_id));
  }));

  // Dépenses
  r.post('/assets/:id/costs', write, ah(async (req, res) => {
    const a = await asset(req);
    await parc.addCost(db, a, parse(costSchema, req.body), { userId: req.user.id });
    res.status(201).json(await parc.detail(db, a.id));
  }));
  r.delete('/costs/:id', write, ah(async (req, res) => res.json(await parc.detail(db, await pc.deleteCost(db, idParam(req))))));

  r.get('/echeances', read, ah(async (req, res) => res.json(await parc.deadlines(db, { days: Math.min(Number(req.query.days) || 60, 400) }))));
  r.get('/couts', read, ah(async (req, res) => {
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.au || '') ? req.query.au : new Date().toISOString().slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.du || '') ? req.query.du : addMonths(to, -12);
    res.json(await parc.costsReport(db, { from, to }));
  }));

  // ─── Réservations de véhicules ───────────────────────────
  /** Les services généraux voient toutes les demandes ; chacun voit les siennes (`?mine=1`). */
  r.get('/reservations', ah(async (req, res) => {
    const q = parc.resaQuery(db).orderBy('r.start_at', 'desc').limit(500);
    if (req.query.mine === '1' || !req.can('parc:write')) q.where('r.requested_by', req.user.id);
    if (req.query.status) q.whereIn('r.status', String(req.query.status).split(','));
    if (req.query.upcoming === '1') q.where('r.end_at', '>=', `${new Date().toISOString().slice(0, 10)}T00:00`);
    res.json((await q).map(parc.resaRow));
  }));
  r.post('/reservations', requirePermission('self:vehicule'), ah(async (req, res) => {
    const data = parse(z.object({
      start_at: slot, end_at: slot, purpose: z.string().trim().min(3).max(255), destination: opt(z.string().trim().max(160)),
      passengers: num(z.number().int().min(1).max(60)),
    }), req.body);
    const id = await parc.request(db, data, { user: req.user });
    res.status(201).json(parc.resaRow(await parc.resaQuery(db).where('r.id', id).first()));
  }));
  r.get('/vehicules-libres', write, ah(async (req, res) => {
    const { start_at, end_at, except } = parse(z.object({ start_at: slot, end_at: slot, except: num(z.number().int().positive()) }), req.query);
    res.json(await parc.freeVehicles(db, { start_at, end_at, except }));
  }));
  r.post('/reservations/:id/decide', write, ah(async (req, res) => {
    const resa = await db('asset_reservations').where({ id: idParam(req) }).first();
    if (!resa) throw new HttpError(404, 'Demande introuvable.');
    const data = parse(z.object({ status: z.enum(['accordee', 'refusee']), asset_id: num(z.number().int().positive()), note: opt(z.string().trim().max(255)) }), req.body);
    res.json(await parc.decide(db, resa, data, { user: req.user }));
  }));
  r.post('/reservations/:id/cancel', ah(async (req, res) => {
    const resa = await db('asset_reservations').where({ id: idParam(req) }).first();
    if (!resa) throw new HttpError(404, 'Demande introuvable.');
    if (resa.requested_by !== req.user.id && !req.can('parc:write')) throw new HttpError(403, 'Droits insuffisants.');
    if (!['demandee', 'accordee'].includes(resa.status)) throw new HttpError(409, 'Demande déjà close.');
    await db('asset_reservations').where({ id: resa.id }).update({ status: 'annulee', updated_at: new Date() });
    res.json(parc.resaRow(await parc.resaQuery(db).where('r.id', resa.id).first()));
  }));

  // ─── Comptabilité (choix du client du 23/10) : validation des dépenses, cartes carburant, immobilisations ───
  const can = (...perms) => (req, res, next) => (perms.some(p => req.can(p)) ? next() : next(new HttpError(403, 'Droits insuffisants.')));
  r.get('/compta/depenses', can('achats:write', 'compta:read'), ah(async (req, res) => res.json(await pc.pendingCosts(db, { status: req.query.status ?? 'a_valider' }))));
  r.post('/costs/:id/validate', requirePermission('achats:write'), ah(async (req, res) => res.json(await pc.validateCost(db, idParam(req), req.user))));
  r.post('/costs/:id/reject', requirePermission('achats:write'), ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Indiquez le motif du rejet.').max(255) }), req.body);
    res.json(await pc.rejectCost(db, idParam(req), reason, req.user));
  }));

  r.get('/cartes', can('parc:read', 'parc:write', 'compta:read'), ah(async (req, res) => res.json(await pc.cards(db))));
  const cardSchema = z.object({ label: z.string().trim().min(2).max(120), number: opt(z.string().trim().max(40)), supplier_id: z.number().int().positive(), active: z.boolean().optional(), notes: opt(z.string().trim().max(500)) });
  r.post('/cartes', requirePermission('achats:write'), ah(async (req, res) => { await pc.saveCard(db, parse(cardSchema, req.body)); res.status(201).json(await pc.cards(db)); }));
  r.patch('/cartes/:id', requirePermission('achats:write'), ah(async (req, res) => { await pc.saveCard(db, parse(cardSchema.partial(), req.body), idParam(req)); res.json(await pc.cards(db)); }));
  r.post('/cartes/:id/recharges', requirePermission('achats:pay'), ah(async (req, res) => {
    const data = parse(z.object({ date: day, amount: z.number().int().positive(), journal_id: z.number().int().positive(), reference: opt(z.string().trim().max(120)) }), req.body);
    await pc.loadCard(db, idParam(req), data, req.user);
    res.status(201).json(await pc.cards(db));
  }));

  r.get('/immobilisations', can('compta:read'), ah(async (req, res) => res.json(await pc.register(db, { day: /^\d{4}-\d{2}-\d{2}$/.test(req.query.au || '') ? req.query.au : undefined }))));
  r.patch('/assets/:id/immobilisation', requirePermission('compta:entries'), ah(async (req, res) => {
    const data = parse(z.object({
      fixed_value: num(z.number().int().positive()), in_service_on: opt(day), depreciation_years: num(z.number().int().min(1).max(50)),
      prior_depreciation: z.preprocess(v => (blank(v) == null ? 0 : Number(v)), z.number().int().min(0)).optional(), prior_as_of: opt(day), purchase_invoice_id: num(z.number().int().positive()),
    }), req.body);
    await pc.updateFixed(db, idParam(req), data);
    res.json(await pc.register(db));
  }));
  r.post('/immobilisations/dotations', requirePermission('compta:entries'), ah(async (req, res) => {
    const { fiscal_year_id } = parse(z.object({ fiscal_year_id: z.number().int().positive() }), req.body);
    const e = await pc.postDotations(db, fiscal_year_id, req.user);
    res.status(201).json({ entry: { id: e.id, status: e.status }, register: await pc.register(db) });
  }));
  r.post('/assets/:id/sortie', requirePermission('compta:entries'), ah(async (req, res) => {
    const data = parse(z.object({ date: day, price: z.number().int().min(0).optional(), journal_id: z.number().int().positive().nullable().optional() }), req.body);
    await pc.dispose(db, idParam(req), data, req.user);
    res.json(await pc.register(db));
  }));

  r.get('/a-payer', can('parc:read', 'parc:write', 'compta:read'), ah(async (req, res) => res.json(await pc.payables(db, { days: Math.min(Number(req.query.days) || 60, 365) }))));

  return r;
};
