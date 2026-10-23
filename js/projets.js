/* ============================================================
   SIIPAF — Page « Nos projets » : grille des programmes, puis détail d'un programme.
   - Les fiches écrites dans projets.html (prix, prestations, images du dashboard) donnent la grille ;
     projets.html#ahoutoue ouvre le détail.
   - L'API ajoute le stock de lots, « Localiser le site » (js/project-map.js), le plan interactif, et les
     prix de la grille du dashboard (équivalent en euros, option Diaspora) quand le projet en a une.
   - Un projet créé dans le dashboard sans fiche écrite reçoit une carte et un détail générés.
   - Les lotissements n'apparaissent pas ici : ils ont leur page (lotissements.html, js/lotissements.js).
   - Grille de prix et boutons « Infos & réservation » : js/offers.js (commun aux deux pages).
   Sans JavaScript, les fiches restent affichées les unes sous les autres.
============================================================ */
(function () {
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  var O = window.SiipafOffers;
  if (!O) return;
  var section = document.getElementById('projects');
  var catalog = document.getElementById('catalogue');
  var grid = document.getElementById('programmesList');
  var main = section && section.querySelector('.proj-main');
  if (!section || !catalog || !grid || !main) return;
  var blocks = Array.prototype.slice.call(main.querySelectorAll('.proj-block'));
  if (!blocks.length) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  // « 9 210 000 FCFA » → 9210000 (premier montant de l'élément)
  function amount(s) {
    var m = String(s).match(/\d{1,3}(?:[\s  .]\d{3})+|\d{5,}/);
    return m ? Number(m[0].replace(/\D/g, '')) : null;
  }
  var num = O.num, fcfa = O.fcfa, eur = O.eur, surface = O.surface, offerName = O.offerName, contactHref = O.contactHref, askLink = O.askLink;
  function imageOf(block) {
    var el = block.querySelector('[data-media-slot]');
    if (!el) return { url: '', slot: '' };
    var inline = (el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/) || [])[1];
    return { url: el.getAttribute('data-bg') || inline || '', slot: el.getAttribute('data-media-slot') };
  }
  function lowestPrice(b) {
    var prices = Array.prototype.map.call(b.querySelectorAll('.price-cell, .pc-price, .phc-price'), function (e) { return amount(e.textContent); })
      .filter(function (n) { return n; });
    return prices.length ? Math.min.apply(null, prices) : null;
  }

  // Chiffres clés de la fiche (Superficie, Livraison, Apport…) : repris en miniature sur la carte
  function statsOf(b) {
    return Array.prototype.map.call(b.querySelectorAll('.proj-info-grid .pinfo-card'), function (c) {
      var i = c.querySelector('i');
      return { icon: i ? i.className : 'fas fa-info', value: text(c.querySelector('span')), label: text(c.querySelector('small')) };
    }).filter(function (x) { return x.value; });
  }
  // Promotion : délais et conditions d'achat d'abord. 3 chiffres au plus.
  var STAT_ORDER = [/livraison/i, /apport/i, /échelonnement|mensualit/i, /surface|superficie/i, /types? de bien/i, /biens|logements/i];
  function pickStats(p) {
    var order = STAT_ORDER;
    var rank = function (x) { for (var k = 0; k < order.length; k++) if (order[k].test(x.label)) return k; return order.length; };
    return p.stats.slice().sort(function (a, b) { return rank(a) - rank(b); }).slice(0, 3);
  }
  function miniStats(p) {
    return pickStats(p).map(function (x) {
      return '<li><i class="' + esc(x.icon) + '" aria-hidden="true"></i><b>' + esc(x.value) + '</b><small>' + esc(x.label) + '</small></li>';
    }).join('');
  }
  function renderStats(p) {
    var el = grid.querySelector('.prog-card[data-slug="' + p.slug + '"] .prog-card-stats');
    if (el) { el.innerHTML = miniStats(p); el.hidden = !el.children.length; }
  }

  // Programmes lus dans les fiches (ordre de la page)
  function fromBlock(b) {
    var marker = b.querySelector('.proj-hero-content .fa-map-marker-alt');
    var place = text(marker && marker.parentNode);
    return {
      slug: b.id, block: b,
      name: text(b.querySelector('.proj-hero-content h2')),
      tag: text(b.querySelector('.proj-tag')),
      place: place,
      city: place.split(/\s[—|-]\s|\||,/)[0].trim(),
      desc: text(b.querySelector('.proj-desc')),
      stats: statsOf(b),
      from: lowestPrice(b),
      image: imageOf(b),
    };
  }
  var programs = blocks.map(fromBlock);

  function card(p) {
    return '<article class="lot-card prog-card" data-slug="' + esc(p.slug) + '">' +
      '<a class="lot-card-img" href="#' + esc(p.slug) + '" tabindex="-1" aria-hidden="true"' +
        (p.image.slot ? ' data-media-slot="' + esc(p.image.slot) + '"' : '') +
        (p.image.url ? ' style="background-image:url(\'' + esc(p.image.url) + '\')"' : '') + '>' +
        (p.tag ? '<span class="lot-card-tag">' + esc(p.tag) + '</span>' : '') +
        (p.city ? '<span class="lot-card-city"><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ' + esc(p.city) + '</span>' : '') +
      '</a>' +
      '<div class="lot-card-body">' +
        '<h3><a href="#' + esc(p.slug) + '">' + esc(p.name) + '</a></h3>' +
        (p.desc ? '<p class="prog-card-desc">' + esc(p.desc) + '</p>' : '') +
        '<ul class="prog-card-stats"' + (p.stats.length ? '' : ' hidden') + '>' + miniStats(p) + '</ul>' +
        '<div class="prog-card-price"' + (p.from ? '' : ' hidden') + '>À partir de <strong>' + (p.from ? fcfa(p.from) : '') + '</strong></div>' +
        '<div class="prog-card-stock"></div>' +
        '<div class="card-actions"><a class="btn btn-primary btn-sm" href="#' + esc(p.slug) + '"><span>Découvrir</span><i class="fas fa-arrow-right" aria-hidden="true"></i></a>' +
          '<a class="btn btn-ask btn-sm" href="' + esc(contactHref(p.slug)) + '"><span>Réserver</span></a></div>' +
      '</div></article>';
  }

  // ── Formulaire de contact pré-rempli : projet et type de bien consulté ──
  /** Bouton sur chaque ligne de prix et chaque carte d'option, « Réserver ce projet » ; relancé après les prix du dashboard. */
  function wireContact(p) {
    var b = p.block;
    Array.prototype.forEach.call(b.querySelectorAll('.pricing-table'), function (t) {
      var head = t.querySelector('thead tr');
      if (head && !head.querySelector('.th-ask')) head.insertAdjacentHTML('beforeend', '<th class="th-ask"><span class="sr-only">Demande</span></th>');
      var last = '';
      Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
        if (tr.querySelector('.td-ask')) return;
        var name = text(tr.cells[0]);
        // « ↳ Option Diaspora 2p » : rattachée au bien de la ligne précédente
        var bien = tr.classList.contains('diaspora-row') ? (last ? last + O.DIASPORA_SUFFIX : name.replace(/^↳\s*/, '')) : (last = name);
        tr.insertAdjacentHTML('beforeend', '<td class="td-ask">' + askLink(p.slug, bien) + '</td>');
      });
    });
    Array.prototype.forEach.call(b.querySelectorAll('.pricing-card'), function (c) {
      var btn = c.querySelector('a.btn');
      if (!btn) return;
      btn.href = contactHref(p.slug, text(c.querySelector('.pc-header')));
      btn.textContent = O.ASK;
    });
    var hero = b.querySelector('.price-hero-card');
    var heroBtn = hero && hero.querySelector('a.btn');
    // « Prendre Rendez-vous » (Riviera) garde la prise de rendez-vous
    if (heroBtn) heroBtn.href = contactHref(p.slug, text(hero.querySelector('.phc-badge')).split(' — ')[0]) + (/rdv=1/.test(heroBtn.getAttribute('href')) ? '&rdv=1' : '');
    Array.prototype.forEach.call(b.querySelectorAll('.proj-footer-btns a'), function (a) {
      if (/^contact\.html/.test(a.getAttribute('href') || '')) a.href = contactHref(p.slug);
    });
  }

  // ── Conditions de paiement et documents du bien (dashboard) : ligne sur la tuile, encadré dans la fiche ──
  function applyTerms(p, api, cardEl) {
    var drop = function (root, sel) { Array.prototype.forEach.call(root.querySelectorAll(sel), function (e) { e.remove(); }); };
    if (cardEl) {
      drop(cardEl, '.prog-card-terms, .prog-card-docs');
      cardEl.querySelector('.prog-card-stock').insertAdjacentHTML('beforebegin',
        '<p class="prog-card-terms"><i class="fas fa-hand-holding-usd" aria-hidden="true"></i> ' + esc(O.termsLine(api)) + '</p>' + O.documentsHtml(api, true));
    }
    var body = p.block.querySelector('.proj-body');
    if (!body) return;
    drop(body, '.proj-terms, .proj-docs');
    var wrap = document.createElement('div');
    wrap.innerHTML = O.termsHtml(api) + O.documentsHtml(api);
    var before = body.querySelector('.pricing-title, .pricing-table-wrap, .pricing-cards-grid, .proj-price-hero, .proj-footer-btns');
    while (wrap.firstChild) body.insertBefore(wrap.firstChild, before || null);
  }

  // ── Prix de la grille du dashboard (tableau : js/offers.js) ──
  // Cartes d'options (Bingerville, C & LY) : chaque ligne de la grille garde l'habillage de la carte à la même place
  function priceCards(offers, old, api) {
    var t = O.termsOf(api);
    return offers.map(function (o, i) {
      var model = old[i] || old[0];
      var badge = model && model.querySelector('.pc-badge');
      var featured = model && /pricing-card-(featured|penthouse)/.test(model.className);
      var btn = model && model.querySelector('.btn');
      return '<div class="' + esc(model ? model.className : 'pricing-card') + '">' +
        (badge ? badge.outerHTML : '') +
        '<div class="pc-header">' + esc(offerName(o)) + '</div>' +
        (o.surface ? '<div class="pc-surface">' + esc(surface(o.surface)) + '</div>' : '') +
        (o.price_fcfa != null ? '<div class="pc-price">' + num(o.price_fcfa) + ' <span>FCFA</span></div><div class="pc-eur">≈ ' + eur(o.price_fcfa) + '</div>' : '') +
        (o.diaspora_price_fcfa ? '<div class="pc-eur">Diaspora : ' + fcfa(o.diaspora_price_fcfa) + ' · ' + esc(O.diasporaText(o.diaspora_price_fcfa, t)) + '</div>' : '') +
        '<a href="contact.html" class="btn ' + (btn ? esc(btn.className.replace(/^btn\s*/, '')) : (featured ? 'btn-white btn-sm' : 'btn-primary btn-sm')) + '">' + (btn ? esc(text(btn)) : 'Réserver') + '</a>' +
        '</div>';
    }).join('');
  }
  /** Remplace les prix écrits par ceux du dashboard, dans la forme de la fiche (tableau, cartes ou prix vedette). */
  function applyOffers(p, offers, api) {
    offers = (offers || []).filter(function (o) { return o.price_fcfa != null || o.diaspora_price_fcfa; });
    if (!offers.length) return;
    var b = p.block, body = b.querySelector('.proj-body');
    if (!body) return;
    var cards = b.querySelector('.pricing-cards-grid');
    var hero = b.querySelector('.proj-price-hero');
    var table = b.querySelector('.pricing-table-wrap');
    if (cards) {
      cards.innerHTML = priceCards(offers, Array.prototype.slice.call(cards.querySelectorAll('.pricing-card')), api);
    } else if (hero && offers.length === 1) {
      var o = offers[0], cardEl = hero.querySelector('.price-hero-card');
      cardEl.querySelector('.phc-badge').textContent = [offerName(o), surface(o.surface)].filter(Boolean).join(' — ');
      cardEl.querySelector('.phc-price').innerHTML = num(o.price_fcfa) + ' <span>FCFA</span>';
      cardEl.querySelector('.phc-eur').textContent = '≈ ' + eur(o.price_fcfa);
    } else if (table) {
      table.outerHTML = O.priceTable(offers, p.slug, api);
    } else {
      var wrap = document.createElement('div');
      wrap.innerHTML = '<h4 class="pricing-title">Tableau des Prix</h4>' + O.priceTable(offers, p.slug, api);
      var before = hero || b.querySelector('.proj-footer-btns');
      while (wrap.firstChild) body.insertBefore(wrap.firstChild, before || null);
      if (hero) hero.remove();
    }
    wireContact(p);
    p.from = lowestPrice(b);
    var priceEl = grid.querySelector('.prog-card[data-slug="' + p.slug + '"] .prog-card-price');
    if (priceEl && p.from) { priceEl.hidden = false; priceEl.querySelector('strong').textContent = fcfa(p.from); }
  }

  // Fiche générée pour un projet du dashboard sans fiche écrite (même habillage que les autres)
  function buildBlock(api) {
    var cover = api.cover ? API + api.cover : 'images/hero/hero-3-ahoutoue.jpg';
    var place = [api.location, api.location && api.city && api.location.indexOf(api.city) !== -1 ? '' : api.city].filter(Boolean).join(', ');
    var lots = api.lots || {};
    var total = Object.keys(lots).reduce(function (n, k) { return n + lots[k]; }, 0);
    var tag = api.project_type || (api.category === 'lotissement' ? 'Lotissement' : 'Promotion immobilière');
    var b = document.createElement('div');
    b.className = 'proj-block';
    b.id = api.slug;
    b.innerHTML =
      '<div class="proj-hero" style="background-image:url(\'' + esc(cover) + '\')"><div class="proj-hero-overlay"></div><div class="proj-hero-content">' +
        '<div class="proj-tag">' + esc(tag) + '</div><h2>' + esc(api.name) + '</h2>' +
        (place ? '<p><i class="fas fa-map-marker-alt"></i> ' + esc(place) + '</p>' : '') +
        ((api.tagline || api.description) ? '<p class="proj-desc">' + esc(api.tagline || api.description) + '</p>' : '') +
      '</div></div>' +
      '<div class="proj-body">' +
        ((api.amenities || []).length ? '<div class="proj-amenities">' + api.amenities.map(function (a) { return '<div class="am-item"><i class="fas fa-check"></i><span>' + esc(a) + '</span></div>'; }).join('') + '</div>' : '') +
        ((api.delivery || total) ? '<div class="proj-info-grid">' +
          (total ? '<div class="pinfo-card"><i class="fas fa-th-large"></i><span>' + total + '</span><small>' + (api.category === 'lotissement' ? 'Lots' : 'Biens') + '</small></div>' : '') +
          (api.delivery ? '<div class="pinfo-card"><i class="fas fa-clock"></i><span>' + esc(api.delivery) + '</span><small>Livraison</small></div>' : '') +
        '</div>' : '') +
        (api.description && api.tagline ? '<p class="prog-detail-text">' + esc(api.description) + '</p>' : '') +
        '<div class="proj-footer-btns">' +
          '<a href="contact.html?projet=' + encodeURIComponent(api.name) + '" class="btn btn-primary"><span>Réserver ce projet</span><i class="fas fa-arrow-right"></i></a>' +
          '<a href="financement.html" class="btn-link"><i class="fas fa-info-circle"></i> Options de financement</a>' +
        '</div>' +
      '</div>';
    main.appendChild(b);
    var p = fromBlock(b);
    p.image = { url: cover, slot: '' };
    p.city = api.city || p.city;
    wireContact(p);
    programs.push(p);
    blocks.push(b);
    grid.insertAdjacentHTML('beforeend', card(p));
    var nav = document.querySelector('.sidebar-nav');
    if (nav) nav.insertAdjacentHTML('beforeend', '<a href="#' + esc(api.slug) + '" class="snav-link"><i class="fas ' + (api.category === 'lotissement' ? 'fa-map-marked-alt' : 'fa-city') + '"></i>' + esc(api.name) + '</a>');
    return p;
  }

  function removeProgram(slug) {
    var i = -1;
    programs.forEach(function (x, k) { if (x.slug === slug) i = k; });
    if (i < 0) return;
    var p = programs.splice(i, 1)[0];
    blocks.splice(blocks.indexOf(p.block), 1);
    p.block.remove();
    var cardEl = grid.querySelector('.prog-card[data-slug="' + slug + '"]');
    if (cardEl) cardEl.remove();
    var link = document.querySelector('.snav-link[href="#' + slug + '"]');
    if (link) link.remove();
  }

  // ── Mise en place : grille visible, fiches en vue détail ──
  programs.forEach(wireContact);
  grid.innerHTML = programs.map(card).join('');
  var sideCta = document.querySelector('.sidebar-cta a');
  catalog.hidden = false;
  section.classList.add('prog-enhanced');
  function prepare(b) {
    // Une fiche masquée ne doit pas attendre une animation d'apparition au défilement
    b.removeAttribute('data-aos');
    var h2 = b.querySelector('.proj-hero-content h2');
    if (h2) h2.setAttribute('tabindex', '-1');
  }
  blocks.forEach(prepare);

  var bar = document.createElement('div');
  bar.className = 'prog-detailbar';
  bar.innerHTML =
    '<a class="prog-back" href="#catalogue"><i class="fas fa-arrow-left" aria-hidden="true"></i> Tous les programmes</a>' +
    '<nav class="prog-step" aria-label="Programme précédent ou suivant">' +
      '<a class="prog-prev" href="#"><i class="fas fa-chevron-left" aria-hidden="true"></i></a>' +
      '<span class="prog-count" aria-live="polite"></span>' +
      '<a class="prog-next" href="#"><i class="fas fa-chevron-right" aria-hidden="true"></i></a>' +
    '</nav>';
  main.insertBefore(bar, main.firstChild);

  var baseTitle = document.title;
  var lastSlug = null;
  function scrollToEl(el) {
    var nav = document.getElementById('navbar');
    var top = el.getBoundingClientRect().top + window.pageYOffset - (nav ? nav.offsetHeight : 80) - 16;
    window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function show(initial) {
    var slug = decodeURIComponent(location.hash.slice(1));
    var i = -1;
    programs.forEach(function (p, k) { if (p.slug === slug) i = k; });
    var p = programs[i];
    section.classList.toggle('is-detail', !!p);
    blocks.forEach(function (b) { b.classList.toggle('is-current', !!p && b === p.block); });
    document.querySelectorAll('.snav-link').forEach(function (l) { l.classList.toggle('active', !!p && l.getAttribute('href') === '#' + p.slug); });

    if (p) {
      var prev = programs[(i - 1 + programs.length) % programs.length], next = programs[(i + 1) % programs.length];
      var a = bar.querySelector('.prog-prev'), z = bar.querySelector('.prog-next');
      a.href = '#' + prev.slug; a.setAttribute('aria-label', 'Programme précédent : ' + prev.name); a.title = prev.name;
      z.href = '#' + next.slug; z.setAttribute('aria-label', 'Programme suivant : ' + next.name); z.title = next.name;
      bar.querySelector('.prog-count').textContent = (i + 1) + ' / ' + programs.length;
      document.title = p.name + ' — SIIPAF SA';
      if (sideCta) sideCta.href = contactHref(p.slug);
      lastSlug = p.slug;
      scrollToEl(section);
      var h2 = p.block.querySelector('.proj-hero-content h2');
      if (h2 && !initial) h2.focus({ preventScroll: true });
    } else {
      document.title = baseTitle;
      if (sideCta) sideCta.href = 'contact.html';
      // Retour à la grille : on retrouve la carte du programme qu'on quittait
      var from = lastSlug && grid.querySelector('.prog-card[data-slug="' + lastSlug + '"]');
      if (from) {
        scrollToEl(from);
        var link = from.querySelector('h3 a');
        if (link) link.focus({ preventScroll: true });
      } else if (!initial && slug === 'catalogue') scrollToEl(catalog);
    }
  }
  window.addEventListener('hashchange', function () { show(false); });
  // Les liens vers un programme (cartes, barre, menu latéral, pied de page) changent l'adresse : le
  // défilement doux de main.js, qui annule les liens « # », ne doit pas les intercepter.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (href === '#catalogue' || programs.some(function (p) { return '#' + p.slug === href; })) e.stopPropagation();
  }, true);
  show(true);

  // ── Données en direct : prix du dashboard, stock, localisation, plan interactif, projets sans fiche ──
  fetch(API + '/api/public/projects', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (all) {
      var added = false;
      // Un lotissement a sa page : retiré d'ici, même s'il a une fiche écrite ; un lien direct y est renvoyé
      var lotissements = all.filter(function (api) { return api.category === 'lotissement'; });
      lotissements.forEach(function (api) { removeProgram(api.slug); });
      var here = decodeURIComponent(location.hash.slice(1));
      if (lotissements.some(function (api) { return api.slug === here; })) { location.replace('lotissements.html#' + encodeURIComponent(here)); return; }
      var list = all.filter(function (api) { return api.category !== 'lotissement'; });
      list.forEach(function (api) {
        var p = programs.filter(function (x) { return x.slug === api.slug; })[0];
        if (!p) { p = buildBlock(api); prepare(p.block); added = true; }
        var cardEl = grid.querySelector('.prog-card[data-slug="' + p.slug + '"]');
        // Ville du dashboard (« Bingerville ») plutôt que le début de l'adresse (« Akouai-Agban »)
        var cityEl = cardEl && cardEl.querySelector('.lot-card-city');
        if (api.city && cityEl) cityEl.innerHTML = '<i class="fas fa-map-marker-alt" aria-hidden="true"></i> ' + esc(api.city);

        applyOffers(p, api.offers, api);
        applyTerms(p, api, cardEl);

        // Stock : biens disponibles sur le total (lots saisis dans le dashboard)
        var lots = api.lots || {};
        var total = Object.keys(lots).reduce(function (n, k) { return n + lots[k]; }, 0);
        var free = (lots.disponible || 0) + (lots.desistement || 0);
        var has = function (re) { return p.stats.some(function (x) { return re.test(x.label); }); };
        if (api.delivery && !has(/livraison/i)) p.stats.push({ icon: 'fas fa-clock', value: api.delivery, label: 'Livraison' });
        // Fiche sans chiffres clés (Riviera, C & LY) : complétée par la grille de prix et le stock du dashboard
        var offers = (api.offers || []).filter(function (o) { return o.price_fcfa != null || o.diaspora_price_fcfa; });
        var kinds = offers.map(offerName).filter(function (n, k, all) { return n && all.indexOf(n) === k; });
        // « T.250m² | H.175m² » : surface habitable (H.), sinon la première surface écrite
        var areas = offers.map(function (o) {
          var m = String(o.surface || '').match(/H\.?\s*(\d+)/i) || String(o.surface || '').match(/(\d+(?:[.,]\d+)?)/);
          return m ? Math.round(Number(m[1].replace(',', '.'))) : null;
        }).filter(Boolean);
        if (areas.length && !has(/surface|superficie/i)) {
          var lo = Math.min.apply(null, areas), hi = Math.max.apply(null, areas);
          p.stats.push({ icon: 'fas fa-ruler-combined', value: (lo === hi ? lo : lo + '–' + hi) + ' m²', label: 'Surface' });
        }
        if (kinds.length && !has(/types?/i)) p.stats.push({ icon: 'fas fa-home', value: String(kinds.length), label: kinds.length > 1 ? 'Types de biens' : 'Type de bien' });
        if (total && !has(/biens$|logements/i)) p.stats.push({ icon: 'fas fa-th-large', value: String(total), label: 'Biens' });
        renderStats(p);
        if (total && cardEl) {
          cardEl.querySelector('.prog-card-stock').innerHTML = '<div class="lot-stock"><strong>' + free + '</strong> bien' + (free > 1 ? 's' : '') +
            ' disponible' + (free > 1 ? 's' : '') + ' sur ' + total +
            '<div class="lot-stock-bar" aria-hidden="true"><span style="width:' + Math.round((free / total) * 100) + '%"></span></div></div>';
        }

        // Rangée d'actions du détail (Réserver, Plan interactif, Localiser le site) ; créée si la fiche n'en a pas
        var btns = p.block.querySelector('.proj-footer-btns');
        if (!btns) {
          var body = p.block.querySelector('.proj-body');
          if (body) {
            btns = document.createElement('div');
            btns.className = 'proj-footer-btns';
            body.appendChild(btns);
          }
        }

        // Plan de masse publié : bouton « Plan interactif » dans le détail
        if (api.has_plan && btns && !btns.querySelector('.btn-plan')) {
          var a = document.createElement('a');
          a.className = 'btn btn-plan';
          a.href = 'plan-interactif.html?projet=' + encodeURIComponent(p.slug);
          a.innerHTML = '<span>Plan interactif</span><i class="fas fa-map-marked-alt" aria-hidden="true"></i>';
          btns.insertBefore(a, btns.children[1] || null);
        }

        // « Localiser le site » (GPS du dashboard, sinon adresse) : sur la carte, dans l'en-tête et les actions du détail
        var where = { name: p.name, geo: api.geo, location: api.location || p.place, city: api.city || p.city };
        if (window.SiipafMap && window.SiipafMap.canLocate(where)) {
          if (cardEl) cardEl.querySelector('.card-actions').appendChild(window.SiipafMap.button(where));
          var hero = p.block.querySelector('.proj-hero-content');
          if (hero && !hero.querySelector('.btn-locate')) hero.appendChild(window.SiipafMap.button(where, true));
          if (btns && !btns.querySelector('.btn-locate')) {
            var plan = btns.querySelector('.btn-plan');
            btns.insertBefore(window.SiipafMap.button(where), plan ? plan.nextSibling : btns.children[1] || null);
          }
        }
      });
      // Fiche écrite sans projet publié dans le dashboard : localisée par l'adresse écrite
      programs.forEach(function (p) {
        if (list.some(function (api) { return api.slug === p.slug; }) || !window.SiipafMap) return;
        var where = { name: p.name, location: p.place, city: p.city };
        var cardEl = grid.querySelector('.prog-card[data-slug="' + p.slug + '"]');
        if (cardEl && window.SiipafMap.canLocate(where)) cardEl.querySelector('.card-actions').appendChild(window.SiipafMap.button(where));
      });
      // Arrivée directe sur un projet sans fiche écrite (projets.html#mon-projet), ou fiche retirée
      if (added || lotissements.length) show(true);
    })
    .catch(function () { /* la page reste complète sans les données en direct */ });
})();
