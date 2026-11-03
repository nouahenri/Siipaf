/**
 * Rapport du Juridique : actes signés et ventes en cours jusqu'à l'acte, litiges ouverts et clos sur la période, impayés
 * transmis au Juridique, cautions et retenues de garantie arrivant à échéance. Droits : ceux du tableau de bord (route
 * /juridique/overview : juriste ou Direction, juridique.isLegal). Les litiges passent par juridique.litigations avec la fiche
 * du lecteur (service, employé), comme l'écran des litiges : même portée si les droits du tableau de bord venaient à s'ouvrir.
 */
const juridique = require('../juridique');
const courrier = require('../courrier');
const { deedProgress, DEED_STEPS, addDays } = require('../../lib/domain');
const { inPeriod, sum } = require('./index');

const LITIGATION_STATUS = { ouvert: 'En cours', clos: 'Clos' };
const fr = d => (d ? d.split('-').reverse().join('/') : '');
const byDate = key => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
const STEP_LABELS = Object.fromEntries(DEED_STEPS.map(s => [s.key, s.label]));

/** État d'un dossier de vente à une date : seules les étapes datées jusqu'à ce jour comptent. */
function deedAt(d, asOf) {
  const dates = Object.fromEntries(d.steps.map(s => [s.key, s.date && s.date <= asOf ? s.date : null]));
  const p = deedProgress(dates);
  const last = d.steps.map(s => dates[s.key]).filter(Boolean).sort().pop() || null;
  return { ...p, last };
}

module.exports = {
  title: 'Juridique',
  allowed: v => juridique.isLegal(v),
  async build(db, p, v) {
    const today = new Date().toISOString().slice(0, 10);
    const asOf = p.toDay;
    const reader = await courrier.viewer(db, v.user, v.can);
    const [deedRows, lits, gars, unpaid] = await Promise.all([
      juridique.deeds(db), juridique.litigations(db, reader, { status: '' }), juridique.guarantees(db, { status: '' }), juridique.unpaid(db, { day: today }),
    ]);

    // Ventes jusqu'à l'acte : actes signés sur la période ; dossiers en cours à la fin de la période (étapes datées jusque-là)
    const stepDate = (d, key) => d.steps.find(s => s.key === key)?.date || null;
    const signed = deedRows.filter(d => inPeriod(p, stepDate(d, 'acte'))).map(d => ({ ...d, acte_on: stepDate(d, 'acte') })).sort(byDate('acte_on'));
    const delivered = deedRows.filter(d => inPeriod(p, stepDate(d, 'remise')));
    const pending = deedRows
      .filter(d => !d.reserved_at || d.reserved_at <= asOf)
      .map(d => ({ ...d, at: deedAt(d, asOf) }))
      .filter(d => d.at.current)
      .sort((a, b) => String(a.reserved_at || '').localeCompare(String(b.reserved_at || '')));

    // Litiges : ouverts ou clos sur la période ; en cours à la fin de la période
    const opened = lits.filter(l => inPeriod(p, l.opened_on)).sort(byDate('opened_on'));
    const closed = lits.filter(l => l.status === 'clos' && inPeriod(p, l.closed_on)).sort(byDate('closed_on'));
    const running = lits.filter(l => l.opened_on && l.opened_on <= asOf && (l.status === 'ouvert' || (l.closed_on && l.closed_on > asOf)));

    // Impayés : l'échéancier ne se calcule qu'au jour même ; transmis = retard au moins égal au seuil réglé
    const transmitted = unpaid.items.filter(u => u.transmitted).map(u => ({ ...u, transmitted_on: addDays(u.oldest_due, unpaid.threshold) }));

    // Cautions et retenues : échéance (expiration, mainlevée, libération) sur la période, et cautions closes sur la période
    const due = gars.filter(g => g.deadline && inPeriod(p, g.deadline.date)).sort((a, b) => a.deadline.date.localeCompare(b.deadline.date));
    const ended = gars.filter(g => g.status !== 'active' && inPeriod(p, g.closed_on));

    const litigationColumns = [
      { key: 'reference', label: 'Référence' }, { key: 'ouvert', label: 'Ouvert le', format: 'date' }, { key: 'origine', label: 'Origine' },
      { key: 'objet', label: 'Objet' }, { key: 'adverse', label: 'Partie adverse' }, { key: 'service', label: 'Service' }, { key: 'juriste', label: 'Juriste en charge' },
      { key: 'etape', label: 'Étape' }, { key: 'statut', label: 'Statut' }, { key: 'issue', label: 'Issue' }, { key: 'clos', label: 'Clos le', format: 'date' },
      { key: 'montant', label: 'Montant en jeu', format: 'fcfa' },
    ];
    const litigationRow = l => ({
      reference: l.reference, ouvert: l.opened_on, origine: l.origin_label, objet: l.title, adverse: l.opponent, service: l.department_label, juriste: l.owner_name,
      etape: l.stage_label, statut: LITIGATION_STATUS[l.status] || l.status, issue: l.outcome_label, clos: l.closed_on, montant: l.amount_fcfa,
    });

    return {
      summary: [
        { label: 'Actes signés sur la période', value: signed.length, format: 'number' },
        { label: 'Valeur des ventes dont l’acte est signé', value: sum(signed, 'price_fcfa'), format: 'fcfa' },
        { label: 'Expéditions d’acte remises aux clients', value: delivered.length, format: 'number' },
        { label: `Ventes en cours jusqu’à l’acte au ${fr(asOf)}`, value: pending.length, format: 'number' },
        { label: 'Litiges ouverts sur la période', value: opened.length, format: 'number' },
        { label: 'Litiges clos sur la période', value: closed.length, format: 'number' },
        { label: `Litiges en cours au ${fr(asOf)}`, value: running.length, format: 'number' },
        { label: `Montant en jeu des litiges en cours au ${fr(asOf)}`, value: sum(running, 'amount_fcfa'), format: 'fcfa' },
        { label: `Impayés transmis au Juridique au ${fr(today)}`, value: transmitted.length, format: 'number' },
        { label: `Impayés transmis sans litige ouvert au ${fr(today)}`, value: transmitted.filter(u => !u.litigation).length, format: 'number' },
        { label: `Montant en retard des impayés transmis au ${fr(today)}`, value: sum(transmitted, 'overdue_fcfa'), format: 'fcfa' },
        { label: 'Cautions et retenues arrivant à échéance sur la période', value: due.length, format: 'number' },
        { label: 'Montant des cautions et retenues arrivant à échéance', value: sum(due, 'amount_fcfa'), format: 'fcfa' },
        { label: 'Cautions libérées, mises en jeu ou expirées sur la période', value: ended.length, format: 'number' },
      ],
      sections: [
        { title: 'Actes signés sur la période', columns: [
          { key: 'date', label: 'Date de l’acte', format: 'date' }, { key: 'client', label: 'Client' }, { key: 'programme', label: 'Programme' }, { key: 'lot', label: 'Lot' },
          { key: 'notaire', label: 'Notaire' }, { key: 'numero', label: 'N° d’acte' }, { key: 'commercial', label: 'Commercial' }, { key: 'prix', label: 'Prix de vente', format: 'fcfa' },
        ], rows: signed.map(d => ({
          date: d.acte_on, client: d.client_name, programme: d.project_name, lot: d.lot_code, notaire: d.notary_name, numero: d.deed_number, commercial: d.commercial_name, prix: d.price_fcfa,
        })) },
        { title: `Ventes en cours jusqu’à l’acte au ${fr(asOf)}`, columns: [
          { key: 'client', label: 'Client' }, { key: 'programme', label: 'Programme' }, { key: 'lot', label: 'Lot' }, { key: 'commercial', label: 'Commercial' },
          { key: 'reserve', label: 'Réservé le', format: 'date' }, { key: 'faites', label: 'Étapes faites (sur 6)', format: 'number' }, { key: 'a_faire', label: 'Étape à faire' },
          { key: 'derniere', label: 'Dernière étape datée le', format: 'date' }, { key: 'prix', label: 'Prix de vente', format: 'fcfa' },
        ], rows: pending.map(d => ({
          client: d.client_name, programme: d.project_name, lot: d.lot_code, commercial: d.commercial_name, reserve: d.reserved_at, faites: d.at.done,
          a_faire: STEP_LABELS[d.at.current] || d.at.current_label, derniere: d.at.last, prix: d.price_fcfa,
        })) },
        { title: 'Litiges ouverts sur la période', columns: litigationColumns, rows: opened.map(litigationRow) },
        { title: 'Litiges clos sur la période', columns: litigationColumns, rows: closed.map(litigationRow) },
        { title: `Impayés transmis au Juridique au ${fr(today)}`, columns: [
          { key: 'client', label: 'Client' }, { key: 'programme', label: 'Programme' }, { key: 'lot', label: 'Lot' }, { key: 'commercial', label: 'Commercial' },
          { key: 'echeance', label: 'Plus ancienne échéance impayée', format: 'date' }, { key: 'retard', label: 'Jours de retard', format: 'number' },
          { key: 'transmis', label: 'Transmis au Juridique le', format: 'date' }, { key: 'echeances', label: 'Échéances impayées', format: 'number' },
          { key: 'montant', label: 'Montant en retard', format: 'fcfa' }, { key: 'litige', label: 'Litige ouvert' },
        ], rows: transmitted.map(u => ({
          client: u.client_name, programme: u.project_name, lot: u.lot_code, commercial: u.commercial_name, echeance: u.oldest_due, retard: u.days_late,
          transmis: u.transmitted_on, echeances: u.overdue_count, montant: u.overdue_fcfa, litige: u.litigation ? u.litigation.reference : 'Aucun',
        })) },
        { title: 'Cautions et retenues arrivant à échéance sur la période', columns: [
          { key: 'date', label: 'Échéance', format: 'date' }, { key: 'nature', label: 'À faire' }, { key: 'reference', label: 'Référence' }, { key: 'sorte', label: 'Sorte' },
          { key: 'sens', label: 'Sens' }, { key: 'tiers', label: 'Tiers' }, { key: 'banque', label: 'Banque' }, { key: 'contrat', label: 'Contrat' },
          { key: 'responsable', label: 'Responsable' }, { key: 'montant', label: 'Montant', format: 'fcfa' },
        ], rows: due.map(g => ({
          date: g.deadline.date, nature: g.deadline.label, reference: g.reference, sorte: g.kind_label, sens: g.direction_label, tiers: g.counterparty_name,
          banque: g.bank, contrat: g.contract_label, responsable: g.owner_name, montant: g.amount_fcfa,
        })) },
      ],
    };
  },
};
