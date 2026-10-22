/**
 * Données de démonstration du Courrier (ERP · Administration générale ; base de démo locale uniquement).
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-courrier.js
 * Enregistre des courriers arrivée et départ à différents stades : à affecter, en cours, en retard, confidentiel,
 * traité avec réponse liée, classé.
 */
const { createDb } = require('../src/db');
const { mailNumber } = require('../src/lib/domain');

const DAY = 24 * 3600 * 1000;
const ymd = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

(async () => {
  const db = createDb();
  if (process.env.NODE_ENV === 'production') throw new Error('Script réservé à la base de démo.');
  if ((await db('mail_items').count({ n: '*' }))[0].n > 0) { console.log('Courriers déjà présents.'); return db.destroy(); }
  const admin = await db('users').orderBy('id').first();
  const staff = await db('users').whereNot({ id: admin.id }).where({ active: true }).orderBy('id').limit(3);
  const to = i => (staff[i] || admin).id;
  const seq = { arrivee: 0, depart: 0 };
  const add = async m => {
    const year = Number(m.date.slice(0, 4));
    const n = ++seq[m.direction];
    const [id] = await db('mail_items').insert({ channel: 'poste', nature: 'lettre', ...m, year, seq: n, number: mailNumber(m.direction, year, n), created_by: admin.id });
    return typeof id === 'object' ? id.id : id;
  };
  const assigned = (who, suite, due, extra = {}) => ({ status: 'affecte', assigned_to: to(who), suite, due_date: due, assigned_by: admin.id, assigned_at: new Date(), ...extra });

  await add({ direction: 'arrivee', date: ymd(-1), correspondent: 'Mairie de Bingerville', letter_ref: 'MB/SG/2026-418', subject: 'Avis favorable au permis de construire — îlot 4', nature: 'administratif', channel: 'porteur' });
  await add({ direction: 'arrivee', date: ymd(0), correspondent: 'Imprimerie Nouvelle', subject: 'Catalogue des fournitures de bureau', nature: 'publicite' });
  await add({ direction: 'arrivee', date: ymd(0), correspondent: 'Cabinet Me Kouassi, huissier', subject: 'Sommation de payer — dossier fournisseur', nature: 'juridique', channel: 'huissier', confidential: true, urgent: true });
  await add({ direction: 'arrivee', date: ymd(-6), correspondent: 'SODECI', letter_ref: 'DR-ABJ-77', subject: 'Raccordement au réseau d’eau du programme Ahoutoué', nature: 'demande', ...assigned(0, 'traitement', ymd(3), { instructions: 'Préparer le dossier technique et répondre.' }) });
  await add({ direction: 'arrivee', date: ymd(-12), correspondent: 'CIE', subject: 'Devis d’extension du réseau électrique', nature: 'facture', ...assigned(1, 'traitement', ymd(-2)) });
  await add({ direction: 'arrivee', date: ymd(-4), correspondent: 'Bureau d’études Géotech', subject: 'Rapport d’étude de sol — Bingerville phase 2', nature: 'rapport', ...assigned(2, 'avis', ymd(1)) });
  const answered = await add({ direction: 'arrivee', date: ymd(-20), correspondent: 'Ministère de la Construction (MCLU)', subject: 'Demande de pièces complémentaires — agrément', nature: 'administratif',
    ...assigned(0, 'traitement', ymd(-10)), status: 'traite', done_by: to(0), done_at: new Date(Date.now() - 12 * DAY), done_note: 'Réponse envoyée : D-' });
  const reply = await add({ direction: 'depart', date: ymd(-12), correspondent: 'Ministère de la Construction (MCLU)', subject: 'Transmission des pièces complémentaires', nature: 'administratif', status: 'envoye', reply_to_id: answered });
  await db('mail_items').where({ id: answered }).update({ done_note: `Réponse envoyée : ${(await db('mail_items').where({ id: reply }).first()).number}` });
  await add({ direction: 'arrivee', date: ymd(-8), correspondent: 'Chambre de commerce', subject: 'Invitation au forum de l’immobilier', nature: 'convocation', ...assigned(0, 'information', null), status: 'traite', done_note: 'Pris connaissance', done_by: to(0), done_at: new Date() });
  await add({ direction: 'arrivee', date: ymd(-15), correspondent: 'Agence de communication', subject: 'Offre de services', nature: 'publicite', suite: 'classement', status: 'traite', done_note: 'Classé', assigned_by: admin.id, assigned_at: new Date() });
  await add({ direction: 'depart', date: ymd(-2), correspondent: 'Étude de Me Diallo, notaire', subject: 'Envoi des contrats de vente du lot B12', nature: 'juridique', channel: 'coursier', status: 'envoye' });
  // Relances marquées comme faites : la démo n'envoie aucun e-mail (le SMTP local est le vrai)
  await db('mail_items').where({ status: 'affecte' }).update({ reminded_eve_at: new Date(), reminded_late_at: new Date() });
  console.log('Courriers de démonstration enregistrés.');
  await db.destroy();
})().catch(e => { console.error(e); process.exit(1); });
