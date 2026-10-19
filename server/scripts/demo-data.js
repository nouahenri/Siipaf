/**
 * Remplit une base de DÉMONSTRATION (lots, prospects, rendez-vous, messages) pour essayer le dashboard.
 * Usage : DB_FILENAME=./data/demo.sqlite node scripts/demo-data.js
 * Refuse de tourner sur MySQL ou sur la base principale.
 */
const crypto = require('crypto');
if (!/demo/.test(process.env.DB_FILENAME || '') || process.env.DB_CLIENT === 'mysql') {
  console.error('Ce script ne tourne que sur une base de démonstration (DB_FILENAME contenant « demo »).');
  process.exit(1);
}
const { getDb } = require('../src/db');

(async () => {
  const db = getDb();
  await db.migrate.latest();
  await db.seed.run();
  if ((await db('leads').count({ n: '*' }))[0].n > 0) { console.log('Déjà rempli.'); return db.destroy(); }

  const statuses = ['disponible', 'disponible', 'disponible', 'option', 'reserve', 'vendu', 'vendu', 'desistement', 'bloque'];
  const projects = await db('projects').select('id', 'slug');
  for (const p of projects.filter(p => ['yamoussoukro', 'ahoutoue', 'bingerville'].includes(p.slug))) {
    const n = p.slug === 'bingerville' ? 12 : 36;
    for (let i = 1; i <= n; i++) {
      const ilot = String.fromCharCode(65 + Math.floor((i - 1) / 12));
      const status = statuses[(i * 7 + p.id) % statuses.length];
      const [id] = await db('lots').insert({ project_id: p.id, code: `${ilot}${i}`, ilot, surface_m2: 180 + (i % 5) * 35, price_fcfa: 21212000 + (i % 4) * 2000000, status });
      await db('lot_status_history').insert({ lot_id: id, to_status: status, reason: 'Démo' });
    }
  }
  const names = ['Awa Koné', 'Jean-Marc Kouassi', 'Fatou Diabaté', 'Serge Yao', 'Aminata Touré', 'Koffi N’Guessan', 'Mariam Bamba', 'Didier Ouattara', 'Clarisse Aka', 'Ibrahim Cissé', 'Nadège Kouamé', 'Olivier Brou'];
  const stages = ['prospection', 'prospection', 'visite', 'visite', 'decision', 'choix_bien', 'paiement', 'contrat', 'notaire', 'prospection', 'perdu', 'visite'];
  const sources = ['site', 'plan', 'site', 'admin', 'plan', 'site', 'whatsapp', 'site', 'admin', 'plan', 'site', 'ia'];
  const leadIds = [];
  for (const [i, name] of names.entries()) {
    const [id] = await db('leads').insert({
      name, phone: `07${String(10000000 + i * 1234567).slice(0, 8)}`, email: `${name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@exemple.com`,
      stage: stages[i], source: sources[i], is_diaspora: i % 3 === 0, country: i % 3 === 0 ? 'France' : 'Côte d’Ivoire',
      financing: ['apport', 'diaspora', 'credit', 'comptant'][i % 4], project_id: projects[i % 3].id,
      created_at: new Date(Date.now() - i * 2.5 * 86400000), updated_at: new Date(Date.now() - i * 3600000 * 7),
    });
    leadIds.push(id);
  }
  const optLot = await db('lots').where({ status: 'option' }).first();
  if (optLot) await db('lot_options').insert({ lot_id: optLot.id, lead_id: leadIds[0], expires_at: new Date(Date.now() + 4 * 86400000) });
  for (let i = 0; i < 6; i++) {
    await db('appointments').insert({
      lead_id: leadIds[i], kind: ['visite', 'appel', 'bureau', 'visite', 'visio', 'appel'][i], status: i < 2 ? 'demande' : 'confirme',
      starts_at: new Date(Date.now() + (i + 1) * 86400000 * 0.8 + 3600000 * (9 + i)), project_id: projects[i % 3].id, source: 'site',
    });
  }
  await db('contact_messages').insert([
    { name: 'Fatou Diabaté', email: 'fatou@exemple.com', subject: 'Option Diaspora', message: 'Bonjour, je vis à Lyon et souhaite acheter une villa 4 pièces à Ahoutoué sans apport. Quelles sont les étapes ?', lead_id: leadIds[2] },
    { name: 'Serge Yao', phone: '0708091011', subject: 'Visite', message: 'Je souhaite visiter le site de Yamoussoukro samedi matin.', lead_id: leadIds[3] },
  ]);
  for (const e of ['lecteur1@exemple.com', 'lecteur2@exemple.com', 'diaspora.paris@exemple.com']) {
    await db('newsletter_subscribers').insert({ email: e, unsubscribe_token: crypto.randomBytes(16).toString('hex') });
  }
  console.log('Base de démonstration prête.');
  await db.destroy();
})();
