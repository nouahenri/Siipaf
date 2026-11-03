/**
 * Rapport du QHSE : contrôles journaliers et hebdomadaires de la période (notes, sécurité, environnement, alertes), actions correctives
 * (ouvertes, levées, en retard) et inspections ou audits de la période. Portée de l'écran : tous les chantiers avec qhse:all, sinon
 * ceux que l'on conduit ; actions et audits : mêmes règles que leurs listes (responsable, auteur, auditeur, conducteur du chantier).
 * Droits : ceux du tableau de bord (qhse:read).
 */
const { isoDay } = require('../../lib/http');
const Q = require('../../lib/qhse');
const svc = require('../qhse');
const audits = require('../qhseAudits');
const { inPeriod, day } = require('./index');

const byDay = key => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
const pct = n => (n == null ? null : Number(n));

module.exports = {
  title: 'QHSE',
  allowed: v => v.can('qhse:read'),
  async build(db, p, v) {
    const all = svc.seesAll(v);
    const me = v.user.id;
    const today = Q.todayStr();
    // Retard apprécié à la fin de la période, ou aujourd'hui si la période n'est pas finie (une échéance à venir n'est pas en retard)
    const ref = p.toDay < today ? p.toDay : today;
    const s = await svc.settings(db);

    const controlsQ = svc.controlQuery(db).whereIn('c.kind', ['journalier', 'hebdomadaire']);
    if (!all) controlsQ.where('w.manager_id', me);
    const actionsQ = audits.actionQuery(db);
    if (!all) actionsQ.where(b => b.where('x.owner_id', me).orWhere('x.created_by', me).orWhere('w.manager_id', me));
    const auditsQ = db('qhse_audits as a').leftJoin('worksites as w', 'w.id', 'a.worksite_id').leftJoin('projects as p', 'p.id', 'w.project_id')
      .leftJoin('users as u', 'u.id', 'a.auditor_id').leftJoin('users as cu', 'cu.id', 'a.created_by')
      .select('a.*', 'w.reference as worksite_reference', 'w.name as worksite_name', 'w.manager_id', 'p.name as project_name', 'u.name as auditor_user_name', 'cu.name as created_by_name');
    if (!all) auditsQ.where(b => b.where('w.manager_id', me).orWhere('a.auditor_id', me));
    const [controlRows, actionRows, auditRows] = await Promise.all([controlsQ, actionsQ, auditsQ]);

    const controls = controlRows.filter(c => inPeriod(p, c.period_start)).map(svc.serializeControl);
    const daily = controls.filter(c => c.kind === 'journalier').sort(byDay('period_start'));
    const weekly = controls.filter(c => c.kind === 'hebdomadaire').sort(byDay('period_start'));
    const bad = c => c.rating_qualite === Q.BAD_RATING || c.rating_hygiene === Q.BAD_RATING;
    const lowSafety = c => c.safety_pct != null && c.safety_pct < s.threshold;
    const alertsOf = c => [
      c.rating_qualite === Q.BAD_RATING && 'Qualité « Mauvais »', c.rating_hygiene === Q.BAD_RATING && 'Hygiène « Mauvais »',
      lowSafety(c) && `Sécurité sous ${s.threshold} %`,
    ].filter(Boolean).join(', ');

    // Actions : ouvertes ou levées sur la période, ou en retard à la date de référence (non levées à cette date, échéance dépassée)
    const actions = actionRows.map(x => ({ ...serialize(x), created_day: day(x.created_at) }));
    const lateAt = a => a.status !== 'annulee' && !!a.due_on && a.due_on < ref && (a.created_day || '') <= ref && (!a.lifted_on || a.lifted_on > ref);
    const opened = actions.filter(a => inPeriod(p, a.created_at));
    const lifted = actions.filter(a => a.status === 'levee' && inPeriod(p, a.lifted_on));
    const late = actions.filter(lateAt);
    const listed = actions.filter(a => opened.includes(a) || lifted.includes(a) || late.includes(a)).sort(byDay('created_day'));
    const daysLate = a => Math.round((new Date(`${ref}T00:00:00Z`) - new Date(`${a.due_on}T00:00:00Z`)) / 86400000);

    // Audits : prévus ou réalisés sur la période (hors annulés)
    const auditList = auditRows.map(audits.serializeAudit).filter(a => a.status !== 'annule' && (inPeriod(p, a.planned_on) || inPeriod(p, a.done_on)))
      .sort((a, b) => String(a.done_on || a.planned_on || '').localeCompare(String(b.done_on || b.planned_on || '')));
    const findings = auditList.length ? await db('qhse_findings').whereIn('audit_id', auditList.map(a => a.id)).groupBy('audit_id').select('audit_id').count({ n: '*' }) : [];
    const findingsOf = id => Number(findings.find(f => f.audit_id === id)?.n || 0);

    return {
      summary: [
        { label: 'Contrôles journaliers saisis', value: daily.length, format: 'number' },
        { label: 'Note moyenne qualité (sur 4)', value: Q.mean1(daily.map(c => c.rating_qualite)), format: 'number' },
        { label: 'Note moyenne hygiène (sur 4)', value: Q.mean1(daily.map(c => c.rating_hygiene)), format: 'number' },
        { label: 'Ouvriers respectant la sécurité (moyenne)', value: Q.mean1(daily.map(c => c.safety_pct)), format: 'percent' },
        { label: 'Conformité environnementale (moyenne)', value: Q.mean1(daily.map(c => c.env_rate)), format: 'percent' },
        { label: 'Contrôles avec une note « Mauvais »', value: daily.filter(bad).length, format: 'number' },
        { label: `Contrôles sous le seuil de sécurité (${s.threshold} %)`, value: daily.filter(lowSafety).length, format: 'number' },
        { label: 'Synthèses hebdomadaires validées', value: weekly.filter(c => c.status === 'valide').length, format: 'number' },
        { label: 'Actions correctives ouvertes sur la période', value: opened.length, format: 'number' },
        { label: 'Actions correctives levées sur la période', value: lifted.length, format: 'number' },
        { label: `Actions correctives en retard au ${Q.frDay(ref)}`, value: late.length, format: 'number' },
        { label: 'Inspections et audits réalisés', value: auditList.filter(a => inPeriod(p, a.done_on)).length, format: 'number' },
      ],
      sections: [
        { title: 'Contrôles journaliers', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'chantier', label: 'Chantier' }, { key: 'nom', label: 'Nom du chantier' }, { key: 'programme', label: 'Programme' },
          { key: 'qualite', label: 'Qualité' }, { key: 'hygiene', label: 'Hygiène' }, { key: 'presents', label: 'Ouvriers présents', format: 'number' },
          { key: 'securite', label: 'Ouvriers respectant la sécurité', format: 'percent' }, { key: 'etat', label: 'État de sécurité du chantier', format: 'percent' },
          { key: 'environnement', label: 'Conformité environnementale', format: 'percent' }, { key: 'auteur', label: 'Saisi par' }, { key: 'statut', label: 'Statut' }, { key: 'alertes', label: 'Alertes' },
        ], rows: daily.map(c => ({
          date: c.period_start, chantier: c.worksite_reference, nom: c.worksite_name, programme: c.project_name, qualite: c.rating_qualite_label, hygiene: c.rating_hygiene_label,
          presents: c.workers_present, securite: pct(c.safety_pct), etat: pct(c.site_safety_pct), environnement: pct(c.env_rate), auteur: c.created_by_name, statut: c.status_label, alertes: alertsOf(c),
        })) },
        { title: 'Synthèses hebdomadaires', columns: [
          { key: 'semaine', label: 'Semaine du', format: 'date' }, { key: 'chantier', label: 'Chantier' }, { key: 'nom', label: 'Nom du chantier' },
          { key: 'qualite', label: 'Qualité' }, { key: 'hygiene', label: 'Hygiène' }, { key: 'securite', label: 'Ouvriers respectant la sécurité', format: 'percent' },
          { key: 'environnement', label: 'Conformité environnementale', format: 'percent' }, { key: 'auteur', label: 'Ouverte par' }, { key: 'statut', label: 'Statut' },
        ], rows: weekly.map(c => ({
          semaine: c.period_start, chantier: c.worksite_reference, nom: c.worksite_name, qualite: c.rating_qualite_label, hygiene: c.rating_hygiene_label,
          securite: pct(c.safety_pct), environnement: pct(c.env_rate), auteur: c.created_by_name, statut: c.status_label,
        })) },
        { title: 'Actions correctives', columns: [
          { key: 'reference', label: 'Référence' }, { key: 'ouverte', label: 'Ouverte le', format: 'date' }, { key: 'chantier', label: 'Chantier' }, { key: 'origine', label: 'Origine' },
          { key: 'volet', label: 'Volet' }, { key: 'gravite', label: 'Gravité' }, { key: 'intitule', label: 'Intitulé' }, { key: 'responsable', label: 'Responsable' },
          { key: 'echeance', label: 'Échéance', format: 'date' }, { key: 'statut', label: 'Statut' }, { key: 'levee', label: 'Levée le', format: 'date' },
          { key: 'retard', label: `Jours de retard au ${Q.frDay(ref)}`, format: 'number' },
        ], rows: listed.map(a => ({
          reference: a.reference, ouverte: a.created_day, chantier: a.worksite_reference, origine: a.source_label, volet: a.pillar_label, gravite: a.gravity_label, intitule: a.title,
          responsable: a.owner_name, echeance: a.due_on, statut: a.status_label, levee: a.lifted_on, retard: lateAt(a) ? daysLate(a) : null,
        })) },
        { title: 'Inspections et audits', columns: [
          { key: 'reference', label: 'Référence' }, { key: 'type', label: 'Type' }, { key: 'lieu', label: 'Lieu' }, { key: 'auditeur', label: 'Auditeur' },
          { key: 'prevu', label: 'Prévu le', format: 'date' }, { key: 'realise', label: 'Réalisé le', format: 'date' }, { key: 'statut', label: 'Statut' },
          { key: 'score', label: 'Score', format: 'percent' }, { key: 'constats', label: 'Constats', format: 'number' },
        ], rows: auditList.map(a => ({
          reference: a.reference, type: a.kind_label, lieu: a.place_label, auditeur: a.auditor_name, prevu: a.planned_on, realise: a.done_on, statut: a.status_label,
          score: pct(a.score_pct), constats: findingsOf(a.id),
        })) },
      ],
    };
  },
};

/** Action corrective mise en forme par le service QHSE ; date de levée et échéance en « AAAA-MM-JJ ». */
function serialize(x) {
  const a = audits.serializeAction(x);
  return { ...a, due_on: isoDay(x.due_on), lifted_on: isoDay(x.lifted_on), created_at: x.created_at };
}
