/** ERP · Comptabilité (SYSCOHADA) : plan, journaux, exercices, écritures, achats, états, export Sage. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, isoDay } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const { JOURNAL_KINDS, REVENUE_MODES, accountClass, partnerKindOf, splitVat } = require('../../lib/compta');
const ct = require('../../services/compta');
const lieux = require('../../services/lieux');
const { BUDGET_CATEGORIES } = require('../../lib/domain');
const { progressIndex, clientsProgress } = require('../../services/clients');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const insertedId = r => (typeof r === 'object' ? r.id : r);
const lineSchema = z.object({
  account: z.string().trim().min(2).max(12), label: optText(255),
  debit: z.number().int().min(0).default(0), credit: z.number().int().min(0).default(0),
  partner_type: z.enum(['client', 'fournisseur', 'employe']).optional().nullable(), partner_id: z.number().int().positive().optional().nullable(),
  project_id: z.number().int().positive().optional().nullable(), lot_id: z.number().int().positive().optional().nullable(),
});

module.exports = function comptaRoutes(db) {
  const r = express.Router();
  const read = requirePermission('compta:read');
  // Actions détaillées (Rôles & privilèges) : voir lib/domain.js, groupe « ERP · Comptabilité »
  const period = req => ({
    from: req.query.from || null, to: req.query.to || null, includeDraft: req.query.draft === '1',
    fiscalYearId: Number(req.query.fiscal_year_id) || null,
  });

  r.get('/meta', read, ah(async (req, res) => {
    const [journals, years, settings, projects] = await Promise.all([
      db('acc_journals as j').leftJoin('acc_accounts as a', 'a.id', 'j.account_id').orderBy('j.id').select('j.*', 'a.code as account_code'),
      db('acc_fiscal_years').orderBy('start_date', 'desc'),
      ct.getSettings(db),
      db('projects').orderBy('name').select('id', 'name'),
    ]);
    res.json({
      journals, journal_kinds: JOURNAL_KINDS, revenue_modes: REVENUE_MODES, settings, projects,
      fiscal_years: years.map(y => ({ ...y, start_date: isoDay(y.start_date), end_date: isoDay(y.end_date), lock_date: isoDay(y.lock_date) })),
    });
  }));

  // ─── Plan comptable ───────────────────────────────────────
  r.get('/accounts', read, ah(async (req, res) => {
    const q = db('acc_accounts').orderBy('code');
    if (req.query.q) {
      const s = String(req.query.q).trim();
      q.where(b => b.where('code', 'like', `${s}%`).orWhere('label', 'like', `%${s}%`));
    }
    if (req.query.class) q.where('class', Number(req.query.class));
    if (req.query.active === '1') q.where('active', true);
    res.json((await q.limit(2000)).map(a => ({ ...a, active: !!a.active, system: !!a.system })));
  }));

  r.post('/accounts', requirePermission('compta:settings'), ah(async (req, res) => {
    const data = parse(z.object({ code: z.string().trim().regex(/^[1-9]\d{1,11}$/, 'Numéro de compte : chiffres uniquement, classe 1 à 9.'), label: z.string().trim().min(2).max(160) }), req.body);
    if (await db('acc_accounts').where({ code: data.code }).first()) throw new HttpError(409, 'Ce numéro de compte existe déjà.');
    const parent = await db('acc_accounts').whereIn('code', [...Array(data.code.length - 1).keys()].map(i => data.code.slice(0, i + 1))).orderBy('code', 'desc').first();
    if (!parent) throw new HttpError(400, 'Le compte doit se rattacher à un compte existant du plan (ex. 411 pour un compte client).');
    const [id] = await db('acc_accounts').insert({ ...data, class: accountClass(data.code), partner_kind: partnerKindOf(data.code) });
    res.status(201).json(await db('acc_accounts').where({ id: insertedId(id) }).first());
  }));

  r.patch('/accounts/:id', requirePermission('compta:settings'), ah(async (req, res) => {
    const data = parse(z.object({ label: z.string().trim().min(2).max(160), active: z.boolean() }).partial(), req.body);
    const n = await db('acc_accounts').where({ id: idParam(req) }).update({ ...data, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Compte introuvable.');
    res.json(await db('acc_accounts').where({ id: idParam(req) }).first());
  }));

  // ─── Journaux et exercices ────────────────────────────────
  r.post('/journals', requirePermission('compta:settings'), ah(async (req, res) => {
    const data = parse(z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, 'Code de 2 à 6 lettres ou chiffres.'), label: z.string().trim().min(2).max(120),
      kind: z.enum(Object.keys(JOURNAL_KINDS)), account: z.string().trim().max(12).optional().nullable(),
    }), req.body);
    if (await db('acc_journals').where({ code: data.code }).first()) throw new HttpError(409, 'Ce code de journal existe déjà.');
    const account = data.account ? await db('acc_accounts').where({ code: data.account }).first() : null;
    if (['banque', 'caisse', 'mobile'].includes(data.kind) && (!account || account.class !== 5)) throw new HttpError(400, 'Un journal de trésorerie a besoin d’un compte de classe 5.');
    const [id] = await db('acc_journals').insert({ code: data.code, label: data.label, kind: data.kind, account_id: account ? account.id : null });
    res.status(201).json(await db('acc_journals').where({ id: insertedId(id) }).first());
  }));

  r.patch('/journals/:id', requirePermission('compta:settings'), ah(async (req, res) => {
    const data = parse(z.object({ label: z.string().trim().min(2).max(120), active: z.boolean() }).partial(), req.body);
    const n = await db('acc_journals').where({ id: idParam(req) }).update({ ...data, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Journal introuvable.');
    res.json(await db('acc_journals').where({ id: idParam(req) }).first());
  }));

  r.post('/fiscal-years', requirePermission('compta:close'), ah(async (req, res) => {
    const data = parse(z.object({ label: z.string().trim().min(2).max(40), start_date: day, end_date: day }), req.body);
    if (data.end_date <= data.start_date) throw new HttpError(400, 'La fin de l’exercice doit suivre son début.');
    const overlap = await db('acc_fiscal_years').where('start_date', '<=', data.end_date).where('end_date', '>=', data.start_date).first();
    if (overlap) throw new HttpError(409, `Cet exercice chevauche l’exercice ${overlap.label}.`);
    const [id] = await db('acc_fiscal_years').insert(data);
    res.status(201).json(await db('acc_fiscal_years').where({ id: insertedId(id) }).first());
  }));

  // Verrouillage d'une période (ex. après déclaration de TVA) : plus aucune écriture jusqu'à cette date
  r.patch('/fiscal-years/:id', requirePermission('compta:close'), ah(async (req, res) => {
    const { lock_date } = parse(z.object({ lock_date: day.nullable() }), req.body);
    const fy = await db('acc_fiscal_years').where({ id: idParam(req) }).first();
    if (!fy) throw new HttpError(404, 'Exercice introuvable.');
    if (lock_date) {
      const drafts = await db('acc_entries').where({ fiscal_year_id: fy.id, status: 'brouillon' }).where('date', '<=', lock_date).count({ n: '*' });
      if (Number(drafts[0].n)) throw new HttpError(409, `${drafts[0].n} écriture(s) en brouillon jusqu’au ${lock_date} : validez-les ou supprimez-les avant de verrouiller.`);
    }
    await db('acc_fiscal_years').where({ id: fy.id }).update({ lock_date, updated_at: new Date() });
    res.json(await db('acc_fiscal_years').where({ id: fy.id }).first());
  }));

  r.post('/fiscal-years/:id/close', requirePermission('compta:close'), ah(async (req, res) => {
    const fy = await db('acc_fiscal_years').where({ id: idParam(req) }).first();
    if (!fy) throw new HttpError(404, 'Exercice introuvable.');
    if (fy.status === 'cloture') throw new HttpError(409, 'Exercice déjà clôturé.');
    const drafts = await db('acc_entries').where({ fiscal_year_id: fy.id, status: 'brouillon' }).count({ n: '*' });
    if (Number(drafts[0].n)) throw new HttpError(409, `${drafts[0].n} écriture(s) en brouillon : validez-les avant la clôture.`);
    // Biens du parc immobilisés : les dotations aux amortissements de l'exercice doivent être passées et validées
    await require('../../services/parcCompta').checkClosing(db, fy);
    await db('acc_fiscal_years').where({ id: fy.id }).update({ status: 'cloture', lock_date: fy.end_date, closed_at: new Date(), closed_by: req.user.id, updated_at: new Date() });
    res.json(await db('acc_fiscal_years').where({ id: fy.id }).first());
  }));

  r.post('/fiscal-years/:id/opening-from/:from', requirePermission('compta:close'), ah(async (req, res) => {
    const e = await ct.openingFromPrevious(db, { fromYearId: Number(req.params.from), toYearId: idParam(req), userId: req.user.id });
    res.status(201).json(await ct.entryDetail(db, e.id));
  }));

  // Soldes d'ouverture saisis ou collés depuis l'ancienne comptabilité (journal AN)
  r.post('/opening', requirePermission('compta:close'), ah(async (req, res) => {
    const data = parse(z.object({ fiscal_year_id: z.number().int().positive(), lines: z.array(lineSchema).min(2).max(2000) }), req.body);
    const fy = await db('acc_fiscal_years').where({ id: data.fiscal_year_id }).first();
    if (!fy) throw new HttpError(404, 'Exercice introuvable.');
    if (await db('acc_entries').where({ source_key: `opening:${fy.id}` }).first()) throw new HttpError(409, 'Les soldes d’ouverture de cet exercice sont déjà saisis : modifiez le brouillon ou contrepassez-le.');
    const e = await db.transaction(trx => ct.createEntry(trx, {
      journal: 'AN', date: isoDay(fy.start_date), label: `Soldes d’ouverture ${fy.label}`, source: 'an', source_key: `opening:${fy.id}`, lines: data.lines, userId: req.user.id,
    }));
    res.status(201).json(await ct.entryDetail(db, e.id));
  }));

  // ─── Écritures ────────────────────────────────────────────
  r.get('/entries', read, ah(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const q = db('acc_entries as e').join('acc_journals as j', 'j.id', 'e.journal_id').leftJoin('projects as p', 'p.id', 'e.project_id');
    if (req.query.journal_id) q.where('e.journal_id', Number(req.query.journal_id));
    if (req.query.status) q.where('e.status', String(req.query.status));
    if (req.query.source) q.where('e.source', String(req.query.source));
    if (req.query.fiscal_year_id) q.where('e.fiscal_year_id', Number(req.query.fiscal_year_id));
    if (req.query.from) q.where('e.date', '>=', String(req.query.from));
    if (req.query.to) q.where('e.date', '<=', String(req.query.to));
    if (req.query.q) {
      const s = `%${String(req.query.q).trim()}%`;
      q.where(b => b.where('e.label', 'like', s).orWhere('e.number', 'like', s).orWhere('e.ref', 'like', s));
    }
    const [{ total }] = await q.clone().count({ total: '*' });
    const rows = await q.select('e.*', 'j.code as journal_code', 'p.name as project_name')
      .orderBy([{ column: 'e.date', order: 'desc' }, { column: 'e.id', order: 'desc' }]).limit(limit).offset(offset);
    const sums = rows.length ? await db('acc_lines').whereIn('entry_id', rows.map(e => e.id)).groupBy('entry_id').select('entry_id').sum({ amount: 'debit' }) : [];
    const amountBy = Object.fromEntries(sums.map(s => [s.entry_id, Number(s.amount)]));
    res.json({ total: Number(total), rows: rows.map(e => ({ ...e, date: isoDay(e.date), amount: amountBy[e.id] || 0 })) });
  }));

  r.get('/entries/:id', read, ah(async (req, res) => res.json(await ct.entryDetail(db, idParam(req)))));

  const entrySchema = z.object({
    journal_id: z.number().int().positive(), date: day, label: z.string().trim().min(2).max(255), ref: optText(60),
    project_id: z.number().int().positive().optional().nullable(), lines: z.array(lineSchema).min(2).max(200),
  });

  r.post('/entries', requirePermission('compta:entries'), ah(async (req, res) => {
    const data = parse(entrySchema, req.body);
    const e = await db.transaction(trx => ct.createEntry(trx, { ...data, journal: data.journal_id, userId: req.user.id }));
    res.status(201).json(await ct.entryDetail(db, e.id));
  }));

  r.patch('/entries/:id', requirePermission('compta:entries'), ah(async (req, res) => {
    const data = parse(entrySchema.partial(), req.body);
    await db.transaction(trx => ct.updateDraft(trx, idParam(req), data));
    res.json(await ct.entryDetail(db, idParam(req)));
  }));

  r.delete('/entries/:id', requirePermission('compta:entries'), ah(async (req, res) => {
    await db.transaction(trx => ct.deleteDraft(trx, idParam(req)));
    res.json({ ok: true });
  }));

  // Validation (une sélection, ou tous les brouillons jusqu'à une date), dans l'ordre chronologique
  r.post('/entries/validate', requirePermission('compta:validate'), ah(async (req, res) => {
    const data = parse(z.object({ ids: z.array(z.number().int().positive()).max(5000).optional(), until: day.optional() }), req.body);
    if (!data.ids && !data.until) throw new HttpError(400, 'Choisissez les écritures à valider.');
    const q = db('acc_entries').where({ status: 'brouillon' }).orderBy([{ column: 'date' }, { column: 'id' }]);
    if (data.ids) q.whereIn('id', data.ids);
    if (data.until) q.where('date', '<=', data.until);
    const drafts = await q.select('id');
    let done = 0;
    const errors = [];
    for (const e of drafts) {
      try { await db.transaction(trx => ct.validateEntry(trx, e.id, req.user.id)); done++; } catch (err) { errors.push(`#${e.id} : ${err.message}`); }
    }
    res.json({ validated: done, errors });
  }));

  r.post('/entries/:id/reverse', requirePermission('compta:validate'), ah(async (req, res) => {
    const { date } = parse(z.object({ date: day.optional() }), req.body || {});
    const e = await db.transaction(trx => ct.reverseEntry(trx, idParam(req), { date, userId: req.user.id }));
    res.status(201).json(await ct.entryDetail(db, e.id));
  }));

  // Écritures automatiques à partir des versements, appels de fonds et ventes (dashboard et ERP)
  r.post('/sync', requirePermission('compta:entries'), ah(async (req, res) => res.json(await ct.syncAutoEntries(db, req.user.id))));

  // ─── Fournisseurs et achats ───────────────────────────────
  const supplierSchema = z.object({
    name: z.string().trim().min(2).max(160), kind: z.enum(['fournisseur', 'sous_traitant', 'prestataire', 'notaire']).default('fournisseur'),
    phone: optText(40), email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)),
    address: optText(255), ncc: optText(40), rccm: optText(60), expense_account: z.string().trim().max(12).optional().nullable(), notes: optText(500),
    // Imputation habituelle (programme ou lieu), proposée à la saisie de ses factures ; vide : rien de proposé
    project_id: z.number().int().positive().optional().nullable(), place_id: z.number().int().positive().optional().nullable(),
  });
  const supplierRow = async data => {
    const { expense_account, ...rest } = data;
    if (rest.project_id && rest.place_id) throw new HttpError(400, 'Imputation habituelle : un programme ou un lieu, pas les deux.');
    if (expense_account === undefined) return rest;
    const acc = expense_account ? await db('acc_accounts').where({ code: expense_account }).first() : null;
    if (expense_account && (!acc || acc.class !== 6)) throw new HttpError(400, 'Le compte de charge habituel doit être un compte de classe 6.');
    return { ...rest, expense_account_id: acc ? acc.id : null };
  };

  r.get('/suppliers', read, ah(async (req, res) => {
    const rows = await db('suppliers as s').leftJoin('acc_accounts as a', 'a.id', 's.expense_account_id').orderBy('s.name').select('s.*', 'a.code as expense_account');
    const balances = Object.fromEntries((await ct.partnerBalances(db, 'fournisseur', { includeDraft: true })).map(b => [b.partner_id, b.balance]));
    res.json(rows.map(s => ({ ...s, active: !!s.active, balance: -(balances[s.id] || 0) })));
  }));

  r.post('/suppliers', requirePermission('achats:write'), ah(async (req, res) => {
    const data = await supplierRow(parse(supplierSchema, req.body));
    const [id] = await db('suppliers').insert(data);
    res.status(201).json(await db('suppliers').where({ id: insertedId(id) }).first());
  }));

  r.patch('/suppliers/:id', requirePermission('achats:write'), ah(async (req, res) => {
    const data = await supplierRow(parse(supplierSchema.partial().extend({ active: z.boolean().optional() }), req.body));
    const n = await db('suppliers').where({ id: idParam(req) }).update({ ...data, updated_at: new Date() });
    if (!n) throw new HttpError(404, 'Fournisseur introuvable.');
    res.json(await db('suppliers').where({ id: idParam(req) }).first());
  }));

  const purchaseRow = async inv => {
    const [{ paid }] = await db('purchase_payments').where({ invoice_id: inv.id }).sum({ paid: 'amount' });
    const p = Number(paid) || 0;
    const due = inv.due_date ? isoDay(inv.due_date) : null;
    return {
      ...inv, date: isoDay(inv.date), due_date: due, amount_ht: Number(inv.amount_ht), vat_amount: Number(inv.vat_amount), amount_ttc: Number(inv.amount_ttc), vat_rate: Number(inv.vat_rate),
      paid_fcfa: p, remaining_fcfa: Number(inv.amount_ttc) - p,
      payment_status: inv.status !== 'validee' ? null : p >= Number(inv.amount_ttc) ? 'payee' : p > 0 ? 'partielle' : due && due < isoDay(new Date()) ? 'en_retard' : 'a_payer',
    };
  };

  r.get('/purchases', read, ah(async (req, res) => {
    const q = db('purchase_invoices as i').join('suppliers as s', 's.id', 'i.supplier_id').leftJoin('projects as p', 'p.id', 'i.project_id')
      .leftJoin('worksites as w', 'w.id', 'i.worksite_id').leftJoin('places as pl', 'pl.id', 'i.place_id').join('acc_accounts as a', 'a.id', 'i.expense_account_id');
    if (req.query.status) q.where('i.status', String(req.query.status));
    if (req.query.supplier_id) q.where('i.supplier_id', Number(req.query.supplier_id));
    if (req.query.project_id) q.where('i.project_id', Number(req.query.project_id));
    if (req.query.worksite_id) q.where('i.worksite_id', Number(req.query.worksite_id));
    if (req.query.place_id) q.where('i.place_id', Number(req.query.place_id));
    const rows = await q.select('i.*', 's.name as supplier_name', 'p.name as project_name', 'w.reference as worksite_reference', 'w.name as worksite_name', 'pl.name as place_name', 'a.code as expense_account', 'a.label as expense_label')
      .orderBy([{ column: 'i.date', order: 'desc' }, { column: 'i.id', order: 'desc' }]).limit(1000);
    const out = [];
    for (const i of rows) out.push(await purchaseRow(i));
    res.json(out);
  }));

  r.get('/purchases/:id', read, ah(async (req, res) => {
    const inv = await db('purchase_invoices as i').join('suppliers as s', 's.id', 'i.supplier_id').leftJoin('projects as p', 'p.id', 'i.project_id')
      .leftJoin('worksites as w', 'w.id', 'i.worksite_id').leftJoin('places as pl', 'pl.id', 'i.place_id').join('acc_accounts as a', 'a.id', 'i.expense_account_id').where('i.id', idParam(req))
      .first('i.*', 's.name as supplier_name', 'p.name as project_name', 'w.reference as worksite_reference', 'w.name as worksite_name', 'pl.name as place_name', 'a.code as expense_account', 'a.label as expense_label');
    if (!inv) throw new HttpError(404, 'Facture introuvable.');
    const payments = await db('purchase_payments as pp').join('acc_journals as j', 'j.id', 'pp.journal_id').where('pp.invoice_id', inv.id)
      .select('pp.*', 'j.code as journal_code', 'j.label as journal_label').orderBy('pp.date');
    res.json({ ...(await purchaseRow(inv)), payments: payments.map(p => ({ ...p, date: isoDay(p.date), amount: Number(p.amount) })) });
  }));

  // Imputation : programme (et chantier, qui fixe le programme) ou lieu (siège, bureau, dépôt) ; sans rien, le siège.
  // Le poste range la facture dans le budget du chantier.
  const siteFields = {
    worksite_id: z.number().int().positive().optional().nullable(), worksite_category: z.enum(Object.keys(BUDGET_CATEGORIES)).optional().nullable(),
    place_id: z.number().int().positive().optional().nullable(),
  };
  const purchaseSchema = z.object({
    supplier_id: z.number().int().positive(), supplier_ref: optText(60), date: day, due_date: day.optional().nullable(),
    label: z.string().trim().min(2).max(255), project_id: z.number().int().positive().optional().nullable(),
    expense_account: z.string().trim().min(2).max(12), amount_ttc: z.number().int().positive(), vat_rate: z.number().min(0).max(100).default(0),
    ...siteFields,
  });
  const siteOf = async data => {
    const site = await lieux.resolvePlace(db, { project_id: data.project_id ?? null, worksite_id: data.worksite_id ?? null, place_id: data.place_id ?? null });
    return { ...site, worksite_category: site.worksite_id ? data.worksite_category || 'materiaux' : null };
  };
  const purchaseFields = async data => {
    const acc = await db('acc_accounts').where({ code: data.expense_account }).first();
    if (!acc || ![2, 6].includes(acc.class)) throw new HttpError(400, 'Imputez l’achat sur un compte de charge (classe 6) ou d’immobilisation (classe 2).');
    if (!(await db('suppliers').where({ id: data.supplier_id }).first())) throw new HttpError(404, 'Fournisseur introuvable.');
    const { ht, vat } = splitVat(data.amount_ttc, data.vat_rate);
    const { expense_account, ...rest } = data;
    return { ...rest, ...(await siteOf(data)), expense_account_id: acc.id, amount_ht: ht, vat_amount: vat };
  };

  r.post('/purchases', requirePermission('achats:write'), ah(async (req, res) => {
    const data = await purchaseFields(parse(purchaseSchema, req.body));
    const id = await db.transaction(async trx => {
      const [i] = await trx('purchase_invoices').insert({ ...data, number: await ct.nextPurchaseNumber(trx, data.date), created_by: req.user.id });
      return insertedId(i);
    });
    res.status(201).json(await purchaseRow(await db('purchase_invoices').where({ id }).first()));
  }));

  r.patch('/purchases/:id', requirePermission('achats:write'), ah(async (req, res) => {
    const inv = await db('purchase_invoices').where({ id: idParam(req) }).first();
    if (!inv) throw new HttpError(404, 'Facture introuvable.');
    if (inv.status !== 'brouillon') throw new HttpError(409, 'Facture validée : elle ne se modifie plus (contrepassez son écriture si besoin).');
    const merged = { supplier_id: inv.supplier_id, project_id: inv.project_id, worksite_id: inv.worksite_id, worksite_category: inv.worksite_category, place_id: inv.place_id, date: isoDay(inv.date), label: inv.label, amount_ttc: Number(inv.amount_ttc), vat_rate: Number(inv.vat_rate), expense_account: (await db('acc_accounts').where({ id: inv.expense_account_id }).first()).code, ...parse(purchaseSchema.partial(), req.body) };
    await db('purchase_invoices').where({ id: inv.id }).update({ ...(await purchaseFields(merged)), updated_at: new Date() });
    res.json(await purchaseRow(await db('purchase_invoices').where({ id: inv.id }).first()));
  }));

  /**
   * Chantier et poste d'une facture, même validée : le chantier ne change pas le programme de l'écriture, il doit
   * donc appartenir au programme de la facture (une facture sans programme se corrige en brouillon).
   */
  r.patch('/purchases/:id/chantier', requirePermission('achats:write'), ah(async (req, res) => {
    const inv = await db('purchase_invoices').where({ id: idParam(req) }).first();
    if (!inv) throw new HttpError(404, 'Facture introuvable.');
    const data = parse(z.object(siteFields), req.body);
    const site = await require('../../services/chantiers').resolveSite(db, { project_id: inv.project_id, worksite_id: data.worksite_id ?? null });
    if (site.worksite_id && !inv.project_id && inv.status !== 'brouillon') throw new HttpError(409, 'Facture validée sans programme : son chantier ne peut plus être indiqué.');
    await db('purchase_invoices').where({ id: inv.id }).update({
      worksite_id: site.worksite_id, worksite_category: site.worksite_id ? data.worksite_category || inv.worksite_category || 'materiaux' : null,
      ...(inv.status === 'brouillon' && site.worksite_id ? { project_id: site.project_id, place_id: null } : {}), updated_at: new Date(),
    });
    res.json(await purchaseRow(await db('purchase_invoices').where({ id: inv.id }).first()));
  }));

  r.delete('/purchases/:id', requirePermission('achats:write'), ah(async (req, res) => {
    const inv = await db('purchase_invoices').where({ id: idParam(req) }).first();
    if (!inv) throw new HttpError(404, 'Facture introuvable.');
    if (inv.status !== 'brouillon') throw new HttpError(409, 'Une facture validée ne se supprime pas.');
    await db('purchase_invoices').where({ id: inv.id }).del();
    res.json({ ok: true });
  }));

  r.post('/purchases/:id/validate', requirePermission('achats:write'), ah(async (req, res) => {
    const inv = await ct.validatePurchase(db, idParam(req), req.user.id);
    res.json(await purchaseRow(inv));
  }));

  r.post('/purchases/:id/payments', requirePermission('achats:pay'), ah(async (req, res) => {
    const data = parse(z.object({ date: day, amount: z.number().int().positive(), journal_id: z.number().int().positive(), reference: optText(120) }), req.body);
    res.status(201).json(await ct.payPurchase(db, idParam(req), data, req.user.id));
  }));

  // ─── États ────────────────────────────────────────────────
  r.get('/reports/balance', read, ah(async (req, res) => res.json(await ct.trialBalance(db, period(req)))));
  r.get('/reports/ledger', read, ah(async (req, res) => {
    if (!req.query.account) throw new HttpError(400, 'Choisissez un compte.');
    res.json(await ct.generalLedger(db, { ...period(req), account: String(req.query.account) }));
  }));
  r.get('/reports/statements', read, ah(async (req, res) => res.json(await ct.financialStatements(db, period(req)))));
  r.get('/reports/vat', read, ah(async (req, res) => res.json(await ct.vatReport(db, period(req)))));
  // Marges et soldes clients : avec l'avancement du chantier (programme, client), comme sur l'ancienne plateforme
  r.get('/reports/margins', read, ah(async (req, res) => {
    const [rows, progress] = await Promise.all([ct.projectMargins(db, period(req)), progressIndex(db)]);
    res.json(rows.map(m => ({ ...m, progress_pct: m.project_id ? progress.project(m.project_id)?.progress_pct ?? 0 : null })));
  }));
  r.get('/reports/partners', read, ah(async (req, res) => {
    const kind = req.query.kind === 'fournisseur' ? 'fournisseur' : 'client';
    const rows = await ct.partnerBalances(db, kind, period(req));
    if (kind !== 'client') return res.json(rows);
    const progress = await clientsProgress(db, rows.map(r => r.partner_id));
    res.json(rows.map(r => ({ ...r, progress_pct: progress[r.partner_id]?.progress_pct ?? null })));
  }));
  r.get('/reports/treasury', read, ah(async (req, res) => res.json(await ct.treasury(db, { includeDraft: req.query.draft === '1' }))));

  // Pastille du menu « Parc auto et matériel » : dépenses du parc à valider
  r.get('/dashboard', read, ah(async (req, res) => res.json({ ...(await ct.dashboard(db)), parc_to_validate: (await require('../../services/parcCompta').pendingCosts(db)).length })));

  // ─── Export et réglages ───────────────────────────────────
  r.get('/export/sage', requirePermission('compta:export'), ah(async (req, res) => {
    const { csv, count } = await ct.sageExport(db, { from: req.query.from || null, to: req.query.to || null });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('X-Lines', String(count));
    res.set('Content-Disposition', `attachment; filename="ecritures-sage-${req.query.from || 'debut'}-${req.query.to || 'fin'}.csv"`);
    res.send(csv);
  }));

  r.get('/settings', read, ah(async (req, res) => res.json(await ct.getSettings(db))));
  r.put('/settings', requirePermission('compta:settings'), ah(async (req, res) => {
    const data = parse(z.object({
      revenue_vefa: z.enum(Object.keys(REVENUE_MODES.vefa)), revenue_echeancier: z.enum(Object.keys(REVENUE_MODES.echeancier)),
      vat_sales_rate: z.number().min(0).max(100), vat_purchases_rate: z.number().min(0).max(100), auto_validate: z.boolean(),
      accounts: z.record(z.string().trim().min(2).max(12)),
      depreciation_years: z.record(z.number().int().min(1).max(50)),
      sage: z.object({ separator: z.enum([';', ',', '\t', '|']), date_format: z.enum(['JJMMAAAA', 'JJMMAA', 'AAAAMMJJ', 'JJ/MM/AAAA']), decimal: z.enum([',', '.']), header: z.boolean() }).partial(),
    }).partial(), req.body);
    res.json(await ct.saveSettings(db, data));
  }));

  return r;
};
