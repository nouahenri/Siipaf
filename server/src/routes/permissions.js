/**
 * Rôles & privilèges : consultation (droit « Voir les utilisateurs ») et modification
 * (réservée au super administrateur, pour empêcher quiconque de s'attribuer des droits) :
 * droits de chaque rôle, création / renommage / suppression de rôles, privilèges par compte.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../lib/http');
const { requirePermission } = require('../auth');
const { PERMISSIONS, PERMISSION_CATALOG, PERMISSION_IDS } = require('../lib/domain');
const svc = require('../services/permissions');
const roles = require('../services/roles');

const superAdminOnly = (req, res, next) =>
  req.user.role === 'super_admin' ? next() : next(new HttpError(403, 'Seul le super administrateur peut modifier les privilèges.'));

/**
 * Créer un nouveau rôle avec ses privilèges : super administrateur, ou droit roles:write (DRH, direction…), qui
 * n'accorde que des privilèges qu'il a lui-même. Modifier, renommer ou supprimer un rôle existant reste au super
 * administrateur (choix du client du 23/10).
 */
const canManageRoles = req => req.user.role === 'super_admin' || req.can('roles:write');
const rolesWriter = (req, res, next) =>
  canManageRoles(req) ? next() : next(new HttpError(403, 'Créer un rôle demande le droit « Créer de nouveaux rôles ».'));
async function checkGrant(db, req, permissions) {
  if (req.user.role === 'super_admin') return;
  const mine = await svc.effectivePermissions(db, req.user);
  const beyond = permissions.filter(p => !svc.hasPermission(mine, p));
  if (beyond.length) throw new HttpError(403, `Vous ne pouvez pas accorder un privilège que vous n’avez pas : ${beyond.join(', ')}.`);
}
const canRead = (req, res, next) => (req.can('users:read') || canManageRoles(req) ? next() : next(new HttpError(403, 'Droits insuffisants.')));

const permissionList = z.array(z.string().refine(p => PERMISSION_IDS.includes(p), 'Privilège inconnu')).max(PERMISSION_IDS.length);
const roleFields = {
  label: z.string().trim().min(2, 'Libellé : 2 caractères minimum.').max(120),
  description: z.string().trim().max(255).nullish().transform(v => v || null),
};

/** Rôle dont on peut régler les droits : tout rôle existant sauf le super administrateur. */
async function editableRole(db, id) {
  const role = await roles.getRole(db, id);
  if (!role || role.id === 'super_admin') throw new HttpError(400, 'Ce rôle ne peut pas être modifié.');
  return role;
}

module.exports = function permissionRoutes(db) {
  const r = express.Router();

  // Catalogue + droits actuels et par défaut de chaque rôle
  r.get('/permissions', canRead, ah(async (req, res) => {
    const list = [];
    for (const role of await roles.listRoles(db)) {
      const permissions = await svc.rolePermissions(db, role.id);
      list.push({
        id: role.id,
        label: role.label,
        description: role.description,
        system: !!role.system,
        locked: role.id === 'super_admin',
        permissions,
        // Réglage par défaut : celui du code pour les rôles d'origine ; un rôle créé n'a que le sien
        defaults: role.id === 'super_admin' ? ['*'] : role.system ? (PERMISSIONS[role.id] || []).filter(p => p !== '*') : permissions,
      });
    }
    // Comptes actifs par rôle (affichage) et tous comptes confondus (la suppression en dépend)
    const counts = await db('users').where({ active: true }).select('role').count({ n: '*' }).groupBy('role');
    const totals = await db('users').select('role').count({ n: '*' }).groupBy('role');
    const overrides = await db('user_permissions').count({ n: '*' });
    res.json({
      catalog: PERMISSION_CATALOG.map(g => ({ group: g.group, items: g.items.map(([id, label, hint]) => ({ id, label, hint })) })),
      roles: list.map(r => ({
        ...r,
        users: Number(counts.find(c => c.role === r.id)?.n || 0),
        users_total: Number(totals.find(c => c.role === r.id)?.n || 0),
      })),
      can_edit: req.user.role === 'super_admin',
      // Création d'un nouveau rôle : super administrateur ou droit roles:write
      can_create: canManageRoles(req), my_role: req.user.role,
      my_permissions: req.user.role === 'super_admin' ? ['*'] : await svc.effectivePermissions(db, req.user),
      users_with_overrides: Number(overrides[0].n),
    });
  }));

  // Nouveau rôle : libellé, description facultative et droits cochés dans le catalogue
  r.post('/permissions/roles', rolesWriter, ah(async (req, res) => {
    const data = parse(z.object({ ...roleFields, permissions: permissionList.default([]) }), req.body);
    await checkGrant(db, req, data.permissions);
    const role = await roles.createRole(db, { ...data, permissions: [...new Set(data.permissions)] });
    res.status(201).json({ ...role, system: !!role.system, permissions: await svc.rolePermissions(db, role.id) });
  }));

  // Renommer un rôle (sa clé technique, enregistrée sur les comptes, ne change pas)
  r.patch('/permissions/roles/:role', requirePermission('users:read'), superAdminOnly, ah(async (req, res) => {
    const data = parse(z.object(roleFields).partial(), req.body);
    const role = await roles.updateRole(db, req.params.role, data);
    res.json({ ...role, system: !!role.system });
  }));

  r.delete('/permissions/roles/:role', requirePermission('users:read'), superAdminOnly, ah(async (req, res) => {
    await roles.deleteRole(db, req.params.role);
    res.json({ ok: true });
  }));

  // Régler un rôle existant change les droits de tous ses comptes : super administrateur seul (choix du client du 23/10)
  r.put('/permissions/roles/:role', requirePermission('users:read'), superAdminOnly, ah(async (req, res) => {
    const role = await editableRole(db, req.params.role);
    const permissions = parse(permissionList, req.body.permissions);
    await svc.setRolePermissions(db, role.id, [...new Set(permissions)]);
    res.json({ role: role.id, permissions: await svc.rolePermissions(db, role.id) });
  }));

  r.post('/permissions/roles/:role/reset', requirePermission('users:read'), superAdminOnly, ah(async (req, res) => {
    const role = await editableRole(db, req.params.role);
    if (!role.system) throw new HttpError(400, 'Un rôle créé dans le dashboard n’a pas de réglage par défaut.');
    await svc.resetRolePermissions(db, role.id);
    res.json({ role: role.id, permissions: await svc.rolePermissions(db, role.id) });
  }));

  // Privilèges d'un compte : hérités du rôle, accordés en plus, retirés
  const userView = async user => {
    const overrides = await db('user_permissions').where({ user_id: user.id });
    return {
      user_id: user.id,
      role: user.role,
      role_permissions: await svc.rolePermissions(db, user.role),
      overrides: Object.fromEntries(overrides.map(o => [o.permission, !!o.granted])),
      effective: await svc.effectivePermissions(db, user),
    };
  };

  r.get('/users/:id/permissions', requirePermission('users:read'), ah(async (req, res) => {
    const user = await db('users').where({ id: idParam(req) }).first();
    if (!user) throw new HttpError(404, 'Utilisateur introuvable.');
    res.json(await userView(user));
  }));

  r.put('/users/:id/permissions', requirePermission('users:read'), superAdminOnly, ah(async (req, res) => {
    const user = await db('users').where({ id: idParam(req) }).first();
    if (!user) throw new HttpError(404, 'Utilisateur introuvable.');
    if (user.role === 'super_admin') throw new HttpError(400, 'Le super administrateur a déjà tous les droits.');
    const overrides = parse(z.record(z.boolean()), req.body.overrides || {});
    const unknown = Object.keys(overrides).filter(p => !PERMISSION_IDS.includes(p));
    if (unknown.length) throw new HttpError(400, `Privilège inconnu : ${unknown.join(', ')}`);
    // On ne garde que les vraies différences avec le rôle
    const rolePerms = new Set(await svc.rolePermissions(db, user.role));
    const rows = Object.entries(overrides)
      .filter(([p, granted]) => granted !== rolePerms.has(p))
      .map(([permission, granted]) => ({ user_id: user.id, permission, granted }));
    await db.transaction(async trx => {
      await trx('user_permissions').where({ user_id: user.id }).del();
      if (rows.length) await trx('user_permissions').insert(rows);
    });
    res.json(await userView(user));
  }));

  return r;
};
