/**
 * Session de l'espace client dans l'application (choix du client du 03/11 : 30 jours + Face ID).
 * statut : loading → anon (non connecté) | locked (jeton présent, Face ID / empreinte à valider) | pending (mot de passe
 * provisoire à changer) | ready.
 * - Le jeton (30 jours) vit dans le coffre du téléphone ; le serveur le révoque au changement de mot de passe.
 * - Déverrouillage biométrique à l'ouverture et après 2 minutes en arrière-plan, repli sur le code du téléphone.
 * - Notifications push inscrites une fois la session prête, désinscrites à la déconnexion.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { clientApi, setAuthErrorHandler, setToken } from '@/lib/api';
import { registerForPush, unregisterPush } from '@/lib/push';
import { KEYS, prefs, secure } from '@/lib/storage';
import type { ClientProfile, Dossier } from '@/lib/types';
import { getPrefs } from '@/lib/prefs';

type Status = 'loading' | 'anon' | 'locked' | 'pending' | 'ready';
type Auth = { client: ClientProfile; token?: string };

type SessionValue = {
  status: Status;
  client: ClientProfile | null;
  dossiers: Dossier[];
  selected: Dossier | null;
  select: (id: number) => void;
  login: (login: string, password: string) => Promise<ClientProfile>;
  accept: (auth: Auth) => Promise<void>;
  logout: () => Promise<void>;
  unlock: () => Promise<boolean>;
  refreshMe: () => Promise<void>;
  loadDossiers: () => Promise<Dossier[]>;
  biometric: { available: boolean; enabled: boolean; label: string; setEnabled: (on: boolean) => Promise<boolean> };
  /** Message de la dernière déconnexion forcée (« session expirée »). */
  notice: string | null;
};

const SessionContext = createContext<SessionValue | null>(null);

async function biometricInfo() {
  if (Platform.OS === 'web') return { available: false, label: 'Face ID' };
  try {
    const [hw, enrolled, types] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync(), LocalAuthentication.supportedAuthenticationTypesAsync()]);
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    if (Platform.OS === 'ios') return { available: hw && enrolled, label: face ? 'Face ID' : 'Touch ID' };
    // Android : la fenêtre du système choisit elle-même la méthode (empreinte, visage ou code). Beaucoup de téléphones ne
    // prêtent pas le visage aux applications (constat du client du 06/11 : empreinte demandée, visage enregistré) : le
    // libellé ne promet donc le visage que si c'est la seule méthode du téléphone.
    return { available: hw && enrolled, label: face && finger ? 'l’empreinte ou le visage' : face ? 'la reconnaissance faciale' : 'l’empreinte digitale' };
  } catch { return { available: false, label: 'Face ID' }; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bio, setBio] = useState({ available: false, enabled: false, label: 'Face ID' });
  const [notice, setNotice] = useState<string | null>(null);
  const backgroundAt = useRef<number | null>(null);
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const loadDossiers = useCallback(async () => {
    const list = await clientApi.get<Dossier[]>('/dossiers');
    setDossiers(list);
    const stored = Number(await prefs.get(KEYS.dossier)) || null;
    setSelectedId(prev => {
      const want = prev ?? stored;
      return list.some(d => d.id === want) ? want : list[0]?.id ?? null;
    });
    return list;
  }, []);

  const reset = useCallback(async (message: string | null = null) => {
    setToken(null);
    await secure.remove(KEYS.token);
    queryClient.removeQueries({ queryKey: ['client'] });
    setClient(null);
    setDossiers([]);
    setSelectedId(null);
    setNotice(message);
    setStatus('anon');
  }, [queryClient]);

  const accept = useCallback(async ({ client: c, token }: Auth) => {
    if (token) { setToken(token); await secure.set(KEYS.token, token); }
    setClient(c);
    setNotice(null);
    if (c.must_change_password) { setStatus('pending'); return; }
    await loadDossiers();
    setStatus('ready');
    registerForPush().catch(() => {});
  }, [loadDossiers]);

  /** Ouvre la session à partir du jeton gardé (après Face ID le cas échéant). */
  const resume = useCallback(async () => {
    try {
      const r = await clientApi.get<{ client: ClientProfile }>('/me');
      await accept({ client: r.client });
    } catch (e: any) {
      if (e?.status === 401) await reset('Votre session a expiré : reconnectez-vous.');
      else { setStatus('ready'); } // hors ligne : l'écran affiche ses données en cache et propose de réessayer
    }
  }, [accept, reset]);

  const unlock = useCallback(async () => {
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Déverrouiller votre espace client SIIPAF', cancelLabel: 'Annuler', fallbackLabel: 'Utiliser le code' });
      if (!r.success) return false;
    } catch { return false; }
    setStatus('loading');
    await resume();
    return true;
  }, [resume]);

  // Démarrage : jeton gardé → verrou biométrique ou reprise directe
  useEffect(() => {
    (async () => {
      const [saved, info, bioPref] = await Promise.all([secure.get(KEYS.token), biometricInfo(), secure.get(KEYS.biometric)]);
      const enabled = info.available && bioPref !== '0';
      setBio({ available: info.available, enabled, label: info.label });
      if (!saved) { setStatus('anon'); return; }
      setToken(saved);
      if (enabled) setStatus('locked');
      else await resume();
    })();
  }, [resume]);

  // Session expirée ou mot de passe à changer, signalés par n'importe quel appel
  useEffect(() => {
    setAuthErrorHandler(reason => {
      if (reason === 'password') setStatus('pending');
      else reset('Votre session a expiré : reconnectez-vous.');
    });
  }, [reset]);

  // Verrou après 2 minutes en arrière-plan
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background' || next === 'inactive') { if (backgroundAt.current == null) backgroundAt.current = Date.now(); return; }
      if (next === 'active') {
        const away = backgroundAt.current ? Date.now() - backgroundAt.current : 0;
        backgroundAt.current = null;
        // Délai choisi dans Paramètres (0 : à chaque retour dans l'application)
        if (bio.enabled && statusRef.current === 'ready' && away > getPrefs().lockDelay * 60 * 1000) setStatus('locked');
      }
    });
    return () => sub.remove();
  }, [bio.enabled]);

  const login = useCallback(async (loginValue: string, password: string) => {
    const r = await clientApi.post<Auth>('/login', { login: loginValue.trim(), password });
    queryClient.removeQueries({ queryKey: ['client'] });
    await accept(r);
    return r.client;
  }, [accept, queryClient]);

  const logout = useCallback(async () => {
    const pushToken = await unregisterPush();
    try { await clientApi.post('/logout', pushToken ? { push_token: pushToken } : {}); } catch { /* déjà déconnecté */ }
    await reset(null);
  }, [reset]);

  const refreshMe = useCallback(async () => {
    try { const r = await clientApi.get<{ client: ClientProfile }>('/me'); setClient(r.client); } catch { /* géré par le gestionnaire d'erreurs */ }
  }, []);

  const select = useCallback((id: number) => { setSelectedId(id); prefs.set(KEYS.dossier, String(id)); }, []);

  const setBiometric = useCallback(async (on: boolean) => {
    if (on) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: `Activer ${bio.label} pour votre espace client` }).catch(() => ({ success: false }));
      if (!r.success) return false;
    }
    await secure.set(KEYS.biometric, on ? '1' : '0');
    setBio(b => ({ ...b, enabled: on }));
    return true;
  }, [bio.label]);

  const value = useMemo<SessionValue>(() => ({
    status, client, dossiers, selected: dossiers.find(d => d.id === selectedId) || dossiers[0] || null, select,
    login, accept, logout, unlock, refreshMe, loadDossiers, notice,
    biometric: { ...bio, setEnabled: setBiometric },
  }), [status, client, dossiers, selectedId, select, login, accept, logout, unlock, refreshMe, loadDossiers, notice, bio, setBiometric]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => {
  const v = useContext(SessionContext);
  if (!v) throw new Error('SessionProvider manquant');
  return v;
};
