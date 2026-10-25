/** Fiche complète d'un lot et dossier d'acquisition (acquéreur, versements, documents). */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, json, isoDay } = require('../lib/http');
const { requirePermission } = require('../auth');
const { PAYMENT_METHODS, DOCUMENT_TYPES, DOCUMENT_STATUSES, SCHEDULE_KINDS } = require('../lib/domain');
const { openSale, refreshSaleStatus, totals, ACTIVE } = require('../services/sales');
const { regenerateSchedule, replaceSchedule, scheduleStatus } = require('../services/schedule');
const juridique = require('../services/juridique');
const { inform } = require('../services/notifications');

const day = z.coerce.date();

module.exports = function salesRoutes(db) {
  const r = express.Router();

  async function saleDetail(sale) {
    const [lead, payments, documents, t] = await Promise.all([
      db('leads').where({ id: sale.lead_id }).first(),
      db('payments as p').leftJoin('users as u', 'u.id', 'p.recorded_by').where('p.sale_id', sale.id)
        .select('p.*', 'u.name as recorded_by_name').orderBy([{ column: 'p.paid_at', order: 'desc' }, { column: 'p.id', order: 'desc' }]),
      db('sale_documents as d').leftJoin('media as m', 'm.id', 'd.media_id').where('d.sale_id', sale.id)
        .select('d.*', 'm.filename', 'm.original_name').orderBy('d.sort'),
      totals(db, sale),
    ]);
    const schedule = await scheduleStatus(db, sale, t);
    return {
      ...sale,
      reserved_at: isoDay(sale.reserved_at),
      signed_at: isoDay(sale.signed_at),
      promised_delivery_on: isoDay(sale.promised_delivery_on),
      ...t,
      lead: lead && {
        id: lead.id, name: lead.name, email: lead.email, phone: lead.phone, country: lead.country,
        is_diaspora: !!lead.is_diaspora, client_code: lead.client_code, stage: lead.stage,
      },
      payments,
      documents: documents.map(d => ({ ...d, visible_client: !!d.visible_client, url: d.filename ? `/uploads/${d.filename}` : null })),
      schedule,
    };
  }

  // ─── Fiche complète d'un lot ──────────────────────────────
  r.get('/lots/:id/detail', requirePermission('lots:read'), ah(async (req, res) => {
    const id = idParam(req);
    const lot = await db('lots').where({ id }).first();
    if (!lot) throw new HttpError(404, 'Lot introuvable.');
    const [project, offer, option, history, sales] = await Promise.all([
      db('projects').where({ id: lot.project_id }).select('id', 'name', 'slug').first(),
      lot.offer_id ? db('project_offers').where({ id: lot.offer_id }).first() : null,
      db('lot_options as o').join('leads as l', 'l.id', 'o.lead_id').where({ 'o.lot_id': id, 'o.state': 'active' })
        .select('o.*', 'l.name as lead_name', 'l.phone as lead_phone', 'l.email as lead_email').first(),
      db('lot_status_history as h').leftJoin('users as u', 'u.id', 'h.user_id').leftJoin('leads as l', 'l.id', 'h.lead_id')
        .where('h.lot_id', id).select('h.*', 'u.name as user_name', 'l.name as lead_name').orderBy('h.id', 'desc').limit(30),
      db('sales').where({ lot_id: id }).orderBy('id', 'desc'),
    ]);
    const canSales = req.can('sales:read');
    const current = sales.find(s => ACTIVE.includes(s.status));
    res.json({
      ...lot,
      shape: json(lot.shape),
      surface_m2: lot.surface_m2 == null ? null : Number(lot.surface_m2),
      project, offer, option: option || null, history,
      sale: canSales && current ? await saleDetail(current) : null,
      past_sales: canSales ? sales.filter(s => s.status === 'desiste').length : 0,
    });
  }));

  // ─── Ouverture du dossier d'acquisition ───────────────────
  r.post('/lots/:id/sale', requirePermission('sales:write'), ah(async (req, res) => {
    const data = parse(z.object({
      lead_id: z.number().int().positive().optional(),
      name: z.string().trim().min(2).max(160).optional(),
      phone: z.string().trim().min(6).max(40).optional(),
      email: z.string().trim().toLowerCase().email().optional(),
      price_fcfa: z.number().int().positive().optional(),
      financing: z.enum(['apport', 'diaspora', 'credit', 'comptant']).optional(),
      reserved_at: day.optional(),
      signed_at: day.optional(),
      vefa: z.boolean().optional(),
      notes: z.string().max(2000).optional(),
    }), req.body);
    if (!data.lead_id && (!data.name || (!data.phone && !data.email))) {
      throw new HttpError(400, 'Choisissez un prospect existant ou indiquez le nom et un contact de l’acquéreur.');
    }
    const { lead_id, name, phone, email, ...rest } = data;
    const sale = await openSale(db, { lotId: idParam(req), leadId: lead_id, leadData: { name, phone, email }, ...rest, user: req.user });
    // Circuit d'information : Direction générale, exploitation, Comptabilité, Juridique (réglable dans l'ERP)
    const info = await db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id').join('leads as c', 'c.id', 's.lead_id')
      .where('s.id', sale.id).first('c.name as client_name', 'c.assigned_to', 'p.name as project_name', 'l.code as lot_code', 's.price_fcfa', 's.vefa');
    await inform(db, 'vente.ouverte', {
      direct: info.assigned_to ? [info.assigned_to] : [], except: req.user.id, key: `vente:${sale.id}:ouverte`,
      title: `Nouveau dossier de vente : ${info.client_name}`, body: `${info.project_name}, lot ${info.lot_code}${info.vefa ? ' · VEFA' : ''}`,
      link: '/commercial/ventes', links: { compta: '/compta', juridique: `/juridique/actes?fiche=${sale.id}` },
    });
    res.status(201).json(await saleDetail(sale));
  }));

  r.patch('/sales/:id', requirePermission('sales:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object({
      price_fcfa: z.number().int().positive(),
      financing: z.enum(['apport', 'diaspora', 'credit', 'comptant']).nullable(),
      reserved_at: day.nullable(),
      signed_at: day.nullable(),
      // Livraison promise à l'acquéreur : comparée à la livraison prévue du chantier (ERP › Chantiers)
      promised_delivery_on: day.nullable(),
      vefa: z.boolean(),
      notes: z.string().max(2000).nullable(),
    }).partial(), req.body);
    const before = await db('sales').where({ id }).first();
    if (!before) throw new HttpError(404, 'Dossier introuvable.');
    // Acte signé saisi ici plutôt que dans ERP › Juridique : mêmes effets (lot vendu, pièce signée, annonces)
    const signedNow = !before.signed_at && !!data.signed_at && before.status !== 'desiste';
    await db('sales').where({ id }).update({ ...data, updated_at: new Date() });
    const sale = await db.transaction(async trx => {
      if (signedNow) await juridique.deedSigned(trx, before, req.user.id);
      // Prix, financement ou date de départ modifiés : l'échéancier type est recalculé
      if (['price_fcfa', 'financing', 'reserved_at', 'vefa'].some(k => k in data)) {
        await regenerateSchedule(trx, await trx('sales').where({ id }).first());
      }
      return refreshSaleStatus(trx, id);
    });
    if (signedNow) await juridique.announceDeed(db, id, req.user.id);
    res.json(await saleDetail(await db('sales').where({ id: sale.id }).first()));
  }));

  // ─── Échéancier (comptable) ───────────────────────────────
  r.post('/sales/:id/schedule/generate', requirePermission('schedule:write'), ah(async (req, res) => {
    const id = idParam(req);
    const opts = parse(z.object({
      start_date: day.optional(),
      deposit_pct: z.number().min(0).max(100).optional(),
      // Apport en montant (prime sur le pourcentage) : ex. 2 600 000 FCFA déjà versés
      deposit_fcfa: z.number().int().min(0).optional(),
      months: z.number().int().min(0).max(120).optional(),
    }), req.body || {});
    const sale = await db('sales').where({ id }).first();
    if (!sale) throw new HttpError(404, 'Dossier introuvable.');
    if (!sale.financing && !sale.vefa) throw new HttpError(400, 'Indiquez d’abord le mode de financement du dossier.');
    if (opts.deposit_fcfa != null && opts.deposit_fcfa > Number(sale.price_fcfa)) {
      throw new HttpError(400, 'L’apport dépasse le prix du bien.');
    }
    await db.transaction(trx => regenerateSchedule(trx, sale, opts));
    res.json(await saleDetail(sale));
  }));

  r.put('/sales/:id/schedule', requirePermission('schedule:write'), ah(async (req, res) => {
    const id = idParam(req);
    const lines = parse(z.array(z.object({
      kind: z.enum(SCHEDULE_KINDS),
      label: z.string().trim().min(2).max(120),
      due_date: day,
      amount_fcfa: z.number().int().positive(),
    })).min(1).max(240), req.body);
    const sale = await db('sales').where({ id }).first();
    if (!sale) throw new HttpError(404, 'Dossier introuvable.');
    await db.transaction(trx => replaceSchedule(trx, sale, lines));
    res.json(await saleDetail(sale));
  }));

  // ─── Versements (comptable) ───────────────────────────────
  r.post('/sales/:id/payments', requirePermission('payments:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object({
      amount_fcfa: z.number().int().positive('Montant invalide'),
      paid_at: day.refine(d => d.getTime() <= Date.now() + 86400000, 'La date de paiement ne peut pas être dans le futur.'),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().trim().max(120).optional(),
      note: z.string().trim().max(255).optional(),
    }), req.body);
    const sale = await db('sales').where({ id }).first();
    if (!sale) throw new HttpError(404, 'Dossier introuvable.');
    if (sale.status === 'desiste') throw new HttpError(409, 'Ce dossier est clos (désistement).');
    const t = await totals(db, sale);
    if (data.amount_fcfa > t.remaining_fcfa) {
      throw new HttpError(409, `Le versement dépasse le reste à payer (${t.remaining_fcfa.toLocaleString('fr-FR')} FCFA).`);
    }
    const pid = await db.transaction(async trx => {
      const [p] = await trx('payments').insert({ ...data, sale_id: id, recorded_by: req.user.id });
      await refreshSaleStatus(trx, id);
      return typeof p === 'object' ? p.id : p;
    });
    // Circuit d'information : le commercial du client et la Comptabilité (écriture d'encaissement à synchroniser)
    const info = await db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id').join('leads as c', 'c.id', 's.lead_id')
      .where('s.id', id).first('c.name as client_name', 'c.assigned_to', 'p.name as project_name', 'l.code as lot_code');
    await inform(db, 'vente.versement', {
      direct: info.assigned_to ? [info.assigned_to] : [], except: req.user.id, key: `versement:${pid}`,
      title: `Versement reçu : ${info.client_name} — ${data.amount_fcfa.toLocaleString('fr-FR')} FCFA`, body: `${info.project_name}, lot ${info.lot_code} · le ${data.paid_at.toLocaleDateString('fr-FR')}`,
      link: '/commercial/ventes', links: { compta: '/compta' },
    });
    res.status(201).json(await saleDetail(await db('sales').where({ id }).first()));
  }));

  r.delete('/payments/:id', requirePermission('payments:write'), ah(async (req, res) => {
    const p = await db('payments').where({ id: idParam(req) }).first();
    if (!p) throw new HttpError(404, 'Versement introuvable.');
    await db.transaction(async trx => {
      await trx('payments').where({ id: p.id }).del();
      await refreshSaleStatus(trx, p.sale_id);
    });
    res.json(await saleDetail(await db('sales').where({ id: p.sale_id }).first()));
  }));

  // ─── Documents administratifs et juridiques ───────────────
  const docFields = {
    label: z.string().trim().min(2).max(160),
    status: z.enum(DOCUMENT_STATUSES),
    media_id: z.number().int().positive().nullable(),
    visible_client: z.boolean(),
    note: z.string().trim().max(255).nullable(),
  };

  r.post('/sales/:id/documents', requirePermission('documents:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object({ type: z.enum(DOCUMENT_TYPES), ...docFields }).partial({ status: true, media_id: true, visible_client: true, note: true }), req.body);
    if (!(await db('sales').where({ id }).first())) throw new HttpError(404, 'Dossier introuvable.');
    const [{ max }] = await db('sale_documents').where({ sale_id: id }).max({ max: 'sort' });
    await db('sale_documents').insert({ ...data, sale_id: id, sort: (Number(max) || 0) + 1, updated_by: req.user.id });
    res.status(201).json(await saleDetail(await db('sales').where({ id }).first()));
  }));

  r.patch('/documents/:id', requirePermission('documents:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object(docFields).partial(), req.body);
    const doc = await db('sale_documents').where({ id }).first();
    if (!doc) throw new HttpError(404, 'Document introuvable.');
    await db('sale_documents').where({ id }).update({ ...data, updated_by: req.user.id, updated_at: new Date() });
    res.json(await saleDetail(await db('sales').where({ id: doc.sale_id }).first()));
  }));

  return r;
};
