const { HttpError } = require('../lib/http');
const { checkLotTransition, SELLABLE_STATUSES } = require('../lib/domain');
const { optionDaysDefault } = require('../config');

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizePhone = p => (p ? String(p).replace(/[^\d+]/g, '') : null);
const normalizeEmail = e => (e ? String(e).trim().toLowerCase() : null);

/**
 * Retrouve un prospect par e-mail ou téléphone (hors prospects perdus), sinon le crée.
 * Les infos manquantes du prospect existant sont complétées.
 */
async function findOrCreateLead(trx, data) {
  const email = normalizeEmail(data.email);
  const phone = normalizePhone(data.phone);
  if (!email && !phone) throw new HttpError(400, 'Un e-mail ou un téléphone est requis.');

  const existing = await trx('leads')
    .whereNot('stage', 'perdu')
    .andWhere(q => {
      if (email) q.orWhere('email', email);
      if (phone) q.orWhere('phone', phone);
    })
    .orderBy('id', 'desc')
    .first();

  if (existing) {
    const patch = {};
    if (!existing.email && email) patch.email = email;
    if (!existing.phone && phone) patch.phone = phone;
    if (!existing.project_id && data.project_id) patch.project_id = data.project_id;
    if (!existing.lot_id && data.lot_id) patch.lot_id = data.lot_id;
    if (data.message) patch.message = [existing.message, data.message].filter(Boolean).join('\n---\n');
    if (Object.keys(patch).length) {
      await trx('leads').where({ id: existing.id }).update({ ...patch, updated_at: new Date() });
    }
    return { ...existing, ...patch };
  }

  const row = {
    name: data.name,
    email,
    phone,
    country: data.country || null,
    is_diaspora: !!data.is_diaspora,
    source: data.source || 'site',
    financing: data.financing || null,
    project_id: data.project_id || null,
    lot_id: data.lot_id || null,
    message: data.message || null,
  };
  const [id] = await trx('leads').insert(row);
  return { id: typeof id === 'object' ? id.id : id, ...row, stage: 'prospection', created: true };
}

/** Enregistre un changement de statut (déjà vérifié) et son historique. */
async function writeStatus(trx, lot, to, { userId = null, leadId = null, reason = null } = {}) {
  await trx('lots').where({ id: lot.id }).update({ status: to, updated_at: new Date() });
  await trx('lot_status_history').insert({
    lot_id: lot.id, from_status: lot.status, to_status: to, user_id: userId, lead_id: leadId, reason,
  });
}

/**
 * Changement de statut depuis le dashboard, selon les transitions autorisées.
 * Quitter « option » clôt l'option active (confirmée si on réserve, annulée sinon).
 */
async function changeLotStatus(db, { lotId, to, user, leadId = null, reason = null }) {
  return db.transaction(async trx => {
    const lot = await trx('lots').where({ id: lotId }).first();
    if (!lot) throw new HttpError(404, 'Lot introuvable.');
    const refusal = checkLotTransition(lot.status, to, user.role);
    if (refusal) throw new HttpError(409, refusal);

    let lead = leadId;
    if (lot.status === 'option') {
      const opt = await trx('lot_options').where({ lot_id: lot.id, state: 'active' }).first();
      if (opt) {
        await trx('lot_options').where({ id: opt.id })
          .update({ state: to === 'reserve' ? 'confirmee' : 'annulee', updated_at: new Date() });
        lead = lead || opt.lead_id;
      }
    }
    // Désistement ou annulation d'une réservation : le dossier d'acquisition actif est clos
    if (['reserve', 'vendu'].includes(lot.status) && ['desistement', 'disponible'].includes(to)) {
      await trx('sales').where({ lot_id: lot.id }).whereIn('status', ['en_cours', 'solde']).update({ status: 'desiste', updated_at: new Date() });
    }
    await writeStatus(trx, lot, to, { userId: user.id, leadId: lead, reason });
    return trx('lots').where({ id: lot.id }).first();
  });
}

/**
 * Pose une option (pré-réservation) sur un lot pour un prospect.
 * Règles : lot commercialisable, pas d'option active sur ce lot, une seule option active par prospect.
 */
async function placeOption(db, { lotId, leadData, userId = null }) {
  return db.transaction(async trx => {
    const lot = await trx('lots').where({ id: lotId }).first();
    if (!lot) throw new HttpError(404, 'Lot introuvable.');
    if (!SELLABLE_STATUSES.includes(lot.status)) {
      throw new HttpError(409, "Ce lot n'est plus disponible à la pré-réservation.");
    }
    const lead = await findOrCreateLead(trx, { ...leadData, project_id: lot.project_id, lot_id: lot.id });

    const active = await trx('lot_options')
      .where({ lead_id: lead.id, state: 'active' })
      .andWhere('expires_at', '>', new Date())
      .first();
    if (active) {
      throw new HttpError(409, 'Vous avez déjà une pré-réservation en cours. Un conseiller vous contactera pour la finaliser.');
    }

    const project = await trx('projects').where({ id: lot.project_id }).first();
    const days = (project && project.option_days) || optionDaysDefault;
    const expiresAt = new Date(Date.now() + days * DAY_MS);

    const [optId] = await trx('lot_options').insert({
      lot_id: lot.id, lead_id: lead.id, state: 'active', expires_at: expiresAt, created_by: userId,
    });
    await writeStatus(trx, lot, 'option', { userId, leadId: lead.id, reason: `Option de ${days} jours` });
    return { option_id: typeof optId === 'object' ? optId.id : optId, lead, lot_id: lot.id, expires_at: expiresAt, days };
  });
}

/**
 * Libère les options échues : l'option passe « expirée » et le lot retrouve
 * le statut qu'il avait avant l'option (disponible ou désistement).
 */
async function expireOptions(db, now = new Date()) {
  const due = await db('lot_options').where({ state: 'active' }).andWhere('expires_at', '<=', now);
  for (const opt of due) {
    await db.transaction(async trx => {
      await trx('lot_options').where({ id: opt.id, state: 'active' }).update({ state: 'expiree', updated_at: now });
      const lot = await trx('lots').where({ id: opt.lot_id }).first();
      if (!lot || lot.status !== 'option') return;
      const before = await trx('lot_status_history')
        .where({ lot_id: lot.id, to_status: 'option' })
        .orderBy('id', 'desc')
        .first();
      const back = before && SELLABLE_STATUSES.includes(before.from_status) ? before.from_status : 'disponible';
      await writeStatus(trx, lot, back, { leadId: opt.lead_id, reason: 'Option expirée' });
    });
  }
  return due.length;
}

/** Appelle expireOptions au plus une fois par minute (avant chaque lecture des lots). */
function throttledExpiry(db, intervalMs = 60 * 1000) {
  let last = 0;
  return async () => {
    if (Date.now() - last < intervalMs) return;
    last = Date.now();
    await expireOptions(db);
  };
}

module.exports = {
  findOrCreateLead, changeLotStatus, placeOption, expireOptions, throttledExpiry,
  normalizePhone, normalizeEmail,
};
