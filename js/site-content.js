/**
 * Contenu du site géré dans le dashboard (rubrique « Contenu du site ») :
 * diaporama et bandeau de l'accueil, chiffres clés, coordonnées sur toutes les pages.
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
    var grid = document.querySelector('.stats-bar .stats-grid');
    if (!grid || !stats || !stats.items || !stats.items.length) return;
    grid.innerHTML = stats.items.map(function (s, i) {
      return (i ? '<div class="stat-sep"></div>' : '') +
        '<div class="stat-item"><span class="stat-num">' + esc(s.value) + '</span>' +
        (s.unit ? '<span class="stat-unit">' + esc(s.unit) + '</span>' : '') + '<p>' + esc(s.label) + '</p></div>';
    }).join('');
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
        try { applyImages(c.images); } catch (e) {}
      })
      .catch(function () {})
      .then(function () { clearTimeout(timer); startHero(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
