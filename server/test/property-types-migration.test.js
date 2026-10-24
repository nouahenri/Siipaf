const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const NAME = '20261116000000_property_types.js';
let db;

before(async () => { ({ db } = await setup()); });
after(() => db.destroy());

test('reprise : le type saisi dans le Parc immobilier de l’ERP devient un type de biens des Paramètres', async () => {
  await db.migrate.down({ name: NAME });
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  const villa = await db('ref_items').where({ kind: 'type_bien', label: 'Villa basse' }).first();
  await db('projects').where({ id: project.id }).update({ property_type_id: villa.id });
  const ids = [];
  for (const [code, lot_type] of [['M1', 'villa'], ['M2', 'commerce'], ['M3', 'appartement']]) {
    const [id] = await db('lots').insert({ project_id: project.id, code, lot_type, status: 'disponible' });
    ids.push(typeof id === 'object' ? id.id : id);
  }
  await db.migrate.up({ name: NAME });

  const lot = id => db('lots as l').leftJoin('ref_items as t', 't.id', 'l.property_type_id').where('l.id', id).first('t.label');
  assert.equal((await lot(ids[0])).label, 'Villa basse', 'même famille que le type du projet : le type du projet reste');
  assert.equal((await lot(ids[1])).label, 'Local commercial', 'type absent des Paramètres : créé');
  assert.equal((await lot(ids[2])).label, 'Appartement');
  const ticked = await db('project_property_types as p').join('ref_items as t', 't.id', 'p.item_id').where('p.project_id', project.id).orderBy('p.sort').pluck('t.label');
  assert.deepEqual(ticked.sort(), ['Appartement', 'Local commercial', 'Villa basse']);
});
