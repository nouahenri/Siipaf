/**
 * Bandes qui défilent horizontalement (onglets `.tabs`, boutons segmentés `.seg`, filtres `.chips`) : la molette
 * de la souris les fait défiler quand elles débordent, et l'onglet choisi est ramené en vue. Écouteurs délégués
 * sur le document : rien à ajouter dans les écrans. Partagé par le dashboard, l'ERP et l'espace client.
 */
const SELECTOR = '.tabs, .seg, .chips';

export function installScrollers(root = document) {
  if (root.__siipafScrollers) return;
  root.__siipafScrollers = true;
  root.addEventListener('wheel', e => {
    const bar = e.target.closest?.(SELECTOR);
    if (!bar || bar.scrollWidth <= bar.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const before = bar.scrollLeft;
    bar.scrollLeft += e.deltaY;
    if (bar.scrollLeft !== before) e.preventDefault(); // au bout de la bande, la page reprend le défilement
  }, { passive: false });
  root.addEventListener('click', e => {
    const item = e.target.closest?.('.tab, .seg button, .chips button, .chip');
    const bar = item?.closest(SELECTOR);
    if (bar && bar.scrollWidth > bar.clientWidth + 1) item.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  });
}
