/**
 * ERP · Administration générale › vue Direction : synthèse de tous les services, calculée par les services de
 * chaque module (aucun chiffre recalculé ici autrement que dans son module) — commercial (commercial.dashboard,
 * achieved, portefeuille), chantiers (journal de chantier : clients.progressIndex, appels de fonds VEFA),
 * finance (compta.dashboard, échéanciers), RH (rh.dashboard, paie, performance par service), SAV (sav.savStats) et
 * Administration générale (courrier, contrats.upcoming, parc.deadlines, documents et demandes internes).
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

/**
 * Administration générale : courrier, contrats, parc, documents internes et demandes internes, avec la liste de ce
 * qui est en retard (chaque ligne renvoie à sa fiche). Les échéances viennent des services de chaque partie.
 */
async function adminPart(db, now) {
  const contracts = require('./contracts');
  const parc = require('./parc');
  const { REQUEST_KINDS, REQUEST_OPEN } = require('../lib/domain');
  const day = isoDay(now);
  const monthStart = `${day.slice(0, 7)}-01`;
  const n = async q => Number((await q.count({ n: '*' }).first()).n || 0);
  const ALL = { can: () => true, userId: 0 };

  const [mailToAssign, mailOpen, mailLate, mailIn, mailOut, ctrActive, ctrDeadlines, assetRows, assetDeadlines, resaPending, docs, recipients, reads, actions, reqs] = await Promise.all([
    n(db('mail_items').where({ status: 'enregistre', direction: 'arrivee' })),
    n(db('mail_items').where({ status: 'affecte' })),
    db('mail_items as m').leftJoin('users as u', 'u.id', 'm.assigned_to').where('m.status', 'affecte').where('m.due_date', '<', day).orderBy('m.due_date')
      .select('m.id', 'm.number', 'm.subject', 'm.confidential', 'm.due_date', 'u.name as assigned_to_name'),
    n(db('mail_items').where({ direction: 'arrivee' }).where('date', '>=', monthStart)),
    n(db('mail_items').where({ direction: 'depart' }).where('date', '>=', monthStart)),
    n(db('contracts').where({ status: 'actif' })),
    contracts.upcoming(db, ALL, { days: 30 }),
    db('assets').whereNot('status', 'reforme').select('status'),
    parc.deadlines(db, { days: 30, day }),
    n(db('asset_reservations').where({ status: 'demandee' })),
    db('internal_docs').where({ status: 'publie' }).select('id', 'reference', 'title', 'version', 'ack_required', 'ack_deadline'),
    db('internal_doc_recipients').groupBy('doc_id').select('doc_id').count({ n: '*' }),
    db('internal_doc_reads as r').join('internal_docs as d', function () { this.on('d.id', 'r.doc_id').andOn('d.version', 'r.version'); })
      .groupBy('r.doc_id').select('r.doc_id').countDistinct({ n: 'r.user_id' }),
    db('internal_doc_actions as a').join('internal_docs as d', 'd.id', 'a.doc_id').leftJoin('users as u', 'u.id', 'a.owner_id').where('a.status', 'a_faire')
      .select('a.id', 'a.label', 'a.due_date', 'a.doc_id', 'd.reference', 'u.name as owner_name'),
    db('internal_requests').whereIn('status', REQUEST_OPEN).select('id', 'reference', 'title', 'kind', 'status', 'estimated_amount', 'created_at'),
  ]);

  // Contrats : échéances suivies (fin, préavis, pièces, révision) ; les paiements ont leurs factures en Comptabilité
  const watched = ctrDeadlines.filter(d => d.kind !== 'paiement');
  // Documents : lectures attendues de la version en vigueur
  const count = rows => Object.fromEntries(rows.map(r => [r.doc_id, Number(r.n)]));
  const sent = count(recipients);
  const done = count(reads);
  const docRows = docs.filter(d => d.ack_required).map(d => {
    const pending = Math.max(0, (sent[d.id] || 0) - (done[d.id] || 0));
    return { ...d, ack_deadline: isoDay(d.ack_deadline), pending, late: pending > 0 && !!d.ack_deadline && isoDay(d.ack_deadline) < day };
  });
  const lateActions = actions.map(a => ({ ...a, due_date: isoDay(a.due_date) })).filter(a => a.due_date && a.due_date < day);
  const purchase = reqs.filter(r => REQUEST_KINDS[r.kind]?.purchase);

  // À traiter en priorité : tout ce qui a dépassé son délai, du plus ancien au plus récent
  const attention = [
    ...mailLate.map(m => ({ module: 'courrier', label: `Courrier ${m.number} non traité`, detail: [m.confidential ? 'Confidentiel' : m.subject, m.assigned_to_name].filter(Boolean).join(' · '), date: isoDay(m.due_date), link: `/administration/courrier?fiche=${m.id}` })),
    ...watched.filter(d => d.days_left < 0).map(d => ({ module: 'contrats', label: `Contrat ${d.reference} : ${d.label.toLowerCase()}`, detail: [d.title, d.owner_name].filter(Boolean).join(' · '), date: d.date, link: `/administration/contrats?fiche=${d.contract_id}` })),
    ...assetDeadlines.filter(x => x.state === 'du').map(x => ({ module: 'parc', label: `${x.code}${x.plate ? ` (${x.plate})` : ''} : ${x.label}`, detail: x.name, date: x.date, link: `/administration/parc?fiche=${x.asset_id}` })),
    ...lateActions.map(a => ({ module: 'documents', label: `Action de PV en retard : ${a.label}`, detail: [a.reference, a.owner_name].filter(Boolean).join(' · '), date: a.due_date, link: `/administration/documents?fiche=${a.doc_id}` })),
    ...docRows.filter(d => d.late).map(d => ({ module: 'documents', label: `${d.reference} : ${d.pending} lecture(s) en retard`, detail: d.title, date: d.ack_deadline, link: `/administration/documents?fiche=${d.id}` })),
  ].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  return {
    courrier: { to_assign: mailToAssign, open: mailOpen, late: mailLate.length, month_in: mailIn, month_out: mailOut },
    contrats: { active: ctrActive, due_30: watched.length, late: watched.filter(d => d.days_left < 0).length, payments_30: ctrDeadlines.length - watched.length },
    parc: {
      assets: assetRows.length, broken: assetRows.filter(a => a.status === 'maintenance').length,
      due_30: assetDeadlines.length, late: assetDeadlines.filter(x => x.state === 'du').length, requests: resaPending,
    },
    documents: {
      published: docs.length, to_read: docRows.reduce((t, d) => t + d.pending, 0), late_docs: docRows.filter(d => d.late).length,
      actions_open: actions.length, actions_late: lateActions.length,
    },
    demandes: {
      open: reqs.length,
      by_status: REQUEST_OPEN.reduce((m, s) => ({ ...m, [s]: reqs.filter(r => r.status === s).length }), {}),
      purchases_fcfa: purchase.reduce((t, r) => t + Number(r.estimated_amount || 0), 0),
    },
    attention: attention.slice(0, 15), attention_total: attention.length,
  };
}

/** Juridique : ventes jusqu'à l'acte, litiges, cautions, impayés transmis ; ce qui a dépassé son délai. */
async function legalPart(db) {
  const jur = require('./juridique');
  const ALL = { can: () => true, userId: 0 };
  const [deeds, lits, gars, unpaid] = await Promise.all([jur.deeds(db), jur.litigations(db, ALL, { status: 'ouvert' }), jur.guarantees(db, { status: 'active' }), jur.unpaid(db)]);
  const toHandle = unpaid.items.filter(u => u.transmitted && !u.litigation);
  const attention = [
    ...lits.filter(l => l.next_date && l.days_left < 0).map(l => ({ module: 'litiges', label: `Litige ${l.reference} : ${(l.next_label || 'échéance').toLowerCase()}`, detail: `${l.title} · ${l.opponent}`, date: l.next_date, link: `/juridique/litiges?fiche=${l.id}` })),
    ...gars.filter(g => g.deadline && g.deadline.days_left < 0).map(g => ({ module: 'cautions', label: `${g.reference} : ${g.deadline.label.toLowerCase()}`, detail: `${g.kind_label} · ${g.counterparty_name || ''}`, date: g.deadline.date, link: `/juridique/cautions?fiche=${g.id}` })),
    ...toHandle.map(u => ({ module: 'impayes', label: `Impayé de ${u.days_late} jours sans litige : ${u.client_name}`, detail: `${u.project_name}, lot ${u.lot_code}`, date: u.oldest_due, link: '/juridique/impayes' })),
  ];
  return {
    deeds_open: deeds.filter(d => d.current).length, deeds_to_sign: deeds.filter(d => d.current === 'acte').length,
    litigations: lits.length, litigations_fcfa: lits.reduce((t, l) => t + (l.amount_fcfa || 0), 0),
    guarantees_due_30: gars.filter(g => g.deadline && g.deadline.days_left <= 30).length, guarantees_late: gars.filter(g => g.deadline && g.deadline.days_left < 0).length,
    unpaid_threshold: unpaid.threshold, unpaid_transmitted: unpaid.items.filter(u => u.transmitted).length, unpaid_to_handle: toHandle.length,
    attention,
  };
}

async function overview(db, now = new Date()) {
  const ct = require('./compta');
  const rh = require('./rh');
  const { departmentReport } = require('./performance');
  const { savStats } = require('./sav');
  const [commercial, projects, collections, finance, staff, payroll, performance, sav, administration, juridique] = await Promise.all([
    commercialPart(db, now), projectsPart(db, now), collectionsPart(db), ct.dashboard(db),
    rh.dashboard(db, isoDay(now)), payrollPart(db, now), departmentReport(db, now.getFullYear(), { now }), savStats(db, now), adminPart(db, now), legalPart(db),
  ]);
  // « À traiter en priorité » : les délais dépassés du Juridique rejoignent ceux de l'Administration générale
  const attention = [...administration.attention, ...juridique.attention].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  administration.attention_total += juridique.attention.length;
  administration.attention = attention.slice(0, 15);
  delete juridique.attention;
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
    administration,
    juridique,
  };
}

module.exports = { overview };
