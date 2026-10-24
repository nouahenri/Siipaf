/**
 * Contenu du site géré dans le dashboard (rubrique « Contenu du site ») :
 * diaporama et bandeau de l'accueil, chiffres clés, coordonnées sur toutes les pages, textes de chaque section (Éditorial).
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

  // Éditorial (Contenu du site › Éditorial) : textes, boutons, listes et sections masquées de chaque page.
  // Les éléments portent leur clé dans le HTML (data-edit…) ; seules les valeurs modifiées dans le dashboard arrivent.
  function isKeptNode(n) { return n.nodeType === 1 && (n.tagName === 'SMALL' || (n.tagName === 'I' && /\bfa/.test(n.className))); }
  function isBlank(n) { return n.nodeType === 3 && !n.nodeValue.trim(); }
  function attrsOf(el) {
    return el ? Array.prototype.map.call(el.attributes, function (a) { return /^data-edit/.test(a.name) ? '' : ' ' + a.name + '="' + esc(a.value) + '"'; }).join('') : '';
  }
  // *mot* : partie en couleur ; **mot** : gras ; [texte](lien) : lien ; retour à la ligne : <br>
  function markup(v, el) {
    var em = attrsOf(el.querySelector('em')), strong = attrsOf(el.querySelector('strong, b')), link = el.querySelector('a');
    return esc(v)
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (m, t, h) { return '<a href="' + esc(safeHref(h.replace(/&amp;/g, '&'))) + '"' + (link && link.className ? ' class="' + esc(link.className) + '"' : '') + '>' + t + '</a>'; })
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong' + strong + '>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em' + em + '>$1</em>')
      .replace(/\n/g, '<br/>');
  }
  // Remplace le texte d'un élément en gardant ses pictogrammes et ses précisions <small> (mêmes nœuds : leurs propres textes restent éditables)
  function setText(el, v) {
    var kids = Array.prototype.slice.call(el.childNodes), i = 0, j = kids.length - 1, lead = [], trail = [];
    while (i < kids.length && (isKeptNode(kids[i]) || isBlank(kids[i]))) { if (isKeptNode(kids[i])) lead.push(kids[i]); i++; }
    while (j >= i && (isKeptNode(kids[j]) || isBlank(kids[j]))) { if (isKeptNode(kids[j])) trail.unshift(kids[j]); j--; }
    var spaceAfter = lead.length && i > 0 && isBlank(kids[i - 1]);
    var spaceBefore = trail.length && j < kids.length - 1 && isBlank(kids[j + 1]);
    var html = markup(String(v), el);
    while (el.firstChild) el.removeChild(el.firstChild);
    lead.forEach(function (n) { el.appendChild(n); });
    if (spaceAfter) el.appendChild(document.createTextNode(' '));
    var box = document.createElement('span');
    box.innerHTML = html;
    while (box.firstChild) el.appendChild(box.firstChild);
    if (spaceBefore) el.appendChild(document.createTextNode(' '));
    trail.forEach(function (n) { el.appendChild(n); });
  }
  // Bouton ou lien : libellé (dans son <span> s'il en a un) et adresse
  function setLink(el, v) {
    if (v == null) return;
    var label = typeof v === 'string' ? v : v.label;
    var span = null;
    Array.prototype.forEach.call(el.childNodes, function (n) { if (n.nodeType === 1 && n.tagName === 'SPAN' && !span) span = n; });
    var direct = Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    if (label != null) setText(span && !direct ? span : el, label);
    if (typeof v === 'object' && v.href && el.tagName === 'A') el.setAttribute('href', safeHref(v.href));
  }
  function setField(el, v) { if (el.tagName === 'A' || el.tagName === 'BUTTON') setLink(el, v); else setText(el, v); }
  // Liste : le premier élément d'origine sert de modèle (pictogramme, classes) ; on peut en ajouter, en retirer, les réordonner
  function setList(box, items) {
    var originals = Array.prototype.filter.call(box.children, function (c) { return c.matches('[data-edit-li]') || c.querySelector('[data-edit-li]'); });
    if (!originals.length || !Array.isArray(items)) return;
    var model = originals[0].cloneNode(true), anchor = originals[originals.length - 1].nextSibling;
    originals.forEach(function (c) { box.removeChild(c); });
    items.forEach(function (it, n) {
      var item = model.cloneNode(true);
      var field = item.matches('[data-edit-li]') ? item : item.querySelector('[data-edit-li]');
      setField(field, it);
      if (n) box.insertBefore(document.createTextNode('\n'), anchor);
      box.insertBefore(item, anchor);
    });
  }
  function applyEditorial(ed) {
    if (!ed) return;
    var texts = ed.texts || {}, hidden = ed.hidden || [];
    var page = document.body.getAttribute('data-edit-page');
    if (page && texts[page + '.meta.title']) document.title = texts[page + '.meta.title'];
    var desc = document.querySelector('meta[name="description"]');
    if (page && desc && texts[page + '.meta.description']) desc.setAttribute('content', texts[page + '.meta.description']);
    Array.prototype.forEach.call(document.querySelectorAll('[data-edit-section], [data-edit-card]'), function (el) {
      if (hidden.indexOf(el.getAttribute('data-edit-section') || el.getAttribute('data-edit-card')) !== -1) el.hidden = true;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-edit]'), function (el) {
      var v = texts[el.getAttribute('data-edit')];
      if (v != null && v !== '') try { setField(el, v); } catch (e) { /* on garde le texte d'origine */ }
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-edit-list]'), function (el) {
      var v = texts[el.getAttribute('data-edit-list')];
      if (Array.isArray(v)) try { setList(el, v); } catch (e) {}
    });
    if (window.AOS && typeof window.AOS.refreshHard === 'function') window.AOS.refreshHard();
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
        // L'éditorial d'abord : les coordonnées (applySite) s'appliquent ensuite aussi aux textes modifiés
        try { applyEditorial(c.editorial); } catch (e) {}
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
