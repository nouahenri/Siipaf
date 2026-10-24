/**
 * Contenu du site géré dans le dashboard (rubrique « Contenu du site ») :
 * diaporama et bandeau de l'accueil, chiffres clés, coordonnées sur toutes les pages.
 * Accueil › « Nos projets phares » : nom, type de projet et prix de chaque projet (fiche projet du dashboard).
 * Si l'API ne répond pas, la page garde le contenu écrit dans le HTML.
 */
(function () {
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  var heroEl = document.querySelector('.hero-swiper');
  var heroDelay = 5000;
  var heroStarted = false;

  // Le diaporama démarre une fois son contenu en place (ou après 2,5 s sans réponse de l'API)
  if (heroEl) window.SIIPAF_HERO_PENDING = true;
  function startHero() {
    if (heroStarted || !heroEl || typeof window.Swiper !== 'function') return;
    heroStarted = true;
    new window.Swiper('.hero-swiper', {
      loop: heroEl.querySelectorAll('.swiper-slide').length > 1,
      autoplay: { delay: heroDelay, disableOnInteraction: false },
      effect: 'fade',
      fadeEffect: { crossFade: true },
      speed: 1000,
      pagination: { el: '.swiper-pagination', clickable: true },
      navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  // Liens relatifs du site ou adresses http(s) seulement
  function safeHref(h) { h = String(h || '').trim(); return /^(https?:\/\/|[a-z0-9_.-]+\.html|#|tel:|mailto:)/i.test(h) ? h : '#'; }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  function applyHero(hero) {
    if (!heroEl || !hero || !hero.slides) return;
    var slides = hero.slides.filter(function (s) { return s.active !== false; });
    if (!slides.length) return;
    var wrapper = heroEl.querySelector('.swiper-wrapper');
    // Images d'origine, réutilisées pour une diapositive sans image choisie
    var fallbacks = Array.prototype.map.call(wrapper.querySelectorAll('.slide-img'), function (el) { return el.style.backgroundImage; });
    wrapper.innerHTML = slides.map(function (s, i) {
      var bg = s.media_id ? 'url(\'' + API + '/uploads/by-id/' + Number(s.media_id) + '\')' : (fallbacks[i] || fallbacks[0] || '');
      return '<div class="swiper-slide">' +
        '<div class="slide-img" style="background-image:' + esc(bg).replace(/&#39;/g, "'") + '"></div>' +
        '<div class="slide-content">' +
          (s.badge ? '<div class="slide-badge"><i class="fas fa-certificate"></i> ' + esc(s.badge) + '</div>' : '') +
          '<h2>' + esc(s.title) + (s.title_em ? ' <em>' + esc(s.title_em) + '</em>' : '') + '</h2>' +
          (s.text ? '<p>' + esc(s.text) + '</p>' : '') +
          '<div class="slide-btns">' +
            (s.cta_label ? '<a href="' + esc(safeHref(s.cta_href)) + '" class="btn btn-primary"><span>' + esc(s.cta_label) + '</span><i class="fas fa-arrow-right"></i></a>' : '') +
            (s.cta2_label ? '<a href="' + esc(safeHref(s.cta2_href)) + '" class="btn btn-outline"><span>' + esc(s.cta2_label) + '</span></a>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    if (hero.autoplay_ms) heroDelay = hero.autoplay_ms;
  }

  function applyTicker(ticker) {
    var el = document.querySelector('.ticker');
    if (!el || !ticker || !ticker.items || !ticker.items.length) return;
    var html = ticker.items.map(function (t) {
      return '<a href="' + esc(safeHref(t.href || '#')) + '" class="ticker-link"><i class="fas fa-star"></i> ' + esc(t.text) + '</a>';
    }).join('');
    el.innerHTML = html + html; // doublé pour le défilement continu
  }

  function applyStats(stats) {
    if (!stats || !stats.items || !stats.items.length) return;
    var grid = document.querySelector('.stats-bar .stats-grid');
    if (grid) {
      grid.innerHTML = stats.items.map(function (s, i) {
        return (i ? '<div class="stat-sep"></div>' : '') +
          '<div class="stat-item"><span class="stat-num">' + esc(s.value) + '</span>' +
          (s.unit ? '<span class="stat-unit">' + esc(s.unit) + '</span>' : '') + '<p>' + esc(s.label) + '</p></div>';
      }).join('');
    }
    // Second bandeau de chiffres de l'accueil (sous « Bâtissons ensemble ») : mêmes chiffres, pictogrammes d'origine
    var counters = document.querySelector('.counters-grid');
    if (counters) {
      var icons = Array.prototype.map.call(counters.querySelectorAll('.counter-item > i'), function (i) { return i.className; });
      counters.innerHTML = stats.items.map(function (s, i) {
        return '<div class="counter-item"><i class="' + esc(icons[i] || 'fas fa-star') + '"></i><span class="counter-num">' + esc(s.value) + '</span>' +
          (s.unit ? '<span class="counter-unit">' + esc(s.unit) + '</span>' : '') + '<p>' + esc(s.label) + '</p></div>';
      }).join('');
    }
  }

  // Accueil › « Nos projets phares » : chaque carte (lien projets.html#slug) prend le nom, le type de projet
  // et le prix d'entrée de la fiche projet du dashboard ; l'image reste celle de « Images du site ».
  function money(n) { return Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ') + ' FCFA'; }
  function applyFeatured(projects) {
    Array.prototype.forEach.call(document.querySelectorAll('.projects-preview-grid .pp-card'), function (a) {
      var slug = (a.getAttribute('href') || '').split('#')[1];
      var p = projects.filter(function (x) { return x.slug === slug; })[0];
      if (!p) return;
      var box = a.querySelector('.pp-content');
      var tag = box.querySelector('.pp-tag');
      if (p.project_type) { if (tag) tag.textContent = p.project_type; } else if (tag) tag.remove();
      box.querySelector('h3').textContent = p.name;
      var offers = (p.offers || []).filter(function (o) { return o.price_fcfa != null; });
      var line = box.querySelector('p');
      if (!offers.length) { if (line) line.remove(); return; }
      var o = offers.length === 1 ? offers[0] : null;
      var low = Math.min.apply(null, offers.map(function (x) { return Number(x.price_fcfa); }));
      line.innerHTML = o
        ? [o.label, o.designation].filter(Boolean).map(esc).join(' ') + (o.surface ? ' · ' + esc(/^\d+(?:[.,]\d+)?$/.test(o.surface) ? o.surface + ' m²' : o.surface) : '') + ' · <strong>' + money(low) + '</strong>'
        : 'À partir de <strong>' + money(low) + '</strong>';
    });
  }

  // Coordonnées : remplace partout les valeurs d'origine écrites dans les pages
  var ORIGINAL = { phone: '+225 01 02 27 95 95', phone2: '+225 27 22 20 50 20', address: 'Cocody 2 Plateaux 7ème Tranche, Abidjan', whatsapp: '2250102279595' };
  var ORIGINAL_EMAILS = ['info@siipaf.ci', 'info@siipaf.com'];
  function applySite(site) {
    if (!site) return;
    var swaps = [];
    if (site.phone && site.phone !== ORIGINAL.phone) swaps.push([ORIGINAL.phone, site.phone, digits(ORIGINAL.phone), digits(site.phone)]);
    if (site.phone2 && site.phone2 !== ORIGINAL.phone2) swaps.push([ORIGINAL.phone2, site.phone2, digits(ORIGINAL.phone2), digits(site.phone2)]);
    if (site.address && site.address !== ORIGINAL.address) swaps.push([ORIGINAL.address, site.address]);
    if (site.email) ORIGINAL_EMAILS.forEach(function (e) { if (e !== site.email) swaps.push([e, site.email]); });
    if (!swaps.length && !(site.whatsapp && digits(site.whatsapp) !== ORIGINAL.whatsapp)) return;

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var v = node.nodeValue, nv = v;
      swaps.forEach(function (s) { nv = nv.split(s[0]).join(s[1]); });
      if (nv !== v) node.nodeValue = nv;
    }
    Array.prototype.forEach.call(document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me/"]'), function (a) {
      var h = a.getAttribute('href');
      swaps.forEach(function (s) {
        if (s[2] && digits(h).indexOf(s[2]) !== -1) h = 'tel:+' + s[3];
        if (h === 'mailto:' + s[0]) h = 'mailto:' + s[1];
      });
      if (site.whatsapp && h.indexOf('wa.me/' + ORIGINAL.whatsapp) !== -1) h = h.replace('wa.me/' + ORIGINAL.whatsapp, 'wa.me/' + digits(site.whatsapp));
      a.setAttribute('href', h);
    });
  }

  // Réseaux sociaux du pied de page : ceux renseignés dans le dashboard (Contenu du site › Coordonnées) ;
  // un réseau sans adresse n'est pas affiché (plus de lien mort « # »). Le lien WhatsApp reste tel quel.
  var SOCIALS = [
    ['facebook', 'fa-facebook-f', 'Facebook'], ['instagram', 'fa-instagram', 'Instagram'], ['linkedin', 'fa-linkedin-in', 'LinkedIn'],
    ['tiktok', 'fa-tiktok', 'TikTok'], ['youtube', 'fa-youtube', 'YouTube'],
  ];
  function applySocials(socials) {
    socials = socials || {};
    Array.prototype.forEach.call(document.querySelectorAll('.footer-social'), function (box) {
      Array.prototype.forEach.call(box.querySelectorAll('a'), function (a) {
        if (a.getAttribute('href') === '#' || a.hasAttribute('data-social')) a.remove();
      });
      var first = box.firstChild;
      SOCIALS.forEach(function (s) {
        var url = String(socials[s[0]] || '').trim();
        if (!/^https?:\/\//i.test(url)) return;
        var a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', s[2]); a.setAttribute('data-social', s[0]);
        a.innerHTML = '<i class="fab ' + s[1] + '"></i>';
        box.insertBefore(a, first);
      });
    });
  }

  function applyImages(images) {
    if (!images) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-media-slot]'), function (el) {
      var image = images[el.getAttribute('data-media-slot')];
      if (!image || !/^\/uploads\/[a-z0-9_.-]+$/i.test(image.url || '')) return;
      var url = API + image.url;
      if (el.tagName === 'IMG') {
        el.src = url;
        if (image.alt) el.alt = image.alt;
      } else {
        el.style.backgroundImage = 'url("' + url + '")';
        // Le chargement différé doit lui aussi utiliser la nouvelle image.
        if (el.hasAttribute('data-bg')) el.setAttribute('data-bg', url);
      }
    });
  }

  function load() {
    var timer = setTimeout(startHero, 2500);
    fetch(API + '/api/public/content', { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (c) {
        try { applyHero(c.hero); } catch (e) { /* on garde le HTML d'origine */ }
        try { applyTicker(c.ticker); } catch (e) {}
        try { applyStats(c.stats); } catch (e) {}
        try { applySite(c.site); } catch (e) {}
        try { applySocials(c.site && c.site.socials); } catch (e) {}
        try { applyImages(c.images); } catch (e) {}
      })
      .catch(function () {})
      .then(function () { clearTimeout(timer); startHero(); });
    if (document.querySelector('.projects-preview-grid')) {
      fetch(API + '/api/public/projects', { credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(applyFeatured)
        .catch(function () { /* cartes écrites dans la page */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
