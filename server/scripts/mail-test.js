/**
 * Vérifie la configuration SMTP de server/.env et envoie un e-mail de test (le mot de passe n'est jamais affiché).
 *   node scripts/mail-test.js [destinataire]      (par défaut : MAIL_NOTIFY)
 */
require('dotenv').config();
const nodemailer = require('nodemailer');
const { smtp } = require('../src/config');

(async () => {
  const to = process.argv[2] || smtp.notify;
  if (!smtp.host || !smtp.user || !smtp.password) throw new Error('SMTP incomplet : SMTP_HOST, SMTP_USER et SMTP_PASSWORD sont requis dans server/.env.');
  if (!to) throw new Error('Destinataire manquant (argument ou MAIL_NOTIFY).');
  console.log(`Serveur ${smtp.host}:${smtp.port} (${smtp.secure ? 'SSL/TLS' : 'STARTTLS'}), compte ${smtp.user}, expéditeur ${smtp.from}`);
  const t = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: { user: smtp.user, pass: smtp.password } });
  await t.verify();
  console.log('Connexion et authentification SMTP : OK');
  const info = await t.sendMail({
    from: smtp.from, to, subject: '[SIIPAF] Test d’envoi des e-mails',
    text: `Ce message confirme que le serveur SIIPAF envoie bien ses e-mails par ${smtp.host} avec le compte ${smtp.user}.\n\nEnvoyé le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' })} (heure d’Abidjan).`,
  });
  console.log(`E-mail de test envoyé à ${to} (${info.messageId}).`);
  console.log('MAIL_TEST_OK');
})().catch(err => {
  // Message d'erreur du serveur SMTP, sans les identifiants
  console.error(`Échec : ${err.code || ''} ${err.response || err.message}`.trim());
  process.exit(1);
});
