/**
 * Rôles : les 6 rôles d'origine (« système ») et ceux créés depuis le dashboard ; tous se suppriment sauf le super administrateur.
 * Les droits de chaque rôle sont dans role_permissions (services/permissions.js).
 */
const { roleKey, PROTECTED_ROLES } = require('../lib/domain');
const { HttpError } = require('../lib/http');
const { setRolePermissions, invalidate } = require('./permissions');

const listRoles = db => db('roles').orderBy([{ column: 'sort' }, { column: 'label' }]);

const getRole = (db, id) => db('roles').where({ id: String(id) }).first();

async function requireRole(db, id) {
  const role = await getRole(db, id);
  if (!role) throw new HttpError(400, 'Rôle inconnu.');
  return role;
}

/** Libellé déjà pris par un autre rôle (sans tenir compte des majuscules ni des espaces) ? */
async function labelTaken(db, label, exceptId = null) {
  const wanted = label.trim().toLowerCase();
  const roles = await db('roles').select('id', 'label');
  return roles.some(r => r.id !== exceptId && r.label.trim().toLowerCase() === wanted);
}

/** Crée un rôle personnalisé avec ses droits ; sa clé est tirée du libellé. */
async function createRole(db, { label, description = null, permissions = [] }) {
  if (await labelTaken(db, label)) throw new HttpError(409, `Un rôle « ${label} » existe déjà.`);
  const base = roleKey(label);
  let id = base;
  for (let i = 2; await getRole(db, id); i++) id = `${base}_${i}`;
  const [{ max }] = await db('roles').max({ max: 'sort' });
  await db('roles').insert({ id, label, description, system: false, sort: Number(max || 0) + 1 });
  await setRolePermissions(db, id, permissions);
  return getRole(db, id);
}

async function updateRole(db, id, { label, description }) {
  const role = await requireRole(db, id);
  if (role.id === 'super_admin') throw new HttpError(400, 'Le rôle super administrateur ne peut pas être modifié.');
  if (label !== undefined && (await labelTaken(db, label, role.id))) throw new HttpError(409, `Un rôle « ${label} » existe déjà.`);
  const patch = { updated_at: new Date() };
  if (label !== undefined) patch.label = label;
  if (description !== undefined) patch.description = description;
  await db('roles').where({ id: role.id }).update(patch);
  return getRole(db, role.id);
}

/** Supprime un rôle personnalisé, seulement si plus aucun compte (actif ou non) ne l'utilise. */
async function deleteRole(db, id) {
  const role = await requireRole(db, id);
  if (PROTECTED_ROLES.includes(role.id)) throw new HttpError(400, 'Le rôle super administrateur ne peut pas être supprimé.');
  const [{ n }] = await db('users').where({ role: role.id }).count({ n: '*' });
  if (Number(n)) {
    throw new HttpError(409, `Ce rôle est encore attribué à ${n} compte(s). Changez d’abord leur rôle dans « Utilisateurs ».`);
  }
  await db.transaction(async trx => {
    await trx('role_permissions').where({ role: role.id }).del();
    await trx('roles').where({ id: role.id }).del();
  });
  invalidate(db);
}

module.exports = { listRoles, getRole, requireRole, createRole, updateRole, deleteRole };
