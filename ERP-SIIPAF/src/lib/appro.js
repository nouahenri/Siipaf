import { useState } from 'react';
import { useResource, useSaved } from '@admin/lib/app-context';
export const APPRO = '/admin/erp/achats';
export const today = () => new Date().toISOString().slice(0, 10);
export const qty = n => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
export const tone = s => ['confirmee', 'recue', 'valide', 'livre'].includes(s) ? 'ok' : ['a_valider', 'attente_direction', 'partielle', 'demande'].includes(s) ? 'warn' : ['refusee', 'annulee', 'annule', 'refuse'].includes(s) ? 'danger' : '';
export const useApproRefs = () => useResource(`${APPRO}/refs`);
export function useApproAction() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), saved = useSaved();
  const run = async (fn, message, after) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { const result = await fn(); if (message) saved(message); window.dispatchEvent(new Event('siipaf:erp-notifications')); after?.(result); return result; }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  };
  return { run, busy, error, clear: () => setError(null) };
}

