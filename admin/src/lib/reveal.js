import { useEffect } from 'react';

/**
 * Fait apparaître les cartes au fil du défilement : chaque `.card` reçoit la classe `in`
 * quand elle entre à l'écran, ce qui lance son fondu et les animations de ses graphiques.
 * Les nouvelles cartes (changement de page, chargement) sont observées automatiquement.
 */
export function useRevealOnScroll(root, deps = []) {
  useEffect(() => {
    const host = root.current;
    if (!host) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      host.querySelectorAll('.card').forEach(el => el.classList.add('in'));
      return undefined;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    const watch = () => host.querySelectorAll('.card:not(.in):not([data-reveal])').forEach(el => { el.dataset.reveal = '1'; io.observe(el); });
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(host, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
