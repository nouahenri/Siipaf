/**
 * Import de prospects et de clients (fichier CSV ou Excel lu dans le dashboard, envoyé ici en lignes JSON).
 * Chaque ligne passe par les mêmes règles que la saisie à la main : dédoublonnage des prospects
 * (e-mail / téléphone), ouverture du dossier d'acquisition (lot réservé, échéancier, pièces),
 * reprise des sommes déjà versées. Une ligne en erreur n'empêche pas les autres.
 * En simulation (dryRun), tout est vérifié puis annulé : rien n'est enregistré.
 */
const { HttpError } = require('../lib/http');
const { FINANCINGS, LEAD_STAGES } = require('../lib/domain');
const { findOrCreateLead } = require('./lots');
const { openSale, refreshSaleStatus, totals } = require('./sales');

const ROLLBACK = Symbol('simulation');
const text = v => (v == null ? '' : String(v).trim());
const fold = s => text(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Montant saisi « 23 212 000 », « 23212000 FCFA » ou « 23.212.000 » → 23212000. */
function money(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/** Date « 31/01/2026 », « 2026-01-31 » ou nombre de jours Excel → « 2026-01-31 ». */
function day(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = text(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return 'invalide';
}

function financing(v) {
  const f = fold(v);
  if (!f) return null;
  if (f.includes('diaspora')) return 'diaspora';
  if (f.includes('credit') || f.includes('banc')) return 'credit';
  if (f.includes('comptant') || f.includes('cash')) return 'comptant';
  if (f.includes('apport') || f.includes('30')) return 'apport';
  return FINANCINGS.includes(f) ? f : 'invalide';
}

const yes = v => ['oui', 'yes', 'o', 'x', '1', 'vrai', 'true'].includes(fold(v));

async function findProject(trx, value, projects) {
  const f = fold(value);
  if (!f) return null;
  return projects.find(p => fold(p.slug) === f || fold(p.name) === f)
    || projects.find(p => fold(p.name).includes(f) || f.includes(fold(p.slug)));
}

/** Une ligne de prospect. */
async function importLead(trx, row, ctx) {
  const name = text(row.name);
  if (name.length < 2) throw new HttpError(400, 'Nom manquant.');
  if (!text(row.phone) && !text(row.email)) throw new HttpError(400, 'Il faut un téléphone ou un e-mail.');
  const email = text(row.email).toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, `E-mail invalide : ${email}`);
  const project = await findProject(trx, row.project, ctx.projects);
  if (text(row.project) && !project) throw new HttpError(400, `Projet inconnu : ${row.project}`);
  const fin = financing(row.financing);
  if (fin === 'invalide') throw new HttpError(400, `Financement inconnu : ${row.financing}`);
  const lead = await findOrCreateLead(trx, {
    name, email, phone: text(row.phone) || null, country: text(row.country) || null,
    is_diaspora: yes(row.diaspora) || fin === 'diaspora', source: 'import', financing: fin,
    project_id: project?.id || null, message: text(row.notes) || null,
  });
  const stage = fold(row.stage);
  if (stage && LEAD_STAGES.includes(stage) && lead.created) await trx('leads').where({ id: lead.id }).update({ stage });
  return { lead, project };
}

/** Une ligne de client : prospect + dossier d'acquisition + sommes déjà versées. */
async function importClient(trx, row, ctx) {
  const { lead, project } = await importLead(trx, row, ctx);
  if (!project) throw new HttpError(400, 'Projet manquant pour ce client.');
  const lotCode = text(row.lot);
  if (!lotCode) throw new HttpError(400, 'N° de lot manquant.');
  let lot = await trx('lots').where({ project_id: project.id, code: lotCode }).first();
  if (!lot) {
    if (!ctx.createLots) throw new HttpError(400, `Lot ${lotCode} introuvable dans ${project.name}.`);
    const [id] = await trx('lots').insert({ project_id: project.id, code: lotCode, ilot: text(row.ilot) || null, status: 'disponible' });
    await trx('lot_status_history').insert({ lot_id: id, to_status: 'disponible', user_id: ctx.user.id, reason: 'Création (import)' });
    lot = await trx('lots').where({ id }).first();
  }
  const price = money(row.price);
  if (Number.isNaN(price) || (price != null && price <= 0)) throw new HttpError(400, `Prix invalide : ${row.price}`);
  const fin = financing(row.financing);
  const reserved = day(row.reserved_at);
  if (reserved === 'invalide') throw new HttpError(400, `Date de réservation invalide : ${row.reserved_at}`);

  // Code client repris de l'ancienne plateforme
  const code = text(row.client_code).toUpperCase().replace(/\s+/g, '');
  if (code && code !== lead.client_code) {
    if (lead.client_code) throw new HttpError(400, `Ce client a déjà le code ${lead.client_code}.`);
    if (await trx('leads').where({ client_code: code }).first()) throw new HttpError(400, `Code client déjà utilisé : ${code}`);
    await trx('leads').where({ id: lead.id }).update({ client_code: code });
  }

  const sale = await openSale(trx, {
    lotId: lot.id, leadId: lead.id, price_fcfa: price ?? undefined, financing: fin || undefined,
    reserved_at: reserved ? new Date(`${reserved}T00:00:00Z`) : undefined, notes: 'Repris par import', user: ctx.user,
  });

  const paid = money(row.paid);
  if (Number.isNaN(paid)) throw new HttpError(400, `Montant versé invalide : ${row.paid}`);
  if (paid > 0) {
    const t = await totals(trx, sale);
    if (paid > t.remaining_fcfa) throw new HttpError(400, `Le montant versé (${paid}) dépasse le prix (${sale.price_fcfa}).`);
    const paidAt = day(row.paid_at) || reserved || new Date().toISOString().slice(0, 10);
    if (paidAt === 'invalide') throw new HttpError(400, `Date de versement invalide : ${row.paid_at}`);
    await trx('payments').insert({
      sale_id: sale.id, amount_fcfa: paid, paid_at: new Date(`${paidAt}T00:00:00Z`), method: 'autre',
      reference: 'Reprise ancienne plateforme', note: 'Cumul des versements à la date de l’import', recorded_by: ctx.user.id,
    });
    await refreshSaleStatus(trx, sale.id);
  }
  return { lead, lot, sale };
}

async function runImport(db, { mode, rows, dryRun, createLots, user }) {
  const projects = await db('projects').select('id', 'name', 'slug');
  const ctx = { projects, createLots, user };
  const report = [];
  for (const [i, row] of rows.entries()) {
    const line = row._line || i + 2; // ligne 1 = en-têtes
    try {
      let result;
      await db.transaction(async trx => {
        result = mode === 'clients' ? await importClient(trx, row, ctx) : await importLead(trx, row, ctx);
        if (dryRun) throw ROLLBACK;
      }).catch(e => { if (e !== ROLLBACK) throw e; });
      const { lead, lot } = result;
      report.push({
        line, ok: true, name: lead.name,
        action: mode === 'clients' ? `Dossier ${lot.code}` : lead.created ? 'Nouveau prospect' : 'Prospect existant complété',
      });
    } catch (e) {
      report.push({ line, ok: false, name: text(row.name), error: e.status ? e.message : `Erreur : ${e.message}` });
    }
  }
  return { dryRun, total: rows.length, ok: report.filter(r => r.ok).length, errors: report.filter(r => !r.ok).length, report };
}

module.exports = { runImport, money, day, financing };
