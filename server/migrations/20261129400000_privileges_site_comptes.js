/**
 * Privilèges détaillés du catalogue, du site web et des comptes (demande du client du 29/10) : « Modifier les projets »,
 * « Éditer les plans », « Modifier le contenu », « Gérer la médiathèque », « Gérer la newsletter » et « Gérer les
 * utilisateurs » deviennent des cases par action. Rien ne change pour personne : qui avait l'ancien privilège reçoit
 * toutes ses actions. Le réglage du circuit d'information devient « circuit:write » (avant : gérer les utilisateurs ou
 * valider en direction générale). Copie figée de PERMISSION_SPLITS (lib/domain.js).
 */
const SPLITS = {
  'projects:write': ['projects:create', 'projects:edit', 'projects:publish', 'projects:prices', 'projects:delete'],
  'plans:write': ['plans:edit', 'plans:lots', 'plans:lots_delete'],
  'content:write': ['content:home', 'content:texts', 'content:images', 'content:contacts'],
  'media:write': ['media:upload', 'media:delete'],
  'newsletter:write': ['newsletter:subscribers', 'newsletter:campaigns'],
  'users:write': ['users:create', 'users:edit', 'users:role', 'users:password', 'users:disable', 'circuit:write'],
  'demandes:dg': ['demandes:dg', 'circuit:write'],
};

async function expand(knex, table, keyCols, extra = () => ({})) {
  if (!(await knex.schema.hasTable(table))) return;
  for (const [from, to] of Object.entries(SPLITS)) {
    for (const row of await knex(table).where({ permission: from })) {
      const key = Object.fromEntries(keyCols.map(c => [c, row[c]]));
      for (const permission of to) {
        if (!(await knex(table).where({ ...key, permission }).first())) await knex(table).insert({ ...key, permission, ...extra(row) });
      }
      if (!to.includes(from)) await knex(table).where({ ...key, permission: from }).del();
    }
  }
}

async function collapse(knex, table, keyCols, extra = () => ({})) {
  if (!(await knex.schema.hasTable(table))) return;
  for (const [from, to] of Object.entries(SPLITS)) {
    const actions = to.filter(p => p !== from && p !== 'circuit:write');
    if (!actions.length) continue;
    for (const row of await knex(table).whereIn('permission', actions)) {
      const key = Object.fromEntries(keyCols.map(c => [c, row[c]]));
      if (!(await knex(table).where({ ...key, permission: from }).first())) await knex(table).insert({ ...key, permission: from, ...extra(row) });
    }
    await knex(table).whereIn('permission', actions).del();
  }
  await knex(table).where({ permission: 'circuit:write' }).del();
}

exports.up = async knex => {
  await expand(knex, 'role_permissions', ['role']);
  await expand(knex, 'user_permissions', ['user_id'], row => ({ granted: row.granted }));
};

exports.down = async knex => {
  await collapse(knex, 'role_permissions', ['role']);
  await collapse(knex, 'user_permissions', ['user_id'], row => ({ granted: row.granted }));
};
