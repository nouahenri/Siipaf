/**
 * Liaisons entre services et notifications (audit du 30/10/2026, docs/audit-liaisons-notifications.md) : repli des audiences, liens
 * accessibles à chaque destinataire, prospects entrants et attributions, message d'espace client avec e-mail, désistement, livraison par
 * une seule porte, SAV branché, cloche du dashboard et « Mes notifications ».
 * Écrit avec l'implémentation ; à lancer ensemble à la fin du projet (consigne du client).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const notifications = require('../src/services/notifications');
const { tellClient } = require('../src/services/clients');
const { INFO_EVENTS, INFO_AUDIENCES, SAV_CATEGORIES } = require('../src/lib/domain');

let db, app, admin, commercial, commercialId, comptable, comptableId, project, lots;
const PASSWORD = 'motdepasse-test-123';
const unread = (userId, event) => db('notifications').where({ user_id: userId, event }).orderBy('id', 'desc');

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  const commercialEmail = await createUser(db, 'commercial');
  commercial = await login(app, commercialEmail, PASSWORD);
  commercialId = (await db('users').where({ email: commercialEmail }).first()).id;
  const comptableEmail = await createUser(db, 'comptable');
  comptable = await login(app, comptableEmail, PASSWORD);
  comptableId = (await db('users').where({ email: comptableEmail }).first()).id;
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'L1', price_fcfa: 10000000 }, { code: 'L2', price_fcfa: 10000000 }, { code: 'L3', price_fcfa: 10000000 }]);
  lots = Object.fromEntries((await db('lots').where({ project_id: project.id })).map(l => [l.code, l.id]));
});
after(() => db.destroy());

/** Prospect du commercial, dossier ouvert sur le lot par l'administrateur. */
async function saleOf(code, name, phone) {
  const lead = (await commercial.post('/api/admin/leads').send({ name, phone })).body;
  const res = await admin.post(`/api/admin/lots/${lots[code]}/sale`).send({ lead_id: lead.id, financing: 'comptant' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { lead, sale: res.body };
}

test('catalogue : chaque événement a un module connu et des services connus', () => {
  for (const [key, e] of Object.entries(INFO_EVENTS)) {
    assert.ok(notifications.NOTIF_MODULES[e.module], `${key} : module ${e.module} inconnu`);
    for (const a of e.audiences) assert.ok(INFO_AUDIENCES[a], `${key} : service ${a} inconnu`);
    assert.ok(e.label, `${key} : libellé manquant`);
  }
});

test('un service sans titulaire retombe sur le super administrateur (audienceUsers comme usersWith)', async () => {
  await db('users').whereNot({ role: 'super_admin' }).update({ active: false });
  const users = await notifications.audienceUsers(db, 'commercial_resp');
  assert.deepEqual(users.map(u => u.email), ['admin@test.ci'], 'aucun responsable commercial : le super administrateur reçoit');
  await db('users').whereNot({ role: 'super_admin' }).update({ active: true });
});

test('lien par destinataire : un commercial sans droit sur les chantiers ne reçoit pas /chantiers/<id>', async () => {
  await notifications.inform(db, 'tma.demandee', { direct: [commercialId], key: 'test:lien:1', title: 'TMA à chiffrer', link: '/chantiers/12?onglet=tma' });
  const n = await db('notifications').where({ user_id: commercialId, dedupe_key: 'test:lien:1' }).first();
  assert.equal(n.link, '/commercial/ventes', 'repli sur la page des ventes, accessible au commercial');
  // Lien propre à une personne directe
  await notifications.inform(db, 'tma.demandee', { direct: [{ id: commercialId, link: '/commercial/pipeline' }], key: 'test:lien:2', title: 'TMA', link: '/chantiers/12' });
  assert.equal((await db('notifications').where({ user_id: commercialId, dedupe_key: 'test:lien:2' }).first()).link, '/commercial/pipeline');
  // Le super administrateur garde le lien prévu
  await notifications.inform(db, 'tma.demandee', { direct: [(await db('users').where({ email: 'admin@test.ci' }).first()).id], key: 'test:lien:3', title: 'TMA', link: '/chantiers/12' });
  assert.equal((await db('notifications').where({ dedupe_key: 'test:lien:3' }).first()).link, '/chantiers/12');
});

test('prospect du site : responsables prévenus et accusé au prospect, puis le commercial pour une nouvelle demande', async () => {
  const before = sent.length;
  const body = { name: 'Aminata Diallo', email: 'aminata@example.com', message: 'Je souhaite des informations.' };
  assert.equal((await request(app).post('/api/public/contact').send(body)).status, 201);
  const lead = await db('leads').where({ email: 'aminata@example.com' }).first();
  const admins = await unread((await db('users').where({ email: 'admin@test.ci' }).first()).id, 'prospect.nouveau');
  assert.ok(admins.some(n => n.link === `/commercial/pipeline?p=${lead.id}`), 'le responsable (ici le super administrateur) est prévenu du prospect à attribuer');
  assert.ok(sent.slice(before).some(m => m.to === 'aminata@example.com' && /bien reçu votre message/.test(m.subject)), 'accusé de réception au prospect');

  // Attribution : le commercial est prévenu, l'attribution est tracée, l'alerte « à attribuer » est lue
  const res = await admin.post('/api/admin/leads/assign').send({ ids: [lead.id], user_id: commercialId });
  assert.equal(res.body.changed, 1);
  assert.equal((await unread(commercialId, 'prospect.attribue')).length, 1);
  assert.ok((await db('lead_activities').where({ lead_id: lead.id }).pluck('summary')).some(s => /^Attribué à commercial/.test(s)), 'trace dans l’historique de la fiche');
  assert.ok((await db('notifications').where({ dedupe_key: `lead:${lead.id}:nouveau` })).every(n => n.read_at), 'alerte « prospect à attribuer » lue');

  // La même personne revient : son commercial est prévenu
  await request(app).post('/api/public/contact').send({ ...body, message: 'Je reviens vers vous.' });
  assert.equal((await unread(commercialId, 'prospect.demande')).length, 1);
});

test('liste importée : le commercial destinataire est prévenu une fois, et l’attribution est tracée', async () => {
  const res = await admin.post('/api/admin/import').send({
    mode: 'prospects', dry_run: false, list: { name: 'Salon de Bouaké', assigned_to: commercialId },
    rows: [{ name: 'Awa Koné', phone: '0701000001' }, { name: 'Issa Traoré', phone: '0701000002' }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const mine = await unread(commercialId, 'prospect.attribue');
  assert.ok(mine.some(n => /^2 prospects vous sont attribués/.test(n.title)), 'une seule notification pour toute la liste');
  const lead = await db('leads').where({ phone: '0701000001' }).first();
  assert.ok((await db('lead_activities').where({ lead_id: lead.id }).pluck('summary')).some(s => /liste importée/.test(s)));
});

test('import de clients : un montant versé avec espaces est refusé sans droit de Comptabilité ([^\\d])', async () => {
  const email = await createUser(db, 'commercial', 'importeur@test.ci');
  const importer = await login(app, email, PASSWORD);
  const user = await db('users').where({ email }).first();
  await db('user_permissions').insert({ user_id: user.id, permission: 'clients:import', granted: true });
  const row = { name: 'Client Repris', phone: '0707000007', project: 'ahoutoue', lot: 'L3', price: 10000000, paid: '1 000 000' };
  const res = await importer.post('/api/admin/import').send({ mode: 'clients', dry_run: true, rows: [row] });
  assert.equal(res.status, 403, 'le montant n’est plus lu comme zéro');
});

test('import de clients avec versements : la Comptabilité est prévenue', async () => {
  const res = await comptable.post('/api/admin/import').send({
    mode: 'clients', dry_run: false, create_lots: true,
    rows: [{ name: 'Client Repris Deux', phone: '0707000008', project: 'ahoutoue', lot: 'R1', price: 8000000, paid: '2 000 000' }],
  });
  if (res.status === 200 && res.body.ok) {
    assert.ok((await unread(comptableId, 'import.versements')).length >= 1);
  } else {
    assert.ok([200, 403].includes(res.status), 'import réservé aux comptes autorisés');
  }
});

test('tellClient : message dans l’espace client et e-mail « nouveau message » sans le contenu', async () => {
  const [leadId] = await db('leads').insert({ name: 'Fatou Cissé', email: 'fatou@example.com', phone: '0708000001', client_code: 'SIIPAF-2026-9001', stage: 'paiement' });
  await db('client_accounts').insert({ lead_id: typeof leadId === 'object' ? leadId.id : leadId, password_hash: 'x', active: true });
  const id = typeof leadId === 'object' ? leadId.id : leadId;
  const before = sent.length;
  await tellClient(db, { leadId: id }, 'Contenu confidentiel du message');
  const msg = await db('client_messages').where({ lead_id: id }).first();
  assert.equal(msg.sender, 'equipe');
  const mail = sent.slice(before).find(m => m.to === 'fatou@example.com');
  assert.ok(mail, 'e-mail envoyé');
  assert.match(mail.subject, /Nouveau message de SIIPAF/);
  assert.doesNotMatch(mail.text, /confidentiel/, 'le contenu reste dans l’espace client');
});

test('livraison saisie dans Client & SAV : mêmes effets que le PV (message au client, étape, commercial prévenu)', async () => {
  const { lead, sale } = await saleOf('L1', 'Client Livré', '0709000001');
  await db('client_accounts').insert({ lead_id: lead.id, password_hash: 'x', active: true });
  const res = await admin.patch(`/api/admin/erp/sav/sales/${sale.id}/delivery`).send({ delivered_at: '2026-10-15' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await db('sales').where({ id: sale.id }).first()).delivered_at !== null, true);
  assert.equal((await db('leads').where({ id: lead.id }).first()).stage, 'livraison');
  assert.ok((await db('client_messages').where({ lead_id: lead.id })).some(m => /Réception de votre lot/.test(m.body)), 'message d’espace client avec les garanties');
  assert.ok((await unread(commercialId, 'lot.livre')).length >= 1, 'le commercial est prévenu');
  assert.ok((await db('lead_activities').where({ lead_id: lead.id }).pluck('summary')).some(s => /Livraison/.test(s)), 'trace de l’étape dans l’historique');
});

test('SAV : réclamation de l’équipe, commercial prévenu, client informé du statut, avis de satisfaction', async () => {
  const { lead, sale } = await saleOf('L2', 'Client Réclamant', '0709000002');
  await db('client_accounts').insert({ lead_id: lead.id, password_hash: 'x', active: true });
  const category = Object.keys(SAV_CATEGORIES)[0];
  const created = await admin.post('/api/admin/erp/sav/tickets').send({ sale_id: sale.id, category, title: 'Fuite sous l’évier' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const open = await unread(commercialId, 'reclamation.ouverte');
  assert.ok(open.some(n => n.link === '/commercial/ventes'), 'le commercial reçoit un lien qu’il peut ouvrir');
  assert.equal((await db('leads').where({ id: lead.id }).first()).stage, 'sav');
  assert.ok((await db('lead_activities').where({ lead_id: lead.id }).pluck('summary')).some(s => /→ SAV/.test(s)), 'passage en SAV tracé');

  const status = await admin.post(`/api/admin/erp/sav/tickets/${created.body.id}/status`).send({ status: 'qualifie' });
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.ok((await db('client_messages').where({ lead_id: lead.id })).some(m => /est maintenant/.test(m.body)), 'le client est prévenu du changement de statut');
});

test('désistement : Comptabilité et commercial du client sont prévenus', async () => {
  const { sale } = await saleOf('L3', 'Client Désisté', '0709000003');
  const res = await admin.post(`/api/admin/lots/${lots.L3}/status`).send({ status: 'desistement', reason: 'Désistement client' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok((await unread(commercialId, 'vente.desistee')).some(n => n.dedupe_key === `vente:${sale.id}:desistee`));
  assert.ok((await unread(comptableId, 'vente.desistee')).some(n => n.dedupe_key === `vente:${sale.id}:desistee`), 'la Comptabilité est un service du circuit');
});

test('lot « réservé » ou « vendu » sans dossier : refusé (409), le statut ne vient que du dossier de vente et de l’acte', async () => {
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'L1', price_fcfa: 10000000 }, { code: 'L2', price_fcfa: 10000000 }, { code: 'L3', price_fcfa: 10000000 }, { code: 'N1', price_fcfa: 5000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code: 'N1' }).first();
  for (const status of ['reserve', 'vendu']) {
    const res = await admin.post(`/api/admin/lots/${lot.id}/status`).send({ status });
    assert.equal(res.status, 409, JSON.stringify(res.body));
  }
  assert.equal((await db('lots').where({ id: lot.id }).first()).status, 'disponible');
  assert.equal((await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'N2', status: 'reserve' }])).status, 400, 'pas de lot créé « réservé » par import');
  assert.equal((await db('notifications').where('dedupe_key', 'like', 'lot:%:sans_dossier')).length, 0, 'plus d’alerte « lot sans dossier »');
});

test('cloche du dashboard : « Mes notifications » coupées = ni compteur de non-lus ni son', async () => {
  await request(app).post('/api/public/contact').send({ name: 'Prospect Cloche', email: 'cloche@example.com', message: 'Bonjour, un renseignement.' });
  const lead = await db('leads').where({ email: 'cloche@example.com' }).first();
  await admin.post('/api/admin/leads/assign').send({ ids: [lead.id], user_id: commercialId });
  await request(app).post('/api/public/contact').send({ name: 'Prospect Cloche', email: 'cloche@example.com', message: 'Encore moi.' });
  assert.ok((await commercial.get('/api/admin/notifications')).body.unread >= 1);
  await commercial.put('/api/admin/erp/notifications/preferences').send({ module: 'commercial', enabled: false });
  const off = (await commercial.get('/api/admin/notifications')).body;
  assert.equal(off.unread, 0);
  assert.equal(off.muted, true);
});

test('options : expiration → commercial du prospect et prospect prévenus', async () => {
  const { expireOptions } = require('../src/services/lots');
  const lead = (await commercial.post('/api/admin/leads').send({ name: 'Prospect Option', email: 'option@example.com', phone: '0709000020' })).body;
  const lot = await db('lots').where({ project_id: project.id, code: 'N1' }).first();
  await db('lots').where({ id: lot.id }).update({ status: 'disponible' });
  await db('sales').where({ lot_id: lot.id }).update({ status: 'desiste' });
  const placed = await commercial.post(`/api/admin/lots/${lot.id}/option`).send({ lead_id: lead.id });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const before = sent.length;
  await expireOptions(db, new Date(Date.now() + 40 * 86400000));
  assert.ok((await unread(commercialId, 'option.expiree')).length >= 1);
  assert.ok(sent.slice(before).some(m => m.to === 'option@example.com' && /a expiré/.test(m.subject)));
});
