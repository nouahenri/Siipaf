/** Briques partagées du module Comptabilité. */
import { useCallback, useEffect, useId, useState } from 'react';
import { api } from '@admin/lib/api';

let cache = null;
const listeners = new Set();
/** Référentiels (journaux, exercices, réglages, programmes) ; `reload` après un changement de paramètres. */
export function useComptaMeta() {
  const [meta, setMeta] = useState(cache);
  const reload = useCallback(() => api.get('/admin/erp/compta/meta').then(m => { cache = m; listeners.forEach(fn => fn(m)); }).catch(() => {}), []);
  useEffect(() => {
    listeners.add(setMeta);
    if (!cache) reload();
    return () => listeners.delete(setMeta);
  }, [reload]);
  return { meta, reload };
}

const nf = new Intl.NumberFormat('fr-FR');
/** Montant comptable : 1 250 000 (sans devise, colonnes alignées) ; vide pour 0. */
export const amt = (n, { zero = '' } = {}) => (!n ? zero : nf.format(n).replace(/ /g, ' '));
export const signed = n => (n < 0 ? `(${amt(-n)})` : amt(n, { zero: '0' }));

export const STATUS = { brouillon: { label: 'Brouillon', tone: 'warn' }, valide: { label: 'Validée', tone: 'ok' } };
export const SOURCES = {
  manuel: 'Saisie manuelle', versement: 'Versement client', appel_fonds: 'Appel de fonds VEFA', tma: 'Travaux modificatifs (TMA)', vente: 'Vente constatée',
  achat: 'Facture d’achat', reglement: 'Règlement fournisseur', an: 'À-nouveaux', contrepassation: 'Contrepassation', paie: 'Paie',
};
export const PAYMENT_STATUS = {
  a_payer: { label: 'À payer', tone: 'warn' }, en_retard: { label: 'En retard', tone: 'danger' }, partielle: { label: 'Partiellement payée', tone: 'warn' }, payee: { label: 'Payée', tone: 'ok' },
};

/** Saisie d'un compte : numéro avec suggestions du plan comptable. */
export function AccountInput({ value, onChange, placeholder = 'Compte', required, autoFocus, classes }) {
  const id = useId();
  const [options, setOptions] = useState([]);
  useEffect(() => {
    if (!value || value.length < 1) { setOptions([]); return undefined; }
    const t = setTimeout(() => api.get(`/admin/erp/compta/accounts?active=1&q=${encodeURIComponent(value)}`)
      .then(rows => setOptions(rows.filter(a => !classes || classes.includes(a.class)).slice(0, 30))).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [value, classes]);
  const match = options.find(o => o.code === value);
  return (
    <>
      <input className="input tabular" list={id} value={value} onChange={e => onChange(e.target.value.trim())} placeholder={placeholder} required={required} autoFocus={autoFocus}
        title={match ? match.label : undefined} aria-label={placeholder} />
      <datalist id={id}>{options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</datalist>
    </>
  );
}

/** Choix de la période des états : exercice entier ou dates. */
export function PeriodPicker({ meta, value, onChange }) {
  const years = meta?.fiscal_years || [];
  return (
    <div className="row" style={{ gap: 8 }}>
      <select className="select" style={{ width: 'auto' }} value={value.fiscal_year_id || ''} onChange={e => onChange({ ...value, fiscal_year_id: e.target.value, from: '', to: '' })} aria-label="Exercice">
        <option value="">Toutes périodes</option>
        {years.map(y => <option key={y.id} value={y.id}>Exercice {y.label}{y.status === 'cloture' ? ' (clôturé)' : ''}</option>)}
      </select>
      <input className="input" type="date" style={{ width: 'auto' }} value={value.from || ''} onChange={e => onChange({ ...value, from: e.target.value })} aria-label="Du" />
      <input className="input" type="date" style={{ width: 'auto' }} value={value.to || ''} onChange={e => onChange({ ...value, to: e.target.value })} aria-label="Au" />
      <label className="checkbox small"><input type="checkbox" checked={!!value.draft} onChange={e => onChange({ ...value, draft: e.target.checked })} />Brouillons compris</label>
    </div>
  );
}

export const periodQuery = p => new URLSearchParams(Object.entries({ fiscal_year_id: p.fiscal_year_id, from: p.from, to: p.to, draft: p.draft ? '1' : '' }).filter(([, v]) => v)).toString();

/** Téléchargement d'un tableau en CSV (séparateur « ; », lisible par Excel). */
export function downloadCsv(filename, header, rows) {
  const cell = v => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = `﻿${[header, ...rows].map(r => r.map(cell).join(';')).join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
