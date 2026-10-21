/**
 * ERP · droits par action : les privilèges larges des modules (« Traiter le SAV », « Saisir en comptabilité »,
 * « Gérer la paie ») deviennent des actions détaillées. Chaque rôle et chaque exception de compte qui avait l'ancien
 * privilège reçoit les actions qu'il couvrait : personne ne gagne ni ne perd de droit au passage.
 * « Voir les prospects de toute l'équipe » reprend la règle qui était écrite pour le rôle commercial.
 */
const { SAV_ACTIONS, PAIE_ACTIONS, RH_ACTIONS } = require('../src/lib/domain');

// Ancien privilège → actions qu'il couvrait ; `keep` : l'ancien identifiant reste (avec un sens plus étroit)
const MAPPING = {
  'sav:write': { to: SAV_ACTIONS },
  'compta:write': { to: ['compta:entries', 'achats:write', 'achats:pay', 'frais:post'] },
  'compta:validate': { to: ['compta:close', 'compta:settings', 'compta:export'], keep: true },
  'paie:write': { to: PAIE_ACTIONS },
  'rh:write': { to: RH_ACTIONS }, // bases de développement passées par une première version du module RH
};

async function convert(knex, table, key) {
  if (!(await knex.schema.hasTable(table))) return;
  for (const [old, { to, keep }] of Object.entries(MAPPING)) {
    const rows = await knex(table).where({ permission: old });
    for (const row of rows) {
      for (const permission of to) {
        const next = { [key]: row[key], permission, ...(table === 'user_permissions' ? { granted: row.granted } : {}) };
        if (!(await knex(table).where({ [key]: row[key], permission }).first())) await knex(table).insert(next);
      }
    }
    if (!keep) await knex(table).where({ permission: old }).del();
  }
}

exports.up = async function (knex) {
  await convert(knex, 'role_permissions', 'role');
  await convert(knex, 'user_permissions', 'user_id');
  // Toute l'équipe commerciale : rôles qui voient les prospects, sauf le rôle commercial (règle d'origine)
  if (await knex.schema.hasTable('role_permissions')) {
    const roles = await knex('role_permissions').where({ permission: 'leads:read' }).whereNot('role', 'commercial').pluck('role');
    for (const role of roles) {
      if (!(await knex('role_permissions').where({ role, permission: 'leads:all' }).first())) await knex('role_permissions').insert({ role, permission: 'leads:all' });
    }
  }
};

exports.down = async function (knex) {
  for (const table of ['role_permissions', 'user_permissions']) {
    if (!(await knex.schema.hasTable(table))) continue;
    const key = table === 'role_permissions' ? 'role' : 'user_id';
    for (const [old, { to, keep }] of Object.entries(MAPPING)) {
      if (!keep) {
        const holders = await knex(table).whereIn('permission', to).distinct(key).pluck(key);
        for (const h of holders) if (!(await knex(table).where({ [key]: h, permission: old }).first())) await knex(table).insert({ [key]: h, permission: old, ...(table === 'user_permissions' ? { granted: true } : {}) });
      }
    }
    await knex(table).whereIn('permission', [...new Set(Object.values(MAPPING).flatMap(m => m.to)), 'leads:all']).del();
  }
};
