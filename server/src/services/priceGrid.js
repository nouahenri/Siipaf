/**
 * Prix des lots tiré de la grille de prix du projet : la surface exacte du lot désigne la ligne de la grille
 * (même type de bien si le lot en a un). Ne touche que les lots libres, sans dossier de vente, dont le
 * prix est vide ou suit déjà la grille ; un prix saisi à la main n'est jamais écrasé. Un lot qui suivait
 * la grille et dont la surface n'y figure plus perd ce prix.
 */
const { gridOfferFor, GRID_PRICED_STATUSES } = require('../lib/domain');

const projectOffers = (trx, projectId) => trx('project_offers').where({ project_id: projectId }).orderBy('sort');

/**
 * Prix envoyé par un formulaire ou un import : vide → la grille décidera ; égal au prix de la grille
 * pour cette surface → le lot suit la grille ; autre montant → prix saisi à la main.
 */
function followsGrid(offers, { price_fcfa, surface_m2, offer_id }) {
  if (price_fcfa == null) return true;
  const hit = gridOfferFor(offers, surface_m2, offer_id);
  return Boolean(hit && Number(hit.price_fcfa) === Number(price_fcfa));
}

/** Applique la grille aux lots du projet (tous, ou ceux de lotIds). Renvoie le nombre de lots mis à jour. */
async function applyPriceGrid(trx, projectId, lotIds = null) {
  if (lotIds && !lotIds.length) return 0;
  const offers = await projectOffers(trx, projectId);
  const lots = await trx('lots').where({ project_id: projectId }).whereIn('status', GRID_PRICED_STATUSES)
    .where(q => q.whereNull('price_fcfa').orWhere({ price_from_grid: true }))
    .whereNotExists(function () { this.select(1).from('sales').whereRaw('sales.lot_id = lots.id').whereIn('sales.status', ['en_cours', 'solde']); })
    .modify(q => { if (lotIds) q.whereIn('id', lotIds); })
    .select('id', 'surface_m2', 'price_fcfa', 'offer_id', 'price_from_grid');
  let updated = 0;
  for (const l of lots) {
    const hit = gridOfferFor(offers, l.surface_m2, l.offer_id);
    if (!hit) {
      // Plus de ligne pour cette surface : le prix tiré de la grille ne vaut plus, il est retiré
      if (l.price_from_grid && l.price_fcfa != null) {
        await trx('lots').where({ id: l.id }).update({ price_fcfa: null, offer_id: null, updated_at: new Date() });
        updated++;
      }
      continue;
    }
    if (Number(l.price_fcfa) === Number(hit.price_fcfa) && l.offer_id === hit.id && l.price_from_grid) continue;
    await trx('lots').where({ id: l.id }).update({ price_fcfa: hit.price_fcfa, offer_id: hit.id, price_from_grid: true, updated_at: new Date() });
    updated++;
  }
  return updated;
}

module.exports = { projectOffers, followsGrid, applyPriceGrid };
