/**
 * Situations de travaux : assiette de la retenue de garantie (TTC ou HT de la période), réglable dans
 * Chantiers › Réglages (demande du client du 24/10) et conservée sur chaque situation pour la traçabilité.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('worksite_situations', t => { t.string('retention_base', 3).notNullable().defaultTo('ttc'); });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('worksite_situations', t => { t.dropColumn('retention_base'); });
};
