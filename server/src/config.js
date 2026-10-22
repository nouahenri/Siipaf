const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET === 'change-moi' || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET doit être défini (32 caractères minimum) en production.');
}

module.exports = {
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT) || 4000,
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  jwtSecret: env.JWT_SECRET || 'dev-secret-non-securise-a-remplacer',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  optionDaysDefault: Number(env.OPTION_DAYS_DEFAULT) || 7,
  uploadsDir: path.join(__dirname, '..', 'uploads'),
  // Adresse publique de l'espace client (liens des e-mails : première connexion, mot de passe oublié)
  clientAppUrl: (env.CLIENT_APP_URL || 'http://localhost:4000').replace(/\/$/, ''),
  // Adresse du dashboard : le serveur y sert l'admin, et l'espace client partout ailleurs
  adminHost: env.ADMIN_HOST || 'admin.localhost',
  // Adresse de l'ERP (ERP-SIIPAF/dist), même serveur et même base
  erpHost: env.ERP_HOST || 'erp.localhost',
  // Adresse publique de l'ERP (liens des e-mails d'alerte)
  erpUrl: (env.ERP_URL || (isProd ? 'https://erp.siipaf.com' : 'http://erp.localhost:4000')).replace(/\/$/, ''),
  smtp: {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 465,
    secure: env.SMTP_SECURE !== 'false',
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.MAIL_FROM || 'SIIPAF SA <info@siipaf.com>',
    notify: env.MAIL_NOTIFY,
  },
};
