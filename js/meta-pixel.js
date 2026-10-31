/* ============================================================
   SIIPAF SA — Pixel Meta (mesure des publicités Facebook / Instagram).
   Autonome et discret : le pixel n'est chargé QUE si un identifiant est renseigné et activé dans l'ERP (Marketing › Réglages › Connecteurs Meta)
   et, par défaut, seulement après l'accord du visiteur (petite mention en bas à gauche ; « Ne pas suivre » du navigateur = refus).
   Événements : PageView (chaque page), ViewContent (page d'un programme : ?projet=slug ou #slug), Lead (formulaire envoyé, demande de
   rendez-vous, pré-réservation, coordonnées laissées à Sita) via window.siipafTrack('Lead', { content_name }).
   Aucune donnée personnelle n'est transmise au pixel : jamais de nom, d'e-mail ni de téléphone.
   Configuration : GET /api/public/meta/config → { pixel: { id, consent_required } } ou { pixel: null } (rien ne se charge).
============================================================ */
(function () {
  'use strict';
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  var KEY = 'siipaf_pixel_consent'; // 'oui' | 'non'
  var cfg = null, loaded = false, queue = [];

  function choice() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function remember(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* stockage indisponible : le choix vaut pour cette page */ } }
  function doNotTrack() { return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1'; }

  /** Événement demandé par la page : mis en attente tant que le pixel n'est pas chargé, abandonné si le visiteur refuse. */
  window.siipafTrack = function (event, data) {
    if (cfg && !loaded && choice() === 'non') return;
    if (loaded && window.fbq) { window.fbq('track', event, data || {}); return; }
    if (queue.length < 20) queue.push([event, data]);
  };

  function slug() {
    var q = new URLSearchParams(location.search).get('projet');
    var h = decodeURIComponent(location.hash.slice(1));
    return (q || h || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
  }
  var lastSlug = '';
  function viewContent() {
    var s = slug();
    if (s && s !== lastSlug) { lastSlug = s; window.fbq('track', 'ViewContent', { content_name: s, content_category: 'programme_immobilier' }); }
  }

  function load() {
    if (loaded || !cfg) return;
    loaded = true;
    /* Extrait standard de Meta */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = true; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', String(cfg.id));
    window.fbq('track', 'PageView');
    viewContent();
    window.addEventListener('hashchange', viewContent);
    var pending = queue; queue = [];
    pending.forEach(function (e) { window.fbq('track', e[0], e[1] || {}); });
  }

  function banner() {
    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Mesure d’audience');
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;max-width:320px;padding:12px 14px;background:#fff;color:#222;border:1px solid #ddd;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.15);font:13px/1.4 system-ui,sans-serif';
    var p = document.createElement('p');
    p.style.cssText = 'margin:0 0 8px';
    p.textContent = 'SIIPAF mesure l’efficacité de ses publicités avec le pixel Meta. Acceptez-vous ce suivi ? Le site fonctionne de la même façon si vous refusez.';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px';
    function btn(label, primary, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = 'cursor:pointer;padding:6px 12px;border-radius:6px;border:1px solid ' + (primary ? '#b3262d' : '#bbb') + ';background:' + (primary ? '#b3262d' : '#fff') + ';color:' + (primary ? '#fff' : '#222') + ';font:inherit';
      b.addEventListener('click', function () { box.remove(); fn(); });
      return b;
    }
    row.appendChild(btn('Accepter', true, function () { remember('oui'); load(); }));
    row.appendChild(btn('Refuser', false, function () { remember('non'); queue = []; }));
    box.appendChild(p); box.appendChild(row);
    document.body.appendChild(box);
  }

  function start() {
    if (!cfg.consent_required) { load(); return; }
    var c = choice();
    if (doNotTrack() || c === 'non') { queue = []; return; }
    if (c === 'oui') { load(); return; }
    if (document.body) banner(); else document.addEventListener('DOMContentLoaded', banner);
  }

  fetch(API + '/api/public/meta/config', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : { pixel: null }; })
    .then(function (c) { if (c && c.pixel && c.pixel.id && /^\d{5,30}$/.test(String(c.pixel.id))) { cfg = c.pixel; start(); } })
    .catch(function () { /* hors ligne ou serveur indisponible : aucun pixel, le site n'est pas affecté */ });
})();
