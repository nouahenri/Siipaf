const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const { deedStepRefusal, litigationReminder, guaranteeDeadline, unpaidAge } = require('../src/lib/domain');
const juridique = require('../src/services/juridique');

let db, app, admin, juriste, comptable, commercial, editeur, ids, project, notary;
const URL = '/api/admin/erp/juridique';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const insertedId = r => (typeof r === 'object' ? r.id : r);

/** Ouvre un dossier de vente sur un nouveau lot du projet, attribué au commercial. */
async function openSale(code, body = {}) {
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([...(await db('lots').where({ project_id: project.id }).select('code', 'price_fcfa')).map(l => ({ code: l.code, price_fcfa: Number(l.price_fcfa) })), { code, price_fcfa: 12000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code }).first();
  const res = await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: `Client ${code}`, phone: `+225 07 00 00 ${String(lot.id).padStart(2, '0')} 01`, email: `client.${code.toLowerCase()}@test.ci`, financing: 'diaspora', ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await db('leads').where({ id: res.body.lead.id }).update({ assigned_to: ids.commercial });
  return { sale: res.body, lot };
}

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  juriste = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  notary = insertedId((await db('suppliers').insert({ name: 'Étude Maître Yao', kind: 'notaire' }))[0]);
});
after(() => db.destroy());

test('règles : étapes dans l’ordre, alertes des litiges, échéance des cautions, ancienneté d’un impayé', () => {
  const none = { reservation: null, pieces: null, notaire: null, projet: null, acte: null, remise: null };
  assert.match(deedStepRefusal(none, 'pieces', '2026-10-01'), /Contrat de réservation/);
  assert.equal(deedStepRefusal(none, 'reservation', '2026-10-01'), null);
  assert.match(deedStepRefusal({ ...none, reservation: '2026-10-05' }, 'pieces', '2026-10-01'), /précède/);
  assert.match(deedStepRefusal({ ...none, reservation: '2026-10-05', pieces: '2026-10-06' }, 'reservation', null), /suivante/);
  assert.match(deedStepRefusal({ ...none, acte: '2026-10-05' }, 'acte', null), /ne s’efface pas/);
  assert.equal(litigationReminder('2026-11-10', '2026-11-08'), null);
  assert.equal(litigationReminder('2026-11-10', '2026-11-09'), 'veille');
  assert.equal(litigationReminder('2026-11-10', '2026-11-10'), 'jour');
  assert.equal(litigationReminder('2026-11-10', '2026-11-20'), null, 'oubliée depuis plus de 7 jours');
  assert.equal(guaranteeDeadline({ status: 'active', direction: 'retenue', release_on: '2027-10-01' }).date, '2027-10-01');
  assert.equal(guaranteeDeadline({ status: 'liberee', direction: 'recue', expires_on: '2027-10-01' }), null);
  const age = unpaidAge([{ status: 'payee', due_date: '2026-01-01', remaining_fcfa: 0 }, { status: 'en_retard', due_date: '2026-02-01', remaining_fcfa: 100 }, { status: 'en_retard', due_date: '2026-03-01', remaining_fcfa: 50 }], '2026-05-02');
  assert.deepEqual(age, { due_date: '2026-02-01', days: 90, overdue_fcfa: 150, count: 2 });
});

test('circuit de l’acte : six étapes dans l’ordre, notaire requis ; l’acte rend le lot vendu et prévient chacun', async () => {
  const { sale, lot } = await openSale('J1');
  const url = `${URL}/actes/${sale.id}`;
  assert.equal((await commercial.post(url).send({ key: 'reservation', date: day(-20) })).status, 403, 'le commercial ne date pas les étapes');
  assert.equal((await editeur.get(url)).status, 403);
  assert.equal((await juriste.post(url).send({ key: 'pieces', date: day(-20) })).status, 409, 'dans l’ordre');
  let res = await juriste.post(url).send({ key: 'reservation', date: day(-20) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.current, 'pieces');
  assert.equal((await db('sale_documents').where({ sale_id: sale.id, type: 'contrat_reservation' }).first()).status, 'signe');
  assert.equal((await db('leads').where({ id: sale.lead.id }).first()).stage, 'contrat');
  await juriste.post(url).send({ key: 'pieces', date: day(-15) });
  assert.equal((await juriste.post(url).send({ key: 'notaire', date: day(-10) })).status, 400, 'notaire à choisir');
  res = await juriste.post(url).send({ key: 'notaire', date: day(-10), notary_supplier_id: notary, notary_ref: 'Dossier 2026/118' });
  assert.equal(res.body.notary_name, 'Étude Maître Yao');
  await juriste.post(url).send({ key: 'projet', date: day(-3) });

  sent.length = 0;
  res = await juriste.post(url).send({ key: 'acte', date: day(-1), deed_number: '2026-0457' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.current, 'remise');
  assert.equal((await db('lots').where({ id: lot.id }).first()).status, 'vendu');
  assert.equal((await db('sale_documents').where({ sale_id: sale.id, type: 'acte_notarie' }).first()).status, 'signe');
  assert.equal(String((await db('sales').where({ id: sale.id }).first()).signed_at).slice(0, 10), day(-1).slice(0, 10));
  assert.equal((await db('leads').where({ id: sale.lead.id }).first()).stage, 'notaire');
  assert.ok(sent.some(m => m.to === 'client.j1@test.ci' && /acte de vente est signé/.test(m.subject)), 'e-mail au client');
  const notified = await db('notifications').where({ event: 'acte.signe' }).select('user_id', 'module');
  assert.ok(notified.some(n => n.user_id === ids.commercial && n.module === 'commercial'), 'commercial');
  assert.ok(notified.some(n => n.user_id === ids.comptable && n.module === 'compta'), 'comptable');
  // Correction de la date sans nouvelle annonce ; l'acte ne s'efface pas
  await juriste.post(url).send({ key: 'acte', date: day(-2) });
  assert.equal((await db('notifications').where({ event: 'acte.signe' })).length, notified.length);
  assert.equal((await juriste.post(url).send({ key: 'acte', date: null })).status, 409);
  res = await juriste.post(url).send({ key: 'remise', date: day(0) });
  assert.equal(res.body.current, null);
  assert.equal((await db('sale_documents').where({ sale_id: sale.id, type: 'acte_notarie' }).first()).status, 'delivre');
  // Le commercial voit l'avancement (lecture seule) ; la liste filtrée par étape
  assert.equal((await commercial.get(url)).status, 200);
  assert.ok((await juriste.get(`${URL}/actes?step=termine`)).body.some(d => d.sale_id === sale.id));
});

test('acte daté depuis le dashboard : mêmes effets (lot vendu, pièce signée, annonces)', async () => {
  const { sale, lot } = await openSale('J2');
  const res = await admin.patch(`/api/admin/sales/${sale.id}`).send({ signed_at: day(0) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await db('lots').where({ id: lot.id }).first()).status, 'vendu');
  assert.equal((await db('sale_documents').where({ sale_id: sale.id, type: 'acte_notarie' }).first()).status, 'signe');
  const d = (await juriste.get(`${URL}/actes/${sale.id}`)).body;
  assert.equal(d.steps.find(s => s.key === 'acte').date, day(0));
  assert.equal(d.current, 'remise', 'acte signé : seule l’expédition reste à faire');
  // Dossier repris avec l'acte déjà signé : l'expédition peut être remise sans les étapes d'avant
  assert.equal((await juriste.post(`${URL}/actes/${sale.id}`).send({ key: 'remise', date: day(0) })).status, 200);
});

test('litiges : ouverture, confidentialité, étapes, échéance (veille, jour), clôture avec issue, réouverture', async () => {
  const body = { origin: 'fournisseur', title: 'Malfaçons de la clôture', opponent: 'Réseaux VRD Services', amount_fcfa: 4500000, department: 'juridique', next_date: day(1), next_label: 'Réponse à la mise en demeure' };
  assert.equal((await commercial.post(`${URL}/litiges`).send(body)).status, 403);
  let res = await juriste.post(`${URL}/litiges`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.reference, /^LIT-\d{4}-0001$/);
  const id = res.body.id;
  assert.equal((await commercial.get(`${URL}/litiges/${id}`)).status, 404, 'confidentiel');
  assert.equal((await commercial.get(`${URL}/litiges`)).body.length, 0);
  assert.equal((await admin.get(`${URL}/litiges/${id}`)).status, 200, 'la Direction voit tout');

  sent.length = 0;
  await juridique.tick(db, day(0));
  assert.ok(sent.some(m => /Malfaçons/.test(m.text) && /demain/.test(m.subject)), 'veille');
  sent.length = 0;
  await juridique.tick(db, day(0));
  assert.equal(sent.filter(m => /LIT-/.test(m.subject)).length, 0, 'une seule fois');
  await juridique.tick(db, day(1));
  assert.ok(sent.some(m => /aujourd’hui/.test(m.subject)), 'jour');

  res = await juriste.post(`${URL}/litiges/${id}/etapes`).send({ stage: 'mise_en_demeure', date: day(0), note: 'Envoyée par huissier', next_date: day(15), next_label: 'Fin du délai' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.stage, 'mise_en_demeure');
  assert.equal(res.body.events.length, 2);
  assert.equal((await juriste.post(`${URL}/litiges/${id}/etapes`).send({ stage: 'clos', date: day(0) })).status, 400, 'issue requise');
  res = await juriste.post(`${URL}/litiges/${id}/etapes`).send({ stage: 'clos', date: day(0), outcome: 'transaction', note: 'Reprise des travaux à leurs frais' });
  assert.equal(res.body.status, 'clos');
  assert.equal(res.body.next_date, null);
  res = await juriste.post(`${URL}/litiges/${id}/reopen`);
  assert.equal(res.body.status, 'ouvert');
  assert.equal(res.body.stage, 'mise_en_demeure');
});

test('cautions : sortes réglables, retenue libérée selon le délai réglé, alertes, accès de la Comptabilité', async () => {
  const refs = (await juriste.get(`${URL}/refs`)).body;
  const retenue = refs.guarantee_kinds.find(k => k.direction === 'retenue');
  const bonne = refs.guarantee_kinds.find(k => k.label === 'Caution de bonne exécution');
  assert.equal(refs.settings.legal_unpaid_days, 90);
  assert.equal(refs.settings.legal_warranty_months, 12);

  let res = await juriste.post(`${URL}/cautions`).send({ kind_id: retenue.id, counterparty: 'BTP Ivoire', amount_fcfa: 2500000, reception_on: '2026-03-15' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.release_on, '2027-03-15', '12 mois après la réception');
  assert.match(res.body.reference, /^GAR-2026-0001$/);
  // Délai réglé à 6 mois : appliqué aux nouvelles retenues
  assert.equal((await comptable.put(`${URL}/reglages`).send({ legal_warranty_months: 6 })).status, 403);
  assert.equal((await juriste.put(`${URL}/reglages`).send({ legal_warranty_months: 6, legal_unpaid_days: 60 })).body.legal_warranty_months, 6);
  res = await juriste.post(`${URL}/cautions`).send({ kind_id: retenue.id, counterparty: 'BTP Ivoire', amount_fcfa: 1000000, reception_on: '2026-03-15' });
  assert.equal(res.body.release_on, '2026-09-15');

  // Nouvelle sorte ; le sens d'une sorte utilisée ne change plus
  res = await juriste.post(`${URL}/sortes`).send({ label: 'Caution de paiement', direction: 'recue' });
  assert.equal(res.status, 201);
  assert.equal((await juriste.patch(`${URL}/sortes/${retenue.id}`).send({ direction: 'recue' })).status, 409);
  assert.equal((await juriste.post(`${URL}/sortes`).send({ label: 'caution de paiement', direction: 'recue' })).status, 409, 'doublon');

  res = await juriste.post(`${URL}/cautions`).send({ kind_id: bonne.id, counterparty: 'Réseaux VRD Services', bank: 'SGBCI', amount_fcfa: 6000000, issued_on: day(-300), expires_on: day(20), owner_id: ids.comptable });
  const gid = res.body.id;
  assert.equal(res.body.deadline.days_left, 20);
  sent.length = 0;
  await juridique.tick(db, day(0));
  assert.ok(sent.some(m => m.subject.includes(res.body.reference) && m.to === 'comptable@test.ci'), 'responsable prévenu à 30 jours');
  assert.equal((await comptable.get(`${URL}/cautions`)).status, 200, 'la Comptabilité consulte');
  assert.equal((await commercial.get(`${URL}/cautions`)).status, 403);
  res = await juriste.post(`${URL}/cautions/${gid}/close`).send({ status: 'liberee', date: day(0), note: 'Mainlevée reçue' });
  assert.equal(res.body.status, 'liberee');
  assert.equal(res.body.deadline, null);
  await juriste.put(`${URL}/reglages`).send({ legal_warranty_months: 12, legal_unpaid_days: 90 });
});

test('impayés : le commercial est prévenu dès le 1er jour, le Juridique au seuil réglé ; un litige ouvert règle l’alerte', async () => {
  // Diaspora sans acompte : 36 mensualités dès la réservation, il y a 100 jours → 4 échéances en retard
  const { sale } = await openSale('J3', { reserved_at: day(-100) });
  let list = (await juriste.get(`${URL}/impayes`)).body;
  const row = list.items.find(u => u.sale_id === sale.id);
  assert.ok(row, JSON.stringify(list));
  assert.equal(row.days_late, 100);
  assert.equal(row.transmitted, true);
  assert.equal((await commercial.get(`${URL}/impayes`)).status, 403);

  await juridique.tick(db, day(0));
  assert.ok(await db('notifications').where({ user_id: ids.commercial, event: 'echeance.impayee' }).first(), 'commercial');
  const jur = await db('notifications').where({ user_id: ids.conducteur_travaux, event: 'impaye.transmis' }).first();
  assert.ok(jur, 'Juridique');
  // Seuil relevé à 120 jours : plus transmis
  await juriste.put(`${URL}/reglages`).send({ legal_unpaid_days: 120 });
  assert.equal((await juriste.get(`${URL}/impayes`)).body.items.find(u => u.sale_id === sale.id).transmitted, false);
  await juriste.put(`${URL}/reglages`).send({ legal_unpaid_days: 90 });

  const res = await juriste.post(`${URL}/litiges`).send({ origin: 'impaye', title: 'Recouvrement des mensualités', opponent: 'Client J3', sale_id: sale.id, amount_fcfa: row.overdue_fcfa });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok((await db('notifications').where({ id: jur.id }).first()).read_at, 'alerte réglée');
  list = (await juriste.get(`${URL}/impayes`)).body;
  assert.equal(list.items.find(u => u.sale_id === sale.id).litigation.reference, res.body.reference);
  const ov = (await juriste.get(`${URL}/overview`)).body;
  assert.equal(ov.unpaid.to_handle_total, 0);
  assert.ok(ov.litigations.open >= 1);
  assert.equal((await commercial.get(`${URL}/overview`)).status, 403);
});

test('courrier affecté au service Juridique : visible dans le module', async () => {
  const [m] = await db('mail_items').insert({ direction: 'arrivee', year: 2026, seq: 900, number: 'A-2026-0900', date: day(0), correspondent: 'Huissier Konan', subject: 'Sommation de payer', nature: 'juridique', status: 'affecte', assigned_department: 'juridique', suite: 'traitement', due_date: day(5) });
  const list = (await juriste.get(`${URL}/courrier`)).body;
  assert.ok(list.some(x => x.id === insertedId(m)), JSON.stringify(list));
  assert.ok((await juriste.get(`${URL}/badges`)).body.mail >= 1);
});
