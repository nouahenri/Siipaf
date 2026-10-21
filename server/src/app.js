const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { corsOrigins, uploadsDir, isProd, isTest, adminHost, erpHost } = require('./config');
const { HttpError } = require('./lib/http');
const { requireAuth } = require('./auth');
const { throttledExpiry } = require('./services/lots');

/** Construit l'application Express (sans écouter de port : app.js à la racine s'en charge). */
function createApp(db) {
  const app = express();
  app.set('trust proxy', 1); // derrière le proxy Passenger / LiteSpeed de cPanel
  app.disable('x-powered-by');
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // blob: : images lues dans le navigateur avant envoi (dimensions d'une photo, import d'un plan)
    contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'] } },
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // CORS : seul le site public (autre domaine) appelle l'API publique
  app.use('/api/public', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', async (req, res) => {
    await db.raw('select 1');
    res.json({ ok: true });
  });

  const { publicTestimonials, adminTestimonials } = require('./routes/testimonials');
  app.use('/api/public', require('./routes/public')(db));
  app.use('/api/public', publicTestimonials(db));
  app.use('/api/public', require('./routes/erp/recrutement').publicCareers(db));
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/client/sav', require('./routes/clientSav')(db));
  app.use('/api/client', require('./routes/client')(db));

  const admin = express.Router();
  admin.use(requireAuth(db));
  admin.use(require('./routes/permissions')(db));
  admin.use('/users', require('./routes/users')(db));
  admin.use(require('./routes/catalog')(db));
  admin.use(require('./routes/sales')(db));
  admin.use(require('./routes/crm')(db));
  admin.use(require('./routes/content')(db));
  admin.use(adminTestimonials(db));
  admin.use(require('./routes/clientAdmin')(db));
  admin.use(require('./routes/imports')(db));
  admin.use(require('./routes/settings')(db));
  admin.use('/erp/sav', require('./routes/erp/sav')(db));
  admin.use('/erp/commercial', require('./routes/erp/commercial')(db));
  admin.use('/erp/compta', require('./routes/erp/compta')(db));
  admin.use('/erp/paie', require('./routes/erp/paie')(db));
  admin.use('/erp/rh', require('./routes/erp/rh')(db));
  admin.use('/erp/rh', require('./routes/erp/presences')(db));
  admin.use('/erp/rh', require('./routes/erp/frais')(db));
  admin.use('/erp/rh', require('./routes/erp/recrutement')(db));
  admin.use('/erp/rh', require('./routes/erp/competences')(db));
  app.use('/api/admin', admin);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

  // Fichiers téléversés
  app.get('/uploads/by-id/:id', async (req, res, next) => {
    try {
      const m = await db('media').where({ id: Number(req.params.id) || 0 }).first();
      if (!m) return res.sendStatus(404);
      res.redirect(301, `/uploads/${m.filename}`);
    } catch (err) { next(err); }
  });
  // Photos du SAV et dossiers du personnel (RH) : servis uniquement par l'API, après contrôle
  app.use('/uploads/private', (req, res) => res.sendStatus(404));
  // Pièces juridiques jointes à un dossier d'acquisition : jamais publiques. Seule l'équipe autorisée
  // les ouvre ici ; le client passe par /api/client/documents/:id/fichier (contrôle de propriété).
  app.use('/uploads', async (req, res, next) => {
    try {
      const name = path.basename(decodeURIComponent(req.path));
      const legal = await db('media as m').join('sale_documents as d', 'd.media_id', 'm.id').where('m.filename', name).first('m.filename');
      if (!legal) return next();
      requireAuth(db)(req, res, err => {
        if (err || !(req.can('sales:read') || req.can('documents:write'))) return res.sendStatus(404);
        res.set('Cache-Control', 'private, no-store');
        res.sendFile(path.join(uploadsDir, legal.filename), e => e && !res.headersSent && res.sendStatus(404));
      });
    } catch (err) { next(err); }
  });
  app.use('/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true, index: false }));

  // Interfaces compilées, choisies selon l'adresse : admin.siipaf.com → dashboard (admin/dist),
  // erp.siipaf.com → ERP (ERP-SIIPAF/dist), client.siipaf.com → espace client (client/dist).
  // En local : admin.localhost:4000, erp.localhost:4000 et localhost:4000.
  const appFor = req => (req.hostname === adminHost ? 'admin' : req.hostname === erpHost ? 'erp' : 'client');
  const otherHost = (req, host) => `${req.protocol}://${host}${(req.get('host') || '').replace(/^[^:]*/, '')}`;
  // Anciennes adresses (/admin, /espace-client) → nouvelles
  app.get(/^\/admin(\/|$)/, (req, res) => res.redirect(301, otherHost(req, adminHost) + (req.originalUrl.slice(6) || '/')));
  app.get(/^\/espace-client(\/|$)/, (req, res) => res.redirect(301, req.originalUrl.slice(14) || '/'));
  const spa = (dist, name) => {
    if (!fs.existsSync(dist)) return;
    const files = express.static(dist, { index: false, maxAge: '1h' });
    app.use((req, res, next) => (appFor(req) === name ? files(req, res, next) : next()));
    app.get(/^\/(?!api\/|uploads\/)/, (req, res, next) => (appFor(req) === name ? res.sendFile(path.join(dist, 'index.html')) : next()));
  };
  spa(path.join(__dirname, '..', '..', 'admin', 'dist'), 'admin');
  spa(path.join(__dirname, '..', '..', 'ERP-SIIPAF', 'dist'), 'erp');
  spa(path.join(__dirname, '..', '..', 'client', 'dist'), 'client');

  // Erreurs
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) err = new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (200 Mo maximum).' : err.message);
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'JSON invalide.');
    const status = err.status || 500;
    if (status >= 500 && !isTest) console.error(err);
    res.status(status).json({
      error: status >= 500 && isProd ? 'Erreur interne.' : err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  });

  // Expiration des options même sans trafic sur les lots
  if (!isTest) {
    const expire = throttledExpiry(db, 0);
    setInterval(() => expire().catch(e => console.error('[options]', e.message)), 5 * 60 * 1000).unref();
  }

  return app;
}

module.exports = { createApp };
