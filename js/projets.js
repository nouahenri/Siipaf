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
