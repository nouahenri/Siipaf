/**
 * Page Lotissements : liste des projets de type « lotissement » (dashboard › Projets › Type de projet),
 * puis les autres projets qui ont un plan de masse interactif publié.
 */
(function () {
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  var list = document.getElementById('lotissementsList');
  var otherWrap = document.getElementById('otherPlans');
  var otherList = document.getElementById('otherPlansList');
  if (!list) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var LOCAL_IMG = { yamoussoukro: 1, ahoutoue: 1, riviera: 1, bingerville: 1, cly: 1 };
  function cover(p) {
    if (p.cover) return API + p.cover;
    return LOCAL_IMG[p.slug] ? 'images/projets/proj-' + p.slug + '.jpg' : 'images/hero/hero-3-ahoutoue.jpg';
  }

  function card(p, tag) {
    var lots = p.lots || {};
    var total = Object.keys(lots).reduce(function (n, k) { return n + lots[k]; }, 0);
    var free = (lots.disponible || 0) + (lots.desistement || 0);
    var stock = total
      ? '<div class="lot-stock"><strong>' + free + '</strong> lot' + (free > 1 ? 's' : '') + ' disponible' + (free > 1 ? 's' : '') + ' sur ' + total +
        '<div class="lot-stock-bar" aria-hidden="true"><span style="width:' + Math.round((free / total) * 100) + '%"></span></div></div>'
      : '';
    var action = p.has_plan
      ? '<a class="btn btn-primary" href="plan-interactif.html?projet=' + encodeURIComponent(p.slug) + '"><span>Voir le plan interactif</span><i class="fas fa-map-marked-alt"></i></a>'
      : '<a class="btn-plan-soon" href="contact.html?projet=' + encodeURIComponent(p.name) + '"><i class="fas fa-clock"></i> Plan bientôt en ligne — être informé</a>';
    return '<article class="lot-card">' +
      '<div class="lot-card-img" style="background-image:url(\'' + esc(cover(p)) + '\')">' +
        '<span class="lot-card-tag">' + esc(tag) + '</span>' +
        (p.city ? '<span class="lot-card-city"><i class="fas fa-map-marker-alt"></i> ' + esc(p.city) + '</span>' : '') +
      '</div>' +
      '<div class="lot-card-body">' +
        '<h3>' + esc(p.name) + '</h3>' +
        (p.tagline ? '<p>' + esc(p.tagline) + '</p>' : (p.location ? '<p>' + esc(p.location) + '</p>' : '')) +
        stock +
        // Projet localisé (GPS) : « Localiser le site » ajouté après l'affichage (js/project-map.js)
        '<div class="card-actions" data-locate="' + esc(p.slug) + '">' + action +
          // Détail du programme (prix, prestations) sur la page Projets
          '<a class="btn btn-ghost-dark" href="projets.html#' + encodeURIComponent(p.slug) + '"><span>Découvrir le programme</span><i class="fas fa-arrow-right" aria-hidden="true"></i></a>' +
        '</div>' +
      '</div></article>';
  }

  fetch(API + '/api/public/projects', { credentials: 'omit' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (projects) {
      var lotissements = projects.filter(function (p) { return p.category === 'lotissement'; });
      var others = projects.filter(function (p) { return p.category !== 'lotissement' && p.has_plan; });
      // Les programmes d'abord ; l'invitation « Nos prochains lotissements arrivent » ferme la page
      list.innerHTML = lotissements.map(function (p) { return card(p, 'Lotissement'); }).join('');
      list.hidden = !lotissements.length;
      if (others.length && otherWrap) {
        otherList.innerHTML = others.map(function (p) { return card(p, 'Promotion immobilière'); }).join('');
        otherWrap.hidden = false;
      }
      var soon = document.getElementById('lotsSoon');
      if (soon && !lotissements.length) {
        soon.innerHTML = '<div class="lots-empty"><i class="fas fa-map-marked-alt"></i><h3>Nos prochains lotissements arrivent</h3>' +
          '<p>Laissez-nous vos coordonnées : vous serez parmi les premiers informés de l’ouverture des lots et de leur plan interactif.</p>' +
          '<a class="btn btn-primary" href="contact.html?projet=Lotissement"><span>Être informé en priorité</span><i class="fas fa-arrow-right"></i></a></div>';
        soon.hidden = false;
      }
      if (window.SiipafMap) {
        document.querySelectorAll('.card-actions[data-locate]').forEach(function (row) {
          var p = projects.find(function (x) { return x.slug === row.getAttribute('data-locate'); });
          if (p && window.SiipafMap.canLocate(p)) row.appendChild(window.SiipafMap.button(p));
        });
      }
    })
    .catch(function () {
      list.innerHTML = '<div class="lots-empty"><i class="fas fa-wifi"></i><h3>Liste momentanément indisponible</h3>' +
        '<p>Réessayez dans quelques instants ou contactez-nous directement.</p><a class="btn btn-primary" href="contact.html"><span>Nous contacter</span></a></div>';
    });
})();
