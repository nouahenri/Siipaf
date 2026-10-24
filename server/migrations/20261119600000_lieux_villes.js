/**
 * Lieux hors programmes (demande du client du 24/10) : la ville et la localité se choisissent dans les listes de
 * référence du dashboard (Paramètres › Villes, Localisations), comme pour les projets ; le champ libre « ville » est
 * retiré (repris sur la ville de même nom quand elle existe). Sans clé étrangère (règle SQLite du projet).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('places', t => { t.integer('city_id').unsigned(); t.integer('location_id').unsigned(); });
  for (const p of await knex('places').whereNotNull('city').select('id', 'city')) {
    const c = await knex('ref_items').where({ kind: 'ville' }).whereRaw('lower(label) = ?', [String(p.city).trim().toLowerCase()]).first('id');
    if (c) await knex('places').where({ id: p.id }).update({ city_id: c.id });
  }
  await knex.schema.alterTable('places', t => { t.dropColumn('city'); });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('places', t => { t.string('city', 80); });
  await knex.schema.alterTable('places', t => { t.dropColumn('city_id'); t.dropColumn('location_id'); });
};
