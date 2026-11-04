/** Fiche complète d'un lot et dossier d'acquisition (acquéreur, versements, documents). */
const express = require('express');
const { z } = require('../lib/zod');
const { ah, parse, idParam, HttpError, json, isoDay } = require('../lib/http');
const { requirePermission } = require('../auth');
const { PAYMENT_METHODS, DOCUMENT_TYPES, DOCUMENT_STATUSES, SCHEDULE_KINDS } = require('../lib/domain');
const { openSale, refreshSaleStatus, totals, ACTIVE } = require('../services/sales');
const { regenerateSchedule, replaceSchedule, scheduleStatus } = require('../services/schedule');
const { receiptNumber } = require('../services/clients');
const juridique = require('../services/juridique');
const { inform } = require('../services/notifications');
const liaisons = require('../services/liaisons');
const { seesAllLeads, saleInScope, leadInScope } = require('../services/commercial');

const day = z.coerce.date();

/** Déclaration faite par le client depuis l'application : « le client (application) » à la place du nom d'un commercial. */
const declarant = d => ({ ...d, declared_by_name: d.declared_by_name || (d.source === 'client' ? 'le client (application)' : null) });

module.exports = function salesRoutes(db) {
  const r = express.Router();

  async function saleDetail(sale) {
    const [lead, payments, declarations, documents, t] = await Promise.all([
      db('leads').where({ id: sale.lead_id }).first(),
      db('payments as p').leftJoin('users as u', 'u.id', 'p.recorded_by').leftJoin('users as d', 'd.id', 'p.declared_by').where('p.sale_id', sale.id)
        .select('p.*', 'u.name as recorded_by_name', 'd.name as declared_by_name').orderBy([{ column: 'p.paid_at', order: 'desc' }, { column: 'p.id', order: 'desc' }]),
      // Versements déclarés par un commercial : à confirmer ou refusés (ne comptent pas dans les totaux)
      db('payment_declarations as pd').leftJoin('users as u', 'u.id', 'pd.declared_by').where('pd.sale_id', sale.id).whereIn('pd.status', ['a_confirmer', 'rejete'])
        .select('pd.*', 'u.name as declared_by_name').orderBy('pd.id', 'desc').then(rows => rows.map(declarant)),
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
        converted_by_name: (await require('../services/portfolio').convertedBy(db, [lead.id]))[lead.id] || null,
      },
      payments,
      declarations: declarations.map(d => ({ ...d, amount_fcfa: Number(d.amount_fcfa), paid_at: isoDay(d.paid_at) })),
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
    // Coordonnées et dossier d'un acquéreur : droit « dossiers » et client du commercial (portée « toute l'équipe » : tous)
    const visibleLeads = new Set();
    if (canSales) {
      const ids = [option?.lead_id, current?.lead_id, ...history.map(h => h.lead_id)].filter(Boolean);
      const q = db('leads as ld').whereIn('ld.id', ids);
      if (!seesAllLeads(req.user)) q.where('ld.assigned_to', req.user.id);
      for (const l of await q.select('ld.id')) visibleLeads.add(l.id);
    }
    const seen = id => visibleLeads.has(id);
    res.json({
      ...lot,
      shape: json(lot.shape),
      surface_m2: lot.surface_m2 == null ? null : Number(lot.surface_m2),
      project, offer,
      option: option ? (seen(option.lead_id) ? option : { ...option, lead_id: null, lead_name: null, lead_phone: null, lead_email: null }) : null,
      history: history.map(h => (seen(h.lead_id) ? h : { ...h, lead_id: null, lead_name: null })),
      sale: current && seen(current.lead_id) ? await saleDetail(current) : null,
      past_sales: canSales ? sales.filter(s => s.status === 'desiste').length : 0,
    });
  }));

  // ─── Ouverture du dossier d'acquisition ───────────────────
  r.post('/lots/:id/sale', requirePermission('sales:open'), ah(async (req, res) => {
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
    if (lead_id) await leadInScope(db, lead_id, req.user);
    // L'acte se date dans ERP › Juridique (ou avec le droit Juridique)
    if (rest.signed_at && !req.can('juridique:deeds')) throw new HttpError(403, 'La date de signature de l’acte se saisit dans ERP › Juridique.');
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

  r.patch('/sales/:id', requirePermission('sales:edit', 'juridique:deeds'), ah(async (req, res) => {
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
    const before = await saleInScope(db, id, req.user);
    if (data.vefa && !before.vefa) await require('../services/sales').assertVefaAllowed(db, (await db('lots').where({ id: before.lot_id }).first('project_id')).project_id);
    const { signed_at: _signed, ...saleFields } = data;
    if (Object.keys(saleFields).length && !req.can('sales:edit')) throw new HttpError(403, 'Modifier le dossier demande le droit correspondant.');
    if ('signed_at' in data && (isoDay(data.signed_at) || null) !== (isoDay(before.signed_at) || null) && !req.can('juridique:deeds')) {
      throw new HttpError(403, 'La date de signature de l’acte se saisit dans ERP › Juridique.');
    }
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
    // Prix, financement ou date de départ modifiés : l'échéancier a été recalculé, le commercial et le client en sont prévenus
    if (['price_fcfa', 'financing', 'reserved_at', 'vefa'].some(k => k in data)) await liaisons.announceSchedule(db, sale, req.user).catch(() => {});
    res.json(await saleDetail(await db('sales').where({ id: sale.id }).first()));
  }));

  // ─── Échéancier (comptable) ───────────────────────────────
  r.post('/sales/:id/schedule/generate', requirePermission('schedule:generate'), ah(async (req, res) => {
    const id = idParam(req);
    const opts = parse(z.object({
      start_date: day.optional(),
      deposit_pct: z.number().min(0).max(100).optional(),
      // Apport en montant (prime sur le pourcentage) : ex. 2 600 000 FCFA déjà versés
      deposit_fcfa: z.number().int().min(0).optional(),
      months: z.number().int().min(0).max(120).optional(),
    }), req.body || {});
    const sale = await saleInScope(db, id, req.user);
    if (!sale.financing && !sale.vefa) throw new HttpError(400, 'Indiquez d’abord le mode de financement du dossier.');
    if (opts.deposit_fcfa != null && opts.deposit_fcfa > Number(sale.price_fcfa)) {
      throw new HttpError(400, 'L’apport dépasse le prix du bien.');
    }
    await db.transaction(trx => regenerateSchedule(trx, sale, opts));
    await liaisons.announceSchedule(db, sale, req.user).catch(() => {});
    res.json(await saleDetail(sale));
  }));

  r.put('/sales/:id/schedule', requirePermission('schedule:edit'), ah(async (req, res) => {
    const id = idParam(req);
    const lines = parse(z.array(z.object({
      kind: z.enum(SCHEDULE_KINDS),
      label: z.string().trim().min(2).max(120),
      due_date: day,
      amount_fcfa: z.number().int().positive(),
    })).min(1).max(240), req.body);
    const sale = await saleInScope(db, id, req.user);
    await db.transaction(trx => replaceSchedule(trx, sale, lines));
    await liaisons.announceSchedule(db, sale, req.user).catch(() => {});
    res.json(await saleDetail(sale));
  }));

  // ─── Versements ───────────────────────────────────────────
  // La Comptabilité (payments:write) enregistre ; un commercial (payments:record) déclare un versement de son client,
  // qui reste « à confirmer » et ne compte nulle part avant la confirmation de la réception des fonds.
  const paymentSchema = z.object({
    amount_fcfa: z.number().int().positive('Montant invalide'),
    paid_at: day.refine(d => d.getTime() <= Date.now() + 86400000, 'La date de paiement ne peut pas être dans le futur.'),
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(120).optional(),
    note: z.string().trim().max(255).optional(),
  });
  const saleInfo = id => db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id').join('leads as c', 'c.id', 's.lead_id')
    .where('s.id', id).first('c.name as client_name', 'c.assigned_to', 'p.name as project_name', 'l.code as lot_code');
  const pendingOf = async (saleId, exceptId = null) => Number((await db('payment_declarations').where({ sale_id: saleId, status: 'a_confirmer' })
    .modify(q => { if (exceptId) q.whereNot('id', exceptId); }).sum({ v: 'amount_fcfa' }).first()).v || 0);
  // Le versement ne doit pas dépasser le reste à payer (versements déclarés en attente compris)
  const checkRemaining = async (sale, amount, exceptId = null) => {
    if (sale.status === 'desiste') throw new HttpError(409, 'Ce dossier est clos (désistement).');
    const left = (await totals(db, sale)).remaining_fcfa - (await pendingOf(sale.id, exceptId));
    if (amount > left) throw new HttpError(409, `Le versement dépasse le reste à payer (${Math.max(0, left).toLocaleString('fr-FR')} FCFA, versements à confirmer déduits).`);
  };
  // Enregistre le versement (Comptabilité) et prévient le commercial du client et la Comptabilité
  const recordPayment = async (sale, data, user, declaration = null) => {
    const pid = await db.transaction(async trx => {
      const [p] = await trx('payments').insert({ ...data, sale_id: sale.id, recorded_by: user.id, declared_by: declaration?.declared_by || null });
      const paymentId = typeof p === 'object' ? p.id : p;
      if (declaration) await trx('payment_declarations').where({ id: declaration.id }).update({ status: 'confirme', decided_by: user.id, decided_at: new Date(), payment_id: paymentId, updated_at: new Date() });
      await refreshSaleStatus(trx, sale.id);
      return paymentId;
    });
    const info = await saleInfo(sale.id);
    const paidAt = new Date(data.paid_at);
    await inform(db, 'vente.versement', {
      direct: [info.assigned_to, declaration?.declared_by].filter(Boolean), except: user.id, key: `versement:${pid}`,
      title: `${declaration ? 'Versement confirmé' : 'Versement reçu'} : ${info.client_name} — ${Number(data.amount_fcfa).toLocaleString('fr-FR')} FCFA`,
      body: `${info.project_name}, lot ${info.lot_code} · le ${paidAt.toLocaleDateString('fr-FR')}${declaration ? ` · réception des fonds confirmée par la Comptabilité${declaration.adjusted ? ` (ajusté${declaration.adjusted_from !== Number(data.amount_fcfa) ? ` : déclaré ${declaration.adjusted_from.toLocaleString('fr-FR')} FCFA` : ''})` : ''}` : ''}`,
      link: '/commercial/ventes', links: { compta: '/compta/ecritures' },
    });
    // Le client reçoit la confirmation dans son espace (le reçu est dans « Paiements »)
    await liaisons.announcePayment(db, sale, data, user).catch(() => {});
    return pid;
  };

  r.post('/sales/:id/payments', requirePermission('payments:write', 'payments:record'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(paymentSchema, req.body);
    const sale = await saleInScope(db, id, req.user);
    await checkRemaining(sale, data.amount_fcfa);
    if (req.can('payments:write')) {
      await recordPayment(sale, data, req.user);
      return res.status(201).json(await saleDetail(await db('sales').where({ id }).first()));
    }
    const [dId] = await db('payment_declarations').insert({ ...data, sale_id: id, declared_by: req.user.id });
    const info = await saleInfo(id);
    await inform(db, 'versement.a_confirmer', {
      except: req.user.id, key: `declaration:${typeof dId === 'object' ? dId.id : dId}`,
      title: `Versement à confirmer : ${info.client_name} — ${data.amount_fcfa.toLocaleString('fr-FR')} FCFA`,
      body: `${info.project_name}, lot ${info.lot_code} · déclaré par ${req.user.name}, payé le ${data.paid_at.toLocaleDateString('fr-FR')} (${data.method})`,
      link: '/compta/ecritures',
    });
    res.status(201).json(await saleDetail(sale));
  }));

  // Versements déclarés : la Comptabilité voit tout ; un commercial voit les siens
  r.get('/payment-declarations', requirePermission('payments:write', 'payments:record'), ah(async (req, res) => {
    const status = String(req.query.status || 'a_confirmer');
    const q = db('payment_declarations as pd').join('sales as s', 's.id', 'pd.sale_id').join('leads as ld', 'ld.id', 's.lead_id')
      .join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id').leftJoin('users as u', 'u.id', 'pd.declared_by').leftJoin('users as dcd', 'dcd.id', 'pd.decided_by')
      .select('pd.*', 'ld.name as client_name', 'ld.client_code', 'l.code as lot_code', 'p.name as project_name', 'u.name as declared_by_name', 'dcd.name as decided_by_name', 's.id as sale_id')
      .orderBy('pd.id', 'desc').limit(300);
    if (status !== 'tous') q.where('pd.status', status);
    if (!req.can('payments:write')) q.where(b => b.where('pd.declared_by', req.user.id).orWhere('ld.assigned_to', req.user.id));
    res.json((await q).map(d => declarant({ ...d, amount_fcfa: Number(d.amount_fcfa), paid_at: isoDay(d.paid_at) })));
  }));

  const pendingDeclaration = async req => {
    const d = await db('payment_declarations').where({ id: idParam(req) }).first();
    if (!d) throw new HttpError(404, 'Versement déclaré introuvable.');
    if (d.status !== 'a_confirmer') throw new HttpError(409, 'Ce versement a déjà été traité.');
    return d;
  };

  // Capture du reçu jointe par le client (application) : fichier privé lu par la Comptabilité et le commercial
  r.get('/payment-declarations/:id/proof', requirePermission('payments:write', 'payments:record'), ah(async (req, res) => {
    const d = await db('payment_declarations').where({ id: idParam(req) }).first('proof_file_id');
    const f = d?.proof_file_id ? await db('sav_files').where({ id: d.proof_file_id }).first() : null;
    if (!f) throw new HttpError(404, 'Aucune capture jointe.');
    res.set('Cache-Control', 'private, no-store').type(f.mime).sendFile(require('path').join(require('../services/sav').savFilesDir, f.filename));
  }));

  // Réception des fonds confirmée : le versement entre dans le dossier (solde, espace client, reçu, comptabilité)
  r.post('/payment-declarations/:id/confirm', requirePermission('payments:write'), ah(async (req, res) => {
    const d = await pendingDeclaration(req);
    // La Comptabilité ajuste au besoin d'après le relevé ou la caisse ; la déclaration du commercial reste telle quelle
    const fix = parse(paymentSchema.partial().extend({ reference: z.string().trim().max(120).optional(), note: z.string().trim().max(255).optional() }), req.body || {});
    const sale = await db('sales').where({ id: d.sale_id }).first();
    const data = {
      amount_fcfa: fix.amount_fcfa ?? Number(d.amount_fcfa), paid_at: fix.paid_at || d.paid_at, method: fix.method || d.method,
      reference: fix.reference !== undefined ? fix.reference || null : d.reference, note: fix.note !== undefined ? fix.note || null : d.note,
    };
    await checkRemaining(sale, data.amount_fcfa, d.id);
    const adjusted = data.amount_fcfa !== Number(d.amount_fcfa) || isoDay(data.paid_at) !== isoDay(d.paid_at) || data.method !== d.method;
    await recordPayment(sale, data, req.user, { ...d, adjusted_from: adjusted ? Number(d.amount_fcfa) : null, adjusted });
    res.json(await saleDetail(await db('sales').where({ id: d.sale_id }).first()));
  }));

  r.post('/payment-declarations/:id/reject', requirePermission('payments:write'), ah(async (req, res) => {
    const d = await pendingDeclaration(req);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Indiquez le motif du refus.').max(255) }), req.body);
    await db('payment_declarations').where({ id: d.id }).update({ status: 'rejete', decided_by: req.user.id, decided_at: new Date(), reject_reason: reason, updated_at: new Date() });
    const info = await saleInfo(d.sale_id);
    await inform(db, 'versement.refuse', {
      direct: [d.declared_by, info.assigned_to], priority: 'action', except: req.user.id, key: `declaration:${d.id}:refus`,
      title: `Versement non confirmé : ${info.client_name} — ${Number(d.amount_fcfa).toLocaleString('fr-FR')} FCFA`,
      body: `Motif de la Comptabilité : ${reason}`, link: '/commercial/ventes',
    });
    // Déclaration faite par le client dans l'application : il reçoit le motif dans son espace (et en notification)
    if (d.source === 'client') {
      const sale = await db('sales').where({ id: d.sale_id }).first('lead_id');
      await require('../services/clients').tellClient(db, { leadId: sale.lead_id, saleId: d.sale_id }, `Votre paiement déclaré de ${Number(d.amount_fcfa).toLocaleString('fr-FR')} FCFA n’a pas pu être confirmé par notre service comptable. Motif : ${reason}`, req.user.id, { kind: 'paiements', title: 'Paiement non confirmé' }).catch(() => {});
    }
    res.json(await saleDetail(await db('sales').where({ id: d.sale_id }).first()));
  }));

  // Le commercial retire sa déclaration tant qu'elle n'est pas traitée
  r.delete('/payment-declarations/:id', requirePermission('payments:write', 'payments:record'), ah(async (req, res) => {
    const d = await pendingDeclaration(req);
    if (d.declared_by !== req.user.id && !req.can('payments:write')) throw new HttpError(403, 'Seul son auteur retire un versement déclaré.');
    await db('payment_declarations').where({ id: d.id }).update({ status: 'annule', updated_at: new Date() });
    res.json(await saleDetail(await db('sales').where({ id: d.sale_id }).first()));
  }));

  // Reçu de versement (preuve du versement effectué) : imprimable depuis l'ERP ; même numéro que dans l'espace client.
  // Totaux arrêtés au versement (cumul des versements jusqu'à celui-ci), coordonnées de Contenu du site › Coordonnées.
  r.get('/payments/:id/receipt', requirePermission('sales:read', 'payments:write'), ah(async (req, res) => {
    const p = await db('payments as p').leftJoin('users as u', 'u.id', 'p.recorded_by').where('p.id', idParam(req)).first('p.*', 'u.name as recorded_by_name');
    if (!p) throw new HttpError(404, 'Versement introuvable.');
    const sale = await saleInScope(db, p.sale_id, req.user);
    const [lead, lot, all, site] = await Promise.all([
      db('leads').where({ id: sale.lead_id }).first('name', 'client_code', 'phone', 'email'),
      db('lots as l').join('projects as pr', 'pr.id', 'l.project_id').where('l.id', sale.lot_id).first('l.code', 'l.ilot', 'pr.name as project_name'),
      db('payments').where({ sale_id: sale.id }).select('id', 'amount_fcfa', 'paid_at'),
      db('site_content').where({ key: 'site' }).first('value'),
    ]);
    const t = await totals(db, sale);
    const upTo = all.filter(x => (isoDay(x.paid_at) < isoDay(p.paid_at)) || (isoDay(x.paid_at) === isoDay(p.paid_at) && x.id <= p.id)).reduce((s, x) => s + Number(x.amount_fcfa), 0);
    const contact = json(site?.value) || {};
    res.json({
      id: p.id, receipt_number: receiptNumber(p), amount_fcfa: Number(p.amount_fcfa), paid_at: isoDay(p.paid_at), method: p.method, reference: p.reference,
      recorded_by_name: p.recorded_by_name, client: lead, lot, sale_id: sale.id,
      due_fcfa: t.total_due_fcfa, paid_to_date_fcfa: upTo, remaining_after_fcfa: Math.max(0, t.total_due_fcfa - upTo),
      company: { phone: contact.phone || null, email: contact.email || null, address: contact.address || null },
    });
  }));

  r.delete('/payments/:id', requirePermission('payments:delete'), ah(async (req, res) => {
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

  r.post('/sales/:id/documents', requirePermission('documents:files'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object({ type: z.enum(DOCUMENT_TYPES), ...docFields }).partial({ status: true, media_id: true, visible_client: true, note: true }), req.body);
    await saleInScope(db, id, req.user);
    const [{ max }] = await db('sale_documents').where({ sale_id: id }).max({ max: 'sort' });
    const [docId] = await db('sale_documents').insert({ ...data, sale_id: id, sort: (Number(max) || 0) + 1, updated_by: req.user.id });
    // Pièce mise en ligne pour le client : il en est prévenu dans son espace
    await liaisons.announceDocument(db, await db('sale_documents').where({ id: typeof docId === 'object' ? docId.id : docId }).first(), req.user).catch(() => {});
    res.status(201).json(await saleDetail(await db('sales').where({ id }).first()));
  }));

  r.patch('/documents/:id', requirePermission('documents:status', 'documents:files', 'documents:visibility'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object(docFields).partial(), req.body);
    // Chaque champ relève de son action : statut et note, fichier et intitulé, visibilité client
    const need = { status: 'documents:status', note: 'documents:status', media_id: 'documents:files', label: 'documents:files', visible_client: 'documents:visibility' };
    const missing = Object.keys(data).find(k => need[k] && !req.can(need[k]));
    if (missing) throw new HttpError(403, 'Cette modification de la pièce demande un droit que vous n’avez pas.');
    const doc = await db('sale_documents').where({ id }).first();
    if (!doc) throw new HttpError(404, 'Document introuvable.');
    await saleInScope(db, doc.sale_id, req.user);
    await db('sale_documents').where({ id }).update({ ...data, updated_by: req.user.id, updated_at: new Date() });
    await liaisons.announceDocument(db, await db('sale_documents').where({ id }).first(), req.user).catch(() => {});
    res.json(await saleDetail(await db('sales').where({ id: doc.sale_id }).first()));
  }));

  return r;
};
