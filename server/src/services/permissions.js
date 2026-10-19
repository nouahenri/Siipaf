/**
 * Droits effectifs d'un compte = droits de son rôle (table role_permissions, réglables
 * par le super administrateur) + privilèges accordés − privilèges retirés (table user_permissions).
 * Le super administrateur a toujours tous les droits.
 * Les droits des rôles sont mis en cache et rechargés après chaque modification.
 */
const { PERMISSIONS, PERMISSION_IDS } = require('../lib/domain');

const caches = new WeakMap(); // une entrée par connexion (les tests en ouvrent plusieurs)

async function roleTable(db) {
  let cache = caches.get(db);
  if (!cache) {
    const rows = await db('role_permissions').select('role', 'permission');
    cache = {};
    for (const r of rows) (cache[r.role] ||= new Set()).add(r.permission);
    caches.set(db, cache);
  }
  return cache;
}

function invalidate(db) {
  caches.delete(db);
}

/** Droits d'un rôle tels qu'enregistrés (le super admin : tous). */
async function rolePermissions(db, role) {
  if (role === 'super_admin') return ['*'];
  const table = await roleTable(db);
  return [...(table[role] || [])];
}

/** Droits effectifs d'un compte, privilèges individuels compris. */
async function effectivePermissions(db, user) {
  if (user.role === 'super_admin') return ['*'];
  const perms = new Set(await rolePermissions(db, user.role));
  const overrides = await db('user_permissions').where({ user_id: user.id });
  for (const o of overrides) {
    if (o.granted) perms.add(o.permission);
    else perms.delete(o.permission);
  }
  return [...perms].filter(p => PERMISSION_IDS.includes(p));
}

const hasPermission = (perms, permission) => perms.includes('*') || perms.includes(permission);

/** Remplace les droits d'un rôle (le super admin ne se modifie pas). */
async function setRolePermissions(db, role, permissions) {
  await db.transaction(async trx => {
    await trx('role_permissions').where({ role }).del();
    if (permissions.length) await trx('role_permissions').insert(permissions.map(permission => ({ role, permission })));
  });
  invalidate(db);
}

/** Revient aux droits par défaut définis dans le code pour un rôle. */
async function resetRolePermissions(db, role) {
  await setRolePermissions(db, role, (PERMISSIONS[role] || []).filter(p => p !== '*'));
}

module.exports = { effectivePermissions, rolePermissions, setRolePermissions, resetRolePermissions, hasPermission, invalidate };
