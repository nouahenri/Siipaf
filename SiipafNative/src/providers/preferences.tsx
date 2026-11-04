/**
 * Préférences dans React : thème (clair / sombre / système), taille du texte et langue de l'interface appliqués à toute
 * l'application dès qu'ils changent dans Paramètres. `t` traduit les textes de l'interface (lib/i18n.ts).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_PREFS, getPrefs, loadPrefs, resetPrefs, setPref, subscribePrefs, type Prefs } from '@/lib/prefs';
import { translate, type Vars } from '@/lib/i18n';
import { ThemeSettingsContext } from '@/theme';

type PrefsValue = {
  prefs: Prefs;
  ready: boolean;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => Promise<void>;
  reset: () => Promise<void>;
  t: (fr: string, vars?: Vars) => string;
};

const PrefsContext = createContext<PrefsValue>({
  prefs: DEFAULT_PREFS, ready: false, set: async () => {}, reset: async () => {}, t: (fr, vars) => translate('fr', fr, vars),
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(getPrefs());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const off = subscribePrefs(setPrefs);
    loadPrefs().finally(() => setReady(true));
    return off;
  }, []);
  const t = useCallback((fr: string, vars?: Vars) => translate(prefs.language, fr, vars), [prefs.language]);
  const value = useMemo<PrefsValue>(() => ({ prefs, ready, set: setPref, reset: resetPrefs, t }), [prefs, ready, t]);
  const themeSettings = useMemo(() => ({ mode: prefs.theme, scale: prefs.textScale === 'large' ? 1.12 : 1 }), [prefs.theme, prefs.textScale]);
  return (
    <PrefsContext.Provider value={value}>
      <ThemeSettingsContext.Provider value={themeSettings}>{children}</ThemeSettingsContext.Provider>
    </PrefsContext.Provider>
  );
}

export const usePrefs = () => useContext(PrefsContext);
/** Traduction des textes de l'interface : `const t = useT(); t('Rechercher')`. */
export const useT = () => useContext(PrefsContext).t;
