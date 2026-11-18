/**
 * Suppression définitive d'un dossier de vente (dossier de test ou ouvert par erreur ; demande du client du 18/11).
 * Réservée au super administrateur. Le désistement reste la voie normale : ici, le dossier disparaît de la base.
 *
 * Règles :
 *  - plus aucun versement sur le dossier (on les supprime d'abord, dossier de vente › poubelle) ;
 *  - comptabilité : une écriture validée ne s'efface jamais (SYSCOHADA). Chaque écriture validée du dossier doit être
 *    annulée par une contrepassation validée ; une contrepassation encore en brouillon se valide d'abord. Les brouillons
 *    sans contrepartie validée sont effacés avec le dossier. Les paires annulées restent dans les journaux.
 *  - le lot redevient disponible (historique du lot : motif « dossier supprimé ») ;
 *  - le client est supprimé aussi s'il n'a aucun autre dossier ni option en cours (choix « avec le client »).
 */
const { HttpError } = require('../lib/http');

/** Écritures du dossier : opérations synchronisées (vente, appels de fonds, TMA, versements) et lignes du client sur ce lot. */
async function saleEntries(db, sale) {
  const [calls, tmas, pays] = await Promise.all([
    db('fund_calls').where({ sale_id: sale.id }).pluck('id').catch(() => []),
    db('worksite_changes').where({ sale_id: sale.id }).pluck('id').catch(() => []),
    db('payments').where({ sale_id: sale.id }).pluck('id'),
  ]);
  const keys = [`sale_revenue:${sale.id}`, ...calls.map(id => `fund_call:${id}`), ...tmas.map(id => `tma:${id}`), ...pays.map(id => `payment:${id}`)];
  const byKey = await db('acc_entries').whereIn('source_key', keys).pluck('id');
  const byLines = await db('acc_lines').where({ partner_type: 'client', partner_id: sale.lead_id, lot_id: sale.lot_id }).distinct('entry_id').pluck('entry_id');
  const ids = [...new Set([...byKey, ...byLines])];
  const base = ids.length ? await db('acc_entries').whereIn('id', ids) : [];
  // Contrepassations de ces écritures, et écritures d'origine des contrepassations
  const reversals = base.length ? await db('acc_entries').whereIn('reversal_of', base.map(e => e.id)) : [];
  const originals = base.filter(e => e.reversal_of).length ? await db('acc_entries').whereIn('id', base.filter(e => e.reversal_of).map(e => e.reversal_of)) : [];
  const all = new Map([...base, ...reversals, ...originals].map(e => [e.id, e]));
  return [...all.values()];
}

/** Ce que la suppression ferait, ou ce qui l'empêche. */
async function preview(db, saleId) {
  const sale = await db('sales as s').join('leads as l', 'l.id', 's.lead_id').join('lots as lt', 'lt.id', 's.lot_id').leftJoin('projects as p', 'p.id', 'lt.project_id')
    .where('s.id', saleId).first('s.*', 'l.name as client_name', 'l.client_code', 'lt.code as lot_code', 'lt.status as lot_status', 'p.name as project_name');
  if (!sale) throw new HttpError(404, 'Dossier introuvable.');
  const blockers = [];
  const payments = Number((await db('payments').where({ sale_id: sale.id }).count({ n: '*' }))[0].n);
  if (payments) blockers.push(`${payments} versement(s) encore enregistré(s) : supprimez-les d’abord (dossier de vente › poubelle), puis « Synchroniser » en Comptabilité et validez les contrepassations.`);

  const entries = await saleEntries(db, sale);
  const byId = new Map(entries.map(e => [e.id, e]));
  const reversalOf = new Map(entries.filter(e => e.reversal_of).map(e => [e.reversal_of, e]));
  const toDelete = [];
  for (const e of entries) {
    const label = e.number || `brouillon n° ${e.id}`;
    if (e.status === 'valide') {
      if (e.reversal_of) { if (byId.get(e.reversal_of)?.status !== 'valide') blockers.push(`L’écriture ${label} contrepasse une écriture encore en brouillon.`); continue; }
      const rev = reversalOf.get(e.id);
      if (!rev) blockers.push(`Écriture validée ${label} (${e.label}) : contrepassez-la (Comptabilité › Écritures).`);
      else if (rev.status !== 'valide') blockers.push(`La contrepassation de ${label} est en brouillon : validez-la (Comptabilité › Écritures).`);
    } else if (e.reversal_of && byId.get(e.reversal_of)?.status === 'valide') {
      blockers.push(`La contrepassation de ${byId.get(e.reversal_of).number} est en brouillon : validez-la (Comptabilité › Écritures).`);
    } else {
      toDelete.push(e.id);
    }
  }
  const otherSales = Number((await db('sales').where({ lead_id: sale.lead_id }).whereNot({ id: sale.id }).count({ n: '*' }))[0].n);
  const activeOption = await db('lot_options').where({ lead_id: sale.lead_id, state: 'active' }).first('id');
  const kept = entries.filter(e => !toDelete.includes(e.id)).length;
  return {
    sale: { id: sale.id, client_name: sale.client_name, client_code: sale.client_code, lot_code: sale.lot_code, project_name: sale.project_name, status: sale.status },
    blockers: [...new Set(blockers)], drafts_to_delete: toDelete, cancelled_entries_kept: kept,
    lot: { code: sale.lot_code, status: sale.lot_status, freed: ['reserve', 'vendu', 'option'].includes(sale.lot_status) },
    client: { can_delete: !otherSales && !activeOption, other_sales: otherSales, active_option: !!activeOption },
  };
}

/** Suppression définitive (super administrateur). `withClient` : supprimer aussi le client s'il n'a pas d'autre dossier. */
async function deleteForGood(db, saleId, { withClient = true, user }) {
  if (user.role !== 'super_admin') throw new HttpError(403, 'Seul le super administrateur peut supprimer définitivement un dossier de vente.');
  const p = await preview(db, saleId);
  if (p.blockers.length) throw new HttpError(409, `Suppression impossible : ${p.blockers.join(' ')}`);
  const sale = await db('sales').where({ id: saleId }).first();
  const lead = await db('leads').where({ id: sale.lead_id }).first();
  let clientDeleted = false;
  await db.transaction(async trx => {
    if (p.drafts_to_delete.length) await trx('acc_entries').whereIn('id', p.drafts_to_delete).del();
    // Tables reliées au dossier sans clé étrangère
    for (const table of ['lot_handovers', 'worksite_changes']) {
      if (await trx.schema.hasTable(table)) await trx(table).where({ sale_id: sale.id }).del();
    }
    if (await trx.schema.hasColumn('guarantees', 'sale_id')) await trx('guarantees').where({ sale_id: sale.id }).update({ sale_id: null });
    await trx('sales').where({ id: sale.id }).del();
    // Lot remis en vente s'il ne porte plus d'autre dossier actif
    const lot = await trx('lots').where({ id: sale.lot_id }).first();
    const stillSold = await trx('sales').where({ lot_id: lot.id }).whereIn('status', ['en_cours', 'solde']).first('id');
    if (lot && !stillSold && ['reserve', 'vendu', 'desistement'].includes(lot.status)) {
      await require('./lots').writeStatus(trx, lot, 'disponible', { userId: user.id, reason: `Dossier de vente n° ${sale.id} (${lead.name}) supprimé définitivement` });
    }
    if (withClient && p.client.can_delete) {
      for (const table of ['lead_import_items', 'lead_portfolio_events']) {
        if (await trx.schema.hasTable(table)) await trx(table).where({ lead_id: lead.id }).del();
      }
      for (const table of ['sita_conversations', 'meta_events']) {
        if ((await trx.schema.hasTable(table)) && (await trx.schema.hasColumn(table, 'lead_id'))) await trx(table).where({ lead_id: lead.id }).update({ lead_id: null });
      }
      await trx('leads').where({ id: lead.id }).del();
      clientDeleted = true;
    }
  });
  console.log(`[ventes] dossier ${sale.id} (${lead.name}, lot ${p.lot.code}) supprimé définitivement par l’utilisateur ${user.id}${clientDeleted ? ', client supprimé' : ''}`);
  return { ok: true, sale_id: sale.id, client_deleted: clientDeleted, drafts_deleted: p.drafts_to_delete.length, lot: p.lot.code };
}

module.exports = { preview, deleteForGood };
