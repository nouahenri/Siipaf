/**
 * Réaudit des privilèges du 30/10 : portée du SAV (sav:all), messages de contact, capture de fiches, demandes de reprise,
 * TMA et actes, références des chantiers, validation des achats, pièces du dossier du personnel, borne de pointage…
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, login, createUser } = require('./helpers');
const { savFilesDir } = require('../src/services/sav');
const { PERMISSIONS, PERMISSION_IDS } = require('../src/lib/domain');
const migration = require('../migrations/20261130700000_privileges_audit');

const PWD = 'motdepasse-test-123';
const ERP = '/api/admin/erp';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
let db, app, admin, resp, comptable, conducteur, sellerA, sellerB, idA, idB, project, lots, leadA, leadB, saleA, saleB;

/** Rôle personnalisé avec des droits précis (sans passer par les droits par défaut du code). */
async function roleWith(key, perms) {
  await db('roles').insert({ id: key, label: key, description: '', system: false });
  await db('role_permissions').insert(perms.map(permission => ({ role: key, permission })));
  require('../src/services/permissions').invalidate(db);
  return login(app, await createUser(db, key, `${key}@test.ci`), PWD);
}
const idOf = async email => (await db('users').where({ email }).first()).id;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  resp = await login(app, await createUser(db, 'resp_exploitation'), PWD);
  comptable = await login(app, await createUser(db, 'comptable'), PWD);
  conducteur = await login(app, await createUser(db, 'conducteur_travaux'), PWD);
  sellerA = await login(app, await createUser(db, 'commercial', 'vendeur.a@test.ci'), PWD);
  sellerB = await login(app, await createUser(db, 'commercial', 'vendeur.b@test.ci'), PWD);
  idA = await idOf('vendeur.a@test.ci');
  idB = await idOf('vendeur.b@test.ci');
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'AP1', price_fcfa: 20000000 }, { code: 'AP2', price_fcfa: 20000000 }, { code: 'AP3', price_fcfa: 20000000 }]);
  lots = await db('lots').where({ project_id: project.id }).whereIn('code', ['AP1', 'AP2', 'AP3']).orderBy('code');
  leadA = (await sellerA.post('/api/admin/leads').send({ name: 'Client de A', phone: '0711111111' })).body;
  leadB = (await sellerB.post('/api/admin/leads').send({ name: 'Client de B', phone: '0722222222' })).body;
  saleA = (await sellerA.post(`/api/admin/lots/${lots[0].id}/sale`).send({ lead_id: leadA.id })).body;
  saleB = (await sellerB.post(`/api/admin/lots/${lots[1].id}/sale`).send({ lead_id: leadB.id })).body;
});
after(async () => {
  for (const f of await db('sav_files').select('filename')) fs.rmSync(path.join(savFilesDir, f.filename), { force: true });
  await db.destroy();
});

// ─── Droits ajoutés au catalogue et accordés aux rôles par défaut ────────────
test('nouveaux droits : au catalogue et aux bons rôles par défaut (sans commercial pour sav:all, rh:documents au service RH seulement)', () => {
  for (const p of ['sav:all', 'contacts:handle', 'achats:validate', 'rh:documents']) assert.ok(PERMISSION_IDS.includes(p), p);
  assert.ok(PERMISSIONS.conducteur_travaux.includes('sav:all') && PERMISSIONS.resp_exploitation.includes('sav:all'));
  assert.ok(!PERMISSIONS.commercial.includes('sav:all'), 'le commercial ne voit que ses clients au SAV');
  assert.ok(PERMISSIONS.comptable.includes('achats:validate') && !PERMISSIONS.resp_exploitation.includes('achats:validate'));
  // Service RH : qui règle les RH (rh:rules) ; pas les autres titulaires de rh:read
  for (const [role, perms] of Object.entries(PERMISSIONS)) {
    if (role === 'super_admin') continue;
    assert.equal(perms.includes('rh:documents'), perms.includes('rh:rules'), role);
  }
  for (const role of ['commercial', 'editeur', 'resp_exploitation']) assert.ok(PERMISSIONS[role].includes('contacts:handle'), role);
});

test('migration : les nouveaux droits vont aux rôles et aux comptes qui en avaient l’usage, pas aux autres', async () => {
  const mk = async (key, perms) => { await db('roles').insert({ id: key, label: key, description: '', system: false }); await db('role_permissions').insert(perms.map(permission => ({ role: key, permission }))); };
  await mk('mig_sav_gere', ['sav:read', 'sav:handle']);
  await mk('mig_sav_lecteur', ['sav:read', 'compta:read']);
  await mk('mig_sav_vendeur', ['sav:read', 'leads:create']);
  await mk('mig_achats', ['achats:write']);
  await mk('mig_rh_lecteur', ['rh:read']);
  await mk('mig_rh_service', ['rh:read', 'rh:settings']);
  await mk('mig_contacts', ['contacts:read']);
  const u1 = await createUser(db, 'mig_rh_lecteur', 'mig1@test.ci');
  const id1 = await idOf(u1);
  await db('user_permissions').insert([{ user_id: id1, permission: 'sav:interventions', granted: true }, { user_id: id1, permission: 'achats:write', granted: false }, { user_id: id1, permission: 'rh:settings', granted: true }]);
  await migration.up(db);
  const has = async (role, p) => !!(await db('role_permissions').where({ role, permission: p }).first());
  assert.equal(await has('mig_sav_gere', 'sav:all'), true);
  assert.equal(await has('mig_sav_lecteur', 'sav:all'), true, 'consulte le SAV sans gérer de prospects');
  assert.equal(await has('mig_sav_vendeur', 'sav:all'), false, 'rôle de vendeur : seulement ses clients');
  assert.equal(await has('commercial', 'sav:all'), false);
  assert.equal(await has('mig_achats', 'achats:validate'), true);
  assert.equal(await has('mig_rh_lecteur', 'rh:documents'), false);
  assert.equal(await has('mig_rh_service', 'rh:documents'), true);
  assert.equal(await has('mig_contacts', 'contacts:handle'), true);
  const up = async p => (await db('user_permissions').where({ user_id: id1, permission: p }).first());
  assert.equal(!!(await up('sav:all')).granted, true);
  assert.equal(!!(await up('rh:documents')).granted, true);
  assert.equal(!!(await up('achats:validate')).granted, false, 'un droit retiré reste retiré');
  await migration.up(db); // rejouable
  assert.equal((await db('role_permissions').where({ role: 'mig_sav_gere', permission: 'sav:all' })).length, 1);
});

// ─── 1. SAV : sav:all (B1) ───────────────────────────────────────────────────
let tA, tB, tAssigned, reserveB, intervB, fileA, fileB;
test('SAV : sans sav:all, tickets, réserves, interventions, clients et statistiques limités à ses clients ou à ce qui est confié', async () => {
  tA = (await admin.post(`${ERP}/sav/tickets`).send({ sale_id: saleA.id, category: 'plomberie', title: 'Fuite chez A' })).body;
  tB = (await admin.post(`${ERP}/sav/tickets`).send({ sale_id: saleB.id, category: 'plomberie', title: 'Fuite chez B' })).body;
  assert.ok(tA.id && tB.id);
  reserveB = (await admin.post(`${ERP}/sav/sales/${saleB.id}/reserves`).send({ label: 'Peinture à reprendre' })).body;
  intervB = (await admin.post(`${ERP}/sav/interventions`).send({ ticket_id: tB.id, scheduled_at: '2027-01-10T09:00:00Z' })).body;
  assert.ok(reserveB.id && intervB.id);

  const ids = rows => rows.map(x => x.id);
  assert.deepEqual(ids((await sellerA.get(`${ERP}/sav/tickets`)).body.rows), [tA.id]);
  assert.equal((await sellerA.get(`${ERP}/sav/tickets/${tB.id}`)).status, 404);
  assert.equal((await sellerA.get(`${ERP}/sav/tickets/${tA.id}`)).status, 200);
  assert.deepEqual(ids((await sellerA.get(`${ERP}/sav/sales`)).body), [saleA.id]);
  assert.equal((await sellerA.get(`${ERP}/sav/sales/${saleB.id}`)).status, 404);
  assert.equal((await sellerA.get(`${ERP}/sav/sales/${saleA.id}`)).status, 200);
  assert.deepEqual((await sellerA.get(`${ERP}/sav/reserves`)).body, []);
  assert.deepEqual((await sellerA.get(`${ERP}/sav/interventions`)).body, []);
  const stats = (await sellerA.get(`${ERP}/sav/stats`)).body;
  assert.equal(stats.open, 1);
  assert.deepEqual(stats.reserves, {});
  assert.equal(stats.upcoming_interventions, 0);

  // Portée équipe : tout le SAV
  for (const who of [admin, resp, conducteur]) {
    assert.equal((await who.get(`${ERP}/sav/tickets`)).body.total, 2);
    assert.equal((await who.get(`${ERP}/sav/stats`)).body.open, 2);
  }
  assert.equal((await resp.get(`${ERP}/sav/reserves`)).body.length, 1);
});

test('SAV : le ticket confié et l’intervention dont on est technicien entrent dans la portée', async () => {
  // Le ticket du client de B est confié à A (sav:assign suffit côté responsable)
  assert.equal((await resp.patch(`${ERP}/sav/tickets/${tB.id}`).send({ assigned_to: idA })).status, 200);
  assert.deepEqual((await sellerA.get(`${ERP}/sav/tickets`)).body.rows.map(x => x.id).sort(), [tA.id, tB.id].sort());
  assert.equal((await sellerA.get(`${ERP}/sav/tickets/${tB.id}`)).status, 200);
  // L'intervention de ce ticket et le dossier lié deviennent visibles
  assert.equal((await sellerA.get(`${ERP}/sav/interventions`)).body.length, 1);
  assert.equal((await sellerA.get(`${ERP}/sav/sales/${saleB.id}`)).status, 200);
  assert.equal((await sellerA.get(`${ERP}/sav/sales`)).body.length, 2, '/sales suit /sales/:id : ses clients + le dossier de la réclamation confiée');
  // Retiré : A ne voit plus rien du client de B
  assert.equal((await resp.patch(`${ERP}/sav/tickets/${tB.id}`).send({ assigned_to: null })).status, 200);
  assert.equal((await sellerA.get(`${ERP}/sav/tickets/${tB.id}`)).status, 404);
  // Technicien d'une intervention
  await db('sav_interventions').where({ id: intervB.id }).update({ technician_id: idA });
  assert.equal((await sellerA.get(`${ERP}/sav/interventions`)).body.length, 1);
  assert.equal((await sellerA.get(`${ERP}/sav/reserves`)).body.length, 0, 'une intervention sur un ticket ne donne pas les réserves');
  await db('sav_interventions').where({ id: intervB.id }).update({ technician_id: null });
  assert.equal((await sellerA.get(`${ERP}/sav/interventions`)).body.length, 0);
});

test('SAV : écritures hors portée refusées (réserve, date de livraison, intervention, statut) pour qui n’a pas sav:all', async () => {
  const gestionnaire = await roleWith('sav_sans_portee', ['sav:read', 'sav:create', 'sav:edit', 'sav:status', 'sav:comment', 'sav:delivery', 'sav:reserves', 'sav:interventions', 'leads:create']);
  const me = await idOf('sav_sans_portee@test.ci');
  assert.equal((await gestionnaire.post(`${ERP}/sav/sales/${saleB.id}/reserves`).send({ label: 'Hors portée' })).status, 404);
  assert.equal((await gestionnaire.patch(`${ERP}/sav/sales/${saleB.id}/delivery`).send({ delivered_at: '2026-06-01' })).status, 404);
  assert.equal((await gestionnaire.patch(`${ERP}/sav/reserves/${reserveB.id}`).send({ status: 'levee' })).status, 404);
  assert.equal((await gestionnaire.post(`${ERP}/sav/interventions`).send({ ticket_id: tB.id, scheduled_at: '2027-02-01T09:00:00Z' })).status, 404);
  assert.equal((await gestionnaire.patch(`${ERP}/sav/interventions/${intervB.id}`).send({ report: 'x' })).status, 404);
  assert.equal((await gestionnaire.post(`${ERP}/sav/tickets/${tB.id}/status`).send({ status: 'qualifie' })).status, 404);
  assert.equal((await gestionnaire.post(`${ERP}/sav/tickets/${tB.id}/comments`).send({ body: 'x' })).status, 404);
  assert.equal((await gestionnaire.post(`${ERP}/sav/tickets`).send({ sale_id: saleB.id, category: 'autre', title: 'Pour un autre client' })).status, 404);
  // Un client attribué à ce compte : écritures permises
  await db('leads').where({ id: leadB.id }).update({ assigned_to: me });
  assert.equal((await gestionnaire.post(`${ERP}/sav/sales/${saleB.id}/reserves`).send({ label: 'Dans la portée' })).status, 201);
  assert.equal((await gestionnaire.post(`${ERP}/sav/tickets/${tB.id}/status`).send({ status: 'qualifie' })).status, 200);
  await db('leads').where({ id: leadB.id }).update({ assigned_to: idB });
  // Avec sav:all, plus de limite
  await db('role_permissions').insert({ role: 'sav_sans_portee', permission: 'sav:all' });
  require('../src/services/permissions').invalidate(db);
  const relog = await login(app, 'sav_sans_portee@test.ci', PWD);
  assert.equal((await relog.get(`${ERP}/sav/tickets/${tB.id}`)).status, 200);
});

test('SAV : photos — dépôt sans client libre (lead_id hors périmètre refusé), lecture limitée à la portée', async () => {
  // Dépôt d'une photo par A en visant le client de B : refusé ; pour son client : accepté
  let res = await sellerA.post(`${ERP}/sav/files`).field('lead_id', String(leadB.id)).attach('files', PNG, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(res.status, 403, 'le commercial n’a pas de droit d’écriture au SAV');
  const gest = await roleWith('sav_photos', ['sav:read', 'sav:edit', 'sav:status', 'sav:comment', 'leads:create']);
  const me = await idOf('sav_photos@test.ci');
  res = await gest.post(`${ERP}/sav/files`).field('lead_id', String(leadB.id)).attach('files', PNG, { filename: 'b.png', contentType: 'image/png' });
  assert.equal(res.status, 404, 'client hors de son périmètre');
  assert.equal((await db('sav_files').where({ lead_id: leadB.id }).first()), undefined, 'rien n’est rattaché au client de B');
  await db('leads').where({ id: leadA.id }).update({ assigned_to: me });
  res = await gest.post(`${ERP}/sav/files`).field('lead_id', String(leadA.id)).attach('files', PNG, { filename: 'c.png', contentType: 'image/png' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await db('leads').where({ id: leadA.id }).update({ assigned_to: idA });
  // Lecture : photo du client B vue de A -> 404 ; de l'équipe SAV -> 200
  res = await admin.post(`${ERP}/sav/files`).field('lead_id', String(leadB.id)).attach('files', PNG, { filename: 'd.png', contentType: 'image/png' });
  fileB = res.body[0].id;
  res = await admin.post(`${ERP}/sav/files`).field('lead_id', String(leadA.id)).attach('files', PNG, { filename: 'e.png', contentType: 'image/png' });
  fileA = res.body[0].id;
  assert.equal((await sellerA.get(`${ERP}/sav/files/${fileB}`)).status, 404);
  assert.equal((await sellerA.get(`${ERP}/sav/files/${fileA}`)).status, 200);
  assert.equal((await resp.get(`${ERP}/sav/files/${fileB}`)).status, 200);
});

// ─── B2. Messages de contact cloisonnés, contacts:handle ─────────────────────
test('messages de contact : sans la portée équipe, ceux de ses fiches et la boîte commune (sans fiche ou fiche non attribuée), jamais ceux d’un collègue ; traiter demande contacts:handle', async () => {
  const free = await db('leads').insert({ name: 'Non attribué', phone: '0744444444', source: 'site' });
  const freeId = typeof free[0] === 'object' ? free[0].id : free[0];
  const ins = async (lead_id, name) => { const [id] = await db('contact_messages').insert({ name, message: 'Bonjour, je souhaite des informations.', lead_id }); return typeof id === 'object' ? id.id : id; };
  const mA = await ins(leadA.id, 'Msg A'), mB = await ins(leadB.id, 'Msg B'), mNone = await ins(null, 'Msg libre'), mFree = await ins(freeId, 'Msg non attribué');
  const names = async who => (await who.get('/api/admin/contacts?limit=200')).body.rows.map(x => x.name);
  assert.deepEqual((await names(sellerA)).sort(), ['Msg A', 'Msg libre', 'Msg non attribué'], 'les siens + la boîte commune, pas ceux du collègue');
  const all = await names(resp);
  for (const n of ['Msg A', 'Msg B', 'Msg libre', 'Msg non attribué']) assert.ok(all.includes(n), n);
  // Compteur du tableau de bord : même périmètre
  assert.equal((await sellerA.get('/api/admin/stats')).body.new_messages, 3);
  // Traitement : jamais le message d'un collègue
  assert.equal((await sellerA.patch(`/api/admin/contacts/${mB}`).send({ status: 'traite' })).status, 404);
  assert.equal((await sellerA.patch(`/api/admin/contacts/${mNone}`).send({ status: 'traite' })).status, 200);
  assert.equal((await sellerA.patch(`/api/admin/contacts/${mFree}`).send({ status: 'traite' })).status, 200);
  assert.equal((await sellerA.patch(`/api/admin/contacts/${mA}`).send({ status: 'traite' })).status, 200);
  assert.equal((await sellerA.get('/api/admin/stats')).body.new_messages, 0);
  assert.equal((await resp.patch(`/api/admin/contacts/${mNone}`).send({ status: 'archive' })).status, 200);
  // Cas de l'éditeur : contacts:read sans leads:all voit la boîte commune, pas les messages des fiches de commerciaux
  const editeur = await roleWith('editeur_messages', ['contacts:read', 'contacts:handle']);
  assert.deepEqual((await names(editeur)).sort(), ['Msg libre', 'Msg non attribué']);
  assert.equal((await editeur.get('/api/admin/stats')).body.new_messages, 0, 'les deux messages ont été traités par les commerciaux ci-dessus');
  assert.equal((await editeur.patch(`/api/admin/contacts/${mB}`).send({ status: 'traite' })).status, 404);
  const mCommon = await ins(null, 'Msg commun 2');
  assert.equal((await editeur.get('/api/admin/stats')).body.new_messages, 1);
  assert.equal((await editeur.patch(`/api/admin/contacts/${mCommon}`).send({ status: 'traite' })).status, 200);
  assert.ok(!(await names(sellerB)).includes('Msg A'));
  // Lire sans traiter : contacts:read seul
  const lecteur = await roleWith('lecteur_messages', ['contacts:read', 'leads:all']);
  assert.equal((await lecteur.get('/api/admin/contacts')).status, 200);
  assert.equal((await lecteur.patch(`/api/admin/contacts/${mB}`).send({ status: 'traite' })).status, 403);
});

// ─── B3. Corps de requête : 2 Mo avant l'authentification, 25 Mo pour l'import Sage après le contrôle du droit ───
test('corps de requête : 2 Mo en amont ; l’import Sage lit jusqu’à 25 Mo seulement pour un compte autorisé', async () => {
  const request = require('supertest');
  const big = { kind: 'plan', rows: Array.from({ length: 12000 }, (_, i) => ({ line: i + 2, cells: [`6${String(i).padStart(7, '0')}`, 'x'.repeat(300)] })), mapping: { account: 0, label: 1 } };
  const size = JSON.stringify(big).length;
  assert.ok(size > 2 * 1024 * 1024 && size < 25 * 1024 * 1024, `taille de test ${size}`);
  const S = '/api/admin/erp/compta/import/sage';
  // Refus avant lecture du corps : la réponse peut arriver alors que le client envoie encore (connexion coupée)
  const refused = async (req, status, msg) => {
    const res = await req.then(r => r, e => e);
    if (res.status !== undefined) assert.equal(res.status, status, msg);
    else assert.ok(['ECONNRESET', 'EPIPE'].includes(res.code), `${msg} : ${res.code}`);
  };
  await refused(request(app).post(S).send(big), 401, 'non connecté : refusé avant toute lecture du corps');
  await refused(sellerA.post(S).send(big), 403, 'connecté sans le droit : refusé avant toute lecture du corps');
  const res = await comptable.post(S).send(big);
  assert.notEqual(res.status, 413, 'le comptable peut envoyer un gros fichier');
  assert.ok([200, 201].includes(res.status), JSON.stringify(res.body).slice(0, 200));
  // Les autres routes restent limitées à 2 Mo
  assert.equal((await comptable.post('/api/admin/leads').send({ name: 'x'.repeat(2.5 * 1024 * 1024) })).status, 413);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'a@b.ci', password: 'x'.repeat(2.5 * 1024 * 1024) })).status, 413);
});

// ─── B6. Import Sage : créer des comptes ou des journaux demande le réglage de la comptabilité ───
test('import Sage : create_accounts / create_journals exigent compta:plan (plan comptable et journaux)', async () => {
  const saisie = await roleWith('saisie_compta', ['compta:read', 'compta:entries', 'compta:import']);
  const S = '/api/admin/erp/compta/import/sage';
  const base = { kind: 'plan', rows: [{ line: 2, cells: ['52110099', 'Banque 2'] }], mapping: { account: 0, label: 1 } };
  assert.equal((await saisie.post(S).send({ ...base, options: { create_accounts: true } })).status, 403);
  const entries = { kind: 'ecritures', rows: [{ line: 2, cells: ['ZZ', '15032025', 'P1', '52110000', '', 'x', '100', ''] }], mapping: { journal: 0, date: 1, piece: 2, account: 3, label: 5, debit: 6, credit: 7 } };
  assert.equal((await saisie.post(S).send({ ...entries, options: { create_journals: true } })).status, 403);
  // Sans l'option, la saisie d'écritures reste permise (simulation)
  assert.equal((await saisie.post(S).send({ ...entries, options: {} })).status, 200);
  assert.equal((await comptable.post(S).send({ ...base, options: { create_accounts: true } })).status, 200);
});

// ─── B4. Capture d'une fiche existante sans commercial ───────────────────────
test('une saisie ne capture pas une fiche sans commercial (409 sans divulgation) ; plannedFor n’attribue pas un client', async () => {
  const [freeId] = await db('leads').insert({ name: 'Venu du site (libre)', phone: '0755555555', source: 'site' });
  const lid = typeof freeId === 'object' ? freeId.id : freeId;
  let res = await sellerA.post('/api/admin/leads').send({ name: 'Autre nom', phone: '0755555555' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /attribution au responsable/);
  assert.equal(res.body.name, undefined);
  assert.equal(res.body.details, undefined, 'aucun identifiant de fiche divulgué');
  assert.equal((await db('leads').where({ id: lid }).first()).assigned_to, null, 'fiche non capturée');
  // Option sur un lot par saisie du même numéro : même refus
  res = await sellerA.post(`/api/admin/lots/${lots[2].id}/option`).send({ name: 'Autre nom', phone: '0755555555' });
  assert.equal(res.status, 409);
  assert.equal((await db('leads').where({ id: lid }).first()).assigned_to, null);
  // Un nouveau numéro reste attribué à son auteur
  res = await sellerA.post('/api/admin/leads').send({ name: 'Vraiment nouveau', phone: '0766666666' });
  assert.equal(res.status, 201);
  assert.equal(res.body.assigned_to, idA);
  // Le responsable (portée équipe) garde la main
  assert.equal((await admin.post('/api/admin/leads').send({ name: 'Autre nom', phone: '0755555555' })).status, 201);

  // Rendez-vous planifié par le responsable pour un commercial : une fiche déjà cliente n'est pas réattribuée
  const [cid] = await db('leads').insert({ name: 'Cliente sans commercial', phone: '0777777777', source: 'site', client_code: 'CL-AUDIT-1' });
  const clientId = typeof cid === 'object' ? cid.id : cid;
  res = await resp.post('/api/admin/appointments').send({ lead_id: clientId, assigned_to: idA, starts_at: '2027-03-01T10:00:00Z' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.assigned_to, idA);
  assert.equal((await db('leads').where({ id: clientId }).first()).assigned_to, null, 'le client n’est pas attribué par ce biais');
  // Un prospect (sans code client) l'est toujours
  res = await resp.post('/api/admin/appointments').send({ lead_id: lid, assigned_to: idA, starts_at: '2027-03-02T10:00:00Z' });
  assert.equal(res.status, 201);
  assert.equal((await db('leads').where({ id: lid }).first()).assigned_to, idA);
});

// ─── B17. assigned_to : un commercial actif ──────────────────────────────────
test('attribution : seul un commercial actif peut recevoir un prospect, une activité ou un rendez-vous', async () => {
  const idCompta = await idOf('comptable@test.ci');
  const [pid] = await db('leads').insert({ name: 'À répartir', phone: '0788888888', source: 'site' });
  const lid = typeof pid === 'object' ? pid.id : pid;
  assert.equal((await resp.patch(`/api/admin/leads/${lid}`).send({ assigned_to: idCompta })).status, 400);
  assert.equal((await admin.post('/api/admin/leads').send({ name: 'Nouveau prospect', phone: '0799999999', assigned_to: idCompta })).status, 400);
  assert.equal((await resp.post('/api/admin/leads/assign').send({ ids: [lid], user_id: idCompta })).status, 400);
  assert.equal((await resp.patch(`${ERP}/commercial/leads/${lid}`).send({ assigned_to: idCompta })).status, 400);
  assert.equal((await admin.post(`${ERP}/commercial/leads/${lid}/activities`).send({ kind: 'appel', due_at: '2027-03-05T09:00:00Z', assigned_to: idCompta })).status, 400);
  assert.equal((await resp.post('/api/admin/appointments').send({ lead_id: lid, assigned_to: idCompta, starts_at: '2027-03-06T10:00:00Z' })).status, 400);
  // Un commercial actif est accepté ; désactivé, il ne l'est plus
  assert.equal((await resp.patch(`/api/admin/leads/${lid}`).send({ assigned_to: idB })).status, 200);
  assert.equal((await resp.patch(`/api/admin/leads/${lid}`).send({ assigned_to: idA })).status, 200);
  await db('users').where({ id: idB }).update({ active: false });
  try {
    assert.equal((await resp.patch(`/api/admin/leads/${lid}`).send({ assigned_to: idB })).status, 400);
  } finally { await db('users').where({ id: idB }).update({ active: true }); }
});

// ─── B5. Demande de reprise : réponse réduite, notification sobre, plafond ───
test('demande de reprise d’un non-propriétaire : {id, status} seulement, titulaire prévenu sans le motif, 5 demandes en attente au plus', async () => {
  const reason = 'Le client m’a appelé directement';
  let res = await sellerA.post(`/api/admin/leads/${leadB.id}/transfert`).send({ reason });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ['id', 'status']);
  assert.equal(res.body.status, 'en_attente');
  const note = await db('notifications').where({ user_id: idB, dedupe_key: `transfert:${res.body.id}:titulaire` }).first();
  assert.ok(note, 'le titulaire est prévenu');
  assert.ok(!`${note.title} ${note.body}`.includes(reason), 'sans le motif');
  // Le propriétaire qui demande le transfert de sa propre fiche reçoit le détail
  res = await sellerA.post(`/api/admin/leads/${leadA.id}/transfert`).send({ reason: 'Je pars en congé', to_user_id: idB });
  assert.equal(res.status, 201);
  assert.equal(res.body.lead_name, 'Client de A');
  await db('lead_transfer_requests').where({ lead_id: leadA.id }).del();
  // Plafond : 5 demandes en attente par demandeur (une déjà posée)
  const owned = [];
  for (let i = 0; i < 5; i++) owned.push((await sellerB.post('/api/admin/leads').send({ name: `Fiche de B ${i}`, phone: `07100000${i}0` })).body.id);
  for (let i = 0; i < 4; i++) assert.equal((await sellerA.post(`/api/admin/leads/${owned[i]}/transfert`).send({ reason })).status, 201, `demande ${i + 2}`);
  res = await sellerA.post(`/api/admin/leads/${owned[4]}/transfert`).send({ reason });
  assert.equal(res.status, 429);
  assert.match(res.body.error, /5 demandes/);
  // Le responsable décide : le compteur repart
  const pending = await db('lead_transfer_requests').where({ requested_by: idA, status: 'en_attente' }).first();
  assert.equal((await resp.post(`/api/admin/lead-transfers/${pending.id}/refuser`).send({ note: 'Non' })).status, 200);
  assert.equal((await sellerA.post(`/api/admin/leads/${owned[4]}/transfert`).send({ reason })).status, 201);
});

// ─── Points 3 et 7 : TMA, actes, références des chantiers ────────────────────
test('TMA et actes : sales:read seul se limite aux dossiers de ses clients ; chantiers, portée équipe et Juridique voient tout', async () => {
  const CH = `${ERP}/chantiers`;
  const tmaA = (await admin.post(`${CH}/tma`).send({ sale_id: saleA.id, title: 'Cloison supplémentaire' })).body;
  const tmaB = (await admin.post(`${CH}/tma`).send({ sale_id: saleB.id, title: 'Prises en plus' })).body;
  assert.ok(tmaA.id && tmaB.id, JSON.stringify(tmaA));
  assert.deepEqual((await sellerA.get(`${CH}/tma`)).body.map(t => t.id), [tmaA.id]);
  assert.deepEqual((await sellerA.get(`${CH}/tma?vente=${saleB.id}`)).body, []);
  assert.equal((await resp.get(`${CH}/tma`)).body.length, 2);
  assert.equal((await conducteur.get(`${CH}/tma`)).body.length, 2);
  // Demande : pour le dossier de son client seulement
  assert.equal((await sellerA.post(`${CH}/tma`).send({ sale_id: saleB.id, title: 'Pour un autre client' })).status, 404);
  assert.equal((await sellerA.post(`${CH}/tma`).send({ sale_id: saleA.id, title: 'Placards' })).status, 201);
  // Annulation et pièce du devis : pas celles d'un collègue
  assert.equal((await sellerA.patch(`${CH}/tma/${tmaB.id}`).send({ status: 'annulee' })).status, 403);
  assert.equal((await sellerA.get(`${CH}/tma/${tmaB.id}/devis`)).status, 404);
  assert.equal((await sellerA.patch(`${CH}/tma/${tmaA.id}`).send({ status: 'annulee' })).status, 200);

  // Actes : la vente d'un collègue n'est pas lisible par l'équipe commerciale
  const J = `${ERP}/juridique/actes`;
  assert.equal((await sellerA.get(`${J}/${saleB.id}`)).status, 404);
  assert.equal((await sellerA.get(`${J}/${saleA.id}`)).status, 200);
  assert.equal((await conducteur.get(`${J}/${saleB.id}`)).status, 200, 'juriste');
  assert.equal((await resp.get(`${J}/${saleB.id}`)).status, 200);
});

test('références et programmes des chantiers : complets pour les chantiers et les conducteurs, minimaux pour les autres', async () => {
  const CH = `${ERP}/chantiers`;
  const full = (await conducteur.get(`${CH}/refs`)).body;
  assert.ok(full.users.length > 0 && full.employees !== undefined && full.settings);
  const minimal = (await sellerA.get(`${CH}/refs`)).body;
  assert.equal(minimal.minimal, true);
  assert.deepEqual([minimal.users, minimal.employees, minimal.suppliers, minimal.articles], [[], [], [], []]);
  assert.equal(minimal.settings, undefined);
  assert.ok(minimal.budget_categories && minimal.projects.length > 0, 'listes de libellés conservées (formulaire de facture d’achat)');
  assert.ok((await sellerA.get(`${CH}/lieux`)).status === 200, 'les lieux restent ouverts');
  assert.deepEqual((await sellerA.get(`${CH}/programmes/${project.id}`)).body, { ilots: [], buildings: [], lots: [] });
  assert.ok((await conducteur.get(`${CH}/programmes/${project.id}`)).body.lots.length >= 3);

  // Un compte sans droit chantiers mais nommé conducteur d'un chantier en voit les références
  const nomme = await roleWith('simple_conducteur', ['sav:read']);
  const meId = await idOf('simple_conducteur@test.ci');
  assert.equal((await nomme.get(`${CH}/refs`)).body.minimal, true);
  const created = await admin.post(CH).send({ project_id: project.id, name: 'Chantier nommé', manager_id: meId });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok((await nomme.get(`${CH}/refs`)).body.users.length > 0);
  assert.ok((await nomme.get(`${CH}/programmes/${project.id}`)).body.lots.length >= 3);
});

// ─── Point 1. Lots de l'ERP : prix, surface et îlot demandent aussi plans:lots ───
test('PATCH lot (ERP) : price_fcfa, surface_m2 et ilot exigent plans:lots en plus de property:lots', async () => {
  const parc = await roleWith('parc_structure', ['commercial:read', 'property:lots']);
  const url = `${ERP}/commercial/lots/${lots[2].id}`;
  assert.equal((await parc.patch(url).send({ price_fcfa: 1 })).status, 403);
  assert.equal((await parc.patch(url).send({ surface_m2: 300 })).status, 403);
  assert.equal((await parc.patch(url).send({ ilot: 'Z' })).status, 403);
  assert.equal((await parc.patch(url).send({ rooms: 3 })).status, 200, 'structure du parc : permise');
  assert.equal(Number((await db('lots').where({ id: lots[2].id }).first()).price_fcfa), 20000000, 'prix inchangé');
  await db('role_permissions').insert({ role: 'parc_structure', permission: 'plans:lots' });
  require('../src/services/permissions').invalidate(db);
  const parc2 = await login(app, 'parc_structure@test.ci', PWD);
  assert.equal((await parc2.patch(url).send({ price_fcfa: 21000000, ilot: 'Z' })).status, 200);
  assert.equal(Number((await db('lots').where({ id: lots[2].id }).first()).price_fcfa), 21000000);
});

// ─── Point 2. achats:validate ────────────────────────────────────────────────
test('achats:validate : valider une facture d’achat ou une dépense du Parc ; pas de séparation créateur / valideur imposée', async () => {
  const year = new Date().getFullYear();
  await comptable.post(`${ERP}/compta/fiscal-years`).send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` });
  const sup = (await comptable.post(`${ERP}/compta/suppliers`).send({ name: 'Fournisseur audit', kind: 'sous_traitant', expense_account: '621100' })).body;
  const buy = { supplier_id: sup.id, date: `${year}-06-01`, due_date: `${year}-06-30`, label: 'Achat test', expense_account: '621100', amount_ttc: 118000, vat_rate: 18 };
  const acheteur = await roleWith('acheteur_seul', ['compta:read', 'achats:write']);
  const valideur = await roleWith('valideur_achats', ['compta:read', 'achats:write', 'achats:validate']);
  const inv = (await acheteur.post(`${ERP}/compta/purchases`).send(buy)).body;
  assert.ok(inv.id, JSON.stringify(inv));
  assert.equal((await acheteur.post(`${ERP}/compta/purchases/${inv.id}/validate`)).status, 403, 'créer ne vaut pas valider');
  assert.equal((await valideur.post(`${ERP}/compta/purchases/${inv.id}/validate`)).status, 200);
  // Même personne qui crée puis valide : permis (choix du client du 30/10)
  const own = (await valideur.post(`${ERP}/compta/purchases`).send({ ...buy, label: 'Sa propre facture' })).body;
  assert.equal((await valideur.post(`${ERP}/compta/purchases/${own.id}/validate`)).status, 200);
  // Dépenses du Parc : validation et rejet
  assert.equal((await acheteur.post(`${ERP}/parc/costs/999/validate`)).status, 403);
  assert.equal((await acheteur.post(`${ERP}/parc/costs/999/reject`).send({ reason: 'Non conforme' })).status, 403);
  assert.equal((await valideur.post(`${ERP}/parc/costs/999/validate`)).status, 404, 'droit reconnu, dépense inconnue');
  assert.equal((await comptable.post(`${ERP}/parc/costs/999/reject`).send({ reason: 'Non conforme' })).status, 404);
});

// ─── Point 4 / B8. Fiche employé reliée à un compte ──────────────────────────
test('fiche employé : relier un compte demande users:edit, la garde contre l’élévation, jamais son compte ni un super admin', async () => {
  const mkEmp = body => admin.post(`${ERP}/paie/employees`).send({ last_name: 'Fiche', first_name: `Test${Math.random().toString(36).slice(2, 6)}`, job_title: 'Assistant', hire_date: '2025-01-10', base_salary: 100000, department: 'administratif', ...body });
  const emp = (await mkEmp()).body;
  assert.ok(emp.id);
  const idResp = await idOf('resp_exploitation@test.ci');
  const idAdmin = (await db('users').where({ email: 'admin@test.ci' }).first()).id;
  const sansCompte = await roleWith('rh_sans_compte', ['rh:read', 'rh:files']);
  const rhComptes = await roleWith('rh_comptes', [...PERMISSIONS.commercial, 'rh:read', 'rh:files', 'users:edit']);
  const meId = await idOf('rh_comptes@test.ci');
  const patch = (who, user_id) => who.patch(`${ERP}/rh/employees/${emp.id}`).send({ user_id });
  assert.equal((await patch(sansCompte, idA)).status, 403, 'sans users:edit');
  assert.equal((await patch(rhComptes, idResp)).status, 403, 'compte plus privilégié');
  assert.equal((await patch(rhComptes, idAdmin)).status, 403, 'super administrateur');
  assert.equal((await patch(rhComptes, meId)).status, 403, 'son propre compte');
  assert.equal((await patch(rhComptes, idA)).status, 200, 'compte dont les privilèges sont couverts');
  assert.equal((await patch(rhComptes, null)).status, 200, 'détacher');
  assert.equal((await patch(admin, idResp)).status, 200, 'le super administrateur n’est pas limité');
  await patch(admin, null);
  // Les champs sans changement de compte restent permis sans users:edit
  assert.equal((await sansCompte.patch(`${ERP}/rh/employees/${emp.id}`).send({ notes: 'RAS' })).status, 200);
  // Création par la Comptabilité : même règle, et solde de congés repris = conges:adjust
  const paie = await roleWith('paie_fiches', ['paie:read', 'paie:employees', 'paie:salary']);
  const body = { last_name: 'Nouvelle', first_name: 'Fiche', job_title: 'Aide', hire_date: '2025-02-01', base_salary: 90000, department: 'administratif' };
  assert.equal((await paie.post(`${ERP}/paie/employees`).send({ ...body, leave_opening_days: 12 })).status, 403);
  assert.equal((await paie.post(`${ERP}/paie/employees`).send({ ...body, last_name: 'Embauche', user_id: idA })).status, 201, 'embauche : le compte de la nouvelle personne se relie librement');
  const hired = await db('employees').where({ last_name: 'Embauche' }).first();
  assert.equal((await paie.patch(`${ERP}/paie/employees/${hired.id}`).send({ user_id: null })).status, 403, 'changer le compte d’une fiche existante : users:edit');
  assert.equal((await paie.post(`${ERP}/paie/employees`).send(body)).status, 201);
  assert.equal((await admin.post(`${ERP}/paie/employees`).send({ ...body, first_name: 'Reprise', leave_opening_days: 12, leave_opening_date: '2025-02-01' })).status, 201);
  // PUT /users/:id/employee : garde contre l'élévation
  const putLink = (who, uid, employee_id) => who.put(`/api/admin/users/${uid}/employee`).send({ employee_id });
  assert.equal((await putLink(rhComptes, idResp, emp.id)).status, 403, 'compte plus privilégié');
  assert.equal((await putLink(rhComptes, idAdmin, emp.id)).status, 403);
  assert.equal((await putLink(rhComptes, idA, emp.id)).status, 200);
  assert.equal((await putLink(admin, idA, null)).status, 200);
  // Son propre compte (sauf super admin) et détachement d'un compte plus privilégié : refusés
  assert.equal((await putLink(rhComptes, meId, emp.id)).status, 403, 'son propre compte');
  assert.equal((await putLink(rhComptes, meId, null)).status, 403, 'détacher son propre compte');
  assert.equal((await putLink(admin, idResp, emp.id)).status, 200);
  assert.equal((await putLink(rhComptes, idResp, null)).status, 403, 'détacher un compte plus privilégié');
  assert.equal((await putLink(sansCompte, idA, null)).status, 403, 'détacher demande users:edit');
  assert.equal((await putLink(admin, idResp, null)).status, 200);
});

// ─── Point 6. Litiges visant un collègue ─────────────────────────────────────
test('litiges : celui qui vise un employé échappe à la vue « service » et à cet employé', async () => {
  const mk = async (email, name) => {
    const g = await roleWith(email.split('@')[0], ['sav:read']);
    const uid = await idOf(email);
    const e = (await admin.post(`${ERP}/paie/employees`).send({ last_name: name, first_name: 'Agent', job_title: 'Agent', hire_date: '2025-01-10', base_salary: 100000, department: 'administratif', user_id: uid })).body;
    return { agent: g, uid, emp: e };
  };
  const a = await mk('collegue_a@test.ci', 'Alpha'), b = await mk('collegue_b@test.ci', 'Bravo');
  const J = `${ERP}/juridique/litiges`;
  const lit = extra => admin.post(J).send({ origin: 'employe', title: 'Litige test', opponent: 'Partie adverse', department: 'administratif', ...extra });
  const visA = (await lit({ title: 'Visant Alpha', employee_id: a.emp.id })).body;
  const service = (await lit({ title: 'Du service' })).body;
  const owned = (await lit({ title: 'Visant Alpha, suivi par Bravo', employee_id: a.emp.id, owner_id: b.uid })).body;
  assert.ok(visA.id && service.id && owned.id, JSON.stringify(visA));
  const titles = async who => (await who.get(`${J}?status=ouvert`)).body.map(l => l.title).sort();
  assert.deepEqual(await titles(a.agent), ['Du service']);
  assert.deepEqual(await titles(b.agent), ['Du service', 'Visant Alpha, suivi par Bravo'], 'le service ne voit pas ce qui vise un collègue ; le juriste en charge, oui');
  assert.equal((await a.agent.get(`${J}/${visA.id}`)).status, 404);
  assert.equal((await b.agent.get(`${J}/${visA.id}`)).status, 404, 'même service, pas le propriétaire');
  assert.equal((await a.agent.get(`${J}/${owned.id}`)).status, 404, 'l’intéressé ne voit jamais son litige');
  assert.equal((await b.agent.get(`${J}/${owned.id}`)).status, 200);
  assert.equal((await conducteur.get(`${J}/${visA.id}`)).status, 200, 'le Juridique voit tout');
  assert.equal((await conducteur.get(`${J}?status=ouvert`)).body.length >= 3, true);
  // Pastilles : mêmes règles
  assert.equal((await a.agent.get(`${ERP}/juridique/badges`)).body.litigations_mine, 1);
  assert.equal((await b.agent.get(`${ERP}/juridique/badges`)).body.litigations_mine, 2);
});

// ─── Point 8. Courrier du Juridique ──────────────────────────────────────────
test('courrier du Juridique : Juridique, registre du courrier ou membre du service juridique seulement', async () => {
  const C = `${ERP}/juridique/courrier`;
  assert.equal((await sellerA.get(C)).status, 403);
  assert.equal((await conducteur.get(C)).status, 200);
  const registre = await roleWith('registre_courrier', ['courrier:read']);
  assert.equal((await registre.get(C)).status, 200);
  const membre = await roleWith('membre_juridique', ['sav:read']);
  assert.equal((await membre.get(C)).status, 403);
  await admin.post(`${ERP}/paie/employees`).send({ last_name: 'Juriste', first_name: 'Agent', job_title: 'Assistant juridique', hire_date: '2025-01-10', base_salary: 100000, department: 'juridique', user_id: await idOf('membre_juridique@test.ci') });
  assert.equal((await membre.get(C)).status, 200);
});

// ─── Point 11. Borne de pointage ─────────────────────────────────────────────
test('borne : 5 échecs en 15 minutes verrouillent le matricule ; matricule inconnu traité comme un code faux', async () => {
  const presences = require('../src/services/presences');
  presences.resetKioskLocks();
  const emp = (await admin.post(`${ERP}/paie/employees`).send({ last_name: 'Borne', first_name: 'Test', job_title: 'Ouvrier', hire_date: '2025-01-10', base_salary: 100000, department: 'chantier' })).body;
  assert.ok(emp.matricule, JSON.stringify(emp));
  assert.equal((await admin.put(`${ERP}/rh/employees/${emp.id}/pin`).send({ pin: '4321' })).status, 200);
  const kiosk = (matricule, pin) => admin.post(`${ERP}/rh/attendance/kiosk`).send({ matricule, pin });
  for (let i = 0; i < 5; i++) assert.equal((await kiosk(emp.matricule, '0000')).status, 401);
  const res = await kiosk(emp.matricule, '4321');
  assert.equal(res.status, 429, 'verrouillé même avec le bon code');
  assert.match(res.body.error, /Trop d’essais/);
  // Un autre matricule n'est pas touché ; le verrou tombe après la fenêtre
  assert.equal((await kiosk('INCONNU99', '1234')).status, 401);
  const later = Date.now() + 16 * 60 * 1000;
  const ok = await presences.kiosk(db, { matricule: emp.matricule, pin: '4321' }, null, later);
  assert.equal(ok.action, 'arrivee', 'après 15 minutes, le bon code passe');
  // Matricule inconnu : verrouillé comme un autre
  presences.resetKioskLocks();
  for (let i = 0; i < 5; i++) assert.equal((await kiosk('FANTOME1', '1234')).status, 401);
  assert.equal((await kiosk('FANTOME1', '1234')).status, 429);
  presences.resetKioskLocks();
});

// ─── Points 13b et 13c. /rh/meta, chefs de service, organigramme ─────────────
test('lectures RH ouvertes : réglages, chefs de service et organigramme sans données superflues hors rh:read', async () => {
  const RH = `${ERP}/rh`;
  const staff = (await resp.get(`${RH}/meta`)).body;
  assert.ok(staff.settings.overtime_tiers && staff.settings.expense_categories.deplacement.account, 'rh:read : tous les réglages');
  assert.ok(staff.defaults);
  const plain = (await sellerA.get(`${RH}/meta`)).body;
  assert.equal(plain.settings.overtime_tiers, undefined);
  assert.equal(plain.settings.expense_payable_account, undefined);
  assert.equal(plain.settings.expense_categories.deplacement.account, undefined);
  assert.ok(plain.settings.accrual_per_month && plain.settings.expense_categories.deplacement.label && plain.settings.working_days, 'règles utiles à Mon espace conservées');
  assert.equal(plain.defaults, null);
  const settingsOnly = await roleWith('reglages_rh', ['rh:rules']);
  assert.ok((await settingsOnly.get(`${RH}/meta`)).body.settings.overtime_tiers);

  // Chef de service
  const emp = (await admin.post(`${ERP}/paie/employees`).send({ last_name: 'Chef', first_name: 'Service', job_title: 'Chef', hire_date: '2025-01-10', base_salary: 100000, department: 'commercial', user_id: idA })).body;
  assert.equal((await admin.put(`${RH}/department-heads/commercial`).send({ employee_id: emp.id })).status, 200);
  assert.equal((await resp.get(`${RH}/department-heads`)).body.commercial.user_id, idA);
  const heads = (await sellerB.get(`${RH}/department-heads`)).body;
  assert.equal(heads.commercial.employee_id, emp.id);
  assert.equal(heads.commercial.user_id, undefined);

  // Organigramme : le matricule seulement pour rh:read
  const tree = roots => { const out = []; const walk = n => { out.push(n); n.reports.forEach(walk); }; roots.forEach(walk); return out; };
  assert.ok(tree((await resp.get(`${RH}/orgchart`)).body).every(n => n.matricule));
  const plainTree = tree((await sellerB.get(`${RH}/orgchart`)).body);
  assert.ok(plainTree.length > 0 && plainTree.every(n => n.matricule === undefined));
});

// ─── B10. rh:documents ───────────────────────────────────────────────────────
test('pièces du dossier : rh:documents (service RH) ; rh:read seul ne les ouvre plus ; l’employé garde les siennes', async () => {
  const RH = `${ERP}/rh`;
  const owner = await roleWith('salarie_dossier', ['sav:read', 'self:conges']);
  const ownerId = await idOf('salarie_dossier@test.ci');
  const emp = (await admin.post(`${ERP}/paie/employees`).send({ last_name: 'Dossier', first_name: 'Privé', job_title: 'Agent', hire_date: '2025-01-10', base_salary: 100000, department: 'administratif', user_id: ownerId })).body;
  const up = await admin.post(`${RH}/employees/${emp.id}/documents`).field('kind', 'cni').attach('file', Buffer.from('%PDF-1.4 cni'), { filename: 'cni.pdf', contentType: 'application/pdf' });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const doc = up.body;
  const lecteur = await roleWith('rh_lecteur_seul', ['rh:read']);
  const service = await roleWith('rh_service_docs', ['rh:read', 'rh:documents']);
  let file = await lecteur.get(`${RH}/employees/${emp.id}`);
  assert.equal(file.status, 200);
  assert.deepEqual(file.body.documents, [], 'rh:read seul : pas de pièces');
  assert.equal(file.body.documents_access, false);
  assert.equal((await lecteur.get(`${RH}/documents/${doc.id}/file`)).status, 403);
  file = await service.get(`${RH}/employees/${emp.id}`);
  assert.equal(file.body.documents.length, 1);
  assert.equal(file.body.documents_access, true);
  assert.equal((await service.get(`${RH}/documents/${doc.id}/file`)).status, 200);
  // L'employé : ses propres pièces
  assert.equal((await owner.get(`${RH}/documents/${doc.id}/file`)).status, 200);
  assert.equal((await owner.get(`${RH}/employees/${emp.id}`)).body.documents.length, 1);
  assert.equal((await admin.delete(`${RH}/documents/${doc.id}`)).status, 200);
});

// ─── B12. Rendez-vous : statut réservé à appointments:edit ───────────────────
test('rendez-vous : sans appointments:edit, le statut envoyé est ignoré ; programme et lot vérifiés', async () => {
  const planif = await roleWith('planificateur', ['appointments:read', 'appointments:create', 'leads:read', 'leads:create']);
  const me = await idOf('planificateur@test.ci');
  const lead = (await planif.post('/api/admin/leads').send({ name: 'Prospect du planificateur', phone: '0701230123' })).body;
  assert.equal(lead.assigned_to, me);
  let res = await planif.post('/api/admin/appointments').send({ lead_id: lead.id, starts_at: '2027-04-01T10:00:00Z', status: 'effectue' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'demande');
  res = await sellerA.post('/api/admin/appointments').send({ lead_id: leadA.id, starts_at: '2027-04-02T10:00:00Z', status: 'confirme' });
  assert.equal(res.body.status, 'confirme', 'avec appointments:edit, le statut est pris');
  assert.equal((await sellerA.post('/api/admin/appointments').send({ lead_id: leadA.id, starts_at: '2027-04-03T10:00:00Z', project_id: 999999 })).status, 400);
  assert.equal((await sellerA.post('/api/admin/appointments').send({ lead_id: leadA.id, starts_at: '2027-04-03T10:00:00Z', lot_id: 999999 })).status, 400);
});

// ─── B13. Clients dans la liste des prospects ────────────────────────────────
test('GET /leads et /leads.csv : les clients seulement avec clients:read / clients:export', async () => {
  const [cid] = await db('leads').insert({ name: 'Cliente listée', phone: '0709090909', source: 'site', client_code: 'CL-AUD-2', assigned_to: idA });
  const clientId = typeof cid === 'object' ? cid.id : cid;
  const lecteur = await roleWith('lecteur_prospects', ['leads:read', 'leads:all']);
  const ids = async (who, q = '') => ((await who.get(`/api/admin/leads${q}`)).body.rows || []).map(l => l.id);
  assert.ok(!(await ids(lecteur)).includes(clientId), 'sans type : pas de client');
  assert.equal((await lecteur.get('/api/admin/leads?type=clients')).status, 403);
  assert.ok((await ids(lecteur, '?type=prospects')).length > 0);
  assert.ok((await ids(sellerA)).includes(clientId), 'clients:read : les clients sont listés');
  assert.ok((await ids(sellerA, '?type=clients')).includes(clientId));
  const csv = async who => (await who.get('/api/admin/leads.csv')).text;
  assert.ok(!(await csv(lecteur)).includes('Cliente listée'));
  assert.ok((await csv(sellerA)).includes('Cliente listée'));
});

// ─── B14. Parc : pas d'auto-décision ─────────────────────────────────────────
test('réservation de véhicule : un gestionnaire du parc ne décide pas sa propre demande (sauf super admin)', async () => {
  const [veh] = await db('assets').insert({ kind: 'vehicule', code: 'AUD-VEH', name: 'Véhicule audit', status: 'actif', pool: true });
  const vid = typeof veh === 'object' ? veh.id : veh;
  const [r1] = await db('asset_reservations').insert({ requested_by: await idOf('resp_exploitation@test.ci'), start_at: '2027-05-01T08:00', end_at: '2027-05-01T17:00', status: 'demandee', purpose: 'Visite' });
  const resaId = typeof r1 === 'object' ? r1.id : r1;
  const res = await resp.post(`${ERP}/parc/reservations/${resaId}/decide`).send({ status: 'accordee', asset_id: vid });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal((await admin.post(`${ERP}/parc/reservations/${resaId}/decide`).send({ status: 'refusee', note: 'Test' })).status, 200);
});

// ─── B16. Évaluation : pas d'auto-évaluation par ce biais ────────────────────
test('objectifs et entretien : evaluation:objectives et evaluation:reviews ne fixe pas ses propres objectifs ni ne finalise son propre entretien', async () => {
  const RH = `${ERP}/rh`;
  const eval1 = await roleWith('evaluateur', ['rh:read', 'evaluation:objectives', 'evaluation:reviews']);
  const evalId = await idOf('evaluateur@test.ci');
  const mine = (await admin.post(`${ERP}/paie/employees`).send({ last_name: 'Evalue', first_name: 'Moi', job_title: 'Agent', hire_date: '2025-01-10', base_salary: 100000, department: 'administratif', user_id: evalId })).body;
  const other = (await admin.post(`${ERP}/paie/employees`).send({ last_name: 'Evalue', first_name: 'Autre', job_title: 'Agent', hire_date: '2025-01-10', base_salary: 100000, department: 'administratif' })).body;
  const year = new Date().getFullYear();
  const objective = { year, title: 'Réduire les retards', period: 'annee', weight: 1 };
  assert.equal((await eval1.post(`${RH}/employees/${mine.id}/objectives`).send(objective)).status, 403);
  assert.equal((await eval1.put(`${RH}/employees/${mine.id}/reviews/${year}`).send({ rating: 5, finalize: true })).status, 403);
  assert.equal((await eval1.post(`${RH}/employees/${other.id}/objectives`).send(objective)).status, 201);
  assert.equal((await eval1.put(`${RH}/employees/${other.id}/reviews/${year}`).send({ rating: 4, finalize: true })).status, 200);
  assert.equal((await admin.put(`${RH}/employees/${mine.id}/reviews/${year}`).send({ rating: 3 })).status, 200, 'le super administrateur n’est pas limité');
});

// ─── Revue de sécurité : portée SAV indépendante de leads:all ────────────────
test('SAV : sav:all sans leads:all voit tout le SAV et y dépose des photos ; leads:all sans sav:all ne voit que ses clients', async () => {
  const tout = await roleWith('sav_tout_sans_leads', ['sav:read', 'sav:all', 'sav:edit', 'sav:status', 'sav:comment']);
  const ids = rows => rows.map(x => x.id).sort();
  assert.deepEqual(ids((await tout.get(`${ERP}/sav/sales`)).body), [saleA.id, saleB.id].sort(), 'tous les dossiers');
  assert.equal((await tout.get(`${ERP}/sav/sales/${saleB.id}`)).status, 200);
  const photo = (who, leadId, name) => who.post(`${ERP}/sav/files`).field('lead_id', String(leadId)).attach('files', PNG, { filename: name, contentType: 'image/png' });
  assert.equal((await photo(tout, leadB.id, 'tout-b.png')).status, 201, 'dépôt chez n’importe quel client du SAV');

  // leads:all sans sav:all : /sales cohérent avec /sales/:id (ses clients seulement)
  const equipe = await roleWith('leads_all_sans_sav_all', ['sav:read', 'sav:edit', 'sav:status', 'sav:comment', 'leads:all']);
  assert.deepEqual((await equipe.get(`${ERP}/sav/sales`)).body, [], 'aucun client attribué');
  assert.equal((await equipe.get(`${ERP}/sav/sales/${saleB.id}`)).status, 404);
  assert.equal((await photo(equipe, leadB.id, 'equipe-b.png')).status, 404, 'leads:all ne donne pas la portée SAV');

  // Technicien sans sav:all : le client de la réclamation qui lui est confiée, et lui seul
  const tech = await roleWith('technicien_sav', ['sav:read', 'sav:edit', 'sav:status', 'sav:comment']);
  const techId = await idOf('technicien_sav@test.ci');
  assert.equal((await photo(tech, leadB.id, 'tech-avant.png')).status, 404, 'pas encore confié');
  const t = (await admin.post(`${ERP}/sav/tickets`).send({ sale_id: saleB.id, category: 'autre', title: 'Confiée au technicien' })).body;
  assert.equal((await admin.patch(`${ERP}/sav/tickets/${t.id}`).send({ assigned_to: techId })).status, 200);
  assert.equal((await photo(tech, leadB.id, 'tech-b.png')).status, 201, 'client de sa réclamation attribuée');
  assert.equal((await photo(tech, leadA.id, 'tech-a.png')).status, 404, 'pas un autre client');
  assert.deepEqual(ids((await tech.get(`${ERP}/sav/sales`)).body), [saleB.id], '/sales : le dossier de sa réclamation, cohérent avec /sales/:id');
  assert.equal((await tech.get(`${ERP}/sav/sales/${saleB.id}`)).status, 200);
  assert.equal((await tech.get(`${ERP}/sav/sales/${saleA.id}`)).status, 404);
});

// ─── Revue : assertSeller seulement si l'assigné change ; sellers() selon les privilèges individuels ───
test('attribution : un assigné inchangé n’est pas revérifié ; la liste des commerciaux suit les privilèges individuels', async () => {
  const [pid] = await db('leads').insert({ name: 'Suivi par B', phone: '0712121212', source: 'site', assigned_to: idB });
  const lid = typeof pid === 'object' ? pid.id : pid;
  await db('users').where({ id: idB }).update({ active: false });
  assert.equal((await admin.patch(`/api/admin/leads/${lid}`).send({ name: 'Suivi par B (renommé)', assigned_to: idB })).status, 200, 'assigné inchangé : pas de blocage');
  assert.equal((await admin.patch(`${ERP}/commercial/leads/${lid}`).send({ phone: '0712121213', assigned_to: idB })).status, 200);
  const [ap] = await db('appointments').insert({ lead_id: lid, assigned_to: idB, starts_at: new Date('2027-06-01T10:00:00Z'), source: 'admin' });
  const apId = typeof ap === 'object' ? ap.id : ap;
  assert.equal((await admin.patch(`/api/admin/appointments/${apId}`).send({ notes: 'Note', assigned_to: idB })).status, 200);
  assert.equal((await admin.patch(`/api/admin/leads/${lid}`).send({ assigned_to: idA })).status, 200, 'changer vers un commercial actif');
  await db('users').where({ id: idB }).update({ active: true });

  // Privilèges individuels : accordé ajoute, retiré enlève
  const cm = require('../src/services/commercial');
  const idCompta = await idOf('comptable@test.ci');
  assert.ok(!(await cm.sellers(db)).some(s => s.id === idCompta));
  await db('user_permissions').insert({ user_id: idCompta, permission: 'leads:create', granted: true });
  assert.ok((await cm.sellers(db)).some(s => s.id === idCompta), 'privilège individuel accordé');
  await db('user_permissions').insert([{ user_id: idB, permission: 'leads:create', granted: false }, { user_id: idB, permission: 'leads:edit', granted: false }]);
  assert.ok(!(await cm.sellers(db)).some(s => s.id === idB), 'privilèges retirés : plus commercial');
  assert.ok((await cm.sellers(db)).some(s => s.id === idA));
  await db('user_permissions').where({ user_id: idB }).del();
  await db('user_permissions').where({ user_id: idCompta }).del();
});

// ─── Revue : plafond des demandes de reprise = demandes pour des fiches de collègues seulement ───
test('plafond des demandes en attente : ne limite pas un commercial qui cède ses propres prospects', async () => {
  const reason = 'Le client m’a appelé directement';
  const pending = async () => Number((await db('lead_transfer_requests').where({ requested_by: idA, status: 'en_attente' }).count({ n: '*' }))[0].n);
  while (await pending() < 5) {
    const l = (await sellerB.post('/api/admin/leads').send({ name: `Fiche de B plafond ${Date.now()}`, phone: `0713${Math.floor(Math.random() * 1e6)}`.slice(0, 10) })).body;
    assert.equal((await sellerA.post(`/api/admin/leads/${l.id}/transfert`).send({ reason })).status, 201);
  }
  const other = (await sellerB.post('/api/admin/leads').send({ name: 'Fiche de B de trop', phone: '0714141414' })).body;
  assert.equal((await sellerA.post(`/api/admin/leads/${other.id}/transfert`).send({ reason })).status, 429, 'plafond atteint pour reprendre');
  for (let i = 0; i < 2; i++) {
    const own = (await sellerA.post('/api/admin/leads').send({ name: `Fiche de A cédée ${i}`, phone: `07151515${i}0` })).body;
    assert.equal((await sellerA.post(`/api/admin/leads/${own.id}/transfert`).send({ to_user_id: idB, reason: 'Je cède ce prospect' })).status, 201, 'ses propres prospects : pas de plafond');
  }
});

// ─── Revue : rendez-vous modifié, programme et lot vérifiés ──────────────────
test('PATCH rendez-vous : programme et lot vérifiés comme à la création', async () => {
  const appt = (await sellerA.post('/api/admin/appointments').send({ lead_id: leadA.id, starts_at: '2027-07-01T10:00:00Z' })).body;
  assert.equal((await sellerA.patch(`/api/admin/appointments/${appt.id}`).send({ project_id: 999999 })).status, 400);
  assert.equal((await sellerA.patch(`/api/admin/appointments/${appt.id}`).send({ lot_id: 999999 })).status, 400);
  assert.equal((await sellerA.patch(`/api/admin/appointments/${appt.id}`).send({ project_id: project.id, lot_id: lots[0].id })).status, 200);
});
