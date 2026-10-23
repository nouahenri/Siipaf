const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, login } = require('./helpers');
const { monthChoices, paymentTerms, monthlyFor } = require('../src/lib/domain');

let db, app, admin, projectId;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  const res = await admin.post('/api/admin/projects').send({ name: 'Lotissement Acompte', slug: 'lotissement-acompte', published: true });
  projectId = res.body.id;
});
after(() => db.destroy());

test('règles : délais proposés, conditions du projet sinon par défaut, mensualité', () => {
  assert.deepEqual(monthChoices('24, 6 ;12, 6, 0, 500, abc'), [6, 12, 24]);
  const defaults = { deposit_default: 0, balance_months_default: 36 };
  assert.deepEqual(paymentTerms({}, defaults), { deposit_fcfa: 0, balance_months: 36 });
  assert.deepEqual(paymentTerms({ deposit_fcfa: '500000', balance_months: 24 }, defaults), { deposit_fcfa: 500000, balance_months: 24 });
  assert.equal(monthlyFor(2700000, { deposit_fcfa: 0, balance_months: 36 }), 75000, 'sans acompte : comme avant (prix ÷ 36)');
  assert.equal(monthlyFor(2700000, { deposit_fcfa: 500000, balance_months: 24 }), 91667);
});

test('Paramètres : acompte et délai par défaut, durées proposées (le délai par défaut en fait partie)', async () => {
  let res = await admin.get('/api/admin/settings');
  assert.equal(res.body.values.balance_months_default, 36);
  assert.equal(res.body.values.balance_months_choices, '6, 12, 24, 36');
  assert.equal(res.body.fields.balance_months_choices.list, true);
  res = await admin.put('/api/admin/settings').send({ deposit_default: 250000, balance_months_default: 48, balance_months_choices: '24 ; 6, 12' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.values.deposit_default, 250000);
  assert.equal(res.body.values.balance_months_choices, '6, 12, 24, 48', 'le délai par défaut est ajouté aux durées proposées');
  assert.equal((await admin.put('/api/admin/settings').send({ balance_months_choices: 'aucune' })).status, 400);
  assert.equal((await admin.put('/api/admin/settings').send({ balance_months_default: 0 })).status, 400);
});

test('fiche projet et site : acompte, délai de solde, documents du bien', async () => {
  const refs = (await admin.get('/api/admin/refs')).body;
  assert.equal(refs.kinds.document.state_labels.fait, 'Obtenu');
  const docs = refs.items.filter(i => i.kind === 'document');
  const acd = docs.find(d => /^ACD/.test(d.label));
  const titre = docs.find(d => d.label === 'Titre foncier');
  assert.ok(acd && titre, 'liste par défaut des documents');

  // Sans valeur sur la fiche : valeurs par défaut de Paramètres
  let site = (await request(app).get('/api/public/projects')).body.find(p => p.id === projectId);
  assert.equal(site.deposit_fcfa, 250000);
  assert.equal(site.balance_months, 48);
  assert.deepEqual(site.documents, []);

  let res = await admin.patch(`/api/admin/projects/${projectId}`).send({ deposit_fcfa: 500000, balance_months: 24, refs: [{ id: acd.id, state: 'fait' }, { id: titre.id, state: 'en_cours' }] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.deposit_fcfa, 500000);
  assert.equal((await admin.get(`/api/admin/projects/${projectId}`)).body.refs.document.length, 2);

  site = (await request(app).get('/api/public/projects')).body.find(p => p.id === projectId);
  assert.equal(site.deposit_fcfa, 500000);
  assert.equal(site.balance_months, 24);
  assert.deepEqual(site.balance_months_choices, [6, 12, 24, 48]);
  assert.deepEqual(site.documents.map(d => `${d.label} : ${d.state_label}`).sort(), ['ACD (Arrêté de Concession Définitive) : Obtenu', 'Titre foncier : En cours']);
  const detail = (await request(app).get('/api/public/projects/lotissement-acompte')).body;
  assert.equal(detail.deposit_fcfa, 500000);
  assert.equal(detail.documents.length, 2);

  // Vider la fiche : retour aux valeurs par défaut ; état inconnu refusé ; délai hors bornes refusé
  await admin.patch(`/api/admin/projects/${projectId}`).send({ deposit_fcfa: null, balance_months: null });
  site = (await request(app).get('/api/public/projects')).body.find(p => p.id === projectId);
  assert.equal(site.balance_months, 48);
  assert.equal((await admin.patch(`/api/admin/projects/${projectId}`).send({ refs: [{ id: acd.id, state: 'perdu' }] })).status, 400);
  assert.equal((await admin.patch(`/api/admin/projects/${projectId}`).send({ balance_months: 200 })).status, 400);
});
