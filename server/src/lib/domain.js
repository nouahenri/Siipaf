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

/** Droits par défaut des rôles d'origine. Le super administrateur a tous les droits. */
const PERMISSIONS = {
  super_admin: ['*'],
  commercial: [
    'projects:read', 'lots:read', 'lots:status', 'leads:read', 'leads:write',
    'appointments:read', 'appointments:write', 'contacts:read', 'sales:read', 'sales:write',
    'client_access:write', 'client_messages',
  ],
  editeur: [
    'projects:read', 'projects:write', 'plans:write', 'lots:read', 'content:write', 'media:write',
    'newsletter:read', 'newsletter:write', 'contacts:read', 'testimonials:write', 'settings:write',
  ],
  conducteur_travaux: ['projects:read', 'lots:read', 'sales:read', 'documents:write', 'site_updates:write', 'client_messages'],
  comptable: [
    'projects:read', 'lots:read', 'leads:read', 'appointments:read', 'sales:read', 'payments:write',
    'schedule:write', 'client_messages',
  ],
  resp_exploitation: [
    'projects:read', 'projects:write', 'plans:write', 'lots:read', 'lots:status', 'leads:read', 'leads:delete',
    'appointments:read', 'contacts:read', 'users:read', 'newsletter:read',
    'sales:read', 'sales:write', 'documents:write', 'testimonials:write',
    'client_access:write', 'client_messages', 'site_updates:write', 'schedule:write', 'settings:write',
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
    ['newsletter:write', 'Gérer les abonnés newsletter', null],
  ] },
  { group: 'Administration', items: [
    ['users:read', 'Voir les utilisateurs', null],
    ['users:write', 'Gérer les utilisateurs', 'Créer des comptes, changer les rôles et mots de passe'],
  ] },
];
const PERMISSION_IDS = PERMISSION_CATALOG.flatMap(g => g.items.map(i => i[0]));

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

module.exports = {
  LOT_STATUSES, LOT_STATUS_LABELS, SELLABLE_STATUSES, LOT_TRANSITIONS,
  LEAD_STAGES, ROLES, ROLE_LABELS, PERMISSIONS, roleKey, can, checkLotTransition,
  SALE_STATUSES, PAYMENT_METHODS, DOCUMENT_STATUSES, DOCUMENT_TYPES, DEFAULT_DOCUMENTS,
  PERMISSION_CATALOG, PERMISSION_IDS,
  FINANCING_PLANS, FINANCINGS, SCHEDULE_KINDS, INSTALLMENT_STATUS_LABELS, SITE_STAGES, SITE_STAGE_LABELS,
  MESSAGE_SENDERS, CLIENT_PASSWORD_MIN, CLIENT_RESET_HOURS, CLIENT_VISIBLE_SALE_STATUSES,
  addMonths, buildSchedule, allocatePayments, phoneKey, looksLikeClientCode, PROTECTED_ROLES, DELETABLE_LOT_STATUSES, NEW_LOT_STATUSES, PROJECT_CATEGORIES,
  REF_KINDS, FEATURE_KINDS, VIABILISATION_STATES, APP_SETTINGS, THEMES,
};
