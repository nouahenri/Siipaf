/**
 * Notifications push de l'application mobile pour tous (choix du client du 04/11) :
 * - `app_devices` : téléphones qui ont activé « Recevoir des notifications push » dans Paramètres, connectés ou non, avec
 *   la ville préférée (liste Villes de Paramètres) et la langue de l'application pour cibler les annonces ;
 * - `app_announcements` : annonces envoyées depuis le dashboard (Ventes › Notifications push) : titre, texte, programme
 *   ouvert au toucher, ville ciblée, nombre d'appareils visés et d'envois acceptés ;
 * - privilèges `push:read` et `push:send` accordés aux rôles réglés qui envoient déjà la newsletter, et au responsable
 *   d'exploitation (les rôles restés sur leurs droits par défaut les reçoivent par lib/domain.js).
 */
exports.up = async knex => {
  await knex.schema.createTable('app_devices', t => {
    t.increments('id');
    t.string('token', 200).notNullable().unique();
    t.string('platform', 10);
    t.integer('city_id').unsigned().nullable();
    t.string('language', 5);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('last_seen_at').defaultTo(knex.fn.now());
    t.index(['city_id']);
  });
  await knex.schema.createTable('app_announcements', t => {
    t.increments('id');
    t.string('title', 80).notNullable();
    t.string('body', 240).notNullable();
    t.integer('project_id').unsigned().nullable().references('id').inTable('projects').onDelete('SET NULL');
    t.integer('city_id').unsigned().nullable();
    t.integer('recipients').notNullable().defaultTo(0);
    t.integer('sent').notNullable().defaultTo(0);
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  const roles = await knex('role_permissions').where({ permission: 'newsletter:send' }).distinct('role').pluck('role');
  for (const role of new Set([...roles, 'resp_exploitation'])) {
    if (!(await knex('role_permissions').where({ role }).first())) continue; // rôle encore sur ses droits par défaut
    for (const permission of ['push:read', 'push:send']) {
      if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
    }
  }
};

exports.down = async knex => {
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', ['push:read', 'push:send']).del();
  }
  await knex.schema.dropTableIfExists('app_announcements');
  await knex.schema.dropTableIfExists('app_devices');
};
