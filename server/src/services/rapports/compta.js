/**
 * Rapport de la Comptabilité : produits, charges et résultat de la période, encaissements et décaissements de trésorerie, achats
 * de la période, et soldes « à date » (trésorerie, créances clients, dettes fournisseurs) à la date de fin, dans l'exercice qui la
 * couvre (les à-nouveaux reprennent les soldes d'un exercice à l'autre). Brouillons compris, comme le tableau de bord.
 * Salaire de chacun : sans « Consulter la paie », les lignes nominatives de la paie sont masquées comme à l'écran (audit du 29/10).
 * Droits : ceux du tableau de bord (compta:read).
 */
const ct = require('../compta');
const { JOURNAL_KINDS } = require('../../lib/compta');
const { inPeriod, day, sum } = require('./index');

const ENTRY_STATUS = { brouillon: 'Brouillon', valide: 'Validée' };
const PURCHASE_STATUS = { brouillon: 'Brouillon', validee: 'Validée' };
// Lignes nominatives de la paie (services/paie.js) : « Net à payer — Nom », « Salaire 2026-11 — Nom », « Avance retenue — Nom »
const PAY_LINE = /^(Net à payer|Salaire .+|Avance retenue) — /;
const fr = d => d.split('-').reverse().join('/');
const byDay = key => (a, b) => String(day(a[key])).localeCompare(String(day(b[key]))) || (a.entry_id || a.id) - (b.entry_id || b.id);

module.exports = {
  title: 'Comptabilité',
  allowed: v => v.can('compta:read'),
  async build(db, p, v) {
    const [lines, journals, fy, invoices, payments] = await Promise.all([
      ct.linesQuery(db, { includeDraft: true }).join('acc_journals as j', 'j.id', 'e.journal_id')
        .select('l.debit', 'l.credit', 'l.label', 'l.partner_type', 'l.partner_id', 'a.code', 'a.label as account_label', 'a.class',
          'e.id as entry_id', 'e.date', 'e.number', 'e.ref', 'e.label as entry_label', 'e.status', 'e.source', 'e.fiscal_year_id', 'j.id as journal_id'),
      db('acc_journals as j').leftJoin('acc_accounts as a', 'a.id', 'j.account_id').orderBy('j.code').select('j.id', 'j.code', 'j.label', 'j.kind', 'a.code as account_code'),
      ct.fiscalYearFor(db, p.toDay),
      db('purchase_invoices as i').join('suppliers as s', 's.id', 'i.supplier_id').leftJoin('projects as pr', 'pr.id', 'i.project_id')
        .leftJoin('worksites as w', 'w.id', 'i.worksite_id').leftJoin('places as pl', 'pl.id', 'i.place_id').whereNot('i.status', 'annulee')
        .select('i.id', 'i.number', 'i.date', 'i.label', 'i.status', 'i.amount_ht', 'i.vat_amount', 'i.amount_ttc', 's.name as supplier',
          'pr.name as programme', 'w.reference as chantier', 'pl.name as lieu'),
      db('purchase_payments').select('invoice_id', 'date', 'amount'),
    ]);
    const journalOf = Object.fromEntries(journals.map(j => [j.id, j]));
    const cash = new Set(journals.filter(j => ['banque', 'caisse', 'mobile'].includes(j.kind) && j.account_code).map(j => j.account_code));
    const n = x => Number(x) || 0;

    // Période : écritures datées dans la période (tous exercices)
    const inP = lines.filter(l => inPeriod(p, l.date));
    const produits = inP.filter(l => l.class === 7).reduce((t, l) => t + n(l.credit) - n(l.debit), 0);
    const charges = inP.filter(l => l.class === 6).reduce((t, l) => t + n(l.debit) - n(l.credit), 0);
    // Résultat : classes 6 à 8 (activités ordinaires et HAO), comme le compte de résultat
    const resultat = -inP.filter(l => l.class >= 6 && l.class <= 8).reduce((t, l) => t + n(l.debit) - n(l.credit), 0);
    // Flux de trésorerie : hors à-nouveaux (reprise des soldes, pas un mouvement)
    const flows = inP.filter(l => cash.has(l.code) && l.source !== 'an');
    const encaisse = flows.reduce((t, l) => t + n(l.debit), 0), decaisse = flows.reduce((t, l) => t + n(l.credit), 0);

    // À date : jusqu'à la date de fin, dans l'exercice qui la couvre (sinon toutes les écritures jusqu'à cette date)
    const upTo = lines.filter(l => day(l.date) <= p.toDay && (!fy || l.fiscal_year_id === fy.id));
    const balanceOf = rows => rows.reduce((t, l) => t + n(l.debit) - n(l.credit), 0);
    const tresorerie = balanceOf(upTo.filter(l => cash.has(l.code)));
    const partners = kind => {
      const by = {};
      for (const l of upTo.filter(x => x.partner_type === kind && x.partner_id)) by[l.partner_id] = (by[l.partner_id] || 0) + n(l.debit) - n(l.credit);
      return Object.values(by);
    };
    const creances = partners('client').filter(b => b > 0).reduce((t, b) => t + b, 0);
    const dettes = -partners('fournisseur').filter(b => b < 0).reduce((t, b) => t + b, 0);
    const atEnd = `au ${fr(p.toDay)}`;

    // Achats de la période ; réglé : paiements jusqu'à la date de fin
    const purchases = invoices.filter(i => inPeriod(p, i.date)).sort(byDay('date'));
    const paidBy = {};
    for (const x of payments) if (day(x.date) <= p.toDay) paidBy[x.invoice_id] = (paidBy[x.invoice_id] || 0) + n(x.amount);

    // Résultat par compte (classes 6 et 7)
    const accounts = {};
    for (const l of inP.filter(x => x.class === 6 || x.class === 7)) {
      const a = (accounts[l.code] ||= { compte: l.code, libelle: l.account_label, nature: l.class === 7 ? 'Produit' : 'Charge', debit: 0, credit: 0 });
      a.debit += n(l.debit); a.credit += n(l.credit);
    }
    const accountRows = Object.values(accounts).sort((a, b) => a.compte.localeCompare(b.compte))
      .map(a => ({ ...a, montant: a.nature === 'Produit' ? a.credit - a.debit : a.debit - a.credit }));

    // Écritures par journal sur la période
    const entries = {};
    for (const l of inP) {
      const e = (entries[l.entry_id] ||= { journal_id: l.journal_id, status: l.status, total: 0 });
      e.total += n(l.debit);
    }
    const journalRows = journals.map(j => {
      const list = Object.values(entries).filter(e => e.journal_id === j.id);
      return { journal: `${j.code} — ${j.label}`, type: JOURNAL_KINDS[j.kind] || j.kind, ecritures: list.length, brouillons: list.filter(e => e.status === 'brouillon').length, total: sum(list, 'total') };
    }).filter(j => j.ecritures);

    // Trésorerie par journal : flux de la période et solde à date
    const cashRows = journals.filter(j => cash.has(j.account_code)).map(j => {
      const f = flows.filter(l => l.code === j.account_code);
      return {
        journal: `${j.code} — ${j.label}`, type: JOURNAL_KINDS[j.kind] || j.kind, compte: j.account_code,
        encaissements: sum(f, 'debit'), decaissements: sum(f, 'credit'), solde: balanceOf(upTo.filter(l => l.code === j.account_code)),
      };
    });

    // Mouvements de trésorerie : libellé de paie nominatif masqué sans « Consulter la paie », comme à l'écran
    const seesPay = v.can('paie:read');
    const label = l => (!seesPay && l.partner_type === 'employe' && typeof l.label === 'string' && PAY_LINE.test(l.label)
      ? 'Salaire d’un employé (détail réservé à la Paie)' : l.label || l.entry_label);
    const moves = [...flows].sort(byDay('date')).map(l => ({
      date: day(l.date), journal: journalOf[l.journal_id]?.code, piece: l.number || 'Brouillon', libelle: label(l), reference: l.ref,
      encaissement: n(l.debit) || null, decaissement: n(l.credit) || null, statut: ENTRY_STATUS[l.status] || l.status,
    }));

    return {
      summary: [
        { label: 'Produits (classe 7)', value: produits, format: 'fcfa' },
        { label: 'Charges (classe 6)', value: charges, format: 'fcfa' },
        { label: 'Résultat de la période', value: resultat, format: 'fcfa' },
        { label: 'Encaissements de trésorerie', value: encaisse, format: 'fcfa' },
        { label: 'Décaissements de trésorerie', value: decaisse, format: 'fcfa' },
        { label: `Trésorerie ${atEnd}`, value: tresorerie, format: 'fcfa' },
        { label: `Créances clients ${atEnd}`, value: creances, format: 'fcfa' },
        { label: `Dettes fournisseurs ${atEnd}`, value: dettes, format: 'fcfa' },
        { label: 'Factures d’achat de la période (TTC)', value: sum(purchases, 'amount_ttc'), format: 'fcfa' },
        { label: 'Écritures de la période', value: Object.keys(entries).length, format: 'number' },
        { label: 'dont en brouillon (comprises dans les montants)', value: Object.values(entries).filter(e => e.status === 'brouillon').length, format: 'number' },
      ],
      sections: [
        { title: 'Résultat par compte', columns: [
          { key: 'compte', label: 'Compte' }, { key: 'libelle', label: 'Libellé' }, { key: 'nature', label: 'Nature' },
          { key: 'debit', label: 'Débit', format: 'fcfa' }, { key: 'credit', label: 'Crédit', format: 'fcfa' }, { key: 'montant', label: 'Montant', format: 'fcfa' },
        ], rows: accountRows },
        { title: 'Trésorerie par journal', columns: [
          { key: 'journal', label: 'Journal' }, { key: 'type', label: 'Type' }, { key: 'compte', label: 'Compte' },
          { key: 'encaissements', label: 'Encaissements', format: 'fcfa' }, { key: 'decaissements', label: 'Décaissements', format: 'fcfa' },
          { key: 'solde', label: `Solde ${atEnd}`, format: 'fcfa' },
        ], rows: cashRows },
        { title: 'Mouvements de trésorerie', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'journal', label: 'Journal' }, { key: 'piece', label: 'N° de pièce' }, { key: 'libelle', label: 'Libellé' },
          { key: 'reference', label: 'Référence' }, { key: 'encaissement', label: 'Encaissement', format: 'fcfa' }, { key: 'decaissement', label: 'Décaissement', format: 'fcfa' },
          { key: 'statut', label: 'Statut' },
        ], rows: moves },
        { title: 'Factures d’achat de la période', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'numero', label: 'N° facture' }, { key: 'fournisseur', label: 'Fournisseur' }, { key: 'objet', label: 'Objet' },
          { key: 'imputation', label: 'Imputation' }, { key: 'statut', label: 'Statut' }, { key: 'ht', label: 'Montant HT', format: 'fcfa' }, { key: 'tva', label: 'TVA', format: 'fcfa' },
          { key: 'ttc', label: 'Montant TTC', format: 'fcfa' }, { key: 'regle', label: `Réglé ${atEnd}`, format: 'fcfa' }, { key: 'reste', label: 'Reste à payer', format: 'fcfa' },
        ], rows: purchases.map(i => ({
          date: day(i.date), numero: i.number, fournisseur: i.supplier, objet: i.label,
          imputation: i.chantier ? `${i.programme ? `${i.programme} · ` : ''}chantier ${i.chantier}` : i.programme || i.lieu || 'Siège',
          statut: PURCHASE_STATUS[i.status] || i.status, ht: n(i.amount_ht), tva: n(i.vat_amount), ttc: n(i.amount_ttc),
          regle: paidBy[i.id] || 0, reste: n(i.amount_ttc) - (paidBy[i.id] || 0),
        })) },
        { title: 'Écritures par journal', columns: [
          { key: 'journal', label: 'Journal' }, { key: 'type', label: 'Type' }, { key: 'ecritures', label: 'Écritures', format: 'number' },
          { key: 'brouillons', label: 'dont brouillons', format: 'number' }, { key: 'total', label: 'Total débit', format: 'fcfa' },
        ], rows: journalRows },
      ],
    };
  },
};
