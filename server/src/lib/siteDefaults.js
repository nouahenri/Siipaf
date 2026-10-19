/** Contenu du site tel qu'il était écrit dans les pages HTML : valeurs de départ de « Contenu du site ». */
const SLIDES = [
  ['Promoteur & Aménageur Agréé MCLU', 'Votre Réseau', 'Immobilier de Confiance', "Construction, promotion immobilière & aménagement foncier en Côte d'Ivoire.", 'Nos projets', 'projets.html', 'Nous contacter', 'contact.html'],
  ['Logement Social & Haut Standing', 'SIIPAF CITY', 'YAMOUSSOUKRO', 'À partir de 9 210 000 FCFA — Paiement sur 36 mois. Livraison 30 mois.', 'Découvrir', 'projets.html#yamoussoukro', 'Réserver', 'contact.html?projet=YAMOUSSOUKRO'],
  ['Cité Complète — 59 hectares', 'SIIPAF CITY', 'AHOUTOUE', 'Écoles, centre médical, commerces — 20 min de Cocody via Rocade Y4.', 'Découvrir', 'projets.html#ahoutoue', 'Réserver', 'contact.html?projet=AHOUTOUE'],
  ['Haut Standing — Riviera 2 Abidjan', 'RIVIERA II —', 'Appartements de Prestige', 'Appartement F5 · 320 m² · 300 000 000 FCFA · Piscines & Gym privatifs.', 'Découvrir', 'projets.html#riviera', 'Prendre RDV', 'contact.html?projet=RIVIERA'],
  ['Penthouse Exclusif — Cocody Angré', 'C & LY —', 'Cocody Angré 9ème', 'F2 à Penthouse 240 m² · de 50 à 180 millions FCFA · Au cœur de Cocody.', 'Découvrir', 'projets.html#cly', 'Réserver', 'contact.html?projet=CLY'],
].map(([badge, title, title_em, text, cta_label, cta_href, cta2_label, cta2_href]) => ({
  media_id: null, badge, title, title_em, text, cta_label, cta_href, cta2_label, cta2_href, active: true,
}));

const TICKER = [
  ['SIIPAF CITY YAMOUSSOUKRO — À partir de 9 210 000 FCFA', 'contact.html?projet=YAMOUSSOUKRO'],
  ['SIIPAF CITY AHOUTOUE — 59 hectares — 20 min de Cocody', 'contact.html?projet=AHOUTOUE'],
  ['RIVIERA II — Appartements Haut Standing 320m²', 'contact.html?projet=RIVIERA'],
  ['MINI-CITÉS BINGERVILLE — Duplex Haut Standing — Livraison 180 jours', 'contact.html?projet=BINGERVILLE'],
  ['C & LY COCODY ANGRÉ — Penthouse 5 pièces 240m²', 'contact.html?projet=CLY'],
  ['Paiement sur 36 mois — Options Diaspora disponibles', 'financement.html'],
].map(([text, href]) => ({ text, href }));

module.exports = { SLIDES, TICKER };
