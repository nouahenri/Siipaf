const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, login, createUser, request } = require('./helpers');
const { renderCampaign, inline } = require('../src/lib/newsletter');
const mailer = require('../src/lib/mailer');
const nl = require('../src/services/newsletter');

let db, app, editeur, commercial, campaign;
const N = '/api/admin/newsletter';
before(async () => {
  ({ db, app } = await setup());
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  const subs = ['a@exemple.ci', 'b@exemple.ci', 'c@exemple.ci', 'd@exemple.ci'];
  await db('newsletter_subscribers').insert(subs.map((email, i) => ({ email, status: i === 3 ? 'desinscrit' : 'actif', unsubscribe_token: crypto.randomBytes(24).toString('hex') })));
});
after(() => db.destroy());

test('modèle d’e-mail : texte échappé, gras, liens sûrs, listes, désinscription', () => {
  assert.equal(inline('<b>x</b> **gras**'), '&lt;b&gt;x&lt;/b&gt; <strong>gras</strong>');
  assert.match(inline('[Voir](https://siipaf.com/a?x=1&y=2)', '#d2101e'), /<a href="https:\/\/siipaf.com\/a\?x=1&amp;y=2"/);
  const unsafe = inline('[piège](javascript:alert(1))');
  assert.ok(!/<a|javascript/.test(unsafe), 'lien non sûr ignoré');
  const { html, text } = renderCampaign({ subject: 'Nouveautés', heading: 'Ahoutoué', body: 'Bonjour,\n\n- Lot A\n- Lot B\n\nÀ bientôt', cta_label: 'Découvrir', cta_url: 'https://siipaf.com' },
    { logoUrl: 'https://client.siipaf.com/logo-siipaf.png', unsubscribeUrl: 'https://client.siipaf.com/api/public/newsletter/unsubscribe?token=t', siteUrl: 'https://siipaf.com' });
  assert.match(html, /<ul[^>]*><li[^>]*>Lot A<\/li><li[^>]*>Lot B<\/li><\/ul>/);
  assert.match(html, /Se désinscrire/);
  assert.match(text, /Découvrir : https:\/\/siipaf.com/);
});

test('campagnes : rédaction, aperçu, e-mail de test ; droits', async () => {
  assert.equal((await commercial.post(`${N}/campaigns`).send({ subject: 'Essai' })).status, 403);
  let res = await editeur.post(`${N}/campaigns`).send({ subject: 'Nouveautés d’octobre', heading: 'Ahoutoué', body: 'Bonjour **à tous**', cta_label: 'Voir', cta_url: 'https://siipaf.com' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  campaign = res.body;
  assert.equal(campaign.active_subscribers, 3);
  assert.equal((await editeur.patch(`${N}/campaigns/${campaign.id}`).send({ cta_url: 'javascript:x' })).status, 400);
  res = await editeur.get(`${N}/campaigns/${campaign.id}/preview`);
  assert.match(res.text, /<strong>à tous<\/strong>/);
  mailer.sent.length = 0;
  res = await editeur.post(`${N}/campaigns/${campaign.id}/test`).send({ to: 'moi@exemple.ci' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(mailer.sent[0].subject, '[Test] Nouveautés d’octobre');
  assert.match(mailer.sent[0].headers['List-Unsubscribe'], /token=test/);
  assert.equal(mailer.sent[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('envoi progressif : débit respecté, désinscrit pendant l’envoi ignoré, campagne terminée', async () => {
  await db('app_settings').insert({ key: 'newsletter', value: JSON.stringify({ per_minute: 2, per_hour: 100 }) });
  const res = await editeur.post(`${N}/campaigns/${campaign.id}/launch`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 3, 'abonnés actifs au lancement');
  await new Promise(r => setTimeout(r, 50)); // premier lot lancé par la route
  mailer.sent.length = 0;
  const t0 = new Date(Date.now() + 120000);
  await nl.tick(db, t0);
  let c = await nl.detail(db, campaign.id);
  assert.ok(c.sent >= 2 && c.sent <= 3);
  // Le dernier abonné en attente se désinscrit avant son tour
  const pending = await db('newsletter_sends').where({ campaign_id: campaign.id, status: 'en_attente' }).first();
  if (pending) await db('newsletter_subscribers').where({ id: pending.subscriber_id }).update({ status: 'desinscrit' });
  await nl.tick(db, t0);
  await nl.tick(db, new Date(t0.getTime() + 61000));
  c = await nl.detail(db, campaign.id);
  assert.equal(c.status, 'envoyee');
  assert.equal(c.sent + (c.counts.ignore || 0), 3);
  assert.ok(mailer.sent.every(m => /token=[0-9a-f]{48}/.test(m.headers['List-Unsubscribe'])), 'lien de désinscription personnel');
  assert.equal((await editeur.patch(`${N}/campaigns/${campaign.id}`).send({ subject: 'Modifiée' })).status, 409, 'envoyée : plus modifiable');
});

test('erreur du serveur mail : campagne en pause, reprise ; désinscription en un clic', async () => {
  await db('newsletter_subscribers').update({ status: 'actif' });
  let res = await editeur.post(`${N}/campaigns/${campaign.id}/duplicate`);
  const copy = res.body;
  await editeur.post(`${N}/campaigns/${copy.id}/launch`);
  const original = mailer.deliver;
  mailer.deliver = async () => { const e = new Error('Invalid login'); e.code = 'EAUTH'; e.response = '535 Incorrect authentication data'; throw e; };
  try { await nl.tick(db, new Date(Date.now() + 600000)); } finally { mailer.deliver = original; }
  let c = await nl.detail(db, copy.id);
  assert.equal(c.status, 'pause');
  assert.match(c.last_error, /535/);
  assert.equal(c.counts.en_attente, 4, 'aucune adresse perdue');
  res = await editeur.post(`${N}/campaigns/${copy.id}/resume`);
  assert.equal(res.body.status, 'en_cours');

  const sub = await db('newsletter_subscribers').where({ email: 'a@exemple.ci' }).first();
  res = await request(app).post(`/api/public/newsletter/unsubscribe?token=${sub.unsubscribe_token}`).type('form').send('List-Unsubscribe=One-Click');
  assert.equal(res.status, 200);
  assert.equal((await db('newsletter_subscribers').where({ id: sub.id }).first()).status, 'desinscrit');
  res = await request(app).get(`/api/public/newsletter/unsubscribe?token=${sub.unsubscribe_token}`);
  assert.match(res.text, /désinscrit/);
  assert.equal((await editeur.post(`${N}/campaigns/${copy.id}/cancel`)).body.status, 'annulee');
});
