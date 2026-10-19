/**
 * Espace client : accès des acquéreurs, réinitialisation du mot de passe, et vues cloisonnées
 * de leurs dossiers (bien, échéancier, versements, documents, chantier).
 * Tout ce qu'un client voit passe par ici, toujours filtré sur son propre lead_id.
 */
const crypto = require('crypto');
const { HttpError, isoDay, isoTime, toDate, json } = require('../lib/http');
const { hashPassword } = require('../auth');
const { sendMail } = require('../lib/mailer');
const { clientAppUrl } = require('../config');
const { CLIENT_RESET_HOURS, CLIENT_VISIBLE_SALE_STATUSES, SITE_STAGE_LABELS, PAYMENT_METHODS, phoneKey, looksLikeClientCode } = require('../lib/domain');
const { totals } = require('./sales');
const { scheduleStatus } = require('./schedule');

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

/** Mot de passe provisoire lisible (sans 0/O, 1/l/I) à transmettre au client. */
function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}

/** Code client saisi au clavier → forme canonique (SIIPAF-2026-0001). */
const normalizeCode = code => String(code || '').trim().toUpperCase().replace(/\s+/g, '');

async function findAccountByCode(db, code) {
  return db('client_accounts as a').join('leads as l', 'l.id', 'a.lead_id')
    .where('l.client_code', normalizeCode(code))
    .select('a.*', 'l.client_code', 'l.email', 'l.name').first();
}

/**
 * Compte client à partir de ce que la personne a saisi : son code client ou son numéro de téléphone
 * (comme sur l'ancienne plateforme). Un numéro partagé par plusieurs accès ne connecte personne :
 * il faut alors utiliser le code client.
 */
async function findAccountByLogin(db, login) {
  if (looksLikeClientCode(login)) return findAccountByCode(db, login);
  const key = phoneKey(login);
  if (!key) return null;
  const rows = await db('client_accounts as a').join('leads as l', 'l.id', 'a.lead_id')
    .whereNotNull('l.phone')
    .select('a.*', 'l.client_code', 'l.email', 'l.name', 'l.phone');
  const matches = rows.filter(r => phoneKey(r.phone) === key);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Ouvre (ou réinitialise) l'accès d'un acquéreur avec un mot de passe provisoire, à changer
 * à la première connexion. Le mot de passe n'est renvoyé qu'une fois, pour être transmis au client.
 */
async function grantAccess(db, { leadId, user, notify = true }) {
  const lead = await db('leads').where({ id: leadId }).first();
  if (!lead) throw new HttpError(404, 'Prospect introuvable.');
  if (!lead.client_code) throw new HttpError(409, 'Ce prospect n’a pas encore de dossier d’acquisition (pas de code client).');
  const password = generatePassword();
  const patch = {
    password_hash: await hashPassword(password), must_change_password: true, active: true,
    reset_token_hash: null, reset_expires_at: null, updated_at: new Date(),
  };
  const existing = await db('client_accounts').where({ lead_id: lead.id }).first();
  if (existing) await db('client_accounts').where({ id: existing.id }).update(patch);
  else await db('client_accounts').insert({ ...patch, lead_id: lead.id, created_by: user.id });

  let emailed = false;
  if (notify && lead.email) {
    emailed = await sendMail({
      to: lead.email,
      subject: 'Votre espace client SIIPAF',
      text: [
        `Bonjour ${lead.name},`,
        '',
        'Votre espace client SIIPAF est ouvert. Vous y suivrez l’avancement du chantier, vos documents et vos paiements.',
        '',
        `Adresse : ${clientAppUrl}`,
        `Code client : ${lead.client_code}`,
        `Mot de passe provisoire : ${password}`,
        '',
        'Vous choisirez votre mot de passe personnel à la première connexion.',
        '',
        'SIIPAF SA',
      ].join('\n'),
    });
  }
  return { account: await accessStatus(db, lead.id), password, emailed };
}

async function accessStatus(db, leadId) {
  const a = await db('client_accounts').where({ lead_id: leadId }).first();
  if (!a) return null;
  return { id: a.id, active: !!a.active, must_change_password: !!a.must_change_password, last_login_at: isoTime(a.last_login_at), created_at: isoTime(a.created_at) };
}

/** Demande de réinitialisation : réponse identique que le compte existe ou non. */
async function requestReset(db, login) {
  const account = await findAccountByLogin(db, login);
  if (!account || !account.active || !account.email) return;
  const token = crypto.randomBytes(32).toString('hex');
  await db('client_accounts').where({ id: account.id }).update({
    reset_token_hash: sha256(token),
    reset_expires_at: new Date(Date.now() + CLIENT_RESET_HOURS * 3600 * 1000),
    updated_at: new Date(),
  });
  await sendMail({
    to: account.email,
    subject: 'Réinitialisation de votre mot de passe — espace client SIIPAF',
    text: [
      `Bonjour ${account.name},`,
      '',
      `Pour choisir un nouveau mot de passe, ouvrez ce lien (valable ${CLIENT_RESET_HOURS} heure) :`,
      `${clientAppUrl}/reinitialiser?jeton=${token}`,
      '',
      'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.',
      '',
      'SIIPAF SA',
    ].join('\n'),
  });
}

async function resetPassword(db, token, password) {
  const account = await db('client_accounts').where({ reset_token_hash: sha256(String(token)), active: true }).first();
  const expires = account && toDate(account.reset_expires_at);
  if (!account || !expires || expires.getTime() < Date.now()) throw new HttpError(400, 'Lien invalide ou expiré. Refaites une demande.');
  await db('client_accounts').where({ id: account.id }).update({
    password_hash: await hashPassword(password), must_change_password: false,
    reset_token_hash: null, reset_expires_at: null, updated_at: new Date(),
  });
  return account;
}

// ─── Vues client (toujours limitées au lead connecté) ────────────────

async function mediaList(db, ids) {
  const list = (json(ids, []) || []).map(Number).filter(Boolean);
  if (!list.length) return [];
  const rows = await db('media').whereIn('id', list).select('id', 'filename', 'mime', 'alt', 'width', 'height');
  const byId = Object.fromEntries(rows.map(m => [m.id, m]));
  return list.filter(id => byId[id]).map(id => {
    const m = byId[id];
    return { id: m.id, url: `/uploads/${m.filename}`, mime: m.mime, alt: m.alt, width: m.width, height: m.height, kind: m.mime.startsWith('video/') ? 'video' : 'image' };
  });
}

/** Points d'avancement qui concernent un lot : ceux du projet entier, de son îlot et du lot lui-même. */
function siteUpdatesQuery(db, lot, { onlyVisible = true } = {}) {
  const q = db('site_updates').where('project_id', lot.project_id).where(w => {
    w.where('lot_id', lot.id).orWhere(w2 => {
      w2.whereNull('lot_id').where(w3 => {
        w3.whereNull('ilot');
        if (lot.ilot) w3.orWhere('ilot', lot.ilot);
      });
    });
  });
  if (onlyVisible) q.where('visible_client', true);
  return q.orderBy([{ column: 'published_at', order: 'desc' }, { column: 'id', order: 'desc' }]);
}

async function serializeUpdate(db, u) {
  return {
    id: u.id, stage: u.stage, stage_label: SITE_STAGE_LABELS[u.stage], progress_pct: u.progress_pct,
    title: u.title, body: u.body, scope: u.lot_id ? 'lot' : u.ilot ? 'ilot' : 'projet', ilot: u.ilot,
    published_at: isoTime(u.published_at), media: await mediaList(db, u.media),
  };
}

/** Récupère un dossier du client connecté ou lève une 404 (même réponse si le dossier est à un autre client). */
async function ownSale(db, leadId, saleId) {
  const sale = await db('sales').where({ id: saleId, lead_id: leadId }).whereIn('status', CLIENT_VISIBLE_SALE_STATUSES).first();
  if (!sale) throw new HttpError(404, 'Dossier introuvable.');
  return sale;
}

async function saleContext(db, sale) {
  const lot = await db('lots').where({ id: sale.lot_id }).first();
  const [project, offer] = await Promise.all([
    db('projects').where({ id: lot.project_id }).select('id', 'name', 'slug', 'city', 'location', 'delivery', 'cover_media_id').first(),
    lot.offer_id ? db('project_offers').where({ id: lot.offer_id }).select('label', 'surface').first() : null,
  ]);
  const cover = project.cover_media_id ? await db('media').where({ id: project.cover_media_id }).select('filename').first() : null;
  return {
    lot,
    property: {
      lot_code: lot.code, ilot: lot.ilot, surface_m2: lot.surface_m2 == null ? null : Number(lot.surface_m2),
      type: offer ? offer.label : null, type_surface: offer ? offer.surface : null,
      project: { id: project.id, name: project.name, slug: project.slug, city: project.city, location: project.location, delivery: project.delivery, cover_url: cover ? `/uploads/${cover.filename}` : null },
    },
  };
}

/** Résumé d'un dossier pour l'accueil de l'espace client. */
async function saleSummary(db, sale) {
  const { lot, property } = await saleContext(db, sale);
  const t = await totals(db, sale);
  const schedule = await scheduleStatus(db, sale, t);
  const latest = await siteUpdatesQuery(db, lot).first();
  return {
    id: sale.id, status: sale.status, price_fcfa: Number(sale.price_fcfa), financing: sale.financing,
    financing_label: schedule.financing_label, reserved_at: isoDay(sale.reserved_at), signed_at: isoDay(sale.signed_at),
    ...t, overdue_fcfa: schedule.overdue_fcfa, overdue_count: schedule.overdue_count, next_due: schedule.next_due,
    property,
    progress: latest ? { stage: latest.stage, stage_label: SITE_STAGE_LABELS[latest.stage], progress_pct: latest.progress_pct, updated_at: isoTime(latest.published_at) } : null,
  };
}

async function clientSales(db, leadId) {
  const sales = await db('sales').where({ lead_id: leadId }).whereIn('status', CLIENT_VISIBLE_SALE_STATUSES).orderBy('id');
  return Promise.all(sales.map(s => saleSummary(db, s)));
}

const receiptNumber = p => `REC-${(isoDay(p.paid_at) || '').slice(0, 4)}-${String(p.id).padStart(5, '0')}`;

/** Dossier complet vu par le client : rien d'interne (notes, auteurs des saisies, documents masqués). */
async function clientSaleDetail(db, leadId, saleId) {
  const sale = await ownSale(db, leadId, saleId);
  const summary = await saleSummary(db, sale);
  const [payments, documents, schedule] = await Promise.all([
    db('payments').where({ sale_id: sale.id }).orderBy([{ column: 'paid_at', order: 'desc' }, { column: 'id', order: 'desc' }]),
    db('sale_documents').where({ sale_id: sale.id, visible_client: true }).orderBy('sort'),
    scheduleStatus(db, sale, summary),
  ]);
  return {
    ...summary,
    schedule: schedule.lines,
    payments: payments.map(p => ({
      id: p.id, receipt_number: receiptNumber(p), amount_fcfa: Number(p.amount_fcfa), paid_at: isoDay(p.paid_at),
      method: PAYMENT_METHODS.includes(p.method) ? p.method : 'autre', reference: p.reference,
    })),
    documents: documents.map(d => ({
      id: d.id, type: d.type, label: d.label, status: d.status, note: d.note, updated_at: isoTime(d.updated_at),
      download_url: d.media_id ? `/api/client/documents/${d.id}/fichier` : null,
    })),
  };
}

/** Document téléchargeable par le client connecté (sinon 404). */
async function clientDocumentFile(db, leadId, docId) {
  const doc = await db('sale_documents as d').join('sales as s', 's.id', 'd.sale_id').join('media as m', 'm.id', 'd.media_id')
    .where({ 'd.id': docId, 'd.visible_client': true, 's.lead_id': leadId }).whereIn('s.status', CLIENT_VISIBLE_SALE_STATUSES)
    .select('d.label', 'm.filename', 'm.original_name', 'm.mime').first();
  if (!doc) throw new HttpError(404, 'Document introuvable.');
  return doc;
}

module.exports = {
  generatePassword, normalizeCode, findAccountByCode, findAccountByLogin, grantAccess, accessStatus, requestReset, resetPassword,
  mediaList, siteUpdatesQuery, serializeUpdate, ownSale, saleContext, clientSales, clientSaleDetail, clientDocumentFile,
  receiptNumber,
};
