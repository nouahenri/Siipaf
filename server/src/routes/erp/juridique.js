/** ERP · Juridique : circuit des ventes jusqu'à l'acte, litiges, cautions et retenues, impayés, courrier du service, réglages. */
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { DEED_STEPS, LITIGATION_ORIGINS, LITIGATION_STAGES, LITIGATION_OUTCOMES, GUARANTEE_DIRECTIONS, GUARANTEE_STATUSES, LEGAL_SETTINGS } = require('../../lib/domain');
const { DEPARTMENTS } = require('../../lib/paie');
const juridique = require('../../services/juridique');
const courrier = require('../../services/courrier');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
// Multipart (pièce jointe) : vides et nombres convertis ici
const blank = v => (v === '' || v == null || v === 'null' ? null : v);
const opt = s => z.preprocess(blank, s.nullable()).optional();
const num = s => z.preprocess(v => (blank(v) == null ? null : Number(v)), s.nullable()).optional();
const id = num(z.number().int().positive());

const litigationSchema = z.object({
  origin: z.enum(Object.keys(LITIGATION_ORIGINS)), title: z.string().trim().min(3).max(200), opponent: z.string().trim().min(2).max(200),
  amount_fcfa: num(z.number().int().min(0)), stage: opt(z.enum(Object.keys(LITIGATION_STAGES).filter(s => s !== 'clos'))),
  department: opt(z.enum(Object.keys(DEPARTMENTS))), owner_id: id, lawyer: opt(z.string().trim().max(160)), court: opt(z.string().trim().max(160)),
  sale_id: id, sav_ticket_id: id, supplier_id: id, contract_id: id, employee_id: id,
  next_date: opt(day), next_label: opt(z.string().trim().max(160)), opened_on: opt(day), notes: opt(z.string().trim().max(4000)),
});
const guaranteeSchema = z.object({
  kind_id: z.preprocess(v => Number(v), z.number().int().positive()), contract_id: id, supplier_id: id, counterparty: opt(z.string().trim().max(160)),
  bank: opt(z.string().trim().max(160)), amount_fcfa: z.preprocess(v => Number(v), z.number().int().positive()), issued_on: opt(day), expires_on: opt(day),
  reception_on: opt(day), release_on: opt(day), owner_id: id, notes: opt(z.string().trim().max(4000)),
});

module.exports = function juridiqueRoutes(db) {
  const r = express.Router();
  const write = requirePermission('juridique:write');
  const cleanup = req => req.file && fs.promises.unlink(req.file.path).catch(() => {});
  const guarded = fn => ah(async (req, res) => { try { await fn(req, res); } catch (e) { await cleanup(req); throw e; } });
  const viewer = req => courrier.viewer(db, req.user, p => req.can(p));
  const legal = (req, res, next) => (juridique.isLegal({ can: p => req.can(p) }) ? next() : next(new HttpError(403, 'Accès réservé au Juridique et à la Direction.')));
  const sendFile = (res, row, fallback) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.file_name || fallback)}`);
    res.sendFile(juridique.filePath(row), err => err && !res.headersSent && res.sendStatus(404));
  };

  r.get('/badges', ah(async (req, res) => res.json(await juridique.badges(db, req.user, p => req.can(p)))));
  r.get('/overview', legal, ah(async (req, res) => res.json(await juridique.overview(db, req.user, p => req.can(p)))));

  r.get('/refs', ah(async (req, res) => {
    const full = juridique.isLegal({ can: p => req.can(p) });
    const [suppliers, users, kinds, settings] = await Promise.all([
      full ? db('suppliers').where({ active: true }).orderBy('name').select('id', 'name', 'kind') : [],
      full ? db('users').where({ active: true }).orderBy('name').select('id', 'name') : [],
      db('guarantee_kinds').orderBy(['sort', 'id']).select('id', 'label', 'direction', 'active'),
      juridique.settings(db),
    ]);
    res.json({
      steps: DEED_STEPS, origins: LITIGATION_ORIGINS, stages: LITIGATION_STAGES, outcomes: LITIGATION_OUTCOMES, departments: DEPARTMENTS,
      directions: GUARANTEE_DIRECTIONS, guarantee_statuses: GUARANTEE_STATUSES, guarantee_kinds: kinds.map(k => ({ ...k, active: !!k.active })),
      settings, setting_fields: LEGAL_SETTINGS, suppliers, users,
    });
  }));

  /** Listes de rattachement d'un litige ou d'une caution (dossiers de vente, réclamations, contrats, employés). */
  r.get('/liens', legal, ah(async (req, res) => {
    const [sales, tickets, contracts, employees] = await Promise.all([
      db('sales as s').join('leads as c', 'c.id', 's.lead_id').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id')
        .whereNot('s.status', 'desiste').orderBy('c.name').select('s.id', 'c.name as client_name', 'p.name as project_name', 'l.code as lot_code'),
      db('sav_tickets').orderBy('id', 'desc').limit(300).select('id', 'ref', 'title', 'status'),
      db('contracts').orderBy('reference', 'desc').select('id', 'reference', 'title', 'kind', 'supplier_id', 'contract_amount', 'retention_pct', 'status'),
      db('employees').orderBy(['last_name', 'first_name']).select('id', 'last_name', 'first_name', 'active'),
    ]);
    res.json({
      sales: sales.map(s => ({ id: s.id, label: `${s.client_name} — ${s.project_name}, lot ${s.lot_code}` })),
      tickets: tickets.map(t => ({ id: t.id, label: `${t.ref} — ${t.title}` })),
      contracts: contracts.map(c => ({ ...c, contract_amount: c.contract_amount == null ? null : Number(c.contract_amount), retention_pct: c.retention_pct == null ? null : Number(c.retention_pct), label: `${c.reference} — ${c.title}` })),
      employees: employees.map(e => ({ id: e.id, label: `${e.last_name} ${e.first_name}${e.active ? '' : ' (sorti)'}` })),
    });
  }));

  // ─── Réglages ─────────────────────────────────────────────
  r.put('/reglages', write, ah(async (req, res) => {
    const shape = Object.fromEntries(Object.entries(LEGAL_SETTINGS).map(([k, s]) => [k, z.number().int().min(s.min).max(s.max)]));
    const data = parse(z.object(shape).partial(), req.body);
    const next = { ...(await juridique.settings(db)), ...data };
    if (next.legal_alert_second_days >= next.legal_alert_first_days) throw new HttpError(400, 'Le second rappel des cautions doit venir après le premier (moins de jours avant l’échéance).');
    res.json(await juridique.saveSettings(db, data));
  }));
  const kindSchema = z.object({ label: z.string().trim().min(2).max(120), direction: z.enum(Object.keys(GUARANTEE_DIRECTIONS)), active: z.boolean().optional() });
  r.post('/sortes', write, ah(async (req, res) => {
    const data = parse(kindSchema, req.body);
    if (await db('guarantee_kinds').whereRaw('lower(label) = ?', [data.label.toLowerCase()]).first()) throw new HttpError(409, 'Cette sorte de caution existe déjà.');
    const max = await db('guarantee_kinds').max({ m: 'sort' }).first();
    await db('guarantee_kinds').insert({ ...data, sort: Number(max?.m || 0) + 1 });
    res.status(201).json(await db('guarantee_kinds').orderBy(['sort', 'id']));
  }));
  r.patch('/sortes/:id', write, ah(async (req, res) => {
    const kid = idParam(req);
    const data = parse(kindSchema.partial(), req.body);
    const kind = await db('guarantee_kinds').where({ id: kid }).first();
    if (!kind) throw new HttpError(404, 'Sorte introuvable.');
    if (data.label && await db('guarantee_kinds').whereNot({ id: kid }).whereRaw('lower(label) = ?', [data.label.toLowerCase()]).first()) throw new HttpError(409, 'Cette sorte de caution existe déjà.');
    // Changer le sens d'une sorte déjà utilisée fausserait le suivi des cautions enregistrées
    if (data.direction && data.direction !== kind.direction && await db('guarantees').where({ kind_id: kid }).first()) {
      throw new HttpError(409, 'Des cautions de cette sorte sont enregistrées : son sens ne change plus. Créez une autre sorte.');
    }
    await db('guarantee_kinds').where({ id: kid }).update({ ...data, updated_at: new Date() });
    res.json(await db('guarantee_kinds').orderBy(['sort', 'id']));
  }));

  // ─── Circuit des ventes jusqu'à l'acte ────────────────────
  r.get('/actes', legal, ah(async (req, res) => res.json(await juridique.deeds(db, { step: req.query.step || null, q: req.query.q }))));
  /** Avancement d'une vente : le Juridique, la Direction, et l'équipe commerciale (lecture seule). */
  r.get('/actes/:id', ah(async (req, res) => {
    if (!juridique.isLegal({ can: p => req.can(p) }) && !req.can('sales:read')) throw new HttpError(403, 'Accès refusé.');
    res.json(await juridique.deedDetail(db, idParam(req)));
  }));
  r.post('/actes/:id', write, ah(async (req, res) => {
    const data = parse(z.object({
      key: z.enum(juridique.DEED_STEP_KEYS).optional(), date: day.nullable().optional(), notary_supplier_id: z.number().int().positive().nullable().optional(),
      notary_ref: z.string().trim().max(100).nullable().optional(), deed_number: z.string().trim().max(60).nullable().optional(), notes: z.string().trim().max(4000).nullable().optional(),
    }), req.body);
    res.json(await juridique.setStep(db, idParam(req), data, req.user));
  }));

  // ─── Impayés ──────────────────────────────────────────────
  r.get('/impayes', legal, ah(async (req, res) => res.json(await juridique.unpaid(db))));

  // ─── Courrier affecté au service Juridique ────────────────
  r.get('/courrier', ah(async (req, res) => res.json(await juridique.departmentMail(db, req.user, p => req.can(p)))));

  // ─── Litiges ──────────────────────────────────────────────
  r.get('/litiges', ah(async (req, res) => {
    res.json(await juridique.litigations(db, await viewer(req), { status: req.query.status ?? 'ouvert', origin: req.query.origin || null, q: req.query.q }));
  }));
  r.post('/litiges', write, ah(async (req, res) => res.status(201).json(await juridique.createLitigation(db, parse(litigationSchema, req.body), req.user))));
  async function visibleLitigation(req) {
    const l = await juridique.loadLitigation(db, idParam(req));
    if (!juridique.canSeeLitigation(l, await viewer(req))) throw new HttpError(404, 'Litige introuvable.');
    return l;
  }
  r.get('/litiges/:id', ah(async (req, res) => res.json(await juridique.litigationDetail(db, (await visibleLitigation(req)).id))));
  r.patch('/litiges/:id', write, ah(async (req, res) => {
    const l = await juridique.loadLitigation(db, idParam(req));
    await juridique.updateLitigation(db, l, parse(litigationSchema.partial(), req.body));
    res.json(await juridique.litigationDetail(db, l.id));
  }));
  r.post('/litiges/:id/etapes', write, juridique.fileUpload(), guarded(async (req, res) => {
    const l = await juridique.loadLitigation(db, idParam(req));
    const data = parse(z.object({
      stage: z.enum(Object.keys(LITIGATION_STAGES)), date: day, note: opt(z.string().trim().max(4000)), outcome: opt(z.enum(Object.keys(LITIGATION_OUTCOMES))),
      next_date: opt(day), next_label: opt(z.string().trim().max(160)),
    }), req.body);
    await juridique.addEvent(db, l, data, { file: req.file, userId: req.user.id });
    res.status(201).json(await juridique.litigationDetail(db, l.id));
  }));
  r.post('/litiges/:id/reopen', write, ah(async (req, res) => {
    const l = await juridique.loadLitigation(db, idParam(req));
    await juridique.reopenLitigation(db, l, req.user.id);
    res.json(await juridique.litigationDetail(db, l.id));
  }));
  r.get('/litiges/evenements/:id/fichier', ah(async (req, res) => {
    const e = await db('litigation_events').where({ id: idParam(req) }).first();
    if (!e) throw new HttpError(404, 'Pièce introuvable.');
    const l = await juridique.loadLitigation(db, e.litigation_id);
    if (!juridique.canSeeLitigation(l, await viewer(req))) throw new HttpError(404, 'Pièce introuvable.');
    sendFile(res, e, 'piece');
  }));

  // ─── Cautions et retenues de garantie ─────────────────────
  const seeGuarantees = (req, res, next) => (juridique.canSeeGuarantees({ can: p => req.can(p) }) ? next() : next(new HttpError(403, 'Accès refusé.')));
  r.get('/cautions', seeGuarantees, ah(async (req, res) => {
    res.json(await juridique.guarantees(db, { status: req.query.status ?? 'active', direction: req.query.direction || null, contractId: Number(req.query.contract_id) || null, q: req.query.q }));
  }));
  r.post('/cautions', write, juridique.fileUpload(), guarded(async (req, res) => {
    const gid = await juridique.createGuarantee(db, parse(guaranteeSchema, req.body), { file: req.file, userId: req.user.id });
    res.status(201).json(juridique.serializeGuarantee(await juridique.loadGuarantee(db, gid)));
  }));
  r.get('/cautions/:id', seeGuarantees, ah(async (req, res) => res.json(juridique.serializeGuarantee(await juridique.loadGuarantee(db, idParam(req))))));
  r.patch('/cautions/:id', write, juridique.fileUpload(), guarded(async (req, res) => {
    const g = await juridique.loadGuarantee(db, idParam(req));
    await juridique.updateGuarantee(db, g, parse(guaranteeSchema.partial(), req.body), { file: req.file });
    res.json(juridique.serializeGuarantee(await juridique.loadGuarantee(db, g.id)));
  }));
  r.post('/cautions/:id/close', write, ah(async (req, res) => {
    const g = await juridique.loadGuarantee(db, idParam(req));
    await juridique.closeGuarantee(db, g, parse(z.object({ status: z.enum(['liberee', 'appelee', 'expiree']), date: day, note: z.string().trim().max(255).optional() }), req.body));
    res.json(juridique.serializeGuarantee(await juridique.loadGuarantee(db, g.id)));
  }));
  r.post('/cautions/:id/reopen', write, ah(async (req, res) => {
    const g = await juridique.loadGuarantee(db, idParam(req));
    await juridique.reopenGuarantee(db, g);
    res.json(juridique.serializeGuarantee(await juridique.loadGuarantee(db, g.id)));
  }));
  r.get('/cautions/:id/fichier', seeGuarantees, ah(async (req, res) => sendFile(res, await juridique.loadGuarantee(db, idParam(req)), 'caution')));

  return r;
};
