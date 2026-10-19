/**
 * Données de départ reprises du site actuel. Idempotent : ne remplace rien d'existant,
 * on peut le relancer sans risque (`npm run seed`).
 */
const bcrypt = require('bcryptjs');
const { SLIDES, TICKER } = require('../src/lib/siteDefaults');

const PROJECTS = [
  {
    slug: 'yamoussoukro', name: 'SIIPAF CITY YAMOUSSOUKRO', city: 'Yamoussoukro', category: 'social_haut_standing',
    location: 'Subiakro — Axe Yamoussoukro–Oumé, 20 min du centre-ville', delivery: '30 mois',
    tagline: 'Logement social & haut standing — à partir de 9 210 000 FCFA',
    description: 'Cité résidentielle inclusive intégrée au plan directeur de la capitale politique.',
    offers: [
      ['Appartement social 2 pièces', '60 m²', 9210000, 11210000],
      ['Appartement social 3 pièces', '72 m²', 13340000, 15340000],
      ['Appartement social 4 pièces', '91 m²', 16880000, 18880000],
      ['Villa jumelée sociale 3 pièces', 'T.125 m² | H.85 m²', 16256000, null],
      ['Villa jumelée sociale 4 pièces', 'T.180 m² | H.100 m²', 21212000, null],
      ['Villa individuelle 4 pièces', 'T.250 m² | H.120 m²', 34546000, null],
      ['Duplex haut standing 5 pièces (dalle)', 'T.250 m² | H.175 m²', 56750000, null],
      ['Duplex haut standing 5 pièces (toiture)', 'T.250 m² | H.175 m²', 55500000, null],
    ],
  },
  {
    slug: 'ahoutoue', name: 'SIIPAF CITY AHOUTOUE', city: 'Abidjan', category: 'social_haut_standing',
    location: 'Ahoutoué — Axe Abidjan–Alépé, 20 min de Cocody via la Rocade Y4', delivery: '30 mois',
    tagline: 'Cité complète de 59 hectares', amenities: ['3 écoles', 'Centre médical', 'Centre commercial', 'Terrain de sport', 'Aires de jeux', 'Espaces verts'],
    description: '59 hectares — une ville complète avec écoles, centre médical, centre commercial, terrains de sport et espaces verts.',
    offers: [
      ['Appartement social 2 pièces', '60 m²', 11210000, 13210000],
      ['Appartement social 3 pièces', '72 m²', 15340000, 17340000],
      ['Appartement social 4 pièces', '91 m²', 18880000, 20880000],
      ['Villa jumelée sociale 3 pièces', 'T.125 m² | H.85 m²', 18256000, null],
      ['Villa jumelée sociale 4 pièces', 'T.180 m² | H.100 m²', 23212000, null],
      ['Villa individuelle 4 pièces', 'T.250 m² | H.120 m²', 36546000, null],
      ['Duplex haut standing 5 pièces (dalle)', 'T.250 m² | H.175 m²', 58750000, null],
      ['Duplex haut standing 5 pièces (toiture)', 'T.250 m² | H.175 m²', 57500000, null],
    ],
  },
  {
    slug: 'riviera', name: 'RIVIERA II', city: 'Abidjan', category: 'haut_standing',
    location: 'Riviera 2, Abidjan — à deux pas de l’échangeur', tagline: 'Appartements de prestige',
    amenities: ['2 piscines', 'Salle de sport', 'Parking souterrain', 'Ascenseur', 'Surveillance CCTV', 'Groupe électrogène', 'Conciergerie', 'Cuisine équipée'],
    description: 'Grand programme immobilier alliant appartements haut standing et bureaux de prestige.',
    offers: [['Appartement F5', '320 m²', 300000000, null]],
  },
  {
    slug: 'bingerville', name: 'MINI-CITÉS DE BINGERVILLE', city: 'Bingerville', category: 'haut_standing',
    location: 'Akouai-Agban, Sebia Yao, M’batto Bouaké, Eloka — Bingerville', delivery: '180 jours',
    tagline: 'Duplex haut standing avec domotique', amenities: ['Maison intelligente', 'Résidence sécurisée', 'Domotique', '10 min du pont'],
    description: 'Collection exclusive de domaines privés dans la capitale historique intégrée au Grand Abidjan.',
    offers: [
      ['Duplex — paiement comptant', null, 99000000, null],
      ['Duplex — paiement sur 12 mois', null, 110000000, null],
      ['Duplex — livraison gros œuvre', null, 75000000, null],
    ],
  },
  {
    slug: 'cly', name: 'C & LY — COCODY ANGRÉ', city: 'Abidjan', category: 'haut_standing',
    location: 'Cocody Angré 9ème Tranche — à deux pas du rond-point CNPS', tagline: 'Appartements premium & penthouses',
    amenities: ['Cuisine équipée', 'CCTV + ascenseur', 'Salle de sport', 'Climatisation', "Réserve d'eau", 'Groupe électrogène'],
    description: "Deux immeubles d'exception offrant appartements haut standing et penthouses exclusifs.",
    offers: [
      ['F2 — 2 pièces', '84 m²', 50000000, null],
      ['F3 — 3 pièces', '114,72 m²', 80000000, null],
      ['F4 — 4 pièces', '126 m²', 94000000, null],
      ['Penthouse F5', '240,71 m²', 180000000, null],
    ],
  },
];

const CONTENT = {
  site: {
    phone: '+225 01 02 27 95 95', phone2: '+225 27 22 20 50 20', email: 'info@siipaf.com',
    address: 'Cocody 2 Plateaux 7ème Tranche, Abidjan', whatsapp: '2250102279595', socials: {},
  },
  stats: { items: [
    { value: 5, label: 'Projets actifs' }, { value: 59, unit: 'ha', label: 'Surface aménagée' },
    { value: 3, label: 'Villes couvertes' }, { value: 36, unit: 'mois', label: 'Paiement échelonné' },
  ] },
  ticker: { items: TICKER },
  hero: { autoplay_ms: 5000, slides: SLIDES },
};

exports.seed = async function (knex) {
  const email = (process.env.ADMIN_EMAIL || 'admin@siipaf.com').toLowerCase();
  if (!(await knex('users').where({ email }).first())) {
    const password = process.env.ADMIN_PASSWORD;
    if (!password || password.length < 10 || password === 'change-moi-aussi') {
      throw new Error('Définissez ADMIN_PASSWORD (10 caractères minimum) dans server/.env avant le premier « npm run setup ».');
    }
    await knex('users').insert({
      email, name: process.env.ADMIN_NAME || 'Administrateur SIIPAF', role: 'super_admin',
      password_hash: await bcrypt.hash(password, 12),
    });
  }

  for (const [sort, p] of PROJECTS.entries()) {
    if (await knex('projects').where({ slug: p.slug }).first()) continue;
    const { offers, amenities, ...fields } = p;
    const [projectId] = await knex('projects').insert({ ...fields, amenities: JSON.stringify(amenities || []), sort });
    await knex('project_offers').insert(offers.map(([label, surface, price, diaspora], i) => ({
      project_id: projectId, label, surface, price_fcfa: price, diaspora_price_fcfa: diaspora, sort: i,
    })));
  }

  for (const [key, value] of Object.entries(CONTENT)) {
    if (!(await knex('site_content').where({ key }).first())) {
      await knex('site_content').insert({ key, value: JSON.stringify(value) });
    }
  }
};
