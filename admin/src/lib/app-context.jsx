import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);
const ToastContext = createContext(() => {});

export function AppProvider({ children }) {
  const [session, setSession] = useState({ loading: true, user: null, permissions: [] });
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const toast = useCallback((message, kind = 'ok') => {
    const id = ++nextId.current;
    setToasts(t => [...t, { id, message, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'err' ? 6000 : 3500);
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

  return (
    <AuthContext.Provider value={{ ...session, login, logout, can }}>
      <ToastContext.Provider value={toast}>
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map(t => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.message}</div>)}
        </div>
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
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
