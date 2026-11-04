/** Libellés métier (reflet de client/src/lib/domain.js et server/src/lib/domain.js). */
import type { Tone } from '@/theme';

export const INSTALLMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  payee: { label: 'Payée', tone: 'ok' },
  partielle: { label: 'Partielle', tone: 'gold' },
  en_retard: { label: 'En retard', tone: 'danger' },
  a_venir: { label: 'À venir', tone: 'muted' },
};

export const DOCUMENT_STATUS: Record<string, { label: string; tone: Tone; step: number; hint: string }> = {
  a_fournir: { label: 'En attente', tone: 'muted', step: 0, hint: 'Ce document sera préparé à l’étape prévue.' },
  en_cours: { label: 'En cours', tone: 'gold', step: 1, hint: 'Ce document est en cours de préparation.' },
  signe: { label: 'Signé', tone: 'ok', step: 2, hint: 'Ce document est signé.' },
  delivre: { label: 'Délivré', tone: 'ok', step: 2, hint: 'Ce document vous a été délivré.' },
};

export const SAV_STATUS: Record<string, { label: string; tone: Tone; step: number; hint: string }> = {
  nouveau: { label: 'Reçue', tone: 'muted', step: 0, hint: 'Votre demande est bien arrivée. L’équipe SAV va l’étudier.' },
  qualifie: { label: 'Prise en charge', tone: 'gold', step: 1, hint: 'Un responsable étudie la solution et revient vers vous.' },
  planifie: { label: 'Intervention prévue', tone: 'gold', step: 1, hint: 'Une intervention est programmée chez vous.' },
  en_cours: { label: 'En cours', tone: 'gold', step: 1, hint: 'Les travaux de reprise sont en cours.' },
  resolu: { label: 'Résolue', tone: 'ok', step: 2, hint: 'Le problème est réglé. Donnez-nous votre avis, ou répondez si ce n’est pas le cas.' },
  clos: { label: 'Terminée', tone: 'ok', step: 2, hint: 'Demande close. Merci de votre confiance.' },
  rejete: { label: 'Non retenue', tone: 'muted', step: 2, hint: 'Cette demande n’entre pas dans le service après-vente. Consultez le fil pour en savoir plus.' },
};
export const savStatus = (s?: string) => SAV_STATUS[s || ''] || SAV_STATUS.nouveau;

export const PAYMENT_METHODS: Record<string, string> = {
  virement: 'Virement bancaire', mobile_money: 'Mobile Money', especes: 'Espèces', cheque: 'Chèque', autre: 'Autre',
};

export const SCOPE_LABELS: Record<string, string> = { projet: 'Tout le projet', ilot: 'Votre îlot', lot: 'Votre lot' };

export const TMA_TONES: Record<string, Tone> = { demandee: 'muted', chiffree: 'gold', acceptee: 'ok', refusee: 'danger', realisee: 'ok' };

/** Couleurs des statuts de lot (palette validée daltonisme, identique au site et au dashboard). */
export const LOT_COLORS: Record<string, string> = {
  disponible: '#2E9E5B', option: '#A16207', reserve: '#6D28D9', vendu: '#9F1239', desistement: '#0B6BA8', bloque: '#8A8F98',
};

export const FINANCING_LABELS: Record<string, string> = {
  apport: 'Apport + mensualités', diaspora: 'Formule Diaspora', credit: 'Crédit bancaire', comptant: 'Paiement comptant',
};

export const APPOINTMENT_KINDS: Record<string, string> = {
  visite: 'Visite sur site', appel: 'Être rappelé', bureau: 'Rendez-vous au bureau', visio: 'Rendez-vous en visio',
};

export const isLotissement = (p?: { category?: string | null }) => p?.category === 'lotissement';
export const projectKind = (p: { project_type?: string | null; category?: string | null }) =>
  p.project_type || (isLotissement(p) ? 'Lotissement' : 'Promotion immobilière');
