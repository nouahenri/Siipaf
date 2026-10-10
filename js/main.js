/* ============================================================
   SIIPAF SA — Main JavaScript
============================================================ */

document.addEventListener('DOMContentLoaded', function () {

  /* ── LOADER ───────────────────────────────────────────── */
  // Masqué dès que le DOM est prêt (max 600 ms) : on n'attend plus le
  // téléchargement de toutes les images.
  const loader = document.getElementById('loader');
  if (loader) {
    const hideLoader = () => loader.classList.add('hidden');
    setTimeout(hideLoader, 600);
    window.addEventListener('load', hideLoader);
  }

  /* ── LAZY BACKGROUNDS ─────────────────────────────────── */
  // Les éléments avec data-bg ne chargent leur image qu'à l'approche du viewport.
  const lazyBgs = document.querySelectorAll('[data-bg]');
  const loadBg = el => {
    el.style.backgroundImage = `url('${el.dataset.bg}')`;
    el.removeAttribute('data-bg');
  };
  if ('IntersectionObserver' in window) {
    const bgObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          loadBg(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { rootMargin: '400px 0px' });
    lazyBgs.forEach(el => bgObserver.observe(el));
  } else {
    lazyBgs.forEach(loadBg);
  }

  /* ── AOS INIT ─────────────────────────────────────────── */
  // Sur mobile, les animations latérales provoquent un débordement horizontal :
  // on les remplace par un fondu vertical.
  if (window.matchMedia('(max-width: 1024px)').matches) {
    document.querySelectorAll('[data-aos="fade-left"], [data-aos="fade-right"]').forEach(el => {
      el.setAttribute('data-aos', 'fade-up');
    });
  }
  if (window.AOS) {
    AOS.init({
      duration: 800,
      once: true,
      offset: 60,
      easing: 'ease-out-cubic',
    });
  }

  /* ── NAVBAR SCROLL ────────────────────────────────────── */
  const navbar = document.getElementById('navbar');
  const backTop = document.getElementById('backToTop');
  let scrollTicking = false;

  function onScroll() {
    const scrolled = window.scrollY > 60;
    if (navbar) navbar.classList.toggle('scrolled', scrolled || document.body.classList.contains('page-inner'));
    if (backTop) backTop.classList.toggle('visible', scrolled);
    scrollTicking = false;
  }

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });

  if (backTop) {
    backTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── HAMBURGER MENU ───────────────────────────────────── */
  const hamburger = document.getElementById('hamburger');
  const navMenu = document.getElementById('navMenu');

  if (hamburger && navMenu) {
    const backdrop = document.createElement('div');
    backdrop.className = 'nav-backdrop';
    document.body.appendChild(backdrop);

    hamburger.setAttribute('aria-label', 'Ouvrir le menu');
    hamburger.setAttribute('aria-controls', 'navMenu');
    hamburger.setAttribute('aria-expanded', 'false');

    const setMenu = open => {
      hamburger.classList.toggle('active', open);
      navMenu.classList.toggle('open', open);
      backdrop.classList.toggle('visible', open);
      document.body.classList.toggle('menu-open', open);
      hamburger.setAttribute('aria-expanded', String(open));
      hamburger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    };

    hamburger.addEventListener('click', () => setMenu(!navMenu.classList.contains('open')));
    backdrop.addEventListener('click', () => setMenu(false));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && navMenu.classList.contains('open')) setMenu(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 1024 && navMenu.classList.contains('open')) setMenu(false);
    });
    navMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => setMenu(false));
    });
  }

  /* ── TYPED TEXT ───────────────────────────────────────── */
  const phrases = [
    'Construction & BTP en Côte d\'Ivoire',
    'Promoteur Immobilier Agréé MCLU',
    'Aménageur Foncier Agréé MCLU',
    'Du logement social au haut standing',
    'Votre réseau immobilier de confiance',
  ];
  const typedEl = document.getElementById('typed-text');
  let pi = 0, ci = 0, deleting = false;

  function typeLoop() {
    const current = phrases[pi];
    if (!deleting) {
      typedEl.textContent = current.substring(0, ci + 1);
      ci++;
      if (ci === current.length) {
        deleting = true;
        setTimeout(typeLoop, 2200);
        return;
      }
    } else {
      typedEl.textContent = current.substring(0, ci - 1);
      ci--;
      if (ci === 0) {
        deleting = false;
        pi = (pi + 1) % phrases.length;
      }
    }
    setTimeout(typeLoop, deleting ? 40 : 75);
  }
  if (typedEl) setTimeout(typeLoop, 1500);

  /* ── PARTICLES ────────────────────────────────────────── */
  const particlesContainer = document.getElementById('particles');
  function createParticle() {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 6 + 2;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      animation-duration:${Math.random() * 15 + 10}s;
      animation-delay:${Math.random() * 10}s;
      opacity:${Math.random() * 0.3 + 0.05};
    `;
    particlesContainer.appendChild(p);
  }
  if (particlesContainer) {
    for (let i = 0; i < 40; i++) createParticle();
  }

  /* ── COUNTERS ─────────────────────────────────────────── */
  function animateCounter(el, target, duration = 2000) {
    let start = 0;
    const step = (timestamp) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    };
    requestAnimationFrame(step);
  }

  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseInt(el.dataset.count);
        if (!el.dataset.counted) {
          el.dataset.counted = 'true';
          animateCounter(el, target);
        }
      }
    });
  }, { threshold: 0, rootMargin: '0px 0px -50px 0px' });

  document.querySelectorAll('[data-count]').forEach(el => {
    el.textContent = el.dataset.count;
    counterObserver.observe(el);
  });

  /* ── PROJECT TABS ─────────────────────────────────────── */
  const tabs = document.querySelectorAll('.ptab');
  const panels = document.querySelectorAll('.proj-panel');

  function switchTab(projId) {
    tabs.forEach(t => t.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`[data-proj="${projId}"]`);
    const panel = document.getElementById(`proj-${projId}`);
    if (tab) tab.classList.add('active');
    if (panel) panel.classList.add('active');
  }

  window.switchTab = switchTab;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.proj));
  });

  /* ── SMOOTH SCROLL FOR ANCHOR LINKS ──────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = 80;
        window.scrollTo({
          top: target.offsetTop - offset,
          behavior: 'smooth',
        });
      }
    });
  });

  /* ── HERO STATS COUNTER ON LOAD ──────────────────────── */
  setTimeout(() => {
    document.querySelectorAll('.hstat-num[data-count]').forEach(el => {
      animateCounter(el, parseInt(el.dataset.count), 1500);
    });
  }, 2400);

  /* ── CONTACT FORM ─────────────────────────────────────── */
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<span>Envoi en cours...</span><i class="fas fa-spinner fa-spin"></i>';
      btn.disabled = true;

      setTimeout(() => {
        btn.innerHTML = '<span>Message envoyé !</span><i class="fas fa-check"></i>';
        btn.style.background = 'linear-gradient(135deg,#25D366,#128C7E)';
        form.reset();
        setTimeout(() => {
          btn.innerHTML = originalHTML;
          btn.disabled = false;
          btn.style.background = '';
        }, 3000);
      }, 1800);
    });
  }

  /* ── ACTIVE NAV ON SCROLL ─────────────────────────────── */
  const sections = document.querySelectorAll('section[id], div[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Ne touche au lien actif que si la section a un lien d'ancre dans le menu
        const active = document.querySelector(`.nav-link[href="#${entry.target.id}"]`);
        if (!active) return;
        navLinks.forEach(link => link.classList.remove('active'));
        active.classList.add('active');
      }
    });
  }, { threshold: 0.4 });

  sections.forEach(s => sectionObserver.observe(s));

  /* ── TICKER DUPLICATION ───────────────────────────────── */
  const ticker = document.querySelector('.ticker');
  if (ticker) {
    const items = ticker.innerHTML;
    ticker.innerHTML = items + items;
  }

  /* ── ACTIVITY CARD TILT ───────────────────────────────── */
  document.querySelectorAll('.activity-card:not(.activity-card-cta)').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `translateY(-8px) rotateX(${-y * 6}deg) rotateY(${x * 6}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });

  /* ── PRICING TABLE ROW HOVER ──────────────────────────── */
  document.querySelectorAll('.pricing-table tbody tr').forEach(row => {
    row.addEventListener('mouseenter', () => {
      row.style.transition = 'background 0.2s';
    });
  });

  console.log('%c SIIPAF SA ', 'background:#C41E2E;color:white;font-size:16px;padding:8px 16px;border-radius:4px;font-weight:bold;');
  console.log('%c Site réalisé avec passion — Promoteur Immobilier Agréé ', 'color:#B8972E;font-size:12px;');
});
