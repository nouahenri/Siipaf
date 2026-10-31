/**
 * ERP · Administration générale › Demandes internes. L'employé demande depuis Mon espace (self:demandes) ; son
 * responsable direct valide, puis la DG pour un achat au-delà du plafond (Paramètres › Général). Un achat ou un
 * équipement arrive ensuite dans Achats › Besoins (bon de commande, réception, facture en Comptabilité : services/appro.js) ;
 * les autres demandes vont aux services généraux (demandes:handle), qui prennent en charge et clôturent.
 * Règles dans lib/domain.js (REQUEST_*, requestNextStep).
 */
const { HttpError, isoDay, isoTime } = require('../lib/http');
const { REQUEST_KINDS, REQUEST_SERVICES, REQUEST_STATUSES, REQUEST_OPEN, requestNextStep, requestNeedsDg } = require('../lib/domain');
const { splitVat } = require('../lib/compta');
const { DEPARTMENTS } = require('../lib/paie');
const { nextPurchaseNumber } = require('./compta');
const { getSetting } = require('./settings');
const { resolve, usersWith, usersWithAny, inform } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);

const query = db => db('internal_requests as r').join('users as u', 'u.id', 'r.requested_by').leftJoin('users as m', 'm.id', 'r.manager_user_id')
  .leftJoin('users as h', 'h.id', 'r.handled_by').leftJoin('projects as p', 'p.id', 'r.project_id').leftJoin('worksites as w', 'w.id', 'r.worksite_id').leftJoin('places as pl', 'pl.id', 'r.place_id').leftJoin('suppliers as s', 's.id', 'r.supplier_id')
  .leftJoin('purchase_invoices as i', 'i.id', 'r.purchase_invoice_id').leftJoin('appro_orders as o', 'o.id', 'r.order_id')
  .select('r.*', 'o.reference as order_reference', 'u.name as requested_by_name', 'm.name as manager_name', 'h.name as handled_by_name', 'p.name as project_name', 'w.reference as worksite_reference', 'w.name as worksite_name', 'pl.name as place_name', 's.name as supplier_name', 'i.number as invoice_number');

const serialize = r => ({
  ...r, kind_label: r.kind === 'autre' && r.kind_other ? r.kind_other : r.kind === 'service' && REQUEST_SERVICES[r.service] ? `Demande à : ${REQUEST_SERVICES[r.service].label}` : REQUEST_KINDS[r.kind]?.label || r.kind,
  status_label: r.status === 'attente_service' && REQUEST_SERVICES[r.service] ? `À traiter (${REQUEST_SERVICES[r.service].label})` : REQUEST_STATUSES[r.status], service_label: REQUEST_SERVICES[r.service]?.label || null,
  department_label: DEPARTMENTS[r.department] || null,
  needed_by: isoDay(r.needed_by), estimated_amount: r.estimated_amount == null ? null : Number(r.estimated_amount), final_amount: r.final_amount == null ? null : Number(r.final_amount),
  manager_at: isoTime(r.manager_at), dg_at: isoTime(r.dg_at), handled_at: isoTime(r.handled_at), closed_at: isoTime(r.closed_at), created_at: isoTime(r.created_at),
  purchase: !!REQUEST_KINDS[r.kind]?.purchase, open: REQUEST_OPEN.includes(r.status),
});

async function load(db, id) {
  const r = await query(db).where('r.id', id).first();
  if (!r) throw new HttpError(404, 'Demande introuvable.');
  return r;
}

/** Le compte traite les demandes adressées à ce service (droits de REQUEST_SERVICES). */
const servesFor = (service, v) => !!REQUEST_SERVICES[service] && (v.superAdmin || REQUEST_SERVICES[service].perms.some(p => v.can(p)));

/** Le compte dirige ce service ou en fait partie (fiche employé) : il suit les demandes du service. */
const inDepartment = (department, v) => !!v.depts && (v.depts.member === department || v.depts.heads.includes(department));

/** Ce que le compte peut faire sur la demande à son étape. */
function rights(r, { userId, can, superAdmin, depts }) {
  const author = r.requested_by === userId || (!!r.department && !!depts?.heads.includes(r.department));
  if (r.kind === 'service' && r.service !== 'administration') {
    return {
      approve: false,
      handle: servesFor(r.service, { can, superAdmin }) && ['attente_service', 'en_cours'].includes(r.status) && (r.requested_by !== userId || superAdmin),
      cancel: author && r.status === 'attente_service',
    };
  }
  return {
    // Personne ne valide ni ne traite sa propre demande (audit du 29/10), sauf le super administrateur
    approve: (r.status === 'attente_responsable' && (r.manager_user_id === userId || superAdmin)) || (r.status === 'attente_dg' && can('demandes:dg') && (r.requested_by !== userId || superAdmin)),
    handle: can('demandes:handle') && ['attente_sg', 'en_cours'].includes(r.status) && (r.requested_by !== userId || superAdmin),
    cancel: author && ['attente_responsable', 'attente_dg', 'attente_sg'].includes(r.status),
  };
}
const canSee = (r, v) => r.requested_by === v.userId || r.manager_user_id === v.userId || v.can('demandes:handle') || v.can('demandes:view_all') || v.can('demandes:dg') || v.superAdmin
  || (r.kind === 'service' && servesFor(r.service, v))
  || (!!r.department && inDepartment(r.department, v))
  || (REQUEST_KINDS[r.kind]?.purchase && v.can('appro:read'));

/** Prévient le ou les valideurs de l'étape où se trouve la demande. */
async function notifyStep(db, r, except) {
  const s = serialize(r);
  const base = { link: `/administration/demandes?fiche=${r.id}`, priority: r.urgency === 'urgente' ? 'urgent' : 'action', email: true, except };
  const what = `${s.kind_label} — ${r.title}${s.estimated_amount ? ` (${s.estimated_amount.toLocaleString('fr-FR')} FCFA)` : ''}`;
  if (r.status === 'attente_responsable') {
    await inform(db, 'demande.responsable', { ...base, direct: r.manager_user_id, title: `Demande de ${r.requested_by_name} à valider`, body: what, key: `demande:${r.id}:responsable` });
  } else if (r.status === 'attente_dg') {
    await inform(db, 'demande.dg', { ...base, direct: await usersWith(db, 'demandes:dg'), title: `Achat à valider (DG) : ${r.reference}`, body: `${what} — demandé par ${r.requested_by_name}`, key: `demande:${r.id}:dg` });
  } else if (r.status === 'attente_achats') {
    // Besoin d'un service : les Achats le commandent (circuit réglable dans Administration générale › Circuit d'information)
    await inform(db, 'demande.achat', { except, key: `demande:${r.id}:achats`, priority: base.priority, title: `Besoin à commander : ${r.reference}`, body: `${what} — ${r.requested_by_name}`, link: '/achats/besoins?onglet=services' });
  } else if (r.status === 'attente_service' && REQUEST_SERVICES[r.service]) {
    const svc = REQUEST_SERVICES[r.service];
    await inform(db, 'demande.service', { ...base, module: svc.module, link: svc.link, direct: await usersWithAny(db, svc.perms), title: `Demande reçue : ${r.title}`, body: `${r.requested_by_name} — ${r.reference}`, key: `demande:${r.id}:service` });
  } else if (r.status === 'attente_sg') {
    await inform(db, 'demande.sg', { ...base, direct: await usersWith(db, 'demandes:handle'), title: `Demande à traiter : ${r.reference}`, body: `${what} — ${r.requested_by_name}`, key: `demande:${r.id}:sg` });
  }
}

async function notifyRequester(db, r, title, body, except) {
  await inform(db, 'demande.suite', { direct: r.requested_by, except, title, body, link: '/rh/moi', key: `demande:${r.id}:${r.status}`, email: true });
}

async function create(db, data, { user }) {
  if (!REQUEST_KINDS[data.kind]) throw new HttpError(400, 'Sorte de demande inconnue.');
  if (data.kind === 'autre' && !data.kind_other) throw new HttpError(400, 'Précisez la nature de la demande.');
  if (data.kind === 'service' && !REQUEST_SERVICES[data.service]) throw new HttpError(400, 'Choisissez le service destinataire.');
  if (data.kind !== 'service') data.service = null;
  if (REQUEST_KINDS[data.kind].purchase && !data.estimated_amount) throw new HttpError(400, 'Achat : indiquez le montant estimé.');
  if (data.department) {
    if (!DEPARTMENTS[data.department]) throw new HttpError(400, 'Service inconnu.');
    const { departmentsOf } = require('./departments');
    if (!(await departmentsOf(db, user.id)).heads.includes(data.department)) throw new HttpError(403, 'Seul le chef du service, désigné dans Réglages RH, fait une demande au nom du service.');
  } else data.department = null;
  data = { ...data, ...(await require('./lieux').placeFields(db, data)) };
  // Responsable direct de la fiche RH (jamais soi-même)
  const e = await db('employees').where({ user_id: user.id }).first('manager_id');
  const m = e?.manager_id ? await db('employees as x').join('users as u', 'u.id', 'x.user_id').where({ 'x.id': e.manager_id, 'u.active': true }).first('u.id') : null;
  const managerId = m && m.id !== user.id ? m.id : null;
  const threshold = await getSetting(db, 'request_dg_threshold');
  const status = requestNextStep(data, { hasManager: !!managerId, threshold });
  const year = new Date().getUTCFullYear();
  let id;
  for (let attempt = 0; ; attempt++) {
    try {
      id = await db.transaction(async trx => {
        const prefix = `DI-${year}-`;
        const last = await trx('internal_requests').where('reference', 'like', `${prefix}%`).orderBy('reference', 'desc').first('reference');
        const [i] = await trx('internal_requests').insert({
          ...data, reference: `${prefix}${String(last ? Number(last.reference.slice(prefix.length)) + 1 : 1).padStart(4, '0')}`,
          status, requested_by: user.id, manager_user_id: managerId,
        });
        return insertedId(i);
      });
      break;
    } catch (err) {
      if (attempt >= 4 || !/unique|duplicate/i.test(err.message)) throw err;
    }
  }
  await notifyStep(db, await load(db, id), user.id);
  return id;
}

/** Validation ou refus à l'étape en cours (responsable direct, puis DG). */
async function decide(db, r, { approve, note }, v) {
  if (!rights(r, v).approve) throw new HttpError(403, r.status === 'attente_dg' ? 'Validation réservée à la direction générale.' : 'Seul le responsable direct valide cette demande.');
  if (!approve && !note) throw new HttpError(400, 'Indiquez le motif du refus.');
  const now = new Date();
  const stamp = r.status === 'attente_responsable' ? { manager_by: v.userId, manager_at: now } : { dg_by: v.userId, dg_at: now };
  const threshold = await getSetting(db, 'request_dg_threshold');
  const next = approve ? requestNextStep(r, { from: r.status, hasManager: !!r.manager_user_id, threshold }) : 'refusee';
  await db('internal_requests').where({ id: r.id }).update({ ...stamp, status: next, decision_note: approve ? r.decision_note : note, updated_at: now });
  await resolve(db, `demande:${r.id}:${r.status === 'attente_responsable' ? 'responsable' : 'dg'}`);
  const fresh = await load(db, r.id);
  if (approve) await notifyStep(db, fresh, v.userId);
  else await notifyRequester(db, fresh, `Demande refusée : ${r.title}`, `Motif : ${note}`, v.userId);
  return fresh;
}

/** Prise en charge par les services généraux. */
async function take(db, r, v) {
  if (!rights(r, v).handle || !['attente_sg', 'attente_service'].includes(r.status)) throw new HttpError(409, 'Cette demande n’est pas à prendre en charge.');
  await db('internal_requests').where({ id: r.id }).update({ status: 'en_cours', handled_by: v.userId, handled_at: new Date(), updated_at: new Date() });
  await resolve(db, `demande:${r.id}:${r.status === 'attente_service' ? 'service' : 'sg'}`);
  const fresh = await load(db, r.id);
  await notifyRequester(db, fresh, `Demande prise en charge : ${r.title}`, `Par ${(await db('users').where({ id: v.userId }).first('name')).name}`, v.userId);
  return fresh;
}

/**
 * Clôture par les services généraux : traitée (réponse au demandeur) ou refusée (motif). Un achat traité peut
 * devenir une facture d'achat en brouillon (fournisseur, montant TTC, compte de charge) pour le comptable.
 */
async function close(db, r, data, v) {
  if (!rights(r, v).handle) throw new HttpError(409, 'Cette demande n’est pas à clôturer.');
  const now = new Date();
  if (data.outcome === 'refusee') {
    if (!data.note) throw new HttpError(400, 'Indiquez le motif.');
    await db('internal_requests').where({ id: r.id }).update({ status: 'refusee', decision_note: data.note, closed_at: now, handled_by: r.handled_by || v.userId, updated_at: now });
  } else {
    const patch = { status: 'traitee', decision_note: data.note || null, closed_at: now, handled_by: r.handled_by || v.userId, final_amount: data.amount_ttc ?? null, supplier_id: data.supplier_id ?? null, updated_at: now };
    await db.transaction(async trx => {
      if (data.invoice) {
        if (!REQUEST_KINDS[r.kind]?.purchase) throw new HttpError(400, 'Seul un achat devient une facture d’achat.');
        // Une facture d'achat relève de la Comptabilité (droit « Saisir les achats ») et du traitement (« Facture d’achat à la clôture »)
        if (!v.can('demandes:invoice') || !v.can('achats:write')) throw new HttpError(403, 'Préparer la facture d’achat demande les droits « Facture d’achat à la clôture » et « Saisir les achats » : clôturez sans facture, la Comptabilité la saisira.');
        if (!data.supplier_id || !data.amount_ttc) throw new HttpError(400, 'Facture : fournisseur et montant TTC.');
        const s = await trx('suppliers').where({ id: data.supplier_id }).first();
        if (!s) throw new HttpError(404, 'Fournisseur introuvable.');
        let accountId = s.expense_account_id;
        if (data.expense_account) {
          const acc = await trx('acc_accounts').where({ code: data.expense_account }).first();
          if (!acc || ![2, 6].includes(acc.class)) throw new HttpError(400, 'Compte de charge : classe 6 (ou 2 pour une immobilisation).');
          accountId = acc.id;
        }
        if (!accountId) throw new HttpError(400, 'Indiquez le compte de charge (ou réglez-le sur la fiche du fournisseur).');
        const date = data.date || now.toISOString().slice(0, 10);
        const { ht, vat } = splitVat(data.amount_ttc, data.vat_rate || 0);
        const [i] = await trx('purchase_invoices').insert({
          number: await nextPurchaseNumber(trx, date), supplier_id: s.id, supplier_ref: data.supplier_ref || r.reference, date, due_date: data.due_date || null,
          label: `${r.reference} — ${r.title}`.slice(0, 255), project_id: r.project_id || null, worksite_id: r.worksite_id || null,
          worksite_category: r.worksite_id ? 'materiaux' : null, place_id: r.place_id || null, expense_account_id: accountId,
          amount_ht: ht, vat_rate: data.vat_rate || 0, vat_amount: vat, amount_ttc: data.amount_ttc, status: 'brouillon', created_by: v.userId,
        });
        patch.purchase_invoice_id = insertedId(i);
      }
      await trx('internal_requests').where({ id: r.id }).update(patch);
    });
  }
  await resolve(db, `demande:${r.id}:`);
  const fresh = await load(db, r.id);
  await notifyRequester(db, fresh, data.outcome === 'refusee' ? `Demande refusée : ${r.title}` : `Demande traitée : ${r.title}`, data.note || null, v.userId);
  if (fresh.purchase_invoice_id) {
    await inform(db, 'achat.brouillon', {
      direct: await usersWith(db, 'achats:write'), except: v.userId, title: `Facture d’achat à vérifier : ${fresh.invoice_number}`,
      body: `${r.reference} — ${r.title}`, link: '/compta/achats', priority: 'action', key: `demande:${r.id}:facture`,
    });
  }
  return fresh;
}

async function cancel(db, r, v) {
  if (!rights(r, v).cancel) throw new HttpError(409, 'Seule une demande pas encore prise en charge s’annule, par son auteur.');
  await db('internal_requests').where({ id: r.id }).update({ status: 'annulee', closed_at: new Date(), updated_at: new Date() });
  await resolve(db, `demande:${r.id}:`);
}

/** Liste : `scope` mine (mes demandes), approve (à valider par moi), handle (services généraux), service (adressées à un service), department (au nom d'un service), all. */
async function list(db, v, { scope = 'mine', status = null, service = null, department = null } = {}) {
  const q = query(db).orderBy('r.created_at', 'desc').limit(1000);
  if (scope === 'mine') q.where('r.requested_by', v.userId);
  else if (scope === 'department') {
    if (!DEPARTMENTS[department] || !(inDepartment(department, v) || v.can('demandes:view_all') || v.superAdmin)) throw new HttpError(403, 'Droits insuffisants.');
    q.where('r.department', department);
  } else if (scope === 'approve') {
    q.where(w => {
      w.where(x => x.where('r.status', 'attente_responsable').where('r.manager_user_id', v.userId));
      if (v.can('demandes:dg')) w.orWhere('r.status', 'attente_dg');
    });
  } else if (scope === 'service') {
    if (!servesFor(service, v) || service === 'administration') throw new HttpError(403, 'Droits insuffisants.');
    q.where({ 'r.kind': 'service', 'r.service': service }).whereIn('r.status', ['attente_service', 'en_cours']);
  } else if (scope === 'handle') {
    if (!v.can('demandes:handle')) throw new HttpError(403, 'Droits insuffisants.');
    q.whereIn('r.status', ['attente_sg', 'en_cours']);
  } else if (!v.can('demandes:view_all') && !v.can('demandes:dg') && !v.superAdmin) {
    q.where(w => w.where('r.requested_by', v.userId).orWhere('r.manager_user_id', v.userId));
  }
  if (status) q.whereIn('r.status', String(status).split(','));
  return (await q).map(r => ({ ...serialize(r), rights: rights(r, v) }));
}

/** Demandes du service en attente, par service dont le compte est membre ou chef (pastille du menu, même calcul que la page). */
async function departmentWaiting(db, v) {
  const out = {};
  const now = new Date().toISOString().slice(0, 16);
  for (const d of new Set([v.depts?.member, ...(v.depts?.heads || [])].filter(Boolean))) {
    const open = (await list(db, v, { scope: 'department', department: d })).filter(r => r.open).length;
    const trips = Number((await db('asset_reservations').where({ department: d, status: 'demandee' }).where('end_at', '>=', now).count({ n: '*' }).first())?.n || 0);
    out[d] = open + trips;
  }
  return out;
}

async function badges(db, v) {
  const approve = (await list(db, v, { scope: 'approve' })).length;
  const handle = v.can('demandes:handle') ? (await list(db, v, { scope: 'handle' })).filter(r => r.status === 'attente_sg').length : 0;
  return { to_approve: approve, to_handle: handle };
}

module.exports = { query, serialize, load, rights, canSee, create, decide, take, close, cancel, list, badges, departmentWaiting, requestNeedsDg, notifyRequester };
