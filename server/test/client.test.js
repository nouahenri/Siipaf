const fs = require('fs');
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser, request } = require('./helpers');
const { buildSchedule, allocatePayments } = require('../src/lib/domain');
const { sent } = require('../src/lib/mailer');
const { uploadsDir } = require('../src/config');

let db, app, admin, project, lotA, lotB, saleA, saleB, leadA, leadB, docFile;
const passwords = {};

async function clientLogin(code, password) {
  const agent = request.agent(app);
  const res = await agent.post('/api/client/login').send({ code, password });
  return { agent, res };
}

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([
    { code: 'C1', price_fcfa: 23212000 }, { code: 'C2', price_fcfa: 18256000 }, { code: 'C3', price_fcfa: 18256000 },
  ]);
  const lots = await db('lots').where({ project_id: project.id }).whereIn('code', ['C1', 'C2', 'C3']).orderBy('code');
  await db('lots').where({ id: lots[0].id }).update({ ilot: '12' });
  await db('lots').where({ id: lots[1].id }).update({ ilot: '14' });
  [lotA, lotB] = lots;
  docFile = `test-client-${process.pid}.pdf`;
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, docFile), '%PDF-1.4 contrat de test');
});
after(async () => {
  fs.rmSync(path.join(uploadsDir, docFile), { force: true });
  await db.destroy();
});

test('échéancier type : apport 30 % + 36 mensualités, diaspora, comptant, crédit', () => {
  const apport = buildSchedule({ price_fcfa: 23212000, financing: 'apport', start_date: '2026-01-31' });
  assert.equal(apport.length, 37);
  assert.equal(apport[0].amount_fcfa, 6963600);
  assert.equal(apport[1].due_date, '2026-02-28', 'fin de mois respectée');
  assert.equal(apport[36].due_date, '2029-01-31');
  assert.equal(apport.reduce((s, l) => s + l.amount_fcfa, 0), 23212000, 'la somme tombe juste');

  const diaspora = buildSchedule({ price_fcfa: 18256000, financing: 'diaspora', start_date: '2026-10-19' });
  assert.equal(diaspora.length, 36);
  assert.equal(diaspora[0].kind, 'mensualite');
  assert.equal(diaspora[0].due_date, '2026-10-19', 'première mensualité à la signature');
  assert.equal(diaspora.reduce((s, l) => s + l.amount_fcfa, 0), 18256000);

  assert.deepEqual(buildSchedule({ price_fcfa: 1000, financing: 'comptant', start_date: '2026-10-19' }).map(l => [l.kind, l.amount_fcfa]), [['solde', 1000]]);
  assert.deepEqual(buildSchedule({ price_fcfa: 1000, financing: 'credit', start_date: '2026-10-19' }).map(l => l.amount_fcfa), [300, 700]);
  assert.deepEqual(buildSchedule({ price_fcfa: 1000, financing: null, start_date: '2026-10-19' }), []);
});

test('imputation des versements : payée, en retard, partielle, à venir', () => {
  const lines = buildSchedule({ price_fcfa: 23212000, financing: 'apport', start_date: '2026-01-31' });
  const late = allocatePayments(lines, 7000000, '2026-04-15');
  assert.deepEqual(late.lines.slice(0, 4).map(l => l.status), ['payee', 'en_retard', 'en_retard', 'a_venir']);
  assert.equal(late.overdue_count, 2);
  assert.equal(late.overdue_fcfa, 414944 + 451344);
  assert.equal(late.next_due.seq, 2);
  const partial = allocatePayments(lines, 7000000, '2026-02-01');
  assert.equal(partial.lines[1].status, 'partielle');
  assert.equal(allocatePayments(lines, 23212000).next_due, null, 'tout est payé');
});

test("ouvrir un dossier génère l'échéancier ; le comptable le régénère ou le saisit", async () => {
  let res = await admin.post(`/api/admin/lots/${lotA.id}/sale`).send({ name: 'Awa Koné', email: 'awa@example.com', phone: '+33 6 11 22 33 44', financing: 'apport', reserved_at: '2026-01-31' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  saleA = res.body;
  leadA = res.body.lead;
  assert.equal(res.body.schedule.lines.length, 37);
  assert.equal(res.body.schedule.financing_label, 'Apport initial 30 % + 36 mensualités');

  const comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  res = await comptable.put(`/api/admin/sales/${saleA.id}/schedule`).send([
    { kind: 'apport', label: 'Apport', due_date: '2026-01-31', amount_fcfa: 10000000 },
    { kind: 'solde', label: 'Solde', due_date: '2026-06-30', amount_fcfa: 1 },
  ]);
  assert.equal(res.status, 400, 'la somme doit égaler le prix');
  res = await comptable.post(`/api/admin/sales/${saleA.id}/schedule/generate`).send({ months: 24 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.schedule.lines.length, 25);

  const commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  assert.equal((await commercial.post(`/api/admin/sales/${saleA.id}/schedule/generate`).send({})).status, 403);

  // Changer le financement recalcule l'échéancier type
  res = await admin.patch(`/api/admin/sales/${saleA.id}`).send({ financing: 'apport' });
  assert.equal(res.body.schedule.lines.length, 37);

  // Versements : l'apport et une mensualité
  await comptable.post(`/api/admin/sales/${saleA.id}/payments`).send({ amount_fcfa: 6963600, paid_at: '2026-01-31', method: 'virement', reference: 'VIR-1' });
  await comptable.post(`/api/admin/sales/${saleA.id}/payments`).send({ amount_fcfa: 451344, paid_at: '2026-02-27', method: 'mobile_money' });

  res = await admin.post(`/api/admin/lots/${lotB.id}/sale`).send({ name: 'Yao Brou', phone: '+225 07 00 00 00 02', financing: 'diaspora' });
  saleB = res.body;
  leadB = res.body.lead;
});

test("accès client : mot de passe provisoire, envoi par e-mail, changement obligatoire", async () => {
  const prospect = await admin.post('/api/admin/leads').send({ name: 'Sans dossier', phone: '0700000099' });
  assert.equal((await admin.post(`/api/admin/leads/${prospect.body.id}/client-access`).send({})).status, 409, 'pas de code client');

  const before = sent.length;
  let res = await admin.post(`/api/admin/leads/${leadA.id}/client-access`).send({});
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.temporary_password.length >= 10);
  assert.equal(res.body.emailed, true);
  assert.match(sent[before].text, new RegExp(leadA.client_code));
  passwords.a = res.body.temporary_password;
  passwords.b = (await admin.post(`/api/admin/leads/${leadB.id}/client-access`).send({})).body.temporary_password;

  assert.equal((await clientLogin(leadA.client_code, 'mauvais-mot-de-passe')).res.status, 401);
  const { agent, res: ok } = await clientLogin(leadA.client_code.toLowerCase(), passwords.a);
  assert.equal(ok.status, 200, 'code client insensible à la casse');
  assert.equal(ok.body.client.must_change_password, true);
  res = await agent.get('/api/client/dossiers');
  assert.equal(res.status, 403);
  assert.equal(res.body.details.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await agent.post('/api/client/password').send({ current: passwords.a, next: 'court' })).status, 400);
  res = await agent.post('/api/client/password').send({ current: passwords.a, next: 'MonNouveauMotDePasse!' });
  assert.equal(res.status, 200);
  passwords.a = 'MonNouveauMotDePasse!';
  assert.equal((await agent.get('/api/client/dossiers')).status, 200);

  const b = await clientLogin(leadB.client_code, passwords.b);
  await b.agent.post('/api/client/password').send({ current: passwords.b, next: 'MotDePasseDeYao-2026' });
  passwords.b = 'MotDePasseDeYao-2026';
});

test('dossier client : bien, situation financière, retards, reçus, documents visibles seulement', async () => {
  const [media] = await db('media').insert({ filename: docFile, original_name: 'contrat.pdf', mime: 'application/pdf', size: 10 });
  const docs = await db('sale_documents').where({ sale_id: saleA.id }).orderBy('sort');
  await db('sale_documents').where({ id: docs[0].id }).update({ media_id: media, status: 'signe' });
  await db('sale_documents').where({ id: docs[1].id }).update({ media_id: media, visible_client: false });

  const { agent } = await clientLogin(leadA.client_code, passwords.a);
  let res = await agent.get('/api/client/dossiers');
  assert.equal(res.body.length, 1);
  const summary = res.body[0];
  assert.equal(summary.property.lot_code, 'C1');
  assert.equal(summary.property.project.name, project.name);
  assert.equal(summary.paid_fcfa, 6963600 + 451344);
  assert.ok(summary.overdue_count > 0, 'les mensualités échues depuis mars 2026 sont en retard');

  res = await agent.get(`/api/client/dossiers/${saleA.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.schedule[0].status, 'payee');
  assert.equal(res.body.schedule[1].status, 'payee');
  assert.equal(res.body.schedule[2].status, 'en_retard');
  assert.match(res.body.payments[0].receipt_number, /^REC-2026-\d{5}$/);
  assert.equal(res.body.payments[0].recorded_by, undefined, 'rien d’interne');
  assert.equal(res.body.notes, undefined);
  assert.equal(res.body.documents.length, 5, 'le document masqué n’apparaît pas');
  const contrat = res.body.documents.find(d => d.id === docs[0].id);
  assert.equal(contrat.status, 'signe');

  res = await agent.get(contrat.download_url);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-disposition'], /attachment/);
  assert.equal((await agent.get(`/api/client/documents/${docs[1].id}/fichier`)).status, 404, 'document masqué');

  // Une pièce juridique n'est jamais publique par son adresse /uploads
  assert.equal((await request(app).get(`/uploads/${docFile}`)).status, 404, 'visiteur anonyme');
  assert.equal((await agent.get(`/uploads/${docFile}`)).status, 404, 'session client');
  const legal = await admin.get(`/uploads/${docFile}`);
  assert.equal(legal.status, 200, 'équipe autorisée');
  assert.match(legal.headers['cache-control'], /no-store/);
  const editeur = await login(app, await createUser(db, 'editeur', 'editeur-docs@test.ci'), 'motdepasse-test-123');
  assert.equal((await editeur.get(`/uploads/${docFile}`)).status, 404, 'rôle sans accès aux ventes');
});

test("cloisonnement : un client ne voit jamais le dossier d'un autre, ni l'admin", async () => {
  const { agent: yao } = await clientLogin(leadB.client_code, passwords.b);
  assert.equal((await yao.get(`/api/client/dossiers/${saleA.id}`)).status, 404);
  assert.equal((await yao.get(`/api/client/dossiers/${saleA.id}/chantier`)).status, 404);
  const doc = await db('sale_documents').where({ sale_id: saleA.id }).whereNotNull('media_id').first();
  assert.equal((await yao.get(`/api/client/documents/${doc.id}/fichier`)).status, 404);
  assert.equal((await yao.post('/api/client/messages').send({ body: 'test', sale_id: saleA.id })).status, 404);

  // Les sessions client et admin sont étanches
  assert.equal((await yao.get('/api/admin/lots')).status, 401);
  assert.equal((await admin.get('/api/client/dossiers')).status, 401);
  const cookie = (await clientLogin(leadB.client_code, passwords.b)).res.headers['set-cookie'][0];
  const token = cookie.split(';')[0].split('=')[1];
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status, 401);
  assert.equal((await request(app).get('/api/client/dossiers')).status, 401);
});

test("journal de chantier : projet, îlot et lot ; points masqués exclus", async () => {
  const juriste = await login(app, await createUser(db, 'conducteur_travaux', 'chantier@test.ci'), 'motdepasse-test-123');
  const [photo] = await db('media').insert({ filename: 'chantier.jpg', mime: 'image/jpeg', size: 10 });
  const post = body => juriste.post(`/api/admin/projects/${project.id}/site-updates`).send(body);
  let res = await post({ stage: 'vrd', progress_pct: 20, title: 'Voirie principale', media: [photo], published_at: '2026-09-01' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await post({ stage: 'fondations', progress_pct: 35, title: 'Fondations îlot 12', ilot: '12', published_at: '2026-09-15' });
  await post({ stage: 'fondations', progress_pct: 30, title: 'Fondations îlot 14', ilot: '14', published_at: '2026-09-16' });
  await post({ stage: 'gros_oeuvre', progress_pct: 45, title: 'Élévation du lot C1', lot_id: lotA.id, published_at: '2026-10-01' });
  await post({ stage: 'gros_oeuvre', progress_pct: 50, title: 'Note interne', lot_id: lotA.id, visible_client: false, published_at: '2026-10-05' });
  assert.equal((await post({ stage: 'vrd', progress_pct: 10, title: 'Mauvais lot', lot_id: 999999 })).status, 400);
  assert.equal((await post({ stage: 'vrd', progress_pct: 10, title: 'Média absent', media: [999999] })).status, 400);

  const commercial = await login(app, 'commercial@test.ci', 'motdepasse-test-123');
  assert.equal((await commercial.post(`/api/admin/projects/${project.id}/site-updates`).send({ stage: 'vrd', progress_pct: 1, title: 'Non' })).status, 403);

  const { agent } = await clientLogin(leadA.client_code, passwords.a);
  res = await agent.get(`/api/client/dossiers/${saleA.id}/chantier`);
  assert.deepEqual(res.body.updates.map(u => u.title), ['Élévation du lot C1', 'Fondations îlot 12', 'Voirie principale']);
  assert.equal(res.body.updates[2].media[0].kind, 'image');
  const dossiers = await agent.get('/api/client/dossiers');
  assert.equal(dossiers.body[0].progress.progress_pct, 45);

  const lotView = await admin.get(`/api/admin/lots/${lotA.id}/site-updates`);
  assert.equal(lotView.body.length, 4, 'l’admin voit aussi le point masqué');
});

test('messagerie : le client écrit, l’équipe est prévenue, lit et répond', async () => {
  const { agent } = await clientLogin(leadA.client_code, passwords.a);
  const before = sent.length;
  let res = await agent.post('/api/client/messages').send({ body: 'Bonjour, quand aura lieu la prochaine visite de chantier ?', sale_id: saleA.id });
  assert.equal(res.status, 201);
  assert.ok(sent.slice(before).some(m => m.to === 'equipe@test.ci' && m.subject.includes(leadA.client_code)));

  res = await admin.get('/api/admin/client-messages');
  const thread = res.body.find(t => t.lead_id === leadA.id);
  assert.equal(thread.unread, 1);
  assert.equal((await admin.get('/api/admin/stats')).body.unread_client_messages, 1, 'pastille du menu Messagerie clients');
  res = await admin.get(`/api/admin/leads/${leadA.id}/messages`);
  assert.equal(res.body.length, 1);
  assert.equal((await admin.get('/api/admin/client-messages')).body.find(t => t.lead_id === leadA.id).unread, 0, 'lu en ouvrant le fil');

  const editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  assert.equal((await editeur.get('/api/admin/client-messages')).status, 403);

  res = await admin.post(`/api/admin/leads/${leadA.id}/messages`).send({ body: 'Bonjour Awa, la visite est prévue le 25 octobre.' });
  assert.equal(res.status, 201);
  assert.equal((await agent.get('/api/client/me')).body.client.unread_messages, 1);
  res = await agent.get('/api/client/messages');
  assert.deepEqual(res.body.map(m => m.sender), ['client', 'equipe']);
  assert.equal((await agent.get('/api/client/me')).body.client.unread_messages, 0);
});

test('mot de passe oublié : lien par e-mail, usage unique, réponse identique pour un code inconnu', async () => {
  const before = sent.length;
  const unknown = await request(app).post('/api/client/password/forgot').send({ code: 'SIIPAF-1999-9999' });
  assert.equal(unknown.status, 200);
  assert.equal(sent.length, before, 'aucun e-mail pour un code inconnu');
  const res = await request(app).post('/api/client/password/forgot').send({ code: leadA.client_code });
  assert.equal(res.body.message, unknown.body.message);
  const mail = sent[sent.length - 1];
  assert.equal(mail.to, 'awa@example.com');
  const token = mail.text.match(/jeton=([a-f0-9]{64})/)[1];

  const agent = request.agent(app);
  assert.equal((await agent.post('/api/client/password/reset').send({ token, password: 'court' })).status, 400);
  assert.equal((await agent.post('/api/client/password/reset').send({ token, password: 'NouveauSecret-2026' })).status, 200);
  assert.equal((await agent.get('/api/client/dossiers')).status, 200, 'connecté après la réinitialisation');
  assert.equal((await request(app).post('/api/client/password/reset').send({ token, password: 'EncoreUnAutre-2026' })).status, 400, 'lien à usage unique');
  assert.equal((await clientLogin(leadA.client_code, passwords.a)).res.status, 401, 'ancien mot de passe refusé');
  passwords.a = 'NouveauSecret-2026';
});

test('connexion par numéro de téléphone, quel que soit le format ; numéro partagé refusé', async () => {
  for (const phone of ['+33 6 11 22 33 44', '0611223344', '0033611223344', '33-611-223-344']) {
    const { res } = await clientLogin(phone, passwords.a);
    assert.equal(res.status, 200, `format ${phone}`);
    assert.equal(res.body.client.client_code, leadA.client_code);
  }
  assert.equal((await clientLogin('0611223344', 'mauvais-mot-de-passe')).res.status, 401);
  assert.equal((await clientLogin('0699999999', passwords.a)).res.status, 401, 'numéro inconnu');
  // L'ancien champ « code » reste accepté
  assert.equal((await request(app).post('/api/client/login').send({ code: leadA.client_code, password: passwords.a })).status, 200);
  // Deux accès sur le même numéro : le téléphone ne suffit plus, le code client oui
  const [twin] = await db('leads').insert({ name: 'Homonyme', phone: '06 11 22 33 44', client_code: 'SIIPAF-2026-0999' });
  assert.equal((await admin.post(`/api/admin/leads/${twin}/client-access`).send({ notify: false })).status, 201);
  assert.equal((await clientLogin('0611223344', passwords.a)).res.status, 401);
  assert.equal((await clientLogin(leadA.client_code, passwords.a)).res.status, 200);
  await db('leads').where({ id: twin }).del();
});

test('accès désactivé ou dossier désisté : plus rien de visible', async () => {
  await admin.patch(`/api/admin/leads/${leadB.id}/client-access`).send({ active: false });
  assert.equal((await clientLogin(leadB.client_code, passwords.b)).res.status, 401);

  const { agent } = await clientLogin(leadA.client_code, passwords.a);
  await admin.post(`/api/admin/lots/${lotA.id}/status`).send({ status: 'desistement', reason: 'Désistement client' });
  assert.deepEqual((await agent.get('/api/client/dossiers')).body, []);
  assert.equal((await agent.get(`/api/client/dossiers/${saleA.id}`)).status, 404);
});

test('liste des clients : dossiers, situation de paiement, accès et non-lus', async () => {
  const res = await admin.get('/api/admin/clients');
  assert.equal(res.status, 200);
  const awa = res.body.find(c => c.client_code === leadA.client_code);
  assert.ok(awa, 'le client figure dans la liste');
  assert.equal(awa.sales.length, 1);
  assert.equal(awa.status, 'desiste', 'dossier désisté au test précédent');
  assert.ok(awa.access, 'accès client renseigné');
  assert.ok(res.body.every(c => c.client_code), 'seuls les prospects avec un code client');
  const editeur = await login(app, 'editeur@test.ci', 'motdepasse-test-123');
  assert.equal((await editeur.get('/api/admin/clients')).status, 403);
});
