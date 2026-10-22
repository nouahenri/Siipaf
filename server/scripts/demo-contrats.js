/**
 * Données de démonstration des Contrats et échéances (ERP · Administration générale ; base de démo locale uniquement).
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-contrats.js
 * Gardiennage mensuel, bail du dépôt, assurance à renouveler, sous-traitance de chantier, abonnement internet,
 * convention « autre » ; alertes marquées faites et factures déjà préparées pour que la démo n'envoie rien.
 */
const { createDb } = require('../src/db');

const DAY = 24 * 3600 * 1000;
const ymd = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

(async () => {
  const db = createDb();
  if (process.env.NODE_ENV === 'production') throw new Error('Script réservé à la base de démo.');
  if ((await db('contracts').count({ n: '*' }))[0].n > 0) { console.log('Contrats déjà présents.'); return db.destroy(); }
  const admin = await db('users').orderBy('id').first();
  const staff = await db('users').whereNot({ id: admin.id }).where({ active: true }).orderBy('id').limit(3);
  const owner = i => (staff[i] || admin).id;
  const account = async code => (await db('acc_accounts').where('code', 'like', `${code}%`).orderBy('code').first('id'))?.id || null;
  const supplier = async (name, kind, code) => {
    const found = await db('suppliers').where({ name }).first();
    if (found) return found.id;
    const [id] = await db('suppliers').insert({ name, kind, expense_account_id: await account(code) });
    return typeof id === 'object' ? id.id : id;
  };
  const project = await db('projects').orderBy('id').first('id');
  const year = new Date().getUTCFullYear();
  let n = 0;
  const add = async c => {
    const [id] = await db('contracts').insert({ reference: `CTR-${year}-${String(++n).padStart(4, '0')}`, created_by: admin.id, ...c });
    return typeof id === 'object' ? id.id : id;
  };

  await add({ kind: 'fournisseur', title: 'Gardiennage du siège et du dépôt', supplier_id: await supplier('Sécurité Plus CI', 'prestataire', '628'), owner_id: owner(0),
    start_date: ymd(-300), end_date: ymd(65), tacit_renewal: true, renewal_months: 12, notice_days: 60, frequency: 'mensuel', amount_ttc: 1180000, vat_rate: 18,
    expense_account_id: await account('628'), next_payment_date: ymd(20), revision_date: ymd(65), revision_note: 'Indexation annuelle de 3 %' });
  await add({ kind: 'bail', title: 'Bail du dépôt de Bingerville', supplier_id: await supplier('SCI Les Palmiers', 'fournisseur', '622'), owner_id: owner(1),
    start_date: ymd(-700), end_date: ymd(395), notice_days: 90, frequency: 'trimestriel', amount_ttc: 2400000, expense_account_id: await account('622'), next_payment_date: ymd(40) });
  const insurance = await add({ kind: 'assurance', title: 'Multirisque bureaux et responsabilité civile', counterparty: 'NSIA Assurances', owner_id: owner(1),
    start_date: ymd(-355), end_date: ymd(10), notice_days: 30 });
  await db('contract_documents').insert({ contract_id: insurance, kind: 'attestation_assurance', label: 'Attestation d’assurance RC', expires_on: ymd(10), created_by: admin.id });
  const sub = await add({ kind: 'sous_traitance', title: 'Gros œuvre — îlot 4', supplier_id: await supplier('BTP Bâtisseurs Associés', 'sous_traitant', '604'), project_id: project?.id || null,
    owner_id: owner(2), start_date: ymd(-120), end_date: ymd(150), contract_amount: 185000000, retention_pct: 5 });
  await db('contract_documents').insert([
    { contract_id: sub, kind: 'caution', label: 'Caution de bonne fin', expires_on: ymd(160), created_by: admin.id },
    { contract_id: sub, kind: 'attestation_cnps', label: 'Attestation CNPS', expires_on: ymd(-3), created_by: admin.id },
  ]);
  await add({ kind: 'abonnement', title: 'Fibre internet du siège', supplier_id: await supplier('Orange Côte d’Ivoire', 'fournisseur', '628'), owner_id: owner(0),
    start_date: ymd(-200), tacit_renewal: true, frequency: 'mensuel', amount_ttc: 95000, vat_rate: 18, expense_account_id: await account('628'), next_payment_date: ymd(12) });
  await add({ kind: 'autre', kind_other: 'Convention de partenariat bancaire', title: 'Partenariat crédit acquéreurs', counterparty: 'Banque Atlantique', owner_id: admin.id,
    start_date: ymd(-60), end_date: ymd(305), revision_date: ymd(25), revision_note: 'Révision des taux préférentiels' });

  // Rien ne part de la démo : alertes marquées envoyées, échéances de paiement proches marquées préparées
  for (const c of await db('contracts')) {
    for (const key of ['fin', 'preavis', 'revision']) for (const stage of [30, 7]) {
      const due = { fin: c.end_date, revision: c.revision_date, preavis: c.end_date && c.notice_days ? new Date(Date.parse(c.end_date) - c.notice_days * DAY).toISOString().slice(0, 10) : null }[key];
      if (due) await db('contract_alerts').insert({ contract_id: c.id, deadline_key: key, due_date: due, stage });
    }
    for (const d of await db('contract_documents').where({ contract_id: c.id })) for (const stage of [30, 7]) await db('contract_alerts').insert({ contract_id: c.id, deadline_key: `piece:${d.id}`, due_date: d.expires_on, stage });
  }
  console.log('Contrats de démonstration enregistrés.');
  await db.destroy();
})().catch(e => { console.error(e); process.exit(1); });
