/** ERP · Comptabilité › Liasse fiscale DGI : états, contrôles, classeur DGI rempli, préparation (identité, N-1, TFT). */
const express = require('express');
const { z } = require('../../lib/zod');
const { ah, parse, HttpError, isoDay } = require('../../lib/http');
const { requirePermission } = require('../../auth');
const liasse = require('../../services/liasse');
const { TFT_INPUTS, IDENTITY_FIELDS } = require('../../lib/liasse');

module.exports = function liasseRoutes(db) {
  const r = express.Router();
  const read = requirePermission('liasse:read');
  const prepare = requirePermission('liasse:prepare');
  const fyParam = req => {
    const id = Number(req.params.fy);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Exercice invalide.');
    return id;
  };

  r.get('/meta', read, ah(async (req, res) => {
    const years = await db('acc_fiscal_years').orderBy('start_date', 'desc').select('id', 'label', 'start_date', 'end_date', 'status');
    res.json({ fiscal_years: years.map(y => ({ ...y, start_date: isoDay(y.start_date), end_date: isoDay(y.end_date) })), identity: await liasse.getIdentity(db), identity_fields: IDENTITY_FIELDS });
  }));

  r.get('/:fy', read, ah(async (req, res) => res.json(await liasse.statements(db, fyParam(req), { includeDraft: req.query.draft === '1' }))));

  // Classeur officiel de la DGI (modèle de la Comptabilité) rempli : notes annexes et états supplémentaires calculés par Excel
  r.get('/:fy/classeur', read, ah(async (req, res) => {
    const { buffer, statements } = await liasse.workbook(db, fyParam(req), { includeDraft: req.query.draft === '1' });
    res.set('Content-Type', 'application/vnd.ms-excel.sheet.macroEnabled.12');
    res.set('Content-Disposition', `attachment; filename="liasse-fiscale-${statements.fiscal_year.label}.xlsm"`);
    res.send(buffer);
  }));

  r.put('/identity', prepare, ah(async (req, res) => {
    const shape = Object.fromEntries(Object.keys(IDENTITY_FIELDS).map(k => [k, z.string().trim().max(255).optional().nullable().transform(v => v || '')]));
    const data = parse(z.object(shape), req.body);
    // Seuls les champs envoyés changent (les autres gardent leur valeur)
    res.json(await liasse.saveIdentity(db, Object.fromEntries(Object.entries(data).filter(([k]) => k in (req.body || {})))));
  }));

  // Renseignements du TFT : montant saisi (positif) ou null pour reprendre la proposition tirée des écritures
  r.put('/:fy/tft', prepare, ah(async (req, res) => {
    const fy = fyParam(req);
    const shape = Object.fromEntries(Object.keys(TFT_INPUTS).map(k => [k, z.number().int().min(0).max(1e15).nullable().optional()]));
    const data = parse(z.object(shape), req.body);
    const current = (await liasse.getInputs(db, fy)).tft || {};
    const tft = { ...current };
    for (const [k, v] of Object.entries(data)) { if (v == null) delete tft[k]; else tft[k] = v; }
    await liasse.saveInputs(db, fy, { tft }, req.user.id);
    res.json(await liasse.statements(db, fy, { includeDraft: req.query.draft === '1' }));
  }));

  // Balance N-1 (exercice précédent tenu hors de l'ERP) : remplace la balance importée pour cet exercice
  r.put('/:fy/balance-n1', prepare, ah(async (req, res) => {
    const fy = fyParam(req);
    if (!(await db('acc_fiscal_years').where({ id: fy }).first('id'))) throw new HttpError(404, 'Exercice introuvable.');
    const { rows } = parse(z.object({ rows: z.array(z.object({
      account: z.string().trim().regex(/^\d{2,12}$/, 'Numéro de compte : chiffres uniquement.'), label: z.string().trim().max(160).optional().nullable(),
      debit: z.number().int().min(0).default(0), credit: z.number().int().min(0).default(0),
    })).min(1).max(20000) }), req.body);
    const d = rows.reduce((t, x) => t + x.debit, 0);
    const c = rows.reduce((t, x) => t + x.credit, 0);
    if (d !== c) throw new HttpError(400, `Balance N-1 déséquilibrée : débits ${d.toLocaleString('fr-FR')}, crédits ${c.toLocaleString('fr-FR')}.`);
    await db.transaction(async trx => {
      await trx('liasse_balances_n1').where({ fiscal_year_id: fy }).del();
      for (let i = 0; i < rows.length; i += 500) {
        await trx('liasse_balances_n1').insert(rows.slice(i, i + 500).map(x => ({ fiscal_year_id: fy, account: x.account, label: x.label || null, debit: x.debit, credit: x.credit, created_by: req.user.id })));
      }
    });
    res.json(await liasse.statements(db, fy, { includeDraft: req.query.draft === '1' }));
  }));

  r.delete('/:fy/balance-n1', prepare, ah(async (req, res) => {
    const fy = fyParam(req);
    await db('liasse_balances_n1').where({ fiscal_year_id: fy }).del();
    res.json(await liasse.statements(db, fy, { includeDraft: req.query.draft === '1' }));
  }));

  return r;
};
