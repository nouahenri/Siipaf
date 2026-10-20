/** Référentiels de la paie (contrats, services, situation de famille, barème). */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@admin/lib/api';

let cache = null;
const listeners = new Set();
export function usePaieMeta() {
  const [meta, setMeta] = useState(cache);
  const reload = useCallback(() => api.get('/admin/erp/paie/meta').then(m => { cache = m; listeners.forEach(fn => fn(m)); }).catch(() => {}), []);
  useEffect(() => {
    listeners.add(setMeta);
    if (!cache) reload();
    return () => listeners.delete(setMeta);
  }, [reload]);
  return { meta, reload };
}

export const RUN_STATUS = { brouillon: { label: 'Brouillon', tone: 'warn' }, valide: { label: 'Validée', tone: 'brand' }, paye: { label: 'Payée', tone: 'ok' } };
export const periodLabel = p => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); };
