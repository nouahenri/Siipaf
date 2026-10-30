/**
 * Import d'un fichier exporté de Sage (point 4 du client du 29/10 : « complet et paramétrable ») : plan comptable,
 * écritures, soldes d'ouverture. Le navigateur lit le fichier (CSV, TXT, Excel) et envoie ses lignes avec la
 * correspondance des colonnes ; ici on interprète (dates, montants, comptes, tiers), on contrôle et, hors simulation,
 * on enregistre. Réimporter le même fichier ne crée pas de doublon (une écriture par journal, date et pièce).
 *
 * Comptes : un numéro Sage (souvent sur 8 chiffres, « 41110000 ») est rapproché du plan SIIPAF en ignorant les zéros
 * de fin (« 4111 ») ; à défaut, il est créé s'il se rattache à un compte du plan et que l'option le permet.
 */
const crypto = require('crypto');
const { HttpError, isoDay } = require('../lib/http');
const { accountClass, partnerKindOf, checkEntry } = require('../lib/compta');
const ct = require('./compta');

const KINDS = {
  plan: { label: 'Plan comptable', fields: [['account', 'Numéro de compte', true], ['label', 'Intitulé', true]] },
  ecritures: {
    label: 'Écritures',
    fields: [['journal', 'Code journal', true], ['date', 'Date', true], ['piece', 'N° de pièce', true], ['account', 'Compte général', true], ['partner', 'Compte tiers', false],
      ['label', 'Libellé', false], ['debit', 'Débit', false], ['credit', 'Crédit', false], ['amount', 'Montant (avec sens)', false], ['direction', 'Sens (D / C)', false], ['ref', 'Référence', false]],
  },
  balance: { label: 'Soldes d’ouverture (balance)', fields: [['account', 'Numéro de compte', true], ['label', 'Intitulé', false], ['debit', 'Débit', false], ['credit', 'Crédit', false], ['amount', 'Solde (signé)', false]] },
};
const DATE_FORMATS = ['JJMMAAAA', 'JJMMAA', 'JJ/MM/AAAA', 'JJ/MM/AA', 'AAAA-MM-JJ', 'AAAAMMJJ'];
const MAX_ERRORS = 200;

const text = v => (v == null ? '' : String(v).trim());
const normalize = code => code.replace(/0+$/, '') || code;

/** Date Sage → AAAA-MM-JJ ; un nombre (date Excel) est accepté. */
function parseDate(v, format) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = text(v).replace(/\s.*$/, '');
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  let y, m, d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) [y, m, d] = s.split('-');
  else if (format === 'AAAAMMJJ' && digits.length === 8) [y, m, d] = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)];
  else if (s.includes('/')) {
    const p = s.split('/');
    if (p.length !== 3) return null;
    [d, m, y] = p;
  } else if (digits.length === 8) [d, m, y] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
  else if (digits.length === 6) [d, m, y] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
  else return null;
  if (String(y).length === 2) y = `20${y}`;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Montant en francs CFA entiers ; « 1 500 000,00 », « 1500000.00 » ou un nombre. */
function parseAmount(v, decimal = ',') {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = text(v).replace(/[\s  ]/g, '');
  if (!s) return 0;
  const negative = /^-|-$|^\(.*\)$/.test(s);
  s = s.replace(/[()-]/g, '');
  s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isNaN(n) ? NaN : negative ? -n : n;
}

async function loadAccounts(db) {
  const rows = await db('acc_accounts').select('id', 'code', 'label', 'class', 'partner_kind', 'active');
  const byCode = new Map(rows.map(a => [a.code, a]));
  const byNorm = new Map();
  for (const a of rows) if (!byNorm.has(normalize(a.code))) byNorm.set(normalize(a.code), a);
  return { rows, byCode, byNorm };
}

/** Compte du plan pour un numéro Sage : exact, puis sans les zéros de fin ; sinon le parent auquel il se rattacherait. */
function resolveAccount(acc, code) {
  const exact = acc.byCode.get(code) || acc.byNorm.get(normalize(code));
  if (exact) return { account: exact };
  const n = normalize(code);
  for (let i = n.length - 1; i >= 2; i--) {
    const parent = acc.byCode.get(n.slice(0, i)) || acc.byNorm.get(n.slice(0, i));
    if (parent) return { parent, code: n.length >= 3 ? n : code };
  }
  return {};
}

/** Tiers Sage : code client SIIPAF-…, fournisseur F00001, matricule d'employé. */
async function partnerResolver(db) {
  const [clients, employees] = await Promise.all([
    db('leads').whereNotNull('client_code').select('id', 'client_code'),
    db.schema.hasTable('employees').then(has => (has ? db('employees').select('id', 'matricule') : [])),
  ]);
  const client = new Map(clients.map(c => [c.client_code.toUpperCase(), c.id]));
  const employe = new Map(employees.map(e => [String(e.matricule).toUpperCase(), e.id]));
  return async code => {
    const c = text(code).toUpperCase();
    if (!c) return null;
    if (client.has(c)) return { partner_type: 'client', partner_id: client.get(c) };
    if (employe.has(c)) return { partner_type: 'employe', partner_id: employe.get(c) };
    const f = /^F0*(\d+)$/.exec(c);
    if (f && await db('suppliers').where({ id: Number(f[1]) }).first('id')) return { partner_type: 'fournisseur', partner_id: Number(f[1]) };
    return undefined; // inconnu
  };
}

const sourceKey = (journal, date, piece) => {
  const key = `sage:${journal}:${date}:${piece}`;
  return key.length <= 60 ? key : `sage:${journal}:${date}:${crypto.createHash('sha1').update(piece).digest('hex').slice(0, 16)}`;
};

/**
 * Lit les lignes selon la correspondance des colonnes (`mapping` : champ → index de colonne) et renvoie
 * { summary, errors, warnings, preview } ; hors simulation (`dryRun` faux), enregistre ce qui est valable.
 */
async function run(db, { kind, rows, mapping, options = {}, dryRun = true, user, can }) {
  const def = KINDS[kind];
  if (!def) throw new HttpError(400, 'Type d’import inconnu.');
  for (const [field, label, required] of def.fields) if (required && !Number.isInteger(mapping[field])) throw new HttpError(400, `Colonne « ${label} » à indiquer.`);
  const { date_format: dateFormat = 'JJMMAAAA', decimal = ',' } = options;
  const errors = [], warnings = [];
  const err = (line, message) => { if (errors.length < MAX_ERRORS) errors.push({ line, message }); };
  const warn = (line, message) => { if (warnings.length < MAX_ERRORS) warnings.push({ line, message }); };
  const cell = (r, field) => (Number.isInteger(mapping[field]) ? r.cells[mapping[field]] : undefined);
  const acc = await loadAccounts(db);
  const toCreate = new Map(); // code → { label, parent }

  // Compte d'une ligne : existant, à créer (option), ou erreur
  const accountFor = (line, raw, label) => {
    const code = text(raw).replace(/\s/g, '');
    if (!/^[1-9]\d{1,11}$/.test(code)) { err(line, `Compte « ${text(raw)} » illisible.`); return null; }
    const found = resolveAccount(acc, code);
    if (found.account) return { code: found.account.code, id: found.account.id };
    if (toCreate.has(found.code || code)) return { code: found.code || code };
    if (!found.parent) { err(line, `Compte ${code} : aucun compte du plan auquel le rattacher.`); return null; }
    if (!options.create_accounts) { err(line, `Compte ${code} absent du plan (option « Créer les comptes manquants »).`); return null; }
    toCreate.set(found.code, { label: text(label).slice(0, 160) || `${found.parent.label} (Sage ${code})`, parent: found.parent.code });
    return { code: found.code };
  };
  const amountsOf = (r, line) => {
    let debit = parseAmount(cell(r, 'debit'), decimal), credit = parseAmount(cell(r, 'credit'), decimal);
    if (Number.isInteger(mapping.amount)) {
      const a = parseAmount(cell(r, 'amount'), decimal);
      const sens = text(cell(r, 'direction')).toUpperCase();
      if (Number.isNaN(a)) { err(line, `Montant « ${text(cell(r, 'amount'))} » illisible.`); return null; }
      if (sens) [debit, credit] = sens.startsWith('D') ? [Math.abs(a), 0] : [0, Math.abs(a)];
      else [debit, credit] = a >= 0 ? [a, 0] : [0, -a];
    }
    if (Number.isNaN(debit) || Number.isNaN(credit)) { err(line, 'Montant illisible.'); return null; }
    if (debit < 0) [debit, credit] = [0, credit - debit];
    if (credit < 0) [debit, credit] = [debit - credit, 0];
    if (!Number.isInteger(Math.round(debit * 100) / 100) || !Number.isInteger(Math.round(credit * 100) / 100)) {
      err(line, 'Montant avec des centimes : la comptabilité est tenue en francs CFA entiers.'); return null;
    }
    return { debit: Math.round(debit), credit: Math.round(credit) };
  };

  // ─── Plan comptable ───────────────────────────────────────
  if (kind === 'plan') {
    if (!can('compta:plan')) throw new HttpError(403, 'Importer le plan comptable demande le droit « Plan comptable et journaux ».');
    let known = 0, relabel = [];
    for (const r of rows) {
      const raw = text(cell(r, 'account')), label = text(cell(r, 'label'));
      if (!raw) continue;
      const code = raw.replace(/\s/g, '');
      const found = /^[1-9]\d{1,11}$/.test(code) ? resolveAccount(acc, code) : {};
      if (found.account) {
        known += 1;
        if (options.update_labels && label && label !== found.account.label && !found.account.system) relabel.push({ id: found.account.id, label: label.slice(0, 160) });
      } else if (!toCreate.has(found.code || code)) {
        const before = errors.length;
        const was = options.create_accounts;
        options.create_accounts = true; // l'import du plan crée par nature les comptes manquants
        accountFor(r.line, raw, label);
        options.create_accounts = was;
        if (errors.length > before) continue;
      }
    }
    if (!dryRun && !errors.length) await db.transaction(async trx => {
      await createAccounts(trx, toCreate);
      for (const x of relabel) await trx('acc_accounts').where({ id: x.id }).update({ label: x.label, updated_at: new Date() });
    });
    return { summary: { lines: rows.length, known, to_create: toCreate.size, relabeled: relabel.length, created: dryRun || errors.length ? 0 : toCreate.size },
      errors, warnings, preview: [...toCreate].slice(0, 50).map(([code, a]) => ({ code, label: a.label, parent: a.parent })) };
  }

  // ─── Soldes d'ouverture ───────────────────────────────────
  if (kind === 'balance') {
    if (!can('compta:opening')) throw new HttpError(403, 'Les soldes d’ouverture demandent le droit « Soldes d’ouverture et à-nouveaux ».');
    const fy = await db('acc_fiscal_years').where({ id: Number(options.fiscal_year_id) || 0 }).first();
    if (!fy) throw new HttpError(400, 'Choisissez l’exercice qui reçoit les soldes d’ouverture.');
    const lines = [];
    for (const r of rows) {
      if (!text(cell(r, 'account'))) continue;
      const a = accountFor(r.line, cell(r, 'account'), cell(r, 'label'));
      const m = amountsOf(r, r.line);
      if (!a || !m) continue;
      const net = m.debit - m.credit;
      if (!net) continue;
      if (accountClass(a.code) > 5) warn(r.line, `Compte ${a.code} (classe ${accountClass(a.code)}) : un solde d’ouverture ne porte normalement que sur les classes 1 à 5.`);
      lines.push({ account: a.code, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, label: text(cell(r, 'label')).slice(0, 255) || `Solde d’ouverture ${a.code}` });
    }
    const debit = lines.reduce((t, l) => t + l.debit, 0), credit = lines.reduce((t, l) => t + l.credit, 0);
    if (debit !== credit) err(null, `Balance déséquilibrée : débits ${debit.toLocaleString('fr-FR')} ≠ crédits ${credit.toLocaleString('fr-FR')}.`);
    const exists = await db('acc_entries').where({ source_key: `opening:${fy.id}` }).first('id');
    if (exists) err(null, `Les soldes d’ouverture de ${fy.label} existent déjà : supprimez le brouillon ou contrepassez-le avant de réimporter.`);
    let entry = null;
    if (!dryRun && !errors.length) entry = await db.transaction(async trx => {
      await createAccounts(trx, toCreate);
      return ct.createEntry(trx, { journal: 'AN', date: isoDay(fy.start_date), label: `Soldes d’ouverture ${fy.label} (import Sage)`, source: 'an', source_key: `opening:${fy.id}`, lines, userId: user.id });
    });
    return { summary: { lines: lines.length, debit, credit, accounts_to_create: toCreate.size, entry_id: entry?.id || null, fiscal_year: fy.label }, errors, warnings, preview: lines.slice(0, 50) };
  }

  // ─── Écritures ────────────────────────────────────────────
  if (!can('compta:import')) throw new HttpError(403, 'Importer des écritures demande le droit « Importer des écritures Sage ».');
  if (options.validate && !can('compta:validate')) throw new HttpError(403, 'Valider à l’import demande le droit « Valider les écritures ».');
  const journals = new Map((await db('acc_journals').select('id', 'code', 'label', 'kind')).map(j => [j.code, j]));
  const newJournals = new Map();
  const partnerOf = await partnerResolver(db);
  const groups = new Map();
  const broken = new Set(); // pièces dont une ligne est déjà en erreur : pas de second message « déséquilibrée »
  for (const r of rows) {
    const journal = text(cell(r, 'journal')).toUpperCase();
    if (!journal && !text(cell(r, 'account'))) continue;
    const date = parseDate(cell(r, 'date'), dateFormat);
    const piece = text(cell(r, 'piece'));
    if (!/^[A-Z0-9]{1,6}$/.test(journal)) { err(r.line, `Code journal « ${journal} » illisible (2 à 6 lettres ou chiffres).`); continue; }
    if (!date) { err(r.line, `Date « ${text(cell(r, 'date'))} » illisible (format ${dateFormat}).`); continue; }
    if (!piece) { err(r.line, 'N° de pièce manquant.'); continue; }
    if (!journals.has(journal) && !newJournals.has(journal)) {
      if (!options.create_journals) { err(r.line, `Journal ${journal} absent (option « Créer les journaux manquants »).`); continue; }
      newJournals.set(journal, { code: journal, label: `Journal ${journal} (Sage)`, kind: journal === 'AN' ? 'an' : 'od' });
    }
    const key = `${journal}|${date}|${piece}`;
    const a = accountFor(r.line, cell(r, 'account'), null);
    const m = amountsOf(r, r.line);
    if (!a || !m) { broken.add(key); continue; }
    if (!m.debit && !m.credit) { warn(r.line, 'Ligne à zéro ignorée.'); continue; }
    const line = { account: a.code, debit: m.debit, credit: m.credit, label: text(cell(r, 'label')).slice(0, 255) };
    const tiers = text(cell(r, 'partner'));
    if (tiers) {
      const p = await partnerOf(tiers);
      if (p) Object.assign(line, p);
      else warn(r.line, `Tiers « ${tiers} » inconnu de l’ERP : ligne importée sans tiers.`);
    }
    if (!groups.has(key)) groups.set(key, { journal, date, piece, ref: text(cell(r, 'ref')).slice(0, 60) || piece.slice(0, 60), label: line.label, lines: [], first: r.line });
    groups.get(key).lines.push(line);
  }
  const entries = [...groups.entries()].filter(([k]) => !broken.has(k)).map(([, e]) => e).sort((x, y) => x.date.localeCompare(y.date) || x.journal.localeCompare(y.journal) || x.piece.localeCompare(y.piece, 'fr', { numeric: true }));
  const years = await db('acc_fiscal_years').select('*');
  const keys = entries.map(e => sourceKey(e.journal, e.date, e.piece));
  const existing = new Set();
  for (let i = 0; i < keys.length; i += 500) (await db('acc_entries').whereIn('source_key', keys.slice(i, i + 500)).pluck('source_key')).forEach(k => existing.add(k));
  let duplicates = 0, ok = 0, debit = 0;
  const valid = [];
  for (const [i, e] of entries.entries()) {
    e.source_key = keys[i];
    if (existing.has(e.source_key)) { duplicates += 1; continue; }
    const problems = checkEntry(e.lines);
    if (problems.length) { err(e.first, `Pièce ${e.piece} du ${e.date} (${e.journal}) : ${problems[0]}`); continue; }
    const fy = years.find(y => isoDay(y.start_date) <= e.date && isoDay(y.end_date) >= e.date);
    if (!fy) { err(e.first, `Pièce ${e.piece} : aucun exercice ne couvre le ${e.date} (Paramètres › Exercices).`); continue; }
    if (fy.status === 'cloture' || (fy.lock_date && e.date <= isoDay(fy.lock_date))) { err(e.first, `Pièce ${e.piece} : l’exercice ${fy.label} est clôturé ou verrouillé au ${e.date}.`); continue; }
    ok += 1; debit += e.lines.reduce((t, l) => t + l.debit, 0);
    valid.push(e);
  }
  let created = 0;
  // Tout ou rien : une erreur bloque l'enregistrement, pour ne pas laisser un exercice à moitié repris
  if (!dryRun && !errors.length && valid.length) await db.transaction(async trx => {
    await createAccounts(trx, toCreate);
    for (const j of newJournals.values()) await trx('acc_journals').insert(j);
    for (const e of valid) {
      await ct.createEntry(trx, { journal: e.journal, date: e.date, label: e.label || `Pièce ${e.piece}`, ref: e.ref, source: 'sage', source_key: e.source_key, lines: e.lines, userId: user.id, validate: !!options.validate });
      created += 1;
    }
  });
  return {
    summary: { lines: rows.length, entries: entries.length, ready: ok, duplicates, debit, accounts_to_create: toCreate.size, journals_to_create: newJournals.size, created, validated: options.validate ? created : 0 },
    errors, warnings,
    preview: valid.slice(0, 30).map(e => ({ journal: e.journal, date: e.date, piece: e.piece, label: e.label, lines: e.lines.length, amount: e.lines.reduce((t, l) => t + l.debit, 0) })),
  };
}

/** Crée les comptes retenus, du plus court au plus long (un compte peut se rattacher à un autre créé dans le même import). */
async function createAccounts(trx, toCreate) {
  for (const [code, a] of [...toCreate].sort((x, y) => x[0].length - y[0].length)) {
    if (await trx('acc_accounts').where({ code }).first('id')) continue;
    await trx('acc_accounts').insert({ code, label: a.label, class: accountClass(code), partner_kind: partnerKindOf(code) });
  }
}

module.exports = { KINDS, DATE_FORMATS, run, parseDate, parseAmount, normalize };
