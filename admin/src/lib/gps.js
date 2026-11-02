/**
 * Position GPS saisie librement : « 5.3601, -4.0083 » (copié depuis Google Maps), « 5,3601 ; -4,0083 »
 * ou un lien Google Maps (…/@5.3601,-4.0083,17z ou ?q=5.3601,-4.0083). Renvoie { lat, lng }, null si vide, false si illisible.
 * Sert à la fiche projet du dashboard et aux positions de pointage de l'ERP (lieux, chantiers).
 */
export function parseGps(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    || t.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return false;
  const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : false;
}

export const gpsText = p => (p?.latitude != null && p?.longitude != null ? `${Number(p.latitude)}, ${Number(p.longitude)}` : '');

export const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
