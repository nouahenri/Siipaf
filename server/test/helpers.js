process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin@test.ci';
process.env.ADMIN_PASSWORD = 'motdepasse-admin-test';
process.env.MAIL_NOTIFY = 'equipe@test.ci';

const request = require('supertest');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

/** Base SQLite en mémoire migrée et peuplée, et l'application branchée dessus. */
async function setup() {
  const db = createDb();
  await db.migrate.latest();
  await db.seed.run();
  const app = createApp(db);
  return { db, app };
}

async function login(app, email = 'admin@test.ci', password = 'motdepasse-admin-test') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} : ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

async function createUser(db, role, email = `${role}@test.ci`) {
  await db('users').insert({ email, name: role, role, password_hash: await hashPassword('motdepasse-test-123') });
  return email;
}

module.exports = { setup, login, createUser, request };
