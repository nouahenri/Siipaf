/**
 * ERP · Chantiers, lot 5 (choix du client du 25/10) :
 * - travaux modificatifs des acquéreurs (TMA) : demande (équipe ou espace client) → devis du conducteur → réponse de
 *   l'acquéreur dans son espace → montant ajouté à l'échéancier du dossier (Comptabilité prévenue) → réalisation ;
 * - besoins en matériaux : exprimés par le chantier et transmis aux Achats → commandés (bon de commande validé) ou
 *   refusés par les Achats → livrés à la réception du bon de commande ;
 * - réception d'un lot : PV, date de livraison du dossier, réserves au SAV, garanties, étape « Livraison » du lot
 *   signalée à la Direction (dernier appel de fonds VEFA), acquéreur et Juridique prévenus ;
 * - réception des travaux d'un marché : départ du délai de garantie de la retenue (Juridique).
 * Règles dans lib/domain.js (TMA_STATUSES, TMA_BILLED, NEED_STATUSES).
 */
const { HttpError, isoDay, isoTime } = require('../lib/http');
const { TMA_STATUSES, TMA_BILLED, NEED_STATUSES, SAV_CATEGORIES, SITE_STAGE_LABELS, addDays, warrantyDates } = require('../lib/domain');
const { notify, usersWith, inform, resolve } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const today = () => new Date().toISOString().slice(0, 10);
const fr = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const money = n => `${Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const ACTIVE = ['en_cours', 'solde'];
const fileFields = f => (f ? { file_filename: f.filename, file_name: f.originalname.slice(0, 255), file_mime: f.mimetype } : {});

/** Référence annuelle : TMA-2026-0001. */
async function nextReference(trx, table, prefix, date = today()) {
  const p = `${prefix}-${date.slice(0, 4)}-`;
  const last = await trx(table).where('reference', 'like', `${p}%`).orderBy('reference', 'desc').first('reference');
  return `${p}${String(last ? Number(last.reference.slice(p.length)) + 1 : 1).padStart(4, '0')}`;
}

/** Chantier ouvert dont la zone couvre le lot (le premier créé), sinon null. */
async function worksiteForLot(db, lot) {
  const { zoneLots } = require('./chantiers');
  for (const w of await db('worksites').where({ project_id: lot.project_id }).whereNot('status', 'clos').orderBy('id')) {
    if ((await zoneLots(db, w)).some(l => l.id === lot.id)) return w;
  }
  return null;
}

/** Message de l'équipe dans l'espace client de l'acquéreur. */
async function tellClient(db, sale, body, userId = null) {
  await db('client_messages').insert({ lead_id: sale.lead_id, sale_id: sale.id, sender: 'equipe', user_id: userId, body });
}

// ─── TMA ──────────────────────────────────────────────────────────────────

const changeQuery = db => db('worksite_changes as t').join('sales as s', 's.id', 't.sale_id').join('leads as c', 'c.id', 's.lead_id')
  .join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id').leftJoin('worksites as w', 'w.id', 't.worksite_id')
  .leftJoin('users as q', 'q.id', 't.quoted_by')
  .select('t.*', 's.lead_id', 'c.name as client_name', 'c.client_code', 'c.assigned_to', 'l.code as lot_code', 'p.name as project_name',
    'w.reference as worksite_reference', 'w.manager_id', 'q.name as quoted_by_name');

const serializeChange = t => ({
  id: t.id, reference: t.reference, sale_id: t.sale_id, lot_id: t.lot_id, worksite_id: t.worksite_id, worksite_reference: t.worksite_reference || null,
  title: t.title, description: t.description, source: t.source, source_label: t.source === 'client' ? 'Espace client' : 'Équipe SIIPAF',
  status: t.status, status_label: TMA_STATUSES[t.status], amount_fcfa: t.amount_fcfa == null ? null : Number(t.amount_fcfa),
  delay_days: t.delay_days == null ? null : Number(t.delay_days), quote_note: t.quote_note, quoted_by_name: t.quoted_by_name || null,
  quoted_at: isoTime(t.quoted_at), answered_at: isoTime(t.answered_at), client_note: t.client_note, due_date: isoDay(t.due_date), done_on: isoDay(t.done_on),
  client_name: t.client_name, client_code: t.client_code, lot_code: t.lot_code, project_name: t.project_name, created_at: isoTime(t.created_at),
  file_url: t.file_filename ? `/api/admin/erp/chantiers/tma/${t.id}/devis` : null,
});

async function changes(db, { worksiteId = null, saleId = null, status = null } = {}) {
  const q = changeQuery(db).orderBy([{ column: 't.created_at', order: 'desc' }, { column: 't.id', order: 'desc' }]).limit(300);
  if (worksiteId) q.where('t.worksite_id', worksiteId);
  if (saleId) q.where('t.sale_id', saleId);
  if (status) q.where('t.status', status);
  return (await q).map(serializeChange);
}

async function loadChange(db, id) {
  const t = await changeQuery(db).where('t.id', id).first();
  if (!t) throw new HttpError(404, 'Travaux modificatifs introuvables.');
  return t;
}

/** Montant des TMA acceptées d'un dossier (ajouté au total dû). */
async function extrasFor(db, saleId) {
  const r = await db('worksite_changes').where({ sale_id: saleId }).whereIn('status', TMA_BILLED).sum({ t: 'amount_fcfa' }).first();
  return Number(r?.t || 0);
}

/** Échéances des TMA acceptées, à fondre dans l'échéancier du dossier. */
async function tmaLines(db, saleId) {
  const rows = await db('worksite_changes').where({ sale_id: saleId }).whereIn('status', TMA_BILLED).orderBy(['due_date', 'id']);
  return rows.map(t => ({ id: `tma-${t.id}`, kind: 'tma', label: `Travaux modificatifs ${t.reference} — ${t.title}`, due_date: isoDay(t.due_date), amount_fcfa: Number(t.amount_fcfa) }));
}

/** Demande de TMA, par l'équipe (commercial, conducteur) ou par l'acquéreur dans son espace. */
async function createChange(db, { sale_id, title, description = null }, { userId = null, source = 'equipe' } = {}) {
  const sale = await db('sales').where({ id: sale_id }).first();
  if (!sale) throw new HttpError(404, 'Dossier introuvable.');
  if (!ACTIVE.includes(sale.status)) throw new HttpError(409, 'Ce dossier n’est plus actif : pas de travaux modificatifs.');
  if (sale.delivered_at) throw new HttpError(409, 'Ce lot est déjà livré : les travaux passent par le SAV.');
  const lot = await db('lots').where({ id: sale.lot_id }).first();
  const w = await worksiteForLot(db, lot);
  const id = await db.transaction(async trx => {
    const [r] = await trx('worksite_changes').insert({
      reference: await nextReference(trx, 'worksite_changes', 'TMA'), sale_id: sale.id, lot_id: lot.id, worksite_id: w?.id || null,
      title, description, source, status: 'demandee', created_by: userId,
    });
    return insertedId(r);
  });
  const t = await loadChange(db, id);
  // Le conducteur chiffre ; le commercial suit la demande de son client (s'il ne l'a pas saisie lui-même)
  const direct = [w?.manager_id, t.assigned_to].filter(Boolean);
  await inform(db, 'tma.demandee', {
    direct: direct.length ? direct : await usersWith(db, 'chantiers:write'), except: userId, key: `tma:${id}:demandee`,
    title: `TMA à chiffrer : ${title} — lot ${t.lot_code}`, body: `${t.client_name} · ${t.project_name}${source === 'client' ? ' · demandée dans l’espace client' : ''}`,
    link: w ? `/chantiers/${w.id}?onglet=tma` : '/chantiers/liste',
  });
  return serializeChange(t);
}

/** Devis du conducteur (refaisable tant que l'acquéreur n'a pas répondu) : l'acquéreur répond dans son espace. */
async function quoteChange(db, t, { amount_fcfa, delay_days = null, quote_note = null }, { file = null, userId }) {
  if (!['demandee', 'chiffree'].includes(t.status)) throw new HttpError(409, 'Ces travaux ne se chiffrent plus.');
  await db('worksite_changes').where({ id: t.id }).update({
    status: 'chiffree', amount_fcfa, delay_days, quote_note, quoted_by: userId, quoted_at: new Date(), updated_at: new Date(), ...fileFields(file),
  });
  await resolve(db, `tma:${t.id}:demandee`);
  const sale = await db('sales').where({ id: t.sale_id }).first();
  await tellClient(db, sale, `Devis de travaux modificatifs ${t.reference} — « ${t.title} » : ${money(amount_fcfa)}${delay_days ? `, réalisation en ${delay_days} jours` : ''}.${quote_note ? `\n${quote_note}` : ''}\nAcceptez-le ou refusez-le dans « Chantier » › Travaux modificatifs. Accepté, son montant s’ajoute à votre échéancier.`, userId);
  if (t.assigned_to) {
    await notify(db, {
      to: t.assigned_to, except: userId, module: 'commercial', event: 'tma.chiffree', title: `Devis TMA envoyé : ${t.client_name} — ${money(amount_fcfa)}`,
      body: `${t.title} · lot ${t.lot_code} ; l’acquéreur répond dans son espace client.`, link: '/commercial/ventes', key: `tma:${t.id}:chiffree:${amount_fcfa}`,
    });
  }
  return serializeChange(await loadChange(db, t.id));
}

/** Réponse de l'acquéreur à un devis, dans son espace client. */
async function answerChange(db, { leadId, id, accept, note = null }) {
  const t = await loadChange(db, id);
  if (Number(t.lead_id) !== Number(leadId)) throw new HttpError(404, 'Travaux modificatifs introuvables.');
  if (t.status !== 'chiffree') throw new HttpError(409, 'Ce devis n’attend plus de réponse.');
  const sale = await db('sales').where({ id: t.sale_id }).first();
  const direct = [t.manager_id, t.assigned_to].filter(Boolean);
  const link = t.worksite_id ? `/chantiers/${t.worksite_id}?onglet=tma` : '/commercial/ventes';
  if (accept) {
    const due = addDays(today(), (await require('./chantiers').settings(db)).tma_due_days);
    await db.transaction(async trx => {
      await trx('worksite_changes').where({ id }).update({ status: 'acceptee', answered_at: new Date(), due_date: due, client_note: note, updated_at: new Date() });
      await require('./sales').refreshSaleStatus(trx, sale.id); // un dossier soldé redevient en cours
    });
    await tellClient(db, sale, `Merci : vous avez accepté les travaux modificatifs ${t.reference} — « ${t.title} ». ${money(t.amount_fcfa)} à régler avant le ${fr(due)} ; l’échéance figure dans « Paiements ».`);
    await inform(db, 'tma.acceptee', {
      direct, key: `tma:${id}:acceptee`, link, links: { compta: '/compta' },
      title: `TMA acceptée : ${t.title} — lot ${t.lot_code}`, body: `${t.client_name} · ${money(t.amount_fcfa)} à régler avant le ${fr(due)} (ajouté à l’échéancier du dossier)`,
    });
  } else {
    await db('worksite_changes').where({ id }).update({ status: 'refusee', answered_at: new Date(), client_note: note, updated_at: new Date() });
    await inform(db, 'tma.refusee', {
      direct, key: `tma:${id}:refusee`, link, title: `TMA refusée par l’acquéreur : ${t.title} — lot ${t.lot_code}`, body: `${t.client_name}${note ? ` · « ${note} »` : ''}`,
    });
  }
  return serializeChange(await loadChange(db, id));
}

/** Annulation par l'équipe (avant l'accord) ou réalisation (après l'accord). */
async function setChangeStatus(db, t, { status, done_on = null }, { userId }) {
  if (status === 'annulee') {
    if (!['demandee', 'chiffree'].includes(t.status)) throw new HttpError(409, 'Des travaux acceptés ne s’annulent plus ici : voyez avec la Comptabilité.');
    await db('worksite_changes').where({ id: t.id }).update({ status, updated_at: new Date() });
    await resolve(db, `tma:${t.id}:`);
  } else if (status === 'realisee') {
    if (t.status !== 'acceptee') throw new HttpError(409, 'Seuls des travaux acceptés par l’acquéreur se réalisent.');
    const day = done_on || today();
    if (day > today()) throw new HttpError(400, 'La réalisation ne se date pas à l’avance.');
    await db('worksite_changes').where({ id: t.id }).update({ status, done_on: day, updated_at: new Date() });
    const sale = await db('sales').where({ id: t.sale_id }).first();
    await tellClient(db, sale, `Les travaux modificatifs ${t.reference} — « ${t.title} » sont réalisés (le ${fr(day)}).`, userId);
  } else throw new HttpError(400, 'Statut inconnu.');
  return serializeChange(await loadChange(db, t.id));
}

/** TMA vues par l'acquéreur : rien d'interne (auteurs, chantier). */
async function clientChanges(db, saleId) {
  return (await changes(db, { saleId })).filter(t => t.status !== 'annulee').map(t => ({
    id: t.id, reference: t.reference, title: t.title, description: t.description, status: t.status, status_label: t.status_label,
    amount_fcfa: t.status === 'demandee' ? null : t.amount_fcfa, delay_days: t.delay_days, quote_note: t.quote_note, due_date: t.due_date, done_on: t.done_on,
    can_answer: t.status === 'chiffree', created_at: t.created_at,
  }));
}

// ─── Besoins en matériaux ─────────────────────────────────────────────────

const needQuery = db => db('worksite_needs as n').join('worksites as w', 'w.id', 'n.worksite_id').leftJoin('worksite_phases as ph', 'ph.id', 'n.phase_id')
  .leftJoin('suppliers as f', 'f.id', 'n.supplier_id').leftJoin('users as r', 'r.id', 'n.requested_by').leftJoin('users as v', 'v.id', 'n.validated_by')
  .leftJoin('worksite_ref_items as u', function () { this.on('u.code', '=', 'n.unit').andOn('u.kind', '=', db.raw('?', ['unite'])); })
  .select('n.*', 'w.reference as worksite_reference', 'w.name as worksite_name', 'w.manager_id', 'ph.label as phase_label', 'f.name as supplier_name',
    'r.name as requested_by_name', 'v.name as validated_by_name', 'u.label as unit_label');

const serializeNeed = n => ({
  id: n.id, worksite_id: n.worksite_id, worksite_reference: n.worksite_reference, phase_id: n.phase_id, phase_label: n.phase_label || null,
  label: n.label, quantity: Number(n.quantity), unit: n.unit, unit_label: n.unit_label || n.unit, needed_on: isoDay(n.needed_on),
  status: n.status, status_label: NEED_STATUSES[n.status], supplier_id: n.supplier_id, supplier_name: n.supplier_name || null,
  estimate_fcfa: n.estimate_fcfa == null ? null : Number(n.estimate_fcfa), note: n.note, refusal_reason: n.refusal_reason,
  requested_by_name: n.requested_by_name, validated_by_name: n.validated_by_name, validated_at: isoTime(n.validated_at),
  ordered_on: isoDay(n.ordered_on), delivered_on: isoDay(n.delivered_on), created_at: isoTime(n.created_at),
});

async function needs(db, { worksiteId = null, status = null } = {}) {
  const q = needQuery(db).orderBy([{ column: 'n.needed_on' }, { column: 'n.id', order: 'desc' }]).limit(500);
  if (worksiteId) q.where('n.worksite_id', worksiteId);
  if (status) q.where('n.status', status);
  return (await q).map(serializeNeed);
}

async function loadNeed(db, w, id) {
  const n = await needQuery(db).where({ 'n.id': id, 'n.worksite_id': w.id }).first();
  if (!n) throw new HttpError(404, 'Besoin introuvable.');
  return n;
}

async function checkNeed(db, w, data, current = null) {
  await require('./chantiers').checkListCode(db, 'unite', data.unit, current?.unit);
  if (data.phase_id && !(await db('worksite_phases').where({ id: data.phase_id, worksite_id: w.id }).first())) throw new HttpError(400, 'Phase inconnue pour ce chantier.');
  if (data.supplier_id && !(await db('suppliers').where({ id: data.supplier_id }).first())) throw new HttpError(404, 'Fournisseur introuvable.');
}

// Les Achats reçoivent les besoins exprimés par les chantiers.
const buyers = db => usersWith(db, 'appro:write');

async function createNeed(db, w, data, { userId }) {
  await checkNeed(db, w, data);
  const [r] = await db('worksite_needs').insert({ ...data, worksite_id: w.id, status: 'demande', requested_by: userId });
  const id = insertedId(r);
  await inform(db, 'chantier.besoin', {
    direct: await buyers(db), except: userId, key: `besoin:${id}`,
    title: `Besoin chantier à traiter : ${data.label} (${data.quantity} ${data.unit}) — ${w.reference}`, body: `${w.name}${data.needed_on ? ` · souhaité le ${fr(data.needed_on)}` : ''}`,
    link: '/achats/besoins',
  });
  return serializeNeed(await loadNeed(db, w, id));
}

async function updateNeed(db, w, n, data) {
  if (n.status !== 'demande') throw new HttpError(409, 'Un besoin traité par les Achats ne se modifie plus.');
  await checkNeed(db, w, data, n);
  await db('worksite_needs').where({ id: n.id }).update({ ...data, updated_at: new Date() });
  return serializeNeed(await loadNeed(db, w, n.id));
}

/** Suite donnée par les Achats (commande, refus, livraison à la réception) ou annulation par le chantier. */
async function moveNeed(db, w, n, { status, reason = null, supplier_id, estimate_fcfa, date = null }, { userId }) {
  const allowed = { refuse: ['demande', 'valide'], commande: ['demande', 'valide'], livre: ['commande'], annule: ['demande', 'valide'] };
  if (!allowed[status]?.includes(n.status)) throw new HttpError(409, `Passage impossible : ${NEED_STATUSES[n.status]} → ${NEED_STATUSES[status] || status}.`);
  if (status === 'refuse' && !reason) throw new HttpError(400, 'Indiquez le motif du refus.');
  const day = date || today();
  const patch = { status, updated_at: new Date() };
  if (['valide', 'refuse'].includes(status)) Object.assign(patch, { validated_by: userId, validated_at: new Date(), refusal_reason: status === 'refuse' ? reason : null });
  if (status === 'commande') Object.assign(patch, { ordered_on: day });
  if (status === 'livre') Object.assign(patch, { delivered_on: day });
  if (supplier_id !== undefined) patch.supplier_id = supplier_id;
  if (estimate_fcfa !== undefined) patch.estimate_fcfa = estimate_fcfa;
  if (patch.supplier_id && !(await db('suppliers').where({ id: patch.supplier_id }).first())) throw new HttpError(404, 'Fournisseur introuvable.');
  await db('worksite_needs').where({ id: n.id }).update(patch);
  if (['commande', 'refuse', 'annule'].includes(status)) await resolve(db, `besoin:${n.id}`);
  // Le conducteur qui l'a demandé suit sa demande
  if (['refuse', 'commande', 'livre'].includes(status) && n.requested_by) {
    await notify(db, {
      to: n.requested_by, except: userId, module: 'chantiers', event: `besoin.${status}`, link: `/chantiers/${w.id}?onglet=besoins`, key: `besoin:${n.id}:${status}`,
      title: `Besoin ${NEED_STATUSES[status].toLowerCase()} : ${n.label} — ${w.reference}`, body: status === 'refuse' ? reason : null, priority: status === 'refuse' ? 'action' : 'info',
    });
  }
  return serializeNeed(await loadNeed(db, w, n.id));
}

async function deleteNeed(db, n) {
  if (n.status !== 'demande') throw new HttpError(409, 'Seul un besoin encore demandé se supprime ; sinon, annulez-le.');
  await db('worksite_needs').where({ id: n.id }).del();
  await resolve(db, `besoin:${n.id}`);
}

// ─── Réception d'un lot ───────────────────────────────────────────────────

const serializeHandover = h => (h ? {
  id: h.id, sale_id: h.sale_id, handed_on: isoDay(h.handed_on), client_signed: !!h.client_signed, attendees: h.attendees, note: h.note,
  file_url: h.file_filename ? `/api/admin/erp/chantiers/receptions/${h.id}/pv` : null,
} : null);

/**
 * PV de réception d'un lot de la zone du chantier : date de livraison du dossier (garanties), réserves au SAV, étape
 * « Livraison » du lot signalée à la Direction (dernier appel de fonds VEFA), acquéreur et services prévenus.
 */
async function handover(db, w, saleId, { handed_on, client_signed = true, attendees = null, note = null, reserves = [] }, { file = null, userId }) {
  const sale = await db('sales').where({ id: saleId }).first();
  if (!sale || !ACTIVE.includes(sale.status)) throw new HttpError(404, 'Dossier introuvable ou clos.');
  const zone = await require('./chantiers').zoneLots(db, w);
  const lot = zone.find(l => l.id === sale.lot_id);
  if (!lot) throw new HttpError(400, 'Ce lot n’est pas dans la zone de ce chantier.');
  if (await db('lot_handovers').where({ sale_id: sale.id }).first()) throw new HttpError(409, 'Ce lot est déjà réceptionné.');
  if (handed_on > today()) throw new HttpError(400, 'Une réception ne se date pas à l’avance.');
  for (const r of reserves) if (r.category && !SAV_CATEGORIES[r.category]) throw new HttpError(400, `Catégorie de réserve inconnue : ${r.category}.`);
  const id = await db.transaction(async trx => {
    const [h] = await trx('lot_handovers').insert({
      sale_id: sale.id, worksite_id: w.id, handed_on, client_signed: !!client_signed, attendees, note, created_by: userId, ...fileFields(file),
    });
    await trx('sales').where({ id: sale.id }).update({ delivered_at: handed_on, updated_at: new Date() });
    // Comme Client & SAV › date de livraison : le client passe à l'étape « livraison »
    await trx('leads').where({ id: sale.lead_id }).whereIn('stage', ['contrat', 'notaire', 'paiement', 'choix_bien']).update({ stage: 'livraison', updated_at: new Date() });
    if (reserves.length) {
      await trx('sav_reserves').insert(reserves.map(r => ({
        sale_id: sale.id, lot_id: lot.id, ticket_id: null, label: r.label, location: r.location || null, category: r.category || null, status: 'ouverte',
        noted_at: handed_on, deadline: r.deadline || null, lifted_at: null, lifted_by: null, media: null, note: null,
      })));
    }
    return insertedId(h);
  });

  const client = await db('leads').where({ id: sale.lead_id }).first('name', 'assigned_to');
  const project = await db('projects').where({ id: lot.project_id }).first('name');
  const info = { client_name: client.name, assigned_to: client.assigned_to, project_name: project.name };

  // Dernier appel de fonds : l'étape « Livraison » de ce lot est signalée à la Direction (qui la déclare)
  let declarationId = null;
  const pendingCall = sale.vefa && await db('fund_calls').where({ sale_id: sale.id, stage: 'livraison', status: 'a_venir' }).first();
  if (pendingCall && !(await db('stage_declarations').where({ lot_id: lot.id, stage: 'livraison' }).whereIn('status', ['signalee', 'declaree']).first())) {
    const [r] = await db('stage_declarations').insert({
      project_id: w.project_id, worksite_id: w.id, lot_id: lot.id, stage: 'livraison', reached_on: handed_on, status: 'signalee',
      note: `Réception du lot ${lot.code} (PV du ${fr(handed_on)}) : dernier appel de fonds à émettre.`, reported_by: userId, reported_at: new Date(),
    });
    declarationId = insertedId(r);
    await inform(db, 'chantier.etape_signalee', {
      direct: await usersWith(db, 'chantiers:direction'), except: userId, key: `etape:${declarationId}:signalee`,
      title: `Étape à déclarer : ${SITE_STAGE_LABELS.livraison} du lot ${lot.code} — ${w.reference}`,
      body: `${info.client_name} · réceptionné le ${fr(handed_on)}. Sa déclaration émettra le dernier appel de fonds VEFA (${money(pendingCall.amount_fcfa)}).`,
      link: `/chantiers/${w.id}?onglet=etapes&etape=${declarationId}`,
    });
  }

  const g = warrantyDates(handed_on);
  await tellClient(db, sale, `Réception de votre lot ${lot.code} le ${fr(handed_on)}${client_signed ? ' (procès-verbal signé)' : ''}. ${reserves.length ? `${reserves.length} réserve(s) notée(s) : leur levée est suivie dans « Chantier » › Livraison.` : 'Aucune réserve n’a été notée.'}\nVos garanties courent à partir de cette date : parfait achèvement jusqu’au ${fr(g.parfait_achevement)}, biennale jusqu’au ${fr(g.biennale)}, décennale jusqu’au ${fr(g.decennale)}.`, userId);
  await inform(db, 'lot.livre', {
    direct: info.assigned_to ? [info.assigned_to] : [], except: userId, key: `livraison:${sale.id}`,
    title: `Lot ${lot.code} réceptionné : ${info.client_name}`, body: `${info.project_name} · le ${fr(handed_on)} · ${reserves.length} réserve(s)${declarationId ? ' · dernier appel de fonds à déclarer' : ''}`,
    link: `/chantiers/${w.id}?onglet=livraisons`, links: { sav: '/sav/reserves', juridique: `/juridique/actes?fiche=${sale.id}`, compta: '/compta' },
  });
  return { handover: serializeHandover(await db('lot_handovers').where({ id }).first()), reserves: reserves.length, declaration_id: declarationId };
}

async function loadHandover(db, id) {
  const h = await db('lot_handovers').where({ id }).first();
  if (!h) throw new HttpError(404, 'Réception introuvable.');
  return h;
}

/** Livraison vue par l'acquéreur : PV et réserves (ouvertes, levées). */
async function clientDelivery(db, saleId) {
  const [h, reserves] = await Promise.all([
    db('lot_handovers').where({ sale_id: saleId }).first(),
    db('sav_reserves').where({ sale_id: saleId }).orderBy(['noted_at', 'id']),
  ]);
  return {
    handover: h ? { handed_on: isoDay(h.handed_on), client_signed: !!h.client_signed, pv_url: h.file_filename ? `/api/client/livraison/${saleId}/pv` : null } : null,
    reserves: reserves.map(r => ({ id: r.id, label: r.label, location: r.location, category_label: SAV_CATEGORIES[r.category] || null, status: r.status, noted_at: isoDay(r.noted_at), deadline: isoDay(r.deadline), lifted_at: isoTime(r.lifted_at) })),
  };
}

// ─── Réception des travaux d'un marché ────────────────────────────────────

/** Date de réception des travaux d'un sous-traitant : la retenue de garantie est libérable après le délai réglé. */
async function receiveMarket(db, w, contractId, { works_received_on }, { userId }) {
  const c = await db('contracts as c').leftJoin('suppliers as s', 's.id', 'c.supplier_id').where({ 'c.id': contractId, 'c.worksite_id': w.id, 'c.kind': 'sous_traitance' })
    .first('c.*', 's.name as supplier_name');
  if (!c) throw new HttpError(404, 'Marché introuvable pour ce chantier.');
  if (works_received_on && works_received_on > today()) throw new HttpError(400, 'Une réception ne se date pas à l’avance.');
  await db('contracts').where({ id: c.id }).update({ works_received_on, updated_at: new Date() });
  const g = await db('guarantees').where({ contract_id: c.id, direction: 'retenue', status: 'active' }).first();
  let release = null;
  if (g) {
    const juridique = require('./juridique');
    await juridique.updateGuarantee(db, g, { reception_on: works_received_on, release_on: null }, {});
    release = isoDay((await db('guarantees').where({ id: g.id }).first('release_on')).release_on);
  }
  if (works_received_on) {
    await inform(db, 'chantier.marche_receptionne', {
      except: userId, key: `marche:${c.id}:reception:${works_received_on}`,
      title: `Travaux réceptionnés : ${c.reference} — ${c.supplier_name || c.counterparty || c.title}`,
      body: g ? `Retenue de garantie de ${money(g.amount_fcfa)} libérable le ${fr(release)}.` : `Réception du ${fr(works_received_on)} ; aucune retenue enregistrée pour ce marché.`,
      link: `/chantiers/${w.id}?onglet=sous-traitants`, links: { juridique: g ? `/juridique/cautions?fiche=${g.id}` : '/juridique/cautions', compta: '/compta/achats' },
    });
  }
  return { works_received_on, release_on: release };
}

module.exports = {
  worksiteForLot, changes, loadChange, serializeChange, extrasFor, tmaLines, createChange, quoteChange, answerChange, setChangeStatus, clientChanges,
  needs, loadNeed, createNeed, updateNeed, moveNeed, deleteNeed,
  handover, loadHandover, serializeHandover, clientDelivery, receiveMarket,
};
