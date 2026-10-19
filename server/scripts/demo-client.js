/**
 * Crée un client de démonstration pour l'espace client, dans la base de DÉMONSTRATION uniquement :
 * acquéreur de la diaspora, dossier « apport », échéancier, versements (une mensualité en retard),
 * documents, journal de chantier avec photos, messages et accès client.
 *
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-client.js
 *
 * Le mot de passe de démo est lu dans DEMO_CLIENT_PASSWORD (server/.env) ; s'il n'existe pas,
 * il est généré et ajouté à .env. Il n'est jamais affiché.
 */
if (!/demo/.test(process.env.DB_FILENAME || '') || process.env.DB_CLIENT === 'mysql') {
  console.error('Base de démonstration uniquement (DB_FILENAME contenant « demo »).');
  process.exit(1);
}
const fs = require('fs');
const path = require('path');
const { getDb } = require('../src/db');
const { uploadsDir } = require('../src/config');
const { hashPassword } = require('../src/auth');
const { openSale, refreshSaleStatus } = require('../src/services/sales');
const { regenerateSchedule } = require('../src/services/schedule');
const { generatePassword } = require('../src/services/clients');

const ROOT = path.join(__dirname, '..', '..');
const ENV_FILE = path.join(__dirname, '..', '.env');
const DEMO_EMAIL = 'aya.kouame@example.com';
const DAY = 86400000;
const ago = days => new Date(Date.now() - days * DAY);
const isoDay = d => d.toISOString().slice(0, 10);

/** Mot de passe de démo : celui de .env, sinon un nouveau ajouté à .env. */
function demoPassword() {
  if (process.env.DEMO_CLIENT_PASSWORD) return process.env.DEMO_CLIENT_PASSWORD;
  const pw = generatePassword(14);
  fs.appendFileSync(ENV_FILE, `\n# Mot de passe du client de démonstration (espace client, base démo)\nDEMO_CLIENT_PASSWORD=${pw}\n`);
  return pw;
}

/** Copie une image du site dans uploads/ et l'enregistre dans la médiathèque (une seule fois). */
async function demoMedia(db, src, name, alt) {
  const filename = `demo-${name}`;
  const existing = await db('media').where({ filename }).first();
  if (existing) return existing.id;
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, src), path.join(uploadsDir, filename));
  const mime = filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
  const [id] = await db('media').insert({ filename, original_name: path.basename(src), mime, size: fs.statSync(path.join(uploadsDir, filename)).size, alt });
  return id;
}

(async () => {
  const db = getDb();
  const user = await db('users').orderBy('id').first();
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();

  let lead = await db('leads').where({ email: DEMO_EMAIL }).first();
  let sale = lead && await db('sales').where({ lead_id: lead.id }).whereIn('status', ['en_cours', 'solde']).first();

  if (!sale) {
    const lot = await db('lots').where({ project_id: project.id }).whereIn('status', ['disponible', 'desistement']).orderBy('id').first();
    if (!lot) throw new Error('Aucun lot disponible à Ahoutoué dans la base démo.');
    const offer = await db('project_offers').where({ project_id: project.id }).where('label', 'like', 'Villa jumelée sociale 4%').first();
    await db('lots').where({ id: lot.id }).update({ ilot: lot.ilot || '12', surface_m2: lot.surface_m2 || 180, offer_id: lot.offer_id || offer?.id || null, price_fcfa: offer?.price_fcfa || lot.price_fcfa || 23212000 });
    sale = await openSale(db, {
      lotId: lot.id,
      leadData: { name: 'Aya Kouamé', email: DEMO_EMAIL, phone: '+33 6 12 34 56 78' },
      financing: 'apport', reserved_at: ago(270), user,
    });
    lead = await db('leads').where({ id: sale.lead_id }).first();
    await db('leads').where({ id: lead.id }).update({ country: 'France', is_diaspora: true, financing: 'apport' });
    await db.transaction(trx => regenerateSchedule(trx, sale));

    // Versements : apport + mensualités échues depuis plus de 5 semaines → la dernière échue reste en retard
    const schedule = await db('payment_schedule').where({ sale_id: sale.id }).orderBy('seq');
    const cutoff = isoDay(ago(35));
    const methods = ['virement', 'mobile_money'];
    for (const [i, line] of schedule.filter(l => l.due_date <= cutoff).entries()) {
      await db('payments').insert({
        sale_id: sale.id, amount_fcfa: line.amount_fcfa, paid_at: new Date(`${line.due_date}T10:00:00Z`),
        method: line.kind === 'apport' ? 'virement' : methods[i % 2], reference: `${line.kind === 'apport' ? 'VIR' : 'PAY'}-${sale.id}-${line.seq}`, recorded_by: user.id,
      });
    }
    await db.transaction(trx => refreshSaleStatus(trx, sale.id));

    // Documents
    const pdf = await demoMedia(db, 'server/uploads/test-ahoutoue.pdf', 'contrat-reservation.pdf', 'Contrat de réservation');
    await db('sale_documents').where({ sale_id: sale.id, type: 'contrat_reservation' }).update({ status: 'signe', media_id: pdf });
    await db('sale_documents').where({ sale_id: sale.id, type: 'attestation_attribution' }).update({ status: 'delivre', media_id: pdf });
    await db('sale_documents').where({ sale_id: sale.id, type: 'contrat_vente' }).update({ status: 'en_cours', note: 'Rendez-vous de signature à fixer avec votre conseiller.' });

    // Journal de chantier (projet, îlot, lot)
    const photos = {
      site: await demoMedia(db, 'images/hero/hero-3-ahoutoue.jpg', 'chantier-site.jpg', 'Vue du site d’Ahoutoué'),
      projet: await demoMedia(db, 'images/projets/proj-ahoutoue.jpg', 'chantier-projet.jpg', 'Perspective du projet'),
      amenageur: await demoMedia(db, 'images/activites/act-amenageur.jpg', 'chantier-terrassement.jpg', 'Terrassement'),
      btp: await demoMedia(db, 'images/activites/act-btp.jpg', 'chantier-gros-oeuvre.jpg', 'Gros œuvre'),
      elec: await demoMedia(db, 'images/activites/act-electricite.jpg', 'chantier-reseaux.jpg', 'Réseaux électriques'),
      promoteur: await demoMedia(db, 'images/activites/act-promoteur.jpg', 'chantier-visite.jpg', 'Visite de chantier'),
    };
    const lotRow = await db('lots').where({ id: sale.lot_id }).first();
    const updates = [
      { stage: 'etudes', progress_pct: 8, title: 'Permis obtenu et bornage du site', body: 'Le permis d’aménager est délivré et le géomètre a borné l’ensemble des îlots.', media: [photos.site], days: 240 },
      { stage: 'terrassement', progress_pct: 15, title: 'Terrassement et nivellement', body: 'Les engins ont nivelé la première tranche, dont votre îlot.', media: [photos.amenageur, photos.site], days: 180 },
      { stage: 'vrd', progress_pct: 24, title: 'Ouverture de la voirie principale', body: 'La voie principale et les réseaux d’eau et d’électricité sont en cours de pose.', media: [photos.elec, photos.amenageur, photos.projet], days: 120 },
      { stage: 'fondations', progress_pct: 32, title: `Fondations de l’îlot ${lotRow.ilot}`, ilot: lotRow.ilot, media: [photos.btp, photos.amenageur], days: 60 },
      { stage: 'gros_oeuvre', progress_pct: 41, title: 'Élévation des murs de votre villa', body: 'Les murs du rez-de-chaussée sont montés. Prochaine étape : le chaînage et la dalle.', lot_id: lotRow.id, media: [photos.btp, photos.promoteur, photos.elec, photos.site, photos.projet], days: 18 },
      { stage: 'gros_oeuvre', progress_pct: 43, title: 'Réunion de chantier (interne)', body: 'Point avec le sous-traitant.', lot_id: lotRow.id, media: [], days: 5, visible_client: false },
    ];
    for (const u of updates) {
      await db('site_updates').insert({
        project_id: project.id, ilot: u.ilot || null, lot_id: u.lot_id || null, stage: u.stage, progress_pct: u.progress_pct,
        title: u.title, body: u.body || null, media: JSON.stringify(u.media), visible_client: u.visible_client !== false,
        published_at: ago(u.days), created_by: user.id,
      });
    }

    // Messages
    const messages = [
      { sender: 'client', body: 'Bonjour, pourriez-vous m’envoyer des photos récentes de la villa ? Je suis à Lyon et je ne pourrai pas venir avant l’été.', days: 21, read: true },
      { sender: 'equipe', body: 'Bonjour Madame Kouamé, avec plaisir : nous publions les photos dans votre espace dès la semaine prochaine, après la visite du conducteur de travaux.', days: 20, read: true },
      { sender: 'client', body: 'Merci beaucoup, c’est très rassurant de suivre l’avancement d’ici.', days: 17, read: true },
      { sender: 'equipe', body: 'Les photos de l’élévation des murs sont en ligne dans l’onglet Chantier. Pensez aussi à la mensualité du mois, que nous n’avons pas encore reçue.', days: 2, read: false },
    ];
    for (const m of messages) {
      await db('client_messages').insert({
        lead_id: lead.id, sale_id: sale.id, sender: m.sender, user_id: m.sender === 'equipe' ? user.id : null,
        body: m.body, created_at: ago(m.days), read_at: m.read ? ago(m.days - 0.1) : null,
      });
    }
  }

  // Accès client (mot de passe déjà personnel : la démo arrive directement sur l'accueil)
  const patch = { password_hash: await hashPassword(demoPassword()), must_change_password: false, active: true, updated_at: new Date() };
  const access = await db('client_accounts').where({ lead_id: lead.id }).first();
  if (access) await db('client_accounts').where({ id: access.id }).update(patch);
  else await db('client_accounts').insert({ ...patch, lead_id: lead.id, created_by: user.id });

  console.log(`Client de démonstration prêt : code ${lead.client_code} (mot de passe : DEMO_CLIENT_PASSWORD dans server/.env).`);
  console.log('Espace client : http://localhost:4000');
  await db.destroy();
})().catch(err => { console.error(err); process.exit(1); });
