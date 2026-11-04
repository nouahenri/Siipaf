/** Mise en forme (reflet de client/src/lib/format.js) : montants FCFA, dates en français, pluriels. */
const intl = new Intl.NumberFormat('fr-FR');
// Espace insécable ordinaire : l'espace fine (U+202F) n'est pas rendue par toutes les polices
const nf = (v: number) => intl.format(v).replace(/ /g, ' ');

export const fcfa = (n?: number | string | null) => (n == null || n === '' ? '—' : `${nf(Math.round(Number(n)))} FCFA`);
export const amount = (n?: number | string | null) => (n == null || n === '' ? '—' : nf(Math.round(Number(n))));
export const eur = (n?: number | string | null) => (n == null ? '—' : `${nf(Math.round(Number(n) / 655.957))} €`);
export const compact = (n?: number | string | null) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`;
  return nf(v);
};

// Les dates « AAAA-MM-JJ » sont lues comme des jours civils (pas de décalage de fuseau)
export const toDate = (v?: string | Date | null) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const date = (v?: string | Date | null) => { const d = toDate(v); return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'; };
export const shortDate = (v?: string | Date | null) => { const d = toDate(v); return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
export const monthYear = (v?: string | Date | null) => { const d = toDate(v); return d ? d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '—'; };
export const time = (v?: string | Date | null) => { const d = toDate(v); return d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''; };

/** « Aujourd’hui », « Hier », « 12 octobre » — fils de messages et de chantier. */
export const dayLabel = (v?: string | Date | null) => {
  const d = toDate(v);
  if (!d) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};

/** Nombre de jours avant (positif) ou depuis (négatif) une date. */
export const daysUntil = (v?: string | Date | null) => {
  const d = toDate(v);
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - today.getTime()) / 86400000);
};

export const firstName = (name?: string | null) => (name || '').trim().split(/\s+/)[0] || '';
export const initials = (name?: string | null) => (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
export const digits = (s?: string | null) => String(s || '').replace(/\D/g, '');
export const greeting = () => { const h = new Date().getHours(); return h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour'; };

/** Prix de la vitrine dans la devise choisie (Paramètres) : FCFA, ou euro à la parité fixe 1 € = 655,957 FCFA. */
export const money = (n?: number | string | null, currency: 'FCFA' | 'EUR' = 'FCFA') => (currency === 'EUR' ? eur(n) : fcfa(n));
