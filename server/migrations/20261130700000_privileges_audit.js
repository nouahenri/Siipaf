/**
 * Réaudit des privilèges du 30/10 : quatre nouveaux droits, accordés aux rôles et aux comptes qui en avaient l'usage
 * implicite pour que rien ne change pour eux (« effectivePermissions » élimine tout identifiant absent du catalogue,
 * et un rôle personnalisé n'hérite pas des droits par défaut du code).
 * - « sav:all » (Portée : tout le SAV) : qui crée, traite, attribue, gère les réserves ou les interventions, et les rôles
 *   qui ne font que consulter le SAV sans gérer de prospects (le commercial, lui, ne voit que ses clients) ;
 * - « contacts:handle » (traiter les messages de contact) : qui consultait les messages (« contacts:read ») ;
 * - « achats:validate » (valider les factures d'achat et les dépenses du Parc) : qui gérait les achats (« achats:write ») ;
 * - « rh:documents » (pièces du dossier du personnel) : le service RH seulement, soit qui règle les RH (« rh:settings »),
 *   et non tous les titulaires de « rh:read ».
 */
const SAV_USERS = ['sav:create', 'sav:handle', 'sav:assign', 'sav:reserves', 'sav:interventions'];
const SELLERS = ['leads:create', 'leads:edit', 'leads:write'];

/** Donne `permission` à chaque rôle choisi par `wants(setDesDroits)`. */
async function grantRoles(knex, permission, wants) {
  const byRole = {};
  for (const p of await knex('role_permissions').select('role', 'permission')) (byRole[p.role] ||= new Set()).add(p.permission);
  for (const [role, set] of Object.entries(byRole)) {
    if (set.has(permission) || !wants(set)) continue;
    await knex('role_permissions').insert({ role, permission });
  }
}

/**
 * Privilèges individuels : un compte qui a reçu (granted) l'un des droits `from` reçoit `permission` ; avec `copyDeny`,
 * un droit retiré à un compte lui retire aussi le nouveau (droit à source unique).
 */
async function grantUsers(knex, permission, from, { copyDeny = false } = {}) {
  if (!(await knex.schema.hasTable('user_permissions'))) return;
  for (const row of await knex('user_permissions').whereIn('permission', from)) {
    if (!row.granted && !copyDeny) continue;
    if (await knex('user_permissions').where({ user_id: row.user_id, permission }).first()) continue;
    await knex('user_permissions').insert({ user_id: row.user_id, permission, granted: row.granted });
  }
}

exports.up = async knex => {
  await grantRoles(knex, 'sav:all', set => SAV_USERS.some(p => set.has(p)) || (set.has('sav:read') && !SELLERS.some(p => set.has(p))));
  await grantUsers(knex, 'sav:all', SAV_USERS);

  await grantRoles(knex, 'contacts:handle', set => set.has('contacts:read'));
  await grantUsers(knex, 'contacts:handle', ['contacts:read'], { copyDeny: true });

  await grantRoles(knex, 'achats:validate', set => set.has('achats:write'));
  await grantUsers(knex, 'achats:validate', ['achats:write'], { copyDeny: true });

  await grantRoles(knex, 'rh:documents', set => set.has('rh:settings'));
  await grantUsers(knex, 'rh:documents', ['rh:settings'], { copyDeny: true });
};

exports.down = async knex => {
  const ids = ['sav:all', 'contacts:handle', 'achats:validate', 'rh:documents'];
  await knex('role_permissions').whereIn('permission', ids).del();
  if (await knex.schema.hasTable('user_permissions')) await knex('user_permissions').whereIn('permission', ids).del();
};
