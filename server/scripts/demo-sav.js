/**
 * Données de démonstration du module ERP · Client & SAV (base de démo locale uniquement).
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-sav.js
 * Livre une partie des dossiers, relève des réserves, ouvre des réclamations à différents stades,
 * planifie des interventions cette semaine et enregistre quelques avis clients.
 */
const { createDb } = require('../src/db');
const sav = require('../src/services/sav');

const DAY = 24 * 3600 * 1000;
const ago = days => new Date(Date.now() - days * DAY);
const ymd = d => d.toISOString().slice(0, 10);

(async () => {
  const db = createDb();
  if (process.env.NODE_ENV === 'production') throw new Error('Script réservé à la base de démo.');
  if ((await db('sav_tickets').count({ n: '*' }))[0].n > 0) { console.log('Données SAV déjà présentes.'); return db.destroy(); }
  const admin = await db('users').orderBy('id').first();
  const sales = await db('sales').whereNot('status', 'desiste').orderBy('id').limit(10);
  if (sales.length < 6) throw new Error('Lancez d’abord scripts/demo-sales.js.');

  // Livraisons échelonnées : de 2 mois à 3 ans
  const deliveries = [60, 150, 320, 500, 900, 1100];
  for (const [i, days] of deliveries.entries()) await db('sales').where({ id: sales[i].id }).update({ delivered_at: ymd(ago(days)) });

  const tickets = [
    { s: 0, category: 'plomberie', priority: 'haute', title: 'Fuite sous l’évier de la cuisine', location: 'Cuisine', age: 2, to: ['qualifie'] },
    { s: 0, category: 'electricite', priority: 'urgente', title: 'Disjoncteur qui saute dès qu’on branche le four', location: 'Tableau électrique', age: 3, to: [] },
    { s: 1, category: 'etancheite', priority: 'haute', title: 'Infiltration au plafond de la chambre 2', location: 'Chambre 2', age: 9, to: ['qualifie', 'planifie'] },
    { s: 1, category: 'menuiserie', priority: 'normale', title: 'Porte d’entrée qui frotte au sol', location: 'Entrée', age: 20, to: ['qualifie', 'en_cours'] },
    { s: 2, category: 'revetements', priority: 'basse', title: 'Carreaux décollés dans la douche', location: 'Salle d’eau', age: 35, to: ['qualifie', 'en_cours', 'resolu'], rate: 5 },
    { s: 2, category: 'equipements', priority: 'normale', title: 'Chasse d’eau qui coule en continu', location: 'WC', age: 50, to: ['en_cours', 'resolu'], rate: 4 },
    { s: 3, category: 'maconnerie', priority: 'haute', title: 'Fissure en escalier sur le mur du séjour', location: 'Séjour', age: 70, to: ['qualifie', 'planifie', 'en_cours', 'resolu'], rate: 3 },
    { s: 3, category: 'vrd', priority: 'normale', title: 'Regard d’eaux pluviales bouché devant le portail', location: 'Devant la parcelle', age: 95, to: ['qualifie', 'resolu', 'clos'] },
    { s: 4, category: 'administratif', priority: 'basse', title: 'Copie du procès-verbal de livraison', age: 120, to: ['resolu'], rate: 5 },
    { s: 4, category: 'plomberie', priority: 'normale', title: 'Pression d’eau faible à l’étage', location: 'Étage', age: 140, to: ['qualifie', 'en_cours', 'resolu'], rate: 4 },
    { s: 5, category: 'autre', priority: 'basse', title: 'Demande de peinture d’une couleur différente', age: 160, to: ['rejete'] },
    { s: 5, category: 'electricite', priority: 'normale', title: 'Prises extérieures sans courant', location: 'Terrasse', age: 6, source: 'client', to: [] },
  ];

  const ids = [];
  for (const t of tickets) {
    const sale = sales[t.s];
    const row = await sav.createTicket(db, { sale_id: sale.id, category: t.category, priority: t.priority, title: t.title, location: t.location || null,
      description: t.source === 'client' ? 'Depuis hier soir, les deux prises de la terrasse ne fonctionnent plus.' : null },
    { userId: t.source === 'client' ? null : admin.id, source: t.source || (t.s % 2 ? 'client' : 'equipe') });
    const created = ago(t.age);
    await db('sav_tickets').where({ id: row.id }).update({ created_at: created, updated_at: created, due_at: sav.dueFrom(t.priority, created), assigned_to: t.to.length ? admin.id : null });
    await db('sav_events').where({ ticket_id: row.id }).update({ created_at: created });
    for (const [k, to] of t.to.entries()) {
      await sav.changeStatus(db, row.id, to, { userId: admin.id });
      // Résolutions étalées : une à quatre journées par étape
      const at = new Date(created.getTime() + (k + 1) * (t.age > 30 ? 2 : 0.5) * DAY);
      const patch = { updated_at: at };
      if (to === 'resolu') patch.resolved_at = at;
      if (to === 'clos') patch.closed_at = at;
      if (k === 0) patch.first_response_at = at;
      await db('sav_tickets').where({ id: row.id }).update(patch);
      await db('sav_events').where({ ticket_id: row.id, kind: 'status' }).orderBy('id', 'desc').limit(1).update({ created_at: at });
    }
    if (t.rate) await sav.rate(db, row.id, { satisfaction: t.rate, comment: t.rate >= 4 ? 'Intervention rapide, merci.' : 'Résolu, mais il a fallu relancer.' });
    ids.push(row.id);
  }
  await sav.addComment(db, ids[0], { author: 'equipe', userId: admin.id, body: 'Bonjour, nous avons bien reçu votre demande. Un plombier passera dans la semaine.' });
  await sav.addComment(db, ids[0], { author: 'equipe', userId: admin.id, body: 'Vérifier si le siphon a été posé par le sous-traitant du lot plomberie.', internal: true });
  await sav.addComment(db, ids[0], { author: 'client', body: 'Merci, je suis disponible le matin.' });

  // Interventions de la semaine
  const at = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  await sav.createIntervention(db, { ticket_id: ids[0], scheduled_at: at(1, 9), duration_min: 90, contractor: 'Plomberie Express' }, { userId: admin.id });
  await sav.createIntervention(db, { ticket_id: ids[2], scheduled_at: at(2, 14), duration_min: 180, technician_id: admin.id, contractor: 'Étanch’Pro' }, { userId: admin.id });
  const done = await sav.createIntervention(db, { ticket_id: ids[3], scheduled_at: at(-1, 10), duration_min: 60, technician_id: admin.id }, { userId: admin.id });
  await sav.updateIntervention(db, done.id, { status: 'realisee', report: 'Rabotage du bas de porte et réglage des paumelles.', cost_fcfa: 25000 }, { userId: admin.id });

  // Réserves relevées aux livraisons récentes
  await sav.createReserve(db, sales[0].id, { label: 'Éclat d’enduit sur l’angle de la façade', location: 'Façade nord', category: 'maconnerie', deadline: ymd(ago(-20)) });
  await sav.createReserve(db, sales[0].id, { label: 'Robinet du lave-mains à remplacer', location: 'WC invités', category: 'equipements', deadline: ymd(ago(10)) });
  const lifted = await sav.createReserve(db, sales[1].id, { label: 'Vitre rayée baie du séjour', location: 'Séjour', category: 'menuiserie', deadline: ymd(ago(100)) });
  await sav.setReserveStatus(db, lifted.id, 'levee', { userId: admin.id });

  console.log(`SAV de démonstration : ${ids.length} réclamations, 3 interventions, 3 réserves.`);
  await db.destroy();
})().catch(e => { console.error(e); process.exit(1); });
