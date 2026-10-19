const intl = new Intl.NumberFormat('fr-FR');
// Espace insécable ordinaire : l'espace fine (U+202F) n'est pas rendue par toutes les polices
const nf = { format: v => intl.format(v).replace(/\u202f/g, '\u00a0') };

/** 23 212 000 FCFA */
export const fcfa = n => (n == null ? '—' : `${nf.format(Math.round(Number(n)))} FCFA`);
/** Montant seul (sans devise), pour les grands chiffres mis en forme à part. */
export const amount = n => (n == null ? '—' : nf.format(Math.round(Number(n))));
/** 23,2 M — pour les petits espaces. */
export const compact = n => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`;
  return nf.format(v);
};

// Les dates « AAAA-MM-JJ » sont lues comme des jours civils (pas de décalage de fuseau)
const toDate = v => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const date = v => { const d = toDate(v); return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'; };
export const shortDate = v => { const d = toDate(v); return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
export const monthYear = v => { const d = toDate(v); return d ? d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '—'; };
export const time = v => { const d = toDate(v); return d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''; };

/** « aujourd'hui », « hier », « 12 octobre » — pour les fils de messages et de chantier. */
export const dayLabel = v => {
  const d = toDate(v);
  if (!d) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};

/** Nombre de jours avant (positif) ou depuis (négatif) une date. */
export const daysUntil = v => {
  const d = toDate(v);
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
};

export const firstName = name => (name || '').trim().split(/\s+/)[0] || '';
export const initials = name => (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
