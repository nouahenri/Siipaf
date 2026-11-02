import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { parseGps, mapsLink } from '@admin/lib/gps';

/**
 * Position GPS d'un lieu de pointage (lieu, chantier) : coller « latitude, longitude » ou un lien Google Maps, ou prendre la
 * position de l'appareil sur place. `value` : texte saisi ; la lecture se fait avec parseGps à l'enregistrement.
 */
export default function GpsInput({ value, onChange, disabled = false, ariaLabel = 'Latitude, longitude' }) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);
  const gps = parseGps(value);
  const locate = () => {
    if (!navigator.geolocation) return setError('Cet appareil ne donne pas sa position.');
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      p => { setLocating(false); onChange(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`); if (p.coords.accuracy > 30) setError(`Précision de l’appareil : ${Math.round(p.coords.accuracy)} m. Pour un repère exact, collez plutôt la position depuis Google Maps.`); },
      () => { setLocating(false); setError('Position refusée ou indisponible sur cet appareil.'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ gap: 6 }}>
        <input className="input tabular" style={{ flex: 1, minWidth: 180 }} disabled={disabled} value={value} onChange={e => { setError(null); onChange(e.target.value); }} placeholder="5.3601, -4.0083" aria-label={ariaLabel} />
        {!disabled && <button type="button" className="btn btn-sm" disabled={locating} onClick={locate} title="Prendre la position de cet appareil (à faire sur place)"><LocateFixed />{locating ? '…' : 'Ma position'}</button>}
      </div>
      {gps === false ? <span className="small" style={{ color: 'var(--danger)' }}>Illisible : « latitude, longitude » (ex. 5.3601, -4.0083) ou lien Google Maps.</span>
        : gps ? <a className="small link" href={mapsLink(gps.lat, gps.lng)} target="_blank" rel="noreferrer">Vérifier sur Google Maps</a> : null}
      {error && <span className="small muted">{error}</span>}
    </div>
  );
}
