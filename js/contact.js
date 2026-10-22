/**
 * Formulaire de contact : envoi réel à l'API (le prospect et le message arrivent dans le dashboard).
 * Liste des projets tirée du dashboard ; pré-rempli depuis le lien d'origine :
 * contact.html?projet=<slug, code ou nom>&bien=<type de bien consulté>&lot=<code du lot>.
 */
(function () {
  var form = document.getElementById('contactForm');
  if (!form) return;
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  var select = form.querySelector('select[name="project"]');
  var property = form.querySelector('input[name="property_type"]');
  var datalist = document.getElementById('cf-property-list');
  var message = form.querySelector('textarea[name="message"]');
  var status = form.querySelector('.cf-status');
  var params = new URLSearchParams(location.search);
  var wanted = { projet: params.get('projet') || '', bien: params.get('bien') || '', lot: params.get('lot') || '' };
  var projects = [];

  // « C & LY — COCODY ANGRÉ », « cly », « CLY » : même projet
  function fold(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function offerName(o) { return [o.label, o.designation].filter(Boolean).join(' '); }

  function findOption(value) {
    var f = fold(value);
    if (!f) return null;
    var opts = Array.prototype.slice.call(select.options).filter(function (o) { return o.value; });
    return opts.filter(function (o) { return fold(o.value) === f; })[0]
      || opts.filter(function (o) { return fold(o.textContent) === f; })[0]
      || opts.filter(function (o) { var t = fold(o.textContent); return t.indexOf(f) >= 0 || (t && f.indexOf(t) >= 0); })[0]
      || null;
  }

  // Types de bien proposés : la grille de prix du projet choisi
  function fillProperties() {
    var p = projects.filter(function (x) { return x.slug === select.value; })[0];
    var names = p ? (p.offers || []).map(offerName).filter(Boolean) : [];
    datalist.innerHTML = names.filter(function (n, i) { return names.indexOf(n) === i; })
      .map(function (n) { var o = document.createElement('option'); o.value = n; return o.outerHTML; }).join('');
  }

  function prefill() {
    var opt = findOption(wanted.projet);
    if (opt) opt.selected = true;
    if (wanted.bien && !property.value) property.value = wanted.bien;
    fillProperties();
    if (message.value.trim() || !(opt || wanted.bien || wanted.lot)) return;
    var projectName = opt && opt.value !== 'Autre' ? opt.textContent.trim() : '';
    var what = [wanted.bien && '« ' + wanted.bien + ' »', wanted.lot && 'le lot ' + wanted.lot].filter(Boolean).join(', ');
    message.value = what
      ? 'Bonjour, je souhaite recevoir plus d’informations et réserver ' + what + (projectName ? ' du programme ' + projectName : '') + '. Merci de me recontacter.'
      : 'Bonjour, je suis intéressé(e) par le programme ' + projectName + ' et souhaite plus d’informations. Merci de me recontacter.';
  }

  select.addEventListener('change', fillProperties);
  prefill();

  // Projets publiés dans le dashboard (le nom affiché et l'identifiant envoyé au serveur)
  fetch(API + '/api/public/projects', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (list) {
      if (!list.length) return;
      projects = list;
      var current = select.value ? (findOption(select.value) || {}).textContent : '';
      var other = select.querySelector('option[value="Autre"]');
      Array.prototype.slice.call(select.options).forEach(function (o) { if (o.value && o !== other) o.remove(); });
      list.forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.slug;
        o.textContent = p.name;
        select.insertBefore(o, other || null);
      });
      var again = findOption(wanted.projet || current);
      if (again) again.selected = true;
      fillProperties();
    })
    .catch(function () { /* la liste écrite reste utilisable */ });

  function show(text, ok) {
    status.hidden = false;
    status.textContent = text;
    status.className = 'cf-status ' + (ok ? 'ok' : 'err');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var val = function (k) { return String(fd.get(k) || '').trim(); };
    var budget = val('budget');
    var body = {
      name: val('name'),
      phone: val('phone') || undefined,
      email: val('email') || undefined,
      project: val('project') && val('project') !== 'Autre' ? val('project') : undefined,
      property_type: val('property_type') || undefined,
      subject: val('project') === 'Autre' ? 'Renseignement général' : undefined,
      message: val('message') + (budget ? '\n\nBudget : ' + budget : ''),
      website: String(fd.get('website') || ''),
    };
    var btn = form.querySelector('button[type="submit"]');
    var original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>Envoi en cours…</span><i class="fas fa-spinner fa-spin" aria-hidden="true"></i>';
    status.hidden = true;
    fetch(API + '/api/public/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.details ? res.d.details.map(function (x) { return x.message; }).join(' ') : res.d.error);
        form.reset();
        fillProperties();
        btn.innerHTML = '<span>Demande envoyée</span><i class="fas fa-check" aria-hidden="true"></i>';
        btn.classList.add('is-sent');
        show('Merci ! Votre demande est bien arrivée chez SIIPAF. Un conseiller vous recontacte très vite.', true);
        setTimeout(function () { btn.innerHTML = original; btn.classList.remove('is-sent'); btn.disabled = false; }, 4000);
      })
      .catch(function (err) {
        btn.innerHTML = original;
        btn.disabled = false;
        show((err && err.message && err.message !== 'Failed to fetch') ? err.message : 'Envoi impossible pour le moment. Réessayez dans un instant ou appelez-nous au +225 01 02 27 95 95.', false);
      });
  });
})();
