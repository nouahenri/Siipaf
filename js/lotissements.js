/**
 * Page Lotissements : les projets de type « lotissement » (dashboard › Projets › Type de projet), et eux seuls :
 * les promotions immobilières sont sur la page Projets. Grille de cartes, puis fiche détaillée d'un lotissement
 * (lotissements.html#slug) : chiffres clés, tableau des prix avec « Infos & réservation » (js/offers.js),
 * plan interactif, « Localiser le site ».
 */
(function () {
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  var O = window.SiipafOffers;
  var list = document.getElementById('lotissementsList');
  var detail = document.getElementById('lotDetail');
  var intro = document.querySelector('.lots-intro');
  var soon = document.getElementById('lotsSoon');
  if (!list || !O) return;
  var esc = O.esc;

  var LOCAL_IMG = { yamoussoukro: 1, ahoutoue: 1, riviera: 1, bingerville: 1, cly: 1 };
  function cover(p) {
    if (p.cover) return API + p.cover;
    return LOCAL_IMG[p.slug] ? 'images/projets/proj-' + p.slug + '.jpg' : 'images/hero/hero-3-ahoutoue.jpg';
  }
  function stockOf(p) {
    var lots = p.lots || {};
    return {
      total: Object.keys(lots).reduce(function (n, k) { return n + lots[k]; }, 0),
      free: (lots.disponible || 0) + (lots.desistement || 0),
    };
  }
  function offersOf(p) { return (p.offers || []).filter(function (o) { return o.price_fcfa != null || o.diaspora_price_fcfa; }); }
  function lowest(p) {
    var prices = offersOf(p).map(function (o) { return o.price_fcfa; }).filter(Boolean);
    return prices.length ? Math.min.apply(null, prices) : null;
  }
  // Surfaces des lots de la grille : « 400–600 m² »
  function areas(p) {
    var a = offersOf(p).map(function (o) { var m = String(o.surface || '').match(/(\d+(?:[.,]\d+)?)/); return m ? Math.round(Number(m[1].replace(',', '.'))) : null; }).filter(Boolean);
    if (!a.length) return '';
    var lo = Math.min.apply(null, a), hi = Math.max.apply(null, a);
    return (lo === hi ? lo : lo + '–' + hi) + ' m²';
  }

  // Chiffres clés d'un lotissement, en miniature : lots, disponibles, livraison ou prix d'entrée
  function card(p) {
    var s = stockOf(p), from = lowest(p);
    var stock = s.total
      ? '<div class="lot-stock"><strong>' + s.free + '</strong> lot' + (s.free > 1 ? 's' : '') + ' disponible' + (s.free > 1 ? 's' : '') + ' sur ' + s.total +
        '<div class="lot-stock-bar" aria-hidden="true"><span style="width:' + Math.round((s.free / s.total) * 100) + '%"></span></div></div>'
      : '';
    var stats = [
      s.total && ['fas fa-th-large', String(s.total), 'Lots'],
      s.total && ['fas fa-check-circle', String(s.free), 'Disponibles'],
      p.delivery ? ['fas fa-clock', p.delivery, 'Livraison']
        : from && ['fas fa-tag', Math.round(from / 1e6 * 10) / 10 + ' M', 'FCFA dès'],
    ].filter(Boolean);
    var mini = stats.length ? '<ul class="prog-card-stats">' + stats.map(function (x) {
      return '<li><i class="' + x[0] + '" aria-hidden="true"></i><b>' + esc(x[1]) + '</b><small>' + x[2] + '</small></li>';
    }).join('') + '</ul>' : '';
    var action = p.has_plan
      ? '<a class="btn btn-primary btn-sm" href="plan-interactif.html?projet=' + encodeURIComponent(p.slug) + '"><span>Plan interactif</span><i class="fas fa-map-marked-alt"></i></a>'
      : '<a class="btn-plan-soon" href="' + esc(O.contactHref(p.slug)) + '"><i class="fas fa-clock"></i> Plan bientôt en ligne — être informé</a>';
    return '<article class="lot-card prog-card">' +
      '<a class="lot-card-img" href="#' + esc(p.slug) + '" tabindex="-1" aria-hidden="true" style="background-image:url(\'' + esc(cover(p)) + '\')">' +
        '<span class="lot-card-tag">Lotissement</span>' +
        (p.city ? '<span class="lot-card-city"><i class="fas fa-map-marker-alt"></i> ' + esc(p.city) + '</span>' : '') +
      '</a>' +
      '<div class="lot-card-body">' +
        '<h3><a href="#' + esc(p.slug) + '">' + esc(p.name) + '</a></h3>' +
        (p.tagline ? '<p class="prog-card-desc">' + esc(p.tagline) + '</p>' : (p.location ? '<p class="prog-card-desc">' + esc(p.location) + '</p>' : '')) +
        mini +
        (from ? '<div class="prog-card-price">À partir de <strong>' + O.fcfa(from) + '</strong></div>' : '') +
        '<p class="prog-card-terms"><i class="fas fa-hand-holding-usd" aria-hidden="true"></i> ' + esc(O.termsLine(p)) + '</p>' +
        O.documentsHtml(p, true) +
        stock +
        // Projet localisé (GPS) : « Localiser le site » ajouté après l'affichage (js/project-map.js)
        '<div class="card-actions" data-locate="' + esc(p.slug) + '">' +
          '<a class="btn btn-primary btn-sm" href="#' + esc(p.slug) + '"><span>Découvrir</span><i class="fas fa-arrow-right" aria-hidden="true"></i></a>' +
          '<a class="btn btn-ask btn-sm" href="' + esc(O.contactHref(p.slug)) + '"><span>Réserver</span></a>' +
          action +
        '</div>' +
      '</div></article>';
  }

  // Fiche détaillée d'un lotissement (même habillage que les fiches de la page Projets)
  function sheet(p) {
    var s = stockOf(p), from = lowest(p), surf = areas(p), offers = offersOf(p);
    var place = [p.location, p.location && p.city && p.location.indexOf(p.city) !== -1 ? '' : p.city].filter(Boolean).join(', ');
    // Chiffres clés saisis dans la fiche projet du dashboard, puis ceux calculés (lots, surfaces, livraison)
    var own = (p.key_figures || []).map(function (x) { return [x.icon, x.value, x.label]; });
    var has = function (re) { return own.some(function (x) { return re.test(x[2]); }); };
    var info = own.concat([
      s.total && ['fas fa-th-large', String(s.total), 'Lots'],
      s.total && ['fas fa-check-circle', String(s.free), 'Disponibles'],
      surf && !has(/surface|superficie/i) && ['fas fa-ruler-combined', surf, 'Surfaces'],
      p.delivery && !has(/livraison/i) && ['fas fa-clock', p.delivery, 'Livraison'],
      !p.delivery && from && ['fas fa-tag', O.fcfa(from), 'À partir de'],
    ]).filter(Boolean);
    return '<div class="lot-detailbar"><a class="prog-back" href="#"><i class="fas fa-arrow-left" aria-hidden="true"></i> Tous les lotissements</a></div>' +
      '<div class="proj-block lot-sheet">' +
        '<div class="proj-hero" style="background-image:url(\'' + esc(cover(p)) + '\')"><div class="proj-hero-overlay"></div><div class="proj-hero-content">' +
          '<div class="proj-tag">' + esc(p.project_type || 'Lotissement') + '</div><h2 tabindex="-1">' + esc(p.name) + '</h2>' +
          (place ? '<p><i class="fas fa-map-marker-alt"></i> ' + esc(place) + '</p>' : '') +
          (p.tagline ? '<p class="proj-desc">' + esc(p.tagline) + '</p>' : '') +
        '</div></div>' +
        '<div class="proj-body">' +
          (info.length ? '<div class="proj-info-grid">' + info.map(function (x) {
            return '<div class="pinfo-card"><i class="' + esc(x[0]) + '"></i><span>' + esc(x[1]) + '</span><small>' + esc(x[2]) + '</small></div>';
          }).join('') + '</div>' : '') +
          O.termsHtml(p) +
          O.amenitiesHtml(p.amenities) +
          (p.description ? '<p class="prog-detail-text">' + esc(p.description) + '</p>' : '') +
          O.documentsHtml(p) +
          (offers.length ? '<h4 class="pricing-title">Tableau des Prix</h4>' + O.priceTable(offers, p.slug, p) : '') +
          '<div class="proj-footer-btns">' +
            (p.has_plan ? '<a class="btn btn-primary btn-plan" href="plan-interactif.html?projet=' + encodeURIComponent(p.slug) + '"><span>Plan interactif</span><i class="fas fa-map-marked-alt" aria-hidden="true"></i></a>' : '') +
            '<a class="btn ' + (p.has_plan ? 'btn-ask' : 'btn-primary') + '" href="' + esc(O.contactHref(p.slug)) + '"><span>Réserver ce lotissement</span><i class="fas fa-arrow-right"></i></a>' +
            '<a href="financement.html" class="btn-link"><i class="fas fa-info-circle"></i> Options de financement</a>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  var lotissements = [];
  var baseTitle = document.title;
  function show(initial) {
    var slug = decodeURIComponent(location.hash.slice(1));
    var p = lotissements.filter(function (x) { return x.slug === slug; })[0];
    detail.hidden = !p;
    list.hidden = !!p || !lotissements.length;
    if (intro) intro.hidden = !!p;
    if (soon) soon.hidden = !!p || !!lotissements.length;
    if (!p) { detail.innerHTML = ''; document.title = baseTitle; return; }
    detail.innerHTML = sheet(p);
    if (window.SiipafMap && window.SiipafMap.canLocate(p)) {
      detail.querySelector('.proj-hero-content').appendChild(window.SiipafMap.button(p, true));
      var btns = detail.querySelector('.proj-footer-btns');
      btns.insertBefore(window.SiipafMap.button(p), btns.querySelector('.btn-link'));
    }
    document.title = p.name + ' — SIIPAF SA';
    var top = detail.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: Math.max(0, top), behavior: initial ? 'auto' : 'smooth' });
    if (!initial) detail.querySelector('h2').focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', function () { show(false); });

  fetch(API + '/api/public/projects', { credentials: 'omit' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (projects) {
      lotissements = projects.filter(function (p) { return p.category === 'lotissement'; });
      list.innerHTML = lotissements.map(card).join('');
      // Pas encore de lotissement : invitation à être informé de l'ouverture des prochains
      if (soon && !lotissements.length) {
        soon.innerHTML = '<div class="lots-empty"><i class="fas fa-map-marked-alt"></i><h3>Nos prochains lotissements arrivent</h3>' +
          '<p>Laissez-nous vos coordonnées : vous serez parmi les premiers informés de l’ouverture des lots et de leur plan interactif.</p>' +
          '<a class="btn btn-primary" href="contact.html?projet=Lotissement"><span>Être informé en priorité</span><i class="fas fa-arrow-right"></i></a></div>';
      }
      if (window.SiipafMap) {
        list.querySelectorAll('.card-actions[data-locate]').forEach(function (row) {
          var p = lotissements.filter(function (x) { return x.slug === row.getAttribute('data-locate'); })[0];
          if (p && window.SiipafMap.canLocate(p)) row.appendChild(window.SiipafMap.button(p));
        });
      }
      show(true);
    })
    .catch(function () {
      list.innerHTML = '<div class="lots-empty"><i class="fas fa-wifi"></i><h3>Liste momentanément indisponible</h3>' +
        '<p>Réessayez dans quelques instants ou contactez-nous directement.</p><a class="btn btn-primary" href="contact.html"><span>Nous contacter</span></a></div>';
    });
})();
