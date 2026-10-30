/**
 * Import d'un fichier exporté de Sage (point 4 du client du 29/10) : écritures, plan comptable ou soldes d'ouverture.
 * Le comptable choisit le type, dépose le fichier (CSV, TXT, Excel), indique quelle colonne porte quelle donnée
 * (correspondance proposée d'après les intitulés et mémorisée), simule, puis importe. Réimporter ne crée pas de doublon.
 */
import { useMemo, useState } from 'react';
import { Upload, FlaskConical, Download } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Modal, Field, ErrorBox, Badge, Skeleton } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { readSheet } from '@admin/lib/sheetRead';
import { amt } from '../../lib/compta';

// Intitulés courants des exports Sage, pour proposer la correspondance des colonnes
const GUESS = {
  journal: /journal|^jnl|code jour/i, date: /^date|date (de )?pi[eè]ce|date écriture/i, piece: /pi[eè]ce|n° ?pi|num[eé]ro/i,
  account: /compte g[eé]n|^compte$|n° ?compte|^n° de compte|account/i, partner: /tiers|auxiliaire/i, label: /libell|intitul/i,
  debit: /d[eé]bit/i, credit: /cr[eé]dit/i, amount: /montant|solde/i, direction: /^sens/i, ref: /r[eé]f[eé]rence/i,
};
const RIGHT = { ecritures: 'compta:import', plan: 'compta:plan', balance: 'compta:opening' };

export default function SageImport({ onClose, onDone }) {
  const { can } = useAuth();
  const saved = useSaved();
  const meta = useResource('/admin/erp/compta/import/sage');
  const kinds = meta.data ? Object.entries(meta.data.kinds).filter(([k]) => can(RIGHT[k])) : [];
  const [kind, setKind] = useState(() => ['ecritures', 'plan', 'balance'].find(k => can(RIGHT[k])));
  const [file, setFile] = useState(null);
  const [sheet, setSheet] = useState(null); // { rows }
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState({});
  const [options, setOptions] = useState({ date_format: 'JJMMAAAA', decimal: ',', create_accounts: false, create_journals: false, update_labels: false, validate: false, fiscal_year_id: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const def = meta.data?.kinds[kind];

  const headers = useMemo(() => {
    if (!sheet) return [];
    const width = Math.max(...sheet.rows.slice(0, 50).map(r => r.length));
    return Array.from({ length: width }, (_, i) => (hasHeader ? String(sheet.rows[0][i] ?? '').trim() : '') || `Colonne ${i + 1}`);
  }, [sheet, hasHeader]);
  const body = useMemo(() => (sheet ? sheet.rows.slice(hasHeader ? 1 : 0).map((cells, i) => ({ line: i + (hasHeader ? 2 : 1), cells: cells.map(c => (typeof c === 'number' ? c : String(c).slice(0, 500))) })) : []), [sheet, hasHeader]);

  // Correspondance : celle mémorisée au dernier import du même type (par intitulé), sinon devinée
  const propose = (k, hs) => {
    const memo = meta.data?.saved?.[k];
    const out = {};
    for (const [field] of meta.data.kinds[k].fields) {
      const byMemo = memo?.mapping?.[field] ? hs.indexOf(memo.mapping[field]) : -1;
      const byGuess = hs.findIndex((h, i) => GUESS[field]?.test(h) && !Object.values(out).includes(i));
      const i = byMemo >= 0 ? byMemo : byGuess;
      if (i >= 0) out[field] = i;
    }
    setMapping(out);
    if (memo) setOptions(o => ({ ...o, date_format: memo.date_format || o.date_format, decimal: memo.decimal || o.decimal }));
  };
  const read = async f => {
    setError(null); setResult(null); setFile(f);
    try {
      const s = await readSheet(f);
      if (!s.rows.length) throw new Error('fichier vide.');
      // En-tête : la première ligne n'a pas de montant ni de date lisible
      const first = s.rows[0].map(c => String(c));
      const header = !first.some(c => /^\d{6,8}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^-?[\d\s]+[,.]\d{2}$/.test(c.trim()));
      setSheet(s); setHasHeader(header);
      const hs = Array.from({ length: Math.max(...s.rows.slice(0, 50).map(r => r.length)) }, (_, i) => (header ? String(s.rows[0][i] ?? '').trim() : '') || `Colonne ${i + 1}`);
      propose(kind, hs);
    } catch (e) { setSheet(null); setError(new Error(`Lecture impossible : ${e.message}`)); }
  };
  const changeKind = k => { setKind(k); setResult(null); if (sheet) propose(k, headers); };

  const missing = def ? def.fields.filter(([f, , req]) => req && mapping[f] == null).map(([, l]) => l) : [];
  const amountsOk = kind === 'plan' || mapping.amount != null || mapping.debit != null || mapping.credit != null;
  const send = async dryRun => {
    setBusy(true); setError(null);
    try {
      const opts = { ...options, fiscal_year_id: options.fiscal_year_id ? Number(options.fiscal_year_id) : undefined };
      const out = await api.post('/admin/erp/compta/import/sage', { kind, dry_run: dryRun, rows: body, mapping, headers, options: opts });
      setResult({ ...out, dryRun });
      if (!dryRun && !out.errors.length) {
        const s = out.summary;
        saved(kind === 'ecritures' ? `${s.created} écriture(s) importée(s)${s.duplicates ? `, ${s.duplicates} déjà présente(s)` : ''}` : kind === 'plan' ? `${s.created} compte(s) créé(s)` : 'Soldes d’ouverture importés');
        onDone?.();
      }
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const canImport = result?.dryRun && !result.errors.length && !busy;
  const opt = (k, label, hint) => <label className="checkbox" title={hint}><input type="checkbox" checked={!!options[k]} onChange={e => { setOptions(o => ({ ...o, [k]: e.target.checked })); setResult(null); }} />{label}</label>;

  return (
    <Modal title="Importer un fichier Sage" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn" disabled={!sheet || missing.length > 0 || !amountsOk || busy} onClick={() => send(true)}><FlaskConical />Simuler</button>
        <button className="btn btn-primary" disabled={!canImport} onClick={() => send(false)} title={!canImport ? 'Simulez d’abord : l’import s’ouvre quand la simulation ne signale aucune erreur' : undefined}><Download />Importer</button>
      </>}>
      {!meta.data ? <Skeleton h={200} /> : (
        <div className="stack wide-form" style={{ gap: 14 }}>
          <ErrorBox error={error || meta.error} />
          <div className="seg" role="group" aria-label="Type d’import">
            {kinds.map(([k, x]) => <button key={k} className={kind === k ? 'active' : ''} onClick={() => changeKind(k)}>{x.label}</button>)}
          </div>
          <p className="small muted">
            {kind === 'ecritures' && 'Export des écritures de Sage (une ligne par mouvement). Les lignes sont regroupées par journal, date et n° de pièce ; chaque pièce doit être équilibrée. Réimporter le même fichier ne crée pas de doublon.'}
            {kind === 'plan' && 'Export du plan comptable de Sage. Les numéros sur 8 chiffres sont rapprochés du plan SIIPAF en ignorant les zéros de fin (41100000 → 411) ; les comptes nouveaux sont créés sous leur compte parent.'}
            {kind === 'balance' && 'Balance de clôture de l’ancienne comptabilité : elle devient l’écriture de soldes d’ouverture (journal AN) de l’exercice choisi. Débits et crédits doivent s’équilibrer.'}
          </p>

          <div className="row" style={{ gap: 10 }}>
            <label className="btn"><Upload />{file ? 'Changer de fichier' : 'Choisir le fichier'}<input type="file" hidden accept=".csv,.txt,.prn,.xlsx,.xls" onChange={e => e.target.files[0] && read(e.target.files[0])} /></label>
            {file && sheet && <span className="small muted">{file.name} · {body.length} ligne(s)</span>}
            {sheet && <label className="checkbox"><input type="checkbox" checked={hasHeader} onChange={e => { setHasHeader(e.target.checked); setResult(null); }} />Première ligne = intitulés des colonnes</label>}
          </div>

          {sheet && def && (
            <>
              <h3 className="erp-h3">Colonnes du fichier</h3>
              <div className="form-grid">
                {def.fields.map(([field, label, required]) => (
                  <Field key={field} label={`${label}${required ? ' *' : ''}`}>
                    <select className="select" value={mapping[field] ?? ''} onChange={e => { setMapping(m => ({ ...m, [field]: e.target.value === '' ? undefined : Number(e.target.value) })); setResult(null); }}>
                      <option value="">— Aucune —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}{body[0]?.cells[i] != null && String(body[0].cells[i]).trim() ? ` (ex. ${String(body[0].cells[i]).slice(0, 24)})` : ''}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              {!amountsOk && <p className="small" style={{ color: 'var(--danger)' }}>Indiquez les colonnes Débit et Crédit, ou une colonne Montant.</p>}
              <h3 className="erp-h3">Format et options</h3>
              <div className="form-grid">
                {kind !== 'plan' && (
                  <>
                    {kind === 'ecritures' && <Field label="Format des dates"><select className="select" value={options.date_format} onChange={e => { setOptions(o => ({ ...o, date_format: e.target.value })); setResult(null); }}>{meta.data.date_formats.map(f => <option key={f} value={f}>{f}</option>)}</select></Field>}
                    <Field label="Séparateur décimal"><select className="select" value={options.decimal} onChange={e => { setOptions(o => ({ ...o, decimal: e.target.value })); setResult(null); }}><option value=",">Virgule (1 500 000,00)</option><option value=".">Point (1500000.00)</option></select></Field>
                  </>
                )}
                {kind === 'balance' && (
                  <Field label="Exercice qui reçoit les soldes *"><select className="select" value={options.fiscal_year_id} onChange={e => { setOptions(o => ({ ...o, fiscal_year_id: e.target.value })); setResult(null); }}><option value="">— Choisir —</option>{meta.data.fiscal_years.filter(y => y.status !== 'cloture').map(y => <option key={y.id} value={y.id}>{y.label}</option>)}</select></Field>
                )}
              </div>
              <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                {kind !== 'plan' && opt('create_accounts', 'Créer les comptes manquants', 'Sous leur compte parent du plan')}
                {kind === 'ecritures' && opt('create_journals', 'Créer les journaux manquants', 'En opérations diverses ; modifiables ensuite dans Paramètres')}
                {kind === 'ecritures' && can('compta:validate') && opt('validate', 'Valider les écritures importées', 'Numérotation définitive ; sinon elles arrivent en brouillon')}
                {kind === 'plan' && opt('update_labels', 'Reprendre les intitulés de Sage', 'Pour les comptes ajoutés au plan (pas ceux du plan SYSCOHADA livré)')}
              </div>
            </>
          )}

          {result && <Result kind={kind} result={result} />}
        </div>
      )}
    </Modal>
  );
}

function Result({ kind, result }) {
  const s = result.summary;
  const done = !result.dryRun && !result.errors.length;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <h3 className="erp-h3">{done ? 'Import terminé' : 'Simulation'} {result.errors.length ? <Badge tone="danger">{result.errors.length} erreur(s) : rien ne sera enregistré</Badge> : <Badge tone="ok">{done ? 'enregistré' : 'prêt à importer'}</Badge>}</h3>
      <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
        {kind === 'ecritures' && <><span><b>{s.ready}</b> pièce(s) à importer</span><span><b>{s.duplicates}</b> déjà importée(s)</span><span>Total <b>{amt(s.debit, { zero: '0' })}</b></span>{s.journals_to_create > 0 && <span><b>{s.journals_to_create}</b> journal(aux) à créer</span>}{done && <span><b>{s.created}</b> créée(s){s.validated ? ', validées' : ', en brouillon'}</span>}</>}
        {kind === 'plan' && <><span><b>{s.known}</b> compte(s) déjà au plan</span><span><b>{s.to_create}</b> à créer</span>{s.relabeled > 0 && <span><b>{s.relabeled}</b> intitulé(s) repris</span>}</>}
        {kind === 'balance' && <><span>Exercice <b>{s.fiscal_year}</b></span><span><b>{s.lines}</b> compte(s)</span><span>Débits <b>{amt(s.debit, { zero: '0' })}</b> · crédits <b>{amt(s.credit, { zero: '0' })}</b></span></>}
        {s.accounts_to_create > 0 && <span><b>{s.accounts_to_create}</b> compte(s) {done ? 'créé(s)' : 'à créer'}</span>}
      </div>
      {result.errors.length > 0 && <Issues title="Erreurs à corriger dans le fichier ou les options" items={result.errors} tone="danger" />}
      {result.warnings.length > 0 && <Issues title="Avertissements (l’import reste possible)" items={result.warnings} />}
      {kind === 'ecritures' && result.preview.length > 0 && (
        <div className="table-wrap"><table className="table table-compact">
          <thead><tr><th>Journal</th><th>Date</th><th>Pièce</th><th>Libellé</th><th className="right">Lignes</th><th className="right">Montant</th></tr></thead>
          <tbody>{result.preview.map(e => <tr key={`${e.journal}${e.date}${e.piece}`}><td>{e.journal}</td><td className="nowrap">{date(e.date)}</td><td>{e.piece}</td><td className="small">{e.label}</td><td className="right">{e.lines}</td><td className="right tabular">{amt(e.amount)}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Issues({ title, items, tone }) {
  return (
    <div className={`alert${tone === 'danger' ? '' : ' alert-info'}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <b className="small">{title}</b>
      <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18, maxHeight: 180, overflow: 'auto' }}>
        {items.map((x, i) => <li key={i}>{x.line ? `Ligne ${x.line} : ` : ''}{x.message}</li>)}
      </ul>
    </div>
  );
}
