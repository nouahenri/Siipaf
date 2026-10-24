/**
 * Plusieurs types de biens par projet (demande du client du 24/10) : cases à cocher dans la fiche projet ; chaque bien
 * (lot) porte son type, choisi parmi ceux du projet. `projects.property_type_id` garde le premier type coché (lectures
 * existantes). Le type des biens est déduit de leur ligne de grille quand son libellé correspond à un type du projet.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('project_property_types', t => {
    t.integer('project_id').unsigned().notNullable().references('projects.id').onDelete('CASCADE');
    t.integer('item_id').unsigned().notNullable().references('ref_items.id').onDelete('CASCADE');
    t.integer('sort').notNullable().defaultTo(0);
    t.primary(['project_id', 'item_id']);
  });
  // Colonne sans clé étrangère : sous SQLite, une clé étrangère ajoutée reconstruirait la table des lots
  await knex.schema.alterTable('lots', t => { t.integer('property_type_id').unsigned(); });

  for (const p of await knex('projects').whereNotNull('property_type_id').select('id', 'property_type_id')) {
    await knex('project_property_types').insert({ project_id: p.id, item_id: p.property_type_id, sort: 0 });
  }
  // Biens existants : type tiré du libellé de leur ligne de grille, sinon du type du projet
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const types = await knex('ref_items').where({ kind: 'type_bien' }).select('id', 'label');
  // Type d'une ligne de grille : le plus long libellé de type contenu dans son libellé (« Appartement social 2 pièces » → Appartement)
  const byLabel = { get: label => {
    const l = norm(label);
    const hit = types.filter(t => norm(t.label) && l.includes(norm(t.label))).sort((a, b) => b.label.length - a.label.length)[0];
    return hit ? hit.id : null;
  } };
  const offers = Object.fromEntries((await knex('project_offers').select('id', 'label')).map(o => [o.id, o.label]));
  const projectType = Object.fromEntries((await knex('projects').select('id', 'property_type_id')).map(p => [p.id, p.property_type_id]));
  const checked = new Set((await knex('project_property_types').select('project_id', 'item_id')).map(r => `${r.project_id}:${r.item_id}`));
  for (const l of await knex('lots').select('id', 'project_id', 'offer_id')) {
    const fromOffer = l.offer_id ? byLabel.get(norm(offers[l.offer_id])) : null;
    const type = fromOffer || projectType[l.project_id] || null;
    if (!type) continue;
    await knex('lots').where({ id: l.id }).update({ property_type_id: type });
    // Un type présent dans la grille du projet devient un type coché du projet
    if (!checked.has(`${l.project_id}:${type}`)) {
      checked.add(`${l.project_id}:${type}`);
      await knex('project_property_types').insert({ project_id: l.project_id, item_id: type, sort: 10 });
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('lots', t => { t.dropColumn('property_type_id'); });
  await knex.schema.dropTableIfExists('project_property_types');
};
