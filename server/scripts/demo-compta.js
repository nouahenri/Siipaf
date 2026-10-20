/**
 * Données de démonstration de la Comptabilité et de la paie (base de démo locale uniquement).
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-compta.js
 * Exercice de l'année en cours, fournisseurs et sous-traitants, factures d'achat par programme (validées, réglées
 * en partie), employés (dont les comptes du dashboard), paies de janvier au mois dernier validées et payées,
 * paie du mois en brouillon, puis synchronisation des ventes et versements.
 */
const { createDb } = require('../src/db');
const compta = require('../src/services/compta');
const paie = require('../src/services/paie');

const pick = (a, i) => a[i % a.length];

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Script réservé à la base de démo.');
  const db = createDb();
  if (await db('suppliers').first()) { console.log('Données de comptabilité déjà présentes.'); return db.destroy(); }
  const admin = await db('users').orderBy('id').first();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (!(await db('acc_fiscal_years').where({ label: String(y) }).first())) {
    await db('acc_fiscal_years').insert({ label: String(y), start_date: `${y}-01-01`, end_date: `${y}-12-31` });
  }
  const projects = await db('projects').whereIn('id', db('lots').select('project_id')).select('id', 'name');

  const suppliers = [
    ['SOCOCIM Matériaux', 'fournisseur', '604100'], ['Fer & Acier d’Abidjan', 'fournisseur', '604100'], ['BTP Ivoire Construction', 'sous_traitant', '621100'],
    ['Réseaux VRD Services', 'sous_traitant', '621200'], ['Cabinet d’architecture Koné & Associés', 'prestataire', '632100'], ['Étude Maître Yao, notaire', 'prestataire', '632200'],
    ['Imprimerie Graphik CI (publicité)', 'prestataire', '627'], ['CIE — électricité', 'fournisseur', '6052'],
  ];
  const sup = [];
  for (const [name, kind, acc] of suppliers) {
    const a = await db('acc_accounts').where({ code: acc }).first();
    const [id] = await db('suppliers').insert({ name, kind, expense_account_id: a.id, ncc: `CI-${1000000 + sup.length * 7919}` });
    sup.push({ id: typeof id === 'object' ? id.id : id, account: a.id, kind });
  }
  const bq = await db('acc_journals').where({ code: 'BQ' }).first();
  let n = 0;
  for (let month = 1; month <= m; month++) {
    for (let k = 0; k < 3; k++) {
      const s = pick(sup, month * 3 + k);
      const day = String(5 + k * 8).padStart(2, '0');
      const date = `${y}-${String(month).padStart(2, '0')}-${day}`;
      const base = s.kind === 'sous_traitant' ? 18e6 : s.kind === 'prestataire' ? 3.5e6 : 9e6;
      const ttc = Math.round((base * (0.6 + ((month * 7 + k * 3) % 9) / 10)) / 1000) * 1000;
      const project = s.account && pick(projects, month + k);
      const [iid] = await db('purchase_invoices').insert({
        number: `ACH-${y}-${String(++n).padStart(4, '0')}`, supplier_id: s.id, supplier_ref: `F${month}${k}${y}`, date, due_date: `${y}-${String(month).padStart(2, '0')}-28`,
        label: s.kind === 'sous_traitant' ? `Situation de travaux n° ${month}` : s.kind === 'prestataire' ? 'Honoraires du mois' : 'Livraison de matériaux',
        project_id: s.kind === 'prestataire' && k === 2 ? null : project.id, expense_account_id: s.account,
        amount_ht: Math.round(ttc / 1.18), vat_rate: 18, vat_amount: ttc - Math.round(ttc / 1.18), amount_ttc: ttc, created_by: admin.id,
      });
      const invoiceId = typeof iid === 'object' ? iid.id : iid;
      await compta.validatePurchase(db, invoiceId, admin.id);
      if (month < m || k === 0) await compta.payPurchase(db, invoiceId, { date: `${y}-${String(month).padStart(2, '0')}-${String(Math.min(28, Number(day) + 10)).padStart(2, '0')}`, amount: month < m - 1 ? ttc : Math.round(ttc / 2), journal_id: bq.id, reference: `VIR-${invoiceId}` }, admin.id);
    }
  }

  // Employés : comptes du dashboard + personnel de bureau et de chantier
  const staff = [
    ['KOUASSI', 'Jean-Marc', 'Directeur général', 'direction', 2500000, 'marie', 3, null],
    ['DIABATÉ', 'Awa', 'Commerciale', 'commercial', 450000, 'celibataire', 1, null],
    ['KOUADIO', 'Serge', 'Commercial', 'commercial', 420000, 'marie', 2, null],
    ['TOURÉ', 'Mariam', 'Comptable', 'comptabilite', 650000, 'marie', 1, null],
    ['BAMBA', 'Issouf', 'Conducteur de travaux', 'technique', 850000, 'marie', 4, 0],
    ['YAO', 'Christelle', 'Assistante de direction', 'administratif', 320000, 'celibataire', 0, null],
    ['KONAN', 'Firmin', 'Chef de chantier', 'chantier', 380000, 'marie', 3, 1],
    ['OUATTARA', 'Lassina', 'Maçon', 'chantier', 160000, 'marie', 2, 1],
    ['GBAGBO', 'Didier', 'Ferrailleur', 'chantier', 150000, 'celibataire', 1, 2],
    ['N’GUESSAN', 'Paul', 'Gardien de chantier', 'chantier', 90000, 'marie', 5, 2],
  ];
  const users = await db('users').select('id', 'name');
  for (const [i, [last, first, job, dept, salary, marital, kids, proj]] of staff.entries()) {
    const user = users.find(u => u.name.toLowerCase().includes(first.toLowerCase()));
    await db('employees').insert({
      matricule: await paie.nextMatricule(db), user_id: user ? user.id : null, last_name: last, first_name: first, job_title: job, department: dept,
      contract_type: dept === 'chantier' ? 'chantier' : 'cdi', hire_date: i === 6 ? `${y}-03-15` : `${y - 1}-06-01`, base_salary: salary,
      transport_allowance: salary >= 300000 ? 30000 : 25000, housing_allowance: salary >= 600000 ? Math.round(salary * 0.2) : 0,
      marital_status: marital, children: kids, pay_method: dept === 'chantier' ? (i % 2 ? 'mobile_money' : 'especes') : 'virement',
      accident_rate: dept === 'chantier' ? 5 : null, project_id: proj != null ? projects[proj % projects.length].id : null, cnps_number: `CNPS${100200 + i}`,
    });
  }
  for (let month = 1; month <= m; month++) {
    const period = `${y}-${String(month).padStart(2, '0')}`;
    const run = await paie.createRun(db, period, admin.id);
    const slips = await db('payslips').where({ run_id: run.id });
    for (const [k, s] of slips.entries()) if (k % 3 === 0) await paie.updatePayslip(db, s.id, { bonus: 25000 * (1 + (month % 3)), overtime: k % 2 ? 15000 : 0 });
    if (month < m) {
      await paie.validateRun(db, run.id, admin.id);
      await paie.payRun(db, run.id, { date: paie.lastDay(period) }, admin.id);
    }
  }

  const sync = await compta.syncAutoEntries(db, admin.id);
  // Tout est validé sauf le mois en cours (brouillons à contrôler)
  const drafts = await db('acc_entries').where({ status: 'brouillon' }).where('date', '<', `${y}-${String(m).padStart(2, '0')}-01`).orderBy([{ column: 'date' }, { column: 'id' }]).select('id');
  for (const e of drafts) await db.transaction(trx => compta.validateEntry(trx, e.id, admin.id));
  console.log(`Comptabilité de démonstration : ${sup.length} fournisseurs, ${n} factures d’achat, ${staff.length} employés, ${m} paies ; synchronisation : ${sync.created} écritures ; ${drafts.length} validées.`);
  await db.destroy();
})().catch(e => { console.error(e); process.exit(1); });
