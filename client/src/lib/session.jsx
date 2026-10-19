/**
 * Session du client : profil, dossiers, dossier sélectionné et cache des écrans.
 * statut : loading → anon (non connecté) | pending (mot de passe provisoire à changer) | ready
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setAuthErrorHandler } from './api';

const SessionContext = createContext(null);
const STORAGE_KEY = 'siipaf-dossier';

const readStored = () => { try { return Number(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; } };
const writeStored = id => { try { localStorage.setItem(STORAGE_KEY, String(id)); } catch { /* navigation privée */ } };

export function SessionProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [client, setClient] = useState(null);
  const [dossiers, setDossiers] = useState([]);
  const [selectedId, setSelectedId] = useState(readStored);
  const cache = useRef(new Map());

  const loadDossiers = useCallback(async () => {
    const list = await api.get('/dossiers');
    setDossiers(list);
    setSelectedId(prev => (list.some(d => d.id === prev) ? prev : list[0]?.id ?? null));
    return list;
  }, []);

  const accept = useCallback(async c => {
    setClient(c);
    if (c.must_change_password) { setStatus('pending'); return; }
    await loadDossiers();
    setStatus('ready');
  }, [loadDossiers]);

  useEffect(() => {
    api.get('/me').then(r => accept(r.client)).catch(() => setStatus('anon'));
  }, [accept]);

  useEffect(() => {
    setAuthErrorHandler(reason => {
      if (reason === 'password') setStatus('pending');
      else { cache.current.clear(); setClient(null); setStatus('anon'); }
    });
  }, []);

  const login = useCallback(async (code, password) => {
    const r = await api.post('/login', { login: code, password });
    cache.current.clear();
    await accept(r.client);
    return r.client;
  }, [accept]);

  const logout = useCallback(async () => {
    try { await api.post('/logout'); } catch { /* déjà déconnecté */ }
    cache.current.clear();
    setClient(null);
    setDossiers([]);
    setStatus('anon');
  }, []);

  const refreshMe = useCallback(async () => {
    try { const r = await api.get('/me'); setClient(r.client); } catch { /* géré par le gestionnaire d'erreurs */ }
  }, []);

  const select = useCallback(id => { setSelectedId(id); writeStored(id); }, []);

  /** Données mises en cache par clé : l'écran s'affiche aussitôt puis se met à jour. */
  const cached = useCallback(async (key, loader, { force = false } = {}) => {
    if (!force && cache.current.has(key)) return cache.current.get(key);
    const data = await loader();
    cache.current.set(key, data);
    return data;
  }, []);
  const peek = useCallback(key => cache.current.get(key), []);
  const invalidate = useCallback(prefix => {
    for (const k of [...cache.current.keys()]) if (k.startsWith(prefix)) cache.current.delete(k);
  }, []);

  const value = useMemo(() => ({
    status, client, setClient, accept, dossiers, selected: dossiers.find(d => d.id === selectedId) || dossiers[0] || null,
    select, login, logout, refreshMe, loadDossiers, cached, peek, invalidate,
  }), [status, client, accept, dossiers, selectedId, select, login, logout, refreshMe, loadDossiers, cached, peek, invalidate]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

/**
 * Charge une ressource avec le cache de session.
 * Renvoie { data, error, loading, reload }.
 */
export function useResource(key, loader) {
  const { cached, peek } = useSession();
  const [state, setState] = useState(() => ({ data: key ? peek(key) : undefined, error: null, loading: !!key && !peek(key) }));
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async (force = false) => {
    if (!key) return;
    setState(s => ({ ...s, loading: !s.data, error: null }));
    try {
      const data = await cached(key, () => loaderRef.current(), { force });
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState(s => ({ ...s, error, loading: false }));
    }
  }, [key, cached]);

  useEffect(() => {
    const had = key ? peek(key) : undefined;
    setState({ data: had, error: null, loading: !!key && !had });
    // Déjà en cache : affichage immédiat puis rafraîchissement discret
    run(!!had);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...state, reload: () => run(true) };
}
