/**
 * Stockage de l'appareil :
 * - `secure` : coffre du téléphone (Keychain iOS / Keystore Android) pour le jeton de session et le réglage Face ID ;
 *   sur le web (aperçu de développement seulement) : localStorage.
 * - `prefs` : petites préférences non sensibles (identifiant visiteur de Sita, dossier choisi).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const web = Platform.OS === 'web';

export const secure = {
  async get(key: string): Promise<string | null> {
    try {
      if (web) return globalThis.localStorage?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(key);
    } catch { return null; }
  },
  async set(key: string, value: string) {
    try {
      if (web) globalThis.localStorage?.setItem(key, value);
      else await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    } catch { /* coffre indisponible : la session ne survivra pas à la fermeture */ }
  },
  async remove(key: string) {
    try {
      if (web) globalThis.localStorage?.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    } catch { /* déjà absent */ }
  },
};

export const prefs = {
  get: async (key: string) => { try { return await AsyncStorage.getItem(key); } catch { return null; } },
  set: async (key: string, value: string) => { try { await AsyncStorage.setItem(key, value); } catch { /* sans effet */ } },
  remove: async (key: string) => { try { await AsyncStorage.removeItem(key); } catch { /* sans effet */ } },
};

export const KEYS = {
  token: 'siipaf.client.token',
  biometric: 'siipaf.client.biometric',
  pushToken: 'siipaf.push.token',
  visitor: 'siipaf.sita.visitor',
  dossier: 'siipaf.client.dossier',
  sitaThread: 'siipaf.sita.thread',
};
