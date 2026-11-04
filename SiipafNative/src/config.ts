/**
 * Adresses de l'application : même serveur et même base que le site et l'espace client.
 * - Production : https://client.siipaf.com (API) et https://siipaf.com (images d'origine du site).
 * - Développement : EXPO_PUBLIC_API_URL (ex. http://192.168.1.20:4001 pour un téléphone sur le même Wi-Fi que le serveur
 *   de démonstration), sinon `extra.apiUrl` de app.json.
 */
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; siteUrl?: string; shareUrl?: string; privacyUrl?: string };

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || 'https://client.siipaf.com').replace(/\/$/, '');
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || extra.siteUrl || 'https://siipaf.com').replace(/\/$/, '');

/** Coordonnées d'origine : remplacées par celles de Contenu du site (dashboard) dès que l'API répond. */
export const DEFAULT_CONTACT = {
  phone: '+225 01 02 27 95 95',
  phone2: '+225 27 22 20 50 20',
  email: 'info@siipaf.com',
  address: 'Cocody 2 Plateaux 7ème Tranche, Abidjan',
  whatsapp: '2250102279595',
  socials: {} as Record<string, string>,
};

export const PASSWORD_MIN = 10;

/** Lien partagé par « Partager l'application » (page de téléchargement ou fiche des stores, à régler après publication). */
export const SHARE_URL = extra.shareUrl || SITE_URL;
/** Politique de confidentialité exigée par les stores (page à publier par SIIPAF ; vide tant qu'elle n'existe pas). */
export const PRIVACY_URL = extra.privacyUrl || '';
