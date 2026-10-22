/* ============================================================
   SIIPAF — Localisation d'un projet : fenêtre avec la carte (Google Maps, sans clé) et bouton
   « Itinéraire » qui ouvre la navigation jusqu'au projet (application Maps sur mobile).
   Position GPS saisie dans le dashboard si elle existe, sinon l'adresse du projet (lieu, ville).
   window.SiipafMap.open(project) · .button(project, onDark) · .canLocate(project)
   project : { name, geo: { lat, lng } | null, location, city }
============================================================ */
(function () {
  var modal = null;

  /** Ce que la carte cherche : coordonnées GPS, sinon « lieu, ville, Côte d'Ivoire ». */
  function target(project) {
    if (project.geo) return Number(project.geo.lat).toFixed(6) + ',' + Number(project.geo.lng).toFixed(6);
    // « Ahoutoué — Axe Abidjan–Alépé, 20 min… » : seul le lieu sert à la recherche
    var place = String(project.location || '').split(/\s[—|]\s|\|/)[0].trim();
    var parts = [place, project.city].filter(function (s, i, all) { return s && all.indexOf(s) === i && (i === 0 || place.indexOf(s) === -1); });
    return parts.length ? parts.concat('Côte d’Ivoire').join(', ') : '';
  }
  function canLocate(project) { return !!(project && target(project)); }
  function routeUrl(project) { return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(target(project)); }
  function mapUrl(project) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(target(project)); }
  function embedUrl(project) { return 'https://maps.google.com/maps?q=' + encodeURIComponent(target(project)) + '&z=' + (project.geo ? 15 : 14) + '&output=embed'; }

  function build() {
    modal = document.createElement('div');
    modal.className = 'pmap-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pmap-title');
    modal.innerHTML =
      '<div class="pmap-backdrop" data-close></div>' +
      '<div class="pmap-panel">' +
        '<div class="pmap-head"><h3 id="pmap-title"></h3><button type="button" class="pmap-close" data-close aria-label="Fermer"><i class="fas fa-times"></i></button></div>' +
        '<div class="pmap-frame"><iframe title="Carte du projet" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>' +
        '<div class="pmap-actions">' +
          '<a class="btn btn-primary pmap-route" target="_blank" rel="noopener"><span>Itinéraire</span><i class="fas fa-route"></i></a>' +
          '<a class="btn-link pmap-open" target="_blank" rel="noopener"><i class="fas fa-external-link-alt"></i> Ouvrir dans Google Maps</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) close(); });
  }

  var opener = null;
  function open(project) {
    if (!canLocate(project)) return;
    if (!modal) build();
    opener = document.activeElement;
    modal.querySelector('#pmap-title').textContent = project.name || 'Localisation du projet';
    modal.querySelector('iframe').src = embedUrl(project);
    modal.querySelector('.pmap-route').href = routeUrl(project);
    modal.querySelector('.pmap-open').href = mapUrl(project);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('.pmap-close').focus();
  }
  function close() {
    modal.hidden = true;
    modal.querySelector('iframe').src = 'about:blank';
    document.body.style.overflow = '';
    if (opener && opener.focus) opener.focus();
  }

  /**
   * Bouton « Localiser le site » : ouvre la carte du projet, qui porte le bouton Itinéraire.
   * onDark : version claire pour une photo sombre (en-tête d'un programme).
   */
  function button(project, onDark) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-locate' + (onDark ? ' btn-locate-dark' : '');
    b.setAttribute('aria-label', 'Localiser le site de ' + (project.name || 'ce projet') + ' sur la carte');
    b.innerHTML = '<i class="fas fa-location-crosshairs" aria-hidden="true"></i><span>Localiser le site</span>';
    b.addEventListener('click', function () { open(project); });
    return b;
  }

  window.SiipafMap = { open: open, button: button, canLocate: canLocate, routeUrl: routeUrl, mapUrl: mapUrl };
})();
