/** Repères du module Commercial (les libellés détaillés viennent de /admin/erp/commercial/meta). */
import { useEffect, useState } from 'react';
import { api } from '@admin/lib/api';

let cache = null;
export function useCommercialMeta() {
  const [meta, setMeta] = useState(cache);
  useEffect(() => {
    if (cache) return;
    api.get('/admin/erp/commercial/meta').then(m => { cache = m; setMeta(m); }).catch(() => {});
  }, []);
  return meta;
}

// Montants compacts : 12 500 000 → « 12,5 M »
export const compact = v => {
  const n = Number(v) || 0;
  if (n < 0) return `−${compact(-n)}`;
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Md`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
};

// Pastille de la prochaine activité (comme le pipeline Odoo) : en retard, aujourd'hui, à venir
export const ACTIVITY_STATE = {
  retard: { label: 'En retard', color: 'var(--danger)' },
  aujourdhui: { label: 'Aujourd’hui', color: 'var(--warn)' },
  a_venir: { label: 'Planifiée', color: 'var(--ok)' },
};

// Teinte de chaque étape du circuit (palette validée du dashboard)
export const STAGE_COLORS = {
  prospection: '#8a8f98', visite: '#2a78d6', decision: '#6d28d9', choix_bien: '#eda100',
  paiement: '#eb6834', contrat: '#1baf7a', notaire: '#15845c', livraison: '#0b6ba8', sav: '#0b6ba8', perdu: '#9f1239',
};

export const CALL_STATUS = {
  payee: { label: 'Payé', tone: 'ok' },
  partielle: { label: 'Partiellement payé', tone: 'warn' },
  en_retard: { label: 'En retard', tone: 'danger' },
  a_venir: { label: 'Appelé, à régler', tone: 'warn' },
};

export const floorLabel = f => (f == null ? '—' : f === 0 ? 'Rez-de-chaussée' : f < 0 ? `Sous-sol ${-f}` : `${f}${f === 1 ? 'er' : 'e'} étage`);

export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const monthName = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); };
