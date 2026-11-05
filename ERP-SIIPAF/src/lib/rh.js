/** Référentiels du module RH (types d'absence, statuts, réglages) et petits utilitaires d'affichage. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@admin/lib/api';

let cache = null;
const listeners = new Set();
export function useRhMeta() {
  const [meta, setMeta] = useState(cache);
  const reload = useCallback(() => api.get('/admin/erp/rh/meta').then(m => { cache = m; listeners.forEach(fn => fn(m)); }).catch(() => {}), []);
  useEffect(() => {
    listeners.add(setMeta);
    if (!cache) reload();
    return () => listeners.delete(setMeta);
  }, [reload]);
  return { meta, reload };
}

export const RH = '/admin/erp/rh';
export const today = () => new Date().toISOString().slice(0, 10);
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const days = n => `${Number(n).toLocaleString('fr-FR')} jour${Math.abs(n) >= 2 ? 's' : ''}`;
export const hours = n => (n == null ? '—' : `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`);
export const hm = iso => (iso ? new Date(iso).toISOString().slice(11, 16) : '—'); // heure d'Abidjan = UTC
/** Direction d'un service (meta RH ou paie : directions + department_directions), « Sans direction » sinon. */
export const directionOf = (meta, department) => (meta ? meta.directions?.[meta.department_directions?.[department]] || 'Sans direction' : '');
export const fullName = e => (e ? `${e.last_name} ${e.first_name}` : '');

// ─── Contrôle du lieu de pointage ─────────────────────────
/** Position de l'appareil qui pointe (téléphone, tablette de la borne) et sa précision ; {} si refusée ou trop lente. */
export const devicePosition = () => new Promise(resolve => {
  if (!navigator.geolocation) return resolve({});
  navigator.geolocation.getCurrentPosition(
    p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
    () => resolve({}), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
  );
});
export const meters = m => (m == null ? '' : m >= 1000 ? `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km` : `${m} m`);
/** Message montré à la personne qui pointe quand le contrôle du lieu relève un écart (le pointage est enregistré). */
export function geoWarning(a, action) {
  const status = action === 'depart' ? a.out_geo_status : a.geo_status, d = action === 'depart' ? a.out_distance_m : a.distance_m;
  if (status === 'hors_zone') return `Pointage enregistré hors zone (à ${meters(d)} du lieu choisi) : le service RH est prévenu.`;
  if (status === 'imprecise') return 'Pointage enregistré, position imprécise : il est signalé au service RH. Activez la localisation précise (GPS) de l’appareil.';
  if (status === 'sans_position') return 'Pointage enregistré sans position : il est signalé au service RH. Autorisez la localisation pour ce site.';
  return null;
}

export const EXPENSE_TONES = { brouillon: '', soumise: 'warn', approuvee: 'brand', comptabilisee: 'brand', remboursee: 'ok', refusee: 'danger' };
export const STAGE_COLORS = { nouveau: '#8a8f99', qualification: '#2a78d6', entretien_1: '#0f8fa3', entretien_2: '#6d28d9', proposition: '#eda100', embauche: '#1baf7a' };
// Couleur de chaque service (organigramme) : teintes sourdes, déclinées en fonds très clairs (clair et sombre)
export const DEPT_COLORS = {
  direction: '#4b5a8a', commercial: '#3f8a6e', technique: '#3a72a0', chantier: '#a67a3d',
  administratif: '#86689a', comptabilite: '#3f8686', juridique: '#9a5c62',
};
export const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** Valeur d'un indicateur selon son unité (nombre, FCFA, %, heures, jours, note sur 5). */
export function metricValue(unit, v) {
  if (v == null) return '—';
  const n = Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return { fcfa: `${Number(v).toLocaleString('fr-FR')} FCFA`, pct: `${n} %`, heures: `${n} h`, jours: `${n} j`, note: `${n} / 5` }[unit] || n;
}

/** Envoi multipart (reçu, CV, document) : les champs vides ne sont pas transmis. */
export function formData(fields, files = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== '' && v != null) f.append(k, typeof v === 'boolean' ? String(v) : v);
  for (const [k, v] of Object.entries(files)) if (v) f.append(k, v);
  return f;
}
