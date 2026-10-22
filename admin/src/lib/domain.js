/** Libellés et couleurs partagés (alignés sur server/src/lib/domain.js). */
export const LOT_STATUSES = [
  { id: 'disponible', label: 'Disponible', color: 'var(--st-disponible)' },
  { id: 'desistement', label: 'Désistement', color: 'var(--st-desistement)' },
  { id: 'option', label: 'Option', color: 'var(--st-option)' },
  { id: 'reserve', label: 'Réservé', color: 'var(--st-reserve)' },
  { id: 'vendu', label: 'Vendu', color: 'var(--st-vendu)' },
  { id: 'bloque', label: 'Non commercialisé', color: 'var(--st-bloque)' },
];
export const lotStatus = id => LOT_STATUSES.find(s => s.id === id) || { id, label: id, color: 'var(--ink-3)' };

/**
 * Désignation d'un bien selon le type de biens du projet (liste de Paramètres, saisie libre) :
 * on reconnaît le mot-clé dans le libellé (« Villa basse haut standing » → villa).
 * Renvoie le nom (« villa ») et le libellé du bouton de création (« Nouvelle villa »).
 */
const BIEN_WORDS = [
  [/appartement|penthouse|studio|loft|\bf\d\b|\bt\d\b/, 'appartement', 'Nouvel appartement'],
  [/villa|duplex|triplex/, 'villa', 'Nouvelle villa'],
  [/maison/, 'maison', 'Nouvelle maison'],
  [/immeuble|r\+\d/, 'immeuble', 'Nouvel immeuble'],
  [/bureau/, 'bureau', 'Nouveau bureau'],
  [/magasin|boutique|commerce|local/, 'local', 'Nouveau local'],
  [/terrain|parcelle|lot\b/, 'lot', 'Nouveau lot'],
];
export function bienKind(propertyType) {
  const t = String(propertyType || '').toLocaleLowerCase('fr');
  const hit = t && BIEN_WORDS.find(([re]) => re.test(t));
  if (hit) return { noun: hit[1], create: hit[2] };
  return propertyType ? { noun: 'bien', create: 'Nouveau bien' } : { noun: 'lot', create: 'Nouveau lot' };
}

/**
 * Grille de prix : le prix dépend de la surface exacte du bien (même règle que le serveur,
 * server/src/lib/domain.js › gridOfferFor). Surface de la grille : « 400 », « 400 m² » ; pour une villa
 * « T.125 m² | H.85 m² », la surface du terrain (premier nombre).
 */
export function offerSurface(text) {
  const m = String(text || '').replace(/(\d)\s(?=\d{3}\b)/g, '$1').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
export function gridOfferFor(offers, surface, offerId = null) {
  const s = Number(String(surface ?? '').replace(',', '.'));
  if (!surface || !Number.isFinite(s)) return null;
  const current = offerId && offers.find(o => String(o.id) === String(offerId));
  const sameKind = o => !current || o.label.trim().toLocaleLowerCase('fr') === current.label.trim().toLocaleLowerCase('fr');
  return offers.find(o => {
    const m2 = offerSurface(o.surface);
    return o.price_fcfa != null && m2 != null && sameKind(o) && Math.abs(s - m2) < 0.5;
  }) || null;
}

// Transitions autorisées (le serveur reste l'arbitre final)
export const LOT_TRANSITIONS = {
  disponible: ['option', 'reserve', 'bloque'],
  option: ['disponible', 'reserve'],
  reserve: ['vendu', 'desistement', 'disponible'],
  vendu: ['desistement'],
  desistement: ['option', 'reserve', 'disponible'],
  bloque: ['disponible'],
};

export const LEAD_STAGES = [
  { id: 'prospection', label: 'Prospection' },
  { id: 'visite', label: 'Visite' },
  { id: 'decision', label: 'Décision' },
  { id: 'choix_bien', label: 'Choix du bien' },
  { id: 'paiement', label: 'Paiement' },
  { id: 'contrat', label: 'Contrat' },
  { id: 'notaire', label: 'Notaire' },
  { id: 'livraison', label: 'Livraison' },
  { id: 'sav', label: 'SAV' },
  { id: 'perdu', label: 'Perdu' },
];
export const stageLabel = id => LEAD_STAGES.find(s => s.id === id)?.label || id;
// À partir du paiement, la personne est un client (code client attribué d'office par le serveur)
export const CLIENT_STAGES = ['paiement', 'contrat', 'notaire', 'livraison', 'sav'];
export const PROSPECT_STAGES = LEAD_STAGES.filter(s => !CLIENT_STAGES.includes(s.id));

export const PROJECT_CATEGORIES = {
  social: 'Logement social',
  social_haut_standing: 'Logement social & haut standing',
  haut_standing: 'Haut standing',
  lotissement: 'Lotissement (terrains)',
};
export const FINANCING = { apport: 'Avec apport (30 %)', diaspora: 'Diaspora (0 % apport)', credit: 'Crédit bancaire', comptant: 'Comptant' };
export const SOURCES = { site: 'Site web', plan: 'Plan de masse', ia: 'Assistant IA', whatsapp: 'WhatsApp', admin: 'Saisie interne', import: 'Import' };
export const APPT_KINDS = { visite: 'Visite sur site', appel: 'Appel', bureau: 'RDV au bureau', visio: 'Visio' };
export const APPT_STATUS = {
  demande: { label: 'Demandé', tone: 'warn' },
  confirme: { label: 'Confirmé', tone: 'ok' },
  effectue: { label: 'Effectué', tone: '' },
  annule: { label: 'Annulé', tone: 'danger' },
  absent: { label: 'Absent', tone: 'danger' },
};
export const ROLE_LABELS = {
  super_admin: 'Super administrateur',
  commercial: 'Commercial',
  editeur: 'Éditeur de contenu',
  conducteur_travaux: 'Conducteur de travaux / Juridique',
  comptable: 'Comptable',
  resp_exploitation: 'Responsable des exploitations',
};

// Espace client (alignés sur server/src/lib/domain.js)
export const SITE_STAGES = [
  { id: 'etudes', label: 'Études et autorisations' },
  { id: 'terrassement', label: 'Terrassement' },
  { id: 'vrd', label: 'Voirie et réseaux (VRD)' },
  { id: 'fondations', label: 'Fondations' },
  { id: 'gros_oeuvre', label: 'Gros œuvre' },
  { id: 'toiture', label: 'Toiture' },
  { id: 'second_oeuvre', label: 'Second œuvre' },
  { id: 'finitions', label: 'Finitions' },
  { id: 'livraison', label: 'Livraison' },
];
export const INSTALLMENT_STATUS = {
  payee: { label: 'Payée', tone: 'ok' },
  partielle: { label: 'Partielle', tone: 'warn' },
  en_retard: { label: 'En retard', tone: 'danger' },
  a_venir: { label: 'À venir', tone: '' },
};
