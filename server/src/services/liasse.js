/**
 * Liasse fiscale DGI (SYSCOHADA révisé, système normal) tirée de la comptabilité : bilan actif et passif, compte de
 * résultat, tableau des flux de trésorerie, contrôles ; et le classeur officiel de la DGI rempli (balance N et N-1,
 * fiche d'identification, renseignements du TFT) pour les notes annexes et les états supplémentaires.
 *
 * Chaque compte de l'ERP se range sous un compte de référence du modèle (même racine de 4 chiffres, sinon le plus proche
 * préfixe), puis sous son poste (AE, BI, DJ, TA, RH…) avec le solde retenu par le modèle : débiteur, créditeur ou net.
 * Les soldes sont calculés par compte et par tiers : un client créditeur passe au passif (clients, avances reçues).
 *
 * Exercice N-1 : l'exercice précédent s'il est tenu dans l'ERP ; sinon la balance N-1 importée pour l'exercice ;
 * à défaut, le bilan N-1 se lit dans les à-nouveaux de N (le compte de résultat N-1 reste vide).
 */
const { HttpError, isoDay } = require('../lib/http');
const { POSTES, ACTIF, PASSIF, RESULTAT, TFT, TFT_INPUTS, IDENTITY_FIELDS, DEFAULT_IDENTITY } = require('../lib/liasse');

const day = v => isoDay(v);
const fmt = n => (n == null ? '—' : `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')}`);
const POSTE_REFS = new Set(Object.keys(POSTES.postes));

// ─── Compte de l'ERP → compte de référence du modèle ─────────────────────────
const byRoot4 = new Map();
for (const a of POSTES.accounts) if (!byRoot4.has(a.slice(0, 4))) byRoot4.set(a.slice(0, 4), a);
const refCache = new Map();
/** Compte de référence (6 chiffres) d'un compte de l'ERP, ou null s'il n'a pas sa place dans le modèle (classe 9, 13…). */
function refAccount(code) {
  const c = String(code).replace(/\D/g, '');
  if (refCache.has(c)) return refCache.get(c);
  let out = null;
  if (c.length >= 4) out = byRoot4.get(c.slice(0, 4)) || null;
  if (!out) out = byRoot4.get(c.padEnd(4, '0').slice(0, 4)) || null;
  for (let n = Math.min(c.length, 4); !out && n >= 2; n--) out = POSTES.accounts.find(a => a.startsWith(c.slice(0, n))) || null;
  refCache.set(c, out);
  return out;
}

/**
 * Balance au format du modèle : { refs: Map(compte de référence → { d, c } soldes débiteurs et créditeurs), unmapped,
 * result13 (solde créditeur net des comptes 13, résultat déjà affecté en écriture) }.
 * `rows` : [{ code, label, debit, credit }] (un solde par compte et par tiers).
 */
function toModel(rows) {
  const refs = new Map();
  const unmapped = new Map();
  let result13 = 0;
  for (const r of rows) {
    const s = (Number(r.debit) || 0) - (Number(r.credit) || 0);
    if (!s) continue;
    const code = String(r.code);
    if (code.startsWith('13')) { result13 -= s; continue; }
    const ref = refAccount(code);
    if (!ref) { const u = unmapped.get(code) || { code, label: r.label || '', balance: 0 }; u.balance += s; unmapped.set(code, u); continue; }
    const t = refs.get(ref) || { d: 0, c: 0 };
    if (s > 0) t.d += s; else t.c -= s;
    refs.set(ref, t);
  }
  return { refs, unmapped: [...unmapped.values()].filter(u => u.balance), result13, rows };
}

const posteValue = (bal, ref, col) => (POSTES.postes[ref]?.[col] || []).reduce((t, [acc, mode]) => {
  const v = bal.refs.get(acc);
  if (!v) return t;
  return t + ({ D: v.d, C: v.c, DC: v.d - v.c, CD: v.c - v.d }[mode] || 0);
}, 0);

/** Bilan et compte de résultat d'une balance au format du modèle. */
function compute(bal) {
  const res = {};
  for (const l of RESULTAT) {
    if (l.sum) res[l.ref] = l.sum.reduce((t, k) => t + (res[k] || 0), 0);
    else res[l.ref] = l.side === 'charge' ? -posteValue(bal, l.ref, 'a') : posteValue(bal, l.ref, 'b');
  }
  // Lignes d'abord, totaux ensuite (un total du modèle précède ses lignes : AD avant AE à AH)
  const actif = {};
  for (const l of ACTIF.filter(x => !x.sum)) {
    const brut = posteValue(bal, l.ref, 'a');
    const amort = posteValue(bal, l.ref, 'b');
    actif[l.ref] = { brut, amort, net: brut - amort };
  }
  for (const l of ACTIF.filter(x => x.sum)) {
    actif[l.ref] = ['brut', 'amort', 'net'].reduce((o, k) => ({ ...o, [k]: l.sum.reduce((t, r) => t + actif[r][k], 0) }), {});
  }
  const passif = {};
  for (const l of PASSIF.filter(x => !x.sum)) {
    if (l.ref === 'CB') passif.CB = -posteValue(bal, 'CB', 'a');
    else if (l.ref === 'CJ') passif.CJ = res.XI + bal.result13;
    else passif[l.ref] = posteValue(bal, l.ref, 'b');
  }
  for (const l of PASSIF.filter(x => x.sum)) passif[l.ref] = l.sum.reduce((t, r) => t + passif[r], 0);
  // Comptes 481 (créances et dettes sur acquisitions ou cessions d'immobilisations) : hors BFR dans le TFT, comme le modèle
  const inv = { d: 0, c: 0 };
  for (const [ref, v] of bal.refs) if (ref.startsWith('481')) { inv.d += v.d; inv.c += v.c; }
  return { actif, passif, resultat: res, inv };
}

// ─── Balances de l'exercice ─────────────────────────────────────────────────
async function ledgerRows(db, { fiscalYearId, includeDraft = false, onlyOpening = false }) {
  const q = db('acc_lines as l').join('acc_entries as e', 'e.id', 'l.entry_id').join('acc_accounts as a', 'a.id', 'l.account_id').where('e.fiscal_year_id', fiscalYearId);
  if (!includeDraft) q.where('e.status', 'valide');
  if (onlyOpening) q.where('e.source', 'an');
  const rows = await q.groupBy('a.code', 'a.label', 'l.partner_type', 'l.partner_id').select('a.code', 'a.label').sum({ debit: 'l.debit' }).sum({ credit: 'l.credit' });
  return rows.map(r => ({ code: r.code, label: r.label, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }));
}

async function previousYear(db, fy) {
  return db('acc_fiscal_years').where('end_date', '<', day(fy.start_date)).orderBy('end_date', 'desc').first();
}

/** Balance N-1 et sa source : exercice précédent tenu dans l'ERP, balance importée, ou à-nouveaux de N (bilan seul). */
async function previousBalance(db, fy, { includeDraft }) {
  const prev = await previousYear(db, fy);
  if (prev && (await db('acc_entries').where({ fiscal_year_id: prev.id }).first('id'))) {
    return { source: 'erp', label: `Exercice ${prev.label} tenu dans l’ERP`, year: prev, rows: await ledgerRows(db, { fiscalYearId: prev.id, includeDraft }) };
  }
  const imported = await db('liasse_balances_n1').where({ fiscal_year_id: fy.id }).select('account as code', 'label', 'debit', 'credit');
  if (imported.length) return { source: 'import', label: 'Balance N-1 importée', rows: imported };
  const opening = await ledgerRows(db, { fiscalYearId: fy.id, includeDraft: true, onlyOpening: true });
  if (opening.length) return { source: 'an', label: 'Bilan N-1 lu dans les à-nouveaux (compte de résultat N-1 non disponible : importez la balance N-1)', rows: opening, balanceOnly: true };
  return { source: null, label: 'Aucune donnée N-1 : importez la balance N-1 de l’exercice précédent', rows: [] };
}

// ─── Renseignements, identité ────────────────────────────────────────────────
async function getInputs(db, fyId) {
  const row = await db('liasse_inputs').where({ fiscal_year_id: fyId }).first();
  try { return row?.data ? JSON.parse(row.data) : {}; } catch { return {}; }
}
async function saveInputs(db, fyId, patch, userId) {
  const data = { ...(await getInputs(db, fyId)), ...patch };
  const row = { fiscal_year_id: fyId, data: JSON.stringify(data), updated_by: userId, updated_at: new Date() };
  if (await db('liasse_inputs').where({ fiscal_year_id: fyId }).first()) await db('liasse_inputs').where({ fiscal_year_id: fyId }).update(row);
  else await db('liasse_inputs').insert(row);
  return data;
}
async function getIdentity(db) {
  const row = await db('app_settings').where({ key: 'liasse_identity' }).first();
  let saved = {};
  try { saved = row?.value ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  return { ...DEFAULT_IDENTITY, ...saved };
}
async function saveIdentity(db, patch) {
  const value = JSON.stringify(Object.fromEntries(Object.entries({ ...(await getIdentity(db)), ...patch }).filter(([k]) => IDENTITY_FIELDS[k])));
  if (await db('app_settings').where({ key: 'liasse_identity' }).first()) await db('app_settings').where({ key: 'liasse_identity' }).update({ value, updated_at: new Date() });
  else await db('app_settings').insert({ key: 'liasse_identity', value });
  return getIdentity(db);
}

/** Renseignements du TFT proposés depuis les mouvements de l'exercice (hors à-nouveaux et contrepassations annulées). */
async function proposedTftInputs(db, fy, { includeDraft }) {
  const q = db('acc_lines as l').join('acc_entries as e', 'e.id', 'l.entry_id').join('acc_accounts as a', 'a.id', 'l.account_id')
    .where('e.fiscal_year_id', fy.id).whereNot('e.source', 'an');
  if (!includeDraft) q.where('e.status', 'valide');
  const rows = await q.groupBy('a.code').select('a.code').sum({ d: 'l.debit' }).sum({ c: 'l.credit' });
  const out = {};
  for (const [k, def] of Object.entries(TFT_INPUTS)) {
    out[k] = rows.filter(r => def.roots.some(p => r.code.startsWith(p)) && !(def.except || []).some(p => r.code.startsWith(p)))
      .reduce((t, r) => t + (Number(def.side === 'debit' ? r.d : r.c) || 0), 0);
  }
  return out;
}

// ─── Liasse d'un exercice ────────────────────────────────────────────────────
async function statements(db, fiscalYearId, { includeDraft = false } = {}) {
  const fy = await db('acc_fiscal_years').where({ id: fiscalYearId }).first();
  if (!fy) throw new HttpError(404, 'Exercice introuvable.');
  const n = toModel(await ledgerRows(db, { fiscalYearId: fy.id, includeDraft }));
  const prev = await previousBalance(db, fy, { includeDraft });
  const p = prev.rows.length ? toModel(prev.rows) : null;
  const N = compute(n);
  const P = p ? compute(p) : null;
  // Colonne « net N-1 » de l'actif : le modèle DGI affiche 0 pour un net négatif (lignes), totaux sur ces lignes
  const actifN1 = {};
  if (P) {
    for (const l of ACTIF.filter(x => !x.sum)) actifN1[l.ref] = Math.max(0, P.actif[l.ref].net);
    for (const l of ACTIF.filter(x => x.sum)) actifN1[l.ref] = l.sum.reduce((t, k) => t + actifN1[k], 0);
  }
  if (P && prev.balanceOnly) for (const k of Object.keys(P.resultat)) P.resultat[k] = null;

  // TFT de l'exercice N
  const inputs = await getInputs(db, fy.id);
  const proposed = await proposedTftInputs(db, fy, { includeDraft });
  const tftInputs = Object.fromEntries(Object.keys(TFT_INPUTS).map(k => [k, inputs.tft?.[k] != null ? Number(inputs.tft[k]) : proposed[k]]));
  const r = N.resultat;
  const tft = {};
  const net = (S, k) => S.actif[k].net;
  tft.ZA = P ? actifN1.BT - P.passif.DT : null; // trésorerie-actif N-1 telle qu'affichée au bilan (modèle : BILAN!I37 − N37)
  tft.FA = r.XI - r.RL - r.TJ - r.RO - r.TN - r.RN - r.TL;
  tft.FB = P ? -(net(N, 'BA') - net(P, 'BA')) : null;
  tft.FC = P ? -(net(N, 'BB') - net(P, 'BB')) : null;
  tft.FD = P ? -((net(N, 'BG') - N.inv.d) - (net(P, 'BG') - P.inv.d)) : null;
  tft.FE = P ? (N.passif.DP - N.inv.c) - (P.passif.DP - P.inv.c) : null;
  for (const l of TFT.filter(x => x.input)) tft[l.ref] = l.sign * (tftInputs[l.ref] || 0);
  for (const l of TFT.filter(x => x.sum)) tft[l.ref] = l.sum.some(k => tft[k] == null) ? null : l.sum.reduce((t, k) => t + tft[k], 0);
  const treasuryEnd = net(N, 'BT') - N.passif.DT;

  const drafts = Number((await db('acc_entries').where({ fiscal_year_id: fy.id, status: 'brouillon' }).count({ n: '*' }))[0].n);
  const controls = [
    { key: 'equilibre', label: 'Total actif net = total passif', ok: N.actif.BZ.net === N.passif.DZ, detail: `actif ${fmt(N.actif.BZ.net)} · passif ${fmt(N.passif.DZ)}` },
    { key: 'resultat', label: 'Résultat du bilan (CJ) = résultat net (XI)', ok: N.passif.CJ === r.XI || !!n.result13, detail: n.result13 ? 'résultat déjà affecté en écriture (comptes 13)' : `CJ ${fmt(N.passif.CJ)} · XI ${fmt(r.XI)}` },
    { key: 'comptes', label: 'Tous les comptes mouvementés ont leur poste', ok: !n.unmapped.length, detail: n.unmapped.length ? `${n.unmapped.length} compte(s) hors modèle` : null },
    { key: 'brouillons', label: 'Aucune écriture en brouillon sur l’exercice', ok: !drafts, warn: true, detail: drafts ? `${drafts} brouillon(s) ${includeDraft ? 'compris dans les états' : 'non compris : validez-les'}` : null },
    { key: 'n1', label: 'Exercice N-1 disponible', ok: !!P && !prev.balanceOnly, warn: true, detail: prev.label },
    { key: 'tft', label: 'Trésorerie de fin du TFT = trésorerie du bilan', ok: tft.ZH == null ? null : tft.ZH === treasuryEnd, detail: tft.ZH == null ? 'calculable avec le bilan N-1' : `TFT ${fmt(tft.ZH)} · bilan ${fmt(treasuryEnd)}` },
  ];
  if (P && !prev.balanceOnly) controls.push({ key: 'equilibre_n1', label: 'Bilan N-1 équilibré', ok: P.actif.BZ.net === P.passif.DZ, detail: `actif ${fmt(P.actif.BZ.net)} · passif ${fmt(P.passif.DZ)}` });

  const lines = (list, fn) => list.map(l => (l.section ? l : { ...l, ...fn(l) }));
  return {
    fiscal_year: { id: fy.id, label: fy.label, start_date: day(fy.start_date), end_date: day(fy.end_date), status: fy.status },
    previous: { source: prev.source, label: prev.label, year: prev.year ? { id: prev.year.id, label: prev.year.label, end_date: day(prev.year.end_date) } : null },
    include_draft: includeDraft, identity: await getIdentity(db), identity_fields: IDENTITY_FIELDS,
    actif: lines(ACTIF, l => ({ brut: N.actif[l.ref].brut, amort: N.actif[l.ref].amort, net: N.actif[l.ref].net, net_n1: P ? actifN1[l.ref] : null })),
    passif: lines(PASSIF, l => ({ n: N.passif[l.ref], n1: P ? P.passif[l.ref] : null })),
    resultat: lines(RESULTAT, l => ({ n: r[l.ref], n1: P ? P.resultat[l.ref] : null })),
    tft: lines(TFT, l => ({ n: tft[l.ref] })),
    tft_inputs: Object.fromEntries(Object.entries(TFT_INPUTS).map(([k, d]) => [k, { label: d.label, proposed: proposed[k], saved: inputs.tft?.[k] ?? null, value: tftInputs[k] }])),
    controls, unmapped: n.unmapped,
    balances: { n: n.rows, n1: p ? p.rows : [] },
  };
}

// ─── Classeur officiel rempli ────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colNum = col => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const splitRef = ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return [m[1], Number(m[2])]; };

/** Écrit des valeurs dans le XML d'une feuille (cellules existantes gardent leur style ; formules de la cellule remplacées). */
function setCells(xml, values) {
  const byRow = new Map();
  for (const [ref, v] of Object.entries(values)) {
    const [, r] = splitRef(ref);
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push([ref, v]);
  }
  const cellXml = (ref, v, style) => {
    const s = style ? ` s="${style}"` : '';
    if (v == null || v === '') return `<c r="${ref}"${s}/>`;
    if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  let out = xml;
  for (const [r, cells] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const rowRe = new RegExp(`<row r="${r}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
    let m = rowRe.exec(out);
    if (!m) {
      // Ligne absente : insérée à sa place
      const next = [...out.matchAll(/<row r="(\d+)"/g)].find(x => Number(x[1]) > r);
      const row = `<row r="${r}"></row>`;
      out = next ? out.slice(0, next.index) + row + out.slice(next.index) : out.replace('</sheetData>', `${row}</sheetData>`);
      m = rowRe.exec(out);
    }
    let row = m[0];
    if (row.endsWith('/>')) row = `${row.slice(0, -2)}></row>`;
    for (const [ref, v] of cells) {
      const cellRe = new RegExp(`<c r="${ref}"(?: [^>]*?)?(?:/>|>[\\s\\S]*?</c>)`);
      const existing = cellRe.exec(row);
      if (existing) {
        const style = /\ss="(\d+)"/.exec(existing[0])?.[1];
        row = row.replace(existing[0], cellXml(ref, v, style));
      } else {
        const [col] = splitRef(ref);
        const after = [...row.matchAll(/<c r="([A-Z]+)\d+"/g)].find(x => colNum(x[1]) > colNum(col));
        const c = cellXml(ref, v);
        row = after ? row.slice(0, after.index) + c + row.slice(after.index) : row.replace('</row>', `${c}</row>`);
      }
    }
    out = out.replace(m[0], row);
  }
  return out;
}

const excelDate = iso => Math.round((Date.UTC(...iso.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0))) - Date.UTC(1899, 11, 30)) / 864e5);
const months = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + mb - ma + 1; };

/** Classeur DGI (modèle de la Comptabilité) rempli : balances N et N-1, fiche d'identification, renseignements du TFT. */
async function workbook(db, fiscalYearId, { includeDraft = false } = {}) {
  const JSZip = require('jszip');
  const path = require('path');
  const fs = require('fs');
  const s = await statements(db, fiscalYearId, { includeDraft });
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, '../../assets/liasse-dgi-modele.xlsm')));
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheetPath = name => {
    const m = new RegExp(`<sheet [^>]*name="${esc(name)}"[^>]*r:id="([^"]+)"`).exec(wbXml);
    const t = m && (new RegExp(`Id="${m[1]}"[^>]*Target="([^"]+)"`).exec(rels) || new RegExp(`Target="([^"]+)"[^>]*Id="${m[1]}"`).exec(rels));
    if (!t) throw new HttpError(500, `Feuille « ${name} » absente du modèle de liasse.`);
    return `xl/${t[1].replace(/^\/?xl\//, '')}`;
  };
  const edit = async (name, values) => { const p = sheetPath(name); zip.file(p, setCells(await zip.file(p).async('string'), values)); };

  // Balance : un solde par compte de référence (le classeur range chaque compte par ses 4 premiers chiffres)
  const collage = {};
  const fill = (rows, [cA, cD, cC]) => {
    const agg = new Map();
    for (const r of rows) {
      const solde = (Number(r.debit) || 0) - (Number(r.credit) || 0);
      if (!solde) continue;
      // Comptes 13 (résultat déjà affecté) : gardés tels quels pour l'équilibre de la balance collée
      const ref = String(r.code).startsWith('13') ? String(r.code).padEnd(6, '0') : refAccount(r.code);
      if (!ref) continue;
      const t = agg.get(ref) || { d: 0, c: 0 };
      if (solde > 0) t.d += solde; else t.c -= solde;
      agg.set(ref, t);
    }
    let row = 4;
    for (const [ref, t] of [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      collage[`${cA}${row}`] = ref; collage[`${cD}${row}`] = t.d || null; collage[`${cC}${row}`] = t.c || null; row++;
    }
  };
  fill(s.balances.n, ['A', 'B', 'C']);
  fill(s.balances.n1, ['I', 'J', 'K']);
  await edit('Collage_Balance', collage);

  const id = s.identity;
  const fy = s.fiscal_year;
  const prevEnd = s.previous.year?.end_date || isoDay(new Date(new Date(`${fy.start_date}T12:00:00Z`).getTime() - 864e5));
  await edit('Présentation_Entité', {
    D1: id.denomination, D2: id.sigle, D3: id.boite_postale, D4: id.adresse, D5: id.ntd, D6: id.ncc, D7: id.rccm, K6: id.centre_impots, K7: id.cnps,
    K1: excelDate(fy.start_date), M1: excelDate(fy.end_date), K2: excelDate(prevEnd), K4: excelDate(fy.end_date), K5: `${months(fy.start_date, fy.end_date)} MOIS`,
  });
  // Renseignements du TFT de l'exercice N (montants positifs, comme dans le modèle)
  const v = k => s.tft_inputs[k].value || 0;
  await edit('Table_TFT', { F5: v('FF'), F6: v('FG'), F7: v('FH'), F8: v('FI'), F9: 0, F10: v('FJ'), F11: v('FK'), J5: v('FL'), J6: v('FM'), J7: v('FN'), J8: v('FO'), J9: v('FP'), J10: v('FQ') });

  // Recalcul complet à l'ouverture dans Excel
  zip.file('xl/workbook.xml', wbXml.replace(/<calcPr([^>]*?)\/>/, (m, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`));
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), statements: s };
}

module.exports = { refAccount, toModel, compute, statements, workbook, getInputs, saveInputs, getIdentity, saveIdentity, POSTE_REFS };
