/**
 * Newsletter : campagnes, e-mail de test, lancement (file d'envoi figée sur les abonnés actifs du moment) et envoi
 * progressif (tick) selon le débit réglé. Une erreur d'authentification ou l'absence de SMTP met la campagne en pause ;
 * un échec sur une adresse est noté et l'envoi continue. Un abonné désinscrit pendant l'envoi n'est plus servi.
 */
const { HttpError, json, toDate, isoTime } = require('../lib/http');
const { DEFAULT_NEWSLETTER, renderCampaign, allowance } = require('../lib/newsletter');
const mailer = require('../lib/mailer'); // appelé via le module : remplaçable dans les tests
const { clientAppUrl } = require('../config');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const SITE_URL = (process.env.SITE_URL || 'https://siipaf.com').replace(/\/$/, '');
const STUCK_MS = 10 * 60 * 1000; // une adresse « en cours d'envoi » depuis 10 min (arrêt du serveur) repart

async function getSettings(db) {
  const row = await db('app_settings').where({ key: 'newsletter' }).first();
  return { ...DEFAULT_NEWSLETTER, ...(json(row?.value, {}) || {}) };
}
async function saveSettings(db, patch) {
  const next = { ...(await getSettings(db)), ...patch };
  if (next.per_minute > next.per_hour) throw new HttpError(400, 'Le débit par minute ne peut pas dépasser le débit par heure.');
  const row = { key: 'newsletter', value: JSON.stringify(next), updated_at: new Date() };
  if (await db('app_settings').where({ key: 'newsletter' }).first()) await db('app_settings').where({ key: 'newsletter' }).update(row);
  else await db('app_settings').insert(row);
  return next;
}

const serialize = c => c && ({ ...c, started_at: isoTime(c.started_at), finished_at: isoTime(c.finished_at), created_at: isoTime(c.created_at), updated_at: isoTime(c.updated_at) });

async function getCampaign(db, id) {
  const c = await db('newsletter_campaigns as c').leftJoin('users as u', 'u.id', 'c.created_by').leftJoin('users as l', 'l.id', 'c.launched_by').leftJoin('media as m', 'm.id', 'c.image_media_id')
    .where('c.id', id).first('c.*', 'u.name as created_by_name', 'l.name as launched_by_name', 'm.filename as image_filename', 'm.original_name as image_name');
  if (!c) throw new HttpError(404, 'Campagne introuvable.');
  return serialize(c);
}

/** HTML et texte de la campagne pour un destinataire (lien de désinscription personnel). */
function render(c, token = 'apercu') {
  return renderCampaign(c, {
    logoUrl: `${clientAppUrl}/logo-siipaf.png`, siteUrl: SITE_URL,
    imageUrl: c.image_filename ? `${clientAppUrl}/uploads/${c.image_filename}` : null,
    unsubscribeUrl: `${clientAppUrl}/api/public/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
  });
}

async function message(db, c, { to, token }) {
  const s = await getSettings(db);
  const { html, text } = render(c, token);
  const unsubscribe = `${clientAppUrl}/api/public/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
  const address = (mailer.smtp.from.match(/<([^>]+)>/) || [])[1] || mailer.smtp.from;
  return {
    from: `"${s.sender_name.replace(/"/g, '')}" <${address}>`, to, replyTo: s.reply_to || undefined, subject: c.subject, html, text,
    // Désinscription en un clic proposée par les messageries (RFC 8058)
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

async function sendTest(db, id, to) {
  const c = await getCampaign(db, id);
  const msg = await message(db, c, { to, token: 'test' });
  try { await mailer.deliver({ ...msg, subject: `[Test] ${msg.subject}` }); } catch (err) { throw new HttpError(502, `Envoi refusé par le serveur mail : ${err.response || err.message}`); }
  return { ok: true };
}

/** Lancement : la file est figée sur les abonnés actifs ; l'envoi démarre au prochain passage (chaque minute). */
async function launch(db, id, userId) {
  return db.transaction(async trx => {
    const c = await trx('newsletter_campaigns').where({ id }).first();
    if (!c) throw new HttpError(404, 'Campagne introuvable.');
    if (c.status !== 'brouillon') throw new HttpError(409, 'Cette campagne a déjà été lancée.');
    if (!c.subject || !(c.body || '').trim()) throw new HttpError(400, 'Objet et texte obligatoires.');
    const subs = await trx('newsletter_subscribers').where({ status: 'actif' }).select('id', 'email');
    if (!subs.length) throw new HttpError(400, 'Aucun abonné actif.');
    for (let i = 0; i < subs.length; i += 200) {
      await trx('newsletter_sends').insert(subs.slice(i, i + 200).map(s => ({ campaign_id: id, subscriber_id: s.id, email: s.email })));
    }
    await trx('newsletter_campaigns').where({ id }).update({ status: 'en_cours', total: subs.length, sent: 0, failed: 0, last_error: null, launched_by: userId, started_at: new Date(), updated_at: new Date() });
    return subs.length;
  });
}

async function setStatus(db, id, action) {
  const c = await db('newsletter_campaigns').where({ id }).first();
  if (!c) throw new HttpError(404, 'Campagne introuvable.');
  const moves = { pause: ['en_cours', 'pause'], resume: ['pause', 'en_cours'], cancel: [['en_cours', 'pause'], 'annulee'] };
  const [from, to] = moves[action];
  if (![].concat(from).includes(c.status)) throw new HttpError(409, 'Action impossible dans l’état actuel de la campagne.');
  await db('newsletter_campaigns').where({ id }).update({ status: to, ...(to === 'annulee' ? { finished_at: new Date() } : {}), ...(to === 'en_cours' ? { last_error: null } : {}), updated_at: new Date() });
  if (to === 'annulee') await db('newsletter_sends').where({ campaign_id: id }).whereIn('status', ['en_attente', 'envoi']).update({ status: 'ignore', error: 'Campagne annulée' });
}

// Tout message remis au serveur mail compte dans le débit, qu'il soit accepté ou non
const countSince = async (db, since) => Number((await db('newsletter_sends').whereIn('status', ['envoye', 'echec']).where('sent_at', '>=', since).count({ n: '*' }).first()).n);

async function refreshCounts(db, id) {
  const rows = await db('newsletter_sends').where({ campaign_id: id }).groupBy('status').select('status').count({ n: '*' });
  const by = Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
  const left = (by.en_attente || 0) + (by.envoi || 0);
  const patch = { sent: by.envoye || 0, failed: by.echec || 0, updated_at: new Date() };
  const c = await db('newsletter_campaigns').where({ id }).first();
  if (!left && c.status === 'en_cours') Object.assign(patch, { status: 'envoyee', finished_at: new Date() });
  await db('newsletter_campaigns').where({ id }).update(patch);
}

/**
 * Passage d'envoi (chaque minute dans le serveur, ou par une tâche planifiée cPanel) : envoie au plus ce que le
 * débit permet, campagne par campagne dans l'ordre de lancement. Chaque adresse est réservée avant l'envoi, ce qui
 * évite un double envoi si deux passages se chevauchent.
 */
async function tick(db, now = new Date()) {
  const s = await getSettings(db);
  await db('newsletter_sends').where({ status: 'envoi' }).where('claimed_at', '<', new Date(now - STUCK_MS)).update({ status: 'en_attente', claimed_at: null });
  let budget = allowance(s, await countSince(db, new Date(now - 60000)), await countSince(db, new Date(now - 3600000)));
  let delivered = 0;
  const campaigns = await db('newsletter_campaigns').where({ status: 'en_cours' }).orderBy('started_at');
  for (const raw of campaigns) {
    if (budget <= 0) break;
    const c = await getCampaign(db, raw.id);
    const batch = await db('newsletter_sends').where({ campaign_id: c.id, status: 'en_attente' }).orderBy('id').limit(budget);
    for (const send of batch) {
      const claimed = await db('newsletter_sends').where({ id: send.id, status: 'en_attente' }).update({ status: 'envoi', claimed_at: now });
      if (!claimed) continue;
      const sub = send.subscriber_id ? await db('newsletter_subscribers').where({ id: send.subscriber_id }).first() : null;
      if (!sub || sub.status !== 'actif') { await db('newsletter_sends').where({ id: send.id }).update({ status: 'ignore', error: 'Désinscrit avant l’envoi' }); continue; }
      try {
        await mailer.deliver(await message(db, c, { to: send.email, token: sub.unsubscribe_token }));
        await db('newsletter_sends').where({ id: send.id }).update({ status: 'envoye', sent_at: now, error: null });
        budget--; delivered++;
      } catch (err) {
        const detail = `${err.code || ''} ${err.response || err.message}`.trim().slice(0, 300);
        // Erreur du serveur mail lui-même (identifiants, quota, SMTP absent) : pause, l'adresse repart plus tard
        if (['EAUTH', 'ENOSMTP', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET'].includes(err.code) || /quota|rate|too many|limit/i.test(detail) || (err.responseCode >= 421 && err.responseCode < 500)) {
          await db('newsletter_sends').where({ id: send.id }).update({ status: 'en_attente', claimed_at: null });
          await db('newsletter_campaigns').where({ id: c.id }).update({ status: 'pause', last_error: `Envoi suspendu : ${detail}`, updated_at: new Date() });
          await refreshCounts(db, c.id);
          return { delivered, paused: c.id };
        }
        await db('newsletter_sends').where({ id: send.id }).update({ status: 'echec', error: detail, sent_at: now });
      }
    }
    await refreshCounts(db, c.id);
  }
  return { delivered };
}

/** Chiffres d'une campagne et dernières erreurs. */
async function detail(db, id) {
  const c = await getCampaign(db, id);
  const rows = await db('newsletter_sends').where({ campaign_id: id }).groupBy('status').select('status').count({ n: '*' });
  const counts = Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
  const failures = await db('newsletter_sends').where({ campaign_id: id, status: 'echec' }).orderBy('id', 'desc').limit(50).select('email', 'error', 'sent_at');
  const s = await getSettings(db);
  const left = (counts.en_attente || 0) + (counts.envoi || 0);
  return {
    ...c, counts, failures: failures.map(f => ({ ...f, sent_at: isoTime(f.sent_at) })),
    eta_minutes: c.status === 'en_cours' && left ? Math.ceil(Math.max(left / s.per_minute, (left / s.per_hour) * 60)) : null,
    active_subscribers: Number((await db('newsletter_subscribers').where({ status: 'actif' }).count({ n: '*' }).first()).n),
  };
}

module.exports = { getSettings, saveSettings, getCampaign, render, sendTest, launch, setStatus, tick, detail, serialize, toDate, insertedId };
