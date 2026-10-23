/**
 * Plan de masse interactif (plan-interactif.html?projet=slug[&lot=code]).
 * Lots colorés selon leur statut, zoom et déplacement (souris, molette, doigts), recherche d'un lot,
 * fiche du lot avec pré-réservation de 7 jours ou demande d'information.
 */
(function () {
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  var app = document.getElementById('planApp');
  if (!app) return;
  var params = new URLSearchParams(location.search);
  var slug = params.get('projet');

  // Palette des statuts (identique au dashboard, lisible par les daltoniens)
  var STATUS = {
    disponible: { label: 'Disponible', color: '#2E9E5B' },
    desistement: { label: 'Disponible (désistement)', color: '#0B6BA8' },
    option: { label: 'Pré-réservé', color: '#A16207' },
    reserve: { label: 'Réservé', color: '#6D28D9' },
    vendu: { label: 'Vendu', color: '#9F1239' },
    bloque: { label: 'Non commercialisé', color: '#8A8F98' },
  };
  var ORDER = ['disponible', 'desistement', 'option', 'reserve', 'vendu', 'bloque'];

  var state = { project: null, plan: null, lots: [], selected: null, hidden: {}, scale: 1, x: 0, y: 0, offers: {} };
  var el = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return n == null ? null : new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA'; }
  function num(n) { return new Intl.NumberFormat('fr-FR').format(n); }
  // Lotissement → page Lotissements ; promotion immobilière → page Projets
  function isLotissement() { return !state.project || state.project.category === 'lotissement'; }
  function backLink() {
    return isLotissement()
      ? { href: 'lotissements.html', label: 'Lotissements', cta: 'Voir les lotissements' }
      : { href: 'projets.html' + (state.project ? '#' + encodeURIComponent(state.project.slug) : ''), label: 'Promotions immobilières', cta: 'Voir nos programmes' };
  }
  function fail(title, text) {
    var back = backLink();
    app.innerHTML = '<div class="lots-empty"><i class="fas fa-map"></i><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
      '<a class="btn btn-primary" href="' + back.href + '"><span>' + back.cta + '</span></a></div>';
  }

  // Équipements, commodités à proximité, avancement de la viabilisation, documents du bien et conditions de paiement
  // (fiche projet et Paramètres du dashboard)
  var VIAB_ICON = { fait: 'fa-check-circle', en_cours: 'fa-hard-hat', prevu: 'fa-clock' };
  var DOC_ICON = { fait: 'fa-check-circle', en_cours: 'fa-hourglass-half', prevu: 'fa-clock' };
  function fcfa(n) { return Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA'; }
  function features(p) {
    var blocks = [];
    if (p.viabilisation && p.viabilisation.length) {
      blocks.push('<div class="plan-feature"><h3><i class="fas fa-road"></i> Viabilisation</h3><ul class="viab-list">' + p.viabilisation.map(function (v) {
        return '<li class="viab-' + esc(v.state) + '"><i class="fas ' + (VIAB_ICON[v.state] || 'fa-clock') + '"></i><span>' + esc(v.label) + '</span><b>' + esc(v.state_label) + '</b></li>';
      }).join('') + '</ul></div>');
    }
    if (p.documents && p.documents.length) {
      blocks.push('<div class="plan-feature"><h3><i class="fas fa-file-signature"></i> Documents du bien</h3><ul class="viab-list">' + p.documents.map(function (d) {
        return '<li class="viab-' + esc(d.state) + '"><i class="fas ' + (DOC_ICON[d.state] || 'fa-clock') + '"></i><span>' + esc(d.label) + '</span><b>' + esc(d.state_label) + '</b></li>';
      }).join('') + '</ul></div>');
    }
    if (p.balance_months) {
      blocks.push('<div class="plan-feature"><h3><i class="fas fa-hand-holding-usd"></i> Conditions de paiement</h3><ul class="viab-list">' +
        (p.deposit_fcfa ? '<li><i class="fas fa-coins"></i><span>Acompte</span><b>' + esc(fcfa(p.deposit_fcfa)) + '</b></li>' : '') +
        '<li><i class="fas fa-calendar-alt"></i><span>Délai de solde</span><b>' + esc(p.balance_months + ' mois') + '</b></li></ul></div>');
    }
    if (p.amenities && p.amenities.length) {
      blocks.push('<div class="plan-feature"><h3><i class="fas fa-swimming-pool"></i> Équipements</h3><ul class="feature-tags">' + p.amenities.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>');
    }
    if (p.commodites && p.commodites.length) {
      blocks.push('<div class="plan-feature"><h3><i class="fas fa-map-signs"></i> À proximité</h3><ul class="feature-tags">' + p.commodites.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>');
    }
    return blocks.length ? '<section class="plan-features" aria-label="Le projet">' + blocks.join('') + '</section>' : '';
  }

  if (!slug) return fail('Aucun projet choisi', 'Choisissez un lotissement pour ouvrir son plan.');

  fetch(API + '/api/public/projects/' + encodeURIComponent(slug), { credentials: 'omit' })
    .then(function (r) { if (r.status === 404) throw new Error('404'); if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (p) {
      state.project = p;
      (p.offers || []).forEach(function (o) { state.offers[o.id] = o; });
      document.title = 'Plan interactif — ' + p.name + ' | SIIPAF';
      document.getElementById('planTitle').textContent = p.name;
      document.getElementById('planCrumb').textContent = p.name;
      document.getElementById('planSub').textContent = [p.city, p.location].filter(Boolean).join(' · ');
      // Projet localisé (GPS) : carte et itinéraire sous le titre (js/project-map.js)
      if (window.SiipafMap && window.SiipafMap.canLocate(p)) document.getElementById('planSub').insertAdjacentElement('afterend', window.SiipafMap.button(p));
      var back = backLink(), crumb = document.querySelector('.plan-breadcrumb a[href="lotissements.html"]');
      if (crumb) { crumb.href = back.href; crumb.textContent = back.label; }
      if (!p.plans || !p.plans.length) return fail('Plan bientôt en ligne', 'Le plan de masse de ce projet n’est pas encore publié. Contactez-nous pour connaître les lots disponibles.');
      build();
      selectPlan(p.plans[0]);
      var wanted = params.get('lot');
      if (wanted) { var l = findLot(wanted); if (l) { state.pendingFocus = l; focusLot(l); select(l); } }
    })
    .catch(function (e) {
      if (String(e.message) === '404') fail('Projet introuvable', 'Ce projet n’existe pas ou n’est plus publié.');
      else fail('Plan momentanément indisponible', 'Réessayez dans quelques instants.');
    });

  // ─── Structure de la page ───────────────────────────────
  function build() {
    var p = state.project;
    app.innerHTML =
      '<div class="plan-main">' +
        '<div class="plan-toolbar">' +
          (p.plans.length > 1 ? '<div class="plan-tabs" role="group" aria-label="Plans">' + p.plans.map(function (pl, i) {
            return '<button type="button" class="plan-tab" data-plan="' + i + '">' + esc(pl.name) + '</button>';
          }).join('') + '</div>' : '') +
          '<div class="plan-search"><i class="fas fa-search" aria-hidden="true"></i><input type="search" id="lotSearch" placeholder="N° de lot…" aria-label="Rechercher un lot par son numéro" autocomplete="off"/></div>' +
        '</div>' +
        '<div class="plan-legend" id="planLegend" role="group" aria-label="Filtrer par statut"></div>' +
        '<div class="plan-viewport" id="planViewport">' +
          '<div class="plan-stage" id="planStage"><svg id="planSvg" viewBox="0 0 1 1" preserveAspectRatio="none" role="img"></svg></div>' +
          // Légende indicative posée sur la carte : un carré de couleur par statut
          '<details class="plan-key" id="planKey" open><summary>Légende</summary><ul>' + ORDER.map(function (st) {
            return '<li><i style="background:' + STATUS[st].color + '"></i>' + STATUS[st].label + '</li>';
          }).join('') + '</ul><p>À titre indicatif : disponibilité mise à jour en temps réel, confirmée par un conseiller.</p></details>' +
          '<div class="plan-zoom"><button type="button" data-zoom="in" aria-label="Zoomer"><i class="fas fa-plus"></i></button><button type="button" data-zoom="out" aria-label="Dézoomer"><i class="fas fa-minus"></i></button><button type="button" data-zoom="fit" aria-label="Recentrer"><i class="fas fa-expand"></i></button></div>' +
          '<div class="plan-hint">Molette ou deux doigts : zoom · glisser : déplacer · cliquer un lot : détails</div>' +
          '<div class="plan-tooltip" id="planTip" hidden></div>' +
        '</div>' +
        features(p) +
        '<details class="lot-list" id="lotList"><summary>Liste des lots disponibles</summary><div class="lot-list-wrap"><table class="lot-list-table"><thead><tr><th>Lot</th><th>Îlot</th><th>Surface</th><th>Prix</th></tr></thead><tbody id="lotListBody"></tbody></table></div></details>' +
      '</div>' +
      '<aside class="lot-panel" id="lotPanel" aria-live="polite"></aside>';
    // Image de fond du plan : créée ici et insérée sous les lots seulement quand le plan en a une
    var img = document.createElement('img');
    img.id = 'planImg';
    img.alt = '';
    img.decoding = 'async';
    document.getElementById('planStage').prepend(img);
    // Sur téléphone la légende démarre repliée pour laisser la place à la carte
    if (window.matchMedia && window.matchMedia('(max-width: 600px)').matches) document.getElementById('planKey').removeAttribute('open');
    el = {
      viewport: document.getElementById('planViewport'), stage: document.getElementById('planStage'), img: img,
      svg: document.getElementById('planSvg'), tip: document.getElementById('planTip'), legend: document.getElementById('planLegend'),
      panel: document.getElementById('lotPanel'), search: document.getElementById('lotSearch'), listBody: document.getElementById('lotListBody'),
    };
    Array.prototype.forEach.call(app.querySelectorAll('.plan-tab'), function (b) {
      b.addEventListener('click', function () { selectPlan(state.project.plans[Number(b.dataset.plan)]); });
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-zoom]'), function (b) {
      b.addEventListener('click', function () {
        var r = el.viewport.getBoundingClientRect();
        if (b.dataset.zoom === 'fit') fit(); else zoomAt(r.width / 2, r.height / 2, b.dataset.zoom === 'in' ? 1.5 : 1 / 1.5);
      });
    });
    el.search.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var l = findLot(el.search.value);
      Array.prototype.forEach.call(el.svg.querySelectorAll('.found'), function (n) { n.classList.remove('found'); });
      if (l) { focusLot(l); select(l); } else { el.search.setCustomValidity('Aucun lot ne porte ce numéro.'); el.search.reportValidity(); setTimeout(function () { el.search.setCustomValidity(''); }, 2000); }
    });
    setupPanZoom();
    renderPanel();
  }

  function selectPlan(plan) {
    state.plan = plan;
    state.lots = plan.lots.filter(function (l) { return Array.isArray(l.shape) && l.shape.length >= 3; });
    Array.prototype.forEach.call(app.querySelectorAll('.plan-tab'), function (b, i) { b.setAttribute('aria-pressed', String(state.project.plans[i] === plan)); });
    el.img.alt = 'Plan de masse — ' + plan.name;
    el.img.hidden = !plan.image;
    if (plan.image) { el.img.onload = fit; el.img.src = API + plan.image; }
    else { el.img.removeAttribute('src'); fit(); }
    drawLots();
    renderLegend();
    renderList();
    select(null);
  }

  // ─── Lots ───────────────────────────────────────────────
  function centroid(shape) {
    var x = 0, y = 0; shape.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / shape.length, y / shape.length];
  }
  function drawLots() {
    var ratio = (state.plan.height || 1) / (state.plan.width || 1);
    el.svg.setAttribute('aria-label', 'Plan de ' + state.lots.length + ' lots');
    el.svg.innerHTML = state.lots.map(function (l, i) {
      var st = STATUS[l.status] || STATUS.bloque;
      var c = centroid(l.shape);
      var size = Math.max(0.004, Math.sqrt(polyArea(l.shape) / ratio) * 0.32);
      return '<polygon class="plan-lot" data-i="' + i + '" fill="' + st.color + '" points="' + l.shape.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '"></polygon>' +
        '<text class="plan-label" x="' + c[0] + '" y="' + c[1] + '" style="font-size:' + size + 'px" transform="scale(1 1)">' + esc(l.code) + '</text>';
    }).join('');
    // Le viewBox 0–1 est étiré en largeur/hauteur : on corrige les textes pour qu'ils ne soient pas déformés
    Array.prototype.forEach.call(el.svg.querySelectorAll('text'), function (t) {
      var x = Number(t.getAttribute('x')), y = Number(t.getAttribute('y'));
      t.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(1 ' + (1 / ratio) + ') translate(' + (-x) + ' ' + (-y) + ')');
    });
    Array.prototype.forEach.call(el.svg.querySelectorAll('.plan-lot'), function (poly) {
      var lot = state.lots[Number(poly.dataset.i)];
      poly.addEventListener('pointerenter', function (e) { showTip(lot, e); });
      poly.addEventListener('pointermove', function (e) { showTip(lot, e); });
      poly.addEventListener('pointerleave', function () { el.tip.hidden = true; });
      poly.addEventListener('click', function () { if (!state.moved) select(lot); });
    });
    applyFilter();
  }
  function polyArea(s) { var a = 0; for (var i = 0; i < s.length; i++) { var p = s[i], q = s[(i + 1) % s.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); }
  function findLot(code) {
    var c = String(code || '').trim().toLowerCase().replace(/^lot\s*/, '');
    if (!c) return null;
    var all = state.project.plans.reduce(function (a, pl) { return a.concat(pl.lots.filter(function (l) { return l.shape; }).map(function (l) { l._plan = pl; return l; })); }, []);
    var lot = all.find(function (l) { return String(l.code).toLowerCase() === c; });
    if (lot && lot._plan !== state.plan) selectPlan(lot._plan);
    return lot ? state.lots.find(function (l) { return l.id === lot.id; }) : null;
  }

  function renderLegend() {
    var counts = {};
    state.lots.forEach(function (l) { counts[l.status] = (counts[l.status] || 0) + 1; });
    el.legend.innerHTML = ORDER.filter(function (s) { return counts[s]; }).map(function (s) {
      return '<button type="button" class="legend-chip" data-status="' + s + '" aria-pressed="' + String(!state.hidden[s]) + '"><i style="background:' + STATUS[s].color + '"></i>' + STATUS[s].label + ' <b>' + counts[s] + '</b></button>';
    }).join('');
    Array.prototype.forEach.call(el.legend.querySelectorAll('.legend-chip'), function (b) {
      b.addEventListener('click', function () {
        state.hidden[b.dataset.status] = !state.hidden[b.dataset.status];
        b.setAttribute('aria-pressed', String(!state.hidden[b.dataset.status]));
        applyFilter();
      });
    });
  }
  function applyFilter() {
    Array.prototype.forEach.call(el.svg.querySelectorAll('.plan-lot'), function (poly) {
      poly.classList.toggle('dim', !!state.hidden[state.lots[Number(poly.dataset.i)].status]);
    });
  }

  function renderList() {
    var free = state.lots.filter(function (l) { return l.sellable; })
      .sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); });
    el.listBody.innerHTML = free.length ? free.map(function (l) {
      return '<tr data-id="' + l.id + '"><td><strong>' + esc(l.code) + '</strong></td><td>' + esc(l.ilot || '—') + '</td><td>' + (l.surface_m2 ? num(l.surface_m2) + ' m²' : '—') + '</td><td>' + (money(lotPrice(l)) || 'Sur demande') + '</td></tr>';
    }).join('') : '<tr><td colspan="4">Aucun lot disponible sur ce plan pour le moment.</td></tr>';
    document.querySelector('#lotList summary').textContent = 'Liste des lots disponibles (' + free.length + ')';
    Array.prototype.forEach.call(el.listBody.querySelectorAll('tr[data-id]'), function (tr) {
      tr.addEventListener('click', function () { var l = state.lots.find(function (x) { return String(x.id) === tr.dataset.id; }); focusLot(l); select(l); });
    });
  }
  /**
   * Ligne de la grille de prix d'un lot : celle qui lui est rattachée, sinon celle de même surface (comme le
   * dashboard, à 0,5 m² près). Le prix du lot lui-même, s'il est saisi, prime.
   */
  function gridLine(l) {
    var own = state.offers[l.offer_id];
    if (own && own.price_fcfa != null) return own;
    if (!l.surface_m2) return own || null;
    var all = Object.keys(state.offers).map(function (k) { return state.offers[k]; });
    return all.filter(function (o) {
      var m = String(o.surface || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
      return o.price_fcfa != null && m && Math.abs(Number(m[0]) - l.surface_m2) < 0.5;
    })[0] || own || null;
  }
  function lotPrice(l) { var o = gridLine(l); return l.price_fcfa != null ? l.price_fcfa : (o && o.price_fcfa) || null; }

  function showTip(lot, e) {
    var r = el.viewport.getBoundingClientRect();
    var st = STATUS[lot.status] || STATUS.bloque;
    el.tip.innerHTML = '<b>Lot ' + esc(lot.code) + '</b>' + (lot.surface_m2 ? ' · ' + num(lot.surface_m2) + ' m²' : '') + '<br>' + st.label;
    el.tip.style.left = (e.clientX - r.left) + 'px';
    el.tip.style.top = (e.clientY - r.top) + 'px';
    el.tip.hidden = false;
  }

  // ─── Fiche du lot ───────────────────────────────────────
  function select(lot) {
    state.selected = lot;
    Array.prototype.forEach.call(el.svg.querySelectorAll('.plan-lot'), function (poly) {
      poly.classList.toggle('selected', !!lot && state.lots[Number(poly.dataset.i)] === lot);
    });
    renderPanel();
  }
  function renderPanel(mode, message) {
    var lot = state.selected;
    if (!lot) {
      el.panel.classList.remove('open');
      el.panel.innerHTML = '<div class="lot-panel-empty"><i class="fas fa-hand-pointer"></i>Cliquez sur un lot pour voir sa surface, son prix et le pré-réserver.<br><br>' +
        '<strong style="color:#2E9E5B">En vert</strong> : lots disponibles.</div>';
      return;
    }
    var st = STATUS[lot.status] || STATUS.bloque;
    var p = state.project;
    var offer = gridLine(lot);
    var price = lotPrice(lot);
    var days = p.option_days || 7;
    var O = window.SiipafOffers;
    var terms = O ? O.termsOf(p) : null;
    var diaspora = offer && offer.diaspora_price_fcfa;
    var fact = function (icon, label, value) { return '<div class="lot-fact"><i class="fas ' + icon + '" aria-hidden="true"></i><small>' + label + '</small><b>' + value + '</b></div>'; };
    var chips = function (title, icon, list) {
      if (!list || !list.length) return '';
      return '<div class="lot-block"><h3><i class="fas ' + icon + '" aria-hidden="true"></i>' + title + '</h3><ul class="lot-chips">' + list.map(function (d) {
        var done = !d.state || d.state === 'fait';
        return '<li class="' + (done ? 'is-done' : 'is-pending') + '" title="' + esc(d.state_label || '') + '"><i class="fas ' + (done ? 'fa-check-circle' : 'fa-hourglass-half') + '" aria-hidden="true"></i>' + esc(d.label) +
          (d.state_label && !done ? '<em>' + esc(d.state_label) + '</em>' : '') + '</li>';
      }).join('') + '</ul></div>';
    };

    var html = '<button type="button" class="lot-close" aria-label="Fermer"><i class="fas fa-times"></i></button>' +
      '<div class="lot-head"><h2>Lot ' + esc(lot.code) + '</h2>' +
      '<span class="lot-status" style="background:' + st.color + '1f;color:' + st.color + '"><i style="background:' + st.color + '"></i>' + st.label + '</span></div>' +
      '<p class="lot-project">' + esc(p.name) + (p.city ? ' · ' + esc(p.city) : '') + '</p>' +
      '<div class="lot-facts-grid">' +
        fact('fa-vector-square', 'Surface', lot.surface_m2 ? num(lot.surface_m2) + ' m²' : '—') +
        (lot.ilot ? fact('fa-th-large', 'Îlot', esc(lot.ilot)) : '') +
        (offer && offer.label ? fact('fa-tag', 'Type', esc(O ? O.offerName(offer) : offer.label)) : '') +
      '</div>';

    // Prix : comptant, équivalent en euros, et formule Diaspora (acompte et mensualités du projet)
    if (lot.sellable) {
      html += '<div class="lot-pricing">' + (price
        ? '<div class="lot-price-main"><small>Prix comptant</small><strong>' + money(price) + '</strong>' + (O ? '<span>≈ ' + O.eur(price) + '</span>' : '') + '</div>' +
          (diaspora && O ? '<div class="lot-price-diaspora"><small><i class="fas fa-globe-africa" aria-hidden="true"></i> Formule Diaspora</small><strong>' + money(diaspora) + '</strong><span>' + esc(O.diasporaText(diaspora, terms)) + '</span></div>' : '')
        : '<div class="lot-price-main"><small>Prix</small><strong>Sur demande</strong><span>Un conseiller vous communique le prix de ce lot.</span></div>') +
        (terms ? '<ul class="lot-terms">' + (terms.deposit ? '<li><i class="fas fa-hand-holding-usd" aria-hidden="true"></i>Acompte ' + money(terms.deposit) + '</li>' : '') +
          '<li><i class="fas fa-calendar-alt" aria-hidden="true"></i>Solde en ' + terms.months + ' mois</li></ul>' : '') +
        '</div>';
    }
    html += chips('Documents du bien', 'fa-file-signature', p.documents) + chips('Viabilisation', 'fa-road', p.viabilisation);

    if (message) html += '<div class="lot-msg ' + message.type + '">' + message.text + '</div>';
    else if (mode === 'option' || mode === 'interest') html += form(mode, days);
    else {
      html += '<div class="lot-actions">' +
        (lot.sellable ? '<button type="button" class="lot-btn lot-btn-primary" data-act="option"><i class="fas fa-lock" aria-hidden="true"></i><span>Pré-réserver ' + days + ' jours</span></button>' : '') +
        '<div class="lot-actions-row">' +
          '<button type="button" class="lot-btn" data-act="interest"><i class="fas fa-phone-alt" aria-hidden="true"></i><span>' + (lot.sellable ? 'Être rappelé' : 'Être prévenu') + '</span></button>' +
          '<a class="lot-btn" href="contact.html?rdv=1&projet=' + encodeURIComponent(p.name) + '&lot=' + encodeURIComponent(lot.code) + '"><i class="fas fa-calendar-check" aria-hidden="true"></i><span>Visiter</span></a>' +
          '<a class="lot-btn lot-btn-wa" target="_blank" rel="noopener" href="https://wa.me/2250102279595?text=' + encodeURIComponent('Bonjour, je suis intéressé(e) par le lot ' + lot.code + ' — ' + p.name + '.') + '" title="Écrire sur WhatsApp"><i class="fab fa-whatsapp" aria-hidden="true"></i><span>Écrire sur WhatsApp au sujet du lot ' + esc(lot.code) + '</span></a>' +
        '</div></div>' +
        (lot.sellable ? '<p class="lot-note"><i class="fas fa-info-circle" aria-hidden="true"></i> Pré-réservation gratuite : le lot vous est gardé ' + days + ' jours, le temps qu’un conseiller vous contacte.</p>'
          : '<p class="lot-note"><i class="fas fa-info-circle" aria-hidden="true"></i> Ce lot n’est pas disponible. Laissez vos coordonnées : nous vous prévenons s’il se libère.</p>');
    }
    el.panel.innerHTML = html;
    el.panel.classList.add('open');
    var close = el.panel.querySelector('.lot-close');
    if (close) close.addEventListener('click', function () { select(null); });
    Array.prototype.forEach.call(el.panel.querySelectorAll('[data-act]'), function (b) { b.addEventListener('click', function () { renderPanel(b.dataset.act); }); });
    var f = el.panel.querySelector('form');
    if (f) f.addEventListener('submit', function (e) { e.preventDefault(); send(mode, f); });
    var back = el.panel.querySelector('[data-back]');
    if (back) back.addEventListener('click', function () { renderPanel(); });
  }
  function form(mode, days) {
    return '<form class="lot-form" novalidate>' +
      '<input name="name" required minlength="2" placeholder="Nom et prénoms" autocomplete="name"/>' +
      '<input name="phone" type="tel" placeholder="Téléphone (WhatsApp)" autocomplete="tel"/>' +
      '<input name="email" type="email" placeholder="E-mail" autocomplete="email"/>' +
      (mode === 'interest' ? '<textarea name="message" rows="2" placeholder="Votre question (facultatif)"></textarea>' : '') +
      '<p class="hint">Un téléphone ou un e-mail suffit. Vos coordonnées servent uniquement à vous recontacter au sujet de ce lot.</p>' +
      '<button type="submit" class="btn btn-primary"><span>' + (mode === 'option' ? 'Confirmer la pré-réservation (' + days + ' jours)' : 'Envoyer') + '</span></button>' +
      '<button type="button" class="btn btn-ghost-dark" data-back>Retour</button>' +
      '</form>';
  }
  function send(mode, f) {
    var lot = state.selected;
    var data = { name: f.name.value.trim(), phone: f.phone.value.trim() || undefined, email: f.email.value.trim() || undefined };
    if (f.message && f.message.value.trim()) data.message = f.message.value.trim();
    if (data.name.length < 2) return f.name.reportValidity();
    if (!data.phone && !data.email) { f.phone.setCustomValidity('Indiquez un téléphone ou un e-mail.'); f.phone.reportValidity(); f.phone.setCustomValidity(''); return; }
    var btn = f.querySelector('button[type=submit]');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
    var url = mode === 'option' ? '/api/public/lots/' + lot.id + '/option' : '/api/public/interest';
    if (mode !== 'option') data.lot_id = lot.id;
    fetch(API + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'omit' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || 'Envoi impossible.');
        if (mode === 'option') {
          lot.status = 'option'; lot.sellable = false;
          drawLots(); renderLegend(); renderList(); select(lot);
          var until = new Date(res.j.expires_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
          renderPanel(null, { type: 'ok', text: '<strong>Le lot ' + esc(lot.code) + ' vous est réservé jusqu’au ' + until + '.</strong><br>Un conseiller SIIPAF vous contacte très vite pour la suite.' });
        } else {
          renderPanel(null, { type: 'ok', text: '<strong>Merci, c’est noté.</strong><br>Un conseiller SIIPAF vous recontacte au sujet du lot ' + esc(lot.code) + '.' });
        }
      })
      .catch(function (e) { renderPanel(null, { type: 'err', text: esc(e.message) + ' <br><a href="contact.html">Nous contacter</a>' }); });
  }

  // ─── Zoom et déplacement ────────────────────────────────
  function apply() {
    el.stage.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.scale + ')';
    el.stage.classList.toggle('show-labels', state.scale >= 2.2);
  }
  function fit() {
    var r = el.viewport.getBoundingClientRect();
    var w = state.plan.width || el.img.naturalWidth || 1000, h = state.plan.height || el.img.naturalHeight || 700;
    var base = r.width; // la scène fait la largeur de la vue à l'échelle 1
    el.stage.style.width = base + 'px';
    el.stage.style.height = (base * h / w) + 'px';
    var hh = base * h / w;
    state.scale = Math.min(1, r.height / hh);
    state.x = (r.width - base * state.scale) / 2;
    state.y = (r.height - hh * state.scale) / 2;
    state.min = state.scale;
    apply();
    // Lot demandé dans l'adresse (?lot=) : on le recentre une fois l'image chargée
    if (state.pendingFocus) { var l = state.pendingFocus; state.pendingFocus = null; focusLot(l); }
  }
  function zoomAt(cx, cy, factor) {
    var s = Math.max(state.min || 0.2, Math.min(12, state.scale * factor));
    var k = s / state.scale;
    state.x = cx - (cx - state.x) * k;
    state.y = cy - (cy - state.y) * k;
    state.scale = s;
    apply();
  }
  function focusLot(lot) {
    if (!lot) return;
    var r = el.viewport.getBoundingClientRect();
    var c = centroid(lot.shape);
    var w = parseFloat(el.stage.style.width), h = parseFloat(el.stage.style.height);
    state.scale = Math.max(state.scale, 3);
    state.x = r.width / 2 - c[0] * w * state.scale;
    state.y = r.height / 2 - c[1] * h * state.scale;
    apply();
    var poly = el.svg.querySelector('.plan-lot[data-i="' + state.lots.indexOf(lot) + '"]');
    if (poly) poly.classList.add('found');
  }
  function setupPanZoom() {
    var pointers = {}, last = null, pinch = null;
    el.viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = el.viewport.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });
    el.viewport.addEventListener('dblclick', function (e) { var r = el.viewport.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8); });
    el.viewport.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.plan-zoom, .plan-key')) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      state.moved = false;
      last = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; }
    });
    el.viewport.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      var r = el.viewport.getBoundingClientRect();
      if (ids.length === 2 && pinch) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinch.d);
        pinch.d = d; state.moved = true;
        return;
      }
      var dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) { state.moved = true; el.viewport.classList.add('dragging'); el.tip.hidden = true; }
      if (state.moved) { state.x += dx; state.y += dy; apply(); }
      last = { x: e.clientX, y: e.clientY };
    });
    function up(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      el.viewport.classList.remove('dragging');
      setTimeout(function () { state.moved = false; }, 0);
    }
    el.viewport.addEventListener('pointerup', up);
    el.viewport.addEventListener('pointercancel', up);
    el.viewport.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') up(e); });
    window.addEventListener('resize', function () { if (state.plan) fit(); });
  }
})();
