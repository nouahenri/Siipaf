/* ============================================================
   SIIPAF — Grille de prix du dashboard, commune aux pages Projets (promotions) et Lotissements :
   tableau des prix (équivalent en euros, formule Diaspora) et bouton « Infos & réservation » de chaque ligne,
   qui ouvre le formulaire de contact pré-rempli (projet, type de bien ; le budget est repris de la grille
   par js/contact.js).
============================================================ */
(function () {
  var EUR = 655.957; // parité fixe du franc CFA
  var DIASPORA_MONTHS = 36; // formule Diaspora : sans apport, 36 mensualités
  var ASK = 'Infos & réservation';
  var DIASPORA_SUFFIX = ' — formule Diaspora';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' '); }
  function fcfa(n) { return num(n) + ' FCFA'; }
  function eur(n) { return num(n / EUR) + ' €'; }
  function surface(s) { s = String(s || '').trim(); return /^\d+(?:[.,]\d+)?$/.test(s) ? s + ' m²' : s; }
  function offerName(o) { return [o.label, o.designation].filter(Boolean).join(' '); }
  /**
   * Nom d'une ligne tel qu'il part dans le formulaire : plusieurs lignes du même nom (« Terrain nu » en
   * 400, 500 et 600 m²) se distinguent par leur surface : « Terrain nu 600 m² ».
   */
  function lineName(o, offers) {
    var name = offerName(o);
    var twins = (offers || []).filter(function (x) { return offerName(x) === name; }).length;
    return twins > 1 && o.surface ? name + ' ' + surface(o.surface) : name;
  }
  function contactHref(slug, bien) {
    return 'contact.html?projet=' + encodeURIComponent(slug) + (bien ? '&bien=' + encodeURIComponent(bien) : '');
  }
  function askLink(slug, bien) {
    return '<a class="btn-ask-row" href="' + esc(contactHref(slug, bien)) + '" aria-label="' + esc(ASK + ' : ' + bien) + '">' +
      '<span>' + ASK + '</span><i class="fas fa-arrow-right" aria-hidden="true"></i></a>';
  }

  /** Tableau des prix d'un projet ; chaque ligne a son bouton « Infos & réservation ». */
  function priceTable(offers, slug) {
    return '<div class="pricing-table-wrap"><table class="pricing-table">' +
      '<thead><tr><th>Type de bien</th><th>Surface</th><th>Prix FCFA</th><th>Prix EUR</th><th class="th-ask"><span class="sr-only">Demande</span></th></tr></thead><tbody>' +
      offers.map(function (o) {
        var name = offerName(o), line = lineName(o, offers);
        var premium = /haut standing|duplex|penthouse|prestige/i.test(name);
        var row = o.price_fcfa != null
          ? '<tr' + (premium ? ' class="hs-row"' : '') + '><td>' + esc(name) + '</td><td>' + esc(surface(o.surface) || '—') + '</td>' +
            '<td class="price-cell">' + num(o.price_fcfa) + '</td><td>' + eur(o.price_fcfa) + '</td><td class="td-ask">' + askLink(slug, line) + '</td></tr>'
          : '';
        if (o.diaspora_price_fcfa) {
          row += '<tr class="diaspora-row"><td>↳ Option Diaspora' + (o.designation ? ' ' + esc(o.designation) : '') + '</td><td>—</td>' +
            '<td class="price-cell">' + num(o.diaspora_price_fcfa) + '</td><td>' + num(o.diaspora_price_fcfa / DIASPORA_MONTHS) + ' F/mois</td>' +
            '<td class="td-ask">' + askLink(slug, line + DIASPORA_SUFFIX) + '</td></tr>';
        }
        return row;
      }).join('') +
      '</tbody></table></div>';
  }

  /**
   * Budget pré-rempli à partir du type de bien demandé et de la grille du projet :
   * « 9 210 000 FCFA » ; « … — formule Diaspora » : prix total et mensualité,
   * « 11 210 000 FCFA (311 389 F/mois sur 36 mois) ». Vide si la grille n'a pas cette ligne.
   */
  function budgetFor(offers, bien) {
    var b = String(bien || '').trim();
    if (!b) return '';
    var diaspora = b.slice(-DIASPORA_SUFFIX.length) === DIASPORA_SUFFIX;
    var name = (diaspora ? b.slice(0, -DIASPORA_SUFFIX.length) : b).toLowerCase();
    var o = (offers || []).filter(function (x) { return lineName(x, offers).toLowerCase() === name; })[0]
      || (offers || []).filter(function (x) { return offerName(x).toLowerCase() === name; })[0];
    if (!o) return '';
    if (diaspora) {
      return o.diaspora_price_fcfa
        ? fcfa(o.diaspora_price_fcfa) + ' (' + num(o.diaspora_price_fcfa / DIASPORA_MONTHS) + ' F/mois sur ' + DIASPORA_MONTHS + ' mois)'
        : '';
    }
    return o.price_fcfa != null ? fcfa(o.price_fcfa) : '';
  }

  window.SiipafOffers = {
    ASK: ASK, DIASPORA_MONTHS: DIASPORA_MONTHS, DIASPORA_SUFFIX: DIASPORA_SUFFIX,
    esc: esc, num: num, fcfa: fcfa, eur: eur, surface: surface, offerName: offerName, lineName: lineName,
    contactHref: contactHref, askLink: askLink, priceTable: priceTable, budgetFor: budgetFor,
  };
})();
