/**
 * Liens entrants (siipaf://…) réécrits avant la navigation.
 * siipaf://paiement-retour : retour d'un paiement PayPal (page https://client.siipaf.com/paiement/retour).
 * - application déjà ouverte : aucune navigation, la fenêtre « Régler » reste affichée et son retour guidé
 *   (champ Référence prêt, PaySheet) se déclenche au retour au premier plan ;
 * - application relancée (fermée entre-temps) : écran Paiements de l'espace client.
 * Ne doit jamais lever d'erreur (la documentation Expo Router prévient d'un plantage).
 */
const PAYMENT_RETURN = /^\/?paiement-retour(\/|\?|#|$)/;

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    const route = path.replace(/^siipaf:\/\//i, '/').replace(/^\/+/, '/');
    if (PAYMENT_RETURN.test(route)) return initial ? '/espace-client/paiements' : null;
    return path;
  } catch {
    return initial ? '/' : null;
  }
}
