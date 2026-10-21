const nodemailer = require('nodemailer');
const { smtp, isTest } = require('../config');

let transport;
const sent = []; // en test : boîte d'envoi inspectable

function getTransport() {
  if (!transport && smtp.host && smtp.user) {
    transport = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.password },
    });
  }
  return transport;
}

/** Envoie un e-mail ; sans SMTP configuré (dev, test), le message est seulement journalisé. */
async function sendMail({ to, subject, text, html }) {
  if (!to) return false;
  const message = { from: smtp.from, to, subject, text, html };
  if (isTest) { sent.push(message); return true; }
  const t = getTransport();
  if (!t) {
    console.log(`[mail non envoyé — SMTP non configuré] à ${to} : ${subject}`);
    return false;
  }
  try {
    await t.sendMail(message);
    return true;
  } catch (err) {
    console.error('[mail] échec :', err.message);
    return false;
  }
}

function notifyTeam(subject, text) {
  return sendMail({ to: smtp.notify, subject: `[SIIPAF] ${subject}`, text });
}

/**
 * Envoi qui remonte les erreurs (campagnes : chaque échec est noté, une erreur d'authentification met l'envoi en
 * pause). `message` : from, to, subject, text, html, headers, replyTo.
 */
async function deliver(message) {
  if (isTest) { sent.push(message); return { messageId: `test-${sent.length}` }; }
  const t = getTransport();
  if (!t) { const err = new Error('SMTP non configuré (server/.env).'); err.code = 'ENOSMTP'; throw err; }
  return t.sendMail(message);
}

module.exports = { sendMail, notifyTeam, deliver, sent, smtp };
