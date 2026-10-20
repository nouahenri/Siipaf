/** Appels à l'API de l'espace client (même origine : cookie de session httpOnly). */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onAuthError = () => {};
/** Appelé sur 401 (session expirée) ou 403 « mot de passe à changer ». */
export const setAuthErrorHandler = fn => { onAuthError = fn; };

async function request(method, url, body) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(`/api/client${url}`, {
      method,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Connexion impossible. Vérifiez votre accès à Internet et réessayez.');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const details = data?.details;
    if (res.status === 401 && !url.startsWith('/login') && !url.startsWith('/password')) onAuthError('expired');
    if (res.status === 403 && details?.code === 'PASSWORD_CHANGE_REQUIRED') onAuthError('password');
    const detail = Array.isArray(details) ? details.map(d => d.message).join(' · ') : '';
    throw new ApiError(res.status, [data?.error || 'Une erreur est survenue.', detail].filter(Boolean).join(' — '), details);
  }
  return data;
}

export const api = {
  get: url => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  /** Envoi de fichiers (FormData). */
  upload: (url, form) => request('POST', url, form),
};
