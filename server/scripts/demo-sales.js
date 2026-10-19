/** Ajoute des dossiers d'acquisition fictifs aux lots réservés/vendus de la base de DÉMONSTRATION. */
if (!/demo/.test(process.env.DB_FILENAME || '') || process.env.DB_CLIENT === 'mysql') {
  console.error('Base de démonstration uniquement (DB_FILENAME contenant « demo »).');
  process.exit(1);
}
const { getDb } = require('../src/db');
const { openSale, refreshSaleStatus } = require('../src/services/sales');

(async () => {
  const db = getDb();
  const user = await db('users').first();
  const buyers = ['Kouamé A.', 'Bamba S.', 'N’Goran E.', 'Traoré M.', 'Yao K.', 'Diallo F.', 'Konan P.', 'Assi R.'];
  const lots = await db('lots').whereIn('status', ['reserve', 'vendu']).whereNotExists(db('sales').whereRaw('sales.lot_id = lots.id'));
  for (const [i, lot] of lots.entries()) {
    const sale = await openSale(db, { lotId: lot.id, leadData: { name: buyers[i % buyers.length], phone: `05${String(40000000 + i * 1111).padStart(8, '0')}` }, financing: ['apport', 'diaspora', 'credit'][i % 3], user });
    const ratio = lot.status === 'vendu' ? [1, 0.8, 0.65][i % 3] : [0.3, 0.15, 0.45][i % 3];
    const total = Math.round(Number(sale.price_fcfa) * ratio);
    const parts = 3;
    for (let k = 0; k < parts; k++) {
      await db('payments').insert({ sale_id: sale.id, amount_fcfa: k < parts - 1 ? Math.round(total / parts) : total - 2 * Math.round(total / parts), paid_at: new Date(Date.now() - (parts - k) * 30 * 86400000), method: ['virement', 'mobile_money', 'especes'][k], reference: `REF-${sale.id}-${k + 1}`, recorded_by: user.id });
    }
    await db.transaction(trx => refreshSaleStatus(trx, sale.id));
    if (lot.status === 'vendu') {
      await db('sale_documents').where({ sale_id: sale.id, type: 'contrat_reservation' }).update({ status: 'signe' });
      await db('sale_documents').where({ sale_id: sale.id, type: 'attestation_attribution' }).update({ status: 'delivre' });
      await db('sale_documents').where({ sale_id: sale.id, type: 'contrat_vente' }).update({ status: 'signe' });
      await db('sale_documents').where({ sale_id: sale.id, type: 'acd' }).update({ status: 'en_cours', note: 'Dossier déposé au MCLU' });
    }
  }
  console.log(`${lots.length} dossiers de démonstration créés.`);
  await db.destroy();
})();
