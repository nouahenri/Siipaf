/**
 * Types de fournisseurs administrables (demande du client du 18/11) : la liste figée (fournisseur, sous-traitant,
 * prestataire, notaire) devient une liste réglable. Les quatre types d'origine restent (code fixe : les sous-traitants
 * sont proposés sur les chantiers, les notaires dans les actes) ; ils se renomment, les nouveaux se désactivent.
 */
exports.up = async knex => {
  await knex.schema.createTable('supplier_kinds', t => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('label', 80).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('system').notNullable().defaultTo(false);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  const base = [['fournisseur', 'Fournisseur'], ['sous_traitant', 'Sous-traitant'], ['prestataire', 'Prestataire'], ['notaire', 'Notaire']];
  await knex('supplier_kinds').insert(base.map(([code, label], i) => ({ code, label, system: true, sort: i })));
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('supplier_kinds');
};
