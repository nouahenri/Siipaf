const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

// Rapports des tableaux de bord (Exporter, Imprimer ; demande du client du 03/11) : Client & SAV et Comptabilité.
// Droits du tableau de bord, portée de l'écran, indicateurs de la période, données hors période exclues.
let db, app, admin, comptable, commercial, editeur, expl, sale;
const R = '/api/admin/erp/rapports';
const S = '/api/admin/erp/sav';
const C = '/api/admin/erp/compta';
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const du = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-01`;
const au = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
const today = iso(now);
const before20 = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 20 * 86400000)); // mois précédent
const Q = `?du=${du}&au=${au}`;
const kpi = (r, label) => {
  const k = r.summary.find(s => s.label === label || s.label.startsWith(label));
  assert.ok(k, `indicateur « ${label} » absent : ${r.summary.map(s => s.label).join(' | ')}`);
  return k.value;
};
const section = (r, title) => {
  const s = r.sections.find(x => x.title.startsWith(title));
  assert.ok(s, `section « ${title} » absente`);
  return s;
};
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const structure = r => {
  assert.ok(r.title && r.period?.from && r.period?.to && r.period?.label, 'titre et période');
  assert.ok(Array.isArray(r.summary) && r.summary.length, 'indicateurs');
  r.summary.forEach(s => assert.ok(s.label && 'value' in s && s.format, `indicateur incomplet : ${JSON.stringify(s)}`));
  assert.ok(r.sections.length, 'sections');
  for (const s of r.sections) {
    assert.ok(s.title && s.columns.length && Array.isArray(s.rows), `section incomplète : ${s.title}`);
    s.columns.forEach(c => assert.ok(c.key && c.label && !/_/.test(c.label), `colonne illisible : ${c.label}`));
    s.rows.forEach(row => Object.keys(row).forEach(k => assert.ok(s.columns.some(c => c.key === k), `clé ${k} sans colonne dans ${s.title}`)));
  }
};

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  expl = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'R1', price_fcfa: 20000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code: 'R1' }).first();
  sale = ok(await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: 'Adjoua Brou', phone: '0705050505', financing: 'comptant' }), 201);
});
after(() => db.destroy());

test('droits : rapport refusé sans le droit du tableau de bord, module inconnu, période invalide', async () => {
  assert.equal((await editeur.get(`${R}/sav${Q}`)).status, 403, 'éditeur : pas de SAV');
  assert.equal((await editeur.get(`${R}/compta${Q}`)).status, 403, 'éditeur : pas de comptabilité');
  assert.equal((await commercial.get(`${R}/compta${Q}`)).status, 403, 'commercial : pas de comptabilité');
  assert.equal((await admin.get(`${R}/inconnu`)).status, 404);
  assert.equal((await admin.get(`${R}/sav?du=${au}&au=${du}`)).status, 400, 'fin avant le début');
});

test('rapport Client & SAV : réclamations, délais, satisfaction, réserves, interventions ; hors période exclu ; portée', async () => {
  const urgent = ok(await admin.post(`${S}/tickets`).send({ sale_id: sale.id, category: 'plomberie', priority: 'urgente', title: 'Fuite sous l’évier' }), 201);
  const open = ok(await admin.post(`${S}/tickets`).send({ sale_id: sale.id, category: 'etancheite', title: 'Infiltration en toiture' }), 201);
  const old = ok(await admin.post(`${S}/tickets`).send({ sale_id: sale.id, category: 'menuiserie', title: 'Porte qui frotte' }), 201);
  await db('sav_tickets').where({ id: old.id }).update({ created_at: new Date(`${before20}T09:00:00Z`) }); // reçue le mois précédent
  ok(await admin.post(`${S}/tickets/${urgent.id}/status`).send({ status: 'resolu' }));
  await db('sav_tickets').where({ id: urgent.id }).update({ satisfaction: 4 });
  ok(await admin.post(`${S}/sales/${sale.id}/reserves`).send({ label: 'Carreau fissuré', category: 'revetements', noted_at: today }), 201);
  ok(await admin.post(`${S}/sales/${sale.id}/reserves`).send({ label: 'Prise arrachée', category: 'electricite', noted_at: before20 }), 201);
  const inter = ok(await admin.post(`${S}/interventions`).send({ ticket_id: open.id, scheduled_at: now.toISOString(), cost_fcfa: 75000 }), 201);
  ok(await admin.patch(`${S}/interventions/${inter.id}`).send({ status: 'realisee', report: 'Joint refait' }));

  const r = ok(await admin.get(`${R}/sav${Q}`));
  structure(r);
  assert.equal(r.title, 'Client & SAV');
  assert.deepEqual([r.period.from, r.period.to], [du, au]);
  assert.equal(kpi(r, 'Réclamations reçues'), 2, 'la réclamation du mois précédent est exclue');
  assert.equal(kpi(r, 'dont priorité haute ou urgente'), 1);
  assert.equal(kpi(r, 'Réclamations résolues'), 1);
  assert.equal(kpi(r, 'Résolues dans les délais'), 100);
  assert.equal(kpi(r, 'Satisfaction client'), 4);
  assert.equal(kpi(r, 'Réclamations ouvertes au'), 2, 'à date : la réclamation ancienne encore ouverte compte');
  assert.match(r.summary.find(s => s.label.startsWith('Réclamations ouvertes')).label, new RegExp(`au ${au.split('-').reverse().join('/')}`));
  assert.equal(kpi(r, 'Réserves relevées'), 1, 'réserve du mois précédent exclue');
  assert.equal(kpi(r, 'Interventions réalisées'), 1);
  assert.equal(kpi(r, 'Coût des interventions réalisées'), 75000);

  const received = section(r, 'Réclamations reçues').rows;
  assert.deepEqual(received.map(t => t.reference).sort(), [urgent.ref, open.ref].sort());
  const u = received.find(t => t.reference === urgent.ref);
  assert.equal(u.type, 'Plomberie');
  assert.equal(u.priorite, 'Urgente', 'priorité traduite');
  assert.equal(u.statut, 'Résolu', 'statut traduit');
  assert.equal(u.client, 'Adjoua Brou');
  assert.equal(section(r, 'Réclamations résolues').rows[0].a_temps, 'Oui');
  assert.deepEqual(section(r, 'Par type de problème').rows.map(x => x.type).sort(), ['Plomberie', 'Étanchéité / infiltrations'].sort());
  assert.ok(section(r, 'Réclamations ouvertes').rows.some(t => t.reference === old.ref));
  assert.deepEqual(section(r, 'Réserves').rows.map(x => x.reserve), ['Carreau fissuré']);
  assert.equal(section(r, 'Réserves').rows[0].statut, 'À lever');
  const iv = section(r, 'Interventions').rows;
  assert.equal(iv.length, 1);
  assert.equal(iv[0].statut, 'Réalisée');
  assert.equal(iv[0].cout, 75000);

  // Période sans activité : rien de reçu
  const empty = ok(await admin.get(`${R}/sav?du=2020-01-01&au=2020-01-31`));
  assert.equal(kpi(empty, 'Réclamations reçues'), 0);

  // Portée : le commercial (sans « Portée : tout le SAV ») ne voit pas les réclamations d'un client qui n'est pas le sien
  const mine = ok(await commercial.get(`${R}/sav${Q}`));
  assert.equal(kpi(mine, 'Réclamations reçues'), 0);
  assert.equal(section(mine, 'Réclamations reçues').rows.length, 0);
  assert.equal(section(mine, 'Réserves').rows.length, 0);
  assert.equal(section(mine, 'Interventions').rows.length, 0);
  // Son client : visible
  const cid = (await db('users').where({ role: 'commercial' }).first('id')).id;
  await db('leads').where({ id: sale.lead_id }).update({ assigned_to: cid });
  assert.equal(kpi(ok(await commercial.get(`${R}/sav${Q}`)), 'Réclamations reçues'), 2);
});

test('rapport Comptabilité : produits, charges, résultat, trésorerie, achats de la période ; hors période exclu ; paie masquée', async () => {
  const y = now.getUTCFullYear(), py = Number(before20.slice(0, 4));
  ok(await comptable.post(`${C}/fiscal-years`).send({ label: String(y), start_date: `${y}-01-01`, end_date: `${y}-12-31` }), 201);
  if (py !== y) ok(await comptable.post(`${C}/fiscal-years`).send({ label: String(py), start_date: `${py}-01-01`, end_date: `${py}-12-31` }), 201);
  const bq = await db('acc_journals').where({ code: 'BQ' }).first();
  // Produit encaissé dans la période, et un autre le mois précédent (hors période)
  ok(await comptable.post(`${C}/entries`).send({ journal_id: bq.id, date: today, label: 'Vente de terrain', lines: [{ account: '521100', debit: 2000000 }, { account: '702110', credit: 2000000 }] }), 201);
  ok(await comptable.post(`${C}/entries`).send({ journal_id: bq.id, date: before20, label: 'Vente antérieure', lines: [{ account: '521100', debit: 5000000 }, { account: '702110', credit: 5000000 }] }), 201);
  // Achat de la période validé et réglé en partie ; achat du mois précédent validé (hors période)
  const sup = ok(await comptable.post(`${C}/suppliers`).send({ name: 'BTP Ivoire' }), 201);
  const inv = ok(await comptable.post(`${C}/purchases`).send({ supplier_id: sup.id, date: today, label: 'Gros œuvre', expense_account: '621100', amount_ttc: 1180000, vat_rate: 18 }), 201);
  ok(await comptable.post(`${C}/purchases/${inv.id}/validate`));
  ok(await comptable.post(`${C}/purchases/${inv.id}/payments`).send({ date: today, amount: 500000, journal_id: bq.id, reference: 'CHQ 1' }), 201);
  const oldInv = ok(await comptable.post(`${C}/purchases`).send({ supplier_id: sup.id, date: before20, label: 'Études', expense_account: '621100', amount_ttc: 300000 }), 201);
  ok(await comptable.post(`${C}/purchases/${oldInv.id}/validate`));
  // Salaire versé dans la période, ligne nominative de paie sur la banque
  const [eid] = await db('acc_entries').insert({ journal_id: bq.id, fiscal_year_id: (await db('acc_fiscal_years').where({ label: String(y) }).first()).id, date: today, label: 'Salaires du mois', status: 'brouillon', source: 'manuel' });
  const entryId = typeof eid === 'object' ? eid.id : eid;
  const bank = await db('acc_accounts').where({ code: '521100' }).first();
  const net = await db('acc_accounts').where({ code: '422' }).first() || await db('acc_accounts').where('code', 'like', '42%').first();
  await db('acc_lines').insert([
    { entry_id: entryId, account_id: net.id, debit: 300000, credit: 0, sort: 0 },
    { entry_id: entryId, account_id: bank.id, debit: 0, credit: 300000, partner_type: 'employe', partner_id: 1, label: 'Salaire 2026-11 — Koné Awa', sort: 1 },
  ]);

  const r = ok(await comptable.get(`${R}/compta${Q}`));
  structure(r);
  assert.equal(r.title, 'Comptabilité');
  assert.equal(kpi(r, 'Produits (classe 7)'), 2000000, 'le produit du mois précédent est exclu');
  assert.equal(kpi(r, 'Charges (classe 6)'), 1000000, 'charge HT de la facture de la période seulement');
  assert.equal(kpi(r, 'Résultat de la période'), 1000000);
  assert.equal(kpi(r, 'Encaissements de trésorerie'), 2000000);
  assert.equal(kpi(r, 'Décaissements de trésorerie'), 800000, 'règlement fournisseur et salaire');
  assert.equal(kpi(r, 'Trésorerie au'), (py === y ? 5000000 : 0) + 2000000 - 800000, 'à date, dans l’exercice de la date de fin');
  assert.equal(kpi(r, 'Dettes fournisseurs au'), (py === y ? 300000 : 0) + 680000);
  assert.equal(kpi(r, 'Factures d’achat de la période'), 1180000);

  const purchases = section(r, 'Factures d’achat').rows;
  assert.equal(purchases.length, 1, 'facture du mois précédent exclue');
  assert.deepEqual([purchases[0].statut, purchases[0].ht, purchases[0].tva, purchases[0].regle, purchases[0].reste], ['Validée', 1000000, 180000, 500000, 680000]);
  const accounts = section(r, 'Résultat par compte').rows;
  assert.deepEqual(accounts.map(a => [a.compte, a.nature, a.montant]), [['621100', 'Charge', 1000000], ['702110', 'Produit', 2000000]]);
  const cash = section(r, 'Trésorerie par journal').rows.find(j => j.compte === '521100');
  assert.deepEqual([cash.type, cash.encaissements, cash.decaissements], ['Banque', 2000000, 800000]);
  assert.ok(section(r, 'Écritures par journal').rows.length);

  // Paie : le comptable (Consulter la paie) voit le nom ; le responsable des exploitations (sans ce droit) non
  const movesOf = rep => section(rep, 'Mouvements de trésorerie').rows;
  assert.ok(movesOf(r).some(m => /Koné Awa/.test(m.libelle)));
  const masked = ok(await expl.get(`${R}/compta${Q}`));
  assert.ok(!JSON.stringify(masked).includes('Koné Awa'), 'nom du salarié masqué');
  assert.ok(movesOf(masked).some(m => m.libelle === 'Salaire d’un employé (détail réservé à la Paie)'));
  assert.equal(kpi(masked, 'Décaissements de trésorerie'), 800000, 'montants inchangés');
});
