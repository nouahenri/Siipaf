/**
 * Rapport Client & SAV : réclamations reçues et résolues sur la période (délai, respect des échéances, satisfaction), réserves
 * relevées ou levées, interventions, et le stock de réclamations ouvertes à la date de fin. Même portée que le tableau de bord :
 * sans « sav:all », seulement ses clients et ce qui est confié au compte (scopeTickets, scopeReserves, scopeInterventions).
 * Droits : ceux du tableau de bord (sav:read).
 */
const sav = require('../sav');
const { SAV_CATEGORIES, SAV_PRIORITIES, SAV_STATUS_LABELS } = require('../../lib/domain');
const { toDate } = require('../../lib/http');
const { inPeriod, day, sum } = require('./index');

const HOUR = 3600 * 1000;
const RESERVE_STATUS = { ouverte: 'À lever', levee: 'Levée' };
const INTERVENTION_STATUS = { planifiee: 'Planifiée', realisee: 'Réalisée', annulee: 'Annulée' };
const SOURCES = { client: 'Espace client', equipe: 'Équipe', livraison: 'Livraison' };
const fr = d => d.split('-').reverse().join('/');
const time = v => toDate(v)?.getTime() ?? null;
const byDate = key => (a, b) => (time(a[key]) || 0) - (time(b[key]) || 0);
const round1 = n => Math.round(n * 10) / 10;

module.exports = {
  title: 'Client & SAV',
  allowed: v => v.can('sav:read'),
  async build(db, p, v) {
    const [tickets, reserves, interventions] = await Promise.all([
      sav.scopeTickets(db('sav_tickets as t').leftJoin('leads as ld', 'ld.id', 't.lead_id').leftJoin('lots as l', 'l.id', 't.lot_id')
        .leftJoin('projects as pr', 'pr.id', 't.project_id').leftJoin('users as u', 'u.id', 't.assigned_to'), v.user)
        .select('t.id', 't.ref', 't.title', 't.category', 't.priority', 't.status', 't.source', 't.due_at', 't.created_at', 't.resolved_at', 't.satisfaction',
          'ld.name as client', 'l.code as lot', 'pr.name as programme', 'u.name as responsable'),
      sav.scopeReserves(db('sav_reserves as r').join('sales as s', 's.id', 'r.sale_id').join('leads as ld', 'ld.id', 's.lead_id')
        .leftJoin('lots as l', 'l.id', 'r.lot_id').leftJoin('projects as pr', 'pr.id', 'l.project_id'), v.user, db)
        .select('r.id', 'r.label', 'r.category', 'r.status', 'r.noted_at', 'r.deadline', 'r.lifted_at', 'ld.name as client', 'l.code as lot', 'pr.name as programme'),
      sav.scopeInterventions(sav.interventionQuery(db).leftJoin('users as u', 'u.id', 'i.technician_id'), v.user)
        .select('i.id', 'i.scheduled_at', 'i.status', 'i.done_at', 'i.cost_fcfa', 'i.contractor', 't.ref as ticket_ref', 't.title as ticket_title',
          'rs.label as reserve_label', 'ld.name as client', 'u.name as technicien'),
    ]);

    // Réclamations reçues et résolues sur la période
    const received = tickets.filter(t => inPeriod(p, t.created_at)).sort(byDate('created_at'));
    const resolved = tickets.filter(t => inPeriod(p, t.resolved_at)).sort(byDate('resolved_at'));
    const hours = t => (time(t.resolved_at) - time(t.created_at)) / HOUR;
    const onTime = t => !!t.due_at && time(t.resolved_at) <= time(t.due_at);
    const rated = resolved.filter(t => t.satisfaction != null);
    // Ouvertes à la date de fin (ou maintenant, si la période n'est pas finie) : reçues avant, pas encore résolues à cette date.
    // Une réclamation rejetée n'a pas de date de rejet : elle n'est plus comptée.
    const cutoff = Math.min(p.to.getTime(), Date.now());
    const openAt = tickets.filter(t => t.status !== 'rejete' && time(t.created_at) < cutoff && (!t.resolved_at || time(t.resolved_at) >= cutoff));
    const lateAt = openAt.filter(t => t.due_at && time(t.due_at) < cutoff);
    const atEnd = `au ${fr(p.toDay)}`;

    const noted = reserves.filter(r => inPeriod(p, r.noted_at));
    const lifted = reserves.filter(r => r.status === 'levee' && inPeriod(p, r.lifted_at));
    const shownReserves = reserves.filter(r => inPeriod(p, r.noted_at) || (r.status === 'levee' && inPeriod(p, r.lifted_at))).sort(byDate('noted_at'));
    const planned = interventions.filter(i => inPeriod(p, i.scheduled_at)).sort(byDate('scheduled_at'));
    const done = interventions.filter(i => i.status === 'realisee' && inPeriod(p, i.done_at || i.scheduled_at));

    // Répartition par type de problème : reçues et résolues sur la période
    const types = Object.entries(SAV_CATEGORIES).map(([k, label]) => ({
      type: label, recues: received.filter(t => t.category === k).length, resolues: resolved.filter(t => t.category === k).length,
    })).filter(x => x.recues || x.resolues);

    return {
      summary: [
        { label: 'Réclamations reçues', value: received.length, format: 'number' },
        { label: 'dont priorité haute ou urgente', value: received.filter(t => ['haute', 'urgente'].includes(t.priority)).length, format: 'number' },
        { label: 'Réclamations résolues', value: resolved.length, format: 'number' },
        { label: 'Délai moyen de résolution (heures)', value: resolved.length ? round1(resolved.reduce((s, t) => s + hours(t), 0) / resolved.length) : null, format: 'number' },
        { label: 'Résolues dans les délais', value: resolved.length ? Math.round((resolved.filter(onTime).length / resolved.length) * 1000) / 10 : null, format: 'percent' },
        { label: 'Satisfaction client (sur 5)', value: rated.length ? round1(sum(rated, 'satisfaction') / rated.length) : null, format: 'number' },
        { label: 'Avis clients', value: rated.length, format: 'number' },
        { label: `Réclamations ouvertes ${atEnd}`, value: openAt.length, format: 'number' },
        { label: `En retard sur l’échéance ${atEnd}`, value: lateAt.length, format: 'number' },
        { label: 'Réserves relevées à la livraison', value: noted.length, format: 'number' },
        { label: 'Réserves levées', value: lifted.length, format: 'number' },
        { label: 'Interventions réalisées', value: done.length, format: 'number' },
        { label: 'Coût des interventions réalisées', value: sum(done, 'cost_fcfa'), format: 'fcfa' },
      ],
      sections: [
        { title: 'Réclamations reçues', columns: [
          { key: 'reference', label: 'Référence' }, { key: 'date', label: 'Reçue le', format: 'date' }, { key: 'client', label: 'Client' },
          { key: 'programme', label: 'Programme' }, { key: 'lot', label: 'Lot' }, { key: 'objet', label: 'Objet' }, { key: 'type', label: 'Type de problème' },
          { key: 'priorite', label: 'Priorité' }, { key: 'origine', label: 'Origine' }, { key: 'statut', label: 'Statut actuel' }, { key: 'responsable', label: 'Responsable' },
          { key: 'echeance', label: 'Échéance', format: 'date' }, { key: 'resolue', label: 'Résolue le', format: 'date' },
        ], rows: received.map(t => ({
          reference: t.ref, date: day(t.created_at), client: t.client, programme: t.programme, lot: t.lot, objet: t.title,
          type: SAV_CATEGORIES[t.category] || t.category, priorite: SAV_PRIORITIES[t.priority]?.label || t.priority, origine: SOURCES[t.source] || t.source,
          statut: SAV_STATUS_LABELS[t.status] || t.status, responsable: t.responsable, echeance: day(t.due_at), resolue: day(t.resolved_at),
        })) },
        { title: 'Réclamations résolues', columns: [
          { key: 'reference', label: 'Référence' }, { key: 'client', label: 'Client' }, { key: 'type', label: 'Type de problème' },
          { key: 'recue', label: 'Reçue le', format: 'date' }, { key: 'resolue', label: 'Résolue le', format: 'date' }, { key: 'delai', label: 'Délai (heures)', format: 'number' },
          { key: 'a_temps', label: 'Dans les délais' }, { key: 'satisfaction', label: 'Satisfaction (sur 5)', format: 'number' },
        ], rows: resolved.map(t => ({
          reference: t.ref, client: t.client, type: SAV_CATEGORIES[t.category] || t.category, recue: day(t.created_at), resolue: day(t.resolved_at),
          delai: round1(hours(t)), a_temps: onTime(t) ? 'Oui' : 'Non', satisfaction: t.satisfaction == null ? null : Number(t.satisfaction),
        })) },
        { title: 'Par type de problème', columns: [
          { key: 'type', label: 'Type de problème' }, { key: 'recues', label: 'Reçues', format: 'number' }, { key: 'resolues', label: 'Résolues', format: 'number' },
        ], rows: types },
        { title: `Réclamations ouvertes ${atEnd}`, columns: [
          { key: 'reference', label: 'Référence' }, { key: 'date', label: 'Reçue le', format: 'date' }, { key: 'client', label: 'Client' }, { key: 'programme', label: 'Programme' },
          { key: 'objet', label: 'Objet' }, { key: 'priorite', label: 'Priorité' }, { key: 'echeance', label: 'Échéance', format: 'date' }, { key: 'retard', label: 'En retard' },
          { key: 'responsable', label: 'Responsable' },
        ], rows: [...openAt].sort(byDate('due_at')).map(t => ({
          reference: t.ref, date: day(t.created_at), client: t.client, programme: t.programme, objet: t.title, priorite: SAV_PRIORITIES[t.priority]?.label || t.priority,
          echeance: day(t.due_at), retard: lateAt.includes(t) ? 'Oui' : 'Non', responsable: t.responsable,
        })) },
        { title: 'Réserves à la livraison', columns: [
          { key: 'date', label: 'Relevée le', format: 'date' }, { key: 'client', label: 'Client' }, { key: 'programme', label: 'Programme' }, { key: 'lot', label: 'Lot' },
          { key: 'reserve', label: 'Réserve' }, { key: 'type', label: 'Type de problème' }, { key: 'statut', label: 'Statut actuel' },
          { key: 'echeance', label: 'Échéance', format: 'date' }, { key: 'levee', label: 'Levée le', format: 'date' },
        ], rows: shownReserves.map(r => ({
          date: day(r.noted_at), client: r.client, programme: r.programme, lot: r.lot, reserve: r.label, type: SAV_CATEGORIES[r.category] || r.category || null,
          statut: RESERVE_STATUS[r.status] || r.status, echeance: day(r.deadline), levee: r.status === 'levee' ? day(r.lifted_at) : null,
        })) },
        { title: 'Interventions', columns: [
          { key: 'date', label: 'Date prévue', format: 'date' }, { key: 'objet', label: 'Réclamation ou réserve' }, { key: 'client', label: 'Client' },
          { key: 'intervenant', label: 'Intervenant' }, { key: 'statut', label: 'Statut' }, { key: 'realisee', label: 'Réalisée le', format: 'date' },
          { key: 'cout', label: 'Coût', format: 'fcfa' },
        ], rows: planned.map(i => ({
          date: day(i.scheduled_at), objet: i.ticket_ref ? `${i.ticket_ref} · ${i.ticket_title}` : i.reserve_label, client: i.client,
          intervenant: i.technicien || i.contractor || 'À désigner', statut: INTERVENTION_STATUS[i.status] || i.status, realisee: day(i.done_at),
          cout: i.cost_fcfa == null ? null : Number(i.cost_fcfa),
        })) },
      ],
    };
  },
};
