/**
 * Sauvegarde nocturne (tâche cron sur cPanel) : base de données + fichiers envoyés (uploads).
 *   node scripts/backup.js            → dossier ~/sauvegardes (ou BACKUP_DIR)
 * Base : un fichier .sql.gz par jour, gardé BACKUP_DAYS jours (14 par défaut).
 * Fichiers : une archive .tgz par jour, seules les BACKUP_UPLOADS_KEEP dernières sont gardées (7 par défaut).
 * Le mot de passe MySQL passe par l'environnement (MYSQL_PWD), jamais par la ligne de commande.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { uploadsDir } = require('../src/config');

const env = process.env;
const dir = env.BACKUP_DIR || path.join(os.homedir(), 'sauvegardes');
const days = Number(env.BACKUP_DAYS) || 14;
const keepUploads = Number(env.BACKUP_UPLOADS_KEEP) || 7;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-'); // 20261020-0230
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

function dumpMysql() {
  return new Promise((resolve, reject) => {
    const file = path.join(dir, `siipaf-base-${stamp}.sql.gz`);
    const dump = spawn('mysqldump', [
      '--single-transaction', '--quick', '--routines', '--no-tablespaces',
      '-h', env.DB_HOST || 'localhost', '-P', String(env.DB_PORT || 3306), '-u', env.DB_USER, env.DB_NAME,
    ], { env: { ...env, MYSQL_PWD: env.DB_PASSWORD } });
    const out = fs.createWriteStream(file, { mode: 0o600 });
    let err = '';
    dump.stderr.on('data', d => { err += d; });
    dump.stdout.pipe(zlib.createGzip()).pipe(out);
    dump.on('close', code => (code === 0 ? out.on('close', () => resolve(file)) : reject(new Error(`mysqldump (${code}) : ${err.trim()}`))));
  });
}

function copySqlite() {
  const src = path.resolve(__dirname, '..', env.DB_FILENAME || './data/siipaf.sqlite');
  const file = path.join(dir, `siipaf-base-${stamp}.sqlite.gz`);
  fs.writeFileSync(file, zlib.gzipSync(fs.readFileSync(src)), { mode: 0o600 });
  return file;
}

function archiveUploads() {
  const file = path.join(dir, `siipaf-fichiers-${stamp}.tgz`);
  const r = spawnSync('tar', ['--force-local', '-czf', file, '-C', path.dirname(uploadsDir), path.basename(uploadsDir)]);
  if (r.status !== 0) throw new Error(`tar : ${String(r.stderr).trim()}`);
  fs.chmodSync(file, 0o600);
  return file;
}

function prune() {
  const files = fs.readdirSync(dir).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
  const limit = Date.now() - days * 86400000;
  files.filter(x => x.f.startsWith('siipaf-base-') && x.t < limit).forEach(x => fs.rmSync(path.join(dir, x.f)));
  files.filter(x => x.f.startsWith('siipaf-fichiers-')).sort((a, b) => b.t - a.t).slice(keepUploads)
    .forEach(x => fs.rmSync(path.join(dir, x.f)));
}

(async () => {
  try {
    const db = env.DB_CLIENT === 'mysql' ? await dumpMysql() : copySqlite();
    log(`base sauvegardée : ${path.basename(db)} (${Math.round(fs.statSync(db).size / 1024)} Ko)`);
    const up = archiveUploads();
    log(`fichiers sauvegardés : ${path.basename(up)} (${Math.round(fs.statSync(up).size / 1024)} Ko)`);
    prune();
    log('anciennes sauvegardes nettoyées');
  } catch (err) {
    log(`ÉCHEC : ${err.message}`);
    process.exitCode = 1;
  }
})();
