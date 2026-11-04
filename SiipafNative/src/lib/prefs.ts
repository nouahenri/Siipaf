/**
 * Préférences de l'application (écran Paramètres), gardées sur le téléphone. Lisibles hors de React (vibrations,
 * verrouillage, son des notifications) et dans React par `usePrefs` (providers/preferences.tsx).
 */
import { prefs as storage } from './storage';

export type Prefs = {
  theme: 'system' | 'light' | 'dark';
  language: 'fr' | 'en' | 'es';
  textScale: 'normal' | 'large';
  reduceMotion: boolean;
  haptics: boolean;
  /** Devise d'affichage des prix de la vitrine (le FCFA reste la devise des contrats). */
  currency: 'FCFA' | 'EUR';
  /** Formule ouverte par défaut dans le simulateur de mensualité. */
  simulator: 'echelonne' | 'diaspora' | 'comptant';
  /** Ville présélectionnée dans la recherche (identifiant de la liste « Villes » du dashboard). */
  preferredCity: number | null;
  /** Pays de résidence, repris dans les formulaires (diaspora, rendez-vous en visio). */
  country: string;
  dataSaver: boolean;
  /** « Recevoir des notifications push » : annonces de SIIPAF pour tous, plus le dossier du client connecté. « unset » :
   *  jamais choisi (le client qui se connecte est inscrit, comme avant ; le visiteur ne l'est pas). */
  push: 'unset' | 'on' | 'off';
  notificationSound: boolean;
  /** Minutes en arrière-plan avant de redemander Face ID / l'empreinte (0 : à chaque retour). */
  lockDelay: 0 | 1 | 2 | 5 | 15;
};

export const DEFAULT_PREFS: Prefs = {
  theme: 'system', language: 'fr', textScale: 'normal', reduceMotion: false, haptics: true, currency: 'FCFA',
  simulator: 'echelonne', preferredCity: null, country: '', dataSaver: false, push: 'unset', notificationSound: true, lockDelay: 2,
};

const KEY = 'siipaf.prefs';
let current: Prefs = { ...DEFAULT_PREFS };
const listeners = new Set<(p: Prefs) => void>();

export const getPrefs = () => current;

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await storage.get(KEY);
    if (raw) current = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { /* préférences illisibles : valeurs par défaut */ }
  listeners.forEach(l => l(current));
  return current;
}

export async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  current = { ...current, [key]: value };
  listeners.forEach(l => l(current));
  await storage.set(KEY, JSON.stringify(current));
}

export async function resetPrefs() {
  current = { ...DEFAULT_PREFS };
  listeners.forEach(l => l(current));
  await storage.remove(KEY);
}

export function subscribePrefs(fn: (p: Prefs) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
