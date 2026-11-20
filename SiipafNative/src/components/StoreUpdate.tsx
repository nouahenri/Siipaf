/**
 * Nouvelle version de l'application, vérifiée à l'ouverture et au retour au premier plan (module expo-in-app-updates) :
 * - Android : fenêtre native de Google Play (mise à jour flexible, téléchargée en arrière-plan ; immédiate, plein écran,
 *   quand elle est obligatoire) ;
 * - iPhone : Apple n'a pas de mise à jour dans l'application → alerte système puis fiche App Store (version lue sur l'App Store).
 * Obligatoire quand la version installée est inférieure à la « version minimale exigée » (dashboard › Paramètres ›
 * Général, GET /api/public/app) : l'alerte ne se ferme pas et revient tant que la mise à jour n'est pas faite.
 * Facultative sinon : proposée une seule fois par version du store (« Plus tard » est retenu).
 * Rien en développement ni sur le web.
 */
import * as Application from 'expo-application';
import * as InAppUpdates from 'expo-in-app-updates';
import { useCallback, useEffect, useRef } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/config';
import { publicApi } from '@/lib/api';
import { prefs } from '@/lib/storage';
import { useT } from '@/providers/preferences';

const SEEN_KEY = 'siipaf.update.seen';
const ANDROID_PACKAGE = 'com.siipaf.com';

/** « 1.2.10 » comparé à « 1.10 » : nombre par nombre (les parties absentes valent 0). */
export function compareVersions(a: string, b: string) {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Fiche de l'application dans le store, quand la fenêtre du store n'a pas pu s'ouvrir. */
async function openStore() {
  const url = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL || `market://details?id=${ANDROID_PACKAGE}`;
  if (url) await Linking.openURL(url).catch(() => {});
}

export function StoreUpdate() {
  const t = useT();
  const busy = useRef(false);
  const alertOpen = useRef(false); // alerte encore à l'écran : pas de seconde alerte au retour dans l'application

  const check = useCallback(async () => {
    if (__DEV__ || Platform.OS === 'web' || busy.current || alertOpen.current) return;
    busy.current = true;
    try {
      const [cfg, info] = await Promise.all([
        publicApi.get<{ min_version: string | null }>('/app').catch(() => ({ min_version: null })),
        InAppUpdates.checkForUpdate().catch(() => null),
      ]);
      const current = Application.nativeApplicationVersion || '0';
      const forced = !!cfg.min_version && compareVersions(current, cfg.min_version) < 0;
      if (!forced && !info?.updateAvailable) return;
      const storeVersion = String(info?.storeVersion ?? '');
      if (!forced && storeVersion && (await prefs.get(SEEN_KEY)) === storeVersion) return;

      // Android : fenêtre native de Google Play
      if (Platform.OS === 'android' && info?.updateAvailable) {
        const immediate = forced && info.immediateAllowed !== false;
        const started = await InAppUpdates.startUpdate(immediate).catch(() => false);
        if (!forced) { await prefs.set(SEEN_KEY, storeVersion); return; }
        if (started) return; // refusée : proposée de nouveau au retour dans l'application
      }

      // iPhone, ou Android obligatoire sans fenêtre Google Play disponible : alerte système
      const update = async () => {
        alertOpen.current = false;
        const started = Platform.OS === 'ios' ? await InAppUpdates.startUpdate().catch(() => false) : false;
        if (!started) await openStore();
        if (forced) check(); // fiche App Store refermée sans mettre à jour : on redemande
      };
      alertOpen.current = true;
      Alert.alert(
        forced ? t('Mise à jour nécessaire') : t('Nouvelle version disponible'),
        forced
          ? t('Cette version de l’application SIIPAF n’est plus prise en charge. Installez la dernière version pour continuer.')
          : t('Une nouvelle version de l’application SIIPAF est disponible, avec les dernières améliorations.'),
        forced
          ? [{ text: t('Mettre à jour'), isPreferred: true, onPress: update }]
          : [
            { text: t('Plus tard'), style: 'cancel', onPress: () => { alertOpen.current = false; prefs.set(SEEN_KEY, storeVersion); } },
            { text: t('Mettre à jour'), isPreferred: true, onPress: () => { prefs.set(SEEN_KEY, storeVersion); update(); } },
          ],
        { cancelable: !forced, onDismiss: () => { alertOpen.current = false; } },
      );
    } finally {
      busy.current = false;
    }
  }, [t]);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check(); });
    return () => sub.remove();
  }, [check]);
  return null;
}
