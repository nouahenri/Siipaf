/**
 * Langue de l'interface (Paramètres › Langue) : français, anglais, espagnol. Les textes sont écrits en français dans le
 * code et traduits ici ; un texte absent des dictionnaires reste en français. Les contenus saisis dans le dashboard
 * (programmes, pages SIIPAF, messages de l'équipe) ne sont pas traduits : ils n'existent qu'en français.
 * Variables : « Dans {n} jours » → t('Dans {n} jours', { n: 3 }).
 */
import { EN, ES } from './i18n-dict';

export type Lang = 'fr' | 'en' | 'es';
export type Vars = Record<string, string | number>;

export const LANGUAGES: Record<Lang, string> = { fr: 'Français', en: 'English', es: 'Español' };
export const LOCALES: Record<Lang, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };

const DICTS: Record<Lang, Record<string, string> | null> = { fr: null, en: EN, es: ES };

export function translate(lang: Lang, fr: string, vars?: Vars) {
  let text = DICTS[lang]?.[fr] ?? fr;
  // Pluriel accordé avec {n} : « {n} programme(s) » → « 1 programme », « 6 programmes »
  if (vars && 'n' in vars) text = text.replace(/\(s\)/g, Number(vars.n) > 1 ? 's' : '');
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}
