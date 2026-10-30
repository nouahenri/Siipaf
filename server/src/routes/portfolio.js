/**
 * Portefeuille commercial. Dashboard (saisie) : attribution / répartition / transfert, historique d'un prospect.
 * ERP › Service commercial › Objectifs et performance (pilotage) : compteurs de prospects et de clients par
 * commercial et par période, listes importées et leur bilan.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../lib/http');
const { requirePermission } = require('../auth');
const pf = require('../services/portfolio');
const { canAssignLeads, leadInScope, seesAllLeads } = require('../services/commercial');
const { inform, notify } = require('../services/notifications');
const { effectivePermissions } = require('../services/permissions');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

module.exports = function portfolioRoutes(db) {
  const r = express.Router();
  const read = requirePermission('commercial:read'); // écrans de l'ERP

  r.get('/portefeuille', read, ah(async (req, res) => {
    const q = parse(z.object({
      granularite: z.enum(['semaine', 'mois', 'trimestre', 'annee']).default('mois'), du: day, au: day,
      commercial: z.coerce.number().int().positive().optional(),
    }), req.query);
    res.json(await pf.stats(db, req.user, { granularity: q.granularite, from: q.du, to: q.au, userId: q.commercial }));
  }));

  // Attribuer, répartir ou transférer : le responsable seulement (leads:assign). Un commercial demande le transfert.
  r.post('/leads/assign', requirePermission('leads:assign'), ah(async (req, res) => {
    const data = parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000), user_id: z.number().int().positive().nullable() }), req.body);
    const clients = await db('leads').whereIn('id', data.ids).whereNotNull('client_code').pluck('id');
    const ids = data.ids.filter(id => !clients.includes(id));
    res.json({ changed: ids.length ? await pf.assign(db, ids, data.user_id, req.user.id) : 0, clients_skipped: clients.length });
  }));

  r.get('/leads/:id/portefeuille', requirePermission('leads:read'), ah(async (req, res) => {
    await leadInScope(db, idParam(req), req.user);
    res.json(await pf.leadHistory(db, idParam(req)));
  }));

  // ─── Demandes de transfert (choix du client du 29/10) ─────
  // Le commercial d'un prospect ou d'un client demande de le confier à un collègue (ou de le rendre au responsable) ;
  // un commercial qui retrouve une personne suivie par un collègue demande à la reprendre. Le responsable décide.
  const transferRows = q => q.join('leads as ld', 'ld.id', 't.lead_id').leftJoin('users as f', 'f.id', 't.from_user_id').leftJoin('users as tu', 'tu.id', 't.to_user_id')
    .leftJoin('users as rq', 'rq.id', 't.requested_by').leftJoin('users as dc', 'dc.id', 't.decided_by')
    .leftJoin('users as mg', 'mg.id', 't.manager_by').leftJoin('users as ad', 'ad.id', 't.admin_by')
    .select('t.*', 'ld.name as lead_name', 'ld.client_code', 'f.name as from_name', 'tu.name as to_name', 'rq.name as requested_by_name', 'dc.name as decided_by_name',
      'mg.name as manager_name', 'ad.name as admin_name')
    .orderBy('t.id', 'desc');

  // Changement du commercial d'un client (choix du client du 29/10) : accord du responsable commercial ET approbation de
  // l'administrateur général (super admin), dans l'ordre que fixe celui qui demande. Sans responsable commercial actif,
  // le super admin donne les deux.
  const isAdmin = user => user.role === 'super_admin';
  async function hasManager() {
    for (const u of await db('users').where({ active: true }).whereNot('role', 'super_admin').select('id', 'role')) {
      if ((await effectivePermissions(db, u)).includes('leads:assign')) return true;
    }
    return false;
  }
  const awaiting = (t, manager) => (t.status !== 'en_attente' ? null : !t.client ? 'responsable'
    : !t.manager_by ? (manager ? 'responsable' : 'administrateur') : !t.admin_by ? 'administrateur' : null);
  const withStep = async rows => { const manager = await hasManager(); return rows.map(t => ({ ...t, client: !!t.client, awaiting: awaiting(t, manager) })); };
  const oneRow = async id => (await withStep(await transferRows(db('lead_transfer_requests as t')).where('t.id', id)))[0];
  const notifyAdmins = async (t, lead, by) => notify(db, {
    to: await db('users').where({ role: 'super_admin', active: true }).pluck('id'), except: by.id, module: 'commercial', event: 'prospect.transfert_demande',
    key: `transfert:${t.id}:admin`, priority: 'action', link: '/commercial/pipeline',
    title: `Changement de commercial à approuver : ${lead?.name || 'client'}`, body: `Accord du responsable commercial donné. Motif : ${t.reason}`,
  });

  r.get('/lead-transfers', requirePermission('leads:read'), ah(async (req, res) => {
    const status = String(req.query.status || 'en_attente');
    const q = transferRows(db('lead_transfer_requests as t')).limit(300);
    if (status !== 'tous') q.where('t.status', status);
    if (req.query.lead_id) q.where('t.lead_id', Number(req.query.lead_id));
    // Le responsable voit toutes les demandes ; un commercial, celles qu'il a faites ou qui le concernent
    if (!canAssignLeads(req.user)) q.where(b => b.where('t.requested_by', req.user.id).orWhere('t.from_user_id', req.user.id).orWhere('t.to_user_id', req.user.id));
    res.json(await withStep(await q));
  }));

  r.post('/leads/:id/transfert', requirePermission('leads:transfer', 'leads:assign'), ah(async (req, res) => {
    const leadId = idParam(req);
    const data = parse(z.object({
      to_user_id: z.number().int().positive().nullable().optional(),
      reason: z.string().trim().min(5, 'Expliquez la raison du transfert.').max(1000),
    }), req.body);
    const lead = await db('leads').where({ id: leadId }).first('id', 'name', 'assigned_to', 'client_code');
    if (!lead) throw new HttpError(404, 'Prospect introuvable.');
    const mine = lead.assigned_to === req.user.id;
    const manager = canAssignLeads(req.user);
    // Une personne suivie par un collègue : on ne peut demander qu'à la reprendre pour soi (le responsable choisit le commercial)
    const to = mine || manager ? (data.to_user_id ?? null) : req.user.id;
    if (!mine && !lead.assigned_to && !seesAllLeads(req.user)) throw new HttpError(404, 'Prospect introuvable.');
    if (to === lead.assigned_to) throw new HttpError(400, 'Ce prospect est déjà suivi par ce commercial.');
    if (to && !(await db('users').where({ id: to, active: true }).first('id'))) throw new HttpError(400, 'Commercial introuvable ou désactivé.');
    if (await db('lead_transfer_requests').where({ lead_id: leadId, status: 'en_attente' }).first('id')) {
      throw new HttpError(409, 'Une demande de transfert est déjà en attente pour cette personne.');
    }
    // Client : l'accord de celui qui demande vaut pour son étape (responsable commercial ou administrateur général)
    const client = !!lead.client_code, now = new Date();
    const signed = !client ? {} : isAdmin(req.user) ? { admin_by: req.user.id, admin_at: now } : manager ? { manager_by: req.user.id, manager_at: now } : {};
    const [id] = await db('lead_transfer_requests').insert({ lead_id: leadId, from_user_id: lead.assigned_to || null, to_user_id: to, reason: data.reason, requested_by: req.user.id, client, ...signed });
    const tId = typeof id === 'object' ? id.id : id;
    if (signed.manager_by) {
      await notifyAdmins({ id: tId, reason: data.reason }, lead, req.user);
      return res.status(201).json(await oneRow(tId));
    }
    const target = to ? (await db('users').where({ id: to }).first('name')).name : 'le responsable';
    await inform(db, 'prospect.transfert_demande', {
      except: req.user.id, key: `transfert:${tId}`,
      title: `Transfert demandé par ${req.user.name}${mine ? '' : ' (personne suivie par un collègue)'}`,
      body: `${mine ? lead.name : 'Une personne de votre portefeuille'} → ${target} · ${data.reason}`,
      link: '/commercial/pipeline',
    });
    // Le commercial actuel est prévenu qu'un collègue demande à reprendre son prospect
    if (!mine && lead.assigned_to) {
      await notify(db, { to: [lead.assigned_to], module: 'commercial', event: 'prospect.transfert_demande', key: `transfert:${tId}:titulaire`,
        title: `${req.user.name} demande à reprendre ${lead.name}`, body: `Motif : ${data.reason}. Le responsable décidera.`, link: '/commercial/pipeline' });
    }
    res.status(201).json(await oneRow(tId));
  }));

  const pendingTransfer = async req => {
    const t = await db('lead_transfer_requests').where({ id: idParam(req) }).first();
    if (!t) throw new HttpError(404, 'Demande introuvable.');
    if (t.status !== 'en_attente') throw new HttpError(409, 'Cette demande a déjà été traitée.');
    return t;
  };
  const decided = async (t, user, status, note) => {
    const lead = await db('leads').where({ id: t.lead_id }).first('name');
    const verb = status === 'validee' ? 'accepté' : 'refusé';
    await notify(db, {
      to: [t.requested_by, t.from_user_id, t.to_user_id], module: 'commercial', event: 'prospect.transfert_decide', except: user.id, key: `transfert:${t.id}:decision`,
      title: `Transfert ${verb} : ${lead?.name || 'prospect'}`, body: note ? `Note du responsable : ${note}` : null, link: '/commercial/pipeline',
    });
  };

  r.post('/lead-transfers/:id/valider', requirePermission('leads:assign'), ah(async (req, res) => {
    const t = await pendingTransfer(req);
    const { to_user_id, note } = parse(z.object({ to_user_id: z.number().int().positive().nullable().optional(), note: z.string().trim().max(1000).optional() }), req.body || {});
    const to = to_user_id !== undefined ? to_user_id : t.to_user_id; // le responsable peut choisir un autre commercial
    if (t.client) {
      const now = new Date(), admin = isAdmin(req.user);
      const step = awaiting(t, await hasManager());
      if (step === 'responsable' && admin) throw new HttpError(409, 'En attente de l’accord du responsable commercial.');
      if (step === 'administrateur' && !admin) throw new HttpError(409, 'Accord du responsable donné : en attente de l’approbation de l’administrateur général.');
      const patch = step === 'responsable' ? { manager_by: req.user.id, manager_at: now }
        : { admin_by: req.user.id, admin_at: now, ...(!t.manager_by ? { manager_by: req.user.id, manager_at: now } : {}) };
      await db('lead_transfer_requests').where({ id: t.id }).update({ ...patch, to_user_id: to, updated_at: now });
      const next = { ...t, ...patch, to_user_id: to };
      if (!next.admin_by) {
        await notifyAdmins(next, await db('leads').where({ id: t.lead_id }).first('name'), req.user);
        return res.json(await oneRow(t.id));
      }
    }
    await pf.assign(db, [t.lead_id], to, req.user.id);
    await db('lead_transfer_requests').where({ id: t.id }).update({ status: 'validee', to_user_id: to, decided_by: req.user.id, decided_at: new Date(), decision_note: note || null, updated_at: new Date() });
    await decided({ ...t, to_user_id: to }, req.user, 'validee', note);
    res.json(await oneRow(t.id));
  }));

  r.post('/lead-transfers/:id/refuser', requirePermission('leads:assign'), ah(async (req, res) => {
    const t = await pendingTransfer(req);
    const { note } = parse(z.object({ note: z.string().trim().min(3, 'Indiquez le motif du refus.').max(1000) }), req.body);
    await db('lead_transfer_requests').where({ id: t.id }).update({ status: 'refusee', decided_by: req.user.id, decided_at: new Date(), decision_note: note, updated_at: new Date() });
    await decided(t, req.user, 'refusee', note);
    res.json((await transferRows(db('lead_transfer_requests as t')).where('t.id', t.id))[0]);
  }));

  // L'auteur retire sa demande tant qu'elle n'est pas traitée
  r.delete('/lead-transfers/:id', requirePermission('leads:read'), ah(async (req, res) => {
    const t = await pendingTransfer(req);
    if (t.requested_by !== req.user.id && !canAssignLeads(req.user)) throw new HttpError(403, 'Seul son auteur retire une demande.');
    await db('lead_transfer_requests').where({ id: t.id }).update({ status: 'annulee', updated_at: new Date() });
    res.json({ ok: true });
  }));

  r.get('/imports', read, ah(async (req, res) => res.json(await pf.importReports(db, req.user))));
  r.get('/imports/:id', read, ah(async (req, res) => {
    const [report] = await pf.importReports(db, req.user, idParam(req));
    if (!report) throw new HttpError(404, 'Liste introuvable.');
    res.json(report);
  }));

  return r;
};
