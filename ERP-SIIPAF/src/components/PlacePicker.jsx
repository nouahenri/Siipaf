/**
 * Imputation d'une pièce (choix du client du 24/10) : un lieu (siège social, bureau annexe, dépôt…) ou un programme,
 * avec ou sans chantier précis. Sans choix, le serveur impute au siège social. Utilisé par les achats, le Parc,
 * les notes de frais, les demandes internes, les pointages et les contrats.
 */
import { useResource } from '@admin/lib/app-context';

export const PLACE_URL = '/admin/erp/lieux/choix';
export const NO_PLACE = { project_id: null, worksite_id: null, place_id: null };

const encode = v => (v?.worksite_id ? `w:${v.worksite_id}` : v?.project_id ? `p:${v.project_id}` : v?.place_id ? `l:${v.place_id}` : '');
export function decode(s, programmes = []) {
  const [k, raw] = String(s || '').split(':');
  const id = Number(raw) || null;
  if (k === 'w') return { project_id: programmes.find(p => p.worksites.some(w => w.id === id))?.id || null, worksite_id: id, place_id: null };
  if (k === 'p') return { project_id: id, worksite_id: null, place_id: null };
  if (k === 'l') return { project_id: null, worksite_id: null, place_id: id };
  return { ...NO_PLACE };
}

/** Libellé d'une imputation déjà enregistrée (lignes de liste, fiches). */
export function placeLabel(x) {
  if (x?.worksite_reference) return `${x.project_name || ''} · ${x.worksite_reference} — ${x.worksite_name}`.replace(/^ · /, '');
  return x?.project_name || x?.place_name || '—';
}

/**
 * Liste déroulante « Affectation ». `value` : { project_id, worksite_id, place_id } ; `onChange` reçoit le même objet.
 * `empty` : libellé du choix vide (par défaut « Siège social (par défaut) ») ; `programmesOnly` masque les lieux.
 */
export default function PlacePicker({ value, onChange, empty, programmesOnly = false, id, disabled, required, ariaLabel = 'Affectation' }) {
  const res = useResource(PLACE_URL);
  const data = res.data;
  const current = encode(value);
  // Un chantier clos ou un lieu désactivé reste affiché s'il est déjà choisi
  const known = !current || !data || [...data.places.map(p => `l:${p.id}`), ...data.programmes.flatMap(p => [`p:${p.id}`, ...p.worksites.map(w => `w:${w.id}`)])].includes(current);
  return (
    <select className="select" id={id} disabled={disabled || !data} required={required} aria-label={ariaLabel} value={current}
      onChange={e => onChange(decode(e.target.value, data?.programmes))}>
      <option value="">{empty ?? 'Siège social (par défaut)'}</option>
      {!known && <option value={current}>Choix actuel (chantier clos ou lieu désactivé)</option>}
      {data && !programmesOnly && data.places.length > 0 && (
        <optgroup label="Lieux">{data.places.map(p => <option key={p.id} value={`l:${p.id}`}>{p.name}</option>)}</optgroup>
      )}
      {data?.programmes.map(p => (
        <optgroup key={p.id} label={p.name}>
          <option value={`p:${p.id}`}>{p.name} — tout le programme</option>
          {p.worksites.map(w => <option key={w.id} value={`w:${w.id}`}>{w.reference} — {w.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
