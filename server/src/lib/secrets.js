/**
 * Chiffrement des secrets enregistrés en base (jetons Meta, secret de l'application) : AES-256-GCM, clé de 32 octets dérivée (HKDF)
 * de META_SECRETS_KEY si elle est définie dans server/.env, sinon de JWT_SECRET. Le texte chiffré a la forme v1:iv:tag:données
 * (base64). Un secret chiffré n'est JAMAIS renvoyé au navigateur : seules sa présence et ses 4 derniers caractères sont montrés.
 * Attention : changer la clé (ou JWT_SECRET) rend les secrets enregistrés illisibles ; il faut alors les saisir de nouveau.
 */
const crypto = require('crypto');
const { jwtSecret } = require('../config');

const keyMaterial = () => String(process.env.META_SECRETS_KEY || '').trim() || jwtSecret;
const derive = () => Buffer.from(crypto.hkdfSync('sha256', keyMaterial(), 'siipaf-secrets', 'meta-v1', 32));

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derive(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** Texte clair, ou null si la valeur est absente, altérée ou chiffrée avec une autre clé. */
function decrypt(payload) {
  if (!payload) return null;
  const [version, iv, tag, data] = String(payload).split(':');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derive(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

/** Ce que l'on montre d'un secret : présent ou non, 4 derniers caractères. */
const mask = plain => ({ present: !!plain, last4: plain ? String(plain).slice(-4) : null });

module.exports = { encrypt, decrypt, mask };
