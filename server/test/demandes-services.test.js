/**
 * Demande adressée à un service (demande du client du 29/10) : directement au service, sans accord du responsable ;
 * le service la voit dans son module (« Demandes reçues »), la prend en charge et répond ; le demandeur est prévenu.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

const REQ = '/api/admin/erp/demandes';
let db, app, editeur, comptable, commercial, resp, ids;
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };

before(async () => {
  ({ db, app } = await setup());
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123'); // rh:files, compta:entries
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  resp = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123'); // demandes:handle, leads:assign
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
});
after(() => db.destroy());

test('demande à la RH : reçue par la RH sans passer par le responsable, prise en charge, réponse au demandeur', async () => {
  const refs = ok(await editeur.get(`${REQ}/refs`));
  assert.ok(refs.services.rh && refs.services.juridique && refs.services.administration);
  assert.equal((await editeur.post(REQ).send({ kind: 'service', title: 'Attestation de travail' })).status, 400, 'service destinataire obligatoire');
  let r = ok(await editeur.post(REQ).send({ kind: 'service', service: 'rh', title: 'Attestation de travail', details: 'Pour un dossier de prêt bancaire' }), 201);
  assert.equal(r.status, 'attente_service');
  assert.match(r.kind_label, /Ressources humaines/);
  assert.ok(await db('notifications').where({ event: 'demande.service', user_id: ids.comptable, module: 'rh' }).first(), 'la RH est prévenue dans son module');
  // Seul le service destinataire la voit dans « Demandes reçues »
  const inbox = ok(await comptable.get(`${REQ}?scope=service&service=rh`));
  assert.deepEqual(inbox.map(x => x.id), [r.id]);
  assert.equal((await commercial.get(`${REQ}?scope=service&service=rh`)).status, 403);
  assert.equal((await commercial.get(`${REQ}/${r.id}`)).status, 404, 'pas visible d’un autre service');
  // Prise en charge puis réponse
  r = ok(await comptable.post(`${REQ}/${r.id}/prendre`));
  assert.equal(r.status, 'en_cours');
  r = ok(await comptable.post(`${REQ}/${r.id}/cloturer`).send({ outcome: 'traitee', note: 'Attestation disponible à l’accueil' }));
  assert.equal(r.status, 'traitee');
  assert.ok(await db('notifications').where({ event: 'demande.suite', user_id: ids.editeur }).where('title', 'like', 'Demande traitée%').first());
  assert.equal(ok(await comptable.get(`${REQ}?scope=service&service=rh`)).length, 0, 'traitée : sortie des demandes reçues');
});

test('demande au Commercial, au Juridique et à l’Administration générale', async () => {
  const c = ok(await editeur.post(REQ).send({ kind: 'service', service: 'commercial', title: 'Plaquette du programme pour un partenaire' }), 201);
  assert.equal(c.status, 'attente_service');
  assert.ok(ok(await resp.get(`${REQ}?scope=service&service=commercial`)).some(x => x.id === c.id), 'le responsable commercial la reçoit');
  // L'Administration générale passe par les services généraux (Demandes internes › À traiter)
  const a = ok(await editeur.post(REQ).send({ kind: 'service', service: 'administration', title: 'Badge d’accès au parking' }), 201);
  assert.equal(a.status, 'attente_sg');
  assert.ok(ok(await resp.get(`${REQ}?scope=handle`)).some(x => x.id === a.id));
  // L'auteur peut retirer sa demande tant qu'elle n'est pas prise en charge
  assert.equal(ok(await editeur.post(`${REQ}/${c.id}/annuler`)).status, 'annulee');
});
