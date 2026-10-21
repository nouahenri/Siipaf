const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { ah, parse, HttpError } = require('../lib/http');
const { checkPassword, hashPassword, issueSession, clearSession, requireAuth, publicUser, roleLabel } = require('../auth');
const { effectivePermissions } = require('../services/permissions');
const { isTest } = require('../config');
const { THEMES } = require('../lib/domain');

module.exports = function authRoutes(db) {
  const r = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: isTest ? 1000 : 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' } });

  r.post('/login', loginLimiter, ah(async (req, res) => {
    const { email, password } = parse(z.object({
      email: z.string().trim().toLowerCase().email('E-mail invalide'),
      password: z.string().min(1, 'Mot de passe requis'),
    }), req.body);
    const user = await db('users').where({ email }).first();
    // Même message dans tous les cas pour ne pas révéler les comptes existants
    if (!user || !user.active || !(await checkPassword(password, user.password_hash))) {
      throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
    }
    await db('users').where({ id: user.id }).update({ last_login_at: new Date() });
    issueSession(res, user);
    res.json({ user: { ...publicUser(user), role_label: await roleLabel(db, user.role) }, permissions: await effectivePermissions(db, user) });
  }));

  r.post('/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth(db), (req, res) => {
    res.json({ user: req.user, permissions: req.user.permissions });
  });

  r.post('/password', requireAuth(db), ah(async (req, res) => {
    const { current, next } = parse(z.object({
      current: z.string().min(1),
      next: z.string().min(10, 'Le nouveau mot de passe doit faire au moins 10 caractères.'),
    }), req.body);
    const user = await db('users').where({ id: req.user.id }).first();
    if (!(await checkPassword(current, user.password_hash))) throw new HttpError(400, 'Mot de passe actuel incorrect.');
    if (next === current) throw new HttpError(400, 'Choisissez un mot de passe différent du mot de passe provisoire.');
    await db('users').where({ id: user.id }).update({ password_hash: await hashPassword(next), must_change_password: false, updated_at: new Date() });
    res.json({ ok: true });
  }));

  // Préférences d'affichage du compte (thème clair, sombre ou celui du système)
  r.patch('/preferences', requireAuth(db), ah(async (req, res) => {
    const { theme } = parse(z.object({ theme: z.enum(THEMES) }), req.body);
    await db('users').where({ id: req.user.id }).update({ theme, updated_at: new Date() });
    res.json({ theme });
  }));

  return r;
};
