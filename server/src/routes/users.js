const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../lib/http');
const { hashPassword, requirePermission, publicUser } = require('../auth');
const { listRoles, requireRole } = require('../services/roles');

module.exports = function userRoutes(db) {
  const r = express.Router();

  // Rôles proposés dans les sélecteurs : ceux d'origine et ceux créés dans « Rôles & privilèges »
  r.get('/roles', ah(async (req, res) => {
    res.json((await listRoles(db)).map(role => ({ id: role.id, label: role.label, system: !!role.system })));
  }));

  r.get('/', requirePermission('users:read'), ah(async (req, res) => {
    const users = await db('users').orderBy('name');
    res.json(users.map(publicUser));
  }));

  // Liste courte pour les sélecteurs (assigner un prospect à un commercial…)
  // (plus les rôles créés dans le dashboard qui ont le droit « Gérer les prospects »)
  r.get('/commerciaux', ah(async (req, res) => {
    const sellers = db('role_permissions').where({ permission: 'leads:write' }).select('role');
    const users = await db('users').where({ active: true })
      .where(q => q.whereIn('role', ['commercial', 'resp_exploitation', 'super_admin']).orWhereIn('role', sellers))
      .orderBy('name');
    res.json(users.map(u => ({ id: u.id, name: u.name, role: u.role })));
  }));

  const base = {
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().max(40).optional().nullable(),
    role: z.string().trim().min(1).max(40), // existence vérifiée dans la table roles
    active: z.boolean().optional(),
  };

  r.post('/', requirePermission('users:write'), ah(async (req, res) => {
    const data = parse(z.object({ ...base, password: z.string().min(10, 'Mot de passe : 10 caractères minimum.') }), req.body);
    await requireRole(db, data.role);
    if (await db('users').where({ email: data.email }).first()) throw new HttpError(409, 'Un compte existe déjà avec cet e-mail.');
    if (data.role === 'super_admin' && req.user.role !== 'super_admin') throw new HttpError(403, 'Seul un super administrateur peut créer un super administrateur.');
    const { password, ...rest } = data;
    const [id] = await db('users').insert({ ...rest, password_hash: await hashPassword(password) });
    res.status(201).json(publicUser(await db('users').where({ id }).first()));
  }));

  r.patch('/:id', requirePermission('users:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object({ ...base, password: z.string().min(10).optional() }).partial(), req.body);
    if (data.role) await requireRole(db, data.role);
    if (id === req.user.id && (data.active === false || (data.role && data.role !== req.user.role))) {
      throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre compte ni changer votre rôle.');
    }
    const target = await db('users').where({ id }).first();
    if (target && req.user.role !== 'super_admin' && (target.role === 'super_admin' || data.role === 'super_admin')) {
      throw new HttpError(403, 'Seul un super administrateur peut modifier un super administrateur.');
    }
    const { password, ...rest } = data;
    const patch = { ...rest, updated_at: new Date() };
    if (password) patch.password_hash = await hashPassword(password);
    const n = await db('users').where({ id }).update(patch);
    if (!n) throw new HttpError(404, 'Utilisateur introuvable.');
    res.json(publicUser(await db('users').where({ id }).first()));
  }));

  return r;
};
