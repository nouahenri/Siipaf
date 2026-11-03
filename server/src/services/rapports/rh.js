/**
 * Rapport des Ressources humaines : effectif à la fin de la période, entrées et sorties, absences et congés, heures pointées
 * et heures supplémentaires, notes de frais de la période. Droits : ceux du tableau de bord RH (rh:read), qui voit tout le
 * personnel. Jamais de salaire (réservé à paie:read), de montant d'heures supplémentaires ni de pièce du dossier privé.
 */
const { LEAVE_TYPES, LEAVE_STATUSES, EXPENSE_STATUSES, countDays, computeOvertime } = require('../../lib/rh');
const { CONTRACT_TYPES, DEPARTMENTS } = require('../../lib/paie');
const rh = require('../rh');
const { serialize: serializeAttendance } = require('../presences');
const { inPeriod, day, sum } = require('./index');

const fr = d => d.split('-').reverse().join('/');
const round2 = n => Math.round(n * 100) / 100;
const byDay = key => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
// Absences retenues pour l'absentéisme (comme le tableau de bord) : hors congés annuels, permissions, maternité, formation
const ABSENTEEISM = ['maladie', 'accident_travail', 'sans_solde', 'absence_injustifiee'];
const monthShift = (key, n) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };

module.exports = {
  title: 'Ressources humaines',
  allowed: v => v.can('rh:read'),
  async build(db, p) {
    const s = await rh.getSettings(db);
    // Colonnes choisies : le salaire de base et les pièces privées ne quittent jamais la base
    const staff = (await db('employees').select('id', 'matricule', 'last_name', 'first_name', 'job_title', 'department', 'contract_type', 'hire_date', 'end_date', 'active'))
      .map(e => ({ ...e, hire_date: day(e.hire_date), end_date: day(e.end_date), active: !!e.active, name: `${e.last_name} ${e.first_name}` }));
    const byId = new Map(staff.map(e => [e.id, e]));
    // Effectif au dernier jour : embauché, pas encore sorti (une fiche désactivée sans date de sortie n'est plus comptée)
    const atEnd = staff.filter(e => e.hire_date && e.hire_date <= p.toDay && (e.end_date ? e.end_date >= p.toDay : e.active));
    const entries = staff.filter(e => inPeriod(p, e.hire_date)).map(e => ({ ...e, move: 'Entrée', date: e.hire_date }));
    const exits = staff.filter(e => inPeriod(p, e.end_date)).map(e => ({ ...e, move: 'Sortie', date: e.end_date }));

    // Absences et congés qui touchent la période (les demandes annulées sont écartées)
    const leaves = (await rh.leaveQuery(db).whereNot('l.status', 'annulee')).map(rh.serializeLeave)
      .filter(l => l.start_date && l.end_date && l.start_date <= p.toDay && l.end_date >= p.fromDay)
      .map(l => ({ ...l, in_period: rh.calendarOverlap(l, p.fromDay, p.toDay) })).sort(byDay('start_date'));
    const approved = leaves.filter(l => l.status === 'approuvee');
    const workDays = countDays(p.fromDay, p.toDay, { holidays: await rh.holidays(db, p.fromDay, p.toDay), workingDays: s.working_days });
    const absentDays = sum(approved.filter(l => ABSENTEEISM.includes(l.type)), 'in_period');

    // Pointages de la période, puis heures supplémentaires calculées semaine par semaine sur ces seuls pointages
    // (une semaine à cheval sur le début ou la fin de la période ne compte que ses jours compris dans la période)
    const attendances = (await db('hr_attendances').select('id', 'employee_id', 'check_in', 'check_out')).filter(a => inPeriod(p, a.check_in)).map(serializeAttendance);
    const holidayList = await rh.holidays(db);
    const perEmployee = new Map();
    for (const a of attendances) (perEmployee.get(a.employee_id) || perEmployee.set(a.employee_id, []).get(a.employee_id)).push(a);
    const hours = [];
    for (const [employeeId, list] of perEmployee) {
      const e = byId.get(employeeId);
      if (!e) continue;
      // Mois de rattachement des semaines (mois de leur jeudi) : ceux des pointages, et leurs voisins pour les semaines à cheval
      const months = new Set(list.flatMap(a => [-1, 0, 1].map(n => monthShift(a.check_in.slice(0, 7), n))));
      let worked = 0, overtime = 0;
      for (const period of months) {
        const r = computeOvertime(list, { period, baseSalary: 0, holidays: holidayList, s });
        worked += r.worked; overtime += r.overtime;
      }
      // Cadres au forfait (services exclus dans les réglages) : heures suivies, aucune heure supplémentaire
      const exempt = (s.overtime_exempt_departments || []).includes(e.department);
      hours.push({
        matricule: e.matricule, name: e.name, department: e.department, days: new Set(list.map(a => a.check_in.slice(0, 10))).size,
        worked: round2(worked), overtime: exempt ? 0 : round2(overtime), exempt, open: list.filter(a => !a.check_out).length,
      });
    }
    hours.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    // Notes de frais de la période, soumises au moins (les brouillons restent à leur auteur)
    const expenses = (await db('hr_expenses as x').join('employees as e', 'e.id', 'x.employee_id').whereNot('x.status', 'brouillon')
      .select('x.reference', 'x.date', 'x.category', 'x.label', 'x.amount', 'x.status', 'x.paid_by', 'e.last_name', 'e.first_name', 'e.matricule'))
      .filter(x => inPeriod(p, x.date)).map(x => ({ ...x, date: day(x.date), amount: Number(x.amount) })).sort(byDay('date'));
    const kept = expenses.filter(x => x.status !== 'refusee');

    const dep = k => DEPARTMENTS[k] || k || '';
    return {
      summary: [
        { label: `Effectif au ${fr(p.toDay)}`, value: atEnd.length, format: 'number' },
        { label: 'Entrées', value: entries.length, format: 'number' },
        { label: 'Sorties', value: exits.length, format: 'number' },
        { label: 'Jours d’absence approuvés (calendaires)', value: sum(approved, 'in_period'), format: 'number' },
        { label: 'Absentéisme (maladie, accident, sans solde, injustifiées)', value: atEnd.length && workDays ? Math.round((absentDays / (atEnd.length * workDays)) * 1000) / 10 : 0, format: 'percent' },
        { label: 'Heures pointées', value: round2(sum(hours, 'worked')), format: 'number' },
        { label: 'Heures supplémentaires', value: round2(sum(hours, 'overtime')), format: 'number' },
        { label: 'Notes de frais (hors refusées)', value: sum(kept, 'amount'), format: 'fcfa' },
      ],
      sections: [
        { title: 'Entrées et sorties', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'mouvement', label: 'Mouvement' }, { key: 'matricule', label: 'Matricule' }, { key: 'nom', label: 'Employé' },
          { key: 'poste', label: 'Poste' }, { key: 'service', label: 'Service' }, { key: 'contrat', label: 'Contrat' },
        ], rows: [...entries, ...exits].sort(byDay('date')).map(e => ({
          date: e.date, mouvement: e.move, matricule: e.matricule, nom: e.name, poste: e.job_title, service: dep(e.department), contrat: CONTRACT_TYPES[e.contract_type] || e.contract_type,
        })) },
        { title: 'Absences et congés', columns: [
          { key: 'employe', label: 'Employé' }, { key: 'matricule', label: 'Matricule' }, { key: 'service', label: 'Service' }, { key: 'type', label: 'Type' },
          { key: 'du', label: 'Du', format: 'date' }, { key: 'au', label: 'Au', format: 'date' }, { key: 'jours', label: 'Jours décomptés', format: 'number' },
          { key: 'periode', label: 'Jours dans la période', format: 'number' }, { key: 'statut', label: 'Statut' },
        ], rows: leaves.map(l => ({
          employe: l.employee_name, matricule: l.matricule, service: dep(l.department), type: l.event_label ? `${l.label} (${l.event_label})` : LEAVE_TYPES[l.type]?.label || l.type,
          du: l.start_date, au: l.end_date, jours: l.days, periode: l.in_period, statut: LEAVE_STATUSES[l.status]?.label || l.status,
        })) },
        { title: 'Heures pointées', columns: [
          { key: 'matricule', label: 'Matricule' }, { key: 'nom', label: 'Employé' }, { key: 'service', label: 'Service' }, { key: 'jours', label: 'Jours pointés', format: 'number' },
          { key: 'heures', label: 'Heures travaillées', format: 'number' }, { key: 'sup', label: 'Heures supplémentaires', format: 'number' },
          { key: 'forfait', label: 'Au forfait' }, { key: 'ouverts', label: 'Pointages sans départ', format: 'number' },
        ], rows: hours.map(h => ({ matricule: h.matricule, nom: h.name, service: dep(h.department), jours: h.days, heures: h.worked, sup: h.overtime, forfait: h.exempt ? 'Oui' : 'Non', ouverts: h.open })) },
        { title: 'Notes de frais', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'reference', label: 'Référence' }, { key: 'employe', label: 'Employé' }, { key: 'categorie', label: 'Catégorie' },
          { key: 'objet', label: 'Objet' }, { key: 'payee', label: 'Payée par' }, { key: 'statut', label: 'Statut' }, { key: 'montant', label: 'Montant TTC', format: 'fcfa' },
        ], rows: expenses.map(x => ({
          date: x.date, reference: x.reference, employe: `${x.last_name} ${x.first_name}`, categorie: s.expense_categories?.[x.category]?.label || x.category, objet: x.label,
          payee: x.paid_by === 'societe' ? 'Société' : 'Employé (à rembourser)', statut: EXPENSE_STATUSES[x.status]?.label || x.status, montant: x.amount,
        })) },
      ],
    };
  },
};
