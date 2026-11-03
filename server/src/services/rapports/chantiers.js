/**
 * Rapport des Chantiers (boutons sur la liste des chantiers, faute de tableau de bord ; choix du client du 03/11) : état de chaque
 * chantier (avancement, budget, coût réel, engagé, phases en retard) et factures d'achat imputées aux chantiers sur la période.
 * Portée de l'écran : tous les chantiers pour qui les voit, sinon ceux que l'on conduit (chantiers.list).
 */
const chantiers = require('../chantiers');
const { inPeriod, day, sum } = require('./index');

module.exports = {
  title: 'Chantiers',
  allowed: async (v, db) => chantiers.seesAll(v) || !!(await db('worksites').where({ manager_id: v.user.id }).first('id')),
  async build(db, p, v) {
    const list = await chantiers.list(db, v, { status: '' });
    const ids = list.map(w => w.id);
    const invoices = ids.length ? (await db('purchase_invoices as i').leftJoin('suppliers as s', 's.id', 'i.supplier_id').leftJoin('worksites as w', 'w.id', 'i.worksite_id')
      .whereIn('i.worksite_id', ids).whereNot('i.status', 'annulee').select('i.date', 'i.number', 'i.label', 'i.amount_ht', 'i.status', 's.name as supplier', 'w.reference'))
      .filter(i => inPeriod(p, i.date)).sort((a, b) => String(day(a.date)).localeCompare(String(day(b.date)))) : [];
    const open = list.filter(w => !['receptionne', 'clos'].includes(w.status));
    return {
      summary: [
        { label: 'Chantiers en cours', value: open.length, format: 'number' },
        { label: 'Budget prévu (chantiers en cours)', value: sum(open, 'budget_fcfa'), format: 'fcfa' },
        { label: 'Coût réel (chantiers en cours)', value: sum(open, 'spent_fcfa'), format: 'fcfa' },
        { label: 'Commandes engagées non reçues', value: sum(open, 'committed_fcfa'), format: 'fcfa' },
        { label: 'Chantiers avec phases en retard', value: open.filter(w => w.late_phases > 0).length, format: 'number' },
        { label: 'Achats imputés sur la période (HT)', value: sum(invoices, 'amount_ht'), format: 'fcfa' },
      ],
      sections: [
        { title: 'Chantiers', columns: [
          { key: 'reference', label: 'Référence' }, { key: 'nom', label: 'Chantier' }, { key: 'programme', label: 'Programme' }, { key: 'conducteur', label: 'Conducteur' },
          { key: 'statut', label: 'Statut' }, { key: 'debut', label: 'Début prévu', format: 'date' }, { key: 'fin', label: 'Fin prévue', format: 'date' },
          { key: 'avancement', label: 'Avancement', format: 'percent' }, { key: 'retards', label: 'Phases en retard', format: 'number' },
          { key: 'budget', label: 'Budget', format: 'fcfa' }, { key: 'reel', label: 'Coût réel', format: 'fcfa' }, { key: 'engage', label: 'Engagé', format: 'fcfa' }, { key: 'consomme', label: 'Budget consommé', format: 'percent' },
        ], rows: list.map(w => ({
          reference: w.reference, nom: w.name, programme: w.project_name, conducteur: w.manager_name, statut: w.status_label, debut: w.planned_start, fin: w.planned_end,
          avancement: w.progress_pct, retards: w.late_phases, budget: w.budget_fcfa, reel: w.spent_fcfa, engage: w.committed_fcfa, consomme: w.consumed_pct,
        })) },
        { title: 'Factures d’achat imputées sur la période', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'chantier', label: 'Chantier' }, { key: 'numero', label: 'N° facture' }, { key: 'fournisseur', label: 'Fournisseur' },
          { key: 'objet', label: 'Objet' }, { key: 'montant', label: 'Montant HT', format: 'fcfa' },
        ], rows: invoices.map(i => ({ date: day(i.date), chantier: i.reference, numero: i.number, fournisseur: i.supplier, objet: i.label, montant: Number(i.amount_ht) })) },
      ],
    };
  },
};
