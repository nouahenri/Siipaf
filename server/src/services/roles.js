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

/** Libellé comparable : sans majuscules, accents, ponctuation ni espaces en trop (même règle que admin/src/lib/permissions.js). */
const roleName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Libellé déjà pris par un autre rôle ? Renvoie ce rôle (« Secrétariat » = « secretariat » = « Secrétariat. »). */
async function labelTaken(db, label, exceptId = null) {
  const wanted = roleName(label);
  const roles = await db('roles').select('id', 'label');
  return roles.find(r => r.id !== exceptId && roleName(r.label) === wanted) || null;
}

/** Crée un rôle personnalisé avec ses droits ; sa clé est tirée du libellé. */
async function createRole(db, { label, description = null, permissions = [] }) {
  const taken = await labelTaken(db, label);
  if (taken) throw new HttpError(409, `Le rôle « ${taken.label} » existe déjà : choisissez un autre nom ou modifiez ce rôle.`);
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
  const taken = label !== undefined && (await labelTaken(db, label, role.id));
  if (taken) throw new HttpError(409, `Le rôle « ${taken.label} » existe déjà : choisissez un autre nom.`);
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
  // ERP : un changement de poste planifié qui donnera ce rôle laisserait le compte sans droits
  const planned = await db('hr_position_changes').where({ role: role.id, status: 'planifie' }).count({ n: '*' }).first().catch(() => ({ n: 0 }));
  if (Number(planned.n)) {
    throw new HttpError(409, `Ce rôle est prévu par ${planned.n} changement(s) de poste planifié(s) (ERP › RH › fiche employé › Carrière) : annulez-les ou changez de rôle d’abord.`);
  }
  await db.transaction(async trx => {
    await trx('role_permissions').where({ role: role.id }).del();
    // Postes de l'ERP qui le proposaient : plus de rôle proposé (ils restent valables)
    if (await trx.schema.hasTable('hr_positions')) await trx('hr_positions').where({ default_role: role.id }).update({ default_role: null, updated_at: new Date() });
    await trx('roles').where({ id: role.id }).del();
  });
  invalidate(db);
}

module.exports = { listRoles, getRole, requireRole, createRole, updateRole, deleteRole };
