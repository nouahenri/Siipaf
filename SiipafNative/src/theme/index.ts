/**
 * Charte SIIPAF pour l'application : rouge SIIPAF, noir, or (css/style.css du site), Poppins partout (titres en gras serré,
 * à la manière d'une application et non d'un site). Fond blanc, cartes posées avec une ombre douce, en-têtes blancs arrondis.
 * Toutes les couleurs, tailles et espacements des écrans viennent d'ici, en clair comme en sombre.
 */
import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

/** Réglages d'affichage choisis dans Paramètres (providers/preferences.tsx) : thème et taille du texte. */
export const ThemeSettingsContext = createContext<{ mode: 'system' | 'light' | 'dark'; scale: number }>({ mode: 'system', scale: 1 });

export const brand = {
  red: '#E30613',
  redDark: '#B3000F',
  gold: '#B8972E',
  goldLight: '#D4AF37',
  black: '#0A0A0A',
  white: '#FFFFFF',
};

const light = {
  ...brand,
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F4F7',
  ink: '#141414',
  ink2: '#4A4D57',
  ink3: '#6B6E79', // 5,1:1 sur blanc
  line: '#E8E9EE',
  primary: brand.red,
  onPrimary: '#FFFFFF',
  accent: '#7A5F10', // or lisible sur fond clair (contraste 5:1)
  accentSoft: '#F6EFD9',
  ok: '#1F7A4A',
  okSoft: '#E3F3EA',
  warn: '#8A5A00',
  warnSoft: '#FBF0D9',
  danger: '#B4141F',
  dangerSoft: '#FCE6E7',
  info: '#0B5C8F',
  infoSoft: '#E2F0F8',
  dark: '#111111',
  onDark: '#FFFFFF',
  overlay: 'rgba(10,10,10,0.55)',
  whatsapp: '#137A3F',
  call: '#0B5C8F',
  available: '#1F7A4A',
  shadow: '#000000',
};

const dark: typeof light = {
  ...brand,
  bg: '#0E0E10',
  surface: '#1A1A1D',
  surfaceAlt: '#26262A',
  ink: '#F4F4F5',
  ink2: '#C9C9CE',
  ink3: '#9A9BA2',
  line: '#2A2A2E',
  primary: '#D81F2B', // texte blanc lisible (4,5:1)
  onPrimary: '#FFFFFF',
  accent: brand.goldLight,
  accentSoft: '#2B2412',
  ok: '#4CC283',
  okSoft: '#11281C',
  warn: '#E3B25A',
  warnSoft: '#2B210E',
  danger: '#FF6B73',
  dangerSoft: '#2D1214',
  info: '#6CB8E6',
  infoSoft: '#0E2230',
  dark: '#2A2A2F', // bulles et boutons sombres visibles sur le fond sombre
  onDark: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.65)',
  whatsapp: '#137A3F',
  call: '#0B5C8F',
  available: '#1F7A4A',
  shadow: '#000000',
};

export type Colors = typeof light;
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'gold' | 'dark' | 'primary';

export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const type = {
  hero: 30, h1: 25, h2: 20, h3: 16.5, body: 15.5, small: 13.5, tiny: 12,
} as const;
const scaled = (k: number) => Object.fromEntries(Object.entries(type).map(([n, v]) => [n, Math.round(v * k * 10) / 10])) as unknown as typeof type;

export function useTheme() {
  const scheme = useColorScheme();
  const settings = useContext(ThemeSettingsContext);
  const isDark = settings.mode === 'system' ? scheme === 'dark' : settings.mode === 'dark';
  const c = isDark ? dark : light;
  const tone = (t: Tone) => ({
    ok: { fg: c.ok, bg: c.okSoft },
    warn: { fg: c.warn, bg: c.warnSoft },
    danger: { fg: c.danger, bg: c.dangerSoft },
    info: { fg: c.info, bg: c.infoSoft },
    gold: { fg: c.accent, bg: c.accentSoft },
    muted: { fg: c.ink3, bg: c.surfaceAlt },
    dark: { fg: c.onDark, bg: c.dark },
    primary: { fg: c.onPrimary, bg: c.primary },
  }[t]);
  const shadow = (level: 1 | 2 = 1) => ({
    shadowColor: c.shadow,
    shadowOpacity: isDark ? 0 : level === 1 ? 0.08 : 0.16,
    shadowRadius: level === 1 ? 12 : 24,
    shadowOffset: { width: 0, height: level === 1 ? 2 : 8 },
    elevation: isDark ? 0 : level === 1 ? 3 : 8,
  });
  return { c, isDark, tone, shadow, fonts, space, radius, type: settings.scale === 1 ? type : scaled(settings.scale) };
}

export type Theme = ReturnType<typeof useTheme>;
