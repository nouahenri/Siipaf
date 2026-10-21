/**
 * Passage d'envoi des campagnes de newsletter, pour une tâche planifiée cPanel (toutes les 5 minutes par exemple),
 * en complément de l'envoi fait par le serveur chaque minute : il garantit l'envoi même si l'application est en veille.
 *   cd ~/siipaf-api/server && node scripts/newsletter-send.js
 */
require('dotenv').config();
const { createDb } = require('../src/db');
const newsletter = require('../src/services/newsletter');

(async () => {
  const db = createDb();
  try {
    const r = await newsletter.tick(db);
    if (r.delivered || r.paused) console.log(`[newsletter] ${r.delivered} e-mail(s) envoyé(s)${r.paused ? `, campagne ${r.paused} mise en pause` : ''}`);
  } finally { await db.destroy(); }
})().catch(e => { console.error('[newsletter]', e.message); process.exit(1); });
