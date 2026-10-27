/**
 * ERP · RH › Performance : indicateurs individuels calculés depuis les données de l'ERP et du dashboard
 * (ventes, chantiers, SAV, pointages, congés, formations, comptabilité, juridique, administration générale), indicateurs
 * mesurés sur un service entier (clôtures, fournisseurs, paie, actes, parc), atteinte des objectifs sur une période
 * (année, trimestre, mois), tableau par service avec ses objectifs collectifs et courbes par période.
 * Les données brutes d'un employé sont lues une fois (loadRaw), puis chaque période est calculée en JavaScript
 * (compute) : SQLite range les dates tantôt en texte, tantôt en millisecondes.
 *
 * Règles des périodes (docs/cadrage-kpi-referentiels.md) : un objectif est évalué sur la partie commune de sa période et
 * de la période affichée (cible d'un indicateur cumulé au prorata des jours) ; les objectifs d'un même indicateur et d'un
 * même découpage (ex. les 12 objectifs mensuels de CA) forment une ligne : cibles et réalisés additionnés pour un
 * indicateur cumulé, cible moyenne et réalisé sur l'ensemble de la période pour un taux, un délai ou une note.
 */
const { toDate, isoDay } = require('../lib/http');
const { OBJECTIVE_METRICS, countDays, attainment, LEAVE_TYPES, periodRange, periodLabel, previousPeriod } = require('../lib/rh');
const { portfolioCounts } = require('../lib/domain');
const { DEPARTMENTS } = require('../lib/paie');

const UNPLANNED = ['maladie', 'accident_travail', 'sans_solde', 'absence_injustifiee'];
const HOUR = 3600000;
const DAY = 86400000;
const round1 = n => Math.round(n * 10) / 10;
const avg = list => (list.length ? list.reduce((t, x) => t + x, 0) / list.length : null);
const pct = (ok, list) => (list.length ? round1((ok / list.length) * 100) : null);
const dayStart = s => new Date(`${s}T00:00:00Z`);
const dayEnd = s => new Date(dayStart(s).getTime() + DAY); // exclu
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY) + 1; // bornes incluses
const minDay = (a, b) => (a < b ? a : b);

/** Familles d'indicateurs montrées pour un service (l'assiduité concerne tout le monde). */
const DEPARTMENT_GROUPS = {
  commercial: ['Commercial', 'Assiduité et formation'],
  technique: ['Chantier et technique', 'SAV et qualité', 'Assiduité et formation'],
  chantier: ['Chantier et technique', 'Assiduité et formation'],
  comptabilite: ['Comptabilité', 'Assiduité et formation'],
  juridique: ['Juridique', 'Assiduité et formation'],
  administratif: ['Administration générale', 'Assiduité et formation'],
};
const groupsFor = dept => DEPARTMENT_GROUPS[dept] || ['SAV et qualité', 'Assiduité et formation'];
const isServiceMetric = k => OBJECTIVE_METRICS[k]?.level === 'service';

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
    entries: [], litigations: [], guarantees: [], mails: [], requests: [], actions: [],
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
    // Services support : écritures validées, contentieux et garanties suivis, courriers, demandes internes, actions
    [raw.entries, raw.litigations, raw.guarantees, raw.mails, raw.requests, raw.actions] = await Promise.all([
      db('acc_entries').where({ validated_by: uid, status: 'valide' }).whereNotNull('validated_at').select('validated_at as d', 'created_at'),
      db('litigations').where({ owner_id: uid }).select('opened_on', 'closed_on', 'next_date'),
      db('guarantees').where({ owner_id: uid }).select('expires_on', 'status', 'closed_on'),
      db('mail_items').where({ assigned_to: uid }).whereNotNull('done_at').select('done_at as d', 'due_date', 'assigned_at', 'date'),
      db('internal_requests').where({ handled_by: uid, status: 'traitee' }).whereNotNull('closed_at').select('closed_at as d', 'created_at', 'manager_at', 'dg_at'),
      db('internal_doc_actions').where({ owner_id: uid }).whereNotNull('done_at').select('done_at as d', 'due_date'),
    ]);
    raw.litigations = raw.litigations.map(l => ({ opened: isoDay(l.opened_on), closed: isoDay(l.closed_on), next: isoDay(l.next_date) }));
    raw.guarantees = raw.guarantees.map(g => ({ expires: isoDay(g.expires_on), status: g.status, closed: isoDay(g.closed_on) }));
  }
  if (e.project_id) raw.site = await db('site_updates').where({ project_id: e.project_id }).select('lot_id', 'ilot', 'progress_pct', 'published_at as d');
  raw.leaves = (await db('hr_leaves').where({ employee_id: e.id, status: 'approuvee' }).whereIn('type', UNPLANNED).select('start_date', 'end_date'))
    .map(l => ({ s: isoDay(l.start_date), e: isoDay(l.end_date) }));
  raw.trainings = (await db('hr_training_participants as p').join('hr_trainings as t', 't.id', 'p.training_id')
    .where({ 'p.employee_id': e.id, 'p.status': 'present', 't.status': 'realisee' }).select('t.hours', 't.end_date'))
    .map(t => ({ hours: Number(t.hours) || 0, d: isoDay(t.end_date) }));
  for (const k of ['sales', 'rdv', 'payments', 'updates', 'reserves', 'interventions', 'tickets', 'site', 'portfolio', 'entries', 'mails', 'requests', 'actions']) for (const r of raw[k]) r.at = toDate(r.d);
  return raw;
}

/** Durée moyenne en jours entre deux horodatages (arrondie au dixième). */
const meanDays = list => { const d = list.filter(([a, b]) => a && b && b >= a).map(([a, b]) => (b - a) / DAY); return d.length ? round1(avg(d)) : null; };
/** Part des éléments faits au plus tard le jour de leur échéance. */
const onTime = list => { const dated = list.filter(r => r.due_date); return pct(dated.filter(r => r.at < dayEnd(isoDay(r.due_date))).length, dated); };

/**
 * Valeurs réalisées sur une période [from, to] (dates incluses), arrêtées à aujourd'hui pour la période en cours.
 * Une valeur nulle signifie « non mesurable » (fiche sans compte, sans affectation, aucune donnée).
 */
function compute(raw, from, to, now = new Date()) {
  const { e, uid, settings: s, holidays } = raw;
  const lo = dayStart(from), hi = dayEnd(to);
  const inRange = r => r.at && r.at >= lo && r.at < hi;
  const stop = minDay(to, isoDay(now)); // stocks lus à la fin de la période (ou aujourd'hui)
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
    // Comptabilité
    const entries = raw.entries.filter(inRange);
    out.cpt_ecritures = entries.length;
    out.cpt_delai_valid = meanDays(entries.map(r => [toDate(r.created_at), r.at]));
    // Juridique : contentieux clos sur la période ; contentieux ouverts et garanties échues à la fin de la période
    out.jur_contentieux_clos = raw.litigations.filter(l => l.closed && l.closed >= from && l.closed <= to).length;
    out.jur_sans_echeance = raw.litigations.filter(l => l.opened && l.opened <= stop && (!l.closed || l.closed > stop) && (!l.next || l.next < stop)).length;
    out.jur_garanties_echues = raw.guarantees.filter(g => g.expires && g.expires < stop && (g.status === 'active' || (g.closed && g.closed > stop))).length;
    // Administration générale
    const mails = raw.mails.filter(inRange);
    out.adm_courriers_delai = onTime(mails);
    out.adm_courriers_duree = meanDays(mails.map(m => [toDate(m.assigned_at) || dayStart(isoDay(m.date)), m.at]));
    const requests = raw.requests.filter(inRange);
    out.adm_demandes_ok = requests.length;
    out.adm_demandes_duree = meanDays(requests.map(r => [toDate(r.dg_at) || toDate(r.manager_at) || toDate(r.created_at), r.at]));
    out.adm_actions_delai = onTime(raw.actions.filter(inRange));
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

// ─── Indicateurs mesurés sur un service entier ──────────────
/** Données de toute l'entreprise pour les indicateurs de niveau « service » (lues une fois par calcul). */
async function loadServiceRaw(db) {
  const ct = require('./compta');
  const [settings, locks, invoices, payments, runs, files, plans] = await Promise.all([
    ct.getSettings(db),
    db('acc_lock_history').whereNotNull('lock_date').select('lock_date', 'created_at'),
    db('purchase_invoices').where({ status: 'validee' }).whereNotNull('due_date').select('id', 'due_date', 'amount_ttc'),
    db('purchase_payments').select('invoice_id', 'date', 'amount'),
    db('payroll_runs').select('period', 'validated_at'),
    db('legal_sale_files').whereNotNull('remise_on').select('reservation_on', 'remise_on'),
    db('asset_maintenance_plans as m').join('assets as a', 'a.id', 'm.asset_id').where('m.active', true).whereNot('a.status', 'reforme').whereNotNull('m.every_months').select('m.every_months', 'm.last_date'),
  ]);
  const paid = {};
  for (const p of payments.map(p => ({ ...p, date: isoDay(p.date) })).sort((a, b) => a.date.localeCompare(b.date))) (paid[p.invoice_id] ||= []).push(p);
  return {
    closeDay: Number(settings.close_day) || 10,
    locks: locks.map(l => ({ lock: isoDay(l.lock_date), at: toDate(l.created_at) })).filter(l => l.at),
    invoices: invoices.map(i => {
      // Jour où les règlements cumulés atteignent le montant TTC (null : pas encore soldée)
      let sum = 0, settled = null;
      for (const p of paid[i.id] || []) { sum += Number(p.amount); if (sum >= Number(i.amount_ttc)) { settled = p.date; break; } }
      return { due: isoDay(i.due_date), settled };
    }),
    runs: runs.map(r => ({ period: r.period, validated: toDate(r.validated_at) })),
    files: files.map(f => ({ reserved: isoDay(f.reservation_on), handed: isoDay(f.remise_on) })),
    plans: plans.map(p => ({ months: Number(p.every_months), last: isoDay(p.last_date) })),
  };
}

const monthEnd = (y, m) => isoDay(new Date(Date.UTC(y, m, 0))); // m : 1 à 12
const addMonths = (day, n) => { const d = dayStart(day); return isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), 28)))); };
/** Mois (année, numéro) dont le dernier jour tombe dans [from, to]. */
function monthsEnding(from, to) {
  const out = [];
  for (let d = dayStart(from.slice(0, 8) + '01'); isoDay(d) <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    const end = monthEnd(y, m);
    if (end >= from && end <= to) out.push({ y, m, end, key: `${y}-${String(m).padStart(2, '0')}` });
  }
  return out;
}

/** Indicateurs de niveau « service » sur [from, to] (null : rien de mesurable sur la période). */
function computeService(sraw, from, to, now = new Date()) {
  const today = isoDay(now);
  const stop = minDay(to, today);
  const out = {};
  // Clôture du mois M à temps : verrouillage jusqu'à la fin de M enregistré au plus tard le jour J du mois suivant.
  // Seuls les mois dont l'échéance est passée et postérieure au début de l'historique des verrouillages sont mesurés.
  const tracked = sraw.locks.length ? isoDay(new Date(Math.min(...sraw.locks.map(l => l.at.getTime())))) : null;
  const closings = monthsEnding(from, to).map(M => ({ ...M, deadline: isoDay(new Date(Date.UTC(M.y, M.m, sraw.closeDay))) }))
    .filter(M => tracked && M.deadline <= today && M.deadline >= tracked);
  out.cpt_cloture = pct(closings.filter(M => sraw.locks.some(l => l.lock >= M.end && l.at < dayEnd(M.deadline))).length, closings);
  // Factures fournisseurs arrivées à échéance sur la période
  const due = sraw.invoices.filter(i => i.due >= from && i.due <= stop);
  out.cpt_fourn_echeance = pct(due.filter(i => i.settled && i.settled <= i.due).length, due);
  out.cpt_fourn_retard = due.length ? round1(avg(due.map(i => Math.max(0, daysBetween(i.due, i.settled || today) - 1)))) : null;
  // Paie du mois validée au plus tard le dernier jour du mois (mois écoulés, depuis la première paie préparée)
  const first = sraw.runs.map(r => r.period).sort()[0];
  const months = first ? monthsEnding(from, to).filter(M => M.end < today && M.key >= first) : [];
  out.cpt_paie_a_temps = pct(months.filter(M => sraw.runs.some(r => r.period === M.key && r.validated && r.validated < dayEnd(M.end))).length, months);
  // Juridique : actes remis sur la période et délai depuis la réservation
  const handed = sraw.files.filter(f => f.handed >= from && f.handed <= to);
  out.jur_actes_remis = handed.length;
  const delays = handed.filter(f => f.reserved && f.reserved <= f.handed).map(f => daysBetween(f.reserved, f.handed) - 1);
  out.jur_delai_acte = delays.length ? round1(avg(delays)) : null;
  // Parc : plans d'entretien périodiques à jour à la fin de la période
  out.adm_parc_entretiens = pct(sraw.plans.filter(p => p.last && addMonths(p.last, p.months) >= stop).length, sraw.plans);
  return out;
}

/** Valeur d'un service pour un indicateur individuel : somme (cumulé) ou moyenne de ses employés. */
function aggregate(metric, list) {
  const values = list.map(v => v[metric]).filter(v => v != null).map(Number);
  if (!values.length) return null;
  return OBJECTIVE_METRICS[metric]?.cumul ? values.reduce((t, v) => t + v, 0) : round1(avg(values));
}

// ─── Évaluation des objectifs sur une période ───────────────
const metaOf = o => OBJECTIVE_METRICS[o.metric] || OBJECTIVE_METRICS.manuel;
const rangeOf = o => periodRange(o.year, o.period || 'annee', o.period_index);
const intersect = (a, b) => { const from = a.from > b.from ? a.from : b.from; const to = a.to < b.to ? a.to : b.to; return from <= to ? { from, to } : null; };
/** Période affichée : un nombre est une année civile. */
const asPeriod = p => (typeof p === 'number' ? { year: p, period: 'annee', index: null, ...periodRange(p), label: periodLabel(p) } : p);
const thresholds = (kpis, id) => ({ warn_pct: kpis[id]?.warn_pct ?? 50, ok_pct: kpis[id]?.ok_pct ?? 100 });
const groupTitle = (kpis, o) => `${kpis[o.kpi_id]?.name || metaOf(o).label} — objectifs ${o.period === 'mois' ? 'mensuels' : 'trimestriels'}`;

/** Avancement d'un objectif suivi à la main à une date : dernier point enregistré (ou l'avancement actuel s'il n'y en a pas). */
function manualProgress(o, checkins, date) {
  const list = checkins.filter(c => c.objective_id === o.id);
  if (!list.length) return Number(o.progress);
  const before = list.filter(c => c.date <= date).sort((a, b) => a.date.localeCompare(b.date)).pop();
  return before ? before.progress : 0;
}

/**
 * Évalue des objectifs (individuels ou d'un service) sur la période P. `valuesOf(from, to)` donne les réalisés.
 * Retourne chaque objectif (sur sa partie de P) et les lignes qui forment le score (voir l'en-tête du fichier).
 */
function evaluate(objectives, P, { valuesOf, checkins = [], kpis = {}, now = new Date() }) {
  const today = isoDay(now);
  const items = [];
  for (const o of objectives) {
    const R = rangeOf(o);
    const I = intersect(R, P);
    if (!I) continue;
    const m = metaOf(o);
    const auto = o.metric !== 'manuel';
    const full = o.target_value == null ? null : Number(o.target_value);
    let target = full, actual = null, progress;
    // Suivi manuel : avancement actuel sur toute la période de l'objectif, point daté de l'historique sur une partie
    if (!auto) progress = I.from === R.from && I.to === R.to ? Number(o.progress) : manualProgress(o, checkins, minDay(I.to, today));
    else {
      if (m.cumul && full != null && (I.from !== R.from || I.to !== R.to)) target = round1(full * daysBetween(I.from, I.to) / daysBetween(R.from, R.to));
      actual = I.from > today ? null : valuesOf(I.from, I.to)[o.metric] ?? null;
      progress = attainment(o.metric, actual, target);
    }
    const late = o.status === 'en_cours' && progress < 100 && o.due_date && isoDay(o.due_date) < today;
    items.push({ o, I, auto, m, target, actual, progress, late: !!late });
  }
  // Lignes : objectifs mensuels ou trimestriels d'un même indicateur regroupés (hors objectifs abandonnés) ; un objectif
  // annuel, manuel, ou qui doublonne une période déjà présente forme sa propre ligne
  const groups = new Map();
  for (const it of items.filter(x => x.o.status !== 'abandonne')) {
    let key = it.auto && it.o.period && it.o.period !== 'annee' ? `${it.o.metric}|${it.o.period}` : `o${it.o.id}`;
    if (groups.get(key)?.some(x => x.o.period_index === it.o.period_index)) key = `o${it.o.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const lines = [...groups.entries()].map(([key, list]) => {
    const first = list[0];
    const { o, m } = first;
    const base = {
      key, id: key.startsWith('o') ? o.id : key, kpi_id: o.kpi_id || null, metric: o.metric, period: o.period || 'annee', count: list.length, ids: list.map(x => x.o.id),
      auto: first.auto, label: m.label, unit: m.unit || null, cumul: !!m.cumul, lower: !!m.lower, ...thresholds(kpis, o.kpi_id),
      weight: Math.round(avg(list.map(x => x.o.weight))), late: list.filter(x => x.late).length,
    };
    if (list.length === 1) {
      return { ...base, title: o.title, target: first.target, actual: first.actual, progress: first.progress, achieved: first.progress >= 100 || o.status === 'atteint' };
    }
    let target, actual;
    if (m.cumul) {
      const targets = list.map(x => x.target).filter(v => v != null);
      target = targets.length ? round1(targets.reduce((t, v) => t + v, 0)) : null;
      const actuals = list.map(x => x.actual).filter(v => v != null);
      actual = actuals.length ? round1(actuals.reduce((t, v) => t + v, 0)) : null;
    } else {
      const dated = list.filter(x => x.target != null);
      const days = dated.reduce((t, x) => t + daysBetween(x.I.from, x.I.to), 0);
      target = days ? round1(dated.reduce((t, x) => t + x.target * daysBetween(x.I.from, x.I.to), 0) / days) : null;
      const from = list.map(x => x.I.from).sort()[0];
      const to = list.map(x => x.I.to).sort().pop();
      actual = from > today ? null : valuesOf(from, to)[o.metric] ?? null;
    }
    const progress = attainment(o.metric, actual, target);
    return { ...base, title: groupTitle(kpis, o), target, actual, progress, achieved: progress >= 100 };
  });
  const weight = lines.reduce((t, l) => t + l.weight, 0);
  const active = items.filter(x => x.o.status !== 'abandonne');
  return {
    items, lines,
    score: weight ? Math.round(lines.reduce((t, l) => t + l.progress * l.weight, 0) / weight) : null,
    achieved: active.filter(x => x.progress >= 100 || x.o.status === 'atteint').length, late: active.filter(x => x.late).length, count: active.length,
  };
}

/** Objectif tel qu'affiché : période, cible d'origine et de la période affichée, réalisé, atteinte, seuils. */
function serializeItem(x, kpis) {
  const { o } = x;
  const period = o.period || 'annee';
  return {
    ...o, period, period_index: o.period_index ?? null, period_label: periodLabel(o.year, period, o.period_index), due_date: isoDay(o.due_date),
    target_value: o.target_value == null ? null : Number(o.target_value), target: x.target, actual: x.actual, progress: x.progress, auto: x.auto, late: x.late,
    unit: x.m.unit || null, lower: !!x.m.lower, adjusted: !!o.adjusted, kpi_name: kpis[o.kpi_id]?.name || null, ...thresholds(kpis, o.kpi_id),
  };
}

/** Contexte partagé d'un calcul : réglages, fériés, référentiel, données brutes déjà lues. */
async function context(db, ctx = {}) {
  const rh = require('./rh');
  if (!ctx.settings) ctx.settings = await rh.getSettings(db);
  if (!ctx.holidays) ctx.holidays = await rh.holidays(db);
  if (!ctx.kpis) ctx.kpis = Object.fromEntries((await db('hr_kpis').select('id', 'name', 'warn_pct', 'ok_pct')).map(k => [k.id, k]));
  if (!ctx.raws) ctx.raws = new Map();
  return ctx;
}
async function rawOf(db, e, ctx) {
  if (!ctx.raws.has(e.id)) ctx.raws.set(e.id, await loadRaw(db, e, ctx));
  return ctx.raws.get(e.id);
}
/** Réalisés mémorisés par période. */
function memo(fn) {
  const cache = new Map();
  return (from, to) => { const k = `${from}|${to}`; if (!cache.has(k)) cache.set(k, fn(from, to)); return cache.get(k); };
}
async function checkinsOf(db, ids) {
  return ids.length ? (await db('hr_objective_checkins').whereIn('objective_id', ids).select('objective_id', 'date', 'progress')).map(c => ({ ...c, date: isoDay(c.date), progress: Number(c.progress) })) : [];
}

/** Valeurs réalisées d'un employé sur une année civile. */
async function actuals(db, e, year, ctx = {}) {
  return compute(await loadRaw(db, e, ctx), `${year}-01-01`, `${year}-12-31`, ctx.now);
}

/** Objectifs d'un employé sur une période (année, trimestre ou mois), avec leur réalisé, leur atteinte et le score pondéré. */
async function scorecard(db, e, periodOrYear, ctx = {}) {
  const P = asPeriod(periodOrYear);
  await context(db, ctx);
  const now = ctx.now || new Date();
  const rows = await db('hr_objectives').where({ employee_id: e.id, year: P.year }).orderBy(['period_index', 'id']);
  const needs = rows.some(o => o.metric !== 'manuel') || ctx.withIndicators;
  const valuesOf = needs ? memo((from, to) => compute(ctx.raws.get(e.id), from, to, now)) : () => ({});
  if (needs) await rawOf(db, e, ctx);
  const ev = evaluate(rows, P, { valuesOf, checkins: await checkinsOf(db, rows.filter(o => o.metric === 'manuel').map(o => o.id)), kpis: ctx.kpis, now });
  return {
    period: P, objectives: ev.items.map(x => serializeItem(x, ctx.kpis)), lines: ev.lines, values: needs ? valuesOf(P.from, P.to) : {},
    score: ev.score, achieved: ev.achieved, late: ev.late,
  };
}

/** Indicateurs d'un employé regroupés par famille (celles de son service, plus toute famille où il a des résultats). */
function indicatorGroups(e, values) {
  const wanted = new Set(groupsFor(e.department));
  const groups = {};
  for (const [k, m] of Object.entries(OBJECTIVE_METRICS)) {
    if (k === 'manuel' || m.level === 'service') continue;
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
      next = new Date(cur.getTime() + 7 * DAY);
      const th = new Date(cur.getTime() + 3 * DAY);
      const week = Math.ceil(((th - Date.UTC(th.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
      key = `${th.getUTCFullYear()}-S${pad(week)}`; label = `S${week}`;
      title = `Semaine ${week} · ${cur.getUTCDate()} ${MONTHS[m]} → ${new Date(next - DAY).getUTCDate()} ${MONTHS[new Date(next - DAY).getUTCMonth()]} ${new Date(next - DAY).getUTCFullYear()}`;
    } else if (granularity === 'mois') {
      next = new Date(Date.UTC(y, m + 1, 1)); key = `${y}-${pad(m + 1)}`; label = `${MONTHS[m]} ${String(y).slice(2)}`;
      title = new Date(Date.UTC(y, m, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    } else if (granularity === 'trimestre') {
      next = new Date(Date.UTC(y, m + 3, 1)); key = `${y}-T${m / 3 + 1}`; label = `T${m / 3 + 1} ${String(y).slice(2)}`; title = `${m / 3 + 1}${m ? 'e' : 'er'} trimestre ${y}`;
    } else {
      next = new Date(Date.UTC(y + 1, 0, 1)); key = String(y); label = String(y); title = `Année ${y}`;
    }
    out.push({ key, label, title, from: isoDay(cur), to: isoDay(new Date(next - DAY)) });
    cur = next;
  }
  return out;
}

/**
 * Courbes d'un employé : pour chaque période, réalisé des indicateurs et score pondéré des objectifs qui la couvrent
 * (cible proratisée pour les indicateurs cumulés) ; une courbe par ligne d'objectifs (un objectif, ou les objectifs
 * mensuels / trimestriels d'un même indicateur) ; pour un objectif annuel cumulé, trajectoire de l'année (cumul depuis
 * le 1er janvier comparé à la cible au prorata du temps écoulé).
 */
async function series(db, e, { granularity = 'mois', from, to, now = new Date() }) {
  if (!GRANULARITIES.includes(granularity)) granularity = 'mois';
  const ctx = await context(db, { now });
  const list = buckets(granularity, from, to);
  const raw = await rawOf(db, e, ctx);
  const valuesOf = memo((a, b) => compute(raw, a, b, now));
  const years = [...new Set(list.flatMap(b => [b.from.slice(0, 4), b.to.slice(0, 4)]))].map(Number);
  const objectives = await db('hr_objectives').where({ employee_id: e.id }).whereIn('year', years).orderBy(['year', 'period_index', 'id']);
  const checkins = await checkinsOf(db, objectives.filter(o => o.metric === 'manuel').map(o => o.id));
  const today = isoDay(now);
  const yearDays = y => daysBetween(`${y}-01-01`, `${y}-12-31`);
  const lines = new Map(); // clé → description de la ligne et points par période
  const describe = (l, o) => ({
    id: l.id, key: l.key, year: o.year, title: l.title, metric: l.metric, label: l.label, unit: l.unit, cumul: l.cumul, lower: l.lower,
    period: l.period, count: l.count, weight: l.weight, target_value: l.key.startsWith('o') && o.target_value != null ? Number(o.target_value) : null, points: {},
  });

  const rows = list.map(b => {
    const future = b.from > today;
    const values = future ? {} : valuesOf(b.from, b.to);
    const ev = evaluate(objectives, b, { valuesOf, checkins, kpis: ctx.kpis, now });
    for (const l of ev.lines) {
      // Une même ligne garde sa clé d'une période à l'autre : objectif seul (son identifiant) ou indicateur et découpage
      const first = objectives.find(o => o.id === l.ids[0]);
      const key = l.key;
      if (!lines.has(key)) lines.set(key, describe(key.startsWith('o') ? l : { ...l, title: groupTitle(ctx.kpis, first) }, first));
      const line = lines.get(key);
      line.count = Math.max(line.count, l.count);
      let ytd = null, ytdTarget = null;
      if (!future && l.count === 1 && l.auto && l.cumul && (first.period || 'annee') === 'annee' && first.target_value != null) {
        const stop = minDay(minDay(b.to, `${first.year}-12-31`), today);
        ytd = valuesOf(`${first.year}-01-01`, stop)[first.metric] ?? null;
        ytdTarget = round1(Number(first.target_value) * daysBetween(`${first.year}-01-01`, stop) / yearDays(first.year));
      }
      line.points[b.key] = future ? { key: b.key, actual: null, target: null, attainment: null, ytd: null, ytd_target: null }
        : { key: b.key, actual: l.actual, target: l.target, attainment: l.progress, ytd, ytd_target: ytdTarget };
    }
    return { ...b, future, score: future ? null : ev.score, values };
  });

  const metrics = indicatorGroups(e, rows.find(r => !r.future)?.values || {}).flatMap(g => g.items.map(i => ({ ...i, group: g.group, value: undefined })));
  return {
    employee: { id: e.id, name: `${e.last_name} ${e.first_name}`, matricule: e.matricule, department: e.department, job_title: e.job_title },
    granularity, from, to, buckets: rows, metrics,
    objectives: [...lines.values()].map(l => ({ ...l, points: list.map(b => l.points[b.key] || { key: b.key, actual: null, target: null, attainment: null, ytd: null, ytd_target: null }) })),
  };
}

// ─── Objectifs collectifs et tableau par service ────────────
/** Objectifs collectifs des services sur une période, évalués avec les indicateurs du service. */
async function departmentObjectives(db, P, ctx, staff) {
  const rows = await db('hr_department_objectives').where({ year: P.year }).orderBy(['department', 'period_index', 'id']);
  const out = {};
  if (!rows.length) return out;
  const now = ctx.now || new Date();
  if (!ctx.serviceRaw && rows.some(o => isServiceMetric(o.metric))) ctx.serviceRaw = await loadServiceRaw(db);
  for (const dept of Object.keys(DEPARTMENTS)) {
    const mine = rows.filter(o => o.department === dept);
    if (!mine.length) continue;
    const people = staff.filter(e => e.department === dept);
    if (mine.some(o => o.metric !== 'manuel' && !isServiceMetric(o.metric))) for (const e of people) await rawOf(db, e, ctx);
    const valuesOf = memo((from, to) => {
      const values = ctx.serviceRaw ? computeService(ctx.serviceRaw, from, to, now) : {};
      const each = people.map(e => compute(ctx.raws.get(e.id), from, to, now));
      for (const o of mine) if (o.metric !== 'manuel' && !isServiceMetric(o.metric)) values[o.metric] = aggregate(o.metric, each);
      return values;
    });
    // Suivi manuel d'un objectif collectif : son avancement actuel (pas d'historique daté)
    const ev = evaluate(mine, P, { valuesOf, kpis: ctx.kpis, now });
    out[dept] = { objectives: ev.items.map(x => serializeItem(x, ctx.kpis)), lines: ev.lines, score: ev.score, achieved: ev.achieved, late: ev.late };
  }
  return out;
}

/** Score d'un service : part des objectifs collectifs (réglage RH) et moyenne de ses employés. */
function blend(collective, employees, share) {
  if (collective == null) return employees;
  if (employees == null) return collective;
  return Math.round((collective * share + employees * (100 - share)) / 100);
}

/**
 * Tableau de performance par service sur une période : score (objectifs collectifs et moyenne des employés ayant des
 * objectifs), comparaison avec la même période un an plus tôt, objectifs atteints et en retard, assiduité et formation,
 * classement des employés, indicateurs mesurés sur le service entier.
 * `employeeIds` (vue d'un responsable) : son équipe seule, sans objectifs collectifs.
 */
async function departmentReport(db, periodOrYear, { now = new Date(), employeeIds = null } = {}) {
  const P = asPeriod(periodOrYear);
  const prevP = previousPeriod(P);
  const rh = require('./rh');
  const ctx = await context(db, { now, withIndicators: true });
  const q = db('employees').where({ active: true }).orderBy(['last_name', 'first_name']);
  if (employeeIds) q.whereIn('id', employeeIds);
  const people = (await q).map(rh.normEmployee);
  const rows = [];
  for (const e of people) {
    const cur = await scorecard(db, e, P, ctx);
    const prev = await scorecard(db, e, prevP, { ...ctx, withIndicators: false });
    rows.push({
      employee_id: e.id, matricule: e.matricule, name: `${e.last_name} ${e.first_name}`, job_title: e.job_title, department: e.department,
      score: cur.score, prev_score: prev.score, objectives: cur.objectives.filter(o => o.status !== 'abandonne').length, achieved: cur.achieved, late: cur.late,
      presence: cur.values.presence, absences: cur.values.absences, formation_heures: cur.values.formation_heures, indicators: indicatorGroups(e, cur.values),
    });
  }
  const share = Number(ctx.settings.service_collective_pct ?? 50);
  const collective = employeeIds ? {} : await departmentObjectives(db, P, ctx, people);
  const collectivePrev = employeeIds ? {} : await departmentObjectives(db, prevP, ctx, people);
  if (!employeeIds && !ctx.serviceRaw) ctx.serviceRaw = await loadServiceRaw(db);
  const serviceValues = employeeIds ? {} : computeService(ctx.serviceRaw, P.from, P.to, now);
  const summarize = (list, key, label, col = null, colPrev = null) => {
    const scored = list.filter(r => r.score != null);
    const prev = list.filter(r => r.prev_score != null);
    const pres = list.map(r => r.presence).filter(v => v != null);
    const employeesScore = scored.length ? Math.round(avg(scored.map(r => r.score))) : null;
    const employeesPrev = prev.length ? Math.round(avg(prev.map(r => r.prev_score))) : null;
    const groups = new Set(groupsFor(key));
    return {
      key, label, headcount: list.length, scored: scored.length,
      score: blend(col?.score ?? null, employeesScore, share), prev_score: blend(colPrev?.score ?? null, employeesPrev, share),
      employees_score: employeesScore, collective_score: col?.score ?? null, collective: col?.objectives || [], collective_lines: col?.lines || [],
      objectives: list.reduce((t, r) => t + r.objectives, 0) + (col?.objectives.filter(o => o.status !== 'abandonne').length || 0),
      achieved: list.reduce((t, r) => t + r.achieved, 0) + (col?.achieved || 0), late: list.reduce((t, r) => t + r.late, 0) + (col?.late || 0),
      presence: pres.length ? round1(avg(pres)) : null, absences: list.reduce((t, r) => t + (r.absences || 0), 0), formation_heures: list.reduce((t, r) => t + (r.formation_heures || 0), 0),
      // Indicateurs mesurés sur le service entier (clôtures, fournisseurs, paie, actes, parc) pour les services concernés
      service_indicators: Object.entries(OBJECTIVE_METRICS).filter(([k, m]) => m.level === 'service' && groups.has(m.group) && k in serviceValues)
        .map(([k, m]) => ({ key: k, label: m.label, unit: m.unit, lower: !!m.lower, value: serviceValues[k] })),
      employees: [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, 'fr')),
    };
  };
  // Un service sans employé actif apparaît s'il a des objectifs collectifs
  const departments = Object.entries(DEPARTMENTS).map(([k, label]) => summarize(rows.filter(r => r.department === k), k, label, collective[k], collectivePrev[k]))
    .filter(d => d.headcount || d.collective.length);
  const overall = summarize(rows, 'tous', 'Toute l’entreprise');
  const cols = departments.map(d => d.collective_score).filter(v => v != null);
  const colsPrev = Object.values(collectivePrev).map(c => c.score).filter(v => v != null);
  overall.collective_score = cols.length ? Math.round(avg(cols)) : null;
  overall.score = blend(overall.collective_score, overall.employees_score, share);
  overall.prev_score = blend(colsPrev.length ? Math.round(avg(colsPrev)) : null, overall.prev_score, share);
  overall.objectives = departments.reduce((t, d) => t + d.objectives, 0);
  overall.achieved = departments.reduce((t, d) => t + d.achieved, 0);
  overall.late = departments.reduce((t, d) => t + d.late, 0);
  overall.service_indicators = [];
  return {
    year: P.year, period: { year: P.year, period: P.period, index: P.index, from: P.from, to: P.to, label: P.label },
    collective_pct: share, overall, departments, unplanned: UNPLANNED.map(k => LEAVE_TYPES[k].label),
  };
}

module.exports = {
  loadRaw, compute, loadServiceRaw, computeService, actuals, scorecard, evaluate, indicatorGroups, buckets, series, departmentReport, departmentObjectives,
  groupsFor, isServiceMetric, GRANULARITIES,
};
