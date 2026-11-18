const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const caisse = require('../src/services/caisse');

let db, app, admin, comptable, commercial, tresoriere;
const C = '/api/admin/erp/compta';
const K = `${C}/caisse`;
const iso = d => d.toISOString().slice(0, 10);
const ago = n => iso(new Date(Date.now() - n * 864e5));
const D1 = ago(6), D2 = ago(5), D3 = ago(4);
const nature = async (label, direction) => (await db('cash_natures').where({ label, direction }).first()).id;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  // Trésorière : seulement « Tenir la caisse », sans le reste de la comptabilité
  await db('users').insert({ email: 'tresoriere@test.ci', name: 'Trésorière', role: 'commercial', password_hash: await require('../src/auth').hashPassword('motdepasse-test-123') });
  const u = await db('users').where({ email: 'tresoriere@test.ci' }).first();
  await db('user_permissions').insert({ user_id: u.id, permission: 'caisse:write', granted: true }).catch(async () => db('user_permissions').insert({ user_id: u.id, permission: 'caisse:write' }));
  tresoriere = await login(app, 'tresoriere@test.ci', 'motdepasse-test-123');
  for (const y of new Set([D1.slice(0, 4), iso(new Date()).slice(0, 4)])) {
    await comptable.post(`${C}/fiscal-years`).send({ label: y, start_date: `${y}-01-01`, end_date: `${y}-12-31` });
  }
});
after(() => db.destroy());

test('droits : la trésorière tient la caisse sans le reste de la comptabilité ; le commercial n’y a pas accès', async () => {
  assert.equal((await tresoriere.get(`${K}/meta`)).status, 200);
  assert.equal((await tresoriere.get(`${C}/meta`)).status, 403, 'pas le reste de la comptabilité');
  assert.equal((await commercial.get(`${K}/meta`)).status, 403);
  const meta = (await tresoriere.get(`${K}/meta`)).body;
  assert.equal(meta.journal.account_code, '571100');
  assert.ok(meta.natures.some(n => n.label === 'Transport et déplacements' && n.direction === 'sortie' && n.account_code === '618'), 'liste par défaut');
  assert.equal((await tresoriere.post(`${K}/movements`).send({ date: D1, direction: 'sortie', nature_id: meta.natures[0].id, amount: 1000, label: 'Essai' })).status, 409, 'caisse vide : pas de sortie');
});

test('natures administrables : ajout direct, compte de contrepartie contrôlé', async () => {
  let res = await tresoriere.post(`${K}/natures`).send({ label: 'Eau potable du bureau', direction: 'sortie', account: '6051' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.account_code, '6051');
  assert.equal((await tresoriere.post(`${K}/natures`).send({ label: 'Eau potable du bureau', direction: 'sortie', account: '6051' })).status, 409, 'doublon');
  assert.equal((await tresoriere.post(`${K}/natures`).send({ label: 'Caisse', direction: 'sortie', account: '571100' })).status, 400, 'pas la caisse elle-même');
  assert.equal((await tresoriere.post(`${K}/natures`).send({ label: 'Client', direction: 'entree', account: '4111' })).status, 400, 'les clients passent par leur dossier');
  res = await comptable.patch(`${K}/natures/${res.body.id}`).send({ active: false });
  assert.equal(res.body.active, false);
  assert.equal((await commercial.post(`${K}/natures`).send({ label: 'Autre', direction: 'sortie', account: '658' })).status, 403);
});

test('point de caisse : solde de la veille, entrées, sorties, solde du soir, écritures du journal de caisse', async () => {
  let res = await tresoriere.post(`${K}/movements`).send({ date: D1, direction: 'entree', nature_id: await nature('Retrait en banque pour la caisse', 'entree'), amount: 500000, label: 'Retrait chèque 0012', reference: 'CHQ 0012' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const entry = await db('acc_entries').where({ id: res.body.entry_id }).first();
  assert.equal(entry.source, 'caisse');
  const lines = await db('acc_lines as l').join('acc_accounts as a', 'a.id', 'l.account_id').where('l.entry_id', entry.id).select('a.code', 'l.debit', 'l.credit');
  assert.deepEqual(lines.map(l => [l.code, Number(l.debit), Number(l.credit)]).sort(), [['521100', 0, 500000], ['571100', 500000, 0]]);

  res = await tresoriere.post(`${K}/movements`).send({ date: D1, direction: 'sortie', nature_id: await nature('Transport et déplacements', 'sortie'), amount: 15000, label: 'Taxi dépôt de dossier', beneficiary: 'Kouassi' });
  assert.equal(res.status, 201);
  assert.equal((await tresoriere.post(`${K}/movements`).send({ date: D1, direction: 'sortie', nature_id: await nature('Avance au personnel', 'sortie'), amount: 20000, label: 'Avance' })).status, 400, 'employé obligatoire');
  assert.equal((await tresoriere.post(`${K}/movements`).send({ date: D1, direction: 'sortie', nature_id: await nature('Transport et déplacements', 'sortie'), amount: 600000, label: 'Trop' })).status, 409, 'jamais de caisse négative');
  assert.equal((await tresoriere.post(`${K}/movements`).send({ date: D1, direction: 'entree', nature_id: await nature('Transport et déplacements', 'sortie'), amount: 1000, label: 'Sens' })).status, 400, 'nature de l’autre sens');
  assert.equal((await tresoriere.post(`${K}/movements`).send({ date: ago(-2), direction: 'entree', nature_id: await nature('Recettes diverses', 'entree'), amount: 1000, label: 'Futur' })).status, 400, 'pas de date future');

  let day = (await tresoriere.get(`${K}/day?date=${D1}`)).body;
  assert.equal(day.opening, 0);
  assert.equal(day.receipts, 500000);
  assert.equal(day.expenses, 15000);
  assert.equal(day.theoretical, 485000);
  assert.equal(day.rows.at(-1).balance, 485000, 'solde progressif');
  day = (await tresoriere.get(`${K}/day?date=${D2}`)).body;
  assert.equal(day.opening, 485000, 'solde de la veille repris');
});

test('versement client en espèces : compté dans la caisse dès sa saisie, une seule fois après la synchronisation', async () => {
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'CS1', price_fcfa: 20000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code: 'CS1' }).first();
  const sale = (await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: 'Aya Koné', phone: '0707070707', financing: 'comptant', reserved_at: D1 })).body;
  await comptable.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 100000, paid_at: D2, method: 'especes' });
  let day = (await tresoriere.get(`${K}/day?date=${D2}`)).body;
  assert.equal(day.pending_sync, 1);
  assert.equal(day.receipts, 100000);
  assert.equal((await tresoriere.get(`${K}/day?date=${D3}`)).body.opening, 585000);
  await comptable.post(`${C}/sync`);
  day = (await tresoriere.get(`${K}/day?date=${D2}`)).body;
  assert.equal(day.pending_sync, 0);
  assert.equal(day.receipts, 100000, 'pas de doublon');
  assert.equal(day.rows.find(r => r.source === 'versement').origin, 'Versement client');
});

test('arrêté du soir : billetage, écart passé en écriture, journée verrouillée, réouverture par la Comptabilité', async () => {
  assert.equal((await tresoriere.post(`${K}/closings`).send({ date: D2, counted: 580000, denominations: { b10000: 58 } })).status, 201);
  // D1 n'est pas arrêtée : la journée reste à arrêter
  assert.deepEqual(await caisse.daysToClose(db), [D1]);
  let res = await tresoriere.post(`${K}/closings`).send({ date: D1, denominations: { b10000: 48, b5000: 1, p500: 1 } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.closing.counted, 485500);
  assert.equal(res.body.closing.gap, 500, 'excédent');
  assert.equal(res.body.closing_balance, 485500, 'le solde du soir est le montant compté');
  assert.deepEqual(await caisse.daysToClose(db), []);
  assert.equal((await tresoriere.post(`${K}/closings`).send({ date: D1, counted: 1 })).status, 409, 'déjà arrêtée');
  assert.equal((await tresoriere.post(`${K}/closings`).send({ date: D3, counted: 1000, denominations: { b10000: 1 } })).status, 400, 'billetage ≠ montant');
  assert.equal((await tresoriere.post(`${K}/movements`).send({ date: D1, direction: 'entree', nature_id: await nature('Recettes diverses', 'entree'), amount: 1000, label: 'Tard' })).status, 409, 'journée arrêtée');

  const d2 = (await tresoriere.get(`${K}/day?date=${D2}`)).body;
  assert.equal(d2.opening, 485500, 'l’écart de la veille entre dans le solde de la veille');
  // D2 avait été arrêtée avant l'écart de D1 : son solde théorique a changé
  assert.equal(d2.closing.changed, true);
  const ecart = await db('acc_entries').where({ id: (await db('cash_closings').where({ date: D1 }).first()).entry_id }).first();
  const lines = await db('acc_lines as l').join('acc_accounts as a', 'a.id', 'l.account_id').where('l.entry_id', ecart.id).select('a.code', 'l.debit', 'l.credit');
  assert.deepEqual(lines.map(l => [l.code, Number(l.debit), Number(l.credit)]).sort(), [['571100', 500, 0], ['758', 0, 500]]);

  assert.equal((await tresoriere.delete(`${K}/closings/${D2}`)).status, 403, 'la trésorière ne rouvre pas');
  assert.equal((await comptable.delete(`${K}/closings/${D1}`)).status, 409, 'le plus récent d’abord');
  assert.equal((await comptable.delete(`${K}/closings/${D2}`)).status, 200);
  assert.equal((await comptable.delete(`${K}/closings/${D1}`)).status, 200);
  assert.equal(await db('acc_entries').where('source_key', 'like', 'cash_closing:%').first(), undefined, 'écart en brouillon effacé');
});

test('annuler une saisie : écriture retirée, justificatif privé', async () => {
  const res = await tresoriere.post(`${K}/movements`).send({ date: D3, direction: 'sortie', nature_id: await nature('Fournitures de bureau', 'sortie'), amount: 7500, label: 'Ramettes' });
  const id = res.body.id;
  const up = await tresoriere.put(`${K}/movements/${id}/document`).attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'recu.pdf', contentType: 'application/pdf' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const day = (await tresoriere.get(`${K}/day?date=${D3}`)).body;
  const row = day.rows.find(r => r.movement_id === id);
  assert.equal(row.document.name, 'recu.pdf');
  assert.equal((await tresoriere.get(row.document.url)).status, 200);
  assert.equal((await commercial.get(`${K}/movements/${id}/document`)).status, 403);
  assert.equal((await tresoriere.delete(`${K}/movements/${id}`)).status, 200);
  assert.equal(await db('acc_entries').where({ source_key: `cash:${id}` }).first(), undefined);
  assert.equal((await tresoriere.get(`${K}/day?date=${D3}`)).body.expenses, 0);
});

test('alertes : journées à arrêter et plafond d’espèces', async () => {
  assert.ok((await caisse.daysToClose(db)).length > 0);
  assert.ok((await caisse.tick(db)) > 0);
  const notif = await db('notifications').where('dedupe_key', 'like', 'caisse:non_arretee:%').first();
  assert.ok(notif, 'journées non arrêtées signalées');
  await db('app_settings').insert({ key: 'compta_cash_ceiling_fcfa', value: '100000' });
  await caisse.tick(db);
  assert.ok(await db('notifications').where('dedupe_key', 'like', 'caisse:plafond:%').first(), 'plafond dépassé');
  const before = await db('notifications').where('dedupe_key', 'like', 'caisse:plafond:%').count({ n: '*' });
  await caisse.tick(db);
  assert.deepEqual(await db('notifications').where('dedupe_key', 'like', 'caisse:plafond:%').count({ n: '*' }), before, 'une seule fois par passage');
});

test('écriture faite par erreur : contrepassation motivée et validée aussitôt, paire masquée de la liste mais conservée', async () => {
  const od = (await db('acc_journals').where({ code: 'OD' }).first()).id;
  let res = await comptable.post(`${C}/entries`).send({ journal_id: od, date: D1, label: 'Saisie de test', lines: [{ account: '631', debit: 1000 }, { account: '521100', credit: 1000 }] });
  const id = res.body.id;
  await comptable.post(`${C}/entries/validate`).send({ ids: [id] });
  assert.equal((await tresoriere.post(`${C}/entries/${id}/reverse`).send({ reason: 'test', validate: true })).status, 403);
  res = await comptable.post(`${C}/entries/${id}/reverse`).send({ date: D1, reason: 'Saisie de test', validate: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'valide');
  assert.match(res.body.label, /\(Saisie de test\)/);
  assert.equal(res.body.reverses.id, id);
  const detail = (await comptable.get(`${C}/entries/${id}`)).body;
  assert.equal(detail.reversed_by.status, 'valide');
  const shown = (await comptable.get(`${C}/entries?limit=500`)).body.rows.map(e => e.id);
  const hidden = (await comptable.get(`${C}/entries?limit=500&hide_cancelled=1`)).body.rows.map(e => e.id);
  assert.ok(shown.includes(id) && shown.includes(res.body.id));
  assert.ok(!hidden.includes(id) && !hidden.includes(res.body.id), 'paire annulée masquée');
  assert.ok(await db('acc_entries').where({ id }).first(), 'jamais effacée');
});

test('versement supprimé : sa contrepassation (brouillon) se valide, elle ne se supprime pas', async () => {
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'CS2', price_fcfa: 15000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code: 'CS2' }).first();
  const sale = (await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: 'Test Versement', phone: '0708080808', financing: 'comptant', reserved_at: D1 })).body;
  await comptable.post(`/api/admin/sales/${sale.id}/payments`).send({ amount_fcfa: 250000, paid_at: D2, method: 'virement' });
  const pay = await db('payments').where({ sale_id: sale.id }).first();
  await comptable.post(`${C}/sync`);
  const entry = await db('acc_entries').where({ source_key: `payment:${pay.id}` }).first();
  await comptable.post(`${C}/entries/validate`).send({ ids: [entry.id] });
  await comptable.delete(`/api/admin/payments/${pay.id}`);
  await comptable.post(`${C}/sync`);
  const rev = await db('acc_entries').where({ source_key: `reverse:payment:${pay.id}` }).first();
  assert.equal(rev.status, 'brouillon');
  const res = await comptable.delete(`${C}/entries/${rev.id}`);
  assert.equal(res.status, 409);
  assert.match(res.body.error || res.body.message || JSON.stringify(res.body), /validez-la/);
  await comptable.post(`${C}/entries/validate`).send({ ids: [rev.id] });
  await comptable.post(`${C}/sync`);
  assert.equal((await db('acc_entries').where('source_key', 'like', `reverse:payment:${pay.id}`)).length, 1, 'pas de nouvelle contrepassation');
  const hidden = (await comptable.get(`${C}/entries?limit=500&hide_cancelled=1`)).body.rows.map(e => e.id);
  assert.ok(!hidden.includes(entry.id) && !hidden.includes(rev.id), 'paire annulée masquée');
});
