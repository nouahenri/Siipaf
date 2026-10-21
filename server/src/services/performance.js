/**
 * ERP · RH › Performance : indicateurs individuels calculés depuis les données de l'ERP et du dashboard
 * (ventes, chantiers, SAV, pointages, congés, formations), atteinte des objectifs, tableau par service et
 * courbes par période (semaine, mois, trimestre, année).
 * Les données brutes d'un employé sont lues une fois (loadRaw), puis chaque période est calculée en JavaScript
 * (compute) : SQLite range les dates tantôt en texte, tantôt en millisecondes.
 */
const { toDate, isoDay } = require('../lib/http');
const { OBJECTIVE_METRICS, countDays, attainment, LEAVE_TYPES } = require('../lib/rh');
const { portfolioCounts } = require('../lib/domain');
const { DEPARTMENTS } = require('../lib/paie');

const UNPLANNED = ['maladie', 'accident_travail', 'sans_solde', 'absence_injustifiee'];
const HOUR = 3600000;
const round1 = n => Math.round(n * 10) / 10;
const avg = list => (list.length ? list.reduce((t, x) => t + x, 0) / list.length : null);
const dayStart = s => new Date(`${s}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 86400000) + 1; // bornes incluses

/** Familles d'indicateurs montrées pour un service (l'assiduité concerne tout le monde). */
const DEPARTMENT_GROUPS = {
  commercial: ['Commercial', 'Assiduité et formation'],
  technique: ['Chantier et technique', 'SAV et qualité', 'Assiduité et formation'],
  chantier: ['Chantier et technique', 'Assiduité et formation'],
};
const groupsFor = dept => DEPARTMENT_GROUPS[dept] || ['SAV et qualité', 'Assiduité et formation'];

/**
 * Données brutes d'un employé jusqu'à `to` (AAAA-MM-JJ inclus). Les requêtes commerciales reprennent celles de
 * commercial.achieved (dossiers non désistés du commercial, rendez-vous effectués, versements de ses dossiers).
 */
async function loadRaw(db, e, { settings = null, holidays = null } = {}) {
  const rh = require('./rh');
  const uid = e.user_id || null;
  const raw = {
    e, uid, settings: settings || await rh.getSettings(db), holidays: holidays || await rh.holidays(db),
    sales: [], rdv: [], payments: [], updates: [], reserves: [], interventions: [], tickets: [], site: [], leaves: [], trainings: [], portfolio: [],
  };
  const byUser = q => q.where('ld.assigned_to', uid);
  if (uid) {
    [raw.sales, raw.rdv, raw.payments, raw.updates, raw.reserves, raw.interventions, raw.tickets] = await Promise.all([
      byUser(db('sales as s').join('leads as ld', 'ld.id', 's.lead_id').whereNot('s.status', 'desiste')).select('s.price_fcfa as v', 's.created_at as d'),
      db('appointments').where({ status: 'effectue', assigned_to: uid }).select('starts_at as d'),
      byUser(db('payments as p').join('sales as s', 's.id', 'p.sale_id').join('leads as ld', 'ld.id', 's.lead_id')).select('p.amount_fcfa as v', 'p.paid_at as d'),
      db('site_updates').where({ created_by: uid }).select('published_at as d'),
      db('sav_reserves').where({ lifted_by: uid }).whereNotNull('lifted_at').select('lifted_at as d'),
      db('sav_interventions').where({ technician_id: uid }).whereNotNull('done_at').select('done_at as d'),
      db('sav_tickets').where({ assigned_to: uid }).whereNotNull('resolved_at').select('created_at', 'resolved_at as d', 'due_at', 'satisfaction'),
    ]);
    raw.portfolio = await db('lead_portfolio_events').where({ user_id: uid }).select('kind', 'at as d');
  }
  if (e.project_id) raw.site = await db('site_updates').where({ project_id: e.project_id }).select('lot_id', 'ilot', 'progress_pct', 'published_at as d');
  raw.leaves = (await db('hr_leaves').where({ employee_id: e.id, status: 'approuvee' }).whereIn('type', UNPLANNED).select('start_date', 'end_date'))
    .map(l => ({ s: isoDay(l.start_date), e: isoDay(l.end_date) }));
  raw.trainings = (await db('hr_training_participants as p').join('hr_trainings as t', 't.id', 'p.training_id')
    .where({ 'p.employee_id': e.id, 'p.status': 'present', 't.status': 'realisee' }).select('t.hours', 't.end_date'))
    .map(t => ({ hours: Number(t.hours) || 0, d: isoDay(t.end_date) }));
  for (const k of ['sales', 'rdv', 'payments', 'updates', 'reserves', 'interventions', 'tickets', 'site', 'portfolio']) for (const r of raw[k]) r.at = toDate(r.d);
  return raw;
}

/**
 * Valeurs réalisées sur une période [from, to] (dates incluses), arrêtées à aujourd'hui pour la période en cours.
 * Une valeur nulle signifie « non mesurable » (fiche sans compte, sans affectation, aucune donnée).
 */
function compute(raw, from, to, now = new Date()) {
  const { e, uid, settings: s, holidays } = raw;
  const lo = dayStart(from), hi = new Date(dayStart(to).getTime() + 86400000);
  const inRange = r => r.at && r.at >= lo && r.at < hi;
  const out = Object.fromEntries(Object.keys(OBJECTIVE_METRICS).filter(k => k !== 'manuel').map(k => [k, null]));
  if (uid) {
    const sold = raw.sales.filter(inRange);
    out.ventes = sold.length;
    out.ca_fcfa = sold.reduce((t, r) => t + Number(r.v), 0);
    out.encaissements_fcfa = raw.payments.filter(inRange).reduce((t, r) => t + Number(r.v), 0);
    out.rdv = raw.rdv.filter(inRange).length;
    const pf = portfolioCounts(raw.portfolio.filter(inRange));
    out.prospects_nets = pf.prospects.net;
    out.clients_nets = pf.clients.net;
    out.chantier_publications = raw.updates.filter(inRange).length;
    out.reserves_levees = raw.reserves.filter(inRange).length;
    out.interventions_realisees = raw.interventions.filter(inRange).length;
    const solved = raw.tickets.filter(inRange);
    out.sav_resolus = solved.length;
    const dated = solved.filter(t => t.due_at);
    out.sav_dans_delai = dated.length ? round1((dated.filter(t => t.at <= toDate(t.due_at)).length / dated.length) * 100) : null;
    const delays = solved.map(t => (t.at - toDate(t.created_at)) / HOUR).filter(h => h >= 0);
    out.sav_delai_moyen = delays.length ? round1(avg(delays)) : null;
    const notes = solved.map(t => t.satisfaction).filter(n => n != null).map(Number);
    out.sav_satisfaction = notes.length ? round1(avg(notes)) : null;
  }
  // Avancement du chantier d'affectation à la fin de la période : dernier % publié de chaque lot / îlot, en moyenne
  if (e.project_id) {
    const last = {};
    for (const u of raw.site.filter(u => u.at && u.at < hi).sort((a, b) => a.at - b.at)) last[u.lot_id || u.ilot || 'programme'] = Number(u.progress_pct);
    const values = Object.values(last);
    out.chantier_avancement = values.length ? round1(avg(values)) : null;
  }
  // Assiduité : jours ouvrables de présence attendue (contrat, jusqu'à aujourd'hui), moins les absences non planifiées
  const start = [from, isoDay(e.hire_date)].sort().pop();
  const end = [to, isoDay(now), isoDay(e.end_date) || '9999-12-31'].sort()[0];
  if (start <= end) {
    const opts = { holidays, workingDays: s.working_days };
    const expected = countDays(start, end, opts);
    const absent = raw.leaves.map(l => ({ s: l.s > start ? l.s : start, e: l.e < end ? l.e : end })).filter(l => l.s <= l.e)
      .reduce((t, l) => t + countDays(l.s, l.e, opts), 0);
    out.absences = absent;
    out.presence = expected ? round1((1 - absent / expected) * 100) : null;
  }
  out.formation_heures = raw.trainings.filter(t => t.d && t.d >= from && t.d <= to).reduce((t, x) => t + x.hours, 0);
  return out;
}

/** Valeurs réalisées d'un employé sur une année civile. */
async function actuals(db, e, year, ctx = {}) {
  return compute(await loadRaw(db, e, ctx), `${year}-01-01`, `${year}-12-31`, ctx.now);
}

/** Objectifs d'une année avec leur réalisé et leur atteinte, et le score pondéré de l'employé. */
async function scorecard(db, e, year, ctx = {}) {
  const rows = await db('hr_objectives').where({ employee_id: e.id, year }).orderBy('id');
  const values = rows.some(o => o.metric !== 'manuel') || ctx.withIndicators ? await actuals(db, e, year, ctx) : {};
  const today = isoDay(ctx.now || new Date());
  const objectives = rows.map(o => {
    const target = o.target_value == null ? null : Number(o.target_value);
    const auto = o.metric !== 'manuel';
    const actual = auto ? values[o.metric] ?? null : null;
    const progress = auto ? attainment(o.metric, actual, target) : Number(o.progress);
    const late = o.status === 'en_cours' && progress < 100 && o.due_date && isoDay(o.due_date) < today;
    return { ...o, due_date: isoDay(o.due_date), target_value: target, actual, progress, auto, late: !!late, unit: OBJECTIVE_METRICS[o.metric]?.unit || null };
  });
  const active = objectives.filter(o => o.status !== 'abandonne');
  const weight = active.reduce((t, o) => t + o.weight, 0);
  return {
    objectives, values,
    score: weight ? Math.round(active.reduce((t, o) => t + o.progress * o.weight, 0) / weight) : null,
    achieved: active.filter(o => o.progress >= 100 || o.status === 'atteint').length, late: active.filter(o => o.late).length,
  };
}

/** Indicateurs d'un employé regroupés par famille (celles de son service, plus toute famille où il a des résultats). */
function indicatorGroups(e, values) {
  const wanted = new Set(groupsFor(e.department));
  const groups = {};
  for (const [k, m] of Object.entries(OBJECTIVE_METRICS)) {
    if (k === 'manuel') continue;
    const v = values[k];
    if (!wanted.has(m.group) && !(v != null && v !== 0 && m.group !== 'Commercial')) continue;
    (groups[m.group] ||= []).push({ key: k, label: m.label, unit: m.unit, lower: !!m.lower, cumul: !!m.cumul, value: v ?? null, needs: m.needs || null });
  }
  return Object.entries(groups).map(([group, items]) => ({ group, items }));
}

// ─── Périodes ───────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const GRANULARITIES = ['semaine', 'mois', 'trimestre', 'annee'];

/** Découpe [from, to] en semaines (lundi → dimanche, numéro ISO), mois, trimestres ou années. */
function buckets(granularity, from, to) {
  const out = [];
  let cur = dayStart(from);
  if (granularity === 'semaine') cur.setUTCDate(cur.getUTCDate() - ((cur.getUTCDay() + 6) % 7));
  else if (granularity === 'mois') cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
  else if (granularity === 'trimestre') cur = new Date(Date.UTC(cur.getUTCFullYear(), Math.floor(cur.getUTCMonth() / 3) * 3, 1));
  else cur = new Date(Date.UTC(cur.getUTCFullYear(), 0, 1));
  const last = dayStart(to);
  while (cur <= last && out.length < 200) {
    const y = cur.getUTCFullYear(), m = cur.getUTCMonth();
    let next, key, label, title;
    if (granularity === 'semaine') {
      next = new Date(cur.getTime() + 7 * 86400000);
      const th = new Date(cur.getTime() + 3 * 86400000);
      const week = Math.ceil(((th - Date.UTC(th.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
      key = `${th.getUTCFullYear()}-S${pad(week)}`; label = `S${week}`;
      title = `Semaine ${week} · ${cur.getUTCDate()} ${MONTHS[m]} → ${new Date(next - 86400000).getUTCDate()} ${MONTHS[new Date(next - 86400000).getUTCMonth()]} ${new Date(next - 86400000).getUTCFullYear()}`;
    } else if (granularity === 'mois') {
      next = new Date(Date.UTC(y, m + 1, 1)); key = `${y}-${pad(m + 1)}`; label = `${MONTHS[m]} ${String(y).slice(2)}`;
      title = new Date(Date.UTC(y, m, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    } else if (granularity === 'trimestre') {
      next = new Date(Date.UTC(y, m + 3, 1)); key = `${y}-T${m / 3 + 1}`; label = `T${m / 3 + 1} ${String(y).slice(2)}`; title = `${m / 3 + 1}${m ? 'e' : 'er'} trimestre ${y}`;
    } else {
      next = new Date(Date.UTC(y + 1, 0, 1)); key = String(y); label = String(y); title = `Année ${y}`;
    }
    out.push({ key, label, title, from: isoDay(cur), to: isoDay(new Date(next - 86400000)) });
    cur = next;
  }
  return out;
}

/** Avancement d'un objectif suivi à la main à une date : dernier point enregistré (ou l'avancement actuel s'il n'y en a pas). */
function manualProgress(o, checkins, date) {
  const list = checkins.filter(c => c.objective_id === o.id);
  if (!list.length) return Number(o.progress);
  const before = list.filter(c => c.date <= date).sort((a, b) => a.date.localeCompare(b.date)).pop();
  return before ? before.progress : 0;
}

/**
 * Courbes d'un employé : pour chaque période, réalisé des indicateurs et score pondéré des objectifs de l'année de
 * la période (cible annuelle proratisée pour les indicateurs cumulés) ; pour chaque objectif cumulé, trajectoire de
 * l'année (cumul depuis le 1er janvier comparé à la cible au prorata du temps écoulé).
 */
async function series(db, e, { granularity = 'mois', from, to, now = new Date() }) {
  if (!GRANULARITIES.includes(granularity)) granularity = 'mois';
  const list = buckets(granularity, from, to);
  const raw = await loadRaw(db, e);
  const years = [...new Set(list.flatMap(b => [b.from.slice(0, 4), b.to.slice(0, 4)]))].map(Number);
  const objectives = (await db('hr_objectives').where({ employee_id: e.id }).whereIn('year', years).whereNot('status', 'abandonne').orderBy(['year', 'id']))
    .map(o => ({ ...o, target_value: o.target_value == null ? null : Number(o.target_value), meta: OBJECTIVE_METRICS[o.metric] || OBJECTIVE_METRICS.manuel }));
  const checkins = (await db('hr_objective_checkins').whereIn('objective_id', objectives.map(o => o.id).concat(0)).select('objective_id', 'date', 'progress'))
    .map(c => ({ ...c, date: isoDay(c.date), progress: Number(c.progress) }));
  const today = isoDay(now);
  const yearDays = y => daysBetween(`${y}-01-01`, `${y}-12-31`);
  const points = Object.fromEntries(objectives.map(o => [o.id, []]));

  const rows = list.map(b => {
    const future = b.from > today;
    const values = future ? {} : compute(raw, b.from, b.to, now);
    const year = Number(b.from.slice(0, 4));
    let weighted = 0, weights = 0;
    for (const o of objectives.filter(x => x.year === year)) {
      const end = b.to < `${year}-12-31` ? b.to : `${year}-12-31`;
      if (future) { points[o.id].push({ key: b.key, actual: null, target: null, attainment: null, ytd: null, ytd_target: null }); continue; }
      let att, target = o.target_value, actual = null, ytd = null, ytdTarget = null;
      if (o.metric === 'manuel') {
        att = manualProgress(o, checkins, end < today ? end : today);
      } else {
        actual = values[o.metric] ?? null;
        if (o.meta.cumul && target != null) {
          // Cible de la période au prorata de sa part de l'année ; trajectoire depuis le 1er janvier
          const overlap = daysBetween(b.from > `${year}-01-01` ? b.from : `${year}-01-01`, end);
          target = Math.round((target * overlap / yearDays(year)) * 10) / 10;
          const stop = end < today ? end : today;
          ytd = compute(raw, `${year}-01-01`, stop, now)[o.metric] ?? null;
          ytdTarget = Math.round((o.target_value * daysBetween(`${year}-01-01`, stop) / yearDays(year)) * 10) / 10;
        }
        att = attainment(o.metric, actual, target);
      }
      points[o.id].push({ key: b.key, actual, target, attainment: att, ytd, ytd_target: ytdTarget });
      weighted += att * o.weight; weights += o.weight;
    }
    return { ...b, future, score: weights && !future ? Math.round(weighted / weights) : null, values };
  });

  const metrics = indicatorGroups(e, rows.find(r => !r.future)?.values || {}).flatMap(g => g.items.map(i => ({ ...i, group: g.group, value: undefined })));
  return {
    employee: { id: e.id, name: `${e.last_name} ${e.first_name}`, matricule: e.matricule, department: e.department, job_title: e.job_title },
    granularity, from, to, buckets: rows, metrics,
    objectives: objectives.map(o => ({
      id: o.id, year: o.year, title: o.title, metric: o.metric, label: o.meta.label, unit: o.meta.unit || null, cumul: !!o.meta.cumul, lower: !!o.meta.lower,
      weight: o.weight, target_value: o.target_value, points: points[o.id],
    })),
  };
}

/**
 * Tableau de performance par service : score moyen (employés ayant des objectifs), comparaison avec l'année
 * précédente, objectifs atteints et en retard, assiduité et formation, classement des employés.
 */
async function departmentReport(db, year, { now = new Date(), employeeIds = null } = {}) {
  const rh = require('./rh');
  const ctx = { now, settings: await rh.getSettings(db), holidays: await rh.holidays(db), withIndicators: true };
  const q = db('employees').where({ active: true }).orderBy(['last_name', 'first_name']);
  if (employeeIds) q.whereIn('id', employeeIds);
  const people = (await q).map(rh.normEmployee);
  const rows = [];
  for (const e of people) {
    const cur = await scorecard(db, e, year, ctx);
    const prev = await scorecard(db, e, year - 1, { ...ctx, withIndicators: false });
    rows.push({
      employee_id: e.id, matricule: e.matricule, name: `${e.last_name} ${e.first_name}`, job_title: e.job_title, department: e.department,
      score: cur.score, prev_score: prev.score, objectives: cur.objectives.length, achieved: cur.achieved, late: cur.late,
      presence: cur.values.presence, absences: cur.values.absences, formation_heures: cur.values.formation_heures, indicators: indicatorGroups(e, cur.values),
    });
  }
  const summarize = (list, key, label) => {
    const scored = list.filter(r => r.score != null);
    const prev = list.filter(r => r.prev_score != null);
    const pres = list.map(r => r.presence).filter(v => v != null);
    return {
      key, label, headcount: list.length, scored: scored.length,
      score: scored.length ? Math.round(avg(scored.map(r => r.score))) : null, prev_score: prev.length ? Math.round(avg(prev.map(r => r.prev_score))) : null,
      objectives: list.reduce((t, r) => t + r.objectives, 0), achieved: list.reduce((t, r) => t + r.achieved, 0), late: list.reduce((t, r) => t + r.late, 0),
      presence: pres.length ? round1(avg(pres)) : null, absences: list.reduce((t, r) => t + (r.absences || 0), 0), formation_heures: list.reduce((t, r) => t + (r.formation_heures || 0), 0),
      employees: [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, 'fr')),
    };
  };
  const departments = Object.entries(DEPARTMENTS).map(([k, label]) => summarize(rows.filter(r => r.department === k), k, label)).filter(d => d.headcount);
  return { year, overall: summarize(rows, 'tous', 'Toute l’entreprise'), departments, unplanned: UNPLANNED.map(k => LEAVE_TYPES[k].label) };
}

module.exports = { loadRaw, compute, actuals, scorecard, indicatorGroups, buckets, series, departmentReport, groupsFor, GRANULARITIES };
