/**
 * Liaisons du parcours client (audit du 30/10/2026, docs/audit-liaisons-notifications.md) : du prospect entrant au SAV, qui
 * est prévenu de quoi. Toute notification passe par le circuit d'information (lib/domain.js : INFO_EVENTS, réglable dans
 * Administration générale › Circuit d'information et dans « Mes notifications ») avec une clé qui évite les doublons ; le
 * client est prévenu dans son espace (services/clients.js : tellClient, avec l'e-mail « nouveau message »).
 * Les modules appellent ces fonctions après leur propre écriture ; aucune ne bloque l'action en cas d'échec d'un e-mail.
 */
const { isoDay } = require('../lib/http');
const { sendMail } = require('../lib/mailer');
const { inform, resolve, usersWith } = require('./notifications');

const fr = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const frTime = d => new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Abidjan' });
const money = n => `${Number(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const today = () => new Date().toISOString().slice(0, 10);
const FIRM = 'SIIPAF SA';

/** Fiche d'un prospect ou d'un client dans l'ERP (le tiroir du pipeline). */
const leadLink = id => `/commercial/pipeline?p=${id}`;

/**
 * Message automatique à ne faire qu'une fois (rappel d'option, relance d'impayé, avis de document…) : vrai la première fois
 * qu'on rencontre la clé, faux ensuite. La clé est inscrite dans `liaison_marks`.
 */
async function sentOnce(db, key) {
  const k = String(key).slice(0, 190);
  if (await db('liaison_marks').where({ mark_key: k }).first('id')) return false;
  try {
    await db('liaison_marks').insert({ mark_key: k });
    return true;
  } catch { return false; } // inscrit entre-temps par un autre passage
}

/** E-mail à un prospect ou à un client (accusé, confirmation, rappel) ; sans adresse, rien. Ne lève jamais d'erreur. */
async function mailPerson(person, subject, lines) {
  if (!person?.email) return false;
  try {
    return await sendMail({ to: person.email, subject, text: [`Bonjour ${person.name || ''},`, '', ...lines, '', FIRM].join('\n') });
  } catch { return false; }
}

// ─── Prospects entrants ───────────────────────────────────────────────────

/**
 * Un prospect arrive par le site (manifestation d'intérêt, option sur plan, rendez-vous, message) — demain aussi par l'assistante
 * IA du site (source « ia ») : les responsables commerciaux sont prévenus d'un prospect à attribuer (`prospect.nouveau`) ; une
 * personne déjà suivie prévient son commercial (`prospect.demande`). `what` : « une pré-réservation du lot A12 »…
 */
async function announceInbound(db, leadOrId, { what, source = 'site' }) {
  const id = typeof leadOrId === 'object' ? leadOrId.id : leadOrId;
  const lead = await db('leads').where({ id }).first('id', 'name', 'assigned_to', 'phone', 'email');
  if (!lead) return 0;
  const via = { site: 'le site', plan: 'le plan interactif', ia: 'l’assistante IA du site' }[source] || 'le site';
  const body = [lead.phone, lead.email, `par ${via}`].filter(Boolean).join(' · ');
  if (lead.assigned_to) {
    return inform(db, 'prospect.demande', {
      direct: [lead.assigned_to], key: `lead:${lead.id}:demande:${Date.now()}`, title: `${lead.name} : ${what}`, body, link: leadLink(lead.id),
    });
  }
  return inform(db, 'prospect.nouveau', {
    key: `lead:${lead.id}:nouveau`, title: `Nouveau prospect à attribuer : ${lead.name}`, body: `${what} · ${body}`, link: leadLink(lead.id),
  });
}

/** Accusé de réception envoyé au prospect qui a rempli un formulaire du site (s'il a laissé une adresse). */
function acknowledge(person, subject, lines) {
  return mailPerson(person, subject, lines);
}

// ─── Attributions ─────────────────────────────────────────────────────────

/**
 * Un ou plusieurs prospects (ou une liste importée) sont attribués à un commercial : il est prévenu — une seule notification
 * pour un lot de prospects — sauf s'il se les attribue lui-même. `leads` : [{ id, name }]. L'alerte « à attribuer » des
 * responsables est lue.
 */
async function announceAssigned(db, userId, leads, { by = null, why = null } = {}) {
  if (!userId || !leads.length) return 0;
  for (const l of leads) await resolve(db, `lead:${l.id}:nouveau`);
  const one = leads.length === 1 ? leads[0] : null;
  return inform(db, 'prospect.attribue', {
    direct: [userId], except: by, key: `attribution:${userId}:${leads.map(l => l.id).slice(0, 5).join('-')}:${leads.length}:${Date.now()}`,
    title: one ? `Prospect attribué : ${one.name}` : `${leads.length} prospects vous sont attribués`,
    body: [why, one ? null : leads.slice(0, 5).map(l => l.name).join(', ') + (leads.length > 5 ? '…' : '')].filter(Boolean).join(' · ') || null,
    link: one ? leadLink(one.id) : '/commercial/pipeline',
  });
}

/** Activité ou rendez-vous confié à un commercial par un autre compte (le responsable) : l'assigné est prévenu. */
async function announceTask(db, { userId, leadId, what, when = null }, by) {
  if (!userId || userId === by) return 0;
  const lead = await db('leads').where({ id: leadId }).first('name');
  return inform(db, 'activite.confiee', {
    direct: [userId], except: by, key: `tache:${leadId}:${userId}:${Date.now()}`,
    title: `${what} confié(e) : ${lead?.name || 'prospect'}`, body: when ? `Prévu(e) le ${frTime(when)}` : null, link: leadLink(leadId),
  });
}

/** Rendez-vous confirmé par l'équipe : confirmation par e-mail au prospect (une seule fois par date). */
async function confirmAppointment(db, appointmentId) {
  const a = await db('appointments as a').join('leads as c', 'c.id', 'a.lead_id').leftJoin('users as u', 'u.id', 'a.assigned_to').leftJoin('projects as p', 'p.id', 'a.project_id')
    .where('a.id', appointmentId).first('a.starts_at', 'a.kind', 'a.status', 'c.name', 'c.email', 'u.name as advisor', 'p.name as project_name');
  if (!a || a.status !== 'confirme' || !(await sentOnce(db, `rdv:${appointmentId}:confirme:${new Date(a.starts_at).getTime()}`))) return false;
  const kind = { visite: 'visite sur site', appel: 'appel', bureau: 'rendez-vous au bureau', visio: 'visioconférence' }[a.kind] || 'rendez-vous';
  return mailPerson(a, `Votre rendez-vous SIIPAF du ${fr(new Date(a.starts_at).toISOString())} est confirmé`, [
    `Votre ${kind}${a.project_name ? ` (${a.project_name})` : ''} est confirmé : ${frTime(a.starts_at)}.`,
    a.advisor ? `Votre conseiller : ${a.advisor}.` : 'Un conseiller SIIPAF vous accueillera.',
    'Un empêchement ? Répondez à ce message ou appelez-nous au +225 01 02 27 95 95.',
  ]);
}

// ─── Options sur les lots ─────────────────────────────────────────────────

/** Option qui expire demain (`proche`) ou expirée (`expiree`) : le commercial du prospect (à défaut les responsables) et le prospect sont prévenus. */
async function announceOption(db, optionId, kind) {
  const o = await db('lot_options as o').join('lots as l', 'l.id', 'o.lot_id').join('projects as p', 'p.id', 'l.project_id').join('leads as c', 'c.id', 'o.lead_id')
    .where('o.id', optionId).first('o.expires_at', 'l.code as lot_code', 'p.name as project_name', 'c.id as lead_id', 'c.name', 'c.email', 'c.assigned_to');
  if (!o) return 0;
  const event = kind === 'proche' ? 'option.proche' : 'option.expiree';
  const n = await inform(db, event, {
    direct: o.assigned_to ? [o.assigned_to] : await usersWith(db, 'leads:assign'), key: `option:${optionId}:${kind}`,
    title: kind === 'proche' ? `Option du lot ${o.lot_code} expire demain : ${o.name}` : `Option expirée, lot ${o.lot_code} remis en vente : ${o.name}`,
    body: `${o.project_name} · échéance le ${fr(new Date(o.expires_at).toISOString())}`, link: leadLink(o.lead_id),
  });
  if (await sentOnce(db, `option:${optionId}:${kind}:mail`)) {
    await mailPerson(o, kind === 'proche' ? `Votre pré-réservation du lot ${o.lot_code} expire demain` : `Votre pré-réservation du lot ${o.lot_code} a expiré`, kind === 'proche'
      ? [`Votre pré-réservation du lot ${o.lot_code} (${o.project_name}) expire le ${fr(new Date(o.expires_at).toISOString())}.`, 'Contactez votre conseiller pour la confirmer et ouvrir votre dossier d’acquisition.']
      : [`Votre pré-réservation du lot ${o.lot_code} (${o.project_name}) est arrivée à échéance : le lot est de nouveau proposé à la vente.`, 'Il est encore temps d’en parler à votre conseiller si vous êtes toujours intéressé(e).']);
  }
  return n;
}

/** Versements repris par un import de clients (ancienne plateforme) : la Comptabilité a des écritures à synchroniser. */
async function announceImportedPayments(db, count, total, user) {
  return inform(db, 'import.versements', {
    except: user.id, key: `import-versements:${Date.now()}`, title: `${count} versement(s) repris par import : ${money(total)}`,
    body: `Import de clients par ${user.name} : les écritures sont à synchroniser.`, link: '/compta/ecritures',
  });
}

// ─── Désistement, lot sans dossier ────────────────────────────────────────

/** Dossiers clos par un désistement : Comptabilité, Juridique, Chantiers, SAV et commercial du client sont prévenus (circuit réglable). */
async function announceDesistement(db, saleIds, user) {
  let n = 0;
  for (const id of saleIds) {
    const s = await db('sales as s').join('leads as c', 'c.id', 's.lead_id').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id')
      .where('s.id', id).first('c.name', 'c.assigned_to', 'p.name as project_name', 'l.code as lot_code');
    if (!s) continue;
    const paid = Number((await db('payments').where({ sale_id: id }).sum({ v: 'amount_fcfa' }).first()).v || 0);
    n += await inform(db, 'vente.desistee', {
      direct: s.assigned_to ? [s.assigned_to] : [], except: user.id, key: `vente:${id}:desistee`,
      title: `Désistement : ${s.name} — ${s.project_name}, lot ${s.lot_code}`,
      body: paid ? `Dossier clos, lot libéré · ${money(paid)} déjà versés : remboursement ou retenue à étudier.` : 'Dossier clos, lot libéré · aucun versement enregistré.',
      link: '/commercial/ventes', links: { compta: '/compta/ventes', juridique: `/juridique/actes?fiche=${id}`, chantiers: '/chantiers/liste', sav: '/sav/ventes' },
    });
  }
  return n;
}

/**
 * Lot passé « réservé » ou « vendu » à la main, sans dossier d'acquisition : le commercial du prospect (à défaut les responsables)
 * est prévenu qu'il reste à ouvrir le dossier. L'alerte est lue à l'ouverture du dossier (`resolve`).
 */
async function announceLotWithoutSale(db, lotId, status, { user, leadId = null }) {
  if (await db('sales').where({ lot_id: lotId }).whereIn('status', ['en_cours', 'solde']).first('id')) return 0;
  const lot = await db('lots as l').join('projects as p', 'p.id', 'l.project_id').where('l.id', lotId).first('l.code', 'p.name as project_name');
  const lead = leadId ? await db('leads').where({ id: leadId }).first('assigned_to', 'name') : null;
  return inform(db, 'lot.sans_dossier', {
    direct: lead?.assigned_to ? [lead.assigned_to] : [], except: user.id, key: `lot:${lotId}:sans_dossier`,
    title: `Lot ${lot.code} passé « ${status === 'vendu' ? 'vendu' : 'réservé'} » sans dossier d’acquisition`, body: `${lot.project_name}${lead ? ` · ${lead.name}` : ''} — ouvrez le dossier pour suivre les versements et l’acte.`,
    link: '/commercial/parc',
  });
}

// ─── Espace client ────────────────────────────────────────────────────────

/** Message d'un client dans son espace : son commercial est prévenu (cloche de l'ERP), en plus de l'e-mail à l'équipe. */
async function announceClientMessage(db, lead, messageId, text) {
  if (!lead.assigned_to) return 0;
  return inform(db, 'message.client', {
    direct: [lead.assigned_to], key: `message-client:${messageId}`, title: `Message de ${lead.name}${lead.client_code ? ` (${lead.client_code})` : ''}`,
    body: String(text).slice(0, 200), link: '/commercial/ventes',
  });
}

/**
 * Point d'avancement publié pour les clients : chaque acquéreur concerné (projet, îlot ou lot du point) est prévenu dans son espace
 * (une seule fois par point), et leurs commerciaux dans la cloche.
 */
async function announceProgress(db, update, user, stageLabel = null) {
  if (!update.visible_client) return 0;
  const q = db('sales as s').join('lots as l', 'l.id', 's.lot_id').join('leads as c', 'c.id', 's.lead_id')
    .where('l.project_id', update.project_id).whereIn('s.status', ['en_cours', 'solde']).select('s.id', 's.lead_id', 'c.assigned_to');
  if (update.lot_id) q.where('l.id', update.lot_id);
  else if (update.ilot) q.where('l.ilot', update.ilot);
  const sales = await q;
  if (!sales.length) return 0;
  const { tellClient } = require('./clients');
  let told = 0;
  for (const s of sales) {
    if (!(await sentOnce(db, `site_update:${update.id}:sale:${s.id}`))) continue;
    await tellClient(db, { leadId: s.lead_id, saleId: s.id }, `Nouveau point d’avancement de votre chantier : « ${update.title} »${stageLabel ? ` (${stageLabel}, ${update.progress_pct} %)` : ''}. Retrouvez-le dans « Chantier ».`, user?.id || null);
    told++;
  }
  const commercials = [...new Set(sales.map(s => s.assigned_to).filter(Boolean))];
  if (told) {
    const project = await db('projects').where({ id: update.project_id }).first('name');
    await inform(db, 'avancement.publie', {
      direct: commercials, except: user?.id, key: `avancement:${update.id}`, title: `Point d’avancement publié : ${project?.name || 'chantier'} — ${update.title}`,
      body: `${told} client(s) prévenu(s) dans leur espace.`, link: '/commercial/ventes',
    });
  }
  return told;
}

/** Document rendu visible dans l'espace client : le client en est prévenu (une fois par fichier). */
async function announceDocument(db, doc, user) {
  if (!doc.visible_client || !doc.media_id) return false;
  if (!(await sentOnce(db, `document:${doc.id}:${doc.media_id}:client`))) return false;
  const sale = await db('sales').where({ id: doc.sale_id }).first('id', 'lead_id');
  if (!sale) return false;
  await require('./clients').tellClient(db, sale, `Un nouveau document est disponible dans votre espace client : « ${doc.label} ». Retrouvez-le dans « Documents ».`, user?.id || null);
  return true;
}

// ─── Dossier de vente ─────────────────────────────────────────────────────

/** Échéancier recalculé ou modifié : le commercial du client est prévenu et le client informé dans son espace (une fois par jour). */
async function announceSchedule(db, sale, user) {
  const s = await db('sales as s').join('leads as c', 'c.id', 's.lead_id').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id')
    .where('s.id', sale.id).first('c.name', 'c.assigned_to', 'p.name as project_name', 'l.code as lot_code', 's.lead_id');
  if (!s) return 0;
  const day = today();
  const n = await inform(db, 'echeancier.modifie', {
    direct: s.assigned_to ? [s.assigned_to] : [], except: user.id, key: `echeancier:${sale.id}:${day}`,
    title: `Échéancier modifié : ${s.name} — lot ${s.lot_code}`, body: `${s.project_name} · par ${user.name}`, link: '/commercial/ventes',
  });
  if (await sentOnce(db, `echeancier:${sale.id}:${day}:client`)) {
    await require('./clients').tellClient(db, { leadId: s.lead_id, saleId: sale.id }, `Votre échéancier de paiement du lot ${s.lot_code} a été mis à jour. Consultez-le dans « Paiements ».`, user.id);
  }
  return n;
}

/** Versement enregistré ou confirmé : le client reçoit la confirmation dans son espace (reçu disponible dans « Paiements »). */
async function announcePayment(db, sale, payment, user) {
  const { totals } = require('./sales');
  const t = await totals(db, sale);
  const paid = new Date(payment.paid_at);
  await require('./clients').tellClient(db, sale, `Nous avons bien enregistré votre versement de ${money(payment.amount_fcfa)} du ${fr(paid.toISOString())}. Votre reçu est disponible dans « Paiements ».${t.remaining_fcfa ? ` Reste à payer : ${money(t.remaining_fcfa)}.` : ' Votre dossier est soldé : merci.'}`, user.id);
}

const DEED_TEXT = {
  reservation: { commercial: 'Contrat de réservation signé', client: 'Votre contrat de réservation est signé.' },
  pieces: { commercial: 'Pièces du client complètes', client: 'Votre dossier est complet : toutes vos pièces ont été reçues.' },
  notaire: { commercial: 'Dossier transmis au notaire', client: 'Votre dossier a été transmis au notaire.' },
  projet: { commercial: 'Projet d’acte reçu', client: 'Le projet d’acte est reçu : la date de signature va vous être proposée.' },
  remise: { commercial: 'Expédition de l’acte remise au client', client: 'L’expédition de votre acte de vente vous a été remise.' },
};

/** Étape intermédiaire de l'acte datée au Juridique : le commercial du client est prévenu, le client informé dans son espace. */
async function announceDeedStep(db, saleId, key, date, user) {
  const text = DEED_TEXT[key];
  if (!text || !date) return 0;
  const s = await db('sales as s').join('leads as c', 'c.id', 's.lead_id').join('lots as l', 'l.id', 's.lot_id').join('projects as p', 'p.id', 'l.project_id')
    .where('s.id', saleId).first('c.name', 'c.assigned_to', 'p.name as project_name', 'l.code as lot_code', 's.lead_id');
  if (!s) return 0;
  const n = await inform(db, 'acte.etape', {
    direct: s.assigned_to ? [s.assigned_to] : [], except: user.id, key: `acte:${saleId}:etape:${key}:${date}`,
    title: `${text.commercial} : ${s.name} — lot ${s.lot_code}`, body: `${s.project_name} · le ${fr(date)}`, link: '/commercial/ventes',
  });
  if (await sentOnce(db, `acte:${saleId}:etape:${key}:${date}:client`)) await require('./clients').tellClient(db, { leadId: s.lead_id, saleId }, `${text.client} (${fr(date)})`, user.id);
  return n;
}

// ─── Tâche horaire commerciale ────────────────────────────────────────────

/**
 * Chaque heure, sans doublon : options qui expirent demain (commercial et prospect), activités échues et rendez-vous du lendemain
 * (un récapitulatif par commercial et par jour).
 */
async function tick(db, now = new Date()) {
  const stats = { options: 0, activities: 0, appointments: 0 };
  const day = isoDay(now);
  // Options qui expirent dans les 24 heures
  const soon = await db('lot_options').where({ state: 'active' }).where('expires_at', '>', now).where('expires_at', '<=', new Date(now.getTime() + 24 * 3600 * 1000)).select('id');
  for (const o of soon) if (await announceOption(db, o.id, 'proche')) stats.options++;

  // Activités échues : un récapitulatif par commercial et par jour
  const late = await db('lead_activities as a').join('leads as ld', 'ld.id', 'a.lead_id').whereNull('a.done_at').whereNotNull('a.assigned_to').whereNot('ld.stage', 'perdu')
    .where('a.due_at', '<', new Date(`${day}T00:00:00`)).whereNot('a.kind', 'note').select('a.assigned_to', 'a.summary', 'ld.name');
  const byUser = {};
  for (const a of late) (byUser[a.assigned_to] ||= []).push(a);
  for (const [uid, list] of Object.entries(byUser)) {
    stats.activities += await inform(db, 'activite.echue', {
      direct: [Number(uid)], key: `activites-echues:${uid}:${day}`, title: `${list.length} activité(s) en retard`,
      body: list.slice(0, 4).map(a => `${a.summary || 'Activité'} — ${a.name}`).join(' · ') + (list.length > 4 ? '…' : ''), link: '/commercial/activites',
    });
  }

  // Rendez-vous du lendemain
  const tomorrow = isoDay(new Date(now.getTime() + 86400000));
  const appts = (await db('appointments as a').join('leads as ld', 'ld.id', 'a.lead_id').whereIn('a.status', ['demande', 'confirme'])
    .where('a.starts_at', '>=', new Date(`${tomorrow}T00:00:00`)).where('a.starts_at', '<', new Date(new Date(`${tomorrow}T00:00:00`).getTime() + 86400000))
    .select('a.id', 'a.kind', 'a.starts_at', 'a.assigned_to', 'ld.assigned_to as lead_owner', 'ld.name'));
  const mine = {};
  for (const a of appts) { const uid = a.assigned_to || a.lead_owner; if (uid) (mine[uid] ||= []).push(a); }
  for (const [uid, list] of Object.entries(mine)) {
    stats.appointments += await inform(db, 'rdv.demain', {
      direct: [Number(uid)], key: `rdv-demain:${uid}:${tomorrow}`, title: `${list.length} rendez-vous demain`,
      body: list.slice(0, 4).map(a => `${new Date(a.starts_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Abidjan' })} ${a.name}`).join(' · '), link: '/commercial/rendez-vous',
    });
  }
  return stats;
}

module.exports = {
  leadLink, sentOnce, mailPerson, announceInbound, acknowledge, announceAssigned, announceImportedPayments, announceTask, confirmAppointment, announceOption,
  announceDesistement, announceLotWithoutSale, announceClientMessage, announceProgress, announceDocument, announceSchedule, announcePayment,
  announceDeedStep, tick,
};
