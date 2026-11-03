/**
 * Rapport du Service commercial : ventes signées, encaissements, prospects et rendez-vous de la période, dans la portée de
 * l'écran (un commercial ne voit que ses prospects : scopeLeads). Droits : ceux du tableau de bord (commercial:read).
 */
const { scopeLeads, STAGE_LABELS } = require('../commercial');
const { inPeriod, day, sum } = require('./index');

const SALE_STATUS = { en_cours: 'En cours', solde: 'Soldé', desiste: 'Désisté' };
const METHODS = { virement: 'Virement', mobile_money: 'Mobile Money', especes: 'Espèces', cheque: 'Chèque', autre: 'Autre' };

module.exports = {
  title: 'Service commercial',
  allowed: v => v.can('commercial:read'),
  async build(db, p, v) {
    const [sales, payments, leads, appts] = await Promise.all([
      scopeLeads(db('sales as s').join('leads as ld', 'ld.id', 's.lead_id').leftJoin('lots as l', 'l.id', 's.lot_id').leftJoin('projects as pr', 'pr.id', 'l.project_id'), v.user)
        .select('s.id', 's.lead_id', 's.created_at', 's.signed_at', 's.price_fcfa', 's.status', 's.vefa', 'ld.name as client', 'l.code as lot', 'pr.name as programme'),
      scopeLeads(db('payments as pa').join('sales as s', 's.id', 'pa.sale_id').join('leads as ld', 'ld.id', 's.lead_id').leftJoin('lots as l', 'l.id', 's.lot_id'), v.user)
        .select('pa.paid_at', 'pa.amount_fcfa', 'pa.method', 'pa.reference', 'ld.name as client', 'l.code as lot'),
      scopeLeads(db('leads as ld').leftJoin('users as u', 'u.id', 'ld.assigned_to').leftJoin('projects as pr', 'pr.id', 'ld.project_id'), v.user)
        .select('ld.id', 'ld.created_at', 'ld.name', 'ld.source', 'ld.stage', 'ld.country', 'u.name as seller', 'pr.name as programme'),
      scopeLeads(db('appointments as a').join('leads as ld', 'ld.id', 'a.lead_id').leftJoin('users as u', 'u.id', 'a.assigned_to'), v.user)
        .select('a.starts_at', 'a.status', 'a.kind', 'ld.name as client', 'u.name as seller'),
    ]);
    const sold = sales.filter(s => s.status !== 'desiste' && inPeriod(p, s.created_at)).sort((a, b) => String(day(a.created_at)).localeCompare(String(day(b.created_at))));
    const paid = payments.filter(x => inPeriod(p, x.paid_at)).sort((a, b) => String(day(a.paid_at)).localeCompare(String(day(b.paid_at))));
    const fresh = leads.filter(l => inPeriod(p, l.created_at));
    const meetings = appts.filter(a => inPeriod(p, a.starts_at));
    // Prospects de la période devenus clients : une vente (non désistée) ouverte à leur nom
    const buyers = new Set(sales.filter(s => s.status !== 'desiste').map(s => s.lead_id));
    const won = fresh.filter(l => buyers.has(l.id)).length;
    return {
      summary: [
        { label: 'Chiffre d’affaires signé', value: sum(sold, 'price_fcfa'), format: 'fcfa' },
        { label: 'Ventes', value: sold.length, format: 'number' },
        { label: 'Encaissements', value: sum(paid, 'amount_fcfa'), format: 'fcfa' },
        { label: 'Nouveaux prospects', value: fresh.length, format: 'number' },
        { label: 'Prospects de la période devenus clients', value: fresh.length ? Math.round((won / fresh.length) * 1000) / 10 : 0, format: 'percent' },
        { label: 'Rendez-vous effectués', value: meetings.filter(a => a.status === 'effectue').length, format: 'number' },
      ],
      sections: [
        { title: 'Ventes de la période', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'client', label: 'Client' }, { key: 'programme', label: 'Programme' }, { key: 'lot', label: 'Lot' },
          { key: 'vefa', label: 'VEFA' }, { key: 'statut', label: 'Statut' }, { key: 'prix', label: 'Prix', format: 'fcfa' },
        ], rows: sold.map(s => ({ date: day(s.created_at), client: s.client, programme: s.programme, lot: s.lot, vefa: s.vefa ? 'Oui' : 'Non', statut: SALE_STATUS[s.status] || s.status, prix: Number(s.price_fcfa) })) },
        { title: 'Encaissements', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'client', label: 'Client' }, { key: 'lot', label: 'Lot' }, { key: 'mode', label: 'Mode' },
          { key: 'reference', label: 'Référence' }, { key: 'montant', label: 'Montant', format: 'fcfa' },
        ], rows: paid.map(x => ({ date: day(x.paid_at), client: x.client, lot: x.lot, mode: METHODS[x.method] || x.method, reference: x.reference, montant: Number(x.amount_fcfa) })) },
        { title: 'Nouveaux prospects', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'nom', label: 'Nom' }, { key: 'programme', label: 'Programme' }, { key: 'source', label: 'Source' },
          { key: 'pays', label: 'Pays' }, { key: 'etape', label: 'Étape' }, { key: 'commercial', label: 'Commercial' },
        ], rows: fresh.map(l => ({ date: day(l.created_at), nom: l.name, programme: l.programme, source: l.source, pays: l.country, etape: STAGE_LABELS[l.stage] || l.stage, commercial: l.seller })) },
      ],
    };
  },
};
