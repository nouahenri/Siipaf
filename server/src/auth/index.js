const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn, isProd } = require('../config');
const { HttpError } = require('../lib/http');
const { effectivePermissions, hasPermission } = require('../services/permissions');

const COOKIE = 'siipaf_session';

const hashPassword = plain => bcrypt.hash(plain, 12);
const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: 1000 * 60 * 60 * 12,
  });
  return token;
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** Charge l'utilisateur connecté (cookie ou en-tête Bearer) et vérifie qu'il est actif. */
function requireAuth(db) {
  return async (req, res, next) => {
    try {
      const header = req.get('authorization') || '';
      const token = req.cookies[COOKIE] || (header.startsWith('Bearer ') ? header.slice(7) : null);
      if (!token) throw new HttpError(401, 'Connexion requise.');
      let payload;
      try { payload = jwt.verify(token, jwtSecret); } catch { throw new HttpError(401, 'Session expirée, reconnectez-vous.'); }
      const user = await db('users').where({ id: payload.sub, active: true }).first();
      if (!user) throw new HttpError(401, 'Compte introuvable ou désactivé.');
      req.user = { ...publicUser(user), role_label: await roleLabel(db, user.role) };
      // Droits effectifs (rôle + privilèges propres au compte), réglables dans « Rôles & privilèges »
      req.user.permissions = await effectivePermissions(db, user);
      req.can = permission => hasPermission(req.user.permissions, permission);
      next();
    } catch (err) { next(err); }
  };
}

/** Exige une permission parmi les droits effectifs du compte connecté. */
const requirePermission = permission => (req, res, next) => {
  if (!req.user || !req.can || !req.can(permission)) return next(new HttpError(403, 'Droits insuffisants.'));
  next();
};

/** Libellé du rôle tel que réglé dans « Rôles & privilèges » (les rôles peuvent être créés ou renommés). */
async function roleLabel(db, role) {
  const row = await db('roles').where({ id: role }).first('label');
  return row ? row.label : role;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, active: !!u.active, last_login_at: u.last_login_at, theme: u.theme || 'systeme' };
}

module.exports = { hashPassword, checkPassword, issueSession, clearSession, requireAuth, requirePermission, publicUser, roleLabel, COOKIE };
