/**
 * ERP · Comptabilité — règles : plan de comptes SYSCOHADA révisé (Acte uniforme OHADA relatif au droit comptable,
 * système normal), journaux, comptes utilisés par les écritures automatiques, contrôles et états.
 * Le plan livré reprend les comptes principaux (2 et 3 chiffres) et les sous-comptes utiles à un promoteur et
 * aménageur ; le comptable peut en créer d'autres. À faire valider par le comptable de SIIPAF.
 */

// [numéro, intitulé] — intitulés reformulés d'après le plan SYSCOHADA révisé
const SYSCOHADA_ACCOUNTS = [
  // Classe 1 — Ressources durables
  ['10', 'Capital'], ['101', 'Capital social'], ['104', 'Compte de l’exploitant'], ['105', 'Primes liées au capital social'], ['109', 'Apporteurs, capital souscrit non appelé'],
  ['11', 'Réserves'], ['111', 'Réserve légale'], ['112', 'Réserves statutaires ou contractuelles'], ['118', 'Autres réserves'],
  ['12', 'Report à nouveau'], ['121', 'Report à nouveau créditeur'], ['129', 'Report à nouveau débiteur'],
  ['13', 'Résultat net de l’exercice'], ['131', 'Résultat net : bénéfice'], ['139', 'Résultat net : perte'],
  ['14', 'Subventions d’investissement'], ['15', 'Provisions réglementées et fonds assimilés'],
  ['16', 'Emprunts et dettes assimilées'], ['162', 'Emprunts et dettes auprès des établissements de crédit'], ['165', 'Dépôts et cautionnements reçus'], ['166', 'Intérêts courus'],
  ['17', 'Dettes de location-acquisition'], ['19', 'Provisions pour risques et charges'], ['191', 'Provisions pour litiges'],
  // Classe 2 — Actif immobilisé
  ['21', 'Immobilisations incorporelles'], ['213', 'Logiciels et sites internet'],
  ['22', 'Terrains'], ['222', 'Terrains nus'], ['223', 'Terrains bâtis'], ['224', 'Travaux de mise en valeur des terrains'],
  ['23', 'Bâtiments, installations techniques et agencements'], ['231', 'Bâtiments sur sol propre'], ['234', 'Aménagements, agencements et installations'], ['239', 'Bâtiments et installations en cours'],
  ['24', 'Matériel, mobilier et actifs biologiques'], ['241', 'Matériel et outillage'], ['244', 'Matériel et mobilier de bureau'], ['245', 'Matériel de transport'],
  ['25', 'Avances et acomptes versés sur immobilisations'], ['26', 'Titres de participation'], ['27', 'Autres immobilisations financières'], ['275', 'Dépôts et cautionnements versés'],
  ['28', 'Amortissements'], ['283', 'Amortissements des bâtiments et agencements'], ['284', 'Amortissements du matériel'], ['29', 'Dépréciations des immobilisations'],
  // Classe 3 — Stocks (un promoteur stocke ses programmes : terrains, travaux en cours, biens achevés)
  ['31', 'Marchandises'], ['311', 'Marchandises — terrains acquis pour la revente'],
  ['32', 'Matières premières et fournitures liées'], ['33', 'Autres approvisionnements'], ['331', 'Matériaux de construction'],
  ['34', 'Produits en cours'], ['341', 'Produits en cours'], ['342', 'Travaux en cours'], ['342100', 'Programmes immobiliers en cours'],
  ['35', 'Services en cours'], ['36', 'Produits finis'], ['361100', 'Logements achevés non vendus'], ['361200', 'Terrains aménagés non vendus'],
  ['38', 'Stocks en cours de route, en consignation ou en dépôt'], ['39', 'Dépréciations des stocks'],
  // Classe 4 — Tiers
  ['40', 'Fournisseurs et comptes rattachés'], ['401', 'Fournisseurs, dettes en compte'], ['4011', 'Fournisseurs'], ['4017', 'Fournisseurs — retenues de garantie'],
  ['404', 'Fournisseurs d’investissements'], ['408', 'Fournisseurs, factures non parvenues'], ['409', 'Fournisseurs débiteurs'], ['4091', 'Fournisseurs, avances et acomptes versés'],
  ['41', 'Clients et comptes rattachés'], ['411', 'Clients'], ['4111', 'Clients'], ['416', 'Créances clients litigieuses ou douteuses'], ['418', 'Clients, produits à recevoir'],
  ['419', 'Clients créditeurs'], ['4191', 'Clients, avances et acomptes reçus'],
  ['42', 'Personnel'], ['421', 'Personnel, avances et acomptes'], ['422', 'Personnel, rémunérations dues'],
  ['43', 'Organismes sociaux'], ['431', 'Sécurité sociale (CNPS)'],
  ['44', 'État et collectivités publiques'], ['441', 'État, impôt sur les bénéfices'], ['442', 'État, autres impôts et taxes'],
  ['443', 'État, TVA facturée'], ['4431', 'TVA facturée sur ventes'], ['444', 'État, TVA due ou crédit de TVA'], ['4441', 'État, TVA due'], ['4449', 'État, crédit de TVA à reporter'],
  ['445', 'État, TVA récupérable'], ['4451', 'TVA récupérable sur immobilisations'], ['4452', 'TVA récupérable sur achats'], ['4454', 'TVA récupérable sur services extérieurs'],
  ['447', 'État, impôts retenus à la source'], ['4471', 'Impôts sur salaires retenus (ITS)'], ['448', 'État, charges à payer et produits à recevoir'],
  ['46', 'Apporteurs, associés et groupe'], ['462', 'Associés, comptes courants'],
  ['47', 'Débiteurs et créditeurs divers'], ['471', 'Débiteurs et créditeurs divers'], ['476', 'Charges constatées d’avance'], ['477', 'Produits constatés d’avance'],
  ['48', 'Créances et dettes hors activités ordinaires'], ['49', 'Dépréciations des comptes de tiers'],
  // Classe 5 — Trésorerie
  ['50', 'Titres de placement'], ['51', 'Valeurs à encaisser'], ['513', 'Chèques à encaisser'],
  ['52', 'Banques'], ['521', 'Banques locales'], ['521100', 'Banque principale'],
  ['53', 'Établissements financiers et assimilés'], ['55', 'Instruments de monnaie électronique'], ['552', 'Monnaie électronique (Mobile Money)'], ['552100', 'Mobile Money'],
  ['56', 'Banques, crédits de trésorerie et d’escompte'], ['57', 'Caisse'], ['571', 'Caisse siège social'], ['571100', 'Caisse principale'],
  ['58', 'Régies d’avances, accréditifs et virements internes'], ['585', 'Virements de fonds'], ['59', 'Dépréciations des comptes de trésorerie'],
  // Classe 6 — Charges des activités ordinaires
  ['60', 'Achats et variations de stocks'], ['601', 'Achats de marchandises (terrains)'], ['6031', 'Variations des stocks de marchandises'],
  ['602', 'Achats de matières premières et fournitures liées'], ['604', 'Achats stockés de matières et fournitures consommables'], ['604100', 'Matériaux de construction (ciment, fer, agrégats)'],
  ['605', 'Autres achats'], ['6051', 'Fournitures non stockables — eau'], ['6052', 'Fournitures non stockables — électricité'], ['6055', 'Fournitures de bureau'],
  ['61', 'Transports'], ['618', 'Autres frais de transport'],
  ['62', 'Services extérieurs'], ['621', 'Sous-traitance générale'], ['621100', 'Sous-traitance des travaux de construction'], ['621200', 'Travaux de viabilisation (VRD, réseaux)'],
  ['622', 'Locations et charges locatives'], ['624', 'Entretien, réparations et maintenance'], ['625', 'Primes d’assurance'], ['627', 'Publicité, publications, relations publiques'], ['628', 'Frais de télécommunications'],
  ['63', 'Autres services extérieurs'], ['631', 'Frais bancaires'], ['632', 'Rémunérations d’intermédiaires et de conseils'], ['632100', 'Honoraires d’architectes et bureaux d’études'],
  ['632200', 'Frais de notaire et de géomètre'], ['632300', 'Commissions d’apporteurs d’affaires'], ['633', 'Frais de formation du personnel'], ['637', 'Personnel extérieur à l’entité'],
  ['64', 'Impôts et taxes'], ['641', 'Impôts et taxes directs'], ['645', 'Impôts et taxes indirects'], ['646', 'Droits d’enregistrement'], ['647', 'Pénalités et amendes fiscales'],
  ['65', 'Autres charges'], ['66', 'Charges de personnel'], ['661', 'Rémunérations directes versées au personnel national'], ['663', 'Indemnités forfaitaires versées au personnel'],
  ['664', 'Charges sociales'], ['6641', 'Charges sociales sur rémunérations du personnel national'], ['668', 'Autres charges sociales'],
  ['67', 'Frais financiers et charges assimilées'], ['671', 'Intérêts des emprunts'], ['674', 'Autres intérêts'],
  ['68', 'Dotations aux amortissements'], ['681', 'Dotations aux amortissements d’exploitation'], ['69', 'Dotations aux provisions et aux dépréciations'],
  // Classe 7 — Produits des activités ordinaires
  ['70', 'Ventes'], ['701', 'Ventes de marchandises'], ['702', 'Ventes de produits finis'], ['702110', 'Ventes de logements (VEFA et achevés)'], ['702120', 'Ventes de terrains aménagés'],
  ['705', 'Travaux facturés'], ['706', 'Services vendus'], ['707', 'Produits accessoires'], ['707100', 'Frais de dossier et pénalités facturés aux clients'],
  ['71', 'Subventions d’exploitation'], ['72', 'Production immobilisée'],
  ['73', 'Variations des stocks de biens et de services produits'], ['734', 'Variations des stocks de produits en cours'], ['736', 'Variations des stocks de produits finis'],
  ['75', 'Autres produits'], ['77', 'Revenus financiers et produits assimilés'], ['78', 'Transferts de charges'], ['79', 'Reprises de provisions et dépréciations'],
  // Classe 8 — Hors activités ordinaires et résultat
  ['81', 'Valeurs comptables des cessions d’immobilisations'], ['82', 'Produits des cessions d’immobilisations'], ['83', 'Charges hors activités ordinaires'],
  ['84', 'Produits hors activités ordinaires'], ['85', 'Dotations hors activités ordinaires'], ['86', 'Reprises hors activités ordinaires'], ['87', 'Participation des travailleurs'],
  ['88', 'Subventions d’équilibre'], ['89', 'Impôts sur le résultat'], ['891', 'Impôts sur les bénéfices de l’exercice'],
];

// Comptes de tiers suivis par partenaire (lettrables)
const PARTNER_ACCOUNTS = { client: ['411', '416', '418', '419'], fournisseur: ['401', '404', '408', '409'], employe: ['421', '422'] };
const partnerKindOf = code => Object.entries(PARTNER_ACCOUNTS).find(([, prefixes]) => prefixes.some(p => code.startsWith(p)))?.[0] || null;

const JOURNAL_KINDS = { vente: 'Ventes', achat: 'Achats', banque: 'Banque', caisse: 'Caisse', mobile: 'Mobile Money', od: 'Opérations diverses', an: 'À-nouveaux', paie: 'Paie' };
const DEFAULT_JOURNALS = [
  { code: 'VT', label: 'Ventes et appels de fonds', kind: 'vente' },
  { code: 'AC', label: 'Achats et sous-traitance', kind: 'achat' },
  { code: 'BQ', label: 'Banque principale', kind: 'banque', account: '521100' },
  { code: 'CA', label: 'Caisse', kind: 'caisse', account: '571100' },
  { code: 'MM', label: 'Mobile Money', kind: 'mobile', account: '552100' },
  { code: 'OD', label: 'Opérations diverses', kind: 'od' },
  { code: 'AN', label: 'À-nouveaux (soldes d’ouverture)', kind: 'an' },
  { code: 'PA', label: 'Paie', kind: 'paie' },
];

// Journal de trésorerie selon le moyen de paiement d'un versement client
const METHOD_JOURNAL = { virement: 'BQ', cheque: 'BQ', mobile_money: 'MM', especes: 'CA', autre: 'BQ' };

/**
 * Réglages par défaut (modifiables par le comptable). Constatation du chiffre d'affaires :
 *  - VEFA « avancement » : chaque appel de fonds émis est facturé (411 / 702) ; « livraison » : avances (4191) jusqu'au
 *    procès-verbal de livraison (l'acte notarié de VEFA est signé dès le départ).
 *  - Échéancier « acte » : les versements sont des avances (4191) jusqu'à l'acte définitif, où la vente est constatée ;
 *    « encaissement » : chaque versement constate directement la vente.
 * TVA sur ventes à 0 % par défaut : le régime des ventes de logements et de terrains est à confirmer par le comptable.
 */
const DEFAULT_SETTINGS = {
  revenue_vefa: 'avancement',
  revenue_echeancier: 'acte',
  vat_sales_rate: 0,
  vat_purchases_rate: 18,
  auto_validate: false,
  accounts: {
    client: '4111', client_advance: '4191', supplier: '4011', vat_collected: '4431', vat_deductible: '4452',
    sale_housing: '702110', sale_land: '702120', expense_default: '621100', opening_balance: '471',
    // Parc auto et matériel (choix du client du 23/10) : charge de chaque nature de dépense, carte carburant prépayée
    parc_carburant: '605', parc_entretien: '624', parc_reparation: '624', parc_pneus: '624', parc_location: '622',
    parc_assurance: '625', parc_taxes: '645', parc_autre: '605', fuel_card: '4091',
    // Immobilisations du parc : compte d'actif par sorte de bien, amortissements, dotations, sorties d'actif
    immo_vehicule: '245', immo_engin: '241', immo_materiel: '241', immo_informatique: '244', immo_autre: '241',
    depreciation: '284', depreciation_expense: '681', disposal_value: '81', disposal_income: '82',
  },
  // Durée d'amortissement linéaire par sorte de bien (années), modifiable sur chaque bien
  depreciation_years: { vehicule: 4, engin: 5, materiel: 5, informatique: 3, autre: 5 },
  sage: { separator: ';', date_format: 'JJMMAAAA', decimal: ',', header: true },
};
const REVENUE_MODES = {
  vefa: { avancement: 'À l’avancement : chaque appel de fonds émis est facturé (411 / 702)', livraison: 'À la livraison : avances clients (4191) jusqu’au procès-verbal de livraison' },
  echeancier: { acte: 'À l’acte définitif (date de signature du dossier) : avances clients (4191) jusque-là', encaissement: 'À l’encaissement : chaque versement constate la vente' },
};

const accountClass = code => Number(String(code)[0]);

/** Une écriture est équilibrée (total débit = total crédit, montants positifs, au moins deux lignes). */
function checkEntry(lines) {
  const errors = [];
  if (!Array.isArray(lines) || lines.length < 2) errors.push('Une écriture compte au moins deux lignes.');
  let debit = 0, credit = 0;
  for (const l of lines || []) {
    const d = Number(l.debit) || 0, c = Number(l.credit) || 0;
    if (d < 0 || c < 0) errors.push('Les montants doivent être positifs.');
    if (d > 0 && c > 0) errors.push('Une ligne est soit au débit, soit au crédit.');
    if (!d && !c) errors.push('Chaque ligne doit porter un montant.');
    if (!Number.isInteger(d) || !Number.isInteger(c)) errors.push('Les montants sont en francs CFA entiers.');
    debit += d; credit += c;
  }
  if (debit !== credit) errors.push(`Écriture déséquilibrée : débit ${debit.toLocaleString('fr-FR')} ≠ crédit ${credit.toLocaleString('fr-FR')}.`);
  return [...new Set(errors)];
}

/** Montant TTC → HT + TVA (arrondis au franc). */
function splitVat(ttc, rate) {
  const r = Number(rate) || 0;
  const ht = r ? Math.round(ttc / (1 + r / 100)) : ttc;
  return { ht, vat: ttc - ht };
}

/**
 * Regroupements simplifiés du bilan et du compte de résultat (présentation SYSCOHADA, système normal).
 * `prefixes` : comptes concernés ; le signe dépend du côté du solde. À affiner avec le comptable.
 */
const BALANCE_SHEET = {
  actif: [
    { key: 'immo', label: 'Immobilisations (nettes)', prefixes: ['2'] },
    { key: 'stocks', label: 'Stocks et en-cours (programmes, terrains, biens achevés)', prefixes: ['3'] },
    { key: 'creances', label: 'Créances clients et autres débiteurs', prefixes: ['4'], side: 'debit' },
    { key: 'tresorerie_actif', label: 'Trésorerie — actif (banques, caisse, Mobile Money)', prefixes: ['5'], side: 'debit' },
  ],
  passif: [
    { key: 'capitaux', label: 'Capitaux propres et ressources assimilées', prefixes: ['10', '11', '12', '13', '14', '15'] },
    { key: 'dettes_fin', label: 'Dettes financières et provisions', prefixes: ['16', '17', '18', '19'] },
    { key: 'dettes', label: 'Dettes fournisseurs, sociales, fiscales, avances clients', prefixes: ['4'], side: 'credit' },
    { key: 'tresorerie_passif', label: 'Trésorerie — passif (découverts, crédits de trésorerie)', prefixes: ['5'], side: 'credit' },
  ],
};
const INCOME_STATEMENT = [
  { key: 'ventes', label: 'Chiffre d’affaires (ventes de logements, terrains, services)', prefixes: ['70'], sign: 1 },
  { key: 'autres_produits', label: 'Autres produits d’exploitation (subventions, production stockée, autres)', prefixes: ['71', '72', '73', '75', '78', '79'], sign: 1 },
  { key: 'achats', label: 'Achats et variations de stocks', prefixes: ['60'], sign: -1 },
  { key: 'services', label: 'Transports, services extérieurs et sous-traitance', prefixes: ['61', '62', '63'], sign: -1 },
  { key: 'impots', label: 'Impôts et taxes', prefixes: ['64'], sign: -1 },
  { key: 'personnel', label: 'Charges de personnel', prefixes: ['66'], sign: -1 },
  { key: 'autres_charges', label: 'Autres charges, amortissements et provisions', prefixes: ['65', '68', '69'], sign: -1 },
  { key: 'financier', label: 'Résultat financier', prefixes: ['67', '77'], sign: 1 },
  { key: 'hao', label: 'Résultat hors activités ordinaires', prefixes: ['81', '82', '83', '84', '85', '86', '88'], sign: 1 },
  { key: 'impot_resultat', label: 'Participation et impôts sur le résultat', prefixes: ['87', '89'], sign: -1 },
];

/** Date pour l'export Sage selon le format choisi dans le « format paramétrable ». */
function sageDate(iso, format = 'JJMMAAAA') {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return { JJMMAAAA: `${d}${m}${y}`, JJMMAA: `${d}${m}${y.slice(2)}`, AAAAMMJJ: `${y}${m}${d}`, 'JJ/MM/AAAA': `${d}/${m}/${y}` }[format] || `${d}${m}${y}`;
}

module.exports = {
  SYSCOHADA_ACCOUNTS, PARTNER_ACCOUNTS, partnerKindOf, JOURNAL_KINDS, DEFAULT_JOURNALS, METHOD_JOURNAL, DEFAULT_SETTINGS, REVENUE_MODES,
  accountClass, checkEntry, splitVat, BALANCE_SHEET, INCOME_STATEMENT, sageDate,
};
