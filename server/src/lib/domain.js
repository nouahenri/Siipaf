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
  // Pièces du terrain ou du bien (titre foncier, ACD, attestation villageoise…) ; mêmes états, libellés propres
  document: { label: 'Documents du bien', one: 'document', feature: true, states: true, state_labels: { prevu: 'À obtenir', en_cours: 'En cours', fait: 'Obtenu' }, default_state: 'fait' },
  type_projet: { label: 'Types de projet', one: 'type de projet', project: 'project_type_id' },
  // scope : chaque type de biens indique les types de projet auxquels il s'applique (vide = tous)
  type_bien: { label: 'Types de biens', one: 'type de bien', project: 'property_type_id', scope: 'type_projet' },
};

/**
 * Grille de prix d'un projet : le prix d'un bien dépend de sa surface exacte (pas de fourchette).
 * La colonne « Surface » est du texte libre : « 400 », « 400 m² », « 1 000 m² » ; pour une villa
 * « T.125 m² | H.85 m² », c'est la surface du terrain (le premier nombre) qui compte. Renvoie m² ou null.
 */
function offerSurface(text) {
  const m = String(text || '').replace(/(\d)\s(?=\d{3}\b)/g, '$1').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Ligne de la grille dont la surface est celle du lot (à l'arrondi du m² près). Si le lot a déjà un type
 * de bien, seules les lignes de ce type comptent. Renvoie la ligne (avec son prix) ou null.
 */
function gridOfferFor(offers, surface, offerId = null) {
  const s = Number(surface);
  if (!surface || !Number.isFinite(s)) return null;
  const current = offerId && offers.find(o => o.id === offerId);
  const sameKind = o => !current || o.label.trim().toLocaleLowerCase('fr') === current.label.trim().toLocaleLowerCase('fr');
  return offers.find(o => {
    const m2 = offerSurface(o.surface);
    return o.price_fcfa != null && m2 != null && sameKind(o) && Math.abs(s - m2) < 0.5;
  }) || null;
}
// Lots dont le prix suit la grille : libres (pas d'option, de réservation, de vente ni de dossier)
const GRID_PRICED_STATUSES = ['disponible', 'desistement', 'bloque'];

/**
 * Le type de projet (liste libre de Paramètres) est informatif ; on en déduit la catégorie technique
 * qui pilote le site (page Lotissements, carte des lots) et la comptabilité (vente de terrain ou de logement).
 */
function categoryForProjectType(label) {
  const t = String(label || '').toLocaleLowerCase('fr');
  if (/lotissement|terrain/.test(t)) return 'lotissement';
  if (/social/.test(t)) return /standing/.test(t) ? 'social_haut_standing' : 'social';
  if (/standing/.test(t)) return 'haut_standing';
  return null;
}
const FEATURE_KINDS = Object.keys(REF_KINDS).filter(k => REF_KINDS[k].feature);

// Chiffres clés d'un projet sur le site (fiche projet › « Chiffres clés du site ») : pictogramme au choix
const SITE_FIGURE_ICONS = {
  surface: { label: 'Surface', icon: 'fas fa-ruler-combined' }, acces: { label: 'Route / accès', icon: 'fas fa-road' },
  lieu: { label: 'Lieu', icon: 'fas fa-map-marker-alt' }, duree: { label: 'Durée', icon: 'fas fa-clock' },
  pourcentage: { label: 'Pourcentage', icon: 'fas fa-percentage' }, calendrier: { label: 'Calendrier', icon: 'fas fa-calendar-alt' },
  argent: { label: 'Prix / paiement', icon: 'fas fa-hand-holding-usd' }, logement: { label: 'Logement', icon: 'fas fa-home' },
  immeuble: { label: 'Immeuble', icon: 'fas fa-building' }, nature: { label: 'Espaces verts', icon: 'fas fa-tree' },
  securite: { label: 'Sécurité', icon: 'fas fa-shield-alt' }, ecole: { label: 'École', icon: 'fas fa-graduation-cap' },
  atout: { label: 'Atout', icon: 'fas fa-star' }, info: { label: 'Information', icon: 'fas fa-info-circle' },
};
/** Chiffres clés enregistrés (JSON) → liste du site, avec la classe du pictogramme. */
function siteFigures(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = []; } }
  return (Array.isArray(list) ? list : []).filter(f => f && f.value).map(f => ({
    icon: (SITE_FIGURE_ICONS[f.icon] || SITE_FIGURE_ICONS.info).icon, value: f.value, label: f.label || '',
  }));
}
const VIABILISATION_STATES = { prevu: 'Prévu', en_cours: 'En cours', fait: 'Réalisé' };

// Réglages généraux (Paramètres › Général) : clé → valeur par défaut
const APP_SETTINGS = {
  option_days_default: { label: 'Durée d’une pré-réservation (jours)', min: 1, max: 60 },
  request_dg_threshold: { label: 'Achat interne validé par la DG à partir de (FCFA)', min: 0, max: 1000000000 },
  // Conditions de paiement des projets (une fiche projet peut les préciser) : tuile du site et formule Diaspora
  deposit_default: { label: 'Acompte par défaut (FCFA)', min: 0, max: 1000000000 },
  balance_months_default: { label: 'Délai de solde par défaut (mois)', min: 1, max: 120 },
  balance_months_choices: { label: 'Délais de solde proposés (mois)', list: true, min: 1, max: 120 },
};

/** Délais de solde proposés, « 6, 12, 24, 36 » → [6, 12, 24, 36] (triés, sans doublon, bornés). */
function monthChoices(text) {
  const f = APP_SETTINGS.balance_months_choices;
  return [...new Set(String(text || '').split(/[^\d]+/).map(Number).filter(n => Number.isInteger(n) && n >= f.min && n <= f.max))].sort((a, b) => a - b);
}

/**
 * Conditions de paiement d'un projet : sa fiche, sinon les réglages généraux. Mensualité de la formule
 * Diaspora = (prix Diaspora − acompte) ÷ délai de solde.
 */
function paymentTerms(project, settings) {
  const deposit = project.deposit_fcfa != null ? Number(project.deposit_fcfa) : Number(settings.deposit_default || 0);
  const months = Number(project.balance_months || settings.balance_months_default || 36);
  return { deposit_fcfa: deposit, balance_months: months };
}
const monthlyFor = (price, { deposit_fcfa, balance_months }) => Math.round(Math.max(0, Number(price) - deposit_fcfa) / balance_months);
const THEMES = ['clair', 'sombre', 'systeme'];

// Circuit de vente : Prospection → Visite → Décision → Choix du bien → Paiement → Contrat → Notaire → Livraison → SAV
const LEAD_STAGES = ['prospection', 'visite', 'decision', 'choix_bien', 'paiement', 'contrat', 'notaire', 'livraison', 'sav', 'perdu'];
// À partir du paiement, la personne est un client (code client attribué d'office) : prospect OU client, jamais les deux
const CLIENT_STAGES = ['paiement', 'contrat', 'notaire', 'livraison', 'sav'];

// Prospects venus d'eux-mêmes (formulaires du site, plan interactif, assistant IA) : signalés à l'équipe
const PUBLIC_LEAD_SOURCES = ['site', 'plan', 'ia'];

/**
 * Alerte posée sur un prospect à sa création ou à une nouvelle demande. Une demande publique (même d'une personne
 * déjà connue) est « nouvelle » jusqu'à ce qu'un membre de l'équipe ouvre la fiche (`seen_at` nul : compteur du
 * menu Prospects) et sonne la cloche. Un prospect saisi par un collègue sonne la cloche des autres, déjà vu ;
 * un import n'alerte pas (des centaines de lignes d'un coup).
 */
function leadAlert({ source, isNew }, now = new Date()) {
  if (PUBLIC_LEAD_SOURCES.includes(source)) return { seen_at: null, alert_at: now };
  if (!isNew) return {};
  return source === 'import' ? { seen_at: now, alert_at: null } : { seen_at: now, alert_at: now };
}

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

/**
 * Conditions figées sur un dossier ouvert depuis le 23/10 (acompte et délai de solde du projet) : elles
 * remplacent celles de la formule Diaspora. null pour un autre financement ou un dossier plus ancien.
 */
function saleTerms(sale) {
  if (sale.financing !== 'diaspora' || sale.terms_months == null) return null;
  return { deposit_fcfa: Number(sale.terms_deposit_fcfa || 0), months: Number(sale.terms_months) };
}
/** Libellé du financement du dossier : « Diaspora — acompte 500 000 FCFA puis 24 mensualités ». */
function financingLabel(sale) {
  const t = saleTerms(sale);
  if (!t) return FINANCING_PLANS[sale.financing]?.label || null;
  return `Diaspora — ${t.deposit_fcfa ? `acompte ${t.deposit_fcfa.toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA puis` : 'sans acompte,'} ${t.months} mensualités`;
}
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

/**
 * Étapes d'un lotissement (terrains nus), validées par le client : ce ne sont pas celles d'un programme immobilier
 * (fondations, gros œuvre, toiture… n'ont pas de sens pour un terrain). Un projet est un lotissement quand sa catégorie
 * vaut « lotissement ». Les clés communes (etudes, terrassement, livraison) gardent la même clé, avec un libellé propre
 * au lotissement ; les clés des bâtiments restent valides (données existantes), seules les clés de l'autre type sont refusées.
 */
const LOTISSEMENT_STAGES = ['etudes', 'bornage', 'terrassement', 'voirie', 'reseaux', 'assainissement', 'eclairage', 'attribution_lots', 'livraison'];
const LOTISSEMENT_STAGE_LABELS = {
  etudes: 'Études et approbation du lotissement',
  bornage: 'Bornage et implantation',
  terrassement: 'Défrichage et terrassement',
  voirie: 'Voirie',
  reseaux: 'Réseaux (eau, électricité)',
  assainissement: 'Assainissement et drainage',
  eclairage: 'Éclairage public et finitions',
  attribution_lots: 'Attribution des lots',
  livraison: 'Livraison (ACD, titre)',
};
// Toutes les clés valides (validation des formulaires) ; le contrôle selon le projet est fait par siteStageError
const ALL_SITE_STAGES = [...new Set([...SITE_STAGES, ...LOTISSEMENT_STAGES])];

/** Étapes d'un projet d'après sa catégorie : { keys (ordonnées), labels, list [{ id, key, label }] }. */
function siteStagesFor(category) {
  const keys = category === 'lotissement' ? LOTISSEMENT_STAGES : SITE_STAGES;
  const labels = category === 'lotissement' ? LOTISSEMENT_STAGE_LABELS : SITE_STAGE_LABELS;
  return { keys, labels, list: keys.map(k => ({ id: k, key: k, label: labels[k] })) };
}
/** Libellé d'une étape pour un projet ; une étape de l'autre type (donnée ancienne) garde son libellé d'origine. */
const siteStageLabel = (category, key) => siteStagesFor(category).labels[key] || SITE_STAGE_LABELS[key] || LOTISSEMENT_STAGE_LABELS[key] || key || null;
/** Rang de l'étape dans la liste du projet (-1 si elle n'en fait pas partie). */
const siteStageIndex = (category, key) => siteStagesFor(category).keys.indexOf(key);
/** Message de refus (400) si l'étape n'est pas celle du projet, sinon null. */
function siteStageError(category, key) {
  if (!ALL_SITE_STAGES.includes(key)) return 'Étape de chantier inconnue.';
  if (siteStageIndex(category, key) >= 0) return null;
  const lot = category === 'lotissement';
  const label = siteStageLabel(lot ? null : 'lotissement', key);
  const own = (lot ? LOTISSEMENT_STAGES : SITE_STAGES).map(k => (lot ? LOTISSEMENT_STAGE_LABELS : SITE_STAGE_LABELS)[k]).join(', ');
  return `L’étape « ${label} » ne concerne pas ${lot ? 'un lotissement' : 'un programme immobilier'}. Étapes ${lot ? 'd’un lotissement' : 'd’un programme immobilier'} : ${own}.`;
}

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
 * vaut exactement le prix. `options` peut surcharger deposit_pct et months, ou fixer l'apport en montant
 * (deposit_fcfa, ex. 2 600 000 déjà versés sur 15 000 000), qui prime alors sur le pourcentage.
 * Sans financement : [].
 */
function buildSchedule({ price_fcfa, financing, start_date, options = {} }) {
  const plan = FINANCING_PLANS[financing];
  const price = Number(price_fcfa);
  if (!plan || !price) return [];
  const months = options.months ?? plan.months;
  const byAmount = options.deposit_fcfa != null;
  const pct = byAmount ? Math.round((options.deposit_fcfa / price) * 1000) / 10 : options.deposit_pct ?? plan.deposit_pct;
  const lines = [];
  const deposit = byAmount ? Math.min(price, Math.round(options.deposit_fcfa))
    : months || plan.bank_months ? Math.round((price * pct) / 100) : price;
  if (deposit > 0) {
    const kind = deposit === price ? 'solde' : 'apport';
    const pctLabel = String(pct).replace('.', ',');
    // `deposit_label` : « Acompte » quand l'apport vient des conditions du projet
    const label = kind === 'solde' ? 'Paiement comptant' : options.deposit_label || `Apport initial (${pctLabel} %)`;
    lines.push({ kind, label, due_date: start_date, amount_fcfa: deposit });
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
const SELF_SERVICE = ['self:conges', 'self:pointage', 'self:frais', 'self:vehicule', 'self:demandes'];
// Actions détaillées des modules de l'ERP (une ligne du catalogue chacune)
const SAV_ACTIONS = ['sav:all', 'sav:create', 'sav:handle', 'sav:assign', 'sav:reserves', 'sav:interventions'];
const APPRO_ACTIONS = ['appro:read', 'appro:write', 'appro:validate', 'appro:stock', 'appro:settings'];
const COMPTA_ACTIONS = ['compta:entries', 'compta:validate', 'achats:write', 'achats:validate', 'achats:pay', 'frais:post', 'compta:close', 'compta:settings', 'compta:export'];
const PAIE_ACTIONS = ['paie:employees', 'paie:prepare', 'paie:validate', 'paie:pay', 'paie:settings'];
const COURRIER_ACTIONS = ['courrier:read', 'courrier:write', 'courrier:assign'];
const CONTRACT_ACTIONS = ['contrats:read', 'contrats:write'];
const PARC_ACTIONS = ['parc:read', 'parc:write'];
const DOCS_ACTIONS = ['docs:publish'];
const REQUEST_ACTIONS = ['demandes:handle'];
const LEGAL_ACTIONS = ['juridique:read', 'juridique:write'];
const MARKETING_ACTIONS = ['marketing:read', 'marketing:generate', 'marketing:validate', 'marketing:settings'];
const QHSE_ACTIONS = ['qhse:read', 'qhse:control', 'qhse:all', 'qhse:audit', 'qhse:actions', 'qhse:validate', 'qhse:settings'];
// Actions découpées (30/10), pour les listes « l'un de ces droits » (voir PERMISSION_SPLITS)
const PRESENCE_ACTIONS = ['presence:sheets', 'presence:kiosk', 'presence:correct'];
const RH_SETTINGS_ACTIONS = ['rh:rules', 'rh:positions', 'rh:heads', 'rh:holidays'];
const RECRUIT_ACTIONS = ['recrutement:jobs', 'recrutement:applicants', 'recrutement:hire', 'recrutement:delete'];
const KPI_ACTIONS = ['kpi:indicators', 'kpi:templates', 'kpi:department'];
const FORMATION_ACTIONS = ['formation:skills', 'formation:plan', 'formation:complete'];
const RH_ACTIONS = ['rh:files', 'rh:documents', 'conges:approve', 'conges:manage', 'rh:overtime', 'frais:approve', 'recrutement:write', 'formation:write', 'evaluation:write', 'rh:settings'];


/**
 * Privilèges d'origine découpés en actions à cocher (demande du client du 29/10 : « Gérer les prospects » → créer,
 * modifier, faire avancer…). Sert aux droits par défaut ci-dessous ; la migration 20261129200000 applique le même
 * découpage aux rôles et aux comptes existants.
 */
const PERMISSION_SPLITS = {
  'leads:write': ['leads:create', 'leads:edit', 'leads:stage', 'leads:activities', 'leads:import', 'leads:transfer'],
  'appointments:write': ['appointments:create', 'appointments:edit', 'appointments:cancel'],
  'lots:status': ['lots:option', 'lots:reserve', 'lots:desist'],
  'sales:write': ['sales:open', 'sales:edit', 'sales:clients'],
  // Clients (29/10, 2ᵉ découpage) : ceux qui voyaient les dossiers voient les clients ; qui modifiait un prospect modifie un client
  'sales:clients': ['clients:create', 'clients:import'],
  'sales:read': ['sales:read', 'clients:read', 'clients:export'],
  'leads:edit': ['leads:edit', 'clients:edit'],
  // Catalogue, site web et comptes (29/10, 3ᵉ découpage)
  'projects:write': ['projects:create', 'projects:edit', 'projects:publish', 'projects:prices', 'projects:delete'],
  'plans:write': ['plans:edit', 'plans:lots', 'plans:lots_delete'],
  'content:write': ['content:home', 'content:texts', 'content:images', 'content:contacts'],
  'media:write': ['media:upload', 'media:delete'],
  'newsletter:write': ['newsletter:subscribers', 'newsletter:campaigns'],
  'users:write': ['users:create', 'users:edit', 'users:role', 'users:password', 'users:disable', 'circuit:write'],
  'demandes:dg': ['demandes:dg', 'circuit:write'],
  'payments:write': ['payments:write', 'payments:delete'],
  'documents:write': ['documents:status', 'documents:files', 'documents:visibility'],
  'client_access:write': ['client_access:open', 'client_access:disable'],
  'client_messages': ['client_messages', 'client_messages:group'],
  // ERP, action par action (30/10) : Service commercial
  'leads:assign': ['leads:assign', 'leads:transfer_decide'],
  'property:write': ['property:buildings', 'property:lots'],
  'vefa:write': ['vefa:read', 'vefa:write'],
  // Achats & stocks
  'appro:write': ['appro:locations', 'appro:needs', 'appro:quotes', 'appro:orders'],
  'appro:stock': ['appro:stock', 'appro:receive', 'appro:minimum'],
  // Comptabilité
  'compta:entries': ['compta:entries', 'compta:sync', 'compta:import', 'compta:assets'],
  'compta:validate': ['compta:validate', 'compta:reverse'],
  'achats:write': ['suppliers:write', 'achats:write', 'achats:validate'],
  'achats:pay': ['achats:pay', 'achats:advance'],
  'frais:post': ['frais:post', 'frais:reimburse'],
  'compta:close': ['compta:years', 'compta:lock', 'compta:opening', 'compta:close'],
  'compta:settings': ['compta:plan', 'compta:settings'],
  // Paie
  'paie:employees': ['paie:employees', 'paie:salary'],
  'paie:prepare': ['paie:prepare', 'paie:inputs'],
  // Ressources humaines
  'rh:files': ['rh:files', 'rh:documents_write', 'rh:career', 'rh:pin'],
  'conges:manage': ['conges:enter', 'conges:adjust', 'conges:cancel'],
  'presence:write': ['presence:sheets', 'presence:kiosk', 'presence:correct'],
  'recrutement:write': ['recrutement:jobs', 'recrutement:applicants', 'recrutement:hire', 'recrutement:delete'],
  'formation:write': ['formation:skills', 'formation:plan', 'formation:complete'],
  'evaluation:write': ['evaluation:objectives', 'evaluation:reviews'],
  'kpi:write': ['kpi:indicators', 'kpi:templates', 'kpi:department'],
  'rh:settings': ['rh:rules', 'rh:positions', 'rh:heads', 'rh:holidays'],
  // Client & SAV
  'sav:handle': ['sav:edit', 'sav:status', 'sav:comment'],
  'sav:reserves': ['sav:delivery', 'sav:reserves'],
  // Administration générale
  'contrats:write': ['contrats:write', 'contrats:close', 'contrats:documents'],
  'parc:write': ['parc:write', 'parc:maintenance', 'parc:costs', 'parc:reservations'],
  'demandes:handle': ['demandes:handle', 'demandes:view_all', 'demandes:invoice'],
  // Juridique
  'juridique:write': ['juridique:deeds', 'juridique:litigation', 'juridique:guarantees', 'juridique:settings'],
  // Chantiers
  'chantiers:write': ['chantiers:create', 'chantiers:plan', 'chantiers:budget', 'chantiers:settings', 'chantiers:tma'],
  'chantiers:direction': ['chantiers:stages', 'chantiers:situations'],
  // Dashboard : paramètres et échéanciers
  'settings:write': ['settings:refs', 'settings:general'],
  'schedule:write': ['schedule:generate', 'schedule:edit'],
};
// Découpage répété jusqu'aux actions finales (un privilège découpé peut l'être à nouveau)
function splitPermissions(list) {
  let out = [...new Set(list)];
  for (let i = 0; i < 5; i++) {
    const next = [...new Set(out.flatMap(p => (PERMISSION_SPLITS[p] && !(PERMISSION_SPLITS[p].length === 1 && PERMISSION_SPLITS[p][0] === p) ? PERMISSION_SPLITS[p] : [p])))];
    if (next.length === out.length && next.every(p => out.includes(p))) break;
    out = next;
  }
  return out;
}

/** Droits par défaut des rôles d'origine. Le super administrateur a tous les droits. */
const PERMISSIONS = {
  super_admin: ['*'],
  commercial: splitPermissions([
    'projects:read', 'lots:read', 'lots:status', 'leads:read', 'leads:write',
    'appointments:read', 'appointments:write', 'contacts:read', 'sales:read', 'sales:write', 'payments:record',
    'client_access:write', 'client_messages', 'sav:read', 'commercial:read', 'contacts:handle', 'marketing:read', ...SELF_SERVICE,
  ]),
  editeur: splitPermissions([
    'projects:read', 'projects:write', 'plans:write', 'lots:read', 'content:write', 'media:write',
    'newsletter:read', 'newsletter:write', 'newsletter:send', 'contacts:read', 'contacts:handle', 'testimonials:write', 'settings:write', 'property:write', 'marketing:read', 'marketing:generate', ...SELF_SERVICE,
  ]),
  conducteur_travaux: splitPermissions([
    ...APPRO_ACTIONS,
    'projects:read', 'lots:read', 'sales:read', 'documents:write', 'site_updates:write', 'client_messages',
    'sav:read', 'sav:all', 'sav:create', 'sav:handle', 'sav:reserves', 'sav:interventions', 'vefa:write', 'presence:write', ...CONTRACT_ACTIONS, ...LEGAL_ACTIONS, 'leads:all',
    'chantiers:read', 'chantiers:write', 'qhse:read', 'qhse:control', ...SELF_SERVICE,
  ]),
  comptable: splitPermissions([
    ...APPRO_ACTIONS, 'appro:articles',
    'projects:read', 'lots:read', 'leads:read', 'appointments:read', 'sales:read', 'payments:write',
    'schedule:write', 'client_messages', 'commercial:read', 'leads:all', 'compta:read', ...COMPTA_ACTIONS,
    'rh:read', ...RH_ACTIONS, 'kpi:write', 'presence:write', 'paie:read', ...PAIE_ACTIONS, 'contrats:read', 'parc:read', 'chantiers:read', 'lieux:write', 'qhse:read', 'qhse:all', 'qhse:validate', ...SELF_SERVICE,
  ]),
  resp_exploitation: splitPermissions([
    ...APPRO_ACTIONS, 'appro:direction', 'appro:articles',
    'projects:read', 'projects:write', 'plans:write', 'lots:read', 'lots:status', 'leads:read', 'leads:delete',
    'appointments:read', 'appointments:create', 'contacts:read', 'contacts:handle', 'users:read', 'newsletter:read',
    'sales:read', 'sales:write', 'documents:write', 'testimonials:write',
    'client_access:write', 'client_messages', 'site_updates:write', 'schedule:write', 'settings:write',
    'leads:all', 'leads:assign', 'clients:edit', 'sav:read', ...SAV_ACTIONS, 'commercial:read', 'targets:write', 'vefa:write', 'property:write', 'compta:read',
    'rh:read', ...RH_ACTIONS, 'kpi:write', 'presence:write', 'direction:read', ...COURRIER_ACTIONS, ...CONTRACT_ACTIONS, ...PARC_ACTIONS, ...DOCS_ACTIONS, ...REQUEST_ACTIONS, ...LEGAL_ACTIONS,
    'chantiers:read', 'chantiers:write', 'lieux:write', 'marketing:read', 'marketing:generate', 'marketing:validate',
    ...QHSE_ACTIONS.filter(p => p !== 'qhse:settings'), ...SELF_SERVICE, // QHSE : tout sauf les réglages (Direction générale)
  ]),
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
    ['leads:all', 'Portée : toute l’équipe (responsable, services support)', 'Prospects, clients, rendez-vous, dossiers, versements et messages de tous les commerciaux, et ceux non attribués. Sans ce droit, un commercial ne voit et ne traite que les siens'],
    ['leads:assign', 'Attribuer et changer de commercial (responsable)', 'Attribuer les prospects non attribués, changer le commercial d’un prospect ou d’un client, répartir en lot', 'Attribution et transferts'],
    ['leads:transfer_decide', 'Valider ou refuser les demandes de transfert', 'Décision du responsable sur les demandes de transfert des commerciaux (pour un client, avec l’accord de l’administrateur général)', 'Attribution et transferts'],
    ['leads:create', 'Créer un prospect', 'Nouveau prospect saisi au dashboard ou dans l’ERP ; il est attribué à son auteur', 'Gérer ses prospects'],
    ['leads:edit', 'Modifier la fiche', 'Nom, coordonnées, programme, financement, priorité, montant attendu', 'Gérer ses prospects'],
    ['leads:stage', 'Faire avancer dans le circuit', 'Changer l’étape, marquer perdu (motif) ou reprendre un prospect perdu', 'Gérer ses prospects'],
    ['leads:activities', 'Activités et notes', 'Planifier un appel, une relance ; noter un compte rendu ; marquer fait', 'Gérer ses prospects'],
    ['leads:import', 'Importer une liste (CSV)', 'Liste de prospects : doublons déduits, nouveaux attribués', 'Gérer ses prospects'],
    ['leads:transfer', 'Demander un transfert', 'Confier un prospect ou un client à un collègue, ou reprendre une personne suivie par un collègue (validation du responsable)', 'Gérer ses prospects'],
    ['leads:delete', 'Supprimer des prospects', 'Doublons ou demande d’effacement ; impossible si la personne a un dossier d’acquisition'],
    ['appointments:read', 'Voir les rendez-vous', 'Les siens, ou ceux de toute l’équipe avec la portée « toute l’équipe »'],
    ['appointments:create', 'Planifier un rendez-vous', 'Visite, appel, bureau, visio, avec ses prospects et clients', 'Gérer les rendez-vous'],
    ['appointments:edit', 'Confirmer, déplacer, marquer effectué ou absent', 'Traiter les demandes de rendez-vous venues du site', 'Gérer les rendez-vous'],
    ['appointments:cancel', 'Annuler un rendez-vous', null, 'Gérer les rendez-vous'],
    ['lots:read', 'Voir les lots', 'Disponibilités, fiche lot, historique'],
    ['lots:option', 'Poser ou lever une option', 'Pré-réservation pour un de ses prospects', 'Statut des lots'],
    ['lots:reserve', 'Réserver, vendre, remettre en vente', 'Statuts réservé, vendu, disponible, non commercialisé', 'Statut des lots'],
    ['lots:desist', 'Enregistrer un désistement', 'Le dossier d’acquisition est clos et le lot se revend', 'Statut des lots'],
  ] },
  { group: 'Dossiers d’acquisition', items: [
    ['sales:read', 'Voir les dossiers d’acquisition', 'Acquéreur, prix, paiements, documents'],
    ['sales:open', 'Ouvrir un dossier', 'Réserver un lot pour un de ses prospects ou un nouvel acquéreur', 'Dossiers'],
    ['sales:edit', 'Modifier le dossier', 'Prix convenu, financement, date de réservation, livraison promise, notes, travaux modificatifs ; la date de l’acte relève du Juridique', 'Dossiers'],
    ['payments:record', 'Déclarer un versement (à confirmer)', 'Saisir le versement d’un de ses clients ; il ne compte qu’après confirmation de la Comptabilité', 'Versements'],
    ['payments:write', 'Enregistrer et confirmer (Comptabilité)', 'Enregistrer un versement, confirmer ou refuser ceux déclarés par les commerciaux', 'Versements'],
    ['payments:delete', 'Supprimer un versement', 'Erreur de saisie ; le dossier et les totaux sont recalculés', 'Versements'],
    ['documents:status', 'Faire avancer les pièces', 'Statut et note des pièces administratives et juridiques', 'Documents juridiques'],
    ['documents:files', 'Ajouter des pièces et joindre les fichiers', null, 'Documents juridiques'],
    ['documents:visibility', 'Rendre une pièce visible au client', 'Dans son espace client', 'Documents juridiques'],
  ] },
  { group: 'Clients et espace client', items: [
    ['clients:read', 'Voir les clients', 'Liste des clients, fiche, dossiers, versements et retards (les siens, ou tous avec la portée « toute l’équipe »)', 'Fiches clients'],
    ['clients:create', 'Créer un client sans dossier', 'Client repris de l’ancienne plateforme : lot et prix rattachés ensuite', 'Fiches clients'],
    ['clients:edit', 'Modifier la fiche d’un client', 'Nom, coordonnées, pays, diaspora, programme (celle d’un prospect relève de « Modifier la fiche » des prospects)', 'Fiches clients'],
    ['clients:import', 'Importer la liste des clients', 'Fichier CSV ou Excel : clients, lots, prix ; les montants versés restent réservés à la Comptabilité', 'Fiches clients'],
    ['clients:export', 'Exporter la liste des clients (CSV)', null, 'Fiches clients'],
    ['client_access:open', 'Ouvrir l’accès ou renvoyer un mot de passe', 'Code client et mot de passe provisoire', 'Accès des clients'],
    ['client_access:disable', 'Désactiver ou réactiver un accès', null, 'Accès des clients'],
    ['client_messages', 'Lire et répondre', 'Messages de ses clients (de tous les clients avec la portée « toute l’équipe »)', 'Messagerie clients'],
    ['client_messages:group', 'Écrire à plusieurs clients', 'Même message dans la conversation de chaque client choisi', 'Messagerie clients'],
    ['site_updates:write', 'Publier l’avancement du chantier', 'Étapes, pourcentages, photos et vidéos pour les acquéreurs ; n’émet pas d’appel de fonds (déclaration de la Direction)'],
    ['schedule:generate', 'Générer l’échéancier', 'Recalculer l’échéancier type d’un dossier selon son financement (les versements enregistrés sont réimputés)', 'Échéanciers'],
    ['schedule:edit', 'Modifier les échéances', 'Remplacer les échéances d’un dossier (dates et montants)', 'Échéanciers'],
  ] },
  { group: 'ERP · Service commercial', items: [
    ['commercial:read', 'Ouvrir le Service commercial', 'Tableau de bord, pipeline, activités, parc, ventes, appels de fonds, objectifs'],
    ['targets:write', 'Fixer les objectifs commerciaux', 'Objectifs mensuels par commercial'],
    ['property:buildings', 'Bâtiments et étages', 'Créer, modifier et supprimer les bâtiments d’un programme (supprimer un bâtiment ne supprime aucun lot)', 'Parc immobilier'],
    ['property:lots', 'Caractéristiques des lots', 'Type de bien, bâtiment, étage, pièces, titre foncier, tantièmes, affectation groupée ; le prix, la surface et l’îlot demandent aussi « Créer et modifier les lots »', 'Parc immobilier'],
    ['vefa:read', 'Consulter les appels de fonds VEFA', 'Plans et appels de fonds de tous les programmes et de tous les dossiers VEFA (le service commercial ne voit que les siens)', 'Appels de fonds VEFA'],
    ['vefa:write', 'Établir les plans d’appels de fonds', 'Plans d’appels de fonds par programme, délai de paiement (les étapes atteintes sont déclarées par la Direction)', 'Appels de fonds VEFA'],
  ] },
  { group: 'ERP · Achats & stocks', items: [
    ['appro:read', 'Consulter les achats et stocks', 'Besoins, demandes de prix, commandes, réceptions et stocks par emplacement'],
    ['appro:locations', 'Créer les emplacements de stock', 'Un emplacement par dépôt, lieu ou chantier', 'Préparer les achats'],
    ['appro:needs', 'Traiter les besoins', 'Besoins des chantiers et demandes d’achat des services : préparer le bon de commande ou refuser avec un motif', 'Préparer les achats'],
    ['appro:quotes', 'Demandes de prix', 'Créer, modifier et annuler une demande de prix ; enregistrer le devis reçu', 'Préparer les achats'],
    ['appro:orders', 'Bons de commande', 'Créer, modifier, soumettre au validateur, reprendre en brouillon et annuler ; transformer un devis reçu en commande (avec « Demandes de prix »)', 'Préparer les achats'],
    ['appro:articles', 'Gérer le catalogue des articles', 'Créer, modifier, désactiver et importer (CSV) les articles ; rattacher un besoin hors catalogue'],
    ['appro:validate', 'Valider les commandes', 'Peut être désigné validateur des commandes sous le plafond (jamais de ses propres commandes)'],
    ['appro:direction', 'Valider à partir du plafond', 'Validation ou refus des commandes à partir du plafond ; peut se substituer au validateur désigné'],
    ['appro:stock', 'Mouvements de stock', 'Entrées, sorties et transferts : créer, modifier, valider, annuler ; aucun stock négatif', 'Stocks et réceptions'],
    ['appro:receive', 'Réceptionner une commande', 'Réception partielle ou complète d’un bon de commande confirmé (entrée en stock)', 'Stocks et réceptions'],
    ['appro:minimum', 'Fixer le stock minimum', 'Seuil d’alerte par article et par emplacement ; reçoit les alertes de stock bas', 'Stocks et réceptions'],
    ['appro:settings', 'Régler les achats et stocks', 'Plafond de validation par la Direction'],
  ] },
  { group: 'ERP · Comptabilité', items: [
    ['compta:read', 'Consulter la comptabilité', 'Écritures, états, trésorerie, achats, tableau de bord'],
    ['compta:entries', 'Saisir des écritures', 'Écritures manuelles en brouillon, modification et suppression des brouillons', 'Écritures'],
    ['compta:sync', 'Synchroniser les ventes et versements', 'Écritures automatiques des ventes, versements et appels de fonds', 'Écritures'],
    ['compta:import', 'Importer des écritures Sage', 'Journal d’écritures (fichier CSV, TXT ou Excel) : simulation, puis import', 'Écritures'],
    ['compta:assets', 'Immobilisations du parc', 'Compléter la fiche d’immobilisation, passer les dotations aux amortissements, sortir un bien de l’actif', 'Écritures'],
    ['compta:validate', 'Valider les écritures', 'Numérotation définitive des brouillons', 'Validation'],
    ['compta:reverse', 'Contrepasser une écriture validée', 'Écriture inverse d’une écriture définitive', 'Validation'],
    ['suppliers:write', 'Gérer les fournisseurs', 'Créer et modifier les fournisseurs', 'Achats et fournisseurs'],
    ['achats:write', 'Saisir les achats', 'Factures d’achat en brouillon (modifier, supprimer), cartes carburant', 'Achats et fournisseurs'],
    ['achats:validate', 'Valider les factures d’achat et les dépenses du Parc', 'Validation d’une facture d’achat (numéro définitif, écriture) ; validation ou rejet des dépenses du Parc auto et matériel', 'Achats et fournisseurs'],
    ['achats:pay', 'Régler les fournisseurs', 'Enregistrer les paiements des factures d’achat et les recharges de cartes carburant', 'Règlements fournisseurs'],
    ['achats:advance', 'Verser un acompte sur commande', 'Acompte au fournisseur sur un bon de commande confirmé (Achats & stocks)', 'Règlements fournisseurs'],
    ['frais:post', 'Comptabiliser les notes de frais', 'Passer les notes approuvées en comptabilité', 'Notes de frais'],
    ['frais:reimburse', 'Rembourser les employés', 'Enregistrer le remboursement des notes comptabilisées', 'Notes de frais'],
    ['compta:years', 'Créer les exercices', 'Nouvel exercice comptable', 'Exercices et clôture'],
    ['compta:lock', 'Verrouiller une période', 'Plus aucune écriture jusqu’à la date de verrouillage (après une déclaration de TVA)', 'Exercices et clôture'],
    ['compta:opening', 'Soldes d’ouverture et à-nouveaux', 'Saisie ou import des soldes d’ouverture, à-nouveaux générés depuis l’exercice clôturé', 'Exercices et clôture'],
    ['compta:close', 'Clôturer un exercice', 'Clôture définitive : plus aucune écriture sur l’exercice', 'Exercices et clôture'],
    ['compta:plan', 'Plan comptable et journaux', 'Créer et modifier les comptes et les journaux ; importer le plan Sage ; créer les comptes manquants à l’import', 'Paramétrage'],
    ['compta:settings', 'Régler la comptabilité', 'Modes de chiffre d’affaires, TVA, comptes utilisés, jour de clôture, durées d’amortissement, format Sage', 'Paramétrage'],
    ['compta:export', 'Exporter vers Sage', 'Fichier des écritures validées'],
  ] },
  { group: 'ERP · Paie', items: [
    ['paie:read', 'Consulter la paie', 'Salaires, bulletins, livre de paie, déclarations'],
    ['paie:employees', 'Gérer les fiches salariés', 'Création des fiches, identité, contrat, responsable (sans le salaire)', 'Fiches salariés'],
    ['paie:salary', 'Salaire et paiement', 'Salaire de base, indemnités, parts fiscales, moyen de paiement et compte bancaire', 'Fiches salariés'],
    ['paie:prepare', 'Préparer la paie', 'Créer la paie du mois, recalcul, suppression d’un brouillon', 'Préparation de la paie'],
    ['paie:inputs', 'Saisir les éléments variables', 'Jours travaillés, heures supplémentaires, primes et avances des bulletins en brouillon', 'Préparation de la paie'],
    ['paie:validate', 'Valider la paie', 'Bulletins définitifs et écriture de paie'],
    ['paie:pay', 'Payer les salaires', 'Écritures de paiement (banque, caisse, Mobile Money)'],
    ['paie:settings', 'Régler le barème de paie', 'Taux CNPS, ITS, CMU, taxes, comptes de paie'],
  ] },
  { group: 'ERP · Ressources humaines', items: [
    ['rh:read', 'Voir le personnel', 'Annuaire, dossiers, absences, présences, recrutement, formations, performance (sans les salaires)'],
    ['rh:documents', 'Voir les pièces du dossier du personnel', 'CNI, certificats, courriers disciplinaires, contrats : liste et téléchargement (service RH ; l’employé garde l’accès à ses propres pièces)'],
    ['rh:files', 'Identité, contrat et responsable', 'Fiche de l’employé : identité, contrat, service, responsable direct, compte relié', 'Dossiers du personnel'],
    ['rh:documents_write', 'Joindre et supprimer des pièces', 'Ajouter ou retirer une pièce du dossier (sans pouvoir la consulter : voir « Voir les pièces du dossier »)', 'Dossiers du personnel'],
    ['rh:career', 'Carrière', 'Changement de poste daté (promotion, mutation) et événements de carrière', 'Dossiers du personnel'],
    ['rh:pin', 'Code de pointage', 'Définir ou réinitialiser le code personnel de la borne de pointage', 'Dossiers du personnel'],
    ['conges:approve', 'Approuver les congés', 'Approbation finale ou refus des demandes de tout le personnel'],
    ['conges:enter', 'Saisir une absence', 'Enregistrer une absence pour un employé', 'Absences'],
    ['conges:adjust', 'Ajuster les soldes', 'Ajustements de solde et solde d’ouverture des congés repris', 'Absences'],
    ['conges:cancel', 'Annuler une absence commencée', 'Un employé annule lui-même sa demande tant qu’elle n’a pas commencé', 'Absences'],
    ['presence:sheets', 'Feuilles de présence', 'Feuille de présence d’un chantier ou d’un lieu', 'Présences'],
    ['presence:kiosk', 'Borne de pointage', 'Ouvrir la borne de pointage (tablette de chantier)', 'Présences'],
    ['presence:correct', 'Corriger les pointages', 'Saisir, modifier ou supprimer un pointage (motif obligatoire ; jamais le sien)', 'Présences'],
    ['rh:overtime', 'Arrêter les heures supplémentaires', 'Envoi des heures supplémentaires du mois en paie'],
    ['frais:approve', 'Approuver les notes de frais', 'Notes de frais de tout le personnel (le responsable direct approuve celles de son équipe)'],
    ['recrutement:jobs', 'Postes à pourvoir', 'Créer, modifier, publier sur le site et fermer un poste ; prétentions salariales', 'Recrutement'],
    ['recrutement:applicants', 'Candidatures et entretiens', 'Saisir une candidature, la faire avancer, noter les entretiens', 'Recrutement'],
    ['recrutement:hire', 'Embaucher', 'Transformer une candidature en fiche d’employé', 'Recrutement'],
    ['recrutement:delete', 'Supprimer postes et candidatures', 'Suppression d’un poste sans candidature ou d’une candidature (effacement)', 'Recrutement'],
    ['formation:skills', 'Référentiel et profils de compétences', 'Types de compétences, compétences, profils et CV du personnel', 'Compétences et formations'],
    ['formation:plan', 'Plan de formation', 'Sessions, participants, annulation', 'Compétences et formations'],
    ['formation:complete', 'Clôturer une formation', 'Constater la formation réalisée : niveaux de compétences mis à jour', 'Compétences et formations'],
    ['evaluation:objectives', 'Objectifs du personnel', 'Fixer, modifier et supprimer les objectifs de tout le personnel (le responsable direct fixe ceux de son équipe ; jamais les siens)', 'Évaluations'],
    ['evaluation:reviews', 'Entretiens annuels', 'Mener et finaliser l’entretien de tout le personnel (le responsable direct mène ceux de son équipe ; jamais le sien)', 'Évaluations'],
    ['kpi:indicators', 'Indicateurs', 'Créer et régler les indicateurs de performance', 'Référentiel KPI'],
    ['kpi:templates', 'Modèles d’objectifs', 'Modèles par service et par poste, application aux employés', 'Référentiel KPI'],
    ['kpi:department', 'Objectifs collectifs des services', 'Objectifs collectifs des services, calcul du score des services', 'Référentiel KPI'],
    ['rh:rules', 'Règles des congés et des frais', 'Congés, heures supplémentaires, catégories de frais, géolocalisation du pointage', 'Réglages RH'],
    ['rh:positions', 'Postes et grille', 'Postes, salaires de référence, fusion, rôle du compte', 'Réglages RH'],
    ['rh:heads', 'Chefs de service', 'Désigner le chef de chaque service', 'Réglages RH'],
    ['rh:holidays', 'Jours fériés', 'Calendrier des jours fériés', 'Réglages RH'],
  ] },
  { group: 'ERP · Espace employé', items: [
    ['self:conges', 'Mon espace RH : congés, justificatifs, auto-évaluation', 'Demandes de congé et d’absence, justificatifs et auto-évaluation annuelle'],
    ['self:pointage', 'Pointer en ligne', 'Mon espace : arrivée et départ, code de la borne de pointage'],
    ['self:frais', 'Saisir des notes de frais', 'Mon espace : dépenses avec reçu, soumission'],
    ['self:vehicule', 'Demander un véhicule', 'Mon espace : réservation d’un véhicule de service, accordée par les services généraux'],
    ['self:demandes', 'Faire une demande interne', 'Mon espace : achat, équipement, intervention, prêt de matériel ; validée par le responsable puis traitée par les services généraux'],
  ] },
  { group: 'ERP · Administration générale', items: [
    ['direction:read', 'Ouvrir l’Administration générale (vue Direction)', 'Synthèse de tous les services : commercial, chantiers, finance, RH et SAV, avancement des chantiers par programme, dossier et client'],
    ['courrier:read', 'Consulter le registre du courrier', 'Arrivée et départ ; d’un courrier confidentiel, seul le n° d’ordre est visible'],
    ['courrier:write', 'Enregistrer le courrier (secrétariat)', 'Arrivée et départ, scan joint, correction d’un enregistrement'],
    ['courrier:assign', 'Affecter le courrier (direction)', 'Destinataire, suite à donner et délai ; voit les courriers confidentiels ; relances'],
    ['contrats:read', 'Consulter les contrats et échéances', 'Contrats, pièces, échéances et factures préparées'],
    ['contrats:write', 'Saisir et modifier les contrats (services généraux, juridique)', 'Créer un contrat, ses paiements et ses échéances ; reçoit toutes les alertes', 'Contrats'],
    ['contrats:close', 'Résilier et rouvrir un contrat', null, 'Contrats'],
    ['contrats:documents', 'Pièces des contrats', 'Ajouter, remplacer et supprimer les pièces, pièces à renouveler', 'Contrats'],
    ['parc:read', 'Consulter le parc auto et matériel', 'Biens, affectations, échéances, entretien, carburant, coûts par chantier'],
    ['parc:write', 'Gérer les biens du parc (services généraux)', 'Créer et modifier les biens, affectations, statuts, pièces et échéances', 'Parc auto et matériel'],
    ['parc:maintenance', 'Plans d’entretien', 'Entretiens datés ou au kilométrage / aux heures moteur', 'Parc auto et matériel'],
    ['parc:costs', 'Dépenses du parc', 'Saisir ou supprimer une dépense (carburant, entretien, assurance) ; la validation relève de la Comptabilité', 'Parc auto et matériel'],
    ['parc:reservations', 'Réservations de véhicules', 'Voir toutes les demandes, les accorder ou les refuser, choisir le véhicule', 'Parc auto et matériel'],
    ['docs:publish', 'Publier les documents internes (direction, services généraux)', 'Notes de service, procédures, PV, modèles pour tout le personnel ; suivi des lectures (un chef de service publie pour son service sans ce droit)'],
    ['demandes:handle', 'Traiter les demandes internes (services généraux)', 'Les prendre en charge et les clôturer', 'Demandes internes'],
    ['demandes:view_all', 'Voir toutes les demandes internes', 'Toutes les demandes de tous les services', 'Demandes internes'],
    ['demandes:invoice', 'Facture d’achat à la clôture', 'Un achat traité devient une facture d’achat en brouillon (avec « Saisir les achats »)', 'Demandes internes'],
    ['lieux:write', 'Gérer les lieux (siège, bureaux, dépôts)', 'Liste des lieux hors programmes, choisis comme imputation des achats, dépenses, frais, pointages et contrats ; axe analytique de la Comptabilité'],
    ['circuit:write', 'Régler le circuit d’information', 'Services prévenus pour chaque événement (Administration générale › Circuit d’information)'],
    ['demandes:dg', 'Valider en direction générale', 'Demandes d’achat dont le montant atteint le plafond réglé dans Paramètres › Général'],
  ] },
  { group: 'ERP · Juridique', items: [
    ['juridique:read', 'Consulter le Juridique', 'Circuit des ventes jusqu’à l’acte, litiges, cautions et retenues de garantie, impayés transmis'],
    ['juridique:deeds', 'Actes et étapes jusqu’à l’acte', 'Dater les étapes du circuit jusqu’à l’acte notarié, notaire, date de signature de l’acte', 'Gérer le Juridique'],
    ['juridique:litigation', 'Litiges', 'Ouvrir, suivre, clore et rouvrir un litige ; étapes et pièces', 'Gérer le Juridique'],
    ['juridique:guarantees', 'Cautions et retenues de garantie', 'Saisir, modifier, libérer et rouvrir', 'Gérer le Juridique'],
    ['juridique:settings', 'Réglages du Juridique', 'Rappels, sortes de litiges et de cautions', 'Gérer le Juridique'],
  ] },
  { group: 'ERP · Marketing & Communication', items: [
    ['marketing:read', 'Consulter le Marketing & Communication', 'Tableau de bord, campagnes, calendrier éditorial, bibliothèque de contenus et résultats par campagne'],
    ['marketing:generate', 'Faire préparer et rédiger des contenus', 'Créer une campagne, demander à l’IA un concept, un calendrier ou des variantes, modifier un contenu, le soumettre à validation, créer le brouillon de newsletter (avec le droit Newsletter)'],
    ['marketing:validate', 'Valider, refuser et marquer publié ou planifié', 'Responsable de la communication : relire les contenus préparés par l’IA, les valider ou les refuser avec un motif, puis les marquer planifiés ou publiés (aucune publication automatique)'],
    ['marketing:settings', 'Superviser le Marketing & Communication', 'Direction générale : modèle de l’IA, plafond de dépense, taux, arrêt d’urgence, ton de la marque, validation des campagnes'],
  ] },
  { group: 'ERP · QHSE', items: [
    ['qhse:read', 'Consulter le QHSE', 'Tableau de bord, contrôles journaliers et hebdomadaires, inspections et audits, actions correctives (les chantiers dont on est le conducteur, ou tous avec la portée « tous les chantiers »)'],
    ['qhse:control', 'Saisir les contrôles de chantier', 'Contrôle journalier (qualité, hygiène, sécurité, environnement) et synthèse hebdomadaire de ses chantiers ; photos et remarques ; ouvriers ne respectant pas les consignes'],
    ['qhse:all', 'Portée : tous les chantiers', 'Contrôles, audits et actions de tous les chantiers (service des ressources humaines, directeur des exploitations) ; remarques de sécurité de la fiche employé. Sans ce droit, on ne voit que les chantiers dont on est le conducteur'],
    ['qhse:audit', 'Inspections et audits', 'Planifier ou mener une inspection (planifiée ou inopinée) sur un chantier ou au siège : grille Q/H/S/E, constats avec gravité'],
    ['qhse:actions', 'Actions correctives', 'Ouvrir une action corrective (responsable, échéance), la modifier, la lever avec sa preuve ou l’annuler ; le responsable d’une action la fait avancer sans ce droit'],
    ['qhse:validate', 'Valider les contrôles hebdomadaires et les audits', 'Valider ou refuser (motif) la synthèse hebdomadaire d’un chantier et les audits réalisés'],
    ['qhse:settings', 'Régler le QHSE', 'Grilles de contrôle de chaque volet, seuil de sécurité, heure du contrôle du jour, délais des actions correctives'],
  ] },
  { group: 'ERP · Chantiers', items: [
    ['chantiers:read', 'Consulter les chantiers', 'Planning, phases, tâches, budget et coûts de tous les chantiers (le conducteur nommé voit et gère le sien sans autre droit)'],
    ['chantiers:create', 'Ouvrir et supprimer un chantier, nommer le conducteur', 'Nouveau chantier d’un programme, suppression, choix du conducteur de travaux', 'Gérer les chantiers (conducteur de travaux)'],
    ['chantiers:plan', 'Planning de tous les chantiers', 'Fiche, phases, tâches, journal, avancement, besoins, sous-traitants, réceptions de tous les chantiers (le conducteur nommé gère le sien sans ce droit)', 'Gérer les chantiers (conducteur de travaux)'],
    ['chantiers:budget', 'Budget de tous les chantiers', 'Lignes de budget par poste (le conducteur nommé gère celui de son chantier sans ce droit)', 'Gérer les chantiers (conducteur de travaux)'],
    ['chantiers:settings', 'Régler les chantiers', 'Postes du budget, météo du journal, seuils et rappels', 'Gérer les chantiers (conducteur de travaux)'],
    ['chantiers:tma', 'Travaux modificatifs (TMA)', 'Demander, chiffrer, annuler et clore les travaux modificatifs de tous les chantiers', 'Gérer les chantiers (conducteur de travaux)'],
    ['chantiers:stages', 'Déclarer une étape atteinte', 'Déclarer une étape de chantier atteinte (elle émet les appels de fonds VEFA) ou refuser un signalement', 'Valider en direction (chantiers)'],
    ['chantiers:situations', 'Valider les situations des sous-traitants', 'Valider ou refuser une situation de travaux (facture d’achat et retenue de garantie)', 'Valider en direction (chantiers)'],
  ] },
  { group: 'ERP · Client & SAV', items: [
    ['sav:read', 'Voir le SAV', 'Réclamations, réserves à la livraison, interventions, indicateurs'],
    ['sav:all', 'Portée : tout le SAV', 'Réclamations, réserves, interventions, clients et photos de tous les dossiers. Sans ce droit, on ne voit que ses clients et ce qui nous est confié (réclamation attribuée, intervention dont on est le technicien)'],
    ['sav:create', 'Créer des réclamations', 'Ouvrir une réclamation pour un client, à partir d’une réserve'],
    ['sav:edit', 'Modifier la réclamation', 'Priorité, type de problème, garantie applicable, titre et description', 'Traiter les réclamations'],
    ['sav:status', 'Changer le statut', 'Qualifier, planifier, résoudre, clore, rejeter ou rouvrir', 'Traiter les réclamations'],
    ['sav:comment', 'Commenter et joindre des photos', 'Réponse au client ou note interne', 'Traiter les réclamations'],
    ['sav:assign', 'Attribuer les réclamations', 'Choisir le technicien ou le responsable du dossier'],
    ['sav:delivery', 'Date de livraison (procès-verbal)', 'Date de livraison d’un dossier : départ des garanties', 'Livraison et réserves'],
    ['sav:reserves', 'Saisir et lever les réserves', 'Réserves relevées à la livraison', 'Livraison et réserves'],
    ['sav:interventions', 'Planifier les interventions', 'Créer, déplacer, clore les interventions'],
  ] },
  { group: 'Catalogue', items: [
    ['projects:read', 'Voir les projets', null],
    ['projects:create', 'Créer un projet', null, 'Projets'],
    ['projects:edit', 'Modifier la fiche du projet', 'Textes, images, caractéristiques, chiffres clés, conditions de paiement', 'Projets'],
    ['projects:publish', 'Publier, retirer du site ou archiver', null, 'Projets'],
    ['projects:prices', 'Types de biens et grille de prix', 'Prix catalogue et prix diaspora par type de bien', 'Projets'],
    ['projects:delete', 'Supprimer un projet', 'Seulement s’il n’a ni vente ni historique de lot', 'Projets'],
    ['plans:edit', 'Dessiner et importer les plans', 'Plans de masse, import DWG/DXF, publication des plans', 'Plans de masse et lots'],
    ['plans:lots', 'Créer et modifier les lots', 'Code, îlot, surface, prix, forme sur le plan', 'Plans de masse et lots'],
    ['plans:lots_delete', 'Supprimer un lot', 'Seulement un lot disponible ou non commercialisé, sans historique de vente', 'Plans de masse et lots'],
    ['settings:refs', 'Listes de référence', 'Villes, localisations, équipements, commodités, viabilisation, types de biens : ajouter, renommer, ordonner, archiver, supprimer', 'Paramètres'],
    ['settings:general', 'Réglages généraux', 'Acompte, délais de solde proposés et autres réglages de la plateforme', 'Paramètres'],
  ] },
  { group: 'Site web', items: [
    ['content:home', 'Diaporama, bandeau et chiffres clés', 'Page d’accueil du site', 'Contenu du site'],
    ['content:texts', 'Pages, sections et textes', 'Onglet « Éditorial »', 'Contenu du site'],
    ['content:images', 'Images des emplacements du site', 'Choisir l’image de chaque emplacement', 'Contenu du site'],
    ['content:contacts', 'Coordonnées et réseaux sociaux', 'Téléphones, e-mail, adresse, WhatsApp, réseaux', 'Contenu du site'],
    ['media:upload', 'Ajouter et renommer des fichiers', null, 'Médiathèque'],
    ['media:delete', 'Supprimer des fichiers', null, 'Médiathèque'],
    ['contacts:read', 'Voir les messages de contact', 'Sans la portée « toute l’équipe » : les messages de ses prospects et clients et la boîte commune (messages sans fiche ou dont la fiche n’est pas attribuée), jamais ceux des fiches d’un collègue'],
    ['contacts:handle', 'Traiter les messages de contact', 'Marquer un message traité ou l’archiver'],
    ['testimonials:write', 'Modérer les témoignages', 'Publier, refuser, mettre en avant'],
    ['newsletter:read', 'Voir les abonnés et les campagnes', null],
    ['newsletter:subscribers', 'Gérer les abonnés', 'Désinscrire, réinscrire', 'Newsletter'],
    ['newsletter:campaigns', 'Rédiger les campagnes', 'Créer, modifier, dupliquer, supprimer un brouillon ; e-mail de test', 'Newsletter'],
    ['newsletter:send', 'Envoyer les campagnes', 'Lancer, suspendre ou annuler l’envoi à tous les abonnés ; réglages d’envoi', 'Newsletter'],
  ] },
  { group: 'Administration', items: [
    ['users:read', 'Voir les utilisateurs', null],
    ['users:create', 'Créer un compte', 'Avec un rôle dont on a soi-même tous les privilèges', 'Comptes utilisateurs'],
    ['users:edit', 'Modifier un compte', 'Nom, e-mail, téléphone, fiche du personnel reliée', 'Comptes utilisateurs'],
    ['users:role', 'Changer le rôle d’un compte', 'Jamais vers un rôle qui a plus de privilèges que soi', 'Comptes utilisateurs'],
    ['users:password', 'Réinitialiser un mot de passe', 'Mot de passe provisoire, à changer à la connexion', 'Comptes utilisateurs'],
    ['users:disable', 'Désactiver ou réactiver un compte', null, 'Comptes utilisateurs'],
    ['roles:write', 'Créer de nouveaux rôles', 'Depuis RH › Réglages › Postes, avec des privilèges qu’on a soi-même ; modifier, renommer ou supprimer un rôle existant reste au super administrateur'],
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
// Colonnes du pipeline : les étapes de vente, puis le SAV (clients livrés, suivis dans « Client & SAV »)
const BOARD_STAGES = [...PIPELINE_STAGES, 'sav'];
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

// Parc immobilier : projet › îlot › bâtiment › étage › lot. Le type d'un bien est un type de biens des Paramètres
// coché sur la fiche du projet : même liste dans le dashboard et l'ERP.
/** Type de biens « terrain » d'après son libellé (compte de vente de terrains en comptabilité). */
const isLandType = label => /terrain|parcelle/i.test(String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
const BUILDING_KINDS = { immeuble: 'Immeuble collectif', residence: 'Résidence (villas groupées)', bloc: 'Bloc / rangée', autre: 'Autre' };

// Objectifs mensuels par commercial
const TARGET_METRICS = {
  taux_conversion: 'Taux de conversion (%)',
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

/*
 * Portefeuille commercial (choix du client, 21/10) : un prospect est attribué d'office au commercial qui a établi
 * le contact ; le responsable peut attribuer, répartir ou transférer. Chaque changement est daté et rattaché au
 * commercial du moment (table lead_portfolio_events) : un transfert A → B retire le prospect à A et l'ajoute à B
 * à la date du transfert, sans réécrire le passé. Deux compteurs : prospects (à l'attribution) et clients (à la
 * conversion, pour le commercial attribué ce jour-là). Les pertes sont montrées à part : brut, pertes, net.
 */
const PORTFOLIO_EVENTS = {
  attribution: 'Prospect attribué', retrait: 'Prospect retiré', client: 'Devenu client', desistement: 'Client désisté',
  perte: 'Prospect perdu', reprise: 'Prospect repris (n’est plus perdu)', suppression: 'Prospect supprimé',
};
const PORTFOLIO_REASONS = {
  creation: 'Création', import: 'Import', attribution: 'Attribution', transfert: 'Transfert', retrait: 'Retrait', reprise: 'Données existantes',
};

/**
 * État d'un prospect pour le portefeuille : commercial attribué, client actif (code client ou dossier, hors
 * désistement de tous ses dossiers), désisté, perdu.
 */
function portfolioState(lead, sales = []) {
  const desiste = sales.length > 0 && sales.every(s => s.status === 'desiste');
  return {
    owner: lead.assigned_to || null,
    client: !!(lead.client_code || sales.length) && !desiste,
    desiste,
    lost: lead.stage === 'perdu',
  };
}

/** État reconstitué à partir de l'historique (événements dans l'ordre). */
function replayPortfolio(events) {
  const s = { owner: null, client: false, desiste: false, lost: false, deleted: false, known: events.length > 0 };
  for (const e of events) {
    if (e.kind === 'attribution') s.owner = e.user_id || null;
    else if (e.kind === 'retrait') s.owner = null;
    else if (e.kind === 'client') { s.client = true; s.desiste = false; }
    else if (e.kind === 'desistement') { s.client = false; s.desiste = true; }
    else if (e.kind === 'perte') s.lost = true;
    else if (e.kind === 'reprise') s.lost = false;
    else if (e.kind === 'suppression') s.deleted = true;
  }
  return s;
}

/**
 * Événements à inscrire pour passer de l'état `prev` (historique) à l'état `cur` (base). L'ordre compte : le
 * transfert d'abord (le client ou la perte reviennent au nouveau commercial), puis la conversion, puis la perte.
 * `reason` : motif de l'attribution (creation, import, attribution) ; un changement de commercial est un transfert.
 */
function portfolioDiff(prev, cur, reason = 'attribution') {
  const out = [];
  if ((prev.owner || null) !== (cur.owner || null)) {
    if (prev.owner) out.push({ kind: 'retrait', user_id: prev.owner, reason: cur.owner ? 'transfert' : 'retrait' });
    if (cur.owner) out.push({ kind: 'attribution', user_id: cur.owner, reason: prev.owner ? 'transfert' : reason });
  }
  if (cur.client && !prev.client) out.push({ kind: 'client', user_id: cur.owner });
  if (cur.desiste && !prev.desiste) out.push({ kind: 'desistement', user_id: cur.owner });
  if (cur.lost !== prev.lost) out.push({ kind: cur.lost ? 'perte' : 'reprise', user_id: cur.owner });
  return out;
}

/**
 * Compteurs d'une liste d'événements (un commercial, une période) :
 * prospects reçus (brut), transférés à un autre, perdus (pertes − reprises + suppressions), net ;
 * clients gagnés (brut), désistés, net.
 */
function portfolioCounts(events) {
  const n = k => events.filter(e => e.kind === k).length;
  const recus = n('attribution');
  const transferes = events.filter(e => e.kind === 'retrait').length;
  const pertes = n('perte') - n('reprise') + n('suppression');
  const clients = n('client');
  const desistes = n('desistement');
  return {
    prospects: { brut: recus, transferes, pertes, net: recus - transferes - pertes },
    clients: { brut: clients, desistes, net: clients - desistes },
  };
}

/**
 * Taux de conversion (objectif principal du Service commercial, demande du client du 29/10) : nouveaux clients nets
 * (gagnés − désistés) ÷ prospects reçus sur la période (attribués − transférés à un collègue), en %. Les prospects
 * perdus restent au dénominateur (conversion manquée). Null sans prospect reçu.
 */
function conversionRate(counts) {
  const received = counts.prospects.brut - counts.prospects.transferes;
  return received > 0 ? Math.round((counts.clients.net / received) * 1000) / 10 : null;
}

/* ─── ERP · Administration générale › Courrier ─────────────────────────────── */

// N° d'ordre par sens et par an (choix du client du 22/10) : A-2026-0001 à l'arrivée, D-2026-0001 au départ
const MAIL_DIRECTIONS = { arrivee: { label: 'Arrivée', prefix: 'A' }, depart: { label: 'Départ', prefix: 'D' } };
const mailNumber = (direction, year, seq) => `${MAIL_DIRECTIONS[direction].prefix}-${year}-${String(seq).padStart(4, '0')}`;

/** Suite à donner, choisie par la direction selon la nature du courrier ; `days` : délai proposé (0 = sans délai). */
const MAIL_SUITES = {
  information: { label: 'Pour information', days: 0, done: 'Pris connaissance' },
  traitement: { label: 'Pour traitement / réponse', days: 7, done: 'Traité' },
  avis: { label: 'Pour avis', days: 3, done: 'Avis donné' },
  classement: { label: 'Pour classement', days: 0, done: 'Classé' },
};

/** Nature du courrier et suite proposée par défaut (la direction peut en choisir une autre). */
const MAIL_NATURES = {
  lettre: { label: 'Lettre', suite: 'traitement' },
  demande: { label: 'Demande / sollicitation', suite: 'traitement' },
  reclamation: { label: 'Réclamation', suite: 'traitement' },
  facture: { label: 'Facture / devis', suite: 'traitement' },
  administratif: { label: 'Courrier administratif (impôts, mairie, ministère…)', suite: 'traitement' },
  juridique: { label: 'Juridique (huissier, mise en demeure, notaire…)', suite: 'traitement' },
  convocation: { label: 'Convocation / invitation', suite: 'information' },
  circulaire: { label: 'Note, circulaire, information', suite: 'information' },
  rapport: { label: 'Rapport / document pour avis', suite: 'avis' },
  publicite: { label: 'Publicité / prospectus', suite: 'classement' },
  autre: { label: 'Autre', suite: 'information' },
};

const MAIL_CHANNELS = { poste: 'Poste', porteur: 'Dépôt / porteur', email: 'E-mail', huissier: 'Huissier', coursier: 'Coursier', autre: 'Autre' };

// enregistre → (affectation par la direction) affecte → traite ; classement à l'affectation ; départ : envoye
const MAIL_STATUSES = {
  enregistre: 'À affecter', affecte: 'En cours', traite: 'Traité', envoye: 'Envoyé', annule: 'Annulé',
};

/**
 * Ce qu'un compte voit d'un courrier : 'full', 'number' (n° d'ordre seul) ou 'none'.
 * Confidentiel (choix du client) : visible du destinataire et de la direction (droit courrier:assign) ;
 * les autres comptes du registre ne voient que le n° d'ordre. Le destinataire voit toujours son courrier.
 */
function mailVisibility(m, { userId, can, department = null }) {
  const recipient = m.assigned_to ? m.assigned_to === userId : !!(m.assigned_department && m.assigned_department === department);
  if (recipient || can('courrier:assign')) return 'full';
  const registry = can('courrier:read') || can('courrier:write');
  if (!registry) return 'none';
  return m.confidential ? 'number' : 'full';
}

/**
 * Relance due ce jour pour un courrier en cours : 'veille' la veille de l'échéance, 'retard' dès le lendemain de
 * l'échéance (une fois chacune). `today` et `due` au format AAAA-MM-JJ.
 */
function mailReminder(m, today) {
  if (m.status !== 'affecte' || !m.due_date) return null;
  const eve = addDays(m.due_date, -1);
  if (today > m.due_date) return m.reminded_late_at ? null : 'retard';
  if (today >= eve) return m.reminded_eve_at ? null : 'veille';
  return null;
}
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/* ─── ERP · Administration générale › Contrats et échéances ────────────────── */

// Tous les contrats de l'entreprise (choix du client du 22/10) ; « autre » + libellé libre pour le reste
const CONTRACT_KINDS = {
  fournisseur: 'Fournisseur / prestataire', sous_traitance: 'Sous-traitance de chantier', bail: 'Bail / location',
  assurance: 'Assurance', abonnement: 'Abonnement (internet, téléphonie, énergie, logiciels…)', autre: 'Autre',
};
// Périodicité des paiements (en mois) : chacun prépare une facture d'achat en brouillon en Comptabilité
const CONTRACT_FREQUENCIES = { mensuel: { label: 'Mensuel', months: 1 }, trimestriel: { label: 'Trimestriel', months: 3 }, semestriel: { label: 'Semestriel', months: 6 }, annuel: { label: 'Annuel', months: 12 } };
const CONTRACT_STATUSES = { actif: 'En cours', termine: 'Terminé', resilie: 'Résilié' };
const CONTRACT_DOC_KINDS = {
  attestation_assurance: 'Attestation d’assurance', caution: 'Caution bancaire', attestation_fiscale: 'Attestation de régularité fiscale',
  attestation_cnps: 'Attestation CNPS', autre: 'Autre pièce',
};
// Alertes 30 puis 7 jours avant (cadrage du 21/10) ; la facture d'un paiement est préparée 7 jours avant
const CONTRACT_ALERT_STAGES = [30, 7];
const CONTRACT_INVOICE_LEAD_DAYS = 7;

/**
 * Échéances suivies d'un contrat en cours : fin (ou renouvellement tacite), date limite du préavis, révision de prix,
 * prochain paiement, et pièces à renouveler. `docs` : [{ id, label, expires_on }].
 */
function contractDeadlines(c, docs = []) {
  if (c.status !== 'actif') return [];
  const out = [];
  if (c.end_date) {
    out.push({ key: 'fin', kind: 'fin', date: c.end_date, label: c.tacit_renewal ? 'Renouvellement tacite' : 'Fin du contrat' });
    if (c.notice_days) out.push({ key: 'preavis', kind: 'preavis', date: addDays(c.end_date, -c.notice_days), label: `Date limite du préavis (${c.notice_days} j)` });
  }
  if (c.revision_date) out.push({ key: 'revision', kind: 'revision', date: c.revision_date, label: 'Révision de prix' });
  if (c.next_payment_date && c.frequency) out.push({ key: 'paiement', kind: 'paiement', date: c.next_payment_date, label: `Paiement ${CONTRACT_FREQUENCIES[c.frequency]?.label.toLowerCase() || ''}`.trim() });
  for (const d of docs) if (d.expires_on) out.push({ key: `piece:${d.id}`, kind: 'piece', date: d.expires_on, label: `${d.label} à renouveler`, doc_id: d.id });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Palier d'alerte atteint pour une échéance (30 puis 7 jours avant ; 7 aussi une fois l'échéance passée). */
function contractAlertStage(date, today, [first, second] = CONTRACT_ALERT_STAGES) {
  const left = daysBetween(today, date);
  if (left <= second) return second;
  if (left <= first) return first;
  return null;
}

/** Fin d'un contrat à tacite reconduction une fois la date passée : prolongée de `renewal_months` (12 par défaut). */
function renewedEnd(c, today) {
  if (!c.tacit_renewal || !c.end_date || c.end_date >= today) return null;
  let end = c.end_date;
  while (end < today) end = addMonths(end, c.renewal_months || 12);
  return end;
}

/**
 * Paiements à préparer à `today` : chaque échéance dès 7 jours avant, sans dépasser la fin du contrat (une facture
 * par échéance). Renvoie les dates et la prochaine échéance restante.
 */
function contractPaymentsDue(c, today, leadDays = CONTRACT_INVOICE_LEAD_DAYS) {
  const step = CONTRACT_FREQUENCIES[c.frequency]?.months;
  if (c.status !== 'actif' || !step || !c.next_payment_date || !c.amount_ttc) return { dates: [], next: c.next_payment_date || null };
  const dates = [];
  let next = c.next_payment_date;
  const limit = addDays(today, leadDays);
  while (next <= limit && (!c.end_date || next <= c.end_date || c.tacit_renewal) && dates.length < 24) {
    dates.push(next);
    next = addMonths(next, step);
  }
  return { dates, next: c.end_date && !c.tacit_renewal && next > c.end_date ? null : next };
}

/* ─── ERP · Administration générale › Parc auto et matériel ────────────────── */

// Tous les biens (choix du client du 22/10) ; compteur : kilomètres (véhicules) ou heures moteur (engins)
const ASSET_KINDS = {
  vehicule: { label: 'Véhicule', prefix: 'VEH', meter: 'km' },
  engin: { label: 'Engin de chantier', prefix: 'ENG', meter: 'h' },
  materiel: { label: 'Petit matériel et outillage', prefix: 'MAT', meter: null },
  informatique: { label: 'Informatique et bureau', prefix: 'INF', meter: null },
  autre: { label: 'Autre matériel', prefix: 'DIV', meter: null },
};
const assetCode = (kind, seq) => `${ASSET_KINDS[kind].prefix}-${String(seq).padStart(4, '0')}`;
const ASSET_STATUSES = { disponible: 'Disponible', affecte: 'Affecté', maintenance: 'En panne / en réparation', reforme: 'Réformé / cédé' };
// Affectation : à un employé (remise / restitution) ou à un chantier (mouvement dépôt → chantier)
const ASSET_ASSIGNMENT_KINDS = { employe: 'Employé', chantier: 'Chantier' };
// Échéances administratives : alertes 30 puis 7 jours avant (comme les contrats)
const ASSET_DOC_KINDS = {
  assurance: 'Assurance', visite_technique: 'Visite technique', vignette: 'Vignette', carte_transport: 'Carte de transport',
  carte_grise: 'Carte grise', garantie: 'Garantie constructeur', autre: 'Autre échéance',
};
// Dépenses saisies dans le parc (le carburant porte les litres et le compteur)
const ASSET_COST_KINDS = {
  carburant: 'Carburant', entretien: 'Entretien planifié', reparation: 'Panne / réparation', pneus: 'Pneumatiques', location: 'Location',
  assurance: 'Assurance', taxes: 'Vignette, visite, taxes', autre: 'Autre dépense',
};
const RESERVATION_STATUSES = { demandee: 'Demandée', accordee: 'Accordée', refusee: 'Refusée', annulee: 'Annulée' };
// Entretien « à prévoir » avant l'échéance : 7 jours, 500 km ou 20 heures
const MAINTENANCE_SOON = { days: 7, km: 500, h: 20 };

/**
 * Prochain entretien d'un plan (vidange tous les 10 000 km ou 6 mois, révision toutes les 250 h…) : le premier atteint
 * du compteur ou de la date. Renvoie { next_date, next_meter, state: 'ok' | 'bientot' | 'du' }.
 */
function maintenanceDue(plan, asset, today, soon = MAINTENANCE_SOON) {
  const meterStep = asset.meter === 'km' ? plan.every_km : asset.meter === 'h' ? plan.every_hours : null;
  const next_meter = meterStep && plan.last_meter != null ? Number(plan.last_meter) + Number(meterStep) : null;
  const next_date = plan.every_months && plan.last_date ? addMonths(plan.last_date, plan.every_months) : null;
  const current = asset.meter_value == null ? null : Number(asset.meter_value);
  let state = 'ok';
  if ((next_date && next_date <= today) || (next_meter != null && current != null && current >= next_meter)) state = 'du';
  else if ((next_date && daysBetween(today, next_date) <= soon.days)
    || (next_meter != null && current != null && next_meter - current <= (asset.meter === 'h' ? soon.h : soon.km))) state = 'bientot';
  return { next_date, next_meter, state };
}

/**
 * Consommation moyenne à partir des pleins (plein complet à chaque fois) : litres versés après le premier plein,
 * rapportés au compteur parcouru. L/100 km pour un véhicule, L/h pour un engin ; null sans deux relevés.
 */
function fuelConsumption(fills, meter) {
  const rows = fills.filter(f => f.meter_value != null && f.liters).sort((a, b) => Number(a.meter_value) - Number(b.meter_value));
  if (rows.length < 2 || !meter) return null;
  const distance = Number(rows[rows.length - 1].meter_value) - Number(rows[0].meter_value);
  if (distance <= 0) return null;
  const liters = rows.slice(1).reduce((t, f) => t + Number(f.liters), 0);
  const value = meter === 'km' ? (liters / distance) * 100 : liters / distance;
  return { value: Math.round(value * 10) / 10, unit: meter === 'km' ? 'L/100 km' : 'L/h', liters, distance };
}

/**
 * Paiement d'une dépense du parc et sa traduction en comptabilité (choix du client du 23/10) : facture du fournisseur
 * (facture d'achat en brouillon), espèces ou Mobile Money (écriture de trésorerie en brouillon), carte carburant
 * prépayée (écriture qui consomme l'avance faite à la station), avance de l'employé (remboursée par sa note de frais).
 * Une seule validation : celle du comptable sur la facture ou l'écriture.
 */
const ASSET_PAYMENT_MODES = {
  fournisseur: { label: 'Facture du fournisseur', accounting: 'facture' },
  caisse: { label: 'Espèces (caisse)', accounting: 'ecriture', journal: 'CA' },
  mobile: { label: 'Mobile Money', accounting: 'ecriture', journal: 'MM' },
  carte: { label: 'Carte carburant prépayée', accounting: 'ecriture', journal: 'OD' },
  employe: { label: 'Avancé par l’employé (note de frais)', accounting: 'frais' },
};
const COST_ACCOUNTING_STATUSES = { a_valider: 'À valider (Comptabilité)', validee: 'Validée', rejetee: 'Rejetée', note_de_frais: 'Remboursée par note de frais' };

/**
 * État comptable d'une dépense : d'après sa facture (brouillon, validée, annulée ou supprimée) ou son écriture
 * (brouillon, validée ou supprimée). `doc_status` : statut de la pièce liée, null si elle n'existe plus.
 */
function costAccountingStatus(c) {
  if (c.rejected_at) return 'rejetee';
  if (c.accounting === 'frais') return 'note_de_frais';
  if (c.accounting === 'facture') return c.doc_status === 'validee' ? 'validee' : c.doc_status === 'brouillon' ? 'a_valider' : 'rejetee';
  if (c.accounting === 'ecriture') return c.doc_status === 'valide' ? 'validee' : c.doc_status === 'brouillon' ? 'a_valider' : 'rejetee';
  return null; // dépense saisie avant le lien avec la Comptabilité
}

/**
 * Amortissement linéaire au prorata temporis (choix du client du 23/10). `a` : { fixed_value, in_service_on,
 * depreciation_years, prior_depreciation, prior_as_of, disposed_on }. Cumul des amortissements au soir de `day` :
 * amortissements déjà pratiqués à la reprise (`prior_as_of`), plus la part de la valeur courue depuis, plafonné à la
 * valeur d'origine ; arrêté à la sortie de l'actif.
 */
function depreciationAt(a, day) {
  const value = Number(a.fixed_value || 0);
  if (!value || !a.in_service_on || !a.depreciation_years) return 0;
  const prior = Number(a.prior_depreciation || 0);
  const from = a.prior_as_of && a.prior_as_of > a.in_service_on ? a.prior_as_of : a.in_service_on;
  const until = a.disposed_on && a.disposed_on < day ? a.disposed_on : day;
  if (until < from) return a.prior_as_of && day >= a.prior_as_of ? Math.min(value, prior) : 0;
  const days = daysBetween(from, until) + (a.prior_as_of && from === a.prior_as_of ? 0 : 1);
  return Math.min(value, Math.round(prior + (value * days) / (Number(a.depreciation_years) * 365)));
}
/** Dotation d'un exercice : cumul à sa fin moins cumul à la veille de son début. */
const depreciationFor = (a, start, end) => Math.max(0, depreciationAt(a, end) - depreciationAt(a, addDays(start, -1)));

/** Deux réservations du même véhicule se chevauchent (début et fin « AAAA-MM-JJTHH:MM »). */
const reservationsOverlap = (a, b) => a.start_at < b.end_at && b.start_at < a.end_at;

/* ─── ERP · Administration générale › Documents internes ───────────────────── */

// Quatre sortes (choix du client du 22/10) ; seuls les modèles n'appellent pas d'accusé de lecture
const DOC_KINDS = {
  note: { label: 'Note de service', prefix: 'NS', ack: true },
  procedure: { label: 'Procédure / règlement', prefix: 'PR', ack: true },
  pv: { label: 'PV de réunion', prefix: 'PV', ack: true },
  modele: { label: 'Modèle / formulaire', prefix: 'MO', ack: false },
};
// Diffusion : tout le personnel (comptes reliés à une fiche employé), un ou plusieurs services, des personnes nommées
const DOC_AUDIENCES = { tous: 'Tout le personnel', services: 'Services', personnes: 'Personnes nommées' };
const DOC_STATUSES = { brouillon: 'Brouillon', publie: 'Publié', archive: 'Archivé' };
const DOC_ACTION_STATUSES = { a_faire: 'À faire', fait: 'Fait' };
const docReference = (kind, year, seq) => `${DOC_KINDS[kind].prefix}-${year}-${String(seq).padStart(4, '0')}`;

/**
 * Relance d'un accusé de lecture non donné : 'veille' la veille du délai (ou le jour même), 'retard' dès le lendemain.
 * Sans délai : aucune relance.
 */
function readReminder(deadline, today) {
  if (!deadline) return null;
  if (today > deadline) return 'retard';
  if (today >= addDays(deadline, -1)) return 'veille';
  return null;
}

/* ─── ERP · Administration générale › Demandes internes ────────────────────── */

const REQUEST_KINDS = {
  achat: { label: 'Achat / fourniture', purchase: true },
  equipement: { label: 'Équipement pour le bureau ou le chantier', purchase: true },
  intervention: { label: 'Intervention / dépannage', purchase: false },
  materiel: { label: 'Prêt de matériel', purchase: false },
  service: { label: 'Demande à un service', purchase: false, service: true },
  autre: { label: 'Autre demande', purchase: false },
};
/**
 * Services destinataires d'une « demande à un service » (29/10) : comptes qui la traitent (droits) et module où elle
 * s'affiche (carte « Demandes reçues »). L'Administration générale passe par les services généraux (attente_sg).
 */
const REQUEST_SERVICES = {
  rh: { label: 'Ressources humaines', perms: ['rh:files'], module: 'rh', link: '/rh' },
  commercial: { label: 'Service commercial', perms: ['leads:assign', 'leads:transfer_decide'], module: 'commercial', link: '/commercial' },
  sav: { label: 'Client & SAV', perms: ['sav:edit', 'sav:status', 'sav:comment'], module: 'sav', link: '/sav' },
  compta: { label: 'Comptabilité', perms: ['compta:entries', 'achats:write'], module: 'compta', link: '/compta' },
  juridique: { label: 'Juridique', perms: ['juridique:deeds', 'juridique:litigation', 'juridique:guarantees', 'juridique:settings'], module: 'juridique', link: '/juridique' },
  administration: { label: 'Administration générale (services généraux)', perms: ['demandes:handle'], module: 'administration', link: '/administration/demandes' },
};
const REQUEST_STATUSES = {
  attente_responsable: 'En attente du responsable', attente_dg: 'En attente de la DG', attente_sg: 'À traiter (services généraux)',
  attente_achats: 'À traiter (Achats)', commande: 'Commandée (Achats)', attente_service: 'À traiter (service destinataire)',
  en_cours: 'En cours de traitement', traitee: 'Traitée', refusee: 'Refusée', annulee: 'Annulée',
};
const REQUEST_OPEN = ['attente_responsable', 'attente_dg', 'attente_sg', 'attente_achats', 'commande', 'attente_service', 'en_cours'];
const REQUEST_DG_THRESHOLD = 500000;

/** La direction générale valide les achats (et équipements) dont le montant estimé atteint le plafond. */
const requestNeedsDg = (r, threshold) => !!REQUEST_KINDS[r.kind]?.purchase && Number(r.estimated_amount || 0) >= threshold;

/**
 * Étape suivante d'une demande (choix du client du 22/10) : responsable direct → DG (achat au-delà du plafond) →
 * services généraux. `from` : l'étape franchie (null à la création). Une étape sans valideur est sautée.
 */
function requestNextStep(r, { from = null, hasManager, threshold }) {
  // Demande à un service : directement au service (sans accord du responsable) ; l'Administration générale = services généraux
  if (REQUEST_KINDS[r.kind]?.service) return r.service === 'administration' ? 'attente_sg' : 'attente_service';
  // Achat ou équipement : traité par les Achats (bon de commande → réception → facture), le reste par les services généraux
  const last = REQUEST_KINDS[r.kind]?.purchase ? 'attente_achats' : 'attente_sg';
  const steps = ['attente_responsable', 'attente_dg', last];
  const applies = { attente_responsable: hasManager, attente_dg: requestNeedsDg(r, threshold), [last]: true };
  const start = from ? steps.indexOf(from) + 1 : 0;
  return steps.slice(start).find(s => applies[s]);
}

/* ─── ERP · Juridique ──────────────────────────────────────────────────────── */

/**
 * Circuit de la vente, de la réservation à l'acte (choix du client du 23/10) : six étapes datées, franchies dans
 * l'ordre. La date de l'acte est celle du dossier de vente (sales.signed_at, aussi saisie dans le dashboard) :
 * une seule source pour la Comptabilité (chiffre d'affaires « à l'acte ») et l'espace client.
 */
const DEED_STEPS = [
  { key: 'reservation', label: 'Contrat de réservation signé' },
  { key: 'pieces', label: 'Pièces du client complètes' },
  { key: 'notaire', label: 'Dossier transmis au notaire' },
  { key: 'projet', label: 'Projet d’acte reçu' },
  { key: 'acte', label: 'Acte signé' },
  { key: 'remise', label: 'Expédition remise au client' },
];
const DEED_STEP_KEYS = DEED_STEPS.map(s => s.key);

/**
 * Avancement d'un dossier : `dates` = { reservation, pieces, notaire, projet, acte, remise } (AAAA-MM-JJ ou null).
 * Renvoie les étapes avec leur date, l'étape en cours (première non faite) et le nombre d'étapes faites.
 */
function deedProgress(dates) {
  const steps = DEED_STEPS.map(s => ({ ...s, date: dates[s.key] || null }));
  // Acte signé (dossier repris sans les étapes d'avant comprises) : seule l'expédition reste à remettre
  const current = dates.acte ? (dates.remise ? null : steps.find(s => s.key === 'remise')) : steps.find(s => !s.date) || null;
  return { steps, current: current?.key || null, current_label: current ? current.label : 'Dossier terminé', done: steps.filter(s => s.date).length };
}

/** Refus d'une saisie d'étape : on ne date une étape qu'après la précédente ; on n'efface pas une étape suivie d'une autre. */
function deedStepRefusal(dates, key, value) {
  const i = DEED_STEP_KEYS.indexOf(key);
  if (i < 0) return 'Étape inconnue.';
  if (value) {
    const before = DEED_STEP_KEYS.slice(0, i).find(k => !dates[k]);
    if (before) return `Datez d’abord l’étape « ${DEED_STEPS.find(s => s.key === before).label} ».`;
    const prev = DEED_STEP_KEYS.slice(0, i).reverse().find(k => dates[k]);
    if (prev && value < dates[prev]) return `La date précède celle de l’étape « ${DEED_STEPS.find(s => s.key === prev).label} ».`;
    return null;
  }
  if (key === 'acte') return 'L’acte signé ne s’efface pas : corrigez sa date au besoin.';
  const after = DEED_STEP_KEYS.slice(i + 1).find(k => dates[k]);
  return after ? 'Une étape suivante est déjà datée : effacez-la d’abord.' : null;
}

// Litiges (choix du client du 23/10) : origine, étapes datées, prochaine échéance (alertes la veille et le jour)
const LITIGATION_ORIGINS = {
  sav: 'Réclamation SAV', impaye: 'Impayé client', fournisseur: 'Fournisseur', sous_traitant: 'Sous-traitant', employe: 'Employé', autre: 'Autre',
};
const LITIGATION_STAGES = {
  amiable: 'Règlement amiable', mise_en_demeure: 'Mise en demeure', huissier: 'Huissier', avocat: 'Avocat saisi',
  audience: 'Audience', jugement: 'Jugement', clos: 'Clos',
};
const LITIGATION_OUTCOMES = { gagne: 'Gagné', perdu: 'Perdu', transaction: 'Transaction / accord', abandon: 'Abandon' };

/**
 * Alerte due pour l'échéance d'un litige : 'veille' la veille, 'jour' le jour même et les jours suivants
 * (une fois chacune, jamais pour une échéance passée depuis plus de 7 jours).
 */
function litigationReminder(date, today) {
  if (!date || daysBetween(date, today) > 7) return null;
  if (today >= date) return 'jour';
  if (today >= addDays(date, -1)) return 'veille';
  return null;
}

/**
 * Cautions et garanties : chaque sorte (réglable dans Juridique › Réglages) a un sens — reçue d'un tiers, donnée par
 * SIIPAF, ou retenue de garantie (sous-traitance, libérée à la fin du délai de garantie comptée depuis la réception).
 */
const GUARANTEE_DIRECTIONS = { recue: 'Reçue d’un tiers', donnee: 'Donnée par SIIPAF', retenue: 'Retenue de garantie' };
const DEFAULT_GUARANTEE_KINDS = [
  ['Retenue de garantie', 'retenue'],
  ['Caution de bonne exécution', 'recue'],
  ['Caution de restitution d’avance', 'recue'],
  ['Caution de soumission', 'recue'],
  ['Caution de retenue de garantie', 'recue'],
  ['Garantie bancaire donnée', 'donnee'],
  ['Caution administrative ou douanière', 'donnee'],
];
const GUARANTEE_STATUSES = { active: 'En cours', liberee: 'Libérée / mainlevée', appelee: 'Mise en jeu', expiree: 'Expirée' };

/** Date suivie d'une caution en cours : libération (retenue) ou expiration (caution). */
function guaranteeDeadline(g) {
  if (g.status !== 'active') return null;
  if (g.direction === 'retenue') return g.release_on ? { date: g.release_on, label: 'Retenue à libérer' } : null;
  if (!g.expires_on) return null;
  return { date: g.expires_on, label: g.direction === 'donnee' ? 'Caution donnée : mainlevée à obtenir' : 'Caution reçue : expiration' };
}

// Réglages du Juridique (ERP › Juridique › Réglages), distincts des Paramètres du dashboard
const LEGAL_SETTINGS = {
  legal_unpaid_days: { label: 'Impayé transmis au Juridique après (jours de retard)', default: 90, min: 1, max: 720 },
  legal_warranty_months: { label: 'Délai de garantie des retenues (mois après la réception)', default: 12, min: 1, max: 120 },
  legal_alert_first_days: { label: 'Cautions : premier rappel (jours avant l’échéance)', default: 30, min: 2, max: 120 },
  legal_alert_second_days: { label: 'Cautions : second rappel (jours avant l’échéance)', default: 7, min: 1, max: 60 },
};

/** Plus ancienne échéance impayée d'un échéancier (lignes de allocatePayments) et son retard en jours. */
function unpaidAge(lines, today) {
  const late = lines.filter(l => l.status === 'en_retard');
  if (!late.length) return null;
  return { due_date: late[0].due_date, days: daysBetween(late[0].due_date, today), overdue_fcfa: late.reduce((t, l) => t + l.remaining_fcfa, 0), count: late.length };
}

/* ─── Lieux hors programmes ────────────────────────────────────────────────── */

/**
 * Siège social, bureaux annexes, dépôts et autres emplacements (choix du client du 24/10) : axe analytique à côté du
 * programme. Une pièce porte un programme (et un chantier) ou un lieu ; sans l'un ni l'autre, le siège social.
 */
const PLACE_KINDS = { siege: 'Siège social', annexe: 'Bureau annexe / agence', depot: 'Dépôt / magasin', autre: 'Autre' };

/* ─── ERP · Chantiers ──────────────────────────────────────────────────────── */

/**
 * Choix du client du 24/10 (docs/cadrage-chantiers.md) : plusieurs chantiers par programme, chacun avec sa zone
 * (tout le programme, des îlots, des bâtiments ou des lots), son conducteur de travaux, ses phases (Gantt), ses
 * tâches (Kanban) et son budget par poste. Les phases reprennent les étapes du journal de chantier (SITE_STAGES).
 */
const CHANTIER_ACTIONS = ['chantiers:read', 'chantiers:create', 'chantiers:plan', 'chantiers:budget', 'chantiers:settings', 'chantiers:tma', 'chantiers:stages', 'chantiers:situations'];
const WORKSITE_STATUSES = { preparation: 'En préparation', en_cours: 'En cours', suspendu: 'Suspendu', receptionne: 'Réceptionné', clos: 'Clos' };
const WORKSITE_OPEN = ['preparation', 'en_cours', 'suspendu'];
const WORKSITE_ZONES = { programme: 'Tout le programme', ilots: 'Des îlots', batiments: 'Des bâtiments', lots: 'Des lots' };
const TASK_STATUSES = { a_faire: 'À faire', en_cours: 'En cours', bloque: 'Bloquée', fait: 'Faite' };
const PHASE_STATES = { a_venir: 'À venir', en_cours: 'En cours', en_retard: 'En retard', termine: 'Terminée' };

/** Le lot fait-il partie de la zone du chantier ? `zone` : îlots (noms), bâtiments ou lots (identifiants). */
function lotInZone(worksite, lot) {
  if (Number(lot.project_id) !== Number(worksite.project_id)) return false;
  const zone = Array.isArray(worksite.zone) ? worksite.zone : [];
  if (worksite.zone_kind === 'ilots') return zone.map(String).includes(String(lot.ilot ?? ''));
  if (worksite.zone_kind === 'batiments') return zone.map(Number).includes(Number(lot.building_id));
  if (worksite.zone_kind === 'lots') return zone.map(Number).includes(Number(lot.id));
  return true;
}

/**
 * État d'une phase au jour donné : terminée (fin réelle ou 100 %), en retard (fin prévue passée, ou début prévu passé
 * sans démarrage), en cours (démarrée), à venir. `late_days` : jours de retard sur la fin (ou le début) prévue.
 */
function phaseState(p, today) {
  if (p.actual_end || Number(p.progress_pct) >= 100) {
    const late = p.planned_end && p.actual_end ? Math.max(0, daysBetween(p.planned_end, p.actual_end)) : 0;
    return { state: 'termine', late_days: late };
  }
  if (p.planned_end && today > p.planned_end) return { state: 'en_retard', late_days: daysBetween(p.planned_end, today) };
  if (!p.actual_start && p.planned_start && today > p.planned_start) return { state: 'en_retard', late_days: daysBetween(p.planned_start, today) };
  return { state: p.actual_start ? 'en_cours' : 'a_venir', late_days: 0 };
}

/** Avancement d'un chantier : moyenne des phases pondérée par leur durée prévue (1 jour au moins), arrondie. */
function worksiteProgress(phases) {
  if (!phases.length) return 0;
  let weight = 0;
  let sum = 0;
  for (const p of phases) {
    const w = p.planned_start && p.planned_end ? Math.max(1, daysBetween(p.planned_start, p.planned_end) + 1) : 1;
    const pct = p.actual_end ? 100 : Math.min(100, Math.max(0, Number(p.progress_pct) || 0));
    weight += w;
    sum += w * pct;
  }
  return Math.round(sum / weight);
}

// Réglages des chantiers (ERP › Chantiers › Réglages), distincts des Paramètres du dashboard
const CHANTIER_SETTINGS = {
  chantier_budget_alert_pct: { label: 'Alerte de budget à (% consommé)', hint: 'Le conducteur et la Direction sont prévenus une fois à ce seuil, puis une fois au dépassement du budget', default: 90, min: 50, max: 100 },
  chantier_retention_pct: { label: 'Retenue de garantie par défaut des marchés de sous-traitance (%)', hint: 'Proposée à la création d’un marché ; modifiable marché par marché', default: 5, min: 0, max: 10 },
  chantier_retention_base: {
    label: 'Assiette de la retenue de garantie', hint: 'Montant de chaque situation sur lequel le taux du marché s’applique ; conservé sur chaque situation au moment de sa saisie',
    default: 'ttc', options: { ttc: 'Montant TTC de la situation', ht: 'Montant HT de la situation' },
  },
  tma_due_days: { label: 'Paiement d’une TMA acceptée (jours après l’accord de l’acquéreur)', hint: 'Échéance ajoutée à l’échéancier du dossier quand l’acquéreur accepte le devis dans son espace client', default: 15, min: 0, max: 120 },
  chantier_monthly_hours: { label: 'Heures de travail par mois (coût horaire tiré du salaire)', hint: 'Coût mensuel employeur (salaire, charges et taxes de la paie) divisé par ces heures, pour qui n’a pas de coût horaire de chantier sur sa fiche', default: 173, min: 100, max: 260 },
};

// Lot 5 : travaux modificatifs des acquéreurs (TMA) et besoins en matériaux
const TMA_STATUSES = {
  demandee: 'Demandée, à chiffrer', chiffree: 'Devis envoyé à l’acquéreur', acceptee: 'Acceptée par l’acquéreur', refusee: 'Refusée par l’acquéreur',
  annulee: 'Annulée', realisee: 'Réalisée',
};
const TMA_BILLED = ['acceptee', 'realisee']; // statuts dont le montant s'ajoute à l'échéancier du dossier
// Circuit (choix du client du 25/10) : le chantier exprime le besoin, transmis aux Achats ; les Achats le commandent
// (bon de commande validé) ou le refusent ; la réception du bon le livre. « Validé » : état antérieur, encore commandable.
const NEED_STATUSES = { demande: 'Transmis aux Achats', valide: 'Validé', refuse: 'Refusé par les Achats', commande: 'Commandé', livre: 'Livré', annule: 'Annulé' };

// Étapes déclarées (lot 3) ; la météo du journal et les postes du budget sont des listes réglables (table worksite_ref_items)
const DECLARATION_STATUSES = { signalee: 'Signalée, à déclarer', declaree: 'Déclarée par la Direction', refusee: 'Refusée' };

/**
 * Livraison prévue d'un chantier : fin prévue de sa phase « Livraison », sinon fin prévue du chantier.
 * `phases` : phases du chantier (stage, planned_end).
 */
function deliveryForecast(worksite, phases = []) {
  const p = phases.find(x => x.stage === 'livraison' && x.planned_end);
  return p ? p.planned_end : worksite.planned_end || null;
}

/** Retard prévu (jours) entre la date promise à l'acquéreur et la livraison prévue ; 0 si livré ou dans les temps. */
function deliveryDelay(promised, forecast, deliveredAt = null) {
  if (!promised || deliveredAt) return 0;
  if (!forecast) return 0;
  return Math.max(0, daysBetween(promised, forecast));
}

/* ─── Circuit d'information entre les services ─────────────────────────────── */

/**
 * Demande du client du 25/10 : chaque événement métier (déclaration, transfert, échange d'informations entre modules)
 * prévient, par la cloche, les services concernés en plus des personnes directement visées. Les destinataires par
 * défaut ci-dessous sont réglables dans ERP › Administration générale › Circuit d'information.
 * Un service = les comptes qui ont l'un des droits indiqués (rôles et privilèges) ; la Direction générale comprend
 * aussi le super administrateur.
 */
const INFO_AUDIENCES = {
  commercial_resp: { label: 'Responsables commerciaux', hint: 'Comptes qui attribuent les prospects et valident les transferts', perms: ['leads:assign', 'leads:transfer_decide'], module: 'commercial' },
  achats: { label: 'Achats & stocks', hint: 'Comptes qui préparent les achats, valident les commandes ou gèrent les stocks', perms: ['appro:locations', 'appro:needs', 'appro:quotes', 'appro:orders', 'appro:validate', 'appro:direction', 'appro:stock', 'appro:receive', 'appro:minimum'], module: 'achats' },
  dg: { label: 'Direction générale', hint: 'Super administrateur et comptes qui valident en direction (demandes, chantiers)', perms: ['demandes:dg', 'chantiers:stages', 'chantiers:situations'], superAdmin: true },
  exploitation: { label: 'Direction des exploitations', hint: 'Comptes qui ouvrent la Vue Direction', perms: ['direction:read'] },
  compta: { label: 'Comptabilité', hint: 'Comptes qui saisissent les écritures ou les achats', perms: ['compta:entries', 'achats:write', 'achats:validate'], module: 'compta' },
  juridique: { label: 'Juridique', hint: 'Comptes qui gèrent le Juridique', perms: ['juridique:deeds', 'juridique:litigation', 'juridique:guarantees', 'juridique:settings'], module: 'juridique' },
  marketing: { label: 'Marketing & Communication', hint: 'Comptes qui valident les contenus (responsable de la communication)', perms: ['marketing:validate'], module: 'marketing' },
  qhse: { label: 'QHSE', hint: 'Comptes qui valident les contrôles hebdomadaires et les audits (direction des exploitations, ressources humaines, responsable QHSE)', perms: ['qhse:validate'], module: 'qhse' },
  sav: { label: 'Client & SAV', hint: 'Comptes qui traitent les réclamations', perms: ['sav:edit', 'sav:status', 'sav:comment'], module: 'sav' },
  chantiers: { label: 'Chantiers', hint: 'Gestionnaires des chantiers', perms: ['chantiers:create', 'chantiers:plan', 'chantiers:budget', 'chantiers:settings', 'chantiers:tma'], module: 'chantiers' },
  rh: { label: 'Ressources humaines', hint: 'Comptes qui tiennent les dossiers du personnel', perms: ['rh:files'], module: 'rh' },
  services_generaux: { label: 'Services généraux', hint: 'Comptes qui traitent les demandes internes ou gèrent le parc', perms: ['demandes:handle', 'parc:write', 'parc:reservations'], module: 'administration' },
};
const INFO_EVENTS = {
  'devis.recu': { module: 'achats', label: 'Devis fournisseur reçu', audiences: ['achats'], requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis.' },
  'commande.soumise': { module: 'achats', label: 'Commande soumise au validateur désigné (sous le plafond)', audiences: [], priority: 'action', requiredPerms: ['appro:read'], recipient_hint: 'Le validateur désigné est toujours prévenu ; services en plus à cocher.' },
  'commande.a_valider': { module: 'achats', label: 'Commande soumise à la validation Direction (à partir du plafond)',audiences: ['dg', 'exploitation'], priority: 'action', requiredPerms: ['appro:read', 'appro:direction'], recipient_hint: 'Accès à Achats & stocks et droit de validation Direction requis.' },
  'commande.confirmee': { module: 'achats', label: 'Bon de commande confirmé', audiences: ['achats', 'exploitation', 'chantiers', 'compta'], requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis.' },
  'commande.refusee': { module: 'achats', label: 'Bon de commande refusé', audiences: ['achats', 'exploitation'], requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis.' },
  'commande.annulee': { module: 'achats', label: 'Bon de commande annulé', audiences: ['achats', 'exploitation'], requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis.' },
  'appro.reception': { module: 'achats', label: 'Réception de commande, partielle ou complète', audiences: ['achats', 'chantiers', 'compta', 'exploitation'], requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis.' },
  'stock.entree': { module: 'achats', label: 'Entrée ou stock initial validé', audiences: ['achats', 'chantiers'], requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis.' },
  'stock.sortie': { module: 'achats', label: 'Sortie de stock validée', audiences: ['achats', 'chantiers'], requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis.' },
  'stock.transfert': { module: 'achats', label: 'Transfert de stock validé', audiences: ['achats', 'chantiers'], requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis.' },
  'stock.bas': { module: 'achats', label: 'Stock au seuil ou en rupture', audiences: ['achats', 'exploitation'], priority: 'action', requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis.' },
  'commande.payee': { module: 'achats', label: 'Règlement fournisseur d’une commande enregistré en Comptabilité', audiences: ['achats'], requiredPerms: ['appro:read'], recipient_hint: 'L’émetteur de la commande est prévenu ; accès à Achats & stocks requis.' },
  'appro.facture': { module: 'compta', label: 'Facture issue d’une réception préparée en brouillon', audiences: ['compta'], priority: 'action', requiredPerms: ['compta:read'], recipient_hint: 'Accès à la Comptabilité requis ; le brouillon reste à contrôler et à valider.' },
  'chantier.cree': { module: 'chantiers', label: 'Nouveau chantier ouvert', audiences: ['dg', 'exploitation'] },
  'chantier.etape_signalee': { module: 'chantiers', label: 'Étape de chantier signalée, à déclarer', audiences: ['dg', 'exploitation'], priority: 'action' },
  'chantier.etape_declaree': { module: 'chantiers', label: 'Étape déclarée : appels de fonds VEFA émis', audiences: ['dg', 'exploitation', 'compta'] },
  'chantier.etape_refusee': { module: 'chantiers', label: 'Étape de chantier refusée', audiences: ['exploitation'] },
  'chantier.incident': { module: 'chantiers', label: 'Incident au journal de chantier', audiences: ['dg', 'exploitation'], priority: 'action' },
  'chantier.situation_verifiee': { module: 'chantiers', label: 'Situation de sous-traitant à valider', audiences: ['dg', 'exploitation'], priority: 'action' },
  'chantier.situation_validee': { module: 'chantiers', label: 'Situation de sous-traitant validée (facture et retenue)', audiences: ['exploitation', 'compta', 'juridique'] },
  'chantier.situation_refusee': { module: 'chantiers', label: 'Situation de sous-traitant refusée', audiences: ['exploitation'] },
  'budget.depasse': { module: 'chantiers', label: 'Budget de chantier au seuil ou dépassé', audiences: ['dg', 'exploitation', 'compta'], priority: 'action' },
  'chantier.livraison_retard': { module: 'chantiers', label: 'Livraison promise à un acquéreur en retard prévu', audiences: ['dg', 'exploitation', 'sav'], priority: 'action' },
  'vente.ouverte': { module: 'commercial', label: 'Nouveau dossier de vente (lot réservé)', audiences: ['dg', 'exploitation', 'compta', 'juridique'] },
  'acte.signe': { module: 'juridique', label: 'Acte notarié signé (lot vendu)', audiences: ['dg', 'exploitation', 'compta', 'sav'] },
  'reclamation.ouverte': { module: 'sav', label: 'Nouvelle réclamation d’un acquéreur', audiences: ['sav', 'exploitation'] },
  'litige.ouvert': { module: 'juridique', label: 'Litige ouvert', audiences: ['dg', 'juridique'], priority: 'action' },
  'impaye.transmis': { module: 'juridique', label: 'Impayé transmis au Juridique', audiences: ['dg', 'juridique', 'exploitation'], priority: 'action' },
  'tma.demandee': { module: 'chantiers', label: 'Travaux modificatifs (TMA) demandés par un acquéreur', audiences: ['exploitation'], priority: 'action' },
  'tma.acceptee': { module: 'chantiers', label: 'TMA acceptée par l’acquéreur (montant ajouté à l’échéancier)', audiences: ['exploitation', 'compta'], priority: 'action' },
  'tma.refusee': { module: 'chantiers', label: 'TMA refusée par l’acquéreur', audiences: [] },
  'demande.achat': { module: 'achats', label: 'Demande d’achat d’un service validée, à commander', audiences: ['achats'], priority: 'action', requiredPerms: ['appro:read'], recipient_hint: 'Accès à Achats & stocks requis ; le demandeur est prévenu de la commande et de la livraison.' },
  'chantier.besoin': { module: 'achats', label: 'Besoin en matériaux transmis par un chantier aux Achats', audiences: [], priority: 'action' },
  'lot.livre': { module: 'chantiers', label: 'Lot réceptionné par l’acquéreur (PV, réserves, garanties)', audiences: ['dg', 'exploitation', 'sav', 'juridique', 'compta'] },
  'chantier.marche_receptionne': { module: 'chantiers', label: 'Travaux d’un sous-traitant réceptionnés (libération de la retenue programmée)', audiences: ['juridique', 'compta'] },
  'chantier.phase_retard': { module: 'chantiers', label: 'Phase de chantier en retard sur le planning', audiences: ['exploitation'], priority: 'action' },
  'vente.versement': { module: 'commercial', label: 'Versement d’un client enregistré ou confirmé', audiences: ['compta', 'commercial_resp'], recipient_hint: 'Le commercial du client est toujours prévenu.' },
  'versement.a_confirmer': { module: 'compta', label: 'Versement déclaré par un commercial, à confirmer', audiences: ['compta'], priority: 'action', recipient_hint: 'Le commercial est prévenu de la confirmation ou du refus.' },
  'prospect.transfert_demande': { module: 'commercial', label: 'Demande de transfert d’un prospect ou d’un client à valider', audiences: ['commercial_resp'], priority: 'action', recipient_hint: 'Le commercial qui a fait la demande est prévenu de la décision.' },
  'echeance.impayee': { module: 'commercial', label: 'Échéance d’un client impayée', audiences: ['compta'], priority: 'action' },
  'marketing.a_valider': { module: 'marketing', label: 'Contenu préparé par l’IA ou soumis, à valider', audiences: ['marketing'], priority: 'action', requiredPerms: ['marketing:read'], recipient_hint: 'Accès au Marketing & Communication requis.' },
  'marketing.campagne_a_valider': { module: 'marketing', label: 'Campagne soumise à la Direction générale', audiences: ['dg'], priority: 'action', requiredPerms: ['marketing:read'], recipient_hint: 'Accès au Marketing & Communication requis.' },
  'marketing.valide': { module: 'marketing', label: 'Contenu validé (le proposant est prévenu)', audiences: [], requiredPerms: ['marketing:read'] },
  'marketing.refuse': { module: 'marketing', label: 'Contenu refusé avec motif (le proposant est prévenu)', audiences: [], priority: 'action', requiredPerms: ['marketing:read'] },
  'marketing.plafond': { module: 'marketing', label: 'Dépense de l’IA au seuil d’alerte ou plafond mensuel atteint', audiences: ['dg'], priority: 'urgent', requiredPerms: ['marketing:read'], recipient_hint: 'Accès au Marketing & Communication requis.' },
  'marketing.a_publier': { module: 'marketing', label: 'Contenu validé à publier ou à planifier aujourd’hui', audiences: ['marketing'], priority: 'action', requiredPerms: ['marketing:read'] },
  'qhse.note_mauvaise': { module: 'qhse', label: 'Contrôle journalier : note « Mauvais » sur la qualité ou l’hygiène', audiences: ['qhse', 'exploitation'], priority: 'action', requiredPerms: ['qhse:read'], recipient_hint: 'Le conducteur du chantier est toujours prévenu ; accès au QHSE requis.' },
  'qhse.securite_basse': { module: 'qhse', label: 'Contrôle journalier : ouvriers respectant la sécurité sous le seuil réglé', audiences: ['qhse', 'exploitation'], priority: 'urgent', requiredPerms: ['qhse:read'], recipient_hint: 'Le conducteur du chantier est toujours prévenu ; accès au QHSE requis.' },
  'qhse.controle_manquant': { module: 'qhse', label: 'Contrôle du jour manquant sur un chantier actif (à l’heure réglée)', audiences: [], priority: 'action', requiredPerms: ['qhse:read'], recipient_hint: 'Le conducteur du chantier est prévenu ; services en plus à cocher.' },
  'qhse.action_retard': { module: 'qhse', label: 'Action corrective en retard', audiences: ['qhse'], priority: 'action', requiredPerms: ['qhse:read'], recipient_hint: 'Le responsable de l’action et le conducteur du chantier sont toujours prévenus.' },
  'qhse.action_assignee': { module: 'qhse', label: 'Action corrective confiée à une personne (elle est prévenue)', audiences: [], priority: 'action', requiredPerms: ['qhse:read'] },
  'qhse.action_levee': { module: 'qhse', label: 'Action corrective levée avec sa preuve (l’auteur est prévenu)', audiences: [], requiredPerms: ['qhse:read'] },
  'qhse.hebdo_a_valider': { module: 'qhse', label: 'Contrôle hebdomadaire soumis, à valider', audiences: ['qhse'], priority: 'action', requiredPerms: ['qhse:read'], recipient_hint: 'Accès au QHSE requis.' },
  'qhse.audit_planifie': { module: 'qhse', label: 'Inspection ou audit planifié (auditeur et conducteur prévenus)', audiences: [], requiredPerms: ['qhse:read'] },
  'qhse.audit_a_valider': { module: 'qhse', label: 'Audit réalisé, à valider', audiences: ['qhse'], priority: 'action', requiredPerms: ['qhse:read'], recipient_hint: 'Accès au QHSE requis.' },
  'qhse.constat_critique': { module: 'qhse', label: 'Constat critique relevé lors d’un audit', audiences: ['qhse', 'exploitation', 'dg'], priority: 'urgent', requiredPerms: ['qhse:read'], recipient_hint: 'Accès au QHSE requis.' },
  'qhse.decision': { module: 'qhse', label: 'Contrôle hebdomadaire ou audit validé ou refusé (l’auteur est prévenu)', audiences: [], priority: 'action', requiredPerms: ['qhse:read'] },
  'rh.depart': { module: 'rh', label: 'Départ d’un employé (solde de tout compte)', audiences: ['compta'] },
};

/**
 * Paramètres des modules sans page de réglages propre (ERP › module › Réglages) ; les défauts sont les règles en
 * place avant le réglage. `perm` : droits qui modifient le paramètre ; `who` : qui le règle (affiché aux autres).
 */
const MODULE_SETTINGS = {
  marketing: {
    marketing_cap_fcfa: { group: 'Dépenses de l’IA', label: 'Plafond mensuel de dépense de l’IA (FCFA)', hint: 'Au-delà, l’IA ne répond plus (aucune bascule silencieuse) ; 0 bloque l’IA et ne laisse que le mode démonstration', default: 30000, min: 0, max: 20000000, perm: 'marketing:settings', who: 'la Direction générale' },
    marketing_usd_fcfa: { group: 'Dépenses de l’IA', label: 'Taux de conversion dollar → FCFA', hint: 'Anthropic facture en dollars : les dépenses sont converties en FCFA avec ce taux', default: 600, min: 300, max: 1500, perm: 'marketing:settings', who: 'la Direction générale' },
    marketing_alert_pct: { group: 'Dépenses de l’IA', label: 'Alerte à (% du plafond)', hint: 'La Direction générale est prévenue quand la dépense du mois atteint ce pourcentage du plafond', default: 80, min: 10, max: 100, perm: 'marketing:settings', who: 'la Direction générale' },
    marketing_max_output_tokens: { group: 'Dépenses de l’IA', label: 'Longueur maximale d’une réponse de l’IA (jetons)', hint: 'Borne le coût d’une demande ; 4 000 jetons suffisent à une semaine de contenus', default: 4000, min: 500, max: 16000, perm: 'marketing:settings', who: 'la Direction générale' },
    marketing_weekly_prep: { group: 'Préparation hebdomadaire', label: 'L’IA prépare chaque semaine le calendrier et les contenus (1 = oui, 0 = non)', hint: 'Tâche planifiée : une seule préparation par semaine et par campagne validée ; la responsable de la communication relit et valide', default: 1, min: 0, max: 1, perm: 'marketing:settings', who: 'la Direction générale' },
    marketing_prep_weekday: { group: 'Préparation hebdomadaire', label: 'Jour de la préparation (1 = lundi … 7 = dimanche)', hint: 'Le jour choisi, l’IA prépare la semaine suivante ; rattrapée les jours suivants si le serveur était arrêté', default: 5, min: 1, max: 7, perm: 'marketing:settings', who: 'la Direction générale' },
    marketing_posts_per_week: { group: 'Préparation hebdomadaire', label: 'Contenus préparés par semaine et par campagne', hint: 'Nombre de publications du calendrier de la semaine', default: 4, min: 1, max: 14, perm: 'marketing:settings', who: 'la Direction générale' },
  },
  qhse: {
    qhse_safety_threshold_pct: { group: 'Alertes', label: 'Seuil de sécurité (% d’ouvriers respectant les consignes)', hint: 'Sous ce taux, le conducteur, la direction des exploitations et le service QHSE sont prévenus et le chantier remonte dans « À traiter en priorité »', default: 90, min: 50, max: 100, perm: 'qhse:settings', who: 'la Direction générale' },
    qhse_daily_check_hour: { group: 'Alertes', label: 'Heure limite du contrôle du jour (0-23)', hint: 'Un chantier en cours sans contrôle journalier à cette heure (jours ouvrés) prévient son conducteur', default: 17, min: 6, max: 23, perm: 'qhse:settings', who: 'la Direction générale' },
    qhse_work_saturday: { group: 'Alertes', label: 'Le samedi est un jour de contrôle (1 = oui, 0 = non)', hint: 'Par défaut, du lundi au vendredi hors jours fériés (calendrier des Ressources humaines)', default: 0, min: 0, max: 1, perm: 'qhse:settings', who: 'la Direction générale' },
    qhse_due_critique_days: { group: 'Actions correctives : échéance proposée', label: 'Gravité critique (jours)', hint: 'Échéance proposée à l’ouverture d’une action ; modifiable action par action', default: 3, min: 1, max: 90, perm: 'qhse:settings', who: 'la Direction générale' },
    qhse_due_majeure_days: { group: 'Actions correctives : échéance proposée', label: 'Gravité majeure (jours)', hint: 'Échéance proposée à l’ouverture d’une action ; modifiable action par action', default: 15, min: 1, max: 180, perm: 'qhse:settings', who: 'la Direction générale' },
    qhse_due_mineure_days: { group: 'Actions correctives : échéance proposée', label: 'Gravité mineure (jours)', hint: 'Échéance proposée à l’ouverture d’une action ; modifiable action par action', default: 30, min: 1, max: 365, perm: 'qhse:settings', who: 'la Direction générale' },
  },
  commercial: {
    vefa_due_days: { group: 'Appels de fonds VEFA', label: 'Délai de paiement d’un appel de fonds (jours)', hint: 'Délai laissé à l’acquéreur pour régler un appel de fonds, pour les programmes sans plan VEFA propre (un plan de programme garde son délai)', default: 15, min: 1, max: 90, perm: 'vefa:write', who: 'le responsable des appels de fonds' },
    commercial_stale_days: { group: 'Suivi des programmes', label: 'Programme à relancer sans point de chantier publié depuis (jours)', hint: 'Signalé « À relancer » dans la Vue Direction quand des dossiers de vente attendent des nouvelles du chantier', default: 60, min: 7, max: 365, perm: 'targets:write', who: 'la direction commerciale' },
  },
  sav: {
    sav_hours_urgente: { group: 'Délais de traitement des réclamations', label: 'Priorité urgente (heures)', hint: 'Échéance de traitement calculée à l’ouverture de la réclamation', default: 24, min: 1, max: 720, perm: 'sav:assign', who: 'le responsable du SAV' },
    sav_hours_haute: { group: 'Délais de traitement des réclamations', label: 'Priorité haute (heures)', hint: 'Échéance de traitement calculée à l’ouverture de la réclamation', default: 48, min: 1, max: 720, perm: 'sav:assign', who: 'le responsable du SAV' },
    sav_hours_normale: { group: 'Délais de traitement des réclamations', label: 'Priorité normale (heures)', hint: 'Échéance de traitement calculée à l’ouverture de la réclamation', default: 120, min: 1, max: 1440, perm: 'sav:assign', who: 'le responsable du SAV' },
    sav_hours_basse: { group: 'Délais de traitement des réclamations', label: 'Priorité basse (heures)', hint: 'Échéance de traitement calculée à l’ouverture de la réclamation', default: 240, min: 1, max: 2160, perm: 'sav:assign', who: 'le responsable du SAV' },
  },
  administration: {
    admin_alert_first_days: { group: 'Rappels d’échéances (contrats et parc)', label: 'Premier rappel (jours avant l’échéance)', hint: 'Fin de contrat, préavis, révision, pièce à renouveler, assurance, visite technique, entretien daté', default: 30, min: 2, max: 120, perm: ['contrats:write', 'contrats:close', 'contrats:documents', 'parc:write', 'parc:maintenance', 'parc:costs', 'parc:reservations'], who: 'les services généraux' },
    admin_alert_second_days: { group: 'Rappels d’échéances (contrats et parc)', label: 'Second rappel (jours avant l’échéance)', hint: 'Doit rester inférieur au premier rappel', default: 7, min: 1, max: 60, perm: ['contrats:write', 'parc:write'], who: 'les services généraux' },
    contract_invoice_lead_days: { group: 'Contrats', label: 'Facture d’achat préparée (jours avant chaque paiement)', hint: 'Brouillon créé dans Comptabilité › Achats pour chaque échéance de paiement d’un contrat', default: 7, min: 0, max: 60, perm: ['contrats:write', 'contrats:close', 'contrats:documents'], who: 'les services généraux' },
    parc_soon_days: { group: 'Parc : entretien « bientôt »', label: 'Entretien signalé bientôt dû à (jours)', hint: 'Entretien daté affiché « bientôt » dans la fiche du bien', default: 7, min: 1, max: 60, perm: ['parc:write', 'parc:maintenance'], who: 'le gestionnaire du parc' },
    parc_soon_km: { group: 'Parc : entretien « bientôt »', label: 'Véhicules : entretien bientôt dû à (km)', hint: 'Kilomètres restants avant l’entretien suivant', default: 500, min: 50, max: 10000, perm: ['parc:write', 'parc:maintenance'], who: 'le gestionnaire du parc' },
    parc_soon_h: { group: 'Parc : entretien « bientôt »', label: 'Engins : entretien bientôt dû à (heures moteur)', hint: 'Heures restantes avant l’entretien suivant', default: 20, min: 1, max: 500, perm: ['parc:write', 'parc:maintenance'], who: 'le gestionnaire du parc' },
  },
};

// Sons de notification proposés (cloche du dashboard et de l'ERP), choisis par chaque compte ; synthétisés par le
// navigateur, donc libres de droits et sans fichier à télécharger
const NOTIF_SOUNDS = {
  carillon: 'Carillon (deux notes)', clochette: 'Clochette', cristal: 'Cristal (trois notes montantes)', goutte: 'Goutte d’eau',
  marimba: 'Marimba', double_bip: 'Double bip', aucun: 'Aucun son',
};

// Situations de travaux des sous-traitants (lot 4)
const SITUATION_STATUSES = { brouillon: 'Brouillon', verifiee: 'Vérifiée, à valider', validee: 'Validée', refusee: 'Refusée' };

/**
 * Montants d'une situation : travaux cumulés (pourcentage du marché, ou montant saisi), travaux de la période
 * (cumul − cumul des situations validées), TVA du marché, retenue de garantie sur le TTC (ou le HT, selon le réglage)
 * de la période, net à payer.
 * Renvoie { error } si le cumul recule, dépasse le marché ou n'ajoute rien.
 */
function situationAmounts({ contractAmount = null, cumulativePct = null, cumulativeAmount = null, previousAmount = 0, vatRate = 0, retentionPct = 0, retentionBase = 'ttc' }) {
  let cumul = cumulativeAmount;
  if (cumulativePct != null) {
    if (!contractAmount) return { error: 'Le marché n’a pas de montant : indiquez le montant cumulé des travaux.' };
    if (cumulativePct < 0 || cumulativePct > 100) return { error: 'L’avancement cumulé est compris entre 0 et 100 %.' };
    cumul = Math.round((contractAmount * cumulativePct) / 100);
  }
  if (cumul == null) return { error: 'Indiquez l’avancement cumulé (%) ou le montant cumulé des travaux.' };
  if (contractAmount && cumul > contractAmount) return { error: 'Le cumul des travaux dépasse le montant du marché (avenant à passer d’abord).' };
  const ht = cumul - (previousAmount || 0);
  if (ht <= 0) return { error: 'Cette situation n’ajoute aucun travaux par rapport aux situations déjà validées.' };
  const vat = Math.round((ht * (Number(vatRate) || 0)) / 100);
  const ttc = ht + vat;
  const retention = Math.round(((retentionBase === 'ht' ? ht : ttc) * (Number(retentionPct) || 0)) / 100);
  return { cumulative_amount: cumul, amount_ht: ht, vat_amount: vat, amount_ttc: ttc, retention_amount: retention, net_payable: ttc - retention };
}

/** Niveau d'alerte du budget : null, 'seuil' (pct atteint) ou 'depasse' (au-delà de 100 %). Sans budget, aucune alerte. */
function budgetAlertLevel(spent, budget, pct) {
  if (!budget || budget <= 0) return null;
  if (spent > budget) return 'depasse';
  return spent * 100 >= budget * pct ? 'seuil' : null;
}

/**
 * Refus d'une phase : fin avant début (prévu ou réel), fin réelle sans début réel, phase précédente d'un autre
 * chantier ou qui ferait une boucle. `phases` : les autres phases du chantier (id, depends_on_id).
 */
function phaseRefusal(p, phases = []) {
  if (p.planned_start && p.planned_end && p.planned_end < p.planned_start) return 'La fin prévue précède le début prévu.';
  if (p.actual_end && !p.actual_start) return 'Indiquez le début réel avant la fin réelle.';
  if (p.actual_start && p.actual_end && p.actual_end < p.actual_start) return 'La fin réelle précède le début réel.';
  if (p.depends_on_id) {
    const byId = new Map(phases.map(x => [Number(x.id), x]));
    if (!byId.has(Number(p.depends_on_id))) return 'La phase précédente doit appartenir au même chantier.';
    let cur = Number(p.depends_on_id);
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      if (p.id && cur === Number(p.id)) return 'Cet enchaînement de phases fait une boucle.';
      seen.add(cur);
      cur = Number(byId.get(cur)?.depends_on_id) || null;
    }
  }
  return null;
}

// Achats & stocks : quantités conservées au centième, montants en FCFA entiers.
const APPRO_ORDER_STATUSES = { brouillon: 'Brouillon', a_valider: 'À valider', attente_direction: 'À valider par la Direction', confirmee: 'Confirmée', partielle: 'Partiellement reçue', recue: 'Reçue', refusee: 'Refusée', annulee: 'Annulée' };
const APPRO_QUOTE_STATUSES = { brouillon: 'Demande de prix', recue: 'Devis reçu', annulee: 'Annulée' };
const APPRO_MOVE_KINDS = { entree: 'Entrée', sortie: 'Sortie / consommation', transfert: 'Transfert', reception: 'Réception fournisseur' };
function stockQuantityUnits(value) {
  const n = Number(value), units = Math.round(n * 100);
  return Number.isFinite(n) && n >= 0 && n <= 10000000 && Math.abs(n * 100 - units) < 0.000001 ? units : null;
}
function approAmounts(lines, vatRate = 0) {
  if (!lines?.length) return { error: 'Ajoutez au moins un article.' };
  let ht = 0;
  for (const line of lines) {
    const units = stockQuantityUnits(line.quantity), price = Number(line.unit_price_fcfa);
    if (!units || !Number.isInteger(price) || price < 0 || price > 1000000000) return { error: 'Quantité positive au centième et prix unitaire HT entier attendus.' };
    ht += Number((BigInt(units) * BigInt(price) + 50n) / 100n);
  }
  if (!Number.isSafeInteger(ht) || ht > 1000000000000 || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) return { error: 'Montant ou taux de TVA invalide.' };
  const vat = Math.round(ht * vatRate / 100);
  return { amount_ht: ht, vat_amount: vat, amount_ttc: ht + vat };
}
const approRequiresDirection = (amount, threshold) => Number(amount) >= Number(threshold);
/*
 * Circuit du bon de commande (demandes du client du 25/10) : l'émetteur (choisi parmi les comptes qui préparent les
 * achats, le compte connecté par défaut) désigne le validateur. Ni l'émetteur ni la personne qui a saisi le bon ne
 * valident ou ne refusent la commande — sauf le super administrateur (directeur général, sans supérieur), autorisé à
 * valider ses propres commandes, par exemple un besoin personnel transmis ensuite à la Comptabilité (choix du client du 25/10).
 * Sous le plafond, tout compte ayant le droit de valider (ou la Direction) ; à partir du plafond, un compte de la
 * Direction. La Direction peut se substituer au validateur désigné.
 */
const APPRO_PENDING_STATUSES = ['a_valider', 'attente_direction'];
const approParties = order => [order.issuer_id, order.created_by].filter(Boolean).map(Number);
/** `approver` : { id, active, super_admin, validate, direction } (droits effectifs) ; `parties` : émetteur et auteur de la saisie. */
function approApproverRefusal(approver, parties, amount, threshold) {
  if (!approver) return 'Choisissez le validateur de la commande.';
  if (!approver.super_admin && [].concat(parties).map(Number).includes(Number(approver.id))) return 'L’émetteur ne peut pas valider sa propre commande : désignez une autre personne.';
  if (!approver.active) return 'Le validateur choisi n’a plus de compte actif.';
  if (approRequiresDirection(amount, threshold) && !approver.direction) return `À partir de ${Number(threshold).toLocaleString('fr-FR')} FCFA TTC, la commande est validée par la Direction : choisissez un validateur qui en a le droit.`;
  if (!approver.validate && !approver.direction) return 'Le validateur choisi n’a pas le droit de valider les commandes.';
  return null;
}
/** Qui peut valider ou refuser une commande soumise : le validateur désigné, ou la Direction qui se substitue. */
function approDeciderRefusal(order, { userId, superAdmin = false, canValidate, canDirection }) {
  if (!APPRO_PENDING_STATUSES.includes(order.status)) return 'Cette commande n’est pas en attente de validation.';
  if (!superAdmin && approParties(order).includes(Number(userId))) return 'L’émetteur ne peut ni valider ni refuser sa propre commande.';
  if (order.status === 'attente_direction') return canDirection ? null : 'Cette commande attend la validation de la Direction.';
  if (canDirection) return null;
  if (order.approver_id && Number(order.approver_id) !== Number(userId)) return 'Cette commande attend la décision du validateur désigné (ou de la Direction).';
  return canValidate ? null : 'Validation des commandes non autorisée.';
}
const stockPostingDateRefusal = (date, currentDay) => date > currentDay ? 'Une réception ou un mouvement de stock physique ne peut pas être validé à une date future.' : null;
/** Une sortie antidatée doit aussi laisser positifs les soldes historiques déjà enregistrés. */
function stockHistoryAllows(entries, postingDate, delta) {
  let balance = 0, inserted = false;
  for (const e of entries) {
    if (!inserted && e.date > postingDate) { balance += delta; inserted = true; if (balance < 0) return false; }
    balance += e.delta;
    if (inserted && balance < 0) return false;
  }
  return inserted || balance + delta >= 0;
}
/** Arrondi cumulatif : plusieurs réceptions gardent exactement le HT/TVA/TTC du bon de commande. */
function approReceiptAmounts(previous, incoming, vatRate) {
  const total = after => {
    const input = previous.map(l => ({ quantity: (Number(l.received_units) + (after ? Number(incoming.find(x => x.order_line_id === l.id)?.quantity_units || 0) : 0)) / 100, unit_price_fcfa: Number(l.unit_price_fcfa) })).filter(l => l.quantity > 0);
    return input.length ? approAmounts(input, vatRate) : { amount_ht: 0, vat_amount: 0, amount_ttc: 0 };
  };
  const before = total(false), after = total(true);
  return Object.fromEntries(['amount_ht', 'vat_amount', 'amount_ttc'].map(k => [k, after[k] - before[k]]));
}

module.exports = {
  APPRO_ACTIONS, APPRO_ORDER_STATUSES, APPRO_PENDING_STATUSES, APPRO_QUOTE_STATUSES, APPRO_MOVE_KINDS, stockQuantityUnits, approAmounts, approRequiresDirection, approApproverRefusal, approDeciderRefusal, approParties, stockHistoryAllows, approReceiptAmounts, stockPostingDateRefusal,
  CHANTIER_ACTIONS, WORKSITE_STATUSES, WORKSITE_OPEN, WORKSITE_ZONES, TASK_STATUSES, PHASE_STATES, lotInZone, phaseState, worksiteProgress, phaseRefusal,
  CHANTIER_SETTINGS, budgetAlertLevel, PLACE_KINDS, DECLARATION_STATUSES, deliveryForecast, deliveryDelay, SITUATION_STATUSES, situationAmounts,
  INFO_AUDIENCES, INFO_EVENTS, NOTIF_SOUNDS, MARKETING_ACTIONS, QHSE_ACTIONS,
  DEED_STEPS, DEED_STEP_KEYS, deedProgress, deedStepRefusal, LITIGATION_ORIGINS, LITIGATION_STAGES, LITIGATION_OUTCOMES, litigationReminder,
  GUARANTEE_DIRECTIONS, DEFAULT_GUARANTEE_KINDS, GUARANTEE_STATUSES, guaranteeDeadline, LEGAL_SETTINGS, unpaidAge, LEGAL_ACTIONS,
  DOC_KINDS, DOC_AUDIENCES, DOC_STATUSES, DOC_ACTION_STATUSES, docReference, readReminder,
  REQUEST_KINDS, REQUEST_SERVICES, REQUEST_STATUSES, REQUEST_OPEN, REQUEST_DG_THRESHOLD, requestNeedsDg, requestNextStep, DOCS_ACTIONS, REQUEST_ACTIONS,
  ASSET_KINDS, ASSET_STATUSES, ASSET_ASSIGNMENT_KINDS, ASSET_DOC_KINDS, ASSET_COST_KINDS, RESERVATION_STATUSES, MAINTENANCE_SOON, PARC_ACTIONS,
  assetCode, maintenanceDue, fuelConsumption, reservationsOverlap,
  ASSET_PAYMENT_MODES, COST_ACCOUNTING_STATUSES, costAccountingStatus, depreciationAt, depreciationFor, addDays,
  MAIL_DIRECTIONS, MAIL_SUITES, MAIL_NATURES, MAIL_CHANNELS, MAIL_STATUSES, mailNumber, mailVisibility, mailReminder,
  MODULE_SETTINGS, TMA_STATUSES, TMA_BILLED, NEED_STATUSES, CONTRACT_KINDS, CONTRACT_FREQUENCIES, CONTRACT_STATUSES, CONTRACT_DOC_KINDS, CONTRACT_ALERT_STAGES, CONTRACT_INVOICE_LEAD_DAYS, CONTRACT_ACTIONS,
  contractDeadlines, contractAlertStage, renewedEnd, contractPaymentsDue, daysBetween,
  PORTFOLIO_EVENTS, PORTFOLIO_REASONS, portfolioState, replayPortfolio, portfolioDiff, portfolioCounts, conversionRate,
  SELF_SERVICE, SAV_ACTIONS, PRESENCE_ACTIONS, RH_SETTINGS_ACTIONS, RECRUIT_ACTIONS, KPI_ACTIONS, FORMATION_ACTIONS, COURRIER_ACTIONS, COMPTA_ACTIONS, PAIE_ACTIONS, RH_ACTIONS,
  LOT_STATUSES, LOT_STATUS_LABELS, SELLABLE_STATUSES, LOT_TRANSITIONS,
  LEAD_STAGES, CLIENT_STAGES, PUBLIC_LEAD_SOURCES, leadAlert, ROLES, ROLE_LABELS, PERMISSIONS, roleKey, can, checkLotTransition,
  SALE_STATUSES, PAYMENT_METHODS, DOCUMENT_STATUSES, DOCUMENT_TYPES, DEFAULT_DOCUMENTS,
  PERMISSION_CATALOG, PERMISSION_IDS, PERMISSION_SPLITS, splitPermissions,
  FINANCING_PLANS, FINANCINGS, saleTerms, financingLabel, SCHEDULE_KINDS, INSTALLMENT_STATUS_LABELS, SITE_STAGES, SITE_STAGE_LABELS,
  LOTISSEMENT_STAGES, LOTISSEMENT_STAGE_LABELS, ALL_SITE_STAGES, siteStagesFor, siteStageLabel, siteStageIndex, siteStageError,
  MESSAGE_SENDERS, CLIENT_PASSWORD_MIN, CLIENT_RESET_HOURS, CLIENT_VISIBLE_SALE_STATUSES,
  addMonths, buildSchedule, allocatePayments, phoneKey, looksLikeClientCode, PROTECTED_ROLES, DELETABLE_LOT_STATUSES, NEW_LOT_STATUSES, PROJECT_CATEGORIES,
  REF_KINDS, FEATURE_KINDS, SITE_FIGURE_ICONS, siteFigures, VIABILISATION_STATES, APP_SETTINGS, THEMES, categoryForProjectType, monthChoices, paymentTerms, monthlyFor,
  offerSurface, gridOfferFor, GRID_PRICED_STATUSES,
  SAV_CATEGORIES, SAV_PRIORITIES, SAV_STATUSES, SAV_STATUS_LABELS, SAV_OPEN_STATUSES, SAV_TRANSITIONS, SAV_SOURCES,
  WARRANTIES, warrantyFor, warrantyDates, SAV_LAND_CATEGORIES, SAV_RESERVE_STATUSES, SAV_INTERVENTION_STATUSES,
  STAGE_PROBABILITY, PIPELINE_STAGES, BOARD_STAGES, WON_STAGES, LOST_REASONS, ACTIVITY_KINDS, LEAD_KINDS, isLandType, BUILDING_KINDS,
  TARGET_METRICS, VEFA_LEGAL_CAPS, DEFAULT_VEFA_PLAN, VEFA_DUE_DAYS, checkVefaPlan, splitVefaAmounts, milestoneReached, activityState,
};
