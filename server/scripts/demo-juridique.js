/**
 * Données de démonstration du Juridique (base de démo locale uniquement).
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-juridique.js
 * Notaire, ventes à différentes étapes jusqu'à l'acte, litiges, cautions et retenue de garantie ; les alertes sont
 * calculées une fois sans SMTP (cloche seule) pour que la démo n'envoie aucun e-mail ensuite.
 */
process.env.SMTP_HOST = ''; // avant la configuration : aucun e-mail réel depuis ce script
const { createDb } = require('../src/db');

const DAY = 24 * 3600 * 1000;
const ymd = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const idOf = r => (typeof r === 'object' ? r.id : r);

(async () => {
  const db = createDb();
  if (process.env.NODE_ENV === 'production') throw new Error('Script réservé à la base de démo.');
  if ((await db('litigations').count({ n: '*' }))[0].n > 0) { console.log('Juridique déjà peuplé.'); return db.destroy(); }
  const admin = await db('users').orderBy('id').first();
  const year = new Date().getUTCFullYear();

  // Notaire : fiche fournisseur de catégorie « Notaire »
  let notary = await db('suppliers').where('name', 'like', '%notaire%').first();
  if (notary) await db('suppliers').where({ id: notary.id }).update({ kind: 'notaire' });
  else notary = { id: idOf((await db('suppliers').insert({ name: 'Étude Maître Yao, notaire', kind: 'notaire' }))[0]) };
  const notary2 = idOf((await db('suppliers').insert({ name: 'Étude Maître Koffi-Ahoua, notaire', kind: 'notaire' }))[0]);

  // Ventes en cours à différentes étapes (dates posées directement : aucune annonce)
  const sales = await db('sales').whereIn('status', ['en_cours', 'solde']).whereNull('signed_at').orderBy('id').limit(8).select('id');
  const plans = [
    { reservation_on: ymd(-60) },
    { reservation_on: ymd(-75), pieces_on: ymd(-50) },
    { reservation_on: ymd(-90), pieces_on: ymd(-70), notaire_on: ymd(-40), notary_supplier_id: notary.id, notary_ref: `${year}/112` },
    { reservation_on: ymd(-120), pieces_on: ymd(-95), notaire_on: ymd(-60), notary_supplier_id: notary2, notary_ref: `${year}/087`, projet_on: ymd(-12) },
    { reservation_on: ymd(-30) },
  ];
  for (const [i, p] of plans.entries()) if (sales[i]) await db('legal_sale_files').insert({ sale_id: sales[i].id, updated_by: admin.id, ...p });
  // Une vente déjà signée chez le notaire, expédition à remettre
  const signed = await db('sales').whereNotNull('signed_at').whereIn('status', ['en_cours', 'solde']).orderBy('id').first('id');
  if (signed) {
    await db('legal_sale_files').insert({ sale_id: signed.id, updated_by: admin.id, reservation_on: '2026-03-10', pieces_on: '2026-04-02', notaire_on: '2026-04-20', notary_supplier_id: notary.id, notary_ref: `${year}/041`, projet_on: '2026-05-25', deed_number: `${year}-0318` });
  }

  // Litiges
  const vrd = await db('suppliers').where({ name: 'Réseaux VRD Services' }).first('id');
  const ticket = await db('sav_tickets').orderBy('id').first('id', 'title');
  const late = (await require('../src/services/juridique').unpaid(db)).items.find(u => u.transmitted);
  const lit = async (row, events) => {
    const n = (await db('litigations').count({ n: '*' }))[0].n + 1;
    const id = idOf((await db('litigations').insert({ reference: `LIT-${year}-${String(n).padStart(4, '0')}`, created_by: admin.id, ...row }))[0]);
    for (const e of events) await db('litigation_events').insert({ litigation_id: id, created_by: admin.id, ...e });
  };
  await lit({ origin: 'sous_traitant', title: 'Malfaçons sur la voirie de l’îlot 3', opponent: 'Réseaux VRD Services', supplier_id: vrd?.id || null, amount_fcfa: 18500000, stage: 'mise_en_demeure', department: 'juridique', owner_id: admin.id, lawyer: 'Me Bamba, huissier', opened_on: ymd(-35), next_date: ymd(4), next_label: 'Fin du délai de la mise en demeure' },
    [{ stage: 'amiable', date: ymd(-35), note: 'Ouverture du dossier : constat des fissures sur 120 m de voirie' }, { stage: 'mise_en_demeure', date: ymd(-11), note: 'Mise en demeure de reprendre les travaux sous 15 jours, signifiée par huissier' }]);
  if (late) {
    await lit({ origin: 'impaye', title: 'Recouvrement des mensualités impayées', opponent: late.client_name, sale_id: late.sale_id, amount_fcfa: late.overdue_fcfa, stage: 'amiable', department: 'commercial', opened_on: ymd(-8), next_date: ymd(12), next_label: 'Rendez-vous d’échéancier avec le client' },
      [{ stage: 'amiable', date: ymd(-8), note: 'Appel du client : proposition d’un rééchelonnement' }]);
  }
  if (ticket) {
    await lit({ origin: 'sav', title: `Contestation de la réclamation : ${ticket.title}`.slice(0, 200), opponent: 'Acquéreur du lot', sav_ticket_id: ticket.id, amount_fcfa: 2400000, stage: 'avocat', department: 'juridique', lawyer: 'Cabinet Kouassi & Associés', court: 'Tribunal de première instance d’Abidjan', opened_on: ymd(-70), next_date: ymd(26), next_label: 'Audience de conciliation' },
      [{ stage: 'amiable', date: ymd(-70) }, { stage: 'mise_en_demeure', date: ymd(-50), note: 'Mise en demeure reçue de l’acquéreur' }, { stage: 'avocat', date: ymd(-20), note: 'Dossier confié au cabinet' }]);
  }
  await lit({ origin: 'fournisseur', title: 'Livraison de ciment non conforme', opponent: 'SOCOCIM Matériaux', amount_fcfa: 3200000, stage: 'clos', status: 'clos', outcome: 'transaction', opened_on: ymd(-160), closed_on: ymd(-100), close_note: 'Avoir de 3 200 000 FCFA accordé' },
    [{ stage: 'amiable', date: ymd(-160) }, { stage: 'clos', date: ymd(-100), note: 'Avoir de 3 200 000 FCFA accordé' }]);

  // Cautions et retenue de garantie (contrat de sous-traitance de la démo)
  const kinds = Object.fromEntries((await db('guarantee_kinds').select('id', 'label', 'direction')).map(k => [k.label, k]));
  const sub = await db('contracts').where({ kind: 'sous_traitance' }).first();
  let n = 0;
  const gar = async (label, row) => db('guarantees').insert({ reference: `GAR-${year}-${String(++n).padStart(4, '0')}`, kind_id: kinds[label].id, direction: kinds[label].direction, created_by: admin.id, ...row });
  if (sub) {
    await gar('Retenue de garantie', { contract_id: sub.id, supplier_id: sub.supplier_id, amount_fcfa: Math.round(Number(sub.contract_amount) * Number(sub.retention_pct) / 100), reception_on: ymd(-340), release_on: ymd(25), notes: '5 % retenus sur les situations du gros œuvre' });
    await gar('Caution de bonne exécution', { contract_id: sub.id, supplier_id: sub.supplier_id, bank: 'SGBCI', amount_fcfa: 9250000, issued_on: ymd(-200), expires_on: ymd(160) });
    await gar('Caution de restitution d’avance', { contract_id: sub.id, supplier_id: sub.supplier_id, bank: 'Ecobank', amount_fcfa: 27750000, issued_on: ymd(-200), expires_on: ymd(-4) });
  }
  await gar('Garantie bancaire donnée', { counterparty: 'Ministère de la Construction (MCLU)', bank: 'NSIA Banque', amount_fcfa: 15000000, issued_on: ymd(-90), expires_on: ymd(275), notes: 'Garantie d’achèvement du lotissement' });

  const stats = await require('../src/services/juridique').tick(db);
  console.log('Juridique : démo prête.', stats);
  await db.destroy();
})().catch(e => { console.error(e); process.exit(1); });
