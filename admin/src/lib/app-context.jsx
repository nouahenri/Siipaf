import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);

// Thème d'affichage : « systeme » suit le réglage clair/sombre de l'ordinateur ou du téléphone
const THEME_KEY = 'siipaf-admin-theme';
const readTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'systeme'; } catch { return 'systeme'; } };
function applyTheme(theme) {
  const dark = theme === 'sombre' || (theme === 'systeme' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'sombre' : 'clair';
}
const ToastContext = createContext(() => {});

export function AppProvider({ children }) {
  const [session, setSession] = useState({ loading: true, user: null, permissions: [] });
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const [theme, setThemeState] = useState(readTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* navigation privée */ }
    if (theme !== 'systeme' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('systeme');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
  // Le thème enregistré sur le compte l'emporte à la connexion
  useEffect(() => { if (session.user?.theme) setThemeState(session.user.theme); }, [session.user?.theme]);
  const setTheme = async value => {
    setThemeState(value);
    await api.patch('/auth/preferences', { theme: value });
    setSession(s => ({ ...s, user: s.user && { ...s.user, theme: value } }));
  };

  const toast = useCallback((message, kind = 'ok') => {
    const id = ++nextId.current;
    setToasts(t => [...t, { id, message, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'err' ? 6000 : kind === 'saved' ? 3000 : 3500);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession({ loading: false, user: null, permissions: [] }));
    api.get('/auth/me')
      .then(d => setSession({ loading: false, user: d.user, permissions: d.permissions }))
      .catch(() => setSession({ loading: false, user: null, permissions: [] }));
  }, []);

  const login = async (email, password) => {
    const d = await api.post('/auth/login', { email, password });
    setSession({ loading: false, user: d.user, permissions: d.permissions });
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setSession({ loading: false, user: null, permissions: [] });
  };
  const can = perm => session.permissions.includes('*') || session.permissions.includes(perm);
  // Mot de passe provisoire remplacé (écran ForcePassword) : accès ouvert sans recharger la session
  const markPasswordChanged = () => setSession(s => ({ ...s, user: s.user && { ...s.user, must_change_password: false } }));

  return (
    <AuthContext.Provider value={{ ...session, login, logout, can, theme, setTheme, markPasswordChanged }}>
      <ToastContext.Provider value={toast}>
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map(t => t.kind === 'saved'
            // Accusé d'enregistrement : discret, aux couleurs SIIPAF (encre et or), en bas à droite
            ? <div key={t.id} className="toast toast-saved"><span aria-hidden="true">✓</span>{t.message}</div>
            : <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.message}</div>)}
        </div>
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

/**
 * Accusé d'enregistrement (« ✓ Enregistré », discret, en bas à droite). Après « Enregistrer », une fiche se ferme ou la
 * page revient à la précédente (useSaveAndReturn) ; une page de réglages reste affichée avec ce seul accusé.
 */
export function useSaved() {
  const toast = useContext(ToastContext);
  return useCallback((message = 'Enregistré') => toast(message, 'saved'), [toast]);
}
export const useToast = () => useContext(ToastContext);

/** Charge une ressource et expose { data, loading, error, reload, setData }. */
export function useResource(url, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = useCallback(() => {
    if (!url) return Promise.resolve();
    setState(s => ({ ...s, loading: true }));
    return api.get(url)
      .then(data => setState({ data, loading: false, error: null }))
      .catch(error => setState({ data: null, loading: false, error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: data => setState(s => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })) };
}

/**
 * Page d'édition : après « Enregistrer », retour à la page précédente (ou à `fallback` si on est arrivé
 * directement sur la page) avec l'accusé d'enregistrement.
 */
export function useSaveAndReturn(fallback) {
  const saved = useSaved();
  const navigate = useNavigate();
  return useCallback((message = 'Enregistré') => {
    saved(message);
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else if (fallback) navigate(fallback, { replace: true });
  }, [saved, navigate, fallback]);
}
