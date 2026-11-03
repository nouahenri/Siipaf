/**
 * Rapport des Achats & stocks : bons de commande, réceptions et besoins exprimés (chantiers et services) de la période,
 * articles sous le seuil à la fin de la période (stock reconstitué en retirant les mouvements validés postérieurs).
 * Droits : ceux du tableau de bord des Achats (appro:read), qui voit toutes les commandes et tous les emplacements.
 */
const { APPRO_ORDER_STATUSES, APPRO_PENDING_STATUSES, NEED_STATUSES, REQUEST_KINDS, REQUEST_STATUSES } = require('../../lib/domain');
const { DEPARTMENTS } = require('../../lib/paie');
const appro = require('../appro');
const { inPeriod, day, sum } = require('./index');

const fr = d => d.split('-').reverse().join('/');
const byDay = key => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
// Commandes engagées auprès du fournisseur (validées), qu'elles soient reçues ou non
const ORDERED = ['confirmee', 'partielle', 'recue'];

module.exports = {
  title: 'Achats & stocks',
  allowed: v => v.can('appro:read'),
  async build(db, p) {
    const [orders, receipts, siteNeeds, requests, positions, later] = await Promise.all([
      db('appro_orders as o').join('suppliers as s', 's.id', 'o.supplier_id').join('appro_locations as l', 'l.id', 'o.location_id').leftJoin('users as u', 'u.id', 'o.issuer_id')
        .select('o.id', 'o.reference', 'o.date', 'o.status', 'o.amount_ht', 'o.amount_ttc', 's.name as supplier', 'l.name as location', 'u.name as issuer'),
      db('appro_movements as m').leftJoin('appro_orders as o', 'o.id', 'm.order_id').leftJoin('suppliers as s', 's.id', 'o.supplier_id').leftJoin('appro_locations as l', 'l.id', 'm.to_location_id')
        .where({ 'm.kind': 'reception', 'm.status': 'valide' }).select('m.reference', 'm.date', 'm.amount_ttc', 'm.supplier_ref', 'o.reference as order_reference', 's.name as supplier', 'l.name as location'),
      db('worksite_needs as n').join('worksites as w', 'w.id', 'n.worksite_id').leftJoin('users as r', 'r.id', 'n.requested_by')
        .leftJoin('worksite_ref_items as u', function () { this.on('u.code', '=', 'n.unit').andOn('u.kind', '=', db.raw('?', ['unite'])); })
        .select('n.created_at', 'n.label', 'n.quantity', 'n.unit', 'n.needed_on', 'n.status', 'n.estimate_fcfa', 'w.reference as worksite', 'r.name as requester', 'u.label as unit_label'),
      // Demandes d'achat des services parvenues aux Achats (à traiter, commandées, ou rattachées à un bon de commande)
      db('internal_requests as r').join('users as u', 'u.id', 'r.requested_by').leftJoin('employees as e', 'e.user_id', 'r.requested_by')
        .whereIn('r.kind', Object.keys(REQUEST_KINDS).filter(k => REQUEST_KINDS[k].purchase))
        .where(q => q.whereIn('r.status', ['attente_achats', 'commande']).orWhereNotNull('r.order_id'))
        .select('r.created_at', 'r.title', 'r.kind', 'r.status', 'r.needed_by', 'r.estimated_amount', 'r.department', 'u.name as requester', 'e.department as employee_department'),
      appro.stock(db),
      // Mouvements validés datés après la période : retirés du stock actuel pour retrouver le stock au dernier jour
      db('appro_movement_lines as ml').join('appro_movements as m', 'm.id', 'ml.movement_id').where('m.status', 'valide')
        .select('ml.article_id', 'ml.quantity_units', 'm.date', 'm.from_location_id', 'm.to_location_id'),
    ]);

    const periodOrders = orders.filter(o => inPeriod(p, o.date)).map(o => ({ ...o, date: day(o.date), amount_ht: Number(o.amount_ht), amount_ttc: Number(o.amount_ttc) })).sort(byDay('date'));
    const issued = periodOrders.filter(o => o.status !== 'brouillon');
    const ordered = periodOrders.filter(o => ORDERED.includes(o.status));
    const received = receipts.filter(m => inPeriod(p, m.date)).map(m => ({ ...m, date: day(m.date), amount_ttc: Number(m.amount_ttc) || 0 })).sort(byDay('date'));

    const needs = [
      ...siteNeeds.filter(n => inPeriod(p, n.created_at)).map(n => ({
        date: day(n.created_at), origine: `Chantier ${n.worksite}`, demandeur: n.requester, objet: n.label, quantite: `${Number(n.quantity).toLocaleString('fr-FR')} ${n.unit_label || n.unit}`,
        echeance: day(n.needed_on), estimation: n.estimate_fcfa == null ? null : Number(n.estimate_fcfa), statut: NEED_STATUSES[n.status] || n.status,
      })),
      ...requests.filter(r => inPeriod(p, r.created_at)).map(r => {
        const dep = r.department || r.employee_department;
        return {
          date: day(r.created_at), origine: dep ? `Service ${DEPARTMENTS[dep] || dep}` : 'Service', demandeur: r.requester, objet: r.title, quantite: REQUEST_KINDS[r.kind]?.label || r.kind,
          echeance: day(r.needed_by), estimation: r.estimated_amount == null ? null : Number(r.estimated_amount), statut: REQUEST_STATUSES[r.status] || r.status,
        };
      }),
    ].sort(byDay('date'));

    // Stock au dernier jour de la période = stock actuel − entrées postérieures + sorties postérieures
    const after = new Map();
    const add = (articleId, locationId, delta) => { const k = `${articleId}:${locationId}`; after.set(k, (after.get(k) || 0) + delta); };
    for (const m of later) {
      if (!(day(m.date) > p.toDay)) continue;
      const q = Number(m.quantity_units);
      if (m.to_location_id) add(m.article_id, m.to_location_id, q);
      if (m.from_location_id) add(m.article_id, m.from_location_id, -q);
    }
    const low = positions.map(b => {
      const units = Number(b.quantity_units) - (after.get(`${b.article_id}:${b.location_id}`) || 0);
      return { ...b, quantity: units / 100, low: units <= Number(b.min_units ?? b.default_min_units) };
    }).filter(b => b.low);

    return {
      summary: [
        { label: 'Bons de commande émis', value: issued.length, format: 'number' },
        { label: 'Montant commandé (bons validés, TTC)', value: sum(ordered, 'amount_ttc'), format: 'fcfa' },
        { label: 'Bons de commande en attente de validation', value: periodOrders.filter(o => APPRO_PENDING_STATUSES.includes(o.status)).length, format: 'number' },
        { label: 'Réceptions', value: received.length, format: 'number' },
        { label: 'Montant reçu (TTC)', value: sum(received, 'amount_ttc'), format: 'fcfa' },
        { label: 'Besoins exprimés (chantiers et services)', value: needs.length, format: 'number' },
        { label: `Articles sous le seuil au ${fr(p.toDay)}`, value: low.length, format: 'number' },
      ],
      sections: [
        { title: 'Bons de commande', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'reference', label: 'Référence' }, { key: 'fournisseur', label: 'Fournisseur' }, { key: 'emplacement', label: 'Livraison' },
          { key: 'emetteur', label: 'Émetteur' }, { key: 'statut', label: 'Statut' }, { key: 'ht', label: 'Montant HT', format: 'fcfa' }, { key: 'ttc', label: 'Montant TTC', format: 'fcfa' },
        ], rows: periodOrders.map(o => ({
          date: o.date, reference: o.reference, fournisseur: o.supplier, emplacement: o.location, emetteur: o.issuer, statut: APPRO_ORDER_STATUSES[o.status] || o.status, ht: o.amount_ht, ttc: o.amount_ttc,
        })) },
        { title: 'Réceptions', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'reference', label: 'Bon de réception' }, { key: 'commande', label: 'Bon de commande' }, { key: 'fournisseur', label: 'Fournisseur' },
          { key: 'bl', label: 'Bon de livraison fournisseur' }, { key: 'emplacement', label: 'Emplacement' }, { key: 'ttc', label: 'Montant TTC', format: 'fcfa' },
        ], rows: received.map(m => ({ date: m.date, reference: m.reference, commande: m.order_reference, fournisseur: m.supplier, bl: m.supplier_ref, emplacement: m.location, ttc: m.amount_ttc })) },
        { title: 'Besoins exprimés', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'origine', label: 'Origine' }, { key: 'demandeur', label: 'Demandeur' }, { key: 'objet', label: 'Désignation' },
          { key: 'quantite', label: 'Quantité ou nature' }, { key: 'echeance', label: 'Pour le', format: 'date' }, { key: 'estimation', label: 'Estimation', format: 'fcfa' }, { key: 'statut', label: 'Statut' },
        ], rows: needs },
        { title: `Articles sous le seuil au ${fr(p.toDay)}`, columns: [
          { key: 'code', label: 'Code' }, { key: 'article', label: 'Article' }, { key: 'emplacement', label: 'Emplacement' }, { key: 'quantite', label: 'Quantité', format: 'number' },
          { key: 'seuil', label: 'Seuil', format: 'number' }, { key: 'unite', label: 'Unité' },
        ], rows: low.map(b => ({ code: b.code, article: b.label, emplacement: b.location_name, quantite: b.quantity, seuil: b.min_quantity, unite: b.unit })) },
      ],
    };
  },
};
