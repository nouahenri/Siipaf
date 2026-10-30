/**
 * Découpage d'un privilège en actions (migrations « expand / collapse » des privilèges détaillés, ERP du 30/10).
 * `splits` : { ancien: [actions] } figé dans la migration (copie de PERMISSION_SPLITS à la date de la migration).
 * « expand » : tout rôle (role_permissions) et tout compte (user_permissions, accordé ou retiré) qui avait l'ancien
 * privilège reçoit toutes ses actions ; l'ancien identifiant disparaît s'il n'est pas l'une des actions
 * (« effectivePermissions » élimine tout identifiant absent du catalogue). « collapse » fait le chemin inverse.
 */
async function expandTable(knex, table, keyCols, splits, extra = () => ({})) {
  if (!(await knex.schema.hasTable(table))) return;
  for (const [from, to] of Object.entries(splits)) {
    for (const row of await knex(table).where({ permission: from })) {
      const key = Object.fromEntries(keyCols.map(c => [c, row[c]]));
      for (const permission of to) {
        if (!(await knex(table).where({ ...key, permission }).first())) await knex(table).insert({ ...key, permission, ...extra(row) });
      }
      if (!to.includes(from)) await knex(table).where({ ...key, permission: from }).del();
    }
  }
}

async function collapseTable(knex, table, keyCols, splits, extra = () => ({})) {
  if (!(await knex.schema.hasTable(table))) return;
  for (const [from, to] of Object.entries(splits)) {
    const actions = to.filter(p => p !== from);
    if (!actions.length) continue;
    for (const row of await knex(table).whereIn('permission', actions)) {
      const key = Object.fromEntries(keyCols.map(c => [c, row[c]]));
      if (!(await knex(table).where({ ...key, permission: from }).first())) await knex(table).insert({ ...key, permission: from, ...extra(row) });
    }
    await knex(table).whereIn('permission', actions).del();
  }
}

async function expand(knex, splits) {
  await expandTable(knex, 'role_permissions', ['role'], splits);
  await expandTable(knex, 'user_permissions', ['user_id'], splits, row => ({ granted: row.granted }));
}

async function collapse(knex, splits) {
  await collapseTable(knex, 'role_permissions', ['role'], splits);
  await collapseTable(knex, 'user_permissions', ['user_id'], splits, row => ({ granted: row.granted }));
}

module.exports = { expand, collapse };
