/**
 * Dossiers d'acquisition : ouverture (le lot passe « réservé »), versements, solde,
 * documents. Un seul dossier actif (en cours ou soldé) par lot.
 */
const { HttpError } = require('../lib/http');
const { DEFAULT_DOCUMENTS, paymentTerms } = require('../lib/domain');
const { getSettings } = require('./settings');
const { findOrCreateLead } = require('./lots');

const ACTIVE = ['en_cours', 'solde'];
const EARLY_STAGES = ['prospection', 'visite', 'decision', 'choix_bien'];

/** Code client lisible, unique : SIIPAF-2026-0001. */
async function nextClientCode(trx) {
  const year = new Date().getFullYear();
  const prefix = `SIIPAF-${year}-`;
  const last = await trx('leads').where('client_code', 'like', `${prefix}%`).orderBy('client_code', 'desc').first();
  const n = last ? Number(last.client_code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

async function totals(db, sale) {
  const [{ paid }] = await db('payments').where({ sale_id: sale.id }).sum({ paid: 'amount_fcfa' });
  const paidN = Number(paid) || 0;
  // Dû = prix convenu + travaux modificatifs (TMA) acceptés par l'acquéreur (ERP › Chantiers)
  const extras = await require('./chantiersLivraison').extrasFor(db, sale.id);
  const due = Number(sale.price_fcfa) + extras;
  return {
    paid_fcfa: paidN,
    remaining_fcfa: Math.max(0, due - paidN),
    percent_paid: due ? Math.min(100, Math.round((paidN / due) * 1000) / 10) : 0,
    extras_fcfa: extras, total_due_fcfa: due,
  };
}

/** Recalcule le statut « soldé » après chaque mouvement de paiement. */
async function refreshSaleStatus(trx, saleId) {
  const sale = await trx('sales').where({ id: saleId }).first();
  if (!sale || sale.status === 'desiste') return sale;
  const t = await totals(trx, sale);
  const status = t.paid_fcfa >= t.total_due_fcfa ? 'solde' : 'en_cours';
  if (status !== sale.status) await trx('sales').where({ id: saleId }).update({ status, updated_at: new Date() });
  return { ...sale, status };
}

/**
 * Ouvre le dossier d'acquisition d'un lot pour un acquéreur.
 * Un lot disponible, en désistement ou en option passe « réservé » (l'option est confirmée).
 */
/**
 * `projectTerms` : le dossier fige l'acompte et le délai de solde du projet (formule Diaspora) ; faux pour un
 * dossier repris de l'ancienne plateforme, qui garde la formule d'origine.
 */
/** La VEFA (appels de fonds à l'avancement) concerne les bâtiments : refusée sur un lotissement (choix du client du 30/10). */
async function assertVefaAllowed(db, projectId) {
  const p = await db('projects').where({ id: projectId }).first('category');
  if (p?.category === 'lotissement') throw new HttpError(400, 'Un lotissement ne se vend pas en VEFA : choisissez un financement (comptant, apport, mensualités).');
}

async function openSale(db, { lotId, leadId, leadData, price_fcfa, financing, notes, reserved_at, signed_at, vefa = false, user, projectTerms = true }) {
  return db.transaction(async trx => {
    const lot = await trx('lots').where({ id: lotId }).first();
    if (!lot) throw new HttpError(404, 'Lot introuvable.');
    if (lot.status === 'bloque') throw new HttpError(409, 'Ce lot n’est pas commercialisé.');
    if (vefa) await assertVefaAllowed(trx, lot.project_id);
    if (await trx('sales').where({ lot_id: lot.id }).whereIn('status', ACTIVE).first()) {
      throw new HttpError(409, 'Ce lot a déjà un dossier d’acquisition actif.');
    }

    let lead;
    if (leadId) {
      lead = await trx('leads').where({ id: leadId }).first();
      if (!lead) throw new HttpError(404, 'Prospect introuvable.');
    } else {
      lead = await findOrCreateLead(trx, { ...leadData, project_id: lot.project_id, lot_id: lot.id, source: 'admin', created_by: user.id });
      // Personne déjà suivie par un collègue : dossier refusé sans divulguer sa fiche (le responsable la transfère)
      const all = (user.permissions || []).some(p => p === '*' || p === 'leads:all');
      if (!lead.created && lead.assigned_to && lead.assigned_to !== user.id && !all) {
        throw new HttpError(409, 'Cette personne est déjà suivie par un autre commercial. Pour la reprendre, demandez son transfert au responsable.', { lead_id: lead.id, transfer: true });
      }
      if (lead.created && !all) {
        await trx('leads').where({ id: lead.id }).update({ assigned_to: user.id });
        await require('./commercial').traceAssignment(trx, lead.id, user.id, { by: user.id, why: 'dossier ouvert' });
      }
    }

    // Le lot passe « réservé »
    if (['disponible', 'desistement', 'option'].includes(lot.status)) {
      if (lot.status === 'option') {
        await trx('lot_options').where({ lot_id: lot.id, state: 'active' }).update({ state: 'confirmee', updated_at: new Date() });
      }
      await trx('lots').where({ id: lot.id }).update({ status: 'reserve', updated_at: new Date() });
      await trx('lot_status_history').insert({ lot_id: lot.id, from_status: lot.status, to_status: 'reserve', user_id: user.id, lead_id: lead.id, reason: 'Ouverture du dossier d’acquisition' });
    }

    const price = price_fcfa ?? lot.price_fcfa;
    if (price == null) throw new HttpError(400, 'Indiquez le prix convenu.');
    let terms = {};
    if (projectTerms) {
      const t = paymentTerms(await trx('projects').where({ id: lot.project_id }).first() || {}, await getSettings(trx));
      terms = { terms_deposit_fcfa: t.deposit_fcfa, terms_months: t.balance_months };
    }
    const [saleId] = await trx('sales').insert({
      ...terms,
      lot_id: lot.id, lead_id: lead.id, price_fcfa: price, financing: financing || lead.financing || null,
      notes: notes || null, reserved_at: reserved_at || new Date(), signed_at: signed_at || null, vefa: !!vefa, created_by: user.id,
    });
    await trx('sale_documents').insert(DEFAULT_DOCUMENTS.map(([type, label, status], sort) => ({
      sale_id: saleId, type, label, status, sort, updated_by: user.id,
    })));

    // Échéancier type selon le financement (modifiable ensuite par le comptable), ou appels de fonds VEFA
    const sale = await trx('sales').where({ id: saleId }).first();
    await require('./schedule').regenerateSchedule(trx, sale, { userId: user.id });

    const leadPatch = { lot_id: lot.id, project_id: lot.project_id, updated_at: new Date() };
    if (!lead.client_code) leadPatch.client_code = await nextClientCode(trx);
    if (EARLY_STAGES.includes(lead.stage)) leadPatch.stage = 'paiement';
    await trx('leads').where({ id: lead.id }).update(leadPatch);
    await require('./portfolio').syncLead(trx, lead.id, { by: user.id });
    return trx('sales').where({ id: saleId }).first();
  });
}

module.exports = { assertVefaAllowed, openSale, refreshSaleStatus, totals, nextClientCode, ACTIVE, EARLY_STAGES };
