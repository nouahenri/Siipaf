/**
 * Liasse fiscale DGI (SYSCOHADA révisé, système normal) : structure des états, reprise du modèle Excel que tenait la
 * Comptabilité. Les postes (AE, AF… TA, RA…) et leurs comptes sont dans liasse-postes.json (scripts/liasse-extraire-postes.js) ;
 * ici, l'ordre des lignes, les libellés officiels, les notes annexes et les totaux.
 *
 * `sum` : total des lignes citées ; `poste` : ligne alimentée par un poste du modèle.
 */
const POSTES = require('./liasse-postes.json');

const ACTIF = [
  { ref: 'AD', label: 'IMMOBILISATIONS INCORPORELLES', note: '3', sum: ['AE', 'AF', 'AG', 'AH'] },
  { ref: 'AE', label: 'Frais de développement et de prospection' },
  { ref: 'AF', label: 'Brevets, licences, logiciels et droits similaires' },
  { ref: 'AG', label: 'Fonds commercial et droit au bail' },
  { ref: 'AH', label: 'Autres immobilisations incorporelles' },
  { ref: 'AI', label: 'IMMOBILISATIONS CORPORELLES', note: '3', sum: ['AJ', 'AK', 'AL', 'AM', 'AN'] },
  { ref: 'AJ', label: 'Terrains' },
  { ref: 'AK', label: 'Bâtiments' },
  { ref: 'AL', label: 'Aménagements, agencements et installations' },
  { ref: 'AM', label: 'Matériel, mobilier et actifs biologiques' },
  { ref: 'AN', label: 'Matériel de transport' },
  { ref: 'AP', label: 'AVANCES ET ACOMPTES VERSÉS SUR IMMOBILISATIONS', note: '3', strong: true },
  { ref: 'AQ', label: 'IMMOBILISATIONS FINANCIÈRES', note: '4', sum: ['AR', 'AS'] },
  { ref: 'AR', label: 'Titres de participation' },
  { ref: 'AS', label: 'Autres immobilisations financières' },
  { ref: 'AZ', label: 'TOTAL ACTIF IMMOBILISÉ', sum: ['AD', 'AI', 'AP', 'AQ'], total: true },
  { ref: 'BA', label: 'ACTIF CIRCULANT HAO', note: '5', strong: true },
  { ref: 'BB', label: 'STOCKS ET ENCOURS', note: '6', strong: true },
  { ref: 'BG', label: 'CRÉANCES ET EMPLOIS ASSIMILÉS', sum: ['BH', 'BI', 'BJ'] },
  { ref: 'BH', label: 'Fournisseurs, avances versées', note: '17' },
  { ref: 'BI', label: 'Clients', note: '7' },
  { ref: 'BJ', label: 'Autres créances', note: '8' },
  { ref: 'BK', label: 'TOTAL ACTIF CIRCULANT', sum: ['BA', 'BB', 'BG'], total: true },
  { ref: 'BQ', label: 'Titres de placement', note: '9' },
  { ref: 'BR', label: 'Valeurs à encaisser', note: '10' },
  { ref: 'BS', label: 'Banques, chèques postaux, caisse et assimilés', note: '11' },
  { ref: 'BT', label: 'TOTAL TRÉSORERIE-ACTIF', sum: ['BQ', 'BR', 'BS'], total: true },
  { ref: 'BU', label: 'Écart de conversion-Actif', note: '12' },
  { ref: 'BZ', label: 'TOTAL GÉNÉRAL', sum: ['AZ', 'BK', 'BT', 'BU'], total: true, grand: true },
];

const PASSIF = [
  { ref: 'CA', label: 'Capital', note: '13' },
  { ref: 'CB', label: 'Apporteurs capital non appelé (−)', note: '13' },
  { ref: 'CD', label: 'Primes liées au capital social', note: '14' },
  { ref: 'CE', label: 'Écarts de réévaluation', note: '3e' },
  { ref: 'CF', label: 'Réserves indisponibles', note: '14' },
  { ref: 'CG', label: 'Réserves libres', note: '14' },
  { ref: 'CH', label: 'Report à nouveau (+ ou −)', note: '14' },
  { ref: 'CJ', label: 'Résultat net de l’exercice (bénéfice + ou perte −)' },
  { ref: 'CL', label: 'Subventions d’investissement', note: '15' },
  { ref: 'CM', label: 'Provisions réglementées', note: '15' },
  { ref: 'CP', label: 'TOTAL CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES', sum: ['CA', 'CB', 'CD', 'CE', 'CF', 'CG', 'CH', 'CJ', 'CL', 'CM'], total: true },
  { ref: 'DA', label: 'Emprunts et dettes financières diverses', note: '16' },
  { ref: 'DB', label: 'Dettes de location-acquisition', note: '16' },
  { ref: 'DC', label: 'Provisions pour risques et charges', note: '16' },
  { ref: 'DD', label: 'TOTAL DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES', sum: ['DA', 'DB', 'DC'], total: true },
  { ref: 'DF', label: 'TOTAL RESSOURCES STABLES', sum: ['CP', 'DD'], total: true },
  { ref: 'DH', label: 'Dettes circulantes HAO', note: '5' },
  { ref: 'DI', label: 'Clients, avances reçues', note: '7' },
  { ref: 'DJ', label: 'Fournisseurs d’exploitation', note: '17' },
  { ref: 'DK', label: 'Dettes fiscales et sociales', note: '18' },
  { ref: 'DM', label: 'Autres dettes', note: '19' },
  { ref: 'DN', label: 'Provisions pour risques et charges à court terme', note: '19' },
  { ref: 'DP', label: 'TOTAL PASSIF CIRCULANT', sum: ['DH', 'DI', 'DJ', 'DK', 'DM', 'DN'], total: true },
  { ref: 'DQ', label: 'Banques, crédits d’escompte', note: '20' },
  { ref: 'DR', label: 'Banques, établissements financiers et crédits de trésorerie', note: '20' },
  { ref: 'DT', label: 'TOTAL TRÉSORERIE-PASSIF', sum: ['DQ', 'DR'], total: true },
  { ref: 'DV', label: 'Écart de conversion-Passif', note: '12' },
  { ref: 'DZ', label: 'TOTAL GÉNÉRAL', sum: ['DF', 'DP', 'DT', 'DV'], total: true, grand: true },
];

// Compte de résultat : `side` charge (montant négatif) ou produit (positif), comme le modèle DGI
const RESULTAT = [
  { ref: 'TA', label: 'Ventes de marchandises', note: '21', side: 'produit' },
  { ref: 'RA', label: 'Achats de marchandises', note: '22', side: 'charge' },
  { ref: 'RB', label: 'Variation de stocks de marchandises', note: '6', side: 'charge' },
  { ref: 'XA', label: 'MARGE COMMERCIALE (somme TA à RB)', sum: ['TA', 'RA', 'RB'], total: true },
  { ref: 'TB', label: 'Ventes de produits fabriqués', note: '21', side: 'produit' },
  { ref: 'TC', label: 'Travaux, services vendus', note: '21', side: 'produit' },
  { ref: 'TD', label: 'Produits accessoires', note: '21', side: 'produit' },
  { ref: 'XB', label: 'CHIFFRE D’AFFAIRES (A + B + C + D)', sum: ['TA', 'TB', 'TC', 'TD'], total: true },
  { ref: 'TE', label: 'Production stockée (ou déstockage)', note: '6', side: 'produit' },
  { ref: 'TF', label: 'Production immobilisée', note: '21', side: 'produit' },
  { ref: 'TG', label: 'Subventions d’exploitation', note: '21', side: 'produit' },
  { ref: 'TH', label: 'Autres produits', note: '21', side: 'produit' },
  { ref: 'TI', label: 'Transferts de charges d’exploitation', note: '12', side: 'produit' },
  { ref: 'RC', label: 'Achats de matières premières et fournitures liées', note: '22', side: 'charge' },
  { ref: 'RD', label: 'Variation de stocks de matières premières et fournitures liées', note: '6', side: 'charge' },
  { ref: 'RE', label: 'Autres achats', note: '22', side: 'charge' },
  { ref: 'RF', label: 'Variation de stocks d’autres approvisionnements', note: '6', side: 'charge' },
  { ref: 'RG', label: 'Transports', note: '23', side: 'charge' },
  { ref: 'RH', label: 'Services extérieurs', note: '24', side: 'charge' },
  { ref: 'RI', label: 'Impôts et taxes', note: '25', side: 'charge' },
  { ref: 'RJ', label: 'Autres charges', note: '26', side: 'charge' },
  { ref: 'XC', label: 'VALEUR AJOUTÉE (XB + RA + RB) + (somme TE à RJ)', sum: ['XB', 'RA', 'RB', 'TE', 'TF', 'TG', 'TH', 'TI', 'RC', 'RD', 'RE', 'RF', 'RG', 'RH', 'RI', 'RJ'], total: true },
  { ref: 'RK', label: 'Charges de personnel', note: '27', side: 'charge' },
  { ref: 'XD', label: 'EXCÉDENT BRUT D’EXPLOITATION (XC + RK)', sum: ['XC', 'RK'], total: true },
  { ref: 'TJ', label: 'Reprises d’amortissements, provisions et dépréciations', note: '28', side: 'produit' },
  { ref: 'RL', label: 'Dotations aux amortissements, aux provisions et dépréciations', note: '3C & 28', side: 'charge' },
  { ref: 'XE', label: 'RÉSULTAT D’EXPLOITATION (XD + TJ + RL)', sum: ['XD', 'TJ', 'RL'], total: true },
  { ref: 'TK', label: 'Revenus financiers et assimilés', note: '29', side: 'produit' },
  { ref: 'TL', label: 'Reprises de provisions et dépréciations financières', note: '28', side: 'produit' },
  { ref: 'TM', label: 'Transferts de charges financières', note: '12', side: 'produit' },
  { ref: 'RM', label: 'Frais financiers et charges assimilées', note: '29', side: 'charge' },
  { ref: 'RN', label: 'Dotations aux provisions et aux dépréciations financières', note: '3C & 28', side: 'charge' },
  { ref: 'XF', label: 'RÉSULTAT FINANCIER (somme TK à RN)', sum: ['TK', 'TL', 'TM', 'RM', 'RN'], total: true },
  { ref: 'XG', label: 'RÉSULTAT DES ACTIVITÉS ORDINAIRES (XE + XF)', sum: ['XE', 'XF'], total: true },
  { ref: 'TN', label: 'Produits des cessions d’immobilisations', note: '3D', side: 'produit' },
  { ref: 'TO', label: 'Autres produits HAO', note: '30', side: 'produit' },
  { ref: 'RO', label: 'Valeurs comptables des cessions d’immobilisations', note: '3D', side: 'charge' },
  { ref: 'RP', label: 'Autres charges HAO', note: '30', side: 'charge' },
  { ref: 'XH', label: 'RÉSULTAT HORS ACTIVITÉS ORDINAIRES (somme TN à RP)', sum: ['TN', 'TO', 'RO', 'RP'], total: true },
  { ref: 'RQ', label: 'Participation des travailleurs', note: '30', side: 'charge' },
  { ref: 'RS', label: 'Impôts sur le résultat', note: '37', side: 'charge' },
  { ref: 'XI', label: 'RÉSULTAT NET (XG + XH + RQ + RS)', sum: ['XG', 'XH', 'RQ', 'RS'], total: true, grand: true },
];

// Tableau des flux de trésorerie ; FF à FQ : renseignements de l'exercice (proposés depuis les écritures, modifiables)
const TFT = [
  { ref: 'ZA', label: 'Trésorerie nette au 1er janvier (trésorerie actif N-1 − trésorerie passif N-1)', letter: 'A', total: true },
  { section: 'Flux de trésorerie provenant des activités opérationnelles' },
  { ref: 'FA', label: 'Capacité d’autofinancement globale (CAFG)' },
  { ref: 'FB', label: '− Variation d’actif circulant HAO' },
  { ref: 'FC', label: '− Variation des stocks' },
  { ref: 'FD', label: '− Variation des créances' },
  { ref: 'FE', label: '+ Variation du passif circulant' },
  { ref: 'ZB', label: 'Flux de trésorerie provenant des activités opérationnelles (somme FA à FE)', letter: 'B', sum: ['FA', 'FB', 'FC', 'FD', 'FE'], total: true },
  { section: 'Flux de trésorerie provenant des activités d’investissement' },
  { ref: 'FF', label: '− Décaissements liés aux acquisitions d’immobilisations incorporelles', input: true, sign: -1 },
  { ref: 'FG', label: '− Décaissements liés aux acquisitions d’immobilisations corporelles', input: true, sign: -1 },
  { ref: 'FH', label: '− Décaissements liés aux acquisitions d’immobilisations financières', input: true, sign: -1 },
  { ref: 'FI', label: '+ Encaissements liés aux cessions d’immobilisations incorporelles et corporelles', input: true, sign: 1 },
  { ref: 'FJ', label: '+ Encaissements liés aux cessions d’immobilisations financières', input: true, sign: 1 },
  { ref: 'ZC', label: 'Flux de trésorerie provenant des activités d’investissement (somme FF à FJ)', letter: 'C', sum: ['FF', 'FG', 'FH', 'FI', 'FJ'], total: true },
  { section: 'Flux de trésorerie provenant du financement par les capitaux propres' },
  { ref: 'FK', label: '+ Augmentations de capital par apports nouveaux', input: true, sign: 1 },
  { ref: 'FL', label: '+ Subventions d’investissement reçues', input: true, sign: 1 },
  { ref: 'FM', label: '− Prélèvements sur le capital', input: true, sign: -1 },
  { ref: 'FN', label: '− Dividendes versés', input: true, sign: -1 },
  { ref: 'ZD', label: 'Flux de trésorerie provenant des capitaux propres (somme FK à FN)', letter: 'D', sum: ['FK', 'FL', 'FM', 'FN'], total: true },
  { section: 'Trésorerie provenant du financement par les capitaux étrangers' },
  { ref: 'FO', label: '+ Emprunts (comptes 161, 162, 1661, 1662)', input: true, sign: 1 },
  { ref: 'FP', label: '+ Autres dettes financières diverses', input: true, sign: 1 },
  { ref: 'FQ', label: '− Remboursements des emprunts et autres dettes financières', input: true, sign: -1 },
  { ref: 'ZE', label: 'Flux de trésorerie provenant des capitaux étrangers (somme FO à FQ)', letter: 'E', sum: ['FO', 'FP', 'FQ'], total: true },
  { ref: 'ZF', label: 'Flux de trésorerie provenant des activités de financement (D + E)', letter: 'F', sum: ['ZD', 'ZE'], total: true },
  { ref: 'ZG', label: 'VARIATION DE LA TRÉSORERIE NETTE DE LA PÉRIODE (B + C + F)', letter: 'G', sum: ['ZB', 'ZC', 'ZF'], total: true },
  { ref: 'ZH', label: 'Trésorerie nette au 31 décembre (G + A)', letter: 'H', sum: ['ZG', 'ZA'], total: true, grand: true },
];

/**
 * Renseignements du TFT proposés depuis les mouvements de l'exercice (hors à-nouveaux) : racines de comptes et sens.
 * Montants positifs ; le signe de la ligne s'applique au calcul.
 */
const TFT_INPUTS = {
  FF: { label: 'Acquisitions d’immobilisations incorporelles', roots: ['21'], side: 'debit' },
  FG: { label: 'Acquisitions d’immobilisations corporelles', roots: ['22', '23', '24'], side: 'debit' },
  FH: { label: 'Acquisitions d’immobilisations financières', roots: ['26', '27'], side: 'debit' },
  FI: { label: 'Cessions d’immobilisations incorporelles et corporelles (prix)', roots: ['82'], except: ['826'], side: 'credit' },
  FJ: { label: 'Cessions d’immobilisations financières (prix)', roots: ['826'], side: 'credit' },
  FK: { label: 'Augmentations de capital par apports nouveaux', roots: ['101', '102', '103', '105'], side: 'credit' },
  FL: { label: 'Subventions d’investissement reçues', roots: ['14'], side: 'credit' },
  FM: { label: 'Prélèvements sur le capital', roots: ['104'], side: 'debit' },
  FN: { label: 'Dividendes versés', roots: ['465'], side: 'debit' },
  FO: { label: 'Emprunts reçus', roots: ['161', '162', '1661', '1662'], side: 'credit' },
  FP: { label: 'Autres dettes financières reçues', roots: ['16', '17'], except: ['161', '162', '1661', '1662', '166'], side: 'credit' },
  FQ: { label: 'Remboursements d’emprunts et de dettes financières', roots: ['16', '17'], except: ['166'], side: 'debit' },
};

// Fiche d'identification de l'entité (page de garde de la liasse, feuille « Présentation_Entité » du modèle)
const IDENTITY_FIELDS = {
  denomination: 'Dénomination sociale', sigle: 'Sigle usuel', boite_postale: 'Boîte postale', adresse: 'Adresse géographique complète',
  ntd: 'N° de télédéclarant (NTD)', ncc: 'N° de compte contribuable / identification fiscale (NCC)', rccm: 'N° RCCM', cnps: 'N° CNPS',
  centre_impots: 'Centre des impôts', activite: 'Activité principale', regime: 'Régime d’imposition',
};
const DEFAULT_IDENTITY = {
  denomination: 'SIIPAF SA', sigle: 'SIIPAF SA', boite_postale: '01 BP 6801 ABIDJAN 01', adresse: 'ANGRE 7ème TRANCHE EN FACE DU STADE D’ANGRE / COCODY-ABIDJAN',
  ntd: '9288884447586', ncc: '', rccm: 'CI-ABJ-03-2020-B14-13148', cnps: '', centre_impots: 'II PLATEAUX 1', activite: 'Promotion et aménagement immobiliers', regime: 'Réel normal',
};

module.exports = { POSTES, ACTIF, PASSIF, RESULTAT, TFT, TFT_INPUTS, IDENTITY_FIELDS, DEFAULT_IDENTITY };
