/**
 * Appels à l'API SIIPAF (même serveur que le site et l'espace client web).
 * Chaque requête porte `X-Siipaf-App: mobile` : le serveur classe les prospects « Application mobile » et renvoie à
 * l'espace client un jeton de 30 jours (au lieu du cookie du site), envoyé ensuite en `Authorization: Bearer`.
 */
import { Platform } from 'react-native';
import { API_URL, SITE_URL } from '@/config';

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let token: string | null = null;
let onAuthError: (reason: 'expired' | 'password') => void = () => {};
export const setToken = (t: string | null) => { token = t; };
export const getToken = () => token;
export const setAuthErrorHandler = (fn: typeof onAuthError) => { onAuthError = fn; };

/** En-têtes de l'application ; le jeton du client ne part que vers l'espace client (jamais vers l'API publique). */
export const appHeaders = (withToken = true): Record<string, string> => ({
  'X-Siipaf-App': 'mobile',
  ...(withToken && token ? { Authorization: `Bearer ${token}` } : {}),
});

type Body = Record<string, unknown> | FormData | undefined;

async function request<T>(method: string, url: string, body?: Body, { auth = false } = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${url}`, {
      method,
      headers: { Accept: 'application/json', ...appHeaders(auth), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
      credentials: 'omit',
    });
  } catch {
    throw new ApiError(0, 'Connexion impossible. Vérifiez votre accès à Internet et réessayez.');
  }
  const typeHeader = res.headers.get('content-type') || '';
  const data: any = typeHeader.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
  if (!res.ok) {
    const details = data?.details;
    if (auth && res.status === 401 && !url.startsWith('/api/client/login') && !url.startsWith('/api/client/password/')) onAuthError('expired');
    if (auth && res.status === 403 && details?.code === 'PASSWORD_CHANGE_REQUIRED') onAuthError('password');
    const detail = Array.isArray(details) ? details.map((d: { message: string }) => d.message).join(' · ') : '';
    throw new ApiError(res.status, [data?.error || 'Une erreur est survenue.', detail].filter(Boolean).join(' — '), details);
  }
  return data as T;
}

/** API publique du site : projets, contenu, formulaires, Sita, carrières. */
export const publicApi = {
  get: <T>(url: string) => request<T>('GET', `/api/public${url}`),
  post: <T>(url: string, body?: Body) => request<T>('POST', `/api/public${url}`, body ?? {}),
};

/** API de l'espace client (jeton du client connecté). */
export const clientApi = {
  get: <T>(url: string) => request<T>('GET', `/api/client${url}`, undefined, { auth: true }),
  post: <T>(url: string, body?: Body) => request<T>('POST', `/api/client${url}`, body ?? {}, { auth: true }),
  put: <T>(url: string, body?: Body) => request<T>('PUT', `/api/client${url}`, body ?? {}, { auth: true }),
};

/** Adresse complète d'un média du serveur (« /uploads/… », « /api/client/… »). */
export const apiUrl = (path?: string | null) => (!path ? null : /^https?:/.test(path) ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`);
/** Image d'origine du site (« images/hero/… »). */
export const siteUrl = (path?: string | null) => (!path ? null : /^https?:/.test(path) ? path : `${SITE_URL}/${path.replace(/^\//, '')}`);
/** Média protégé (pièce SAV, document) : source d'image avec le jeton. Sur le web, l'en-tête n'est pas envoyé. */
export const authedSource = (path?: string | null) => {
  const uri = apiUrl(path);
  if (!uri) return null;
  return Platform.OS === 'web' ? { uri } : { uri, headers: appHeaders() };
};
