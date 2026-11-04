/**
 * Sessions de l'espace client : cookie distinct de celui du dashboard et jetons signés avec une clé
 * dérivée, de sorte qu'un jeton client n'ouvre jamais l'API admin (et inversement).
 * L'application mobile (en-tête `X-Siipaf-App: mobile`) reçoit le jeton dans la réponse au lieu du cookie : 30 jours,
 * gardé dans le coffre sécurisé du téléphone et renvoyé en `Authorization: Bearer`. Chaque jeton porte la version des
 * jetons du compte (`token_version`) : un changement de mot de passe déconnecte les autres appareils.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { jwtSecret, isProd } = require('../config');
const { HttpError } = require('../lib/http');

const CLIENT_COOKIE = 'siipaf_client';
const clientSecret = crypto.createHmac('sha256', jwtSecret).update('espace-client').digest('hex');
const MOBILE_DAYS = 30;

/** Requête venue de l'application mobile SIIPAF. */
const fromMobileApp = req => String(req.get('x-siipaf-app') || '').toLowerCase() === 'mobile';

/**
 * Ouvre la session : cookie de 12 h pour le site, jeton de 30 jours renvoyé à l'application.
 * Renvoie le jeton mobile (ou null pour le site).
 */
function issueClientSession(res, account, req = null) {
  const v = Number(account.token_version) || 0;
  if (req && fromMobileApp(req)) {
    return jwt.sign({ sub: account.id, kind: 'client', aud: 'mobile', v }, clientSecret, { expiresIn: `${MOBILE_DAYS}d` });
  }
  const token = jwt.sign({ sub: account.id, kind: 'client', v }, clientSecret, { expiresIn: '12h' });
  res.cookie(CLIENT_COOKIE, token, { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/', maxAge: 1000 * 60 * 60 * 12 });
  return null;
}

function clearClientSession(res) {
  res.clearCookie(CLIENT_COOKIE, { path: '/' });
}

const bearer = req => {
  const h = String(req.get('authorization') || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

/**
 * Charge le compte client connecté et son acquéreur. Tant que le mot de passe provisoire
 * n'a pas été changé, seules les routes marquées `allowPending` répondent.
 */
function requireClient(db, { allowPending = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = bearer(req) || req.cookies[CLIENT_COOKIE];
      if (!token) throw new HttpError(401, 'Connexion requise.');
      let payload;
      try { payload = jwt.verify(token, clientSecret); } catch { throw new HttpError(401, 'Session expirée, reconnectez-vous.'); }
      if (payload.kind !== 'client') throw new HttpError(401, 'Session invalide.');
      const account = await db('client_accounts').where({ id: payload.sub, active: true }).first();
      if (!account) throw new HttpError(401, 'Accès introuvable ou désactivé.');
      // Jetons émis avant le dernier changement de mot de passe (les anciens jetons, sans version, restent valables jusqu'à leur fin)
      if (payload.v !== undefined && payload.v !== (Number(account.token_version) || 0)) throw new HttpError(401, 'Session expirée, reconnectez-vous.');
      if (account.must_change_password && !allowPending) {
        throw new HttpError(403, 'Choisissez votre mot de passe personnel pour continuer.', { code: 'PASSWORD_CHANGE_REQUIRED' });
      }
      req.client = account;
      req.clientViaApp = payload.aud === 'mobile';
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { CLIENT_COOKIE, MOBILE_DAYS, fromMobileApp, issueClientSession, clearClientSession, requireClient };
