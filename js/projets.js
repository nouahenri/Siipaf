/* ============================================================
   SIIPAF — Projets page: sidebar active nav on scroll
============================================================ */
document.addEventListener('DOMContentLoaded', function () {
  const snavLinks = document.querySelectorAll('.snav-link');
  const projBlocks = document.querySelectorAll('.proj-block');

  // Scroll spy for sidebar
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        snavLinks.forEach(l => l.classList.remove('active'));
        const active = document.querySelector(`.snav-link[href="#${id}"]`);
        if (active) active.classList.add('active');
      }
    });
  }, { threshold: 0.3, rootMargin: '-80px 0px -40% 0px' });

  projBlocks.forEach(b => observer.observe(b));

  // Sidebar smooth scroll
  snavLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        window.scrollTo({ top: target.offsetTop - 100, behavior: 'smooth' });
      }
    });
  });

  // Hash on load — scroll to correct project
  if (window.location.hash) {
    setTimeout(() => {
      const target = document.querySelector(window.location.hash);
      if (target) {
        window.scrollTo({ top: target.offsetTop - 100, behavior: 'smooth' });
      }
    }, 600);
  }
});

/* ── Bouton « Plan interactif » pour les projets dont le plan de masse est publié ── */
(function () {
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  fetch(API + '/api/public/projects', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (projects) {
      projects.forEach(function (p) {
        if (!p.has_plan) return;
        var block = document.getElementById(p.slug);
        if (!block) return;
        var btns = block.querySelector('.proj-footer-btns');
        // Certains blocs (grilles de prix) n'ont pas de rangée de boutons : on la crée
        if (!btns) {
          var body = block.querySelector('.proj-body');
          if (!body) return;
          btns = document.createElement('div');
          btns.className = 'proj-footer-btns';
          body.appendChild(btns);
        }
        if (btns.querySelector('.btn-plan')) return;
        var a = document.createElement('a');
        a.className = 'btn btn-plan';
        a.href = 'plan-interactif.html?projet=' + encodeURIComponent(p.slug);
        a.innerHTML = '<span>Plan interactif</span><i class="fas fa-map-marked-alt"></i>';
        btns.insertBefore(a, btns.children[1] || null);
      });
    })
    .catch(function () { /* le bouton n'apparaît simplement pas */ });
})();
