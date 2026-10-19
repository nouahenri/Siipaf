/* ============================================================
   SIIPAF — Témoignages : affichage des témoignages publiés
   et formulaire de dépôt (publié après validation par l'équipe)
============================================================ */
(function () {
  'use strict';

  // Adresse de l'API : locale en développement, sous-domaine en production
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');

  var grid = document.querySelector('.temoignages-grid');
  var section = document.querySelector('.temoignages-section .container');
  if (!grid || !section) return;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // jamais innerHTML avec des données saisies par des visiteurs
    return e;
  }
  function icon(cls) { var i = document.createElement('i'); i.className = cls; i.setAttribute('aria-hidden', 'true'); return i; }
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase();
  }

  /* ─── Affichage des témoignages publiés ──────────────────── */
  function card(t, i) {
    var c = el('div', 'temo-card' + (t.featured ? ' temo-card-featured' : ''));
    c.setAttribute('data-aos', 'fade-up');
    c.setAttribute('data-aos-delay', String(100 + (i % 3) * 100));
    var stars = el('div', 'temo-stars');
    stars.setAttribute('aria-label', t.rating + ' sur 5');
    for (var s = 1; s <= 5; s++) stars.appendChild(icon(s <= t.rating ? 'fas fa-star' : 'far fa-star'));
    var quote = el('div', 'temo-quote'); quote.appendChild(icon('fas fa-quote-left'));
    var author = el('div', 'temo-author');
    var avatar = el('div', 'temo-avatar temo-avatar-initials', initials(t.name));
    avatar.setAttribute('aria-hidden', 'true');
    var who = el('div');
    who.appendChild(el('strong', null, t.name));
    who.appendChild(el('span', null, [t.role_label, t.project].filter(Boolean).join(' · ')));
    author.appendChild(avatar); author.appendChild(who);
    c.appendChild(stars); c.appendChild(quote); c.appendChild(el('p', 'temo-text', t.message)); c.appendChild(author);
    return c;
  }

  fetch(API + '/api/public/testimonials')
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (list) {
      if (!list.length) return; // on garde les témoignages d'origine
      grid.textContent = '';
      list.slice(0, 6).forEach(function (t, i) { grid.appendChild(card(t, i)); });
      if (window.AOS) window.AOS.refreshHard();
    })
    .catch(function () { /* API indisponible : les témoignages statiques restent affichés */ });

  /* ─── Bouton et formulaire de dépôt ──────────────────────── */
  var cta = el('div', 'temo-cta');
  var open = el('button', 'btn btn-primary');
  open.type = 'button';
  open.appendChild(el('span', null, 'Laisser un témoignage'));
  open.appendChild(icon('fas fa-pen'));
  cta.appendChild(el('p', null, 'Vous êtes client SIIPAF ? Partagez votre expérience.'));
  cta.appendChild(open);
  section.appendChild(cta);

  var modal = el('div', 'temo-modal');
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'temo-modal-title');
  modal.innerHTML = [ // gabarit fixe, sans donnée externe
    '<div class="temo-modal-backdrop" data-close></div>',
    '<form class="temo-modal-panel" novalidate>',
    '  <button type="button" class="temo-modal-close" data-close aria-label="Fermer"><i class="fas fa-times"></i></button>',
    '  <h3 id="temo-modal-title">Votre témoignage</h3>',
    '  <p class="temo-modal-sub">Il sera publié sur le site après validation par notre équipe.</p>',
    '  <div class="temo-rating" role="radiogroup" aria-label="Votre note">',
    [5, 4, 3, 2, 1].map(function (n) {
      return '<input type="radio" name="rating" id="temo-r' + n + '" value="' + n + '"' + (n === 5 ? ' checked' : '') + '><label for="temo-r' + n + '" title="' + n + ' sur 5"><i class="fas fa-star"></i></label>';
    }).join(''),
    '  </div>',
    '  <div class="temo-row">',
    '    <label>Nom affiché *<input name="name" required maxlength="120" placeholder="Ex. : Kouamé A."></label>',
    '    <label>Profil<input name="role_label" maxlength="120" placeholder="Ex. : Diaspora France"></label>',
    '  </div>',
    '  <div class="temo-row">',
    '    <label>Projet<select name="project_id"><option value="">— Choisir —</option></select></label>',
    '    <label>E-mail (non publié)<input name="email" type="email" maxlength="190" placeholder="pour vous recontacter"></label>',
    '  </div>',
    '  <label>Votre témoignage *<textarea name="message" required minlength="20" maxlength="1000" rows="5" placeholder="Racontez votre expérience avec SIIPAF…"></textarea></label>',
    '  <input name="website" tabindex="-1" autocomplete="off" class="temo-hp" aria-hidden="true">',
    '  <label class="temo-consent"><input type="checkbox" name="consent" required> J’accepte que mon nom affiché et mon témoignage soient publiés sur le site SIIPAF.</label>',
    '  <p class="temo-feedback" role="status" aria-live="polite"></p>',
    '  <button type="submit" class="btn btn-primary"><span>Envoyer mon témoignage</span><i class="fas fa-paper-plane"></i></button>',
    '</form>',
  ].join('');
  document.body.appendChild(modal);

  var form = modal.querySelector('form');
  var feedback = modal.querySelector('.temo-feedback');
  var lastFocus = null;

  // Projets proposés dans la liste (depuis l'API, sinon liste fixe)
  var select = form.querySelector('select[name="project_id"]');
  fetch(API + '/api/public/projects').then(function (r) { return r.json(); }).then(function (projects) {
    projects.forEach(function (p) { var o = el('option', null, p.name); o.value = p.id; select.appendChild(o); });
  }).catch(function () { select.closest('label').hidden = true; });

  function show() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('temo-modal-open');
    setTimeout(function () { form.querySelector('input[name="name"]').focus(); }, 50);
  }
  function hide() {
    modal.hidden = true;
    document.body.classList.remove('temo-modal-open');
    if (lastFocus) lastFocus.focus();
  }
  open.addEventListener('click', show);
  modal.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) hide(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    feedback.className = 'temo-feedback';
    if (!form.reportValidity()) return;
    var fd = new FormData(form);
    var body = {
      name: String(fd.get('name') || '').trim(),
      role_label: String(fd.get('role_label') || '').trim() || null,
      project_id: fd.get('project_id') ? Number(fd.get('project_id')) : null,
      email: String(fd.get('email') || '').trim() || undefined,
      rating: Number(fd.get('rating') || 5),
      message: String(fd.get('message') || '').trim(),
      website: String(fd.get('website') || ''),
    };
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    fetch(API + '/api/public/testimonials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.details ? res.d.details.map(function (x) { return x.message; }).join(' ') : res.d.error);
        form.reset();
        feedback.textContent = res.d.message;
        feedback.className = 'temo-feedback ok';
      })
      .catch(function (err) {
        feedback.textContent = (err && err.message && err.message !== 'Failed to fetch') ? err.message : 'Envoi impossible pour le moment. Réessayez plus tard ou contactez-nous au +225 01 02 27 95 95.';
        feedback.className = 'temo-feedback err';
      })
      .then(function () { btn.disabled = false; });
  });
})();
