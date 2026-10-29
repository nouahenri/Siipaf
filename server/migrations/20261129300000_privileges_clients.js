/**
 * Privilèges « Clients et espace client » (demande du client du 29/10, 2ᵉ message) : fiches clients détaillées
 * (voir, créer, modifier, importer, exporter) à côté des accès et de la messagerie. Rien ne change pour personne :
 * qui voyait les dossiers voit les clients et peut les exporter, qui modifiait un prospect modifie un client,
 * « Créer ou importer des clients » devient deux cases. Copie figée de PERMISSION_SPLITS (lib/domain.js).
 */
const SPLITS = {
  'sales:clients': ['clients:create', 'clients:import'],
  'sales:read': ['sales:read', 'clients:read', 'clients:export'],
  'leads:edit': ['leads:edit', 'clients:edit'],
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

exports.up = async knex => {
  await expand(knex, 'role_permissions', ['role']);
  await expand(knex, 'user_permissions', ['user_id'], row => ({ granted: row.granted }));
};

exports.down = async knex => {
  for (const table of ['role_permissions', 'user_permissions']) {
    if (!(await knex.schema.hasTable(table))) continue;
    const isUser = table === 'user_permissions';
    for (const row of await knex(table).whereIn('permission', ['clients:create', 'clients:import'])) {
      const key = isUser ? { user_id: row.user_id } : { role: row.role };
      if (!(await knex(table).where({ ...key, permission: 'sales:clients' }).first())) await knex(table).insert({ ...key, permission: 'sales:clients', ...(isUser ? { granted: row.granted } : {}) });
    }
    await knex(table).whereIn('permission', ['clients:read', 'clients:create', 'clients:edit', 'clients:import', 'clients:export']).del();
  }
};
