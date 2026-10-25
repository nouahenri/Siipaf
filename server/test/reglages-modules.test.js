const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const notifications = require('../src/services/notifications');
const { contractAlertStage, maintenanceDue } = require('../src/lib/domain');

let db, app, admin, commercial, comptable, ids;
const N = '/api/admin/erp/notifications';
const R = '/api/admin/erp/reglages';

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
});
after(() => db.destroy());

test('réglages d’un module : lecture pour tous, modification selon les droits, défauts = règles en place', async () => {
  let res = await commercial.get(`${R}/sav`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.values, { sav_hours_urgente: 24, sav_hours_haute: 48, sav_hours_normale: 120, sav_hours_basse: 240 });
  assert.equal(res.body.fields.sav_hours_urgente.can_edit, false);
  assert.equal(res.body.fields.sav_hours_urgente.perm, undefined, 'les droits ne sont pas exposés');
  assert.equal((await commercial.put(`${R}/sav`).send({ sav_hours_urgente: 12 })).status, 403);
  assert.equal((await admin.get(`${R}/inconnu`)).status, 404);

  res = await admin.put(`${R}/sav`).send({ sav_hours_urgente: 12 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.values.sav_hours_urgente, 12);
  assert.equal((await admin.put(`${R}/sav`).send({ sav_hours_urgente: 0 })).status, 400, 'borné');
  // Une réclamation urgente prend le délai réglé
  const due = await require('../src/services/sav').dueFrom(db, 'urgente', new Date('2026-10-25T08:00:00Z'));
  assert.equal(due.toISOString(), '2026-10-25T20:00:00.000Z');

  // Rappels : le second doit venir après le premier
  assert.equal((await admin.put(`${R}/administration`).send({ admin_alert_first_days: 10, admin_alert_second_days: 10 })).status, 400);
  res = await admin.put(`${R}/administration`).send({ admin_alert_first_days: 45, admin_alert_second_days: 10 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(await require('../src/services/moduleSettings').alertStages(db), [45, 10]);
  assert.equal((await admin.get('/api/admin/erp/contrats/refs')).body.alert_days[0], 45, 'repris dans les aides de l’écran');
});

test('règles réglables : paliers des rappels, entretien « bientôt »', () => {
  assert.equal(contractAlertStage('2026-11-30', '2026-10-25'), null);
  assert.equal(contractAlertStage('2026-11-20', '2026-10-25'), 30);
  assert.equal(contractAlertStage('2026-11-30', '2026-10-25', [45, 10]), 45);
  assert.equal(contractAlertStage('2026-11-01', '2026-10-25', [45, 10]), 10);
  const plan = { every_days: null, every_months: 6, last_date: '2026-05-10', every_km: null, last_meter: null };
  const asset = { meter: 'km', meter_value: null };
  assert.equal(maintenanceDue(plan, asset, '2026-10-25').state, 'ok');
  assert.equal(maintenanceDue(plan, asset, '2026-10-25', { days: 20, km: 500, h: 20 }).state, 'bientot');
});

test('mes notifications : un module coupé n’arrive plus dans la cloche, son propre au module', async () => {
  let res = await commercial.put(`${N}/preferences`).send({ module: 'chantiers', enabled: false, sound: null });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await notifications.notify(db, { to: ids.commercial, module: 'chantiers', event: 'test.coupe', title: 'Coupé', key: 'coupe:1' }), 0);
  assert.equal(await notifications.notify(db, { to: ids.commercial, module: 'commercial', event: 'test.ouvert', title: 'Ouvert', key: 'ouvert:1' }), 1);
  assert.equal((await commercial.put(`${N}/preferences`).send({ module: 'commercial', enabled: true, sound: 'goutte' })).status, 200);
  assert.equal((await commercial.put(`${N}/preferences`).send({ module: 'commercial', enabled: true, sound: 'trompette' })).status, 400);
  res = await commercial.get(N);
  assert.deepEqual(res.body.prefs, { chantiers: { enabled: false, sound: null }, commercial: { enabled: true, sound: 'goutte' } });
  assert.equal(res.body.modules.chantiers, 'Chantiers');
  assert.equal(res.body.items.some(n => n.event === 'test.coupe'), false);
  // Réactivé : les suivantes arrivent
  await commercial.put(`${N}/preferences`).send({ module: 'chantiers', enabled: true });
  assert.equal(await notifications.notify(db, { to: ids.commercial, module: 'chantiers', event: 'test.coupe', title: 'Rouvert', key: 'coupe:2' }), 1);
});

test('circuit : chaque service reçoit l’information dans son module', async () => {
  await notifications.inform(db, 'vente.ouverte', { title: 'Nouveau dossier', key: 'circuit:1', link: '/commercial/ventes', links: { compta: '/compta' } });
  const row = await db('notifications').where({ user_id: ids.comptable, dedupe_key: 'circuit:1' }).first();
  assert.ok(row, 'la Comptabilité est prévenue');
  assert.deepEqual([row.module, row.link], ['compta', '/compta']);
  const dg = await db('notifications').where({ user_id: ids.super_admin, dedupe_key: 'circuit:1' }).first();
  assert.equal(dg.module, 'commercial', 'la Direction générale la reçoit dans le module d’origine');
  // Le comptable coupe les notifications de la Comptabilité : il n'est plus prévenu
  await comptable.put(`${N}/preferences`).send({ module: 'compta', enabled: false });
  await notifications.inform(db, 'vente.ouverte', { title: 'Autre dossier', key: 'circuit:2' });
  assert.equal(await db('notifications').where({ user_id: ids.comptable, dedupe_key: 'circuit:2' }).first(), undefined);
});
