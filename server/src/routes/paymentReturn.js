/**
 * Page de retour après un paiement en ligne (PayPal : « URL de redirection automatique » du lien de paiement).
 * Adresse : https://client.siipaf.com/paiement/retour
 * - sur téléphone, rouvre l'application SIIPAF Mobile (siipaf://paiement-retour) ; l'application retrouve sa fenêtre
 *   « Régler » encore ouverte, avec le champ Référence prêt (src/app/+native-intent.tsx) ;
 * - Android passe par une adresse « intent » : si l'application n'est pas installée, le navigateur ouvre l'espace client ;
 * - un bouton reste affiché si le navigateur bloque l'ouverture automatique, et un lien mène à l'espace client en ligne.
 * Les paramètres ajoutés par PayPal ne sont ni lus ni réaffichés : la déclaration se fait dans l'application.
 */
const crypto = require('crypto');
const express = require('express');
const { clientAppUrl } = require('../config');

const APP_URL = 'siipaf://paiement-retour';
const ANDROID_PACKAGE = 'com.siipaf.com';

function page({ nonce, webUrl }) {
  const intent = `intent://paiement-retour#Intent;scheme=siipaf;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<meta name="theme-color" content="#E30613"/>
<title>Paiement terminé — SIIPAF</title>
<style nonce="${nonce}">
  :root { --bg: #f6f6f7; --card: #fff; --ink: #141414; --ink2: #5b5b60; --line: #e6e6e9; --red: #E30613; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --card: #161618; --ink: #f4f4f5; --ink2: #a1a1a8; --line: #2a2a2e; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px;
    background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 32px 24px; text-align: center; }
  .brand { font-weight: 800; letter-spacing: .08em; color: var(--red); font-size: 14px; }
  .ok { width: 64px; height: 64px; margin: 20px auto 12px; border-radius: 50%; background: rgba(22,163,74,.12); display: flex; align-items: center; justify-content: center; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: var(--ink2); }
  .btn { display: block; padding: 14px 18px; border-radius: 14px; font-weight: 600; text-decoration: none; }
  .primary { background: var(--red); color: #fff; }
  .link { margin-top: 10px; color: var(--ink2); font-size: 14px; }
  [hidden] { display: none; }
</style>
</head>
<body>
<main>
  <div class="brand">SIIPAF</div>
  <div class="ok" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
  <h1>Paiement terminé</h1>
  <p>Merci. Revenez dans l’application SIIPAF pour déclarer ce paiement avec la référence de la transaction : notre service comptable le rattachera à votre dossier.</p>
  <a id="app" class="btn primary" href="${APP_URL}">Retourner dans SIIPAF Mobile</a>
  <a class="btn link" href="${webUrl}">Ouvrir mon espace client en ligne</a>
</main>
<script nonce="${nonce}">
  (function () {
    var ua = navigator.userAgent || '';
    var android = /Android/i.test(ua);
    var ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var btn = document.getElementById('app');
    if (!android && !ios) { btn.hidden = true; return; }
    var target = android ? ${JSON.stringify(intent)} : ${JSON.stringify(APP_URL)};
    btn.href = target;
    setTimeout(function () { window.location.href = target; }, 300);
  })();
</script>
</body>
</html>`;
}

module.exports = function paymentReturn() {
  const router = express.Router();
  router.get('/paiement/retour', (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    const webUrl = `${clientAppUrl}/`; // adresse réglée, jamais tirée de l'en-tête Host
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    res.type('html').send(page({ nonce, webUrl }));
  });
  return router;
};
