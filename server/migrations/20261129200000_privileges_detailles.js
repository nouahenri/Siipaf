/**
 * Privilèges détaillés (demande du client du 29/10) : chaque privilège qui regroupait plusieurs actions devient des
 * cases à cocher (ex. « Gérer les prospects » → créer, modifier, faire avancer, activités, importer, demander un
 * transfert). Un rôle ou un compte qui avait l'ancien privilège reçoit toutes ses actions : rien ne change pour
 * personne tant que le super administrateur ne décoche rien. Copie figée de PERMISSION_SPLITS (lib/domain.js).
 */
const SPLITS = {
  'leads:write': ['leads:create', 'leads:edit', 'leads:stage', 'leads:activities', 'leads:import', 'leads:transfer'],
  'appointments:write': ['appointments:create', 'appointments:edit', 'appointments:cancel'],
  'lots:status': ['lots:option', 'lots:reserve', 'lots:desist'],
  'sales:write': ['sales:open', 'sales:edit', 'sales:clients'],
  'payments:write': ['payments:write', 'payments:delete'],
  'documents:write': ['documents:status', 'documents:files', 'documents:visibility'],
  'client_access:write': ['client_access:open', 'client_access:disable'],
  'client_messages': ['client_messages', 'client_messages:group'],
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

// Retour arrière : l'ancien privilège revient si le rôle ou le compte avait au moins une de ses actions
async function collapse(knex, table, keyCols, extra = () => ({})) {
  if (!(await knex.schema.hasTable(table))) return;
  for (const [from, to] of Object.entries(SPLITS)) {
    const actions = to.filter(p => p !== from);
    for (const row of await knex(table).whereIn('permission', actions)) {
      const key = Object.fromEntries(keyCols.map(c => [c, row[c]]));
      if (!(await knex(table).where({ ...key, permission: from }).first())) await knex(table).insert({ ...key, permission: from, ...extra(row) });
    }
    await knex(table).whereIn('permission', actions).del();
  }
}

exports.up = async knex => {
  await expand(knex, 'role_permissions', ['role']);
  await expand(knex, 'user_permissions', ['user_id'], row => ({ granted: row.granted }));
};

exports.down = async knex => {
  await collapse(knex, 'role_permissions', ['role']);
  await collapse(knex, 'user_permissions', ['user_id'], row => ({ granted: row.granted }));
};
