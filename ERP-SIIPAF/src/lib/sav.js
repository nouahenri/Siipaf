/** Repères visuels du module Client & SAV (les libellés viennent de l'API : /admin/erp/sav/meta). */

// Couleurs des statuts : palette validée (daltonisme) du dashboard, gris pour les dossiers terminés
export const STATUS_COLORS = {
  nouveau: '#2a78d6',
  qualifie: '#6d28d9',
  planifie: '#eda100',
  en_cours: '#eb6834',
  resolu: '#1baf7a',
  clos: '#8a8f98',
  rejete: '#5b6170',
};

export const PRIORITY_TONES = { basse: '', normale: '', haute: 'warn', urgente: 'danger' };

export const SOURCE_LABELS = { client: 'Espace client', equipe: 'Saisie équipe', livraison: 'Réserve de livraison' };

export const WARRANTY_SHORT = {
  parfait_achevement: 'Parfait achèvement',
  biennale: 'Biennale',
  decennale: 'Décennale',
  hors_garantie: 'Hors garantie',
};

export const INTERVENTION_LABELS = { planifiee: 'Planifiée', realisee: 'Réalisée', annulee: 'Annulée' };

export const isImage = f => (f.mime || '').startsWith('image/');
