const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers'); // environnement de test
const { createDb } = require('../src/db');

const SETTINGS = '20261022000000_settings.js';

// Régression : sous SQLite, la migration Paramètres reconstruisait « projects » et supprimait
// en cascade les plans, lots et grilles de prix des bases existantes.
test('la migration Paramètres conserve projets, plans, lots et prix (aller et retour)', async () => {
  const db = createDb();
  try {
    for (;;) {
      const [, pending] = await db.migrate.list();
      if (!pending.length || pending[0].file === SETTINGS) break;
      await db.migrate.up();
    }
    const [projectId] = await db('projects').insert({ slug: 'p', name: 'Projet', city: 'Abidjan', location: 'Cocody — Riviera 3', amenities: JSON.stringify(['Piscine']) });
    const [planId] = await db('site_plans').insert({ project_id: projectId, name: 'Plan', published: true });
    await db('project_offers').insert({ project_id: projectId, label: 'Villa', price_fcfa: 1000 });
    await db('lots').insert([{ project_id: projectId, plan_id: planId, code: '1', status: 'disponible' }, { project_id: projectId, plan_id: planId, code: '2', status: 'vendu' }]);
    const count = async () => Promise.all(['projects', 'site_plans', 'project_offers', 'lots'].map(async t => Number((await db(t).count({ n: '*' }).first()).n)));
    const before = await count();

    await db.migrate.up({ name: SETTINGS });
    assert.deepEqual(await count(), before, 'rien de supprimé à la migration');
    const p = await db('projects').where({ id: projectId }).first();
    assert.ok(p.city_id && p.location_id, 'ville et localisation rattachées');
    assert.equal(p.location_detail, 'Riviera 3');
    assert.equal((await db('lots').where({ code: '2' }).first()).plan_id, planId);

    await db.migrate.down({ name: SETTINGS });
    assert.deepEqual(await count(), before, 'rien de supprimé au retour arrière');
  } finally {
    await db.destroy();
  }
});
