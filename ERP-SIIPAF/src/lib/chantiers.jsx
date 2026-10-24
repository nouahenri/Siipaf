/** ERP · Chantiers : adresse de l'API, droits, couleurs des statuts et des états de phase. */
import { useResource } from '@admin/lib/app-context';

export const CH = '/admin/erp/chantiers';
export const CHANTIERS = ['chantiers:read', 'chantiers:write', 'chantiers:direction', 'direction:read'];
// Le conducteur nommé sur un chantier entre dans le module sans droit
export const CHANTIERS_SHOW = b => b?.mine > 0;
export const WS_TONES = { preparation: '', en_cours: 'brand', suspendu: 'warn', receptionne: 'ok', clos: '' };
export const PHASE_TONES = { a_venir: '', en_cours: 'brand', en_retard: 'danger', termine: 'ok' };
export const TASK_COLORS = { a_faire: '#8a8f99', en_cours: '#2a78d6', bloque: '#d2101e', fait: '#1baf7a' };

export const useChantierRefs = () => useResource(`${CH}/refs`).data;

/** Corps d'un formulaire : champs vides → null, identifiants et montants → nombres. */
export function body(f, numbers = []) {
  const out = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
  for (const k of numbers) out[k] = out[k] == null ? null : Number(out[k]);
  return out;
}
