/**
 * Retour vers l'ERP après une action faite dans le dashboard (ex. créer un programme depuis « Nouveau chantier »).
 * Seule l'ERP du même domaine est acceptée (erp.siipaf.com depuis admin.siipaf.com, erp.localhost en local) :
 * un lien extérieur est ignoré.
 */
export function erpReturn(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const erpHost = window.location.host.replace(/^admin\./, 'erp.');
    return url.protocol === window.location.protocol && url.host === erpHost && erpHost !== window.location.host ? url : null;
  } catch { return null; }
}
