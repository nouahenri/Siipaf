/**
 * Liens réglés dans le dashboard pour le site (« projets.html#riviera », « contact.html?projet=CLY », « tel: … ») traduits en
 * écrans de l'application ; téléphone, e-mail, WhatsApp et adresses web s'ouvrent dans l'application du téléphone.
 */
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';
import { SITE_URL } from '@/config';
import { digits } from './format';

export function routeFor(href?: string | null): Href | null {
  const h = String(href || '').trim();
  if (!h) return null;
  const [pathPart, hash = ''] = h.split('#');
  const [path, query = ''] = pathPart.split('?');
  const q = new URLSearchParams(query);
  const page = path.replace(/^\.?\//, '').toLowerCase();
  const projet = (q.get('projet') || '').toLowerCase();
  switch (page) {
    case '': case 'index.html': return '/';
    case 'projets.html': return hash ? `/projet/${hash}` as Href : '/programmes';
    case 'lotissements.html': return hash ? `/projet/${hash}` as Href : { pathname: '/programmes', params: { type: 'lotissement' } };
    case 'plan-interactif.html': return projet ? `/plan/${projet}` as Href : '/programmes';
    case 'contact.html': return { pathname: '/demande', params: { ...(projet ? { projet } : {}), ...(q.get('bien') ? { bien: q.get('bien')! } : {}) } };
    case 'financement.html': return '/infos/financement';
    case 'a-propos.html': return '/infos/a-propos';
    case 'carrieres.html': return '/infos/carrieres';
    default: return null;
  }
}

export async function openLink(href?: string | null) {
  const h = String(href || '').trim();
  if (!h) return;
  const route = routeFor(h);
  if (route) { router.push(route); return; }
  if (/^(tel:|mailto:)/i.test(h)) { Linking.openURL(h).catch(() => {}); return; }
  if (/^https?:\/\/(wa\.me|api\.whatsapp\.com)/i.test(h)) { Linking.openURL(h).catch(() => {}); return; }
  if (/^https?:/i.test(h)) { WebBrowser.openBrowserAsync(h).catch(() => {}); return; }
  WebBrowser.openBrowserAsync(`${SITE_URL}/${h.replace(/^\//, '')}`).catch(() => {});
}

export const call = (phone: string) => Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => {});
export const mail = (email: string, subject?: string) => Linking.openURL(`mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`).catch(() => {});
/** WhatsApp avec un message prérempli (le visiteur garde la main avant l'envoi). */
export const whatsapp = (number: string, text?: string) =>
  Linking.openURL(`https://wa.me/${digits(number)}${text ? `?text=${encodeURIComponent(text)}` : ''}`).catch(() => {});
/**
 * Itinéraire Google Maps vers un programme : `destination` = « lat,lng » (position GPS) ou adresse (position approchée).
 * L'application Google Maps si elle est installée (iOS), sinon le lien universel, qu'Android ouvre dans Google Maps.
 */
export const directions = (destination: string) => {
  const d = encodeURIComponent(destination);
  const web = `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=driving`;
  const app = Platform.OS === 'ios' ? `comgooglemaps://?daddr=${d}&directionsmode=driving` : web;
  Linking.openURL(app).catch(() => Linking.openURL(web).catch(() => {}));
};
