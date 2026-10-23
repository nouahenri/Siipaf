/**
 * Page Carrières : offres publiées dans l'ERP › RH › Recrutement (statut « Ouvert », case « Publier sur le site »)
 * et dépôt de candidature avec CV ; la candidature arrive dans l'ERP et l'équipe est prévenue par e-mail.
 */
(function () {
  var API = window.SIIPAF_API || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000' : 'https://client.siipaf.com');
  var list = document.getElementById('jobsList');
  var form = document.getElementById('jobForm');
  var select = document.getElementById('jf-job');
  if (!list || !form) return;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var frDate = function (d) { return d ? new Date(d + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''; };

  function choose(id) {
    select.value = String(id);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { document.getElementById('jf-name').focus({ preventScroll: true }); }, 500);
  }

  function render(jobs) {
    if (!jobs.length) {
      list.innerHTML = '<p class="jobs-empty"><i class="fas fa-briefcase" aria-hidden="true"></i> Aucune offre en ce moment. Vous pouvez nous adresser une candidature spontanée : nous la gardons pour nos prochains recrutements.</p>';
      return;
    }
    list.innerHTML = jobs.map(function (j) {
      var meta = [j.contract_label, j.department_label, j.location, j.openings > 1 ? j.openings + ' postes' : null].filter(Boolean)
        .map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('');
      return '<article class="job-card">'
        + '<h3>' + esc(j.title) + '</h3>'
        + (meta ? '<div class="job-meta">' + meta + '</div>' : '')
        + (j.description ? '<p>' + esc(j.description).replace(/\n/g, '<br/>') + '</p>' : '')
        + '<div class="job-foot">'
        + (j.closing_date ? '<small><i class="far fa-calendar" aria-hidden="true"></i> Candidatures jusqu’au ' + frDate(j.closing_date) + '</small>' : '<small></small>')
        + '<button type="button" class="btn btn-primary btn-sm" data-job="' + j.id + '"><span>Postuler</span><i class="fas fa-arrow-right"></i></button>'
        + '</div></article>';
    }).join('');
    select.innerHTML = '<option value="">Candidature spontanée</option>' + jobs.map(function (j) { return '<option value="' + j.id + '">' + esc(j.title) + '</option>'; }).join('');
    var wanted = Number(new URLSearchParams(location.search).get('poste'));
    if (wanted && jobs.some(function (j) { return j.id === wanted; })) select.value = String(wanted);
  }

  list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-job]');
    if (b) choose(b.getAttribute('data-job'));
  });

  fetch(API + '/api/public/emplois', { credentials: 'omit' })
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(render)
    .catch(function () { list.innerHTML = '<p class="jobs-empty">Les offres ne peuvent pas être affichées pour le moment. Vous pouvez tout de même nous envoyer votre candidature.</p>'; });

  var status = form.querySelector('.cf-status');
  var button = form.querySelector('button[type="submit"]');
  function show(text, ok) { status.hidden = false; status.className = 'cf-status ' + (ok ? 'ok' : 'err'); status.textContent = text; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var cv = form.cv.files[0];
    if (cv && cv.size > 8 * 1024 * 1024) return show('Le CV dépasse 8 Mo : envoyez un fichier plus léger.', false);
    button.disabled = true;
    status.hidden = true;
    fetch(API + '/api/public/candidatures', { method: 'POST', body: new FormData(form), credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) {
          var detail = res.body.details && res.body.details.length ? res.body.details.map(function (d) { return d.message; }).join(' · ') : res.body.error;
          throw new Error(detail || 'Envoi impossible.');
        }
        form.reset();
        show('Merci ! Votre candidature a bien été reçue. Notre service des ressources humaines vous recontactera si votre profil correspond.', true);
      })
      .catch(function (err) { show(err.message === 'Failed to fetch' ? 'Connexion impossible : réessayez dans un instant.' : err.message, false); })
      .then(function () { button.disabled = false; });
  });
})();
