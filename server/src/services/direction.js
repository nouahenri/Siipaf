/**
 * ERP · Administration générale › vue Direction : synthèse de tous les services, calculée par les services de
 * chaque module (aucun chiffre recalculé ici autrement que dans son module) — commercial (commercial.dashboard,
 * achieved, portefeuille), chantiers (journal de chantier : clients.progressIndex, appels de fonds VEFA),
 * finance (compta.dashboard, échéanciers), RH (rh.dashboard, paie, performance par service) et SAV (sav.savStats).
 */
const { toDate, isoDay, isoTime } = require('../lib/http');
const { SITE_STAGE_LABELS } = require('../lib/domain');

// La vue Direction voit toute l'entreprise, quel que soit le compte qui l'ouvre
const EVERYONE = { id: 0, permissions: ['*'] };
const STALE_DAYS = 60; // programme sans point de chantier publié depuis 60 jours : signalé
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

async function commercialPart(db, now) {
  const cm = require('./commercial');
  const pf = require('./portfolio');
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const [dash, ytd, portfolio] = await Promise.all([
    cm.dashboard(db, EVERYONE, now),
    cm.achieved(db, { from: yearStart, to: now }),
    pf.stats(db, EVERYONE, { granularity: 'mois', from: isoDay(yearStart), to: isoDay(now) }),
  ]);
  const targets = dash.team.reduce((t, r) => {
    for (const k of ['ca_fcfa', 'ventes', 'encaissements_fcfa']) { t.target[k] += r.target[k] || 0; t.done[k] += r.done[k] || 0; }
    return t;
  }, { target: { ca_fcfa: 0, ventes: 0, encaissements_fcfa: 0 }, done: { ca_fcfa: 0, ventes: 0, encaissements_fcfa: 0 } });
  return {
    month: dash.month, current: dash.current, previous: dash.previous, ytd, series: dash.series,
    pipeline_value_fcfa: dash.pipeline_value_fcfa, pipeline_weighted_fcfa: dash.pipeline_weighted_fcfa, open_leads: dash.open_leads,
    targets, sellers: dash.team.map(r => ({ user_id: r.user_id, name: r.name, done: r.done, target: r.target, pct: r.pct })),
    portfolio: { total: portfolio.team.total, unassigned: portfolio.unassigned },
  };
}

/** Programmes : lots, ventes, encaissé, avancement du chantier (programme, îlots, moyenne des dossiers). */
async function projectsPart(db, now) {
  const { progressIndex } = require('./clients');
  const [projects, lots, sales, payments, updates, progress] = await Promise.all([
    db('projects').whereNull('archived_at').orderBy('name').select('id', 'name', 'category'),
    db('lots').select('id', 'project_id', 'ilot', 'status'),
    db('sales as s').join('lots as l', 'l.id', 's.lot_id').whereNot('s.status', 'desiste').select('s.id', 's.lead_id', 's.lot_id', 's.price_fcfa', 's.vefa', 'l.project_id', 'l.ilot', 's.status'),
    db('payments as p').join('sales as s', 's.id', 'p.sale_id').join('lots as l', 'l.id', 's.lot_id').whereNot('s.status', 'desiste').select('p.amount_fcfa', 'l.project_id'),
    db('site_updates').where('visible_client', true).select('project_id', 'ilot', 'lot_id', 'progress_pct', 'published_at'),
    progressIndex(db),
  ]);
  const staleBefore = now.getTime() - STALE_DAYS * 86400000;
  return projects.map(p => {
    const mine = lots.filter(l => l.project_id === p.id);
    const sold = sales.filter(s => s.project_id === p.id);
    const ups = updates.filter(u => u.project_id === p.id).map(u => ({ ...u, at: toDate(u.published_at) })).filter(u => u.at);
    const last = ups.sort((a, b) => b.at - a.at)[0];
    const ilots = [...new Set(mine.map(l => l.ilot).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true }))
      .map(ilot => ({ ilot, progress_pct: progress.lot({ id: 0, project_id: p.id, ilot })?.progress_pct ?? 0 }));
    const each = sold.map(s => progress.lot({ id: s.lot_id, project_id: p.id, ilot: s.ilot })?.progress_pct ?? 0);
    const project = progress.project(p.id);
    const byStatus = mine.reduce((m, l) => ({ ...m, [l.status]: (m[l.status] || 0) + 1 }), {});
    const ca = sold.reduce((t, s) => t + Number(s.price_fcfa || 0), 0);
    const paid = payments.filter(x => x.project_id === p.id).reduce((t, x) => t + Number(x.amount_fcfa), 0);
    return {
      id: p.id, name: p.name, category: p.category,
      lots: mine.length, by_status: byStatus, dossiers: sold.length, vefa: sold.filter(s => s.vefa).length,
      ca_fcfa: ca, encaisse_fcfa: paid, reste_fcfa: Math.max(0, ca - paid),
      progress_pct: project?.progress_pct ?? null, stage_label: project ? SITE_STAGE_LABELS[project.stage] : null,
      dossiers_progress_pct: each.length ? Math.round(each.reduce((t, x) => t + x, 0) / each.length) : null,
      ilots, last_update_at: last ? isoTime(last.at) : null, stale: !last || last.at.getTime() < staleBefore,
    };
  });
}

/** Échéances en retard (tous les dossiers) et appels de fonds VEFA. */
async function collectionsPart(db) {
  const { scheduleStatus } = require('./schedule');
  const { totals } = require('./sales');
  const sales = await db('sales').whereIn('status', ['en_cours', 'solde']);
  let overdue = 0, overdueCount = 0;
  const late = new Set();
  for (const s of sales) {
    const st = await scheduleStatus(db, s, await totals(db, s));
    if (st.overdue_count) { overdue += st.overdue_fcfa; overdueCount += st.overdue_count; late.add(s.lead_id); }
  }
  const calls = await db('fund_calls as c').join('sales as s', 's.id', 'c.sale_id').whereNot('s.status', 'desiste').select('c.status', 'c.amount_fcfa');
  const vefaIds = sales.filter(s => s.vefa).map(s => s.id);
  const vefaPaid = vefaIds.length ? Number((await db('payments').whereIn('sale_id', vefaIds).sum({ v: 'amount_fcfa' }).first()).v || 0) : 0;
  const called = calls.filter(c => c.status === 'appele');
  return {
    overdue_fcfa: overdue, overdue_installments: overdueCount, late_clients: late.size, active_sales: sales.length,
    vefa: {
      calls: called.length, called_fcfa: called.reduce((t, c) => t + Number(c.amount_fcfa), 0),
      upcoming: calls.filter(c => c.status === 'a_venir').length, paid_fcfa: vefaPaid,
    },
  };
}

/** Masse salariale des 12 derniers mois (paies validées ou payées). */
async function payrollPart(db, now) {
  if (!(await db.schema.hasTable('payroll_runs'))) return [];
  const start = monthKey(new Date(now.getFullYear(), now.getMonth() - 11, 1));
  const rows = await db('payslips as p').join('payroll_runs as r', 'r.id', 'p.run_id').whereIn('r.status', ['valide', 'paye']).where('r.period', '>=', start)
    .groupBy('r.period').orderBy('r.period').select('r.period').sum({ gross: 'p.gross', employer_cost: 'p.employer_cost' }).count({ n: '*' });
  return rows.map(r => ({ month: r.period, gross: Number(r.gross || 0), employer_cost: Number(r.employer_cost || 0), payslips: Number(r.n) }));
}

async function overview(db, now = new Date()) {
  const ct = require('./compta');
  const rh = require('./rh');
  const { departmentReport } = require('./performance');
  const { savStats } = require('./sav');
  const [commercial, projects, collections, finance, staff, payroll, performance, sav] = await Promise.all([
    commercialPart(db, now), projectsPart(db, now), collectionsPart(db), ct.dashboard(db),
    rh.dashboard(db, isoDay(now)), payrollPart(db, now), departmentReport(db, now.getFullYear(), { now }), savStats(db, now),
  ]);
  const withSales = projects.filter(p => p.dossiers);
  return {
    at: isoTime(now),
    commercial,
    chantiers: {
      projects,
      // Avancement moyen des dossiers en cours, toutes opérations confondues (pondéré par le nombre de dossiers)
      dossiers_progress_pct: withSales.length ? Math.round(withSales.reduce((t, p) => t + p.dossiers_progress_pct * p.dossiers, 0) / withSales.reduce((t, p) => t + p.dossiers, 0)) : null,
      stale: projects.filter(p => p.stale && p.dossiers).length,
      vefa: collections.vefa,
    },
    finance: {
      fiscal_year: finance.fiscal_year, treasury_total: finance.treasury_total, treasury: finance.treasury,
      revenue: finance.revenue, result: finance.result, receivables: finance.receivables, advances: finance.advances, payables: finance.payables,
      margins: finance.margins, series: finance.series,
      overdue_fcfa: collections.overdue_fcfa, overdue_installments: collections.overdue_installments, late_clients: collections.late_clients,
    },
    rh: {
      headcount: staff.headcount, present_now: staff.present_now, absenteeism_pct: staff.absenteeism_pct, pending_leaves: staff.pending,
      months: staff.months.map(m => ({ month: m.month, effectif: m.effectif, entrees: m.entrees, sorties: m.sorties })),
      payroll, alerts: staff.alerts.length,
      performance: { overall: performance.overall.score, departments: performance.departments.map(d => ({ key: d.key, label: d.label, headcount: d.headcount, score: d.score, prev_score: d.prev_score, presence: d.presence, late: d.late })) },
    },
    sav: {
      open: sav.open, overdue: sav.overdue, urgent: sav.urgent, avg_resolution_hours: sav.avg_resolution_hours, on_time_rate: sav.on_time_rate,
      satisfaction_avg: sav.satisfaction_avg, satisfaction_count: sav.satisfaction_count, months: sav.months, open_by_project: sav.open_by_project,
    },
  };
}

module.exports = { overview };
