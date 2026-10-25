// Le dashboard est sur admin.siipaf.com quand l'ERP est sur erp.siipaf.com (admin.localhost en local)
export const dashboardUrl = (path = '') => `${window.location.protocol}//${window.location.host.replace(/^erp\./, 'admin.')}/${path}`;

/** Lien vers une page du dashboard qui ramène ensuite à `back` (chemin de l'ERP) une fois l'action faite. */
export const dashboardWithReturn = (path, back) => `${dashboardUrl(path)}${path.includes('?') ? '&' : '?'}retour=${encodeURIComponent(`${window.location.origin}${back}`)}`;
