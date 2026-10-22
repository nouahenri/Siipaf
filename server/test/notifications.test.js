const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const notifications = require('../src/services/notifications');

let db, app, resp, secretaire, commercial, ids;
const URL = '/api/admin/erp/notifications';
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  ({ db, app } = await setup());
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  await createUser(db, 'editeur');
  const sec = await db('users').where({ email: 'editeur@test.ci' }).first();
  await db('user_permissions').insert([{ user_id: sec.id, permission: 'courrier:write', granted: true }, { user_id: sec.id, permission: 'courrier:read', granted: true }]);
  secretaire = await login(app, 'editeur@test.ci', 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
});
after(() => db.destroy());

test('notify : une fois par clé et par compte, jamais à l’auteur, e-mail seulement sur demande', async () => {
  const mails = sent.length;
  const base = { module: 'rh', event: 'test.demo', title: 'Essai', link: '/rh', key: 'demo:1' };
  assert.equal(await notifications.notify(db, { ...base, to: [ids.commercial, ids.commercial, null, ids.resp_exploitation], except: ids.resp_exploitation }), 1);
  assert.equal(await notifications.notify(db, { ...base, to: ids.commercial }), 0, 'même clé : pas de doublon');
  assert.equal(sent.length, mails, 'cloche seule par défaut');
  await notifications.notify(db, { ...base, key: 'demo:2', to: ids.commercial, email: true });
  assert.equal(sent.length, mails + 1);
  assert.match(sent.at(-1).text, /Ouvrir dans l’ERP : .*\/rh/);
});

test('la cloche : compteurs par module, marquer lu, chacun ne voit que les siennes', async () => {
  let res = await commercial.get(URL);
  assert.equal(res.status, 200);
  assert.equal(res.body.unread, 2);
  assert.deepEqual(res.body.by_module, { rh: 2 });
  assert.equal(res.body.items[0].module_label, 'Ressources humaines');
  assert.equal((await resp.get(URL)).body.unread, 0, 'les notifications des autres ne sont pas visibles');
  // Marquer lue la notification d'un autre compte : sans effet
  assert.equal((await resp.post(`${URL}/read`).send({ ids: [res.body.items[0].id] })).body.updated, 0);
  await commercial.post(`${URL}/read`).send({ ids: [res.body.items[0].id] });
  assert.equal((await commercial.get(URL)).body.unread, 1);
  await commercial.post(`${URL}/read`).send({ module: 'rh' });
  res = await commercial.get(`${URL}?unread=1`);
  assert.equal(res.body.unread, 0);
  assert.equal(res.body.items.length, 0);
  assert.equal((await commercial.get(`${URL}?module=inconnu`)).status, 400);
});

test('courrier : à affecter pour la direction, à traiter pour le destinataire, lu une fois la suite donnée', async () => {
  let res = await secretaire.post('/api/admin/erp/courrier').send({ direction: 'arrivee', date: today, correspondent: 'Mairie', subject: 'Permis de construire' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id = res.body.id;
  let bell = (await resp.get(URL)).body;
  const toAssign = bell.items.find(n => n.event === 'courrier.a_affecter');
  assert.ok(toAssign, 'la direction est prévenue');
  assert.equal(toAssign.link, `/administration/courrier?fiche=${id}`);
  assert.equal(toAssign.priority, 'action');
  assert.equal((await secretaire.get(URL)).body.unread, 0, 'pas de notification à l’auteur');

  res = await resp.post(`/api/admin/erp/courrier/${id}/assign`).send({ suite: 'traitement', assigned_to: ids.commercial, due_date: today });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  bell = (await resp.get(URL)).body;
  assert.ok(bell.items.find(n => n.event === 'courrier.a_affecter').read, 'affecté : plus à traiter pour la direction');
  bell = (await commercial.get(URL)).body;
  const mine = bell.items.find(n => n.event === 'courrier.affecte');
  assert.ok(mine && !mine.read);
  assert.equal(bell.by_module.administration, 1);

  res = await commercial.post(`/api/admin/erp/courrier/${id}/done`).send({ note: 'Dossier transmis' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await commercial.get(URL)).body.unread, 0, 'traité : la notification est lue');
});
