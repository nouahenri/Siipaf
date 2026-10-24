/* ============================================================
   SIIPAF — Grille de prix du dashboard, commune aux pages Projets (promotions) et Lotissements :
   tableau des prix (équivalent en euros, formule Diaspora) et bouton « Infos & réservation » de chaque ligne,
   qui ouvre le formulaire de contact pré-rempli (projet, type de bien ; le budget est repris de la grille
   par js/contact.js).
============================================================ */
(function () {
  var EUR = 655.957; // parité fixe du franc CFA
  var DIASPORA_MONTHS = 36; // formule Diaspora par défaut : 36 mensualités, sans acompte
  var ASK = 'Infos & réservation';
  var DIASPORA_SUFFIX = ' — formule Diaspora';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' '); }
  function fcfa(n) { return num(n) + ' FCFA'; }
  function eur(n) { return num(n / EUR) + ' €'; }
  function surface(s) { s = String(s || '').trim(); return /^\d+(?:[.,]\d+)?$/.test(s) ? s + ' m²' : s; }
  /**
   * Conditions de paiement du projet (fiche du dashboard, sinon Paramètres) : acompte et délai de solde.
   * Mensualité Diaspora = (prix − acompte) ÷ délai de solde.
   */
  function termsOf(p) {
    return { deposit: Math.max(0, Number(p && p.deposit_fcfa) || 0), months: Number(p && p.balance_months) || DIASPORA_MONTHS };
  }
  function monthly(price, t) { return Math.max(0, Number(price) - t.deposit) / t.months; }
  /** « Acompte 500 000 FCFA puis 75 000 F/mois × 24 » (sans acompte : « 75 000 F/mois × 24 »). */
  function diasporaText(price, t) {
    return (t.deposit ? 'Acompte ' + fcfa(t.deposit) + ' puis ' : '') + num(monthly(price, t)) + ' F/mois × ' + t.months;
  }
  function offerName(o) { return [o.label, o.designation].filter(Boolean).join(' '); }
  /** Points forts d'une ligne de la grille (fiche projet › Grille de prix › Sur le site), un par ligne. */
  function highlightsOf(o) { return String((o && o.highlights) || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); }
  /** Badge et points forts sous le nom d'une ligne du tableau des prix. */
  function offerExtras(o) {
    var pts = highlightsOf(o);
    return (o.badge ? ' <span class="offer-badge">' + esc(o.badge) + '</span>' : '') +
      (pts.length ? '<small class="offer-points">' + pts.map(esc).join(' · ') + '</small>' : '');
  }

  // Pictogramme d'un équipement d'après son libellé (Paramètres › Équipements) ; coche par défaut
  var AMENITY_ICONS = [
    [/piscine/i, 'fa-swimming-pool'], [/terrain de sport|football|stade/i, 'fa-futbol'], [/sport|gym|fitness/i, 'fa-dumbbell'], [/parking|garage/i, 'fa-car'], [/ascenseur/i, 'fa-elevator'],
    [/cctv|surveillance|vid[ée]o/i, 'fa-video'], [/s[ée]curi|gardien|clôtur/i, 'fa-shield-alt'], [/groupe|[ée]lectrog|[ée]lectri/i, 'fa-plug'],
    [/eau|forage|château/i, 'fa-tint'], [/clim/i, 'fa-snowflake'], [/cuisine/i, 'fa-utensils'], [/domotique|intelligent|wifi|fibre/i, 'fa-wifi'],
    [/jeux|enfant/i, 'fa-child'], [/vert|jardin|parc/i, 'fa-tree'], [/[ée]cole|scolaire|lyc[ée]e|crèche/i, 'fa-graduation-cap'],
    [/m[ée]dical|sant[ée]|clinique|h[ôo]pital|pharmacie/i, 'fa-heartbeat'], [/commerc|march[ée]|boutique|shopping/i, 'fa-shopping-bag'],
    [/concierg/i, 'fa-concierge-bell'], [/pont|route|voie|acc[èe]s/i, 'fa-road'],
    [/culte|mosqu[ée]e|[ée]glise/i, 'fa-place-of-worship'], [/banque/i, 'fa-university'], [/transport|bus/i, 'fa-bus'],
  ];
  function amenityIcon(label) {
    for (var i = 0; i < AMENITY_ICONS.length; i++) if (AMENITY_ICONS[i][0].test(label)) return AMENITY_ICONS[i][1];
    return 'fa-check';
  }
  function amenitiesHtml(list) {
    return (list || []).length ? '<div class="proj-amenities">' + list.map(function (a) {
      return '<div class="am-item"><i class="fas ' + amenityIcon(a) + '" aria-hidden="true"></i><span>' + esc(a) + '</span></div>';
    }).join('') + '</div>' : '';
  }
  /** Chiffres clés de la fiche : [{ icon, value, label }] → grille de cartes. */
  function figuresHtml(list) {
    return (list || []).length ? '<div class="proj-info-grid">' + list.map(function (x) {
      return '<div class="pinfo-card"><i class="' + esc(x.icon) + '" aria-hidden="true"></i><span>' + esc(x.value) + '</span><small>' + esc(x.label) + '</small></div>';
    }).join('') + '</div>' : '';
  }
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

  /** « Acompte 500 000 FCFA · solde en 24 mois » : tuile et fiche du projet (vide sans conditions particulières). */
  function termsLine(p) {
    var t = termsOf(p);
    return (t.deposit ? 'Acompte ' + fcfa(t.deposit) + ' · ' : '') + 'Solde en ' + t.months + ' mois';
  }
  /** Encadré de la fiche : acompte et délai de solde, dans l'habillage des chiffres clés. */
  function termsHtml(p) {
    var t = termsOf(p);
    var card = function (icon, value, label) { return '<div class="pinfo-card"><i class="' + icon + '" aria-hidden="true"></i><span>' + esc(value) + '</span><small>' + label + '</small></div>'; };
    return '<div class="proj-info-grid proj-terms">' + (t.deposit ? card('fas fa-hand-holding-usd', fcfa(t.deposit), 'Acompte') : '') +
      card('fas fa-calendar-alt', t.months + ' mois', 'Délai de solde') + '</div>';
  }
  /** Documents du bien avec leur état (« Titre foncier — Obtenu ») ; `compact` : tuile (libellés seuls). */
  function documentsHtml(p, compact) {
    var docs = (p && p.documents) || [];
    if (!docs.length) return '';
    if (compact) {
      return '<p class="prog-card-docs"><i class="fas fa-file-signature" aria-hidden="true"></i> ' + docs.map(function (d) { return esc(d.label); }).join(' · ') + '</p>';
    }
    return '<div class="proj-docs"><h4 class="pricing-title">Documents du bien</h4><ul>' + docs.map(function (d) {
      return '<li class="doc-' + esc(d.state || 'fait') + '"><i class="fas ' + (d.state === 'fait' ? 'fa-check-circle' : 'fa-hourglass-half') + '" aria-hidden="true"></i>' +
        '<span>' + esc(d.label) + '</span>' + (d.state_label ? '<small>' + esc(d.state_label) + '</small>' : '') + '</li>';
    }).join('') + '</ul></div>';
  }

  /** Tableau des prix d'un projet ; chaque ligne a son bouton « Infos & réservation ». `p` : projet (conditions de paiement). */
  function priceTable(offers, slug, p) {
    var t = termsOf(p);
    return '<div class="pricing-table-wrap"><table class="pricing-table">' +
      '<thead><tr><th>Type de bien</th><th>Surface</th><th>Prix FCFA</th><th>Prix EUR</th><th class="th-ask"><span class="sr-only">Demande</span></th></tr></thead><tbody>' +
      offers.map(function (o) {
        var name = offerName(o), line = lineName(o, offers);
        var premium = /haut standing|duplex|penthouse|prestige/i.test(name);
        var row = o.price_fcfa != null
          ? '<tr' + (premium ? ' class="hs-row"' : '') + '><td>' + esc(name) + offerExtras(o) + '</td><td>' + esc(surface(o.surface) || '—') + '</td>' +
            '<td class="price-cell">' + num(o.price_fcfa) + '</td><td>' + eur(o.price_fcfa) + '</td><td class="td-ask">' + askLink(slug, line) + '</td></tr>'
          : '';
        if (o.diaspora_price_fcfa) {
          row += '<tr class="diaspora-row"><td>↳ Option Diaspora' + (o.designation ? ' ' + esc(o.designation) : '') + '</td><td>—</td>' +
            '<td class="price-cell">' + num(o.diaspora_price_fcfa) + '</td><td class="td-terms">' + esc(diasporaText(o.diaspora_price_fcfa, t)) + '</td>' +
            '<td class="td-ask">' + askLink(slug, line + DIASPORA_SUFFIX) + '</td></tr>';
        }
        return row;
      }).join('') +
      '</tbody></table></div>';
  }

  /**
   * Budget pré-rempli à partir du type de bien demandé et de la grille du projet :
   * « 9 210 000 FCFA » ; « … — formule Diaspora » : prix total et mensualité,
   * « 11 210 000 FCFA (311 389 F/mois sur 36 mois) », acompte compris s'il y en a un. Vide si la grille n'a pas cette ligne.
   */
  function budgetFor(offers, bien, p) {
    var t = termsOf(p);
    var b = String(bien || '').trim();
    if (!b) return '';
    var diaspora = b.slice(-DIASPORA_SUFFIX.length) === DIASPORA_SUFFIX;
    var name = (diaspora ? b.slice(0, -DIASPORA_SUFFIX.length) : b).toLowerCase();
    var o = (offers || []).filter(function (x) { return lineName(x, offers).toLowerCase() === name; })[0]
      || (offers || []).filter(function (x) { return offerName(x).toLowerCase() === name; })[0];
    if (!o) return '';
    if (diaspora) {
      return o.diaspora_price_fcfa
        ? fcfa(o.diaspora_price_fcfa) + ' (' + (t.deposit ? 'acompte ' + fcfa(t.deposit) + ' puis ' : '') + num(monthly(o.diaspora_price_fcfa, t)) + ' F/mois sur ' + t.months + ' mois)'
        : '';
    }
    return o.price_fcfa != null ? fcfa(o.price_fcfa) : '';
  }

  window.SiipafOffers = {
    ASK: ASK, DIASPORA_MONTHS: DIASPORA_MONTHS, DIASPORA_SUFFIX: DIASPORA_SUFFIX,
    esc: esc, num: num, fcfa: fcfa, eur: eur, surface: surface, offerName: offerName, lineName: lineName,
    highlightsOf: highlightsOf, amenityIcon: amenityIcon, amenitiesHtml: amenitiesHtml, figuresHtml: figuresHtml,
    contactHref: contactHref, askLink: askLink, priceTable: priceTable, budgetFor: budgetFor,
    termsOf: termsOf, monthly: monthly, diasporaText: diasporaText, termsLine: termsLine, termsHtml: termsHtml, documentsHtml: documentsHtml,
  };
})();
