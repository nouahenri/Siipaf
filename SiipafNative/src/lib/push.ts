/**
 * Notifications push : inscription du téléphone auprès d'Expo puis du serveur SIIPAF.
 * - « Recevoir des notifications push » (Paramètres) : annonces envoyées depuis le dashboard (Ventes › Notifications push),
 *   pour tous, connecté ou non (POST /api/public/devices, avec la ville préférée et la langue) ;
 * - client connecté : notifications de son dossier (POST /api/client/push), sauf si l'interrupteur est coupé.
 * Il faut un identifiant de projet EAS (app.json › extra.eas.projectId, posé par `eas init`) et une version de
 * développement ou de production : Expo Go sur Android ne reçoit plus de push (SDK 53 et suivants).
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { clientApi, publicApi } from './api';
import { getPrefs, setPref } from './prefs';
import { KEYS, prefs } from './storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: getPrefs().notificationSound, shouldSetBadge: true }),
});

type TokenResult = { token: string | null; reason?: 'web' | 'device' | 'config' | 'refused' | 'error' };

/** Jeton Expo du téléphone ; `ask` : demander l'autorisation si elle n'a pas encore été donnée. */
async function pushToken(ask: boolean): Promise<TokenResult> {
  if (Platform.OS === 'web') return { token: null, reason: 'web' };
  if (!Device.isDevice) return { token: null, reason: 'device' };
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { token: null, reason: 'config' };
  try {
    if (Platform.OS === 'android') {
      // Énumérations réexportées par expo-notifications (le contrôle d'import d'ESLint ne suit pas « export * »)
      await Notifications.setNotificationChannelAsync('default', {
        // eslint-disable-next-line import/namespace
        name: 'Espace client SIIPAF', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200], lightColor: '#E30613',
      });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (ask && !perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
    // eslint-disable-next-line import/namespace
    const ok = perm.granted || perm.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!ok) return { token: null, reason: 'refused' };
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await prefs.set(KEYS.pushToken, data);
    return { token: data };
  } catch {
    return { token: null, reason: 'error' }; // hors ligne : nouvel essai à la prochaine ouverture
  }
}

const device = (token: string) => {
  const p = getPrefs();
  return { token, platform: Platform.OS, city_id: p.preferredCity, language: p.language };
};

/** Client connecté : notifications de son dossier (à la connexion), sauf si l'interrupteur est coupé. */
export async function registerForPush(): Promise<string | null> {
  if (getPrefs().push === 'off') return null;
  const { token } = await pushToken(true);
  if (!token) return null;
  try {
    await clientApi.post('/push', { token, platform: Platform.OS });
    if (getPrefs().push === 'on') await publicApi.post('/devices', device(token));
    return token;
  } catch {
    return null;
  }
}

/** Interrupteur « Recevoir des notifications push » activé : autorisation, puis inscription aux annonces (et au dossier). */
export async function enablePush(connected: boolean): Promise<TokenResult> {
  const res = await pushToken(true);
  if (!res.token) return res;
  try {
    await publicApi.post('/devices', device(res.token));
    if (connected) await clientApi.post('/push', { token: res.token, platform: Platform.OS });
  } catch {
    return { token: null, reason: 'error' };
  }
  await setPref('push', 'on');
  return res;
}

/** Interrupteur coupé : plus d'annonces ni de notifications du dossier sur ce téléphone. */
export async function disablePush(connected: boolean) {
  await setPref('push', 'off');
  const token = await prefs.get(KEYS.pushToken);
  if (!token) return;
  await Promise.all([
    publicApi.post('/devices/remove', { token }).catch(() => {}),
    connected ? clientApi.post('/push/remove', { token }).catch(() => {}) : null,
  ]);
}

/** Au démarrage et quand la ville préférée ou la langue change : met à jour l'inscription aux annonces (sans rien demander). */
export async function syncDevice() {
  if (getPrefs().push !== 'on') return;
  const { token } = await pushToken(false);
  if (token) await publicApi.post('/devices', device(token)).catch(() => {});
}

export async function unregisterPush() {
  const token = await prefs.get(KEYS.pushToken);
  await prefs.remove(KEYS.pushToken);
  Notifications.setBadgeCountAsync(0).catch(() => {});
  return token;
}

/** Écran de l'espace client ouvert par une notification (données envoyées par services/push.js). */
export const SCREENS: Record<string, string> = {
  messages: '/espace-client/messages',
  paiements: '/espace-client/paiements',
  chantier: '/espace-client/chantier',
  documents: '/espace-client/documents',
  sav: '/espace-client/sav',
};
