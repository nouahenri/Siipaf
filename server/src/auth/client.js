/**
 * Sessions de l'espace client : cookie distinct de celui du dashboard et jetons signés avec une clé
 * dérivée, de sorte qu'un jeton client n'ouvre jamais l'API admin (et inversement).
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { jwtSecret, isProd } = require('../config');
const { HttpError } = require('../lib/http');

const CLIENT_COOKIE = 'siipaf_client';
const clientSecret = crypto.createHmac('sha256', jwtSecret).update('espace-client').digest('hex');

function issueClientSession(res, account) {
  const token = jwt.sign({ sub: account.id, kind: 'client' }, clientSecret, { expiresIn: '12h' });
  res.cookie(CLIENT_COOKIE, token, { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/', maxAge: 1000 * 60 * 60 * 12 });
}

function clearClientSession(res) {
  res.clearCookie(CLIENT_COOKIE, { path: '/' });
}

/**
 * Charge le compte client connecté et son acquéreur. Tant que le mot de passe provisoire
 * n'a pas été changé, seules les routes marquées `allowPending` répondent.
 */
function requireClient(db, { allowPending = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = req.cookies[CLIENT_COOKIE];
      if (!token) throw new HttpError(401, 'Connexion requise.');
      let payload;
      try { payload = jwt.verify(token, clientSecret); } catch { throw new HttpError(401, 'Session expirée, reconnectez-vous.'); }
      if (payload.kind !== 'client') throw new HttpError(401, 'Session invalide.');
      const account = await db('client_accounts').where({ id: payload.sub, active: true }).first();
      if (!account) throw new HttpError(401, 'Accès introuvable ou désactivé.');
      if (account.must_change_password && !allowPending) {
        throw new HttpError(403, 'Choisissez votre mot de passe personnel pour continuer.', { code: 'PASSWORD_CHANGE_REQUIRED' });
      }
      req.client = account;
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { CLIENT_COOKIE, issueClientSession, clearClientSession, requireClient };
