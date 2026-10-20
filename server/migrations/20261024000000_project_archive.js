exports.up = async function (knex) {
  await knex.schema.alterTable('projects', t => { t.timestamp('archived_at').nullable(); });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('projects', t => { t.dropColumn('archived_at'); });
};
