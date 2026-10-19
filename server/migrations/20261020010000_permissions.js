/**
 * Privilèges configurables : droits de chaque rôle (modifiables par le super administrateur)
 * et privilèges accordés ou retirés à un compte précis.
 * La table role_permissions est remplie avec les droits par défaut du code au premier passage.
 */
const { PERMISSIONS } = require('../src/lib/domain');

exports.up = async function (knex) {
  await knex.schema.createTable('role_permissions', t => {
    t.string('role', 40).notNullable();
    t.string('permission', 60).notNullable();
    t.primary(['role', 'permission']);
  });

  await knex.schema.createTable('user_permissions', t => {
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('permission', 60).notNullable();
    t.boolean('granted').notNullable(); // true = accordé en plus du rôle, false = retiré
    t.primary(['user_id', 'permission']);
  });

  const rows = Object.entries(PERMISSIONS)
    .filter(([role]) => role !== 'super_admin') // le super admin a toujours tous les droits
    .flatMap(([role, perms]) => perms.map(permission => ({ role, permission })));
  if (rows.length) await knex.batchInsert('role_permissions', rows, 100);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('user_permissions');
  await knex.schema.dropTableIfExists('role_permissions');
};
