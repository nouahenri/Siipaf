/**
 * Position approchée d'un programme sans coordonnées GPS (carte de l'application mobile) : l'adresse (localisation puis
 * ville, en Côte d'Ivoire) est cherchée dans OpenStreetMap (Nominatim). Résultat gardé en mémoire 7 jours, échec 1 heure,
 * pour rester sous la limite d'usage de Nominatim (1 requête par seconde, identifiant d'application obligatoire).
 * En test, rien ne part : `setTransport` permet de simuler la réponse.
 */
const { isTest } = require('../config');

const URL = 'https://nominatim.openstreetmap.org/search';
const OK_TTL = 7 * 24 * 3600 * 1000;
const FAIL_TTL = 3600 * 1000;
const cache = new Map();

let transport = async q => {
  const res = await fetch(`${URL}?format=json&limit=1&countrycodes=ci&q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': 'SIIPAF-API/1.0 (application mobile SIIPAF ; info@siipaf.com)', Accept: 'application/json', 'Accept-Language': 'fr' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
};
const setTransport = fn => { const old = transport; transport = fn; cache.clear(); return old; };
let inTest = false;
const enableInTest = on => { inTest = on; };

async function lookup(q) {
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.pos;
  let pos = null;
  try { pos = await transport(q); } catch { pos = null; }
  if (pos && !(Number.isFinite(pos.lat) && Number.isFinite(pos.lng))) pos = null;
  cache.set(key, { pos, until: Date.now() + (pos ? OK_TTL : FAIL_TTL) });
  return pos;
}

/**
 * Position approchée d'après la localisation (premier segment : « Subiakro — Axe Yamoussoukro–Oumé » → « Subiakro »)
 * et la ville ; à défaut, la ville seule. Renvoie { lat, lng, precision: 'localisation' | 'ville' } ou null.
 */
async function approxPosition({ location, city }) {
  if (isTest && !inTest) return null;
  const place = String(location || '').split(/[—–,(]| - /)[0].trim();
  const town = String(city || '').trim();
  if (place && town) {
    const pos = await lookup(`${place}, ${town}, Côte d'Ivoire`);
    if (pos) return { ...pos, precision: 'localisation' };
  }
  if (town) {
    const pos = await lookup(`${town}, Côte d'Ivoire`);
    if (pos) return { ...pos, precision: 'ville' };
  }
  return null;
}

module.exports = { approxPosition, setTransport, enableInTest };
