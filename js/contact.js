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
    var lineName = window.SiipafOffers ? window.SiipafOffers.lineName : offerName;
    var names = p ? (p.offers || []).map(function (o) { return lineName(o, p.offers); }).filter(Boolean) : [];
    datalist.innerHTML = names.filter(function (n, i) { return names.indexOf(n) === i; })
      .map(function (n) { var o = document.createElement('option'); o.value = n; return o.outerHTML; }).join('');
    fillBudget();
  }

  // Budget : prix de la ligne de la grille (promotion ou lotissement) pour le type de bien choisi
  // (js/offers.js) ; un montant saisi par le visiteur n'est jamais remplacé
  var budget = form.querySelector('input[name="budget"]');
  var autoBudget = '';
  function fillBudget() {
    if (!budget || !window.SiipafOffers) return;
    if (budget.value && budget.value !== autoBudget) return;
    var p = projects.filter(function (x) { return x.slug === select.value; })[0];
    autoBudget = p ? window.SiipafOffers.budgetFor(p.offers, property.value, p) : '';
    budget.value = autoBudget;
  }
  property.addEventListener('input', fillBudget);

  function prefill() {
    var opt = findOption(wanted.projet);
    if (opt) opt.selected = true;
    if (wanted.bien && !property.value) property.value = wanted.bien;
    fillProperties();
    // Prise de rendez-vous : le message n'est qu'un champ de précisions facultatif, laissé vide
    if (params.get('rdv') || message.value.trim() || !(opt || wanted.bien || wanted.lot)) return;
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

  // ── Deux modes : message, ou demande de rendez-vous (admin › Rendez-vous, statut « Demandé ») ──
  // contact.html?rdv=1 (boutons « Prendre RDV » du site) ouvre directement la prise de rendez-vous.
  var rdvBox = form.querySelector('.cf-rdv');
  var title = document.getElementById('cf-title');
  var messageLabel = document.getElementById('cf-message-label');
  var submitLabel = form.querySelector('button[type="submit"] span');
  var dateInput = form.querySelector('input[name="date"]');
  var timeSelect = form.querySelector('select[name="time"]');
  var mode = 'message';
  // Créneaux de 30 min, 8 h – 17 h 30, heure d'Abidjan (GMT, sans heure d'été)
  for (var h = 8; h < 18; h++) {
    ['00', '30'].forEach(function (m) {
      var v = (h < 10 ? '0' : '') + h + ':' + m;
      var o = document.createElement('option');
      o.value = v;
      o.textContent = h + ' h ' + m;
      timeSelect.appendChild(o);
    });
  }
  timeSelect.value = '10:00';
  // Au plus tôt demain (date d'Abidjan), au plus tard dans 3 mois
  function isoDay(d) { return d.toISOString().slice(0, 10); }
  var tomorrow = new Date(Date.now() + 864e5);
  dateInput.min = isoDay(tomorrow);
  dateInput.max = isoDay(new Date(Date.now() + 92 * 864e5));
  dateInput.addEventListener('input', function () {
    var sunday = dateInput.value && new Date(dateInput.value + 'T12:00:00Z').getUTCDay() === 0;
    dateInput.setCustomValidity(sunday ? 'Nos bureaux sont fermés le dimanche : choisissez un autre jour.' : '');
  });

  function setMode(next) {
    mode = next;
    var rdv = next === 'rdv';
    Array.prototype.forEach.call(document.querySelectorAll('.cf-mode'), function (b) {
      var on = b.getAttribute('data-mode') === next;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    rdvBox.hidden = !rdv;
    rdvBox.disabled = !rdv;
    title.innerHTML = rdv ? 'Prenez <em>rendez-vous</em>' : 'Envoyez-nous <em>un message</em>';
    messageLabel.textContent = rdv ? 'Précisions (facultatif)' : 'Votre message *';
    message.required = !rdv;
    submitLabel.textContent = rdv ? 'Demander ce rendez-vous' : 'Envoyer ma demande';
    status.hidden = true;
  }
  Array.prototype.forEach.call(document.querySelectorAll('.cf-mode'), function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });
  if (params.get('rdv')) {
    setMode('rdv');
    // Arrivée par un bouton « Prendre RDV » : on va droit au formulaire
    // (après le chargement des images et les animations d'apparition, sinon la position bouge encore)
    window.addEventListener('load', function () {
      setTimeout(function () {
        var top = title.getBoundingClientRect().top + window.scrollY - 100;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }, 600);
    });
  }

  function sendAppointment(val) {
    var p = projects.filter(function (x) { return x.slug === val('project'); })[0];
    var notes = [
      val('property_type') && 'Type de bien : ' + val('property_type'),
      val('budget') && 'Budget : ' + val('budget'),
      val('message'),
    ].filter(Boolean).join('\n');
    return {
      url: '/api/public/appointments',
      body: {
        name: val('name'),
        phone: val('phone') || undefined,
        email: val('email') || undefined,
        kind: val('kind'),
        // Heure d'Abidjan = GMT : le créneau choisi est le même pour un visiteur de la diaspora
        starts_at: val('date') + 'T' + val('time') + ':00Z',
        project_id: p ? p.id : undefined,
        message: notes || undefined,
        website: val('website'),
      },
      done: 'Merci ! Votre demande de rendez-vous du ' + new Date(val('date') + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) +
        ' à ' + val('time').replace(':', ' h ') + ' est enregistrée. Un conseiller vous recontacte pour la confirmer.',
    };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var val = function (k) { return String(fd.get(k) || '').trim(); };
    var budget = val('budget');
    var req = mode === 'rdv' ? sendAppointment(val) : null;
    var body = req ? req.body : {
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
    fetch(API + (req ? req.url : '/api/public/contact'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.details ? res.d.details.map(function (x) { return x.message; }).join(' ') : res.d.error);
        form.reset();
        autoBudget = '';
        timeSelect.value = '10:00';
        fillProperties();
        btn.innerHTML = '<span>Demande envoyée</span><i class="fas fa-check" aria-hidden="true"></i>';
        btn.classList.add('is-sent');
        show(req ? req.done : 'Merci ! Votre demande est bien arrivée chez SIIPAF. Un conseiller vous recontacte très vite.', true);
        setTimeout(function () { btn.innerHTML = original; btn.classList.remove('is-sent'); btn.disabled = false; }, 4000);
      })
      .catch(function (err) {
        btn.innerHTML = original;
        btn.disabled = false;
        show((err && err.message && err.message !== 'Failed to fetch') ? err.message : 'Envoi impossible pour le moment. Réessayez dans un instant ou appelez-nous au +225 01 02 27 95 95.', false);
      });
  });
})();
