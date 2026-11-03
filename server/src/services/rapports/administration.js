/**
 * Rapport de l'Administration générale (son tableau de bord est la vue Direction) : chiffres clés des services repris de la vue
 * Direction quand ils se rattachent à une date (ventes, encaissements et prospects par commercial.achieved, réclamations SAV,
 * factures d'achat, masse salariale, étapes de chantier déclarées et appels de fonds), courriers et demandes internes de la période,
 * échéances des contrats et du parc tombant dans la période. Comme la vue Direction, le rapport porte sur toute l'entreprise.
 * Droits : ceux de la vue Direction (direction:read). Un courrier confidentiel ne montre que son numéro, comme dans la vue Direction,
 * sauf pour qui affecte le courrier (courrier:assign).
 */
const { REQUEST_KINDS, REQUEST_SERVICES, REQUEST_STATUSES, MAIL_DIRECTIONS, MAIL_NATURES, MAIL_STATUSES, MAIL_SUITES, CONTRACT_KINDS } = require('../../lib/domain');
const { DEPARTMENTS } = require('../../lib/paie');
const { isoDay } = require('../../lib/http');
const { inPeriod, day, sum } = require('./index');

const ALL = { can: () => true, userId: 0 };
const byKey = key => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
const PARC_STATES = { du: 'Dépassée', bientot: 'Proche', ok: 'À venir' };
// Les échéances sont calculées à partir d'aujourd'hui (prochaine occurrence) : on les prend toutes, puis on garde celles de la période
const HORIZON_DAYS = 6 * 366;

module.exports = {
  title: 'Administration générale',
  allowed: v => v.can('direction:read'),
  async build(db, p, v) {
    const cm = require('../commercial');
    const contracts = require('../contracts');
    const parc = require('../parc');
    const today = isoDay(new Date());
    const months = [p.fromDay.slice(0, 7), p.toDay.slice(0, 7)];
    const hasPayroll = await db.schema.hasTable('payroll_runs');

    const [sales, tickets, invoices, payroll, declarations, mail, requests, ctrDeadlines, assetDeadlines, contractRows] = await Promise.all([
      cm.achieved(db, { from: p.from, to: p.to }),
      db('sav_tickets').select('created_at', 'resolved_at'),
      db('purchase_invoices').whereNotIn('status', ['brouillon', 'annulee']).select('date', 'amount_ht'),
      hasPayroll ? db('payslips as s').join('payroll_runs as r', 'r.id', 's.run_id').whereIn('r.status', ['valide', 'paye']).whereBetween('r.period', months).sum({ gross: 's.gross' }).first() : null,
      db('stage_declarations').where({ status: 'declaree' }).select('declared_at', 'calls_count', 'calls_amount'),
      db('mail_items as m').leftJoin('users as u', 'u.id', 'm.assigned_to')
        .select('m.id', 'm.direction', 'm.number', 'm.date', 'm.correspondent', 'm.subject', 'm.nature', 'm.confidential', 'm.urgent', 'm.status', 'm.suite', 'm.due_date', 'm.assigned_department', 'u.name as assigned_to_name'),
      db('internal_requests as r').leftJoin('users as u', 'u.id', 'r.requested_by')
        .select('r.id', 'r.reference', 'r.kind', 'r.kind_other', 'r.service', 'r.title', 'r.estimated_amount', 'r.urgency', 'r.status', 'r.created_at', 'r.closed_at', 'u.name as requested_by_name'),
      contracts.upcoming(db, ALL, { days: HORIZON_DAYS }),
      parc.deadlines(db, { days: HORIZON_DAYS, day: today }),
      db('contracts').select('id', 'kind'),
    ]);

    // Chiffres clés datables des services
    const savIn = tickets.filter(t => inPeriod(p, t.created_at)).length;
    const savDone = tickets.filter(t => inPeriod(p, t.resolved_at)).length;
    const bought = invoices.filter(i => inPeriod(p, i.date));
    const declared = declarations.filter(d => inPeriod(p, d.declared_at));

    // Courriers et demandes internes de la période
    const mails = mail.filter(m => inPeriod(p, m.date)).sort((a, b) => String(day(a.date)).localeCompare(String(day(b.date))) || String(a.number).localeCompare(String(b.number)));
    const masked = m => m.confidential && !v.can('courrier:assign');
    const reqs = requests.filter(r => inPeriod(p, r.created_at)).sort((a, b) => String(day(a.created_at)).localeCompare(String(day(b.created_at))));
    const reqDone = reqs.filter(r => r.status === 'traitee').length;
    const kindLabel = r => (r.kind === 'service' && REQUEST_SERVICES[r.service] ? `Demande au service : ${REQUEST_SERVICES[r.service].label}` : r.kind === 'autre' && r.kind_other ? r.kind_other : REQUEST_KINDS[r.kind]?.label || r.kind);

    // Échéances de la période : contrats (hors paiements, qui ont leurs factures en Comptabilité, comme dans la vue Direction) et parc
    const kinds = Object.fromEntries(contractRows.map(c => [c.id, c.kind]));
    const ctr = ctrDeadlines.filter(d => d.kind !== 'paiement' && inPeriod(p, d.date)).sort(byKey('date'));
    const assets = assetDeadlines.filter(x => x.date && inPeriod(p, x.date)).sort(byKey('date'));

    return {
      summary: [
        { label: 'Chiffre d’affaires signé', value: sales.ca_fcfa, format: 'fcfa' },
        { label: 'Ventes', value: sales.ventes, format: 'number' },
        { label: 'Encaissements', value: sales.encaissements_fcfa, format: 'fcfa' },
        { label: 'Nouveaux prospects', value: sales.nouveaux_prospects, format: 'number' },
        { label: 'Réclamations SAV reçues', value: savIn, format: 'number' },
        { label: 'Réclamations SAV résolues', value: savDone, format: 'number' },
        { label: 'Factures d’achat enregistrées (HT)', value: Math.round(sum(bought, 'amount_ht')), format: 'fcfa' },
        { label: 'Masse salariale brute (paies validées des mois de la période)', value: Math.round(Number(payroll?.gross || 0)), format: 'fcfa' },
        { label: 'Étapes de chantier déclarées', value: declared.length, format: 'number' },
        { label: 'Appels de fonds VEFA émis', value: Math.round(sum(declared, 'calls_amount')), format: 'fcfa' },
        { label: 'Courriers arrivés', value: mails.filter(m => m.direction === 'arrivee').length, format: 'number' },
        { label: 'Courriers envoyés', value: mails.filter(m => m.direction === 'depart').length, format: 'number' },
        { label: 'Courriers de la période non traités', value: mails.filter(m => ['enregistre', 'affecte'].includes(m.status)).length, format: 'number' },
        { label: 'Demandes internes reçues', value: reqs.length, format: 'number' },
        { label: 'Demandes internes traitées', value: reqDone, format: 'number' },
        { label: 'Achats demandés (montant estimé)', value: Math.round(sum(reqs.filter(r => REQUEST_KINDS[r.kind]?.purchase), 'estimated_amount')), format: 'fcfa' },
        { label: 'Échéances de contrats dans la période', value: ctr.length, format: 'number' },
        { label: 'Échéances du parc dans la période', value: assets.length, format: 'number' },
      ],
      sections: [
        { title: 'Courriers de la période', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'numero', label: 'N° d’ordre' }, { key: 'sens', label: 'Sens' }, { key: 'correspondant', label: 'Correspondant' },
          { key: 'objet', label: 'Objet' }, { key: 'nature', label: 'Nature' }, { key: 'urgent', label: 'Urgent' }, { key: 'destinataire', label: 'Destinataire' },
          { key: 'suite', label: 'Suite à donner' }, { key: 'echeance', label: 'Échéance', format: 'date' }, { key: 'statut', label: 'Statut' },
        ], rows: mails.map(m => ({
          date: day(m.date), numero: m.number, sens: MAIL_DIRECTIONS[m.direction]?.label || m.direction,
          correspondant: masked(m) ? 'Confidentiel' : m.correspondent, objet: masked(m) ? 'Confidentiel' : m.subject, nature: MAIL_NATURES[m.nature]?.label || m.nature,
          urgent: m.urgent ? 'Oui' : 'Non', destinataire: m.assigned_to_name || DEPARTMENTS[m.assigned_department] || null, suite: MAIL_SUITES[m.suite]?.label || null,
          echeance: day(m.due_date), statut: MAIL_STATUSES[m.status] || m.status,
        })) },
        { title: 'Demandes internes de la période', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'reference', label: 'Référence' }, { key: 'type', label: 'Type' }, { key: 'objet', label: 'Objet' },
          { key: 'demandeur', label: 'Demandeur' }, { key: 'urgence', label: 'Urgence' }, { key: 'montant', label: 'Montant estimé', format: 'fcfa' }, { key: 'statut', label: 'Statut' },
          { key: 'cloture', label: 'Close le', format: 'date' },
        ], rows: reqs.map(r => ({
          date: day(r.created_at), reference: r.reference, type: kindLabel(r), objet: r.title, demandeur: r.requested_by_name, urgence: r.urgency === 'urgente' ? 'Urgente' : 'Normale',
          montant: r.estimated_amount == null ? null : Number(r.estimated_amount), statut: REQUEST_STATUSES[r.status] || r.status, cloture: day(r.closed_at),
        })) },
        { title: 'Échéances des contrats', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'reference', label: 'Contrat' }, { key: 'objet', label: 'Objet' }, { key: 'type', label: 'Type de contrat' },
          { key: 'cocontractant', label: 'Cocontractant' }, { key: 'echeance', label: 'Échéance' }, { key: 'responsable', label: 'Responsable' }, { key: 'situation', label: `Situation au ${fr(today)}` },
        ], rows: ctr.map(d => ({
          date: d.date, reference: d.reference, objet: d.title, type: CONTRACT_KINDS[kinds[d.contract_id]] || null, cocontractant: d.counterparty_name, echeance: d.label,
          responsable: d.owner_name, situation: d.date < today ? 'Dépassée' : 'À venir',
        })) },
        { title: 'Échéances du parc', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'code', label: 'Code' }, { key: 'bien', label: 'Bien' }, { key: 'immatriculation', label: 'Immatriculation' },
          { key: 'echeance', label: 'Échéance' }, { key: 'situation', label: `Situation au ${fr(today)}` },
        ], rows: assets.map(x => ({ date: x.date, code: x.code, bien: x.name, immatriculation: x.plate || null, echeance: x.label, situation: PARC_STATES[x.state] || x.state })) },
      ],
    };
  },
};

function fr(d) { return d.split('-').reverse().join('/'); }
