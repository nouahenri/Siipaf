/**
 * Demande au nom d'un service (précision du client du 29/10) : le chef de service désigné dans Réglages RH exprime un
 * besoin de travail pour tout son service, depuis le module ; même circuit que les demandes personnelles ; les membres
 * du service la suivent ; véhicule demandé au nom du service.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

const REQ = '/api/admin/erp/demandes', RH = '/api/admin/erp/rh', PARC = '/api/admin/erp/parc/reservations';
const insertedId = r => (typeof r === 'object' ? r.id : r);
let db, app, admin, editeur, commercial, conducteur, ids, chiefEmp, memberEmp;
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
const inDays = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

before(async () => {
  ({ db, app } = await setup()); admin = await login(app);
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  const base = { hire_date: '2024-01-01', job_title: 'Assistant', base_salary: 300000, department: 'rh' };
  chiefEmp = insertedId((await db('employees').insert({ ...base, job_title: 'Responsable RH', matricule: 'E-1', last_name: 'Koné', first_name: 'Awa', user_id: ids.editeur }))[0]);
  memberEmp = insertedId((await db('employees').insert({ ...base, matricule: 'E-2', last_name: 'Yao', first_name: 'Paul', user_id: ids.commercial }))[0]);
});
after(() => db.destroy());

test('chef de service désigné : demande au nom du service, suivie par les membres, invisible des autres', async () => {
  const refs = ok(await editeur.get(`${REQ}/refs`));
  assert.equal(refs.departments.rh, 'Ressources humaines', 'service RH ajouté');
  assert.ok(refs.departments.sav, 'service SAV ajouté');
  const body = { kind: 'equipement', department: 'rh', title: 'Imprimante pour le service RH', estimated_amount: 180000 };
  assert.equal((await editeur.post(REQ).send(body)).status, 403, 'pas encore chef désigné');

  // Réglages RH : désignation du chef (droit rh:settings), il est prévenu
  assert.equal((await commercial.put(`${RH}/department-heads/rh`).send({ employee_id: chiefEmp })).status, 403);
  const heads = ok(await admin.put(`${RH}/department-heads/rh`).send({ employee_id: chiefEmp }));
  assert.equal(heads.rh.user_id, ids.editeur);
  assert.ok(await db('notifications').where({ event: 'rh.chef_service', user_id: ids.editeur, module: 'rh' }).first());
  assert.deepEqual(ok(await editeur.get(`${REQ}/refs`)).my_departments.heads, ['rh']);

  // Même circuit qu'une demande personnelle (sans responsable direct : Achats)
  const r = ok(await editeur.post(REQ).send(body), 201);
  assert.equal(r.department_label, 'Ressources humaines');
  assert.equal(r.status, 'attente_achats');
  assert.equal((await commercial.post(REQ).send({ ...body, title: 'Autre imprimante' })).status, 403, 'un membre n’est pas le chef');
  assert.equal((await editeur.post(REQ).send({ ...body, department: 'juridique' })).status, 403, 'pas chef de ce service');

  // Les membres du service la suivent dans le module ; les autres ne la voient pas
  assert.ok(ok(await commercial.get(`${REQ}?scope=department&department=rh`)).some(x => x.id === r.id));
  ok(await commercial.get(`${REQ}/${r.id}`));
  assert.equal((await conducteur.get(`${REQ}?scope=department&department=rh`)).status, 403);

  // Nouveau chef : il peut retirer une demande du service pas encore prise en charge
  const i = ok(await editeur.post(REQ).send({ kind: 'intervention', department: 'rh', title: 'Climatisation du bureau RH' }), 201);
  assert.equal(i.status, 'attente_sg');
  assert.equal((await conducteur.get(`${REQ}/${i.id}`)).status, 404, 'hors du service (un achat reste visible des Achats)');
  ok(await admin.put(`${RH}/department-heads/rh`).send({ employee_id: memberEmp }));
  assert.equal(ok(await commercial.post(`${REQ}/${i.id}/annuler`)).status, 'annulee');
  // Retrait du chef
  assert.equal(ok(await admin.put(`${RH}/department-heads/rh`).send({ employee_id: null })).rh, undefined);
});

test('véhicule demandé au nom du service : le chef seulement, suivi par les membres', async () => {
  ok(await admin.put(`${RH}/department-heads/rh`).send({ employee_id: chiefEmp }));
  const slot = { start_at: `${inDays(3)}T08:00`, end_at: `${inDays(3)}T17:00`, purpose: 'Visite médicale des ouvriers', department: 'rh' };
  assert.equal((await commercial.post(PARC).send(slot)).status, 403, 'un membre n’est pas le chef');
  const v = ok(await editeur.post(PARC).send(slot), 201);
  assert.equal(v.department_label, 'Ressources humaines');
  assert.ok(ok(await commercial.get(`${PARC}?department=rh`)).some(x => x.id === v.id));
  assert.equal((await conducteur.get(`${PARC}?department=rh`)).status, 403);
});
