/**
 * ERP · QHSE, suivi : tableau de bord par chantier (notes moyennes, % sécurité, conformité environnementale, tendance, actions),
 * compteurs de la barre latérale, synthèse pour la Vue Direction (« À traiter en priorité »), onglet QHSE de la fiche chantier,
 * remarques de sécurité de la fiche employé, historique qualité d'une réclamation SAV, tâche horaire (contrôle du jour manquant,
 * actions en retard). Heures : UTC, soit l'heure de Côte d'Ivoire.
 */
const { HttpError, isoDay } = require('../lib/http');
const Q = require('../lib/qhse');
const svc = require('./qhse');
const audits = require('./qhseAudits');
const { inform } = require('./notifications');

const summaryRow = c => ({
  day: isoDay(c.period_start), control_id: c.id, rating_qualite: c.rating_qualite, rating_hygiene: c.rating_hygiene, safety_pct: c.safety_pct,
  site_safety_pct: c.site_safety_pct, env_rate: c.env_rate, workers_present: c.workers_present, workers_compliant: c.workers_compliant,
});
const COLUMNS = ['id', 'worksite_id', 'period_start', 'rating_qualite', 'rating_hygiene', 'safety_pct', 'site_safety_pct', 'env_rate', 'workers_present', 'workers_compliant'];
const agg = rows => ({
  qualite: Q.mean1(rows.map(r => r.rating_qualite)), hygiene: Q.mean1(rows.map(r => r.rating_hygiene)),
  safety: Q.mean1(rows.map(r => r.safety_pct)), env: Q.mean1(rows.map(r => r.env_rate)),
});
const trendOf = (cur, prev) => ({ qualite: Q.delta(cur.qualite, prev.qualite), hygiene: Q.delta(cur.hygiene, prev.hygiene), safety: Q.delta(cur.safety, prev.safety), env: Q.delta(cur.env, prev.env) });

// ─── Tableau de bord ──────────────────────────────────────────────────────

async function dashboard(db, v, { days = 30, now = new Date() } = {}) {
  const today = Q.todayStr(now);
  const from = Q.addDays(today, -(days - 1));
  const s = await svc.settings(db);
  const opts = await svc.calendarOptions(db, from, today, s);
  const worksites = await svc.visibleWorksites(db, v, { open: true });
  const ids = worksites.map(w => w.id);
  const rows = ids.length ? (await db('qhse_controls').where({ kind: 'journalier' }).whereIn('worksite_id', ids).where('period_start', '>=', from).select(COLUMNS)).map(c => ({ ...summaryRow(c), worksite_id: c.worksite_id })) : [];
  const last7From = Q.addDays(today, -6);
  const prev7From = Q.addDays(today, -13);
  const prev7To = Q.addDays(today, -7);
  const inLast7 = r => r.day >= last7From;
  const inPrev7 = r => r.day >= prev7From && r.day <= prev7To;
  const actions = await audits.listActions(db, v, { status: 'ouvertes', limit: 500 });
  const workday = Q.isWorkingDay(today, opts);

  const perSite = worksites.map(w => {
    const mine = rows.filter(r => r.worksite_id === w.id);
    const l7 = mine.filter(inLast7);
    const acts = actions.filter(a => a.worksite_id === w.id);
    const done = mine.some(r => r.day === today);
    return {
      id: w.id, reference: w.reference, name: w.name, project_name: w.project_name, manager_name: w.manager_name, status: w.status,
      controls: mine.length, last_day: mine.length ? mine.map(r => r.day).sort().pop() : null, today_done: done, missing_today: w.status === 'en_cours' && workday && !done,
      ...Object.fromEntries(Object.entries(agg(mine)).map(([k, x]) => [`${k}_avg`, x])), week: agg(l7), trend: trendOf(agg(l7), agg(mine.filter(inPrev7))),
      bad_7d: l7.filter(r => r.rating_qualite === Q.BAD_RATING || r.rating_hygiene === Q.BAD_RATING).length,
      low_safety_7d: l7.filter(r => r.safety_pct != null && r.safety_pct < s.threshold).length,
      open_actions: acts.length, late_actions: acts.filter(a => a.late).length,
    };
  });

  const series = [];
  for (let d = from; d <= today; d = Q.addDays(d, 1)) {
    const day = rows.filter(r => r.day === d);
    series.push({ day: d, controls: day.length, ...agg(day) });
  }
  const weekly = v.can('qhse:validate') ? await db('qhse_controls').where({ kind: 'hebdomadaire', status: 'a_valider' }).count({ n: '*' }).first() : { n: 0 };
  const toValidate = v.can('qhse:validate') ? await audits.listAudits(db, v, { status: 'a_valider' }) : [];
  const upcoming = (await audits.listAudits(db, v, { status: 'planifie' })).filter(a => a.planned_on && a.planned_on <= Q.addDays(today, 14)).reverse();
  const all30 = agg(rows);
  return {
    today, days, threshold: s.threshold, check_hour: s.hour, working_day: workday,
    kpis: {
      ...Object.fromEntries(Object.entries(all30).map(([k, x]) => [`${k}_avg`, x])), trend: trendOf(agg(rows.filter(inLast7)), agg(rows.filter(inPrev7))),
      worksites: worksites.length, missing_today: perSite.filter(p => p.missing_today).length, bad_7d: perSite.reduce((t, p) => t + p.bad_7d, 0), low_safety_7d: perSite.reduce((t, p) => t + p.low_safety_7d, 0),
      open_actions: actions.length, late_actions: actions.filter(a => a.late).length, weekly_to_validate: Number(weekly.n), audits_to_validate: toValidate.length,
    },
    worksites: perSite, series, audits_to_validate: toValidate.slice(0, 5), audits_upcoming: upcoming.slice(0, 5), late_actions: actions.filter(a => a.late).slice(0, 8),
  };
}

/** Compteurs de la barre latérale : contrôle du jour à saisir (conducteur), validations attendues, actions en retard ou à mon nom. */
async function badges(db, v, now = new Date()) {
  const today = Q.todayStr(now);
  const opts = await svc.calendarOptions(db, today, today);
  let missing = 0;
  if (v.can('qhse:control') && Q.isWorkingDay(today, opts)) {
    const sites = (await svc.visibleWorksites(db, v, { status: 'en_cours' })).map(w => w.id);
    if (sites.length) {
      const done = await db('qhse_controls').where({ kind: 'journalier', period_start: today }).whereIn('worksite_id', sites).select('worksite_id');
      missing = sites.length - new Set(done.map(d => d.worksite_id)).size;
    }
  }
  // À valider par ce compte : sans ses propres synthèses ni ses propres audits (sauf super administrateur)
  const me = Number(v.user.id);
  const others = cols => query => { if (!svc.isSuper(v)) for (const c of cols) query.where(b => b.whereNull(c).orWhereNot(c, me)); return query; };
  const weekly = v.can('qhse:validate') ? Number((await others(['created_by', 'updated_by', 'submitted_by'])(db('qhse_controls').where({ kind: 'hebdomadaire', status: 'a_valider' })).count({ n: '*' }).first()).n) : 0;
  const toValidate = v.can('qhse:validate') ? Number((await others(['created_by', 'submitted_by', 'auditor_id'])(db('qhse_audits').where({ status: 'a_valider' })).count({ n: '*' }).first()).n) : 0;
  const open = await audits.listActions(db, v, { status: 'ouvertes', limit: 500 });
  const late = open.filter(a => a.late).length;
  const mine = open.filter(a => Number(a.owner_id) === Number(v.user.id)).length;
  return { missing_today: missing, weekly_to_validate: weekly, audits_to_validate: toValidate, actions_late: late, my_actions: mine, count: missing + weekly + toValidate + late };
}

// ─── Vue Direction ────────────────────────────────────────────────────────

/** Synthèse de tout le QHSE pour la vue Direction ; chaque point de « À traiter en priorité » renvoie à sa fiche. */
async function directionPart(db, now = new Date()) {
  const ALL = { user: { id: 0 }, can: () => true };
  const d = await dashboard(db, ALL, { now });
  const today = d.today;
  const s = { threshold: d.threshold, hour: d.check_hour };
  const last7 = Q.addDays(today, -6);
  const open = d.worksites.map(w => w.id);
  const recent = open.length ? await db('qhse_controls as c').join('worksites as w', 'w.id', 'c.worksite_id').where('c.kind', 'journalier').whereIn('c.worksite_id', open).where('c.period_start', '>=', last7)
    .select('c.id', 'c.period_start', 'c.rating_qualite', 'c.rating_hygiene', 'c.safety_pct', 'c.workers_present', 'c.workers_compliant', 'w.reference', 'w.name') : [];
  const linked = new Set((await db('qhse_actions').whereIn('control_id', recent.map(r => r.id).concat(0)).whereNot('status', 'annulee').select('control_id')).map(a => a.control_id));
  const attention = [];
  for (const c of recent) {
    if (linked.has(c.id)) continue;
    const day = isoDay(c.period_start);
    for (const p of ['qualite', 'hygiene']) {
      if (c[`rating_${p}`] === Q.BAD_RATING) attention.push({ module: 'qhse', label: `${Q.PILLARS[p].label} « Mauvais » : ${c.reference}`, detail: `${c.name} · sans action corrective`, date: day, link: `/qhse/controles/${c.id}` });
    }
    if (c.safety_pct != null && c.safety_pct < s.threshold) {
      attention.push({ module: 'qhse', label: `Sécurité à ${c.safety_pct} % : ${c.reference}`, detail: `${c.name} · seuil ${s.threshold} % · sans action corrective`, date: day, link: `/qhse/controles/${c.id}` });
    }
  }
  const late = await audits.listActions(db, ALL, { status: 'retard', limit: 100 });
  for (const a of late) attention.push({ module: 'qhse', label: `Action corrective en retard : ${a.reference}`, detail: [a.title, a.owner_name].filter(Boolean).join(' · '), date: a.due_on, link: `/qhse/actions?fiche=${a.id}` });
  if (d.working_day && now.getUTCHours() >= s.hour) {
    for (const w of d.worksites.filter(x => x.missing_today)) attention.push({ module: 'qhse', label: `Contrôle du jour manquant : ${w.reference}`, detail: [w.name, w.manager_name].filter(Boolean).join(' · '), date: today, link: `/qhse/controles/nouveau?chantier=${w.id}` });
  }
  const weekly = await db('qhse_controls as c').join('worksites as w', 'w.id', 'c.worksite_id').where({ 'c.kind': 'hebdomadaire', 'c.status': 'a_valider' }).select('c.id', 'c.period_start', 'c.submitted_at', 'w.reference', 'w.name');
  for (const c of weekly) attention.push({ module: 'qhse', label: `Contrôle hebdomadaire à valider : ${c.reference}`, detail: `${c.name} · semaine du ${Q.frDay(isoDay(c.period_start))}`, date: isoDay(c.submitted_at) || isoDay(c.period_start), link: `/qhse/hebdomadaires/${c.id}` });
  for (const a of d.audits_to_validate) attention.push({ module: 'qhse', label: `Audit à valider : ${a.reference}`, detail: a.place_label, date: isoDay(a.submitted_at), link: `/qhse/audits/${a.id}` });
  return {
    worksites: d.kpis.worksites, qualite_avg: d.kpis.qualite_avg, hygiene_avg: d.kpis.hygiene_avg, safety_avg: d.kpis.safety_avg, env_avg: d.kpis.env_avg, trend: d.kpis.trend,
    missing_today: d.kpis.missing_today, bad_7d: d.kpis.bad_7d, low_safety_7d: d.kpis.low_safety_7d, open_actions: d.kpis.open_actions, late_actions: d.kpis.late_actions,
    weekly_to_validate: d.kpis.weekly_to_validate, audits_to_validate: d.kpis.audits_to_validate, threshold: s.threshold,
    worksites_detail: d.worksites.map(w => ({ id: w.id, reference: w.reference, name: w.name, qualite_avg: w.qualite_avg, hygiene_avg: w.hygiene_avg, safety_avg: w.safety_avg, env_avg: w.env_avg, late_actions: w.late_actions, missing_today: w.missing_today })),
    attention,
  };
}

// ─── Chantier, employé, réclamation ───────────────────────────────────────

/** Onglet QHSE de la fiche chantier. */
async function worksiteSummary(db, w, v, now = new Date()) {
  const today = Q.todayStr(now);
  const from = Q.addDays(today, -29);
  const rows = (await db('qhse_controls').where({ worksite_id: w.id, kind: 'journalier' }).where('period_start', '>=', from).orderBy('period_start', 'desc').select(COLUMNS)).map(summaryRow);
  const l7 = rows.filter(r => r.day >= Q.addDays(today, -6));
  const weekly = await db('qhse_controls').where({ worksite_id: w.id, kind: 'hebdomadaire' }).orderBy('period_start', 'desc').limit(4).select('id', 'period_start', 'status', 'rating_qualite', 'rating_hygiene', 'safety_pct', 'env_rate');
  const s = await svc.settings(db);
  return {
    worksite: { id: w.id, reference: w.reference, name: w.name, status: w.status },
    today, today_control_id: rows.find(r => r.day === today)?.control_id || null, threshold: s.threshold,
    week: agg(l7), month: agg(rows), recent: rows.slice(0, 14).map(r => ({ ...r, rating_qualite_label: Q.ratingLabel(r.rating_qualite), rating_hygiene_label: Q.ratingLabel(r.rating_hygiene) })),
    weekly: weekly.map(c => ({ id: c.id, week_start: isoDay(c.period_start), status: c.status, status_label: Q.CONTROL_STATUSES[c.status], rating_qualite: c.rating_qualite, rating_hygiene: c.rating_hygiene, safety_pct: c.safety_pct, env_rate: c.env_rate })),
    actions: await audits.listActions(db, v, { status: 'ouvertes', worksiteId: w.id, limit: 20 }),
    audits: await audits.listAudits(db, v, { worksiteId: w.id, limit: 5 }),
    can: { control: v.can('qhse:control'), audit: v.can('qhse:audit'), actions: v.can('qhse:actions') },
  };
}

/** Remarques de sécurité d'un employé (fiche employé) : ouvriers nommés lors des contrôles. */
async function employeeRemarks(db, employeeId) {
  if (!(await db('employees').where({ id: employeeId }).first('id'))) throw new HttpError(404, 'Employé introuvable.');
  const rows = await db('qhse_workers as k').join('qhse_controls as c', 'c.id', 'k.control_id').join('worksites as w', 'w.id', 'c.worksite_id')
    .where('k.employee_id', employeeId).orderBy('c.period_start', 'desc').limit(50)
    .select('k.id', 'k.issue', 'c.id as control_id', 'c.period_start', 'w.reference', 'w.name');
  return rows.map(r => ({ id: r.id, control_id: r.control_id, day: isoDay(r.period_start), worksite_reference: r.reference, worksite_name: r.name, issue: r.issue }));
}

/** Réclamation SAV : actions correctives liées et historique qualité des chantiers du même programme. */
async function savLink(db, ticketId, v, now = new Date()) {
  const t = await db('sav_tickets').where({ id: ticketId }).first('id', 'ref', 'title', 'project_id');
  if (!t) throw new HttpError(404, 'Réclamation introuvable.');
  const today = Q.todayStr(now);
  const sites = t.project_id ? (await svc.visibleWorksites(db, v)).filter(w => w.project_id === t.project_id) : [];
  const history = [];
  for (const w of sites) {
    const rows = await db('qhse_controls').where({ worksite_id: w.id, kind: 'journalier' }).where('period_start', '>=', Q.addDays(today, -89)).orderBy('period_start', 'desc').select(COLUMNS);
    history.push({
      id: w.id, reference: w.reference, name: w.name, controls_90d: rows.length, qualite_avg: Q.mean1(rows.map(r => r.rating_qualite)),
      bad_90d: rows.filter(r => r.rating_qualite === Q.BAD_RATING).length,
      recent: rows.slice(0, 6).map(r => ({ id: r.id, day: isoDay(r.period_start), rating: r.rating_qualite, label: Q.ratingLabel(r.rating_qualite) })),
    });
  }
  return { ticket: { id: t.id, ref: t.ref, title: t.title }, worksites: history, actions: await audits.listActions(db, v, { status: 'toutes', savTicketId: t.id }), can_open: v.can('qhse:actions') };
}

// ─── Tâche planifiée (chaque heure) ───────────────────────────────────────

/**
 * 1) Contrôle du jour manquant : un chantier en cours, un jour ouvré, passé l'heure réglée, sans contrôle journalier → son conducteur
 *    est prévenu (une seule fois par chantier et par jour).
 * 2) Action corrective en retard : son responsable et le conducteur du chantier, plus le service QHSE du circuit (une fois par échéance).
 */
async function tick(db, now = new Date()) {
  const stats = { missing: 0, late: 0 };
  const day = Q.todayStr(now);
  const s = await svc.settings(db);
  const opts = await svc.calendarOptions(db, day, day, s);
  if (Q.isWorkingDay(day, opts) && now.getUTCHours() >= s.hour) {
    const sites = await db('worksites as w').join('projects as p', 'p.id', 'w.project_id').where('w.status', 'en_cours').whereNotNull('w.manager_id').select('w.id', 'w.reference', 'w.name', 'w.manager_id', 'p.name as project_name');
    const done = new Set((await db('qhse_controls').where({ kind: 'journalier', period_start: day }).select('worksite_id')).map(c => c.worksite_id));
    for (const w of sites.filter(x => !done.has(x.id))) {
      stats.missing += await inform(db, 'qhse.controle_manquant', {
        direct: [w.manager_id], key: `qhse-manquant:${w.id}:${day}`, link: `/qhse/controles/nouveau?chantier=${w.id}`,
        title: `Contrôle QHSE du jour à saisir : ${w.reference}`, body: `${w.name} (${w.project_name}) — aucun contrôle journalier avant ${s.hour} h`,
      });
    }
  }
  const late = await db('qhse_actions as x').leftJoin('worksites as w', 'w.id', 'x.worksite_id').whereIn('x.status', Q.ACTION_OPEN).where('x.due_on', '<', day).select('x.id', 'x.reference', 'x.title', 'x.owner_id', 'x.due_on', 'w.manager_id');
  for (const a of late) {
    stats.late += await inform(db, 'qhse.action_retard', {
      direct: [a.owner_id, a.manager_id], key: `qhse-retard:${a.id}:${isoDay(a.due_on)}`, link: `/qhse/actions?fiche=${a.id}`,
      title: `Action corrective en retard : ${a.reference}`, body: `${a.title} — échéance du ${Q.frDay(isoDay(a.due_on))}`,
    });
  }
  return stats;
}

module.exports = { dashboard, badges, directionPart, worksiteSummary, employeeRemarks, savLink, tick };
