const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const common = {
  migrations: { directory: path.join(__dirname, 'migrations') },
  seeds: { directory: path.join(__dirname, 'seeds') },
};

function config() {
  const env = process.env;
  if (env.NODE_ENV === 'test') {
    return { ...common, client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true };
  }
  if ((env.DB_CLIENT || 'sqlite') === 'mysql') {
    return {
      ...common,
      client: 'mysql2',
      connection: {
        host: env.DB_HOST || 'localhost',
        port: Number(env.DB_PORT) || 3306,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        charset: 'utf8mb4',
        timezone: 'Z',
        dateStrings: false,
      },
      pool: { min: 0, max: 8 },
    };
  }
  const filename = path.resolve(__dirname, env.DB_FILENAME || './data/siipaf.sqlite');
  require('fs').mkdirSync(path.dirname(filename), { recursive: true });
  return { ...common, client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true };
}

module.exports = config();
