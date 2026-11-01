/* ============================================================
   SIIPAF SA — Sita, conseillère IA du site : bulle flottante, invitation par page, fenêtre de discussion.
   Autonome (aucune dépendance), léger : la feuille de style n'est chargée que si l'assistante est activée dans le dashboard
   (Contenu du site › Assistante du site). Configuration publique : GET /api/public/sita/config ; messages : POST /api/public/sita/message.
   Conversation gardée dans sessionStorage (disparaît avec l'onglet) ; passe la page / le programme consulté et les utm déjà capturés par js/main.js.
   Messages affichés en texte brut (jamais de HTML venu du serveur).
============================================================ */
(function () {
  'use strict';
  var script = document.currentScript;
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  var KEY = 'siipaf_sita';
  var page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  var cfg = null, root, win, log, input, sendBtn, launcher, badge, invite, typing = null;
  var sending = false;

  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } }
  function save(patch) { try { sessionStorage.setItem(KEY, JSON.stringify(Object.assign(state, patch))); } catch (e) { /* stockage indisponible */ } }
  var state = load();
  if (!state.visitor) { state.visitor = randomId(); state.messages = []; }

  function randomId() {
    var a = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /** Programme consulté : ?projet=slug (plan interactif, contact) ou #slug (pages des programmes). */
  function currentSlug() {
    var q = new URLSearchParams(location.search).get('projet');
    var h = decodeURIComponent(location.hash.slice(1));
    var slug = (q || h || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!slug || !cfg) return '';
    return cfg.programmes.some(function (p) { return p.slug === slug; }) ? slug : '';
  }
  function programmeName(slug) {
    var p = cfg.programmes.filter(function (x) { return x.slug === slug; })[0];
    return p ? p.name : '';
  }

  /** Photo choisie au dashboard, sinon l'avatar du site qui suit le réglage « Femme ou homme » (images/sita/). */
  function photoUrl() {
    if (cfg.photo) return /^https?:/.test(cfg.photo) ? cfg.photo : API + cfg.photo;
    var base = script && script.src ? script.src.replace(/js\/sita\.js(\?.*)?$/, '') : '';
    return base + 'images/sita/sita-' + (cfg.gender === 'homme' ? 'homme' : 'femme') + '.png';
  }

  function avatar(size) {
    var a = el('span', 'sita-avatar');
    if (size) { a.style.width = size + 'px'; a.style.height = size + 'px'; }
    var img = el('img');
    img.src = photoUrl();
    img.alt = '';
    img.onerror = function () { img.remove(); a.textContent = cfg.name.charAt(0).toUpperCase(); };
    a.appendChild(img);
    return a;
  }

  function build() {
    root = el('div', 'sita-root');
    root.setAttribute('role', 'complementary');
    root.setAttribute('aria-label', 'Discussion avec ' + cfg.name);

    launcher = el('button', 'sita-launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Discuter avec ' + cfg.name + ', ' + cfg.title);
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.appendChild(avatar());
    // Halo qui pulse et point vert « en ligne » : l'assistante est disponible
    launcher.appendChild(el('span', 'sita-halo')).setAttribute('aria-hidden', 'true');
    launcher.appendChild(el('span', 'sita-dot')).setAttribute('aria-hidden', 'true');
    badge = el('span', 'sita-badge', '1');
    badge.setAttribute('aria-hidden', 'true');
    launcher.appendChild(badge);
    launcher.addEventListener('click', function (e) {
      if (dragged) { e.preventDefault(); dragged = false; return; } // fin d'un déplacement, pas un clic
      openChat();
    });
    makeDraggable();

    win = el('section', 'sita-window');
    win.hidden = true;
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'false');
    win.setAttribute('aria-label', 'Discussion avec ' + cfg.name);
    var head = el('header', 'sita-head');
    head.appendChild(avatar(46));
    var who = el('div', 'sita-who');
    who.appendChild(el('strong', null, cfg.name));
    who.appendChild(el('span', null, cfg.title));
    who.appendChild(el('span', 'sita-online', 'En ligne — répond en quelques secondes'));
    head.appendChild(who);
    var close = el('button', 'sita-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer la discussion');
    close.addEventListener('click', closeChat);
    head.appendChild(close);

    log = el('div', 'sita-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-relevant', 'additions');

    var note = el('div', 'sita-note', cfg.notice + ' ' + cfg.consent);
    var form = el('form', 'sita-form');
    input = el('textarea', 'sita-input');
    input.rows = 1;
    input.maxLength = 600;
    input.placeholder = 'Écrivez votre message…';
    input.setAttribute('aria-label', 'Votre message');
    sendBtn = el('button', 'sita-send');
    sendBtn.type = 'submit';
    sendBtn.setAttribute('aria-label', 'Envoyer');
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 21.5 23 12 2.5 2.5l-.01 7.4L16 12 2.49 14.1z"/></svg>';
    form.appendChild(input);
    form.appendChild(sendBtn);
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; });
    win.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeChat(); launcher.focus(); } });

    win.appendChild(head);
    win.appendChild(log);
    win.appendChild(note);
    win.appendChild(form);
    root.appendChild(launcher);
    root.appendChild(win);
    document.body.appendChild(root);
    placeRoot();
    window.addEventListener('resize', placeRoot);

    // Conversation déjà commencée dans cet onglet : restaurée, pastille masquée
    if (state.messages.length) { badge.hidden = true; state.messages.forEach(function (m) { addMessage(m.role, m.text, m.actions, true); }); }
    if (state.open) openChat(true);
    else scheduleInvite();
  }

  // ─── Déplacement de la bulle (souris ou doigt) ──────────────────────
  // La position (distances aux bords droit et bas) suit le visiteur de page en page pendant sa visite ;
  // la fenêtre ouverte reprend sa place habituelle en bas à droite.
  // Mesures sans la barre de défilement (clientWidth) et sans l'agrandissement au survol (offsetWidth, cadre de root),
  // comme le « right / bottom » d'un élément fixe : la bulle ne saute pas au premier mouvement.
  var dragged = false;
  function viewport() { var d = document.documentElement; return { w: d.clientWidth || window.innerWidth, h: d.clientHeight || window.innerHeight }; }
  function clampPos(p) {
    var v = viewport(), m = 8;
    return {
      right: Math.round(Math.min(Math.max(p.right, m), v.w - (launcher.offsetWidth || 60) - m)),
      bottom: Math.round(Math.min(Math.max(p.bottom, m), v.h - (launcher.offsetHeight || 60) - m)),
    };
  }
  function placeRoot() {
    if (root.classList.contains('is-open') || !state.pos) { root.style.right = ''; root.style.bottom = ''; return; }
    var p = clampPos(state.pos);
    root.style.right = p.right + 'px';
    root.style.bottom = p.bottom + 'px';
  }
  function makeDraggable() {
    var start = null;
    launcher.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      dragged = false;
      var r = root.getBoundingClientRect(), v = viewport();
      start = { x: e.clientX, y: e.clientY, right: v.w - r.right, bottom: v.h - r.bottom, moved: false };
      launcher.setPointerCapture(e.pointerId);
    });
    launcher.addEventListener('pointermove', function (e) {
      if (!start) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.abs(dx) + Math.abs(dy) < 6) return; // petit tremblement d'un clic
      if (!start.moved) { start.moved = true; root.classList.add('is-dragging'); hideInvite(true); }
      var p = clampPos({ right: start.right - dx, bottom: start.bottom - dy });
      root.style.right = p.right + 'px';
      root.style.bottom = p.bottom + 'px';
    });
    function end() {
      if (!start) return;
      if (start.moved) {
        dragged = true;
        root.classList.remove('is-dragging');
        save({ pos: clampPos({ right: parseFloat(root.style.right), bottom: parseFloat(root.style.bottom) }) });
      }
      start = null;
    }
    launcher.addEventListener('pointerup', end);
    launcher.addEventListener('pointercancel', end);
  }

  // ─── Invitation contextuelle ────────────────────────────────────────
  function inviteText() {
    var slug = currentSlug();
    return (slug && cfg.invitations[slug]) || cfg.invitation_default;
  }
  function scheduleInvite() {
    if (state.inviteClosed || state.messages.length) return;
    setTimeout(function () {
      if (state.open || invite || state.inviteClosed) return;
      invite = el('div', 'sita-invite');
      invite.setAttribute('role', 'note');
      var x = el('button', 'sita-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Masquer l’invitation');
      x.addEventListener('click', function () { hideInvite(true); });
      invite.appendChild(el('p', null, inviteText()));
      var go = el('a', null, 'Démarrer la conversation →');
      go.href = '#';
      go.addEventListener('click', function (e) { e.preventDefault(); openChat(); });
      invite.appendChild(go);
      invite.appendChild(x);
      root.appendChild(invite);
    }, Math.max(0, cfg.invitation_delay_s) * 1000);
  }
  function hideInvite(remember) {
    if (invite) { invite.remove(); invite = null; }
    if (remember) save({ inviteClosed: true });
  }

  // ─── Fenêtre ────────────────────────────────────────────────────────
  function openChat(silent) {
    hideInvite(false);
    root.classList.add('is-open');
    placeRoot();
    win.hidden = false;
    badge.hidden = true;
    save({ open: true, inviteClosed: true });
    if (!state.messages.length) {
      addMessage('bot', cfg.greeting, null, false);
      state.messages.push({ role: 'bot', text: cfg.greeting });
      save({});
    }
    if (!silent) input.focus();
    scrollDown();
  }
  function closeChat() {
    root.classList.remove('is-open');
    placeRoot();
    win.hidden = true;
    save({ open: false });
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function addMessage(role, text, actions, quiet) {
    var m = el('div', 'sita-msg ' + (role === 'me' ? 'me' : role === 'err' ? 'err' : 'bot'), text);
    log.appendChild(m);
    if (actions && actions.length) {
      var box = el('div', 'sita-actions');
      actions.forEach(function (a) {
        if (a.type !== 'whatsapp' || !/^https:\/\/wa\.me\//.test(a.url)) return;
        var link = el('a', 'sita-action', a.label || 'Écrire sur WhatsApp');
        link.href = a.url;
        link.target = '_blank';
        link.rel = 'noopener';
        box.appendChild(link);
      });
      if (box.children.length) log.appendChild(box);
    }
    if (!quiet) scrollDown();
  }
  function showTyping(on) {
    if (on && !typing) {
      typing = el('div', 'sita-typing');
      typing.setAttribute('aria-label', cfg.name + ' écrit…');
      typing.innerHTML = '<i></i><i></i><i></i>';
      log.appendChild(typing);
      scrollDown();
    } else if (!on && typing) { typing.remove(); typing = null; }
  }

  function send() {
    var text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    sendBtn.disabled = true;
    addMessage('me', text);
    state.messages.push({ role: 'me', text: text });
    save({});
    input.value = '';
    input.style.height = 'auto';
    showTyping(true);
    var body = {
      visitor_id: state.visitor, message: text, page: { path: location.pathname.slice(0, 160), slug: currentSlug() || undefined },
      utm: typeof window.siipafUtm === 'function' ? window.siipafUtm() : undefined,
      lang: /^en/i.test(navigator.language || '') ? 'en' : 'fr', website: '',
    };
    fetch(API + '/api/public/sita/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
      .then(function (res) {
        showTyping(false);
        if (!res.ok) {
          addMessage('err', res.status === 429 ? 'Vous écrivez très vite : patientez quelques instants.' : res.d && res.d.error ? res.d.error : 'Je ne peux pas répondre pour le moment. Réessayez dans un instant.');
          return;
        }
        addMessage('bot', res.d.reply, res.d.actions);
        state.messages.push({ role: 'bot', text: res.d.reply, actions: res.d.actions || [] });
        // Coordonnées laissées à Sita : événement Lead du pixel Meta (une seule fois par conversation, sans aucune donnée personnelle)
        if (res.d.lead_saved && !state.leadTracked) { if (window.siipafTrack) window.siipafTrack('Lead', { content_name: 'sita' }); state.leadTracked = true; }
        save({});
      })
      .catch(function () { showTyping(false); addMessage('err', 'Connexion impossible pour le moment. Réessayez dans un instant.'); })
      .then(function () { sending = false; sendBtn.disabled = false; input.focus(); });
  }

  // ─── Démarrage ──────────────────────────────────────────────────────
  function start() {
    fetch(API + '/api/public/sita/config', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) {
        if (!c || !c.enabled || (c.pages || []).indexOf(page) === -1) return;
        cfg = c;
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = script && script.src ? script.src.replace(/js\/sita\.js(\?.*)?$/, 'css/sita.css') : 'css/sita.css';
        css.onload = build;
        css.onerror = build;
        document.head.appendChild(css);
      })
      .catch(function () { /* assistante indisponible : le site fonctionne sans */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
