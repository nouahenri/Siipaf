/**
 * Import de prospects et de clients (fichier CSV ou Excel lu dans le dashboard, envoyé ici en lignes JSON).
 * Chaque ligne passe par les mêmes règles que la saisie à la main : dédoublonnage des prospects
 * (e-mail / téléphone), ouverture du dossier d'acquisition (lot réservé, échéancier, pièces),
 * reprise des sommes déjà versées. Un client sans n° de lot (export de l'ancienne plateforme) reçoit
 * seulement son code client et son type de bien. Une ligne en erreur n'empêche pas les autres.
 * En simulation (dryRun), tout est vérifié puis annulé : rien n'est enregistré.
 */
const { HttpError } = require('../lib/http');
const { FINANCINGS, LEAD_STAGES } = require('../lib/domain');
const { findOrCreateLead } = require('./lots');
const { openSale, refreshSaleStatus, totals, nextClientCode, EARLY_STAGES } = require('./sales');
const { generatePassword } = require('./clients');
const { hashPassword } = require('../auth');
const { syncLead, createImport, seesAllLeads } = require('./portfolio');

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

/** Téléphone lu comme un nombre par Excel (2250708972671) : on lui rend son indicatif « + ». */
const phoneCell = v => (typeof v === 'number' && v >= 1e10 ? `+${v}` : text(v));

const yes = v =>['oui', 'yes', 'o', 'x', '1', 'vrai', 'true'].includes(fold(v));

async function findProject(trx, value, projects) {
  const f = fold(value);
  if (!f) return null;
  return projects.find(p => fold(p.slug) === f || fold(p.name) === f)
    || projects.find(p => fold(p.name).includes(f) || f.includes(fold(p.slug)));
}

/** Une ligne de prospect. */
async function importLead(trx, row, ctx) {
  // Nom et prénom peuvent venir de deux colonnes (export de l'ancienne plateforme)
  const name = [text(row.name), text(row.first_name)].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  if (name.length < 2) throw new HttpError(400, 'Nom manquant.');
  if (!text(row.phone) && !text(row.email)) throw new HttpError(400, 'Il faut un téléphone ou un e-mail.');
  const email = text(row.email).toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, `E-mail invalide : ${email}`);
  const project = await findProject(trx, row.project, ctx.projects);
  if (text(row.project) && !project) throw new HttpError(400, `Projet inconnu : ${row.project}`);
  const fin = financing(row.financing);
  if (fin === 'invalide') throw new HttpError(400, `Financement inconnu : ${row.financing}`);
  const lead = await findOrCreateLead(trx, {
    name, email, phone: phoneCell(row.phone) || null, country: text(row.country) || null,
    is_diaspora: yes(row.diaspora) || fin === 'diaspora', source: ctx.source || 'import', financing: fin,
    project_id: project?.id || null, message: text(row.notes) || null,
  });
  const stage = fold(row.stage);
  if (stage && LEAD_STAGES.includes(stage) && lead.created) await trx('leads').where({ id: lead.id }).update({ stage });
  // Un nouveau prospect est attribué au commercial choisi pour la liste ; une personne déjà connue garde le sien
  if (lead.created && ctx.assignTo) {
    await trx('leads').where({ id: lead.id }).update({ assigned_to: ctx.assignTo });
    lead.assigned_to = ctx.assignTo;
  }
  // Reprise de l'ancienne plateforme : type de bien et numéro du client (jamais écrasés)
  const legacy = { property_type: text(row.property_type).slice(0, 160), legacy_number: text(row.legacy_number).slice(0, 20) };
  const patch = Object.fromEntries(Object.entries(legacy).filter(([k, v]) => v && !lead[k]));
  if (Object.keys(patch).length) {
    await trx('leads').where({ id: lead.id }).update(patch);
    Object.assign(lead, patch);
  }
  return { lead, project };
}

/**
 * Client repris sans lot ni prix (l'ancienne plateforme ne connaissait que le type de bien) :
 * il reçoit son code client et passe en « paiement » ; le dossier d'acquisition sera ouvert plus tard.
 */
async function importClientWithoutSale(trx, lead, project, row) {
  const patch = {};
  const code = text(row.client_code).toUpperCase().replace(/\s+/g, '');
  if (!lead.client_code) {
    if (code && (await trx('leads').where({ client_code: code }).first())) throw new HttpError(400, `Code client déjà utilisé : ${code}`);
    patch.client_code = code || await nextClientCode(trx);
  } else if (code && code !== lead.client_code) {
    throw new HttpError(400, `Ce client a déjà le code ${lead.client_code}.`);
  }
  if (project && !lead.project_id) patch.project_id = project.id;
  if (EARLY_STAGES.includes(lead.stage)) patch.stage = 'paiement';
  if (Object.keys(patch).length) await trx('leads').where({ id: lead.id }).update({ ...patch, updated_at: new Date() });
  return { lead: { ...lead, ...patch }, lot: null, sale: null };
}

/** Une ligne de client : prospect + dossier d'acquisition + sommes déjà versées. */
async function importClient(trx, row, ctx) {
  const { lead, project } = await importLead(trx, row, ctx);
  const lotCode = text(row.lot);
  if (!lotCode) return importClientWithoutSale(trx, lead, project, row);
  if (!project) throw new HttpError(400, 'Projet manquant pour ce client.');
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

/**
 * Ouvre l'espace client d'un client importé qui n'a pas encore d'accès (un accès existant n'est jamais
 * réinitialisé). Le mot de passe provisoire n'est renvoyé qu'une fois, dans le compte rendu de l'import.
 */
async function openAccess(trx, leadId, user) {
  if (await trx('client_accounts').where({ lead_id: leadId }).first()) return null;
  const lead = await trx('leads').where({ id: leadId }).select('client_code', 'phone').first();
  const password = generatePassword();
  await trx('client_accounts').insert({ lead_id: leadId, password_hash: await hashPassword(password), must_change_password: true, active: true, created_by: user.id });
  return { client_code: lead.client_code, phone: lead.phone, temporary_password: password };
}

function clientAction(lead, lot, dryRun) {
  if (lot) return `Dossier ${lot.code}`;
  // En simulation chaque ligne est annulée : le prochain code calculé serait le même pour toutes
  return dryRun ? 'Client sans dossier (code attribué à l’import)' : `Client sans dossier · ${lead.client_code}`;
}

/**
 * `list` : liste de prospects (un fichier = une liste) — { id } pour les paquets suivants d'un même fichier, sinon
 * { name, filename, assigned_to } pour la créer au premier paquet enregistré. Un commercial sans le droit « voir les
 * prospects de toute l'équipe » s'attribue toujours ses propres nouveaux prospects.
 */
async function runImport(db, { mode, rows, dryRun, createLots, openAccess: withAccess, user, list = null }) {
  const projects = await db('projects').select('id', 'name', 'slug');
  let importId = list?.id || null;
  let assignTo = list?.assigned_to || null;
  if (importId) {
    const existing = await db('lead_imports').where({ id: importId }).first();
    if (!existing || existing.created_by !== user.id) throw new HttpError(404, 'Liste d’import introuvable.');
    assignTo = existing.assigned_to;
  } else if (!seesAllLeads(user)) assignTo = user.id;
  if (assignTo && !(await db('users').where({ id: assignTo, active: true }).first('id'))) throw new HttpError(400, 'Commercial introuvable ou désactivé.');
  if (!dryRun && !importId && list) {
    importId = await createImport(db, { name: list.name || list.filename || `Import du ${new Date().toLocaleDateString('fr-FR')}`, filename: list.filename, mode, assigned_to: assignTo, user });
  }
  const ctx = { projects, createLots, user, assignTo };
  const report = [];
  for (const [i, row] of rows.entries()) {
    const line = row._line || i + 2; // ligne 1 = en-têtes
    try {
      let result;
      let access = null;
      await db.transaction(async trx => {
        result = mode === 'clients' ? await importClient(trx, row, ctx) : await importLead(trx, row, ctx);
        if (dryRun) throw ROLLBACK;
        await syncLead(trx, result.lead.id, { by: user.id, reason: 'import', importId });
        if (importId && !(await trx('lead_import_items').where({ import_id: importId, lead_id: result.lead.id }).first())) {
          await trx('lead_import_items').insert({ import_id: importId, lead_id: result.lead.id, duplicate: !result.lead.created, line });
        }
        if (mode === 'clients' && withAccess) access = await openAccess(trx, result.lead.id, user);
      }).catch(e => { if (e !== ROLLBACK) throw e; });
      const { lead, lot } = result;
      report.push({
        line, ok: true, name: lead.name,
        action: mode === 'clients' ? clientAction(lead, lot, dryRun) : lead.created ? 'Nouveau prospect' : 'Prospect existant complété',
        ...(access ? { access } : {}),
      });
    } catch (e) {
      report.push({ line, ok: false, name: [text(row.name), text(row.first_name)].filter(Boolean).join(' '), error: e.status ? e.message : `Erreur : ${e.message}` });
    }
  }
  const ok = report.filter(r => r.ok).length, errors = report.filter(r => !r.ok).length;
  if (importId && !dryRun) {
    const items = await db('lead_import_items').where({ import_id: importId }).select('duplicate');
    await db('lead_imports').where({ id: importId }).update({
      rows_total: db.raw('rows_total + ?', [rows.length]), error_count: db.raw('error_count + ?', [errors]),
      created_count: items.filter(i => !i.duplicate).length, duplicate_count: items.filter(i => i.duplicate).length, updated_at: new Date(),
    });
  }
  return { dryRun, total: rows.length, ok, errors, report, import_id: importId };
}

/**
 * Nouveau client saisi à la main (bouton « Nouveau client ») : mêmes règles qu'une ligne d'import sans lot.
 * Une personne déjà connue (même téléphone ou e-mail) est reprise ; si elle est déjà cliente, on le signale.
 */
async function createClient(db, row, user) {
  const projects = await db('projects').select('id', 'name', 'slug');
  return db.transaction(async trx => {
    const { lead, project } = await importLead(trx, row, { projects, user, source: 'admin', assignTo: seesAllLeads(user) ? null : user.id });
    if (lead.client_code) throw new HttpError(409, `${lead.name} est déjà client (${lead.client_code}).`);
    const out = (await importClientWithoutSale(trx, lead, project, row)).lead;
    await syncLead(trx, lead.id, { by: user.id, reason: 'creation' });
    return out;
  });
}

module.exports = { runImport, createClient, money, day, financing };
