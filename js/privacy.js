/* ============================================================
   SIIPAF SA — Page Confidentialité (privacy/) : choix du visiteur pour le pixel Meta.
   S'appuie sur js/meta-pixel.js (window.siipafPixelInfo / window.siipafPixelConsent, événement « siipaf:pixel »).
============================================================ */
(function () {
  'use strict';
  var state = document.getElementById('pixelState');
  var accept = document.getElementById('pixelAccept');
  var refuse = document.getElementById('pixelRefuse');
  if (!state || !accept || !refuse) return;

  function render() {
    var info = window.siipafPixelInfo ? window.siipafPixelInfo() : { known: true, active: false, choice: null, do_not_track: false };
    if (!info.known) { state.textContent = 'Lecture de votre choix…'; return; }
    var text;
    if (info.do_not_track) text = 'Votre navigateur envoie le signal « Ne pas suivre » : le pixel Meta ne se charge jamais sur ce site.';
    else if (info.choice === 'oui') text = 'Vous avez accepté le pixel Meta.';
    else if (info.choice === 'non') text = 'Vous avez refusé le pixel Meta : il ne se charge sur aucune page du site.';
    else if (!info.active) text = 'Le pixel Meta n’est pas utilisé actuellement. Votre choix sera appliqué s’il est activé.';
    else if (info.consent_required) text = 'Vous n’avez pas encore fait de choix : le pixel Meta reste inactif tant que vous ne l’acceptez pas.';
    else text = 'Le pixel Meta est actif. Vous pouvez le refuser.';
    state.textContent = text;
    accept.disabled = info.do_not_track || info.choice === 'oui';
    refuse.disabled = info.do_not_track || info.choice === 'non';
    accept.setAttribute('aria-pressed', String(info.choice === 'oui'));
    refuse.setAttribute('aria-pressed', String(info.choice === 'non'));
  }

  function set(v) {
    if (window.siipafPixelConsent) window.siipafPixelConsent(v);
    else try { localStorage.setItem('siipaf_pixel_consent', v); } catch (e) { /* stockage indisponible */ }
    render();
  }
  accept.addEventListener('click', function () { set('oui'); });
  refuse.addEventListener('click', function () { set('non'); });
  document.addEventListener('siipaf:pixel', render);
  render();
  // Script du pixel absent ou API injoignable : on n'attend pas indéfiniment
  setTimeout(function () { if (!window.siipafPixelInfo || !window.siipafPixelInfo().known) { window.siipafPixelInfo = null; render(); } }, 6000);
})();
