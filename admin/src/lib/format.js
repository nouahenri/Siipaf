const nf = new Intl.NumberFormat('fr-FR');
export const fcfa = n => (n == null || n === '' ? '—' : `${nf.format(Number(n))} FCFA`);
export const num = n => (n == null ? '—' : nf.format(Number(n)));
const toDate = v => (v == null ? null : new Date(typeof v === 'number' || /^\d+$/.test(v) ? Number(v) : v));
export const date = v => { const d = toDate(v); return d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; };
export const dateTime = v => { const d = toDate(v); return d ? d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };
export const relative = v => {
  const d = toDate(v);
  if (!d) return '—';
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
};
export const initials = name => (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const toLocalInput = v => { const d = toDate(v); if (!d) return ''; const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
