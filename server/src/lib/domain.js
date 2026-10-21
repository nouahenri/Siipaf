/**
 * Règles métier SIIPAF partagées par la base, l'API et (plus tard) les interfaces.
 */

const LOT_STATUSES = ['disponible', 'option', 'reserve', 'vendu', 'desistement', 'bloque'];

const LOT_STATUS_LABELS = {
  disponible: 'Disponible',
  option: 'Option (pré-réservé)',
  reserve: 'Réservé',
  vendu: 'Vendu',
  desistement: 'Désistement — de nouveau disponible',
  bloque: 'Non commercialisé',
};

// Un lot ne se supprime que s'il est disponible ou non commercialisé ET n'a jamais eu de dossier d'acquisition
const DELETABLE_LOT_STATUSES = ['disponible', 'bloque'];
// Statut d'un lot créé à la main
const NEW_LOT_STATUSES = ['disponible', 'bloque'];

// Statuts sur lesquels un visiteur peut manifester un intérêt ou pré-réserver
const SELLABLE_STATUSES = ['disponible', 'desistement'];

/**
 * Transitions autorisées. `superAdminOnly` : seul le super administrateur peut l'effectuer.
 * Les options passent à « disponible » automatiquement à expiration.
 */
const LOT_TRANSITIONS = {
  disponible: { option: {}, reserve: {}, bloque: {} },
  option: { disponible: {}, reserve: {} },
  reserve: { vendu: {}, desistement: {}, disponible: {} },
  vendu: { desistement: { superAdminOnly: true } },
  desistement: { option: {}, reserve: {}, disponible: {} },
  bloque: { disponible: {} },
};

// Types de projets : promotions immobilières (logements) et lotissements (terrains nus)
const PROJECT_CATEGORIES = {
  social: 'Logement social',
  social_haut_standing: 'Logement social & haut standing',
  haut_standing: 'Haut standing',
  lotissement: 'Lotissement (terrains)',
};

/**
 * Listes de référence gérées dans Paramètres (menus déroulants et cases à cocher des projets).
 * - localisation : rattachée à une ville (parent) ;
 * - feature : se coche sur un projet (équipements, commodités, viabilisation) ;
 * - states : la case cochée porte aussi un état d'avancement (viabilisation d'un lotissement).
 * Une valeur utilisée par un projet ne se supprime pas : on l'archive (elle n'est plus proposée
 * mais reste sur les projets qui l'ont). Renommer une valeur met à jour les projets concernés.
 */
const REF_KINDS = {
  ville: { label: 'Villes', one: 'ville' },
  localisation: { label: 'Localisations', one: 'localisation', parent: 'ville' },
  equipement: { label: 'Équipements', one: 'équipement', feature: true },
  commodite: { label: 'Commodités à proximité', one: 'commodité', feature: true },
  viabilisation: { label: 'Éléments de viabilisation', one: 'élément de viabilisation', feature: true, states: true },
  type_bien: { label: 'Types de biens', one: 'type de bien' },
};
const FEATURE_KINDS = Object.keys(REF_KINDS).filter(k => REF_KINDS[k].feature);
const VIABILISATION_STATES = { prevu: 'Prévu', en_cours: 'En cours', fait: 'Réalisé' };

// Réglages généraux (Paramètres › Général) : clé → valeur par défaut
const APP_SETTINGS = {
  option_days_default: { label: 'Durée d’une pré-réservation (jours)', min: 1, max: 60 },
};
const THEMES = ['clair', 'sombre', 'systeme'];

// Circuit de vente : Prospection → Visite → Décision → Choix du bien → Paiement → Contrat → Notaire → Livraison → SAV
const LEAD_STAGES = ['prospection', 'visite', 'decision', 'choix_bien', 'paiement', 'contrat', 'notaire', 'livraison', 'sav', 'perdu'];

// Dossier d'acquisition d'un lot
const SALE_STATUSES = ['en_cours', 'solde', 'desiste'];
const PAYMENT_METHODS = ['virement', 'mobile_money', 'especes', 'cheque', 'autre'];
const DOCUMENT_STATUSES = ['a_fournir', 'en_cours', 'signe', 'delivre'];
const DOCUMENT_TYPES = [
  'contrat_reservation', 'contrat_vente', 'attestation_attribution', 'acd', 'acte_notarie',
  'permis_construire', 'plan', 'proces_verbal_livraison', 'recu', 'autre',
];
// Pièces créées automatiquement à l'ouverture d'un dossier (ordre du parcours)
const DEFAULT_DOCUMENTS = [
  ['contrat_reservation', 'Contrat de réservation', 'en_cours'],
  ['attestation_attribution', 'Attestation d’attribution', 'a_fournir'],
  ['contrat_vente', 'Contrat de vente', 'a_fournir'],
  ['acd', 'Arrêté de Concession Définitive (ACD)', 'a_fournir'],
  ['acte_notarie', 'Acte notarié', 'a_fournir'],
  ['proces_verbal_livraison', 'Procès-verbal de livraison', 'a_fournir'],
];

// ─── Espace client ─────────────────────────────────────────

/**
 * Modalités de financement (page Financement du site) qui servent à générer l'échéancier.
 * deposit_pct : part payée à la signature ; months : nombre de mensualités pour le reste ;
 * first_month_offset : 0 = première mensualité dès la signature, 1 = un mois après.
 * Crédit bancaire : apport de 30 % puis solde versé par la banque (délai à confirmer avec SIIPAF).
 */
const FINANCING_PLANS = {
  apport: { label: 'Apport initial 30 % + 36 mensualités', deposit_pct: 30, months: 36, first_month_offset: 1 },
  diaspora: { label: 'Diaspora — sans apport, 36 mensualités', deposit_pct: 0, months: 36, first_month_offset: 0 },
  comptant: { label: 'Paiement comptant', deposit_pct: 100, months: 0, first_month_offset: 0 },
  credit: { label: 'Apport 30 % + crédit bancaire', deposit_pct: 30, months: 0, bank_months: 2 },
};
const FINANCINGS = Object.keys(FINANCING_PLANS);
const SCHEDULE_KINDS = ['apport', 'mensualite', 'solde'];
// État d'une échéance, calculé en imputant les versements dans l'ordre des échéances
const INSTALLMENT_STATUS_LABELS = { payee: 'Payée', partielle: 'Partiellement payée', en_retard: 'En retard', a_venir: 'À venir' };

// Étapes du chantier montrées aux clients (frise de l'espace client)
const SITE_STAGES = ['etudes', 'terrassement', 'vrd', 'fondations', 'gros_oeuvre', 'toiture', 'second_oeuvre', 'finitions', 'livraison'];
const SITE_STAGE_LABELS = {
  etudes: 'Études et autorisations',
  terrassement: 'Terrassement',
  vrd: 'Voirie et réseaux (VRD)',
  fondations: 'Fondations',
  gros_oeuvre: 'Gros œuvre',
  toiture: 'Toiture',
  second_oeuvre: 'Second œuvre',
  finitions: 'Finitions',
  livraison: 'Livraison',
};

const MESSAGE_SENDERS = ['client', 'equipe'];
const CLIENT_PASSWORD_MIN = 10;
const CLIENT_RESET_HOURS = 1;
// Dossiers visibles dans l'espace client (un dossier désisté n'y apparaît plus)
const CLIENT_VISIBLE_SALE_STATUSES = ['en_cours', 'solde'];

/**
 * Clé de comparaison d'un numéro de téléphone : ses 9 derniers chiffres, ce qui fait correspondre
 * +225 07 08 97 26 71, 2250708972671 et 0708972671 (et +33 6… / 06… pour la diaspora).
 * null si le numéro est trop court pour être fiable.
 */
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-9) : null;
}
// Un identifiant de connexion client est un code client s'il commence par des lettres, sinon un téléphone
const looksLikeClientCode = s => /^[A-Za-z]/.test(String(s || '').trim());

const isoDate = d => d.toISOString().slice(0, 10);

/** Ajoute des mois à une date « AAAA-MM-JJ » en restant sur le dernier jour du mois au besoin (31/01 → 28/02). */
function addMonths(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))));
}

/** Répartit `total` en `n` parts entières ; la dernière absorbe l'arrondi pour que la somme tombe juste. */
function split(total, n) {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * (n - 1) : base));
}

/**
 * Échéancier d'un dossier : liste ordonnée { seq, kind, label, due_date, amount_fcfa } dont la somme
 * vaut exactement le prix. `options` peut surcharger deposit_pct et months. Sans financement : [].
 */
function buildSchedule({ price_fcfa, financing, start_date, options = {} }) {
  const plan = FINANCING_PLANS[financing];
  const price = Number(price_fcfa);
  if (!plan || !price) return [];
  const pct = options.deposit_pct ?? plan.deposit_pct;
  const months = options.months ?? plan.months;
  const lines = [];
  const deposit = months || plan.bank_months ? Math.round((price * pct) / 100) : price;
  if (deposit > 0) {
    const kind = deposit === price ? 'solde' : 'apport';
    lines.push({ kind, label: kind === 'solde' ? 'Paiement comptant' : `Apport initial (${pct} %)`, due_date: start_date, amount_fcfa: deposit });
  }
  const rest = price - deposit;
  if (rest > 0 && months > 0) {
    const offset = plan.first_month_offset ?? 1;
    split(rest, months).forEach((amount, i) => lines.push({
      kind: 'mensualite', label: `Mensualité ${i + 1}/${months}`, due_date: addMonths(start_date, i + offset), amount_fcfa: amount,
    }));
  } else if (rest > 0) {
    lines.push({ kind: 'solde', label: 'Solde — financement bancaire', due_date: addMonths(start_date, plan.bank_months || 1), amount_fcfa: rest });
  }
  return lines.map((l, i) => ({ seq: i + 1, ...l }));
}

/**
 * Impute le total versé sur les échéances dans l'ordre et en déduit l'état de chacune
 * (payée, partiellement payée, en retard, à venir) ainsi que les montants en retard.
 */
function allocatePayments(schedule, paidTotal, today = isoDate(new Date())) {
  let left = Number(paidTotal) || 0;
  let overdue_fcfa = 0;
  let overdue_count = 0;
  let next = null;
  const lines = schedule.map(line => {
    const amount = Number(line.amount_fcfa);
    const covered = Math.min(amount, left);
    left -= covered;
    const due = amount - covered;
    let status = 'payee';
    if (due > 0) status = line.due_date < today ? 'en_retard' : covered > 0 ? 'partielle' : 'a_venir';
    if (status === 'en_retard') { overdue_fcfa += due; overdue_count += 1; }
    if (due > 0 && !next) next = { ...line, remaining_fcfa: due };
    return { ...line, amount_fcfa: amount, paid_fcfa: covered, remaining_fcfa: due, status };
  });
  return { lines, overdue_fcfa, overdue_count, next_due: next };
}

/**
 * Rôles d'origine (« système ») : non supprimables, et point de départ de la table `roles`.
 * La liste complète, rôles créés depuis le dashboard compris, se lit dans la table `roles`
 * (services/roles.js) : ne pas utiliser ROLES pour valider un rôle.
 */
// Rôles qu'on ne peut jamais supprimer (les autres, même d'origine, se suppriment s'ils n'ont plus de compte)
const PROTECTED_ROLES = ['super_admin'];

const ROLES = ['super_admin', 'commercial', 'editeur', 'conducteur_travaux', 'comptable', 'resp_exploitation'];

const ROLE_LABELS = {
  super_admin: 'Super administrateur',
  commercial: 'Commercial',
  editeur: 'Éditeur de contenu',
  conducteur_travaux: 'Conducteur de travaux / Juridique',
  comptable: 'Comptable',
  resp_exploitation: 'Responsable des exploitations',
};

/** Clé technique d'un nouveau rôle tirée de son libellé : « Assistant(e) commercial » → assistant_e_commercial. */
function roleKey(label) {
  const key = String(label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32).replace(/_+$/, '');
  return key || 'role';
}

// Actions de l'espace employé de l'ERP (Mon espace), données à tous les rôles
const SELF_SERVICE = ['self:conges', 'self:pointage', 'self:frais'];
// Actions détaillées des modules de l'ERP (une ligne du catalogue chacune)
const SAV_ACTIONS = ['sav:create', 'sav:handle', 'sav:assign', 'sav:reserves', 'sav:interventions'];
const COMPTA_ACTIONS = ['compta:entries', 'compta:validate', 'achats:write', 'achats:pay', 'frais:post', 'compta:close', 'compta:settings', 'compta:export'];
const PAIE_ACTIONS = ['paie:employees', 'paie:prepare', 'paie:validate', 'paie:pay', 'paie:settings'];
const RH_ACTIONS = ['rh:files', 'conges:approve', 'conges:manage', 'rh:overtime', 'frais:approve', 'recrutement:write', 'formation:write', 'evaluation:write', 'rh:settings'];

/** Droits par défaut des rôles d'origine. Le super administrateur a tous les droits. */
const PERMISSIONS = {
  super_admin: ['*'],
  commercial: [
    'projects:read', 'lots:read', 'lots:status', 'leads:read', 'leads:write',
    'appointments:read', 'appointments:write', 'contacts:read', 'sales:read', 'sales:write',
    'client_access:write', 'client_messages', 'sav:read', 'commercial:read', ...SELF_SERVICE,
  ],
  editeur: [
    'projects:read', 'projects:write', 'plans:write', 'lots:read', 'content:write', 'media:write',
    'newsletter:read', 'newsletter:write', 'newsletter:send', 'contacts:read', 'testimonials:write', 'settings:write', 'property:write', ...SELF_SERVICE,
  ],
  conducteur_travaux: [
    'projects:read', 'lots:read', 'sales:read', 'documents:write', 'site_updates:write', 'client_messages',
    'sav:read', 'sav:create', 'sav:handle', 'sav:reserves', 'sav:interventions', 'vefa:write', 'presence:write', ...SELF_SERVICE,
  ],
  comptable: [
    'projects:read', 'lots:read', 'leads:read', 'appointments:read', 'sales:read', 'payments:write',
    'schedule:write', 'client_messages', 'commercial:read', 'leads:all', 'compta:read', ...COMPTA_ACTIONS,
    'rh:read', ...RH_ACTIONS, 'presence:write', 'paie:read', ...PAIE_ACTIONS, ...SELF_SERVICE,
  ],
  resp_exploitation: [
    'projects:read', 'projects:write', 'plans:write', 'lots:read', 'lots:status', 'leads:read', 'leads:delete',
    'appointments:read', 'contacts:read', 'users:read', 'newsletter:read',
    'sales:read', 'sales:write', 'documents:write', 'testimonials:write',
    'client_access:write', 'client_messages', 'site_updates:write', 'schedule:write', 'settings:write',
    'leads:all', 'sav:read', ...SAV_ACTIONS, 'commercial:read', 'targets:write', 'vefa:write', 'property:write', 'compta:read',
    'rh:read', ...RH_ACTIONS, 'presence:write', ...SELF_SERVICE,
  ],
};

/**
 * Catalogue des privilèges, tel qu'affiché dans « Rôles & privilèges ».
 * Les droits par défaut de chaque rôle (PERMISSIONS ci-dessus) servent de point de départ :
 * le super administrateur peut ensuite les modifier dans le dashboard (table role_permissions)
 * et accorder ou retirer un privilège à un compte précis (table user_permissions).
 */
const PERMISSION_CATALOG = [
  { group: 'Ventes', items: [
    ['leads:read', 'Voir les prospects', 'Liste, fiches et export CSV des prospects'],
    ['leads:all', 'Voir les prospects de toute l’équipe', 'Sans ce droit, on ne voit que ses prospects et ceux qui ne sont pas encore attribués'],
    ['leads:write', 'Gérer les prospects', 'Créer, modifier, faire avancer dans le circuit, assigner'],
    ['leads:delete', 'Supprimer des prospects', 'Doublons ou demande d’effacement ; impossible si la personne a un dossier d’acquisition'],
    ['appointments:read', 'Voir les rendez-vous', null],
    ['appointments:write', 'Gérer les rendez-vous', 'Planifier, confirmer, annuler'],
    ['lots:read', 'Voir les lots', 'Disponibilités, fiche lot, historique'],
    ['lots:status', 'Changer le statut des lots', 'Option, réservation, vente, désistement'],
  ] },
  { group: 'Dossiers d’acquisition', items: [
    ['sales:read', 'Voir les dossiers d’acquisition', 'Acquéreur, prix, paiements, documents'],
    ['sales:write', 'Ouvrir et modifier les dossiers', 'Ouvrir un dossier, changer le prix convenu'],
    ['payments:write', 'Saisir les versements', 'Enregistrer ou supprimer un versement'],
    ['documents:write', 'Gérer les documents juridiques', 'Statut des pièces, fichiers joints, visibilité client'],
  ] },
  { group: 'Espace client', items: [
    ['client_access:write', 'Gérer les accès clients', 'Créer ou réinitialiser le code et le mot de passe d’un client'],
    ['client_messages', 'Messagerie clients', 'Lire les messages des clients et leur répondre'],
    ['site_updates:write', 'Publier l’avancement du chantier', 'Étapes, pourcentages, photos et vidéos'],
    ['schedule:write', 'Gérer les échéanciers', 'Générer et modifier les échéances de paiement'],
  ] },
  { group: 'ERP · Service commercial', items: [
    ['commercial:read', 'Ouvrir le Service commercial', 'Tableau de bord, pipeline, activités, parc, ventes, appels de fonds, objectifs'],
    ['targets:write', 'Fixer les objectifs commerciaux', 'Objectifs mensuels par commercial'],
    ['property:write', 'Structurer le parc immobilier', 'Bâtiments, étages et caractéristiques des lots'],
    ['vefa:write', 'Gérer les appels de fonds VEFA', 'Plans d’appels de fonds et constat d’avancement des travaux'],
  ] },
  { group: 'ERP · Comptabilité', items: [
    ['compta:read', 'Consulter la comptabilité', 'Écritures, états, trésorerie, achats, tableau de bord'],
    ['compta:entries', 'Saisir des écritures', 'Écritures manuelles en brouillon, modification et suppression des brouillons, synchronisation des ventes et versements'],
    ['compta:validate', 'Valider les écritures', 'Numérotation définitive, contrepassation d’une écriture validée'],
    ['achats:write', 'Gérer les achats', 'Fournisseurs, factures d’achat, validation des factures'],
    ['achats:pay', 'Régler les fournisseurs', 'Enregistrer les paiements des factures d’achat'],
    ['frais:post', 'Comptabiliser les notes de frais', 'Passer les notes approuvées en comptabilité et rembourser les employés'],
    ['compta:close', 'Exercices et clôture', 'Créer les exercices, verrouiller une période, clôturer, à-nouveaux, soldes d’ouverture'],
    ['compta:settings', 'Paramétrer la comptabilité', 'Plan comptable, journaux, modes de chiffre d’affaires, TVA, comptes utilisés'],
    ['compta:export', 'Exporter vers Sage', 'Fichier des écritures validées'],
  ] },
  { group: 'ERP · Paie', items: [
    ['paie:read', 'Consulter la paie', 'Salaires, bulletins, livre de paie, déclarations'],
    ['paie:employees', 'Gérer les fiches salariés', 'Création des fiches, contrat, salaire et indemnités, moyen de paiement'],
    ['paie:prepare', 'Préparer la paie', 'Créer la paie du mois, éléments variables, recalcul, suppression d’un brouillon'],
    ['paie:validate', 'Valider la paie', 'Bulletins définitifs et écriture de paie'],
    ['paie:pay', 'Payer les salaires', 'Écritures de paiement (banque, caisse, Mobile Money)'],
    ['paie:settings', 'Régler le barème de paie', 'Taux CNPS, ITS, CMU, taxes, comptes de paie'],
  ] },
  { group: 'ERP · Ressources humaines', items: [
    ['rh:read', 'Voir le personnel', 'Annuaire, dossiers, absences, présences, recrutement, formations, performance (sans les salaires)'],
    ['rh:files', 'Gérer les dossiers du personnel', 'Identité, contrat, responsable direct, documents, carrière, code de pointage'],
    ['conges:approve', 'Approuver les congés', 'Approbation finale ou refus des demandes de tout le personnel'],
    ['conges:manage', 'Gérer les absences', 'Saisir une absence pour un employé, ajuster les soldes, annuler une absence commencée'],
    ['presence:write', 'Pointer le personnel', 'Feuilles de présence de chantier, borne de pointage, corrections des pointages'],
    ['rh:overtime', 'Arrêter les heures supplémentaires', 'Envoi des heures supplémentaires du mois en paie'],
    ['frais:approve', 'Approuver les notes de frais', 'Notes de frais de tout le personnel (le responsable direct approuve celles de son équipe)'],
    ['recrutement:write', 'Gérer le recrutement', 'Postes, publication sur le site, candidatures, entretiens, embauche'],
    ['formation:write', 'Gérer les compétences et formations', 'Référentiel, profils, plan de formation, participants, clôture'],
    ['evaluation:write', 'Évaluer le personnel', 'Objectifs et entretiens de tout le personnel (le responsable direct évalue son équipe)'],
    ['rh:settings', 'Régler les RH', 'Règles des congés, heures supplémentaires, catégories de frais, jours fériés'],
  ] },
  { group: 'ERP · Espace employé', items: [
    ['self:conges', 'Demander des congés', 'Mon espace : demandes de congé et d’absence, justificatifs, auto-évaluation'],
    ['self:pointage', 'Pointer en ligne', 'Mon espace : arrivée et départ, code de la borne de pointage'],
    ['self:frais', 'Saisir des notes de frais', 'Mon espace : dépenses avec reçu, soumission'],
  ] },
  { group: 'ERP · Client & SAV', items: [
    ['sav:read', 'Voir le SAV', 'Réclamations, réserves à la livraison, interventions, indicateurs'],
    ['sav:create', 'Créer des réclamations', 'Ouvrir une réclamation pour un client, à partir d’une réserve'],
    ['sav:handle', 'Traiter les réclamations', 'Modifier, changer de statut, commenter, joindre des photos'],
    ['sav:assign', 'Attribuer les réclamations', 'Choisir le technicien ou le responsable du dossier'],
    ['sav:reserves', 'Gérer les réserves de livraison', 'Date de livraison, saisie et levée des réserves'],
    ['sav:interventions', 'Planifier les interventions', 'Créer, déplacer, clore les interventions'],
  ] },
  { group: 'Catalogue', items: [
    ['projects:read', 'Voir les projets', null],
    ['projects:write', 'Modifier les projets', 'Textes, images, grilles de prix, publication'],
    ['plans:write', 'Éditer les plans de masse', 'Dessiner et importer les lots'],
    ['settings:write', 'Gérer les paramètres', 'Villes, localisations, équipements, commodités, viabilisation, réglages généraux'],
  ] },
  { group: 'Site web', items: [
    ['content:write', 'Modifier le contenu du site', 'Diaporama, bandeau, chiffres clés, coordonnées'],
    ['media:write', 'Gérer la médiathèque', 'Ajouter ou supprimer des fichiers'],
    ['contacts:read', 'Traiter les messages de contact', null],
    ['testimonials:write', 'Modérer les témoignages', 'Publier, refuser, mettre en avant'],
    ['newsletter:read', 'Voir les abonnés newsletter', null],
    ['newsletter:write', 'Gérer la newsletter', 'Abonnés, rédaction des campagnes, e-mail de test'],
    ['newsletter:send', 'Envoyer les campagnes', 'Lancer, suspendre ou annuler l’envoi d’une campagne à tous les abonnés'],
  ] },
  { group: 'Administration', items: [
    ['users:read', 'Voir les utilisateurs', null],
    ['users:write', 'Gérer les utilisateurs', 'Créer des comptes, changer les rôles et mots de passe'],
  ] },
];
const PERMISSION_IDS = PERMISSION_CATALOG.flatMap(g => g.items.map(i => i[0]));

/* ─── ERP · Client & SAV ──────────────────────────────────────────────────── */

// Promotion (maisons livrées) et vente de terrains (lotissements) : SAV_LAND_CATEGORIES concernent les parcelles
const SAV_CATEGORIES = {
  bornage: 'Bornage / implantation des limites',
  foncier: 'ACD, titre foncier, morcellement',
  viabilisation: 'Viabilisation : eau, électricité',
  plomberie: 'Plomberie',
  electricite: 'Électricité',
  maconnerie: 'Maçonnerie / fissures',
  etancheite: 'Étanchéité / infiltrations',
  menuiserie: 'Menuiserie (portes, fenêtres)',
  revetements: 'Carrelage / peinture',
  equipements: 'Sanitaires / équipements',
  vrd: 'Voirie, assainissement, clôture',
  administratif: 'Administratif / documents',
  autre: 'Autre',
};

// Délai de traitement visé selon la priorité (heures calendaires)
const SAV_PRIORITIES = {
  basse: { label: 'Basse', hours: 240 },
  normale: { label: 'Normale', hours: 120 },
  haute: { label: 'Haute', hours: 48 },
  urgente: { label: 'Urgente', hours: 24 },
};

const SAV_STATUSES = ['nouveau', 'qualifie', 'planifie', 'en_cours', 'resolu', 'clos', 'rejete'];
const SAV_STATUS_LABELS = {
  nouveau: 'Nouveau', qualifie: 'Qualifié', planifie: 'Intervention planifiée', en_cours: 'En cours',
  resolu: 'Résolu', clos: 'Clos', rejete: 'Rejeté',
};
const SAV_OPEN_STATUSES = ['nouveau', 'qualifie', 'planifie', 'en_cours'];
// Passages autorisés ; « clos » et « rejeté » peuvent être rouverts
const SAV_TRANSITIONS = {
  nouveau: ['qualifie', 'planifie', 'en_cours', 'resolu', 'rejete'],
  qualifie: ['planifie', 'en_cours', 'resolu', 'rejete'],
  planifie: ['en_cours', 'resolu', 'qualifie'],
  en_cours: ['planifie', 'resolu'],
  resolu: ['clos', 'en_cours'],
  clos: ['en_cours'],
  rejete: ['qualifie'],
};
const SAV_SOURCES = ['client', 'equipe', 'livraison'];

/**
 * Garanties légales de la construction, comptées depuis la livraison (date du PV) :
 * parfait achèvement (1 an, tous désordres), bon fonctionnement (2 ans, équipements dissociables),
 * décennale (10 ans, solidité de l'ouvrage, structure et étanchéité).
 */
const WARRANTIES = {
  parfait_achevement: { label: 'Parfait achèvement', years: 1 },
  biennale: { label: 'Bon fonctionnement (biennale)', years: 2 },
  decennale: { label: 'Décennale', years: 10 },
};
const DECENNALE_CATEGORIES = ['maconnerie', 'etancheite'];
const BIENNALE_CATEGORIES = ['plomberie', 'electricite', 'menuiserie', 'equipements'];
// Terrain : obligations du lotisseur (bornage, documents fonciers, viabilisation promise au cahier des charges),
// sans délai de garantie de construction
const SAV_LAND_CATEGORIES = ['bornage', 'foncier', 'viabilisation', 'vrd'];

/** Garantie applicable à un désordre de catégorie donnée, ou « hors_garantie » / null si pas livré. */
function warrantyFor(category, deliveredAt, today = new Date()) {
  if (SAV_LAND_CATEGORIES.includes(category)) return 'engagement_lotisseur';
  if (!deliveredAt) return null;
  const d = new Date(deliveredAt);
  const until = years => { const x = new Date(d); x.setFullYear(x.getFullYear() + years); return x; };
  if (today <= until(1)) return 'parfait_achevement';
  if (BIENNALE_CATEGORIES.includes(category) && today <= until(2)) return 'biennale';
  if (DECENNALE_CATEGORIES.includes(category) && today <= until(10)) return 'decennale';
  return 'hors_garantie';
}

/** Échéances des trois garanties pour une date de livraison (pour l'affichage). */
function warrantyDates(deliveredAt) {
  if (!deliveredAt) return null;
  return Object.fromEntries(Object.entries(WARRANTIES).map(([k, w]) => {
    const x = new Date(deliveredAt);
    x.setFullYear(x.getFullYear() + w.years);
    return [k, isoDate(x)];
  }));
}

const SAV_RESERVE_STATUSES = ['ouverte', 'levee'];
const SAV_INTERVENTION_STATUSES = ['planifiee', 'realisee', 'annulee'];

function can(role, permission) {
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

/** Vérifie un changement de statut. Renvoie null si autorisé, sinon le motif du refus. */
function checkLotTransition(from, to, role) {
  if (from === to) return 'Le lot a déjà ce statut.';
  const rule = (LOT_TRANSITIONS[from] || {})[to];
  if (!rule) return `Passage de « ${LOT_STATUS_LABELS[from]} » à « ${LOT_STATUS_LABELS[to]} » non autorisé.`;
  if (rule.superAdminOnly && role !== 'super_admin') return 'Seul le super administrateur peut effectuer ce changement.';
  return null;
}

/* ─── ERP · Service commercial ────────────────────────────────────────────────────── */

// Probabilité de conclure par étape du circuit (pipeline pondéré, façon Odoo CRM)
const STAGE_PROBABILITY = {
  prospection: 10, visite: 25, decision: 40, choix_bien: 60, paiement: 75, contrat: 90, notaire: 100, livraison: 100, sav: 100, perdu: 0,
};
// Colonnes du pipeline : de la prospection à la signature chez le notaire
const PIPELINE_STAGES = ['prospection', 'visite', 'decision', 'choix_bien', 'paiement', 'contrat', 'notaire'];
// Étapes où la vente est acquise (contrat signé et au-delà)
const WON_STAGES = ['contrat', 'notaire', 'livraison', 'sav'];

// Motif obligatoire pour classer un prospect « perdu »
const LOST_REASONS = {
  prix: 'Prix ou budget insuffisant',
  financement: 'Financement refusé ou introuvable',
  concurrent: 'Achat chez un concurrent',
  localisation: 'Localisation ne convient pas',
  produit: 'Type de bien ne convient pas',
  delai: 'Délai de livraison trop long',
  injoignable: 'Injoignable / sans réponse',
  report: 'Projet reporté',
  autre: 'Autre',
};

// Activités planifiées ou réalisées avec un prospect
const ACTIVITY_KINDS = {
  appel: 'Appel', whatsapp: 'WhatsApp', email: 'E-mail', visite: 'Visite sur site', reunion: 'Rendez-vous au bureau',
  relance: 'Relance', document: 'Document à obtenir', tache: 'À faire', note: 'Note',
};
const LEAD_KINDS = { acquereur: 'Acquéreur (résidence)', investisseur: 'Investisseur', entreprise: 'Entreprise / institution' };

// Parc immobilier : projet › îlot › bâtiment › étage › lot
const LOT_TYPES = {
  parcelle: 'Parcelle de terrain', villa: 'Villa', duplex: 'Duplex', appartement: 'Appartement',
  studio: 'Studio', commerce: 'Local commercial', bureau: 'Bureau', autre: 'Autre',
};
const BUILDING_KINDS = { immeuble: 'Immeuble collectif', residence: 'Résidence (villas groupées)', bloc: 'Bloc / rangée', autre: 'Autre' };

// Objectifs mensuels par commercial
const TARGET_METRICS = {
  ca_fcfa: 'Chiffre d’affaires signé (FCFA)',
  ventes: 'Ventes (dossiers ouverts)',
  rdv: 'Rendez-vous réalisés',
  encaissements_fcfa: 'Encaissements (FCFA)',
};

/**
 * VEFA — Code de la construction et de l'habitat (loi n° 2019-576), art. 121 et 124 : aucun versement avant la
 * signature (hors dépôt de garantie de réservation), puis plafonds CUMULÉS du prix : 20 % à l'achèvement des
 * fondations, 60 % à la mise hors d'eau, 90 % à l'achèvement des travaux ; le solde à la mise à disposition.
 * Les étapes sont celles du journal de chantier (SITE_STAGES) ; « signature » = acte notarié.
 */
const VEFA_LEGAL_CAPS = [
  { upTo: 'fondations', pct: 20, label: 'achèvement des fondations' },
  { upTo: 'toiture', pct: 60, label: 'mise hors d’eau' },
  { upTo: 'finitions', pct: 90, label: 'achèvement des travaux' },
];
const DEFAULT_VEFA_PLAN = [
  { stage: 'signature', label: 'Signature de l’acte notarié', pct: 10 },
  { stage: 'fondations', label: 'Achèvement des fondations', pct: 10 },
  { stage: 'gros_oeuvre', label: 'Élévation des murs (gros œuvre)', pct: 20 },
  { stage: 'toiture', label: 'Mise hors d’eau (toiture)', pct: 20 },
  { stage: 'finitions', label: 'Achèvement des travaux', pct: 30 },
  { stage: 'livraison', label: 'Remise des clés (solde)', pct: 10 },
];
const VEFA_DUE_DAYS = 15;

const vefaOrder = stage => (stage === 'signature' ? -1 : SITE_STAGES.indexOf(stage));

/** Contrôle un plan d'appels de fonds : étapes connues, ordonnées, total 100 %, plafonds légaux, solde à la livraison. */
function checkVefaPlan(milestones) {
  const errors = [];
  if (!Array.isArray(milestones) || !milestones.length) return ['Le plan doit contenir au moins une étape.'];
  let prev = -2;
  let cumul = 0;
  const seen = new Set();
  for (const m of milestones) {
    const order = vefaOrder(m.stage);
    if (order === -1 && m.stage !== 'signature') { errors.push(`Étape inconnue : ${m.stage}.`); continue; }
    if (order < -1) { errors.push(`Étape inconnue : ${m.stage}.`); continue; }
    if (seen.has(m.stage)) errors.push(`L’étape « ${m.label || m.stage} » apparaît deux fois.`);
    seen.add(m.stage);
    if (order <= prev) errors.push('Les étapes doivent suivre l’ordre du chantier.');
    prev = order;
    if (!(m.pct > 0)) errors.push(`Le pourcentage de « ${m.label || m.stage} » doit être positif.`);
    cumul += Number(m.pct) || 0;
    for (const cap of VEFA_LEGAL_CAPS) {
      if (order <= SITE_STAGES.indexOf(cap.upTo) && cumul > cap.pct + 1e-9) {
        errors.push(`À l’étape « ${m.label || m.stage} », le cumul (${cumul} %) dépasse le plafond légal de ${cap.pct} % à l’${cap.label} (art. 124).`);
      }
    }
  }
  if (Math.abs(cumul - 100) > 1e-9) errors.push(`Le total des appels doit faire 100 % (actuellement ${cumul} %).`);
  if (milestones[milestones.length - 1]?.stage !== 'livraison') errors.push('Le dernier appel (le solde) doit tomber à la livraison.');
  return [...new Set(errors)];
}

/** Montants des appels de fonds : arrondis au franc, le dernier absorbe l'écart d'arrondi. */
function splitVefaAmounts(price, milestones) {
  const p = Number(price);
  let done = 0;
  return milestones.map((m, i) => {
    const amount = i === milestones.length - 1 ? p - done : Math.round((p * m.pct) / 100);
    done += amount;
    return { ...m, amount_fcfa: amount };
  });
}

/**
 * Une étape est constatée achevée quand le chantier en est à l'étape suivante (ou au-delà) ;
 * la livraison, dernière étape, est atteinte dès qu'elle est déclarée. La signature ne dépend pas du chantier.
 */
function milestoneReached(milestoneStage, siteStage) {
  if (milestoneStage === 'signature') return false;
  const m = SITE_STAGES.indexOf(milestoneStage);
  const s = SITE_STAGES.indexOf(siteStage);
  if (m < 0 || s < 0) return false;
  return milestoneStage === 'livraison' ? s === m : s > m;
}

/** État d'une activité planifiée : en retard, aujourd'hui, à venir (pastille du pipeline). */
function activityState(dueAt, today = new Date()) {
  if (!dueAt) return null;
  const d = isoDate(new Date(dueAt));
  const t = isoDate(today);
  return d < t ? 'retard' : d === t ? 'aujourdhui' : 'a_venir';
}

module.exports = {
  SELF_SERVICE, SAV_ACTIONS, COMPTA_ACTIONS, PAIE_ACTIONS, RH_ACTIONS,
  LOT_STATUSES, LOT_STATUS_LABELS, SELLABLE_STATUSES, LOT_TRANSITIONS,
  LEAD_STAGES, ROLES, ROLE_LABELS, PERMISSIONS, roleKey, can, checkLotTransition,
  SALE_STATUSES, PAYMENT_METHODS, DOCUMENT_STATUSES, DOCUMENT_TYPES, DEFAULT_DOCUMENTS,
  PERMISSION_CATALOG, PERMISSION_IDS,
  FINANCING_PLANS, FINANCINGS, SCHEDULE_KINDS, INSTALLMENT_STATUS_LABELS, SITE_STAGES, SITE_STAGE_LABELS,
  MESSAGE_SENDERS, CLIENT_PASSWORD_MIN, CLIENT_RESET_HOURS, CLIENT_VISIBLE_SALE_STATUSES,
  addMonths, buildSchedule, allocatePayments, phoneKey, looksLikeClientCode, PROTECTED_ROLES, DELETABLE_LOT_STATUSES, NEW_LOT_STATUSES, PROJECT_CATEGORIES,
  REF_KINDS, FEATURE_KINDS, VIABILISATION_STATES, APP_SETTINGS, THEMES,
  SAV_CATEGORIES, SAV_PRIORITIES, SAV_STATUSES, SAV_STATUS_LABELS, SAV_OPEN_STATUSES, SAV_TRANSITIONS, SAV_SOURCES,
  WARRANTIES, warrantyFor, warrantyDates, SAV_LAND_CATEGORIES, SAV_RESERVE_STATUSES, SAV_INTERVENTION_STATUSES,
  STAGE_PROBABILITY, PIPELINE_STAGES, WON_STAGES, LOST_REASONS, ACTIVITY_KINDS, LEAD_KINDS, LOT_TYPES, BUILDING_KINDS,
  TARGET_METRICS, VEFA_LEGAL_CAPS, DEFAULT_VEFA_PLAN, VEFA_DUE_DAYS, checkVefaPlan, splitVefaAmounts, milestoneReached, activityState,
};
