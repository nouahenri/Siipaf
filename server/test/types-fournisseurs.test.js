const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

let db, app, comptable, commercial;
const C = '/api/admin/erp/compta';

before(async () => {
  ({ db, app } = await setup());
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
});
after(() => db.destroy());

test('types de fournisseurs : liste réglable, types d’origine protégés, contrôle à la saisie', async () => {
  let kinds = (await comptable.get(`${C}/supplier-kinds`)).body;
  assert.deepEqual(kinds.map(k => k.code), ['fournisseur', 'sous_traitant', 'prestataire', 'notaire']);
  let res = await comptable.post(`${C}/supplier-kinds`).send({ label: 'Bureau d’études' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const code = res.body.code;
  assert.equal(code, 'bureau_d_etudes');
  assert.equal((await comptable.post(`${C}/supplier-kinds`).send({ label: 'bureau d’études' })).status, 409, 'doublon');
  assert.equal((await commercial.post(`${C}/supplier-kinds`).send({ label: 'Géomètre' })).status, 403);
  const notaire = kinds.find(k => k.code === 'notaire');
  assert.equal((await comptable.patch(`${C}/supplier-kinds/${notaire.id}`).send({ active: false })).status, 409, 'type d’origine');
  assert.equal((await comptable.patch(`${C}/supplier-kinds/${notaire.id}`).send({ label: 'Notaire et huissier' })).status, 200, 'renommable');

  res = await comptable.post(`${C}/suppliers`).send({ name: 'BET Kouadio', kind: code });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const supplier = (await comptable.get(`${C}/suppliers`)).body.find(s => s.name === 'BET Kouadio');
  assert.equal(supplier.kind_label, 'Bureau d’études');
  assert.equal((await comptable.post(`${C}/suppliers`).send({ name: 'Inconnu SARL', kind: 'inexistant' })).status, 400);

  // Type désactivé : plus proposé, mais le fournisseur qui l'a le garde en modifiant autre chose
  const k = (await comptable.get(`${C}/supplier-kinds`)).body.find(x => x.code === code);
  await comptable.patch(`${C}/supplier-kinds/${k.id}`).send({ active: false });
  assert.equal((await comptable.post(`${C}/suppliers`).send({ name: 'Autre BET', kind: code })).status, 400);
  assert.equal((await comptable.patch(`${C}/suppliers/${supplier.id}`).send({ kind: code, phone: '0102030405' })).status, 200);
  kinds = (await comptable.get(`${C}/supplier-kinds`)).body;
  assert.equal(kinds.find(x => x.code === code).suppliers, 1);
});
