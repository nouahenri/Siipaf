const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const { mailReminder, mailVisibility } = require('../src/lib/domain');
const courrier = require('../src/services/courrier');

let db, app, resp, secretaire, commercial, comptable, ids;
const URL = '/api/admin/erp/courrier';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const year = new Date().getUTCFullYear();

before(async () => {
  ({ db, app } = await setup());
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  // Secrétariat : un éditeur qui reçoit le droit d'enregistrer et de consulter le registre
  await createUser(db, 'editeur');
  const sec = await db('users').where({ email: 'editeur@test.ci' }).first();
  await db('user_permissions').insert([{ user_id: sec.id, permission: 'courrier:write', granted: true }, { user_id: sec.id, permission: 'courrier:read', granted: true }]);
  secretaire = await login(app, 'editeur@test.ci', 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
});
after(() => db.destroy());

test('règles : relance la veille puis le jour du dépassement, une fois chacune ; confidentialité', () => {
  const m = { status: 'affecte', due_date: '2026-11-10' };
  assert.equal(mailReminder(m, '2026-11-08'), null);
  assert.equal(mailReminder(m, '2026-11-09'), 'veille');
  assert.equal(mailReminder({ ...m, reminded_eve_at: 1 }, '2026-11-10'), null);
  assert.equal(mailReminder(m, '2026-11-11'), 'retard');
  assert.equal(mailReminder({ ...m, reminded_late_at: 1 }, '2026-11-12'), null);
  assert.equal(mailReminder({ ...m, status: 'traite' }, '2026-11-11'), null);
  const c = { confidential: true, assigned_to: 7 };
  const can = list => p => list.includes(p);
  assert.equal(mailVisibility(c, { userId: 7, can: can([]) }), 'full', 'destinataire');
  assert.equal(mailVisibility(c, { userId: 8, can: can(['courrier:assign']) }), 'full', 'direction');
  assert.equal(mailVisibility(c, { userId: 8, can: can(['courrier:read']) }), 'number', 'registre : n° seul');
  assert.equal(mailVisibility({ ...c, confidential: false }, { userId: 8, can: can(['courrier:read']) }), 'full');
  assert.equal(mailVisibility(c, { userId: 8, can: can([]) }), 'none');
});

test('n° d’ordre par sens et par an ; seul le secrétariat ou la direction enregistre', async () => {
  const body = { direction: 'arrivee', date: day(0), correspondent: 'Mairie de Bingerville', subject: 'Permis de construire', nature: 'administratif' };
  assert.equal((await commercial.post(URL).send(body)).status, 403);
  let res = await secretaire.post(URL).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.number, `A-${year}-0001`);
  assert.equal(res.body.status, 'enregistre');
  res = await secretaire.post(URL).send({ ...body, subject: 'Deuxième' });
  assert.equal(res.body.number, `A-${year}-0002`);
  res = await secretaire.post(URL).send({ ...body, direction: 'depart', correspondent: 'Notaire', subject: 'Envoi des actes' });
  assert.equal(res.body.number, `D-${year}-0001`, 'série distincte au départ');
  assert.equal(res.body.status, 'envoye');
  assert.equal((await secretaire.post(URL).send({ ...body, date: day(2) })).status, 400, 'date future refusée');
});

test('affectation, confidentialité, suite donnée et réponse liée', async () => {
  let res = await secretaire.post(URL).send({ direction: 'arrivee', date: day(0), correspondent: 'Cabinet d’huissier', subject: 'Mise en demeure X', nature: 'juridique', confidential: 'true' });
  const id = res.body.id;
  // Le secrétariat qui l'a enregistré ne voit plus que le n° d'ordre
  res = await secretaire.get(`${URL}/${id}`);
  assert.equal(res.body.masked, true);
  assert.equal(res.body.subject, undefined);
  assert.equal((await secretaire.get(`${URL}?q=demeure`)).body.length, 0, 'la recherche ne trahit pas un confidentiel');
  // Le commercial (hors registre) ne le voit pas
  assert.equal((await commercial.get(`${URL}/${id}`)).status, 404);

  assert.equal((await secretaire.post(`${URL}/${id}/assign`).send({ suite: 'traitement', assigned_to: ids.commercial, due_date: day(5) })).status, 403);
  assert.equal((await resp.post(`${URL}/${id}/assign`).send({ suite: 'traitement', assigned_to: ids.commercial })).status, 400, 'délai obligatoire');
  sent.length = 0;
  res = await resp.post(`${URL}/${id}/assign`).send({ suite: 'traitement', assigned_to: ids.commercial, due_date: day(5), instructions: 'Préparer la réponse' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'affecte');
  assert.ok(sent.some(m => m.to === 'commercial@test.ci' && /à traiter/.test(m.subject)), 'e-mail au destinataire');
  assert.ok(sent.every(m => !/demeure/i.test(m.text)), 'l’objet confidentiel ne part pas par e-mail');

  // Le destinataire voit tout, la liste « à traiter », et répond par un courrier départ lié
  res = await commercial.get(`${URL}/${id}`);
  assert.equal(res.body.masked, false);
  assert.equal(res.body.is_recipient, true);
  assert.equal((await commercial.get(`${URL}/badges`)).body.mine, 1);
  assert.equal((await comptable.get(URL)).body.length, 0, 'hors registre : seulement ses courriers');
  res = await commercial.post(URL).send({ direction: 'depart', date: day(0), correspondent: 'Cabinet d’huissier', subject: 'Réponse à la mise en demeure', reply_to_id: id, confidential: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  res = await resp.get(`${URL}/${id}`);
  assert.equal(res.body.status, 'traite');
  assert.equal(res.body.replies.length, 1);
  assert.match(res.body.done_note, /Réponse envoyée : D-/);
});

test('pour avis : l’avis est obligatoire ; classement : traité d’office ; annulation sans réutiliser le n°', async () => {
  let res = await secretaire.post(URL).send({ direction: 'arrivee', date: day(0), correspondent: 'BET', subject: 'Rapport géotechnique', nature: 'rapport' });
  const id = res.body.id;
  await resp.post(`${URL}/${id}/assign`).send({ suite: 'avis', assigned_to: ids.comptable, due_date: day(3) });
  assert.equal((await commercial.post(`${URL}/${id}/done`).send({ note: 'ok' })).status, 404, 'ni destinataire ni registre');
  assert.equal((await comptable.post(`${URL}/${id}/done`).send({})).status, 400);
  res = await comptable.post(`${URL}/${id}/done`).send({ note: 'Favorable' });
  assert.equal(res.body.status, 'traite');
  assert.equal(res.body.done_note, 'Favorable');

  res = await secretaire.post(URL).send({ direction: 'arrivee', date: day(0), correspondent: 'Imprimerie', subject: 'Catalogue', nature: 'publicite' });
  res = await resp.post(`${URL}/${res.body.id}/assign`).send({ suite: 'classement' });
  assert.equal(res.body.status, 'traite');

  res = await secretaire.post(URL).send({ direction: 'arrivee', date: day(0), correspondent: 'Doublon', subject: 'Saisie en double' });
  const number = res.body.number;
  assert.equal((await secretaire.post(`${URL}/${res.body.id}/cancel`).send({})).status, 400, 'motif obligatoire');
  res = await secretaire.post(`${URL}/${res.body.id}/cancel`).send({ reason: 'Doublon' });
  assert.equal(res.body.status, 'annule');
  res = await secretaire.post(URL).send({ direction: 'arrivee', date: day(0), correspondent: 'Suivant', subject: 'Après annulation' });
  assert.notEqual(res.body.number, number);
});

test('relances : veille de l’échéance puis dépassement, au destinataire et à la direction, une seule fois', async () => {
  let res = await secretaire.post(URL).send({ direction: 'arrivee', date: day(-3), correspondent: 'Fournisseur', subject: 'Facture 42', nature: 'facture' });
  const id = res.body.id;
  await resp.post(`${URL}/${id}/assign`).send({ suite: 'traitement', assigned_to: ids.comptable, due_date: day(1) });
  await db('mail_items').whereNot({ id }).where({ status: 'affecte' }).update({ status: 'traite' });
  sent.length = 0;
  assert.equal(await courrier.tick(db, day(0)), 1);
  const to = sent.map(m => m.to);
  assert.ok(to.includes('comptable@test.ci') && to.includes('resp_exploitation@test.ci'), to.join(','));
  assert.ok(sent.every(m => /Rappel/.test(m.subject)));
  assert.equal(await courrier.tick(db, day(0)), 0, 'pas deux fois');
  sent.length = 0;
  assert.equal(await courrier.tick(db, day(2)), 1);
  assert.ok(sent.every(m => /Retard/.test(m.subject)));
  await db('mail_items').where({ id }).update({ due_date: day(-1) });
  assert.equal((await resp.get(`${URL}/badges`)).body.late, 1);
  assert.equal((await resp.get(`${URL}?late=1`)).body.length, 1);
});
