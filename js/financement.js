/* ============================================================
   SIIPAF — Page Financement : les jauges de paiement des formules se remplissent quand la tuile
   arrive à l'écran (classe « is-in »). Sans animation possible ou souhaitée, elles sont pleines d'emblée.
============================================================ */
(function () {
  var plans = document.querySelectorAll('.fin-plan');
  if (!plans.length) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    plans.forEach(function (p) { p.classList.add('is-in'); });
    return;
  }
  // Les tuiles restent visibles sans JavaScript : l'état « avant apparition » n'existe qu'une fois ce script lancé
  plans[0].parentNode.classList.add('has-reveal');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.35 });
  plans.forEach(function (p) { io.observe(p); });
})();
