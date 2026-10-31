/**
 * Compléments de liaisons décidés par le client le 31/10/2026 (docs/audit-liaisons-notifications.md, « Compléments ») :
 * honoraires du notaire (facture d'achat en brouillon), « Réservé » et « Vendu » jamais posés à la main, avis de paie,
 * « Ouvrir un litige » depuis une réclamation SAV, caution libérée annoncée, seuil de trésorerie.
 * Écrit avec l'implémentation ; à lancer ensemble à la fin du projet (consigne du client).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const { INFO_EVENTS } = require('../src/lib/domain');
const compta = require('../src/services/compta');

let db, app, admin, juriste, comptable, commercial, project, notary, adminId, comptableId, juristeId;
const PASSWORD = 'motdepasse-test-123';
const J = '/api/admin/erp/juridique';
const year = new Date().getFullYear();
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const insertedId = r => (typeof r === 'object' ? r.id : r);
const unread = (userId, event) => db('notifications').where({ user_id: userId, event }).orderBy('id', 'desc');

/** Ouvre un dossier de vente sur un nouveau lot du projet, attribué au commercial. */
async function openSale(code, body = {}) {
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([...(await db('lots').where({ project_id: project.id }).select('code', 'price_fcfa')).map(l => ({ code: l.code, price_fcfa: Number(l.price_fcfa) })), { code, price_fcfa: 12000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code }).first();
  const res = await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: `Client ${code}`, phone: `+225 07 11 ${String(lot.id).padStart(2, '0')} 01`, email: `client.${code.toLowerCase()}@test.ci`, financing: 'comptant', ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await db('leads').where({ id: res.body.lead.id }).update({ assigned_to: (await db('users').where({ role: 'commercial' }).first()).id });
  return { sale: res.body, lot };
}

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  juriste = await login(app, await createUser(db, 'conducteur_travaux'), PASSWORD);
  comptable = await login(app, await createUser(db, 'comptable'), PASSWORD);
  commercial = await login(app, await createUser(db, 'commercial'), PASSWORD);
  const ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  adminId = ids.super_admin; comptableId = ids.comptable; juristeId = ids.conducteur_travaux;
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  notary = insertedId((await db('suppliers').insert({ name: 'Étude Maître Kouamé', kind: 'notaire', email: 'etude.kouame@test.ci' }))[0]);
  await comptable.post('/api/admin/erp/compta/fiscal-years').send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` });
});
after(() => db.destroy());

test('catalogue : les nouveaux événements existent, `lot.sans_dossier` est retiré', () => {
  for (const e of ['acte.honoraires', 'paie.validee', 'paie.payee', 'caution.liberee', 'tresorerie.seuil']) assert.ok(INFO_EVENTS[e], e);
  assert.equal(INFO_EVENTS['lot.sans_dossier'], undefined);
  assert.deepEqual(INFO_EVENTS['paie.validee'].audiences.sort(), ['compta', 'dg']);
  assert.deepEqual(INFO_EVENTS['tresorerie.seuil'].audiences.sort(), ['compta', 'dg']);
});

// ─── 1. Honoraires du notaire ─────────────────────────────────────────────

test('honoraires : une facture d’achat en brouillon au notaire, la Comptabilité prévenue avec le montant, sans doublon', async () => {
  const { sale } = await openSale('H1');
  const url = `${J}/actes/${sale.id}`;
  assert.equal((await juriste.post(url).send({ notary_fee_fcfa: 1200000 })).status, 400, 'notaire requis avant les honoraires');
  assert.equal((await commercial.post(url).send({ notary_supplier_id: notary, notary_fee_fcfa: 1200000 })).status, 403, 'droit juridique:deeds requis');

  let res = await juriste.post(url).send({ notary_supplier_id: notary, notary_fee_fcfa: 1200000 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.notary_fee_fcfa, 1200000);
  assert.equal(res.body.notary_invoice_status, 'brouillon');
  const invoices = await db('purchase_invoices').where({ supplier_id: notary });
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].status, 'brouillon');
  assert.equal(Number(invoices[0].amount_ttc), 1200000);
  assert.equal(invoices[0].project_id, project.id, 'rattachée au programme');
  assert.match(invoices[0].label, /Honoraires de notaire/);
  assert.equal(invoices[0].number, res.body.notary_invoice_number);
  const first = (await unread(comptableId, 'acte.honoraires'))[0];
  assert.match(first.title, /1.200.000 FCFA/);
  assert.equal(first.link, '/compta/achats');

  // Montant modifié : le brouillon est mis à jour, pas dupliqué, et la Comptabilité est prévenue du nouveau montant
  res = await juriste.post(url).send({ notary_fee_fcfa: 1500000 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const after1 = await db('purchase_invoices').where({ supplier_id: notary });
  assert.equal(after1.length, 1, 'pas de doublon');
  assert.equal(Number(after1[0].amount_ttc), 1500000);
  assert.ok((await unread(comptableId, 'acte.honoraires'))[0].title.match(/1.500.000/));
  // Même montant renvoyé : rien de plus
  const count = (await unread(comptableId, 'acte.honoraires')).length;
  await juriste.post(url).send({ notary_fee_fcfa: 1500000 });
  assert.equal((await unread(comptableId, 'acte.honoraires')).length, count);

  // Validée par la Comptabilité : le montant ne se modifie plus au Juridique
  assert.equal((await comptable.post(`/api/admin/erp/compta/purchases/${after1[0].id}/validate`)).status, 200);
  res = await juriste.post(url).send({ notary_fee_fcfa: 2000000 });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /déjà validée/);

  // Les honoraires restent au Juridique : le commercial du client ne les voit pas
  const seen = await commercial.get(url);
  if (seen.status === 200) assert.equal(seen.body.notary_fee_fcfa, null);
});

test('honoraires : effacer le montant supprime le brouillon', async () => {
  const { sale } = await openSale('H2');
  const url = `${J}/actes/${sale.id}`;
  await juriste.post(url).send({ notary_supplier_id: notary, notary_fee_fcfa: 800000 });
  const before1 = await db('purchase_invoices').where({ supplier_id: notary, status: 'brouillon' });
  assert.equal(before1.length, 1);
  const res = await juriste.post(url).send({ notary_fee_fcfa: null });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.notary_invoice_id, null);
  assert.equal((await db('purchase_invoices').where({ supplier_id: notary, status: 'brouillon' })).length, 0);
});

// ─── 2. « Réservé » et « Vendu » jamais à la main ────────────────────────

test('statut de lot : « Réservé » et « Vendu » refusés à la main, « Réservé » vient du dossier, « Vendu » de l’acte', async () => {
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'B1', price_fcfa: 9000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code: 'B1' }).first();
  for (const status of ['reserve', 'vendu']) {
    const res = await admin.post(`/api/admin/lots/${lot.id}/status`).send({ status });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /dossier|acte/);
  }
  assert.equal((await db('lots').where({ id: lot.id }).first()).status, 'disponible');
  assert.equal((await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'B2', price_fcfa: 9000000, status: 'vendu' }])).status, 400);
  assert.equal((await db('notifications').where('dedupe_key', 'like', 'lot:%:sans_dossier')).length, 0);

  // Le dossier de vente réserve le lot ; l'acte signé le vend (circuit du Juridique)
  const { sale, lot: l2 } = await openSale('B3');
  assert.equal((await db('lots').where({ id: l2.id }).first()).status, 'reserve');
  const url = `${J}/actes/${sale.id}`;
  for (const [key, offset] of [['reservation', -30], ['pieces', -25]]) assert.equal((await juriste.post(url).send({ key, date: day(offset) })).status, 200);
  assert.equal((await juriste.post(url).send({ key: 'notaire', date: day(-20), notary_supplier_id: notary })).status, 200);
  assert.equal((await juriste.post(url).send({ key: 'projet', date: day(-10) })).status, 200);
  assert.equal((await juriste.post(url).send({ key: 'acte', date: day(-1) })).status, 200);
  assert.equal((await db('lots').where({ id: l2.id }).first()).status, 'vendu');
});

// ─── 3. Avis de paie ──────────────────────────────────────────────────────

test('paie : validation et paiement préviennent la Comptabilité et la Direction générale', async () => {
  const P = '/api/admin/erp/paie';
  const period = `${year}-02`;
  const emp = await comptable.post(`${P}/employees`).send({ last_name: 'Paie', first_name: 'Awa', job_title: 'Assistante', department: 'commercial', hire_date: `${year - 1}-01-01`, base_salary: 300000, pay_method: 'virement' });
  assert.equal(emp.status, 201, JSON.stringify(emp.body));
  const run = (await comptable.post(`${P}/runs`).send({ period })).body;
  assert.equal((await comptable.post(`${P}/runs/${run.id}/validate`)).status, 200);
  const validee = (await unread(adminId, 'paie.validee'))[0];
  assert.ok(validee, 'la Direction générale (super administrateur) est prévenue');
  assert.equal(validee.link, `/compta/paie/${run.id}`);
  assert.equal(validee.dedupe_key, `paie:${run.id}:validee`);
  assert.equal((await unread(comptableId, 'paie.validee')).length, 0, 'l’auteur de l’action n’est pas prévenu');
  assert.equal((await comptable.post(`${P}/runs/${run.id}/pay`).send({ date: `${year}-02-28` })).status, 200);
  assert.ok((await unread(adminId, 'paie.payee')).some(n => n.dedupe_key === `paie:${run.id}:payee`));
});

// ─── 4. Ouvrir un litige depuis le SAV ────────────────────────────────────

test('SAV : « Ouvrir un litige » crée un litige d’origine SAV lié à la réclamation, au client, au programme et au lot', async () => {
  const { sale, lot } = await openSale('V1');
  const ticket = (await admin.post('/api/admin/erp/sav/tickets').send({ sale_id: sale.id, category: 'plomberie', title: 'Fuite persistante', description: 'La fuite revient malgré deux interventions.' })).body;
  assert.ok(ticket.id, JSON.stringify(ticket));
  const url = `/api/admin/erp/sav/tickets/${ticket.id}/litige`;
  assert.equal((await commercial.post(url).send({})).status, 403);
  assert.equal((await comptable.post(url).send({})).status, 403);

  const res = await admin.post(url).send({ amount_fcfa: 2500000, note: 'Mise en demeure à envisager.' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const litigation = await db('litigations').where({ id: res.body.litigation.id }).first();
  assert.equal(litigation.origin, 'sav');
  assert.equal(litigation.sav_ticket_id, ticket.id);
  assert.equal(litigation.sale_id, sale.id);
  assert.equal(Number(litigation.amount_fcfa), 2500000);
  assert.match(litigation.notes, new RegExp(`Lot : ${lot.code}`));
  assert.match(litigation.notes, /Programme : /);
  assert.equal(litigation.opponent, 'Client V1');
  // Juridique prévenu (litige.ouvert), lien du litige visible dans la réclamation, trace interne
  assert.ok((await unread(adminId, 'litige.ouvert')).some(n => n.dedupe_key === `litige:${litigation.id}:ouvert`));
  assert.ok(res.body.ticket.litigations.some(l => l.reference === litigation.reference && l.status === 'ouvert'));
  assert.ok((await db('sav_events').where({ ticket_id: ticket.id, kind: 'system' })).some(e => e.body.includes(litigation.reference) && e.internal));
  // Un seul litige ouvert par réclamation
  assert.equal((await admin.post(url).send({})).status, 409);
  // Le juriste voit le litige (department « sav » : service concerné)
  assert.equal((await juriste.get(`${J}/litiges/${litigation.id}`)).status, 200);
});

// ─── 5. Caution libérée ───────────────────────────────────────────────────

test('caution libérée : l’acheteur est prévenu dans son espace, le sous-traitant par e-mail, la Comptabilité et le responsable dans la cloche', async () => {
  const { sale } = await openSale('C1');
  const sub = insertedId((await db('suppliers').insert({ name: 'Gros Œuvre CI', kind: 'sous_traitant', email: 'groeuvre@test.ci' }))[0]);
  const noMail = insertedId((await db('suppliers').insert({ name: 'Sans Courriel SARL', kind: 'sous_traitant' }))[0]);
  const kind = await db('guarantee_kinds').where({ direction: 'recue' }).first();

  // Garantie couvrant un acheteur
  let res = await juriste.post(`${J}/cautions`).send({ kind_id: kind.id, sale_id: sale.id, amount_fcfa: 3000000, bank: 'SGBCI', issued_on: day(-100), expires_on: day(200), owner_id: comptableId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.buyer_label, /Client C1/);
  const gid = res.body.id;
  sent.length = 0;
  res = await juriste.post(`${J}/cautions/${gid}/close`).send({ status: 'liberee', date: day(0) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const msg = await db('client_messages').where({ sale_id: sale.id, sender: 'equipe' }).orderBy('id', 'desc').first();
  assert.ok(msg && /libérée/.test(msg.body), 'message dans l’espace client');
  assert.ok((await unread(comptableId, 'caution.liberee')).length >= 1, 'le responsable de la caution est prévenu');

  // Garantie d'un sous-traitant avec e-mail
  res = await juriste.post(`${J}/cautions`).send({ kind_id: kind.id, supplier_id: sub, amount_fcfa: 1000000, issued_on: day(-50), expires_on: day(100) });
  sent.length = 0;
  await juriste.post(`${J}/cautions/${res.body.id}/close`).send({ status: 'liberee', date: day(0) });
  assert.ok(sent.some(m => m.to === 'groeuvre@test.ci' && /libérée/.test(m.subject)), 'e-mail au sous-traitant');

  // Sans e-mail : rien n'est envoyé, la clôture réussit ; une mise en jeu n'annonce rien
  res = await juriste.post(`${J}/cautions`).send({ kind_id: kind.id, supplier_id: noMail, amount_fcfa: 500000, issued_on: day(-50), expires_on: day(100) });
  sent.length = 0;
  assert.equal((await juriste.post(`${J}/cautions/${res.body.id}/close`).send({ status: 'liberee', date: day(0) })).status, 200);
  assert.equal(sent.filter(m => /libérée/.test(m.subject)).length, 0);
  res = await juriste.post(`${J}/cautions`).send({ kind_id: kind.id, supplier_id: sub, amount_fcfa: 700000, issued_on: day(-50), expires_on: day(100) });
  sent.length = 0;
  await juriste.post(`${J}/cautions/${res.body.id}/close`).send({ status: 'appelee', date: day(0) });
  assert.equal(sent.filter(m => m.to === 'groeuvre@test.ci').length, 0, 'seule la libération est annoncée');
});

// ─── 6. Seuil de trésorerie ───────────────────────────────────────────────

test('seuil de trésorerie : une alerte par passage sous le seuil, réarmée au-dessus, indicateur dans la Vue Direction', async () => {
  const R = '/api/admin/erp/reglages/compta';
  assert.equal((await comptable.get(R)).body.values.compta_treasury_threshold_fcfa, 5000000, 'seuil par défaut');
  assert.equal((await commercial.put(R).send({ compta_treasury_threshold_fcfa: 1000 })).status, 403);
  assert.equal((await comptable.put(R).send({ compta_treasury_threshold_fcfa: 5000000 })).status, 200);

  // Trésorerie vide (0) sous le seuil de 5 millions : une seule alerte, même si la tâche horaire repasse
  const count = async () => (await db('notifications').where({ user_id: adminId, event: 'tresorerie.seuil' })).length;
  const base = await count();
  await compta.treasuryTick(db);
  assert.equal(await count(), base + 1);
  assert.ok((await db('notifications').where({ user_id: comptableId, event: 'tresorerie.seuil' })).length >= 1, 'Comptabilité prévenue');
  await compta.treasuryTick(db);
  await compta.treasuryTick(db);
  assert.equal(await count(), base + 1, 'une seule fois par passage sous le seuil');

  // Vue Direction : indicateur et ligne « À traiter en priorité »
  const view = (await admin.get('/api/admin/erp/direction/overview')).body;
  assert.equal(view.finance.treasury_under, true);
  assert.equal(view.finance.treasury_threshold, 5000000);
  assert.ok(view.administration.attention.some(a => a.module === 'tresorerie'));

  // La trésorerie repasse au-dessus : réarmement, alerte lue ; nouveau passage sous le seuil : nouvelle alerte
  const bq = await db('acc_journals as j').join('acc_accounts as a', 'a.id', 'j.account_id').where('j.code', 'BQ').first('a.code');
  const equity = await db('acc_accounts').where({ class: 1 }).first('code');
  const entry = await compta.createEntry(db, {
    journal: 'BQ', date: day(0), label: 'Apport de trésorerie (test)', lines: [{ account: bq.code, debit: 20000000 }, { account: equity.code, credit: 20000000 }],
  });
  await compta.treasuryTick(db);
  assert.equal(await count(), base + 1);
  assert.ok((await db('notifications').where({ user_id: adminId, event: 'tresorerie.seuil' })).every(n => n.read_at), 'alerte lue au retour au-dessus du seuil');
  assert.equal((await admin.get('/api/admin/erp/direction/overview')).body.finance.treasury_under, false);
  await db('acc_lines').where({ entry_id: entry.id }).del();
  await db('acc_entries').where({ id: entry.id }).del();
  await compta.treasuryTick(db);
  assert.equal(await count(), base + 2, 'nouveau passage sous le seuil : nouvelle alerte');

  // 0 désactive l'alerte
  assert.equal((await comptable.put(R).send({ compta_treasury_threshold_fcfa: 0 })).status, 200);
  await compta.treasuryTick(db);
  assert.equal((await admin.get('/api/admin/erp/direction/overview')).body.finance.treasury_under, false);
  assert.equal(await count(), base + 2);
});
