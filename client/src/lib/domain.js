/** Libellés côté client — reflet de server/src/lib/domain.js (même ordre des étapes). */

export const SITE_STAGES = [
  ['etudes', 'Études et autorisations', 'Études'],
  ['terrassement', 'Terrassement', 'Terrassement'],
  ['vrd', 'Voirie et réseaux (VRD)', 'VRD'],
  ['fondations', 'Fondations', 'Fondations'],
  ['gros_oeuvre', 'Gros œuvre', 'Gros œuvre'],
  ['toiture', 'Toiture', 'Toiture'],
  ['second_oeuvre', 'Second œuvre', 'Second œuvre'],
  ['finitions', 'Finitions', 'Finitions'],
  ['livraison', 'Livraison', 'Livraison'],
].map(([id, label, short]) => ({ id, label, short }));

export const stageIndex = id => SITE_STAGES.findIndex(s => s.id === id);

export const INSTALLMENT_STATUS = {
  payee: { label: 'Payée', tone: 'ok' },
  partielle: { label: 'Partielle', tone: 'gold' },
  en_retard: { label: 'En retard', tone: 'danger' },
  a_venir: { label: 'À venir', tone: 'muted' },
};

export const DOCUMENT_STATUS = {
  a_fournir: { label: 'En attente', tone: 'muted', step: 0, hint: 'Ce document sera préparé à l’étape prévue.' },
  en_cours: { label: 'En cours', tone: 'gold', step: 1, hint: 'Ce document est en cours de préparation.' },
  signe: { label: 'Signé', tone: 'ok', step: 2, hint: 'Ce document est signé.' },
  delivre: { label: 'Délivré', tone: 'ok', step: 2, hint: 'Ce document vous a été délivré.' },
};

// Service après-vente : statuts vus par le client (step : avancement sur 3 étapes)
export const SAV_STATUS = {
  nouveau: { label: 'Reçue', tone: 'muted', step: 0, hint: 'Votre demande est bien arrivée. L’équipe SAV va l’étudier.' },
  qualifie: { label: 'Prise en charge', tone: 'gold', step: 1, hint: 'Un responsable étudie la solution et revient vers vous.' },
  planifie: { label: 'Intervention prévue', tone: 'gold', step: 1, hint: 'Une intervention est programmée chez vous.' },
  en_cours: { label: 'En cours', tone: 'gold', step: 1, hint: 'Les travaux de reprise sont en cours.' },
  resolu: { label: 'Résolue', tone: 'ok', step: 2, hint: 'Le problème est réglé. Donnez-nous votre avis, ou répondez si ce n’est pas le cas.' },
  clos: { label: 'Terminée', tone: 'ok', step: 2, hint: 'Demande close. Merci de votre confiance.' },
  rejete: { label: 'Non retenue', tone: 'muted', step: 2, hint: 'Cette demande n’entre pas dans le service après-vente. Consultez le fil pour en savoir plus.' },
};

export const PAYMENT_METHODS = {
  virement: 'Virement bancaire',
  mobile_money: 'Mobile Money',
  especes: 'Espèces',
  cheque: 'Chèque',
  autre: 'Autre',
};

export const SCOPE_LABELS = { projet: 'Tout le projet', ilot: 'Votre îlot', lot: 'Votre lot' };

export const CONTACT = {
  phone: '+225 01 02 27 95 95',
  phoneHref: 'tel:+2250102279595',
  office: '+225 27 22 20 50 20',
  officeHref: 'tel:+2252722205020',
  whatsapp: 'https://wa.me/2250102279595',
  email: 'info@siipaf.com',
};

export const PASSWORD_MIN = 10;

/** Photo du projet : celle de la médiathèque, sinon l'image du site livrée avec l'application. */
export const projectImage = project =>
  project?.cover_url || (project?.slug ? `${import.meta.env.BASE_URL}projets/${project.slug}.jpg` : `${import.meta.env.BASE_URL}connexion.jpg`);
