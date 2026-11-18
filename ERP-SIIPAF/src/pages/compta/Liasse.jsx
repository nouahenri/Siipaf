/**
 * Liasse fiscale DGI (SYSCOHADA révisé, système normal), tirée de la comptabilité : bilan actif et passif, compte de
 * résultat, tableau des flux de trésorerie, contrôles ; impression ; classeur DGI rempli (balances, identité, TFT)
 * pour les notes annexes et états supplémentaires. Préparation : fiche d'identification, balance N-1, renseignements du TFT.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Printer, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, Upload, Trash2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Field, Badge, Empty } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { amt } from '../../lib/compta';

const L = '/admin/erp/compta/liasse';
const VIEWS = [['actif', 'Bilan actif'], ['passif', 'Bilan passif'], ['resultat', 'Compte de résultat'], ['tft', 'Flux de trésorerie'], ['preparation', 'Préparation']];
const n0 = v => (v == null ? '' : v < 0 ? `(${amt(-v)})` : amt(v, { zero: '0' }));
const months = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + mb - ma + 1; };
/** En-tête des imprimés DGI (comme sur chaque état du modèle) : entité, NCC, NTD, exercice clos le, durée. */
function DgiHeader({ s, title }) {
  const id = s.identity;
  return (
    <div className="liasse-dgi-head">
      <div className="row-between" style={{ alignItems: 'baseline', gap: 12 }}><b>{title}</b><span className="small">Système normal — SYSCOHADA révisé</span></div>
      <div className="liasse-dgi-grid small">
        <span>Dénomination sociale de l’entité : <b>{id.denomination || '—'}</b></span><span>Sigle usuel : <b>{id.sigle || '—'}</b></span>
        <span>Adresse : <b>{[id.boite_postale, id.adresse].filter(Boolean).join(' — ') || '—'}</b></span><span>Exercice clos le : <b>{date(s.fiscal_year.end_date)}</b></span>
        <span>N° de compte contribuable (NCC) : <b>{id.ncc || '—'}</b></span><span>Durée (en mois) : <b>{months(s.fiscal_year.start_date, s.fiscal_year.end_date)}</b></span>
        <span>N° de télédéclarant (NTD) : <b>{id.ntd || '—'}</b></span>{s.include_draft ? <span><b>PROVISOIRE</b> — brouillons compris</span> : <span />}
      </div>
    </div>
  );
}
/**
 * « Imprimer / PDF » ouvre directement la fenêtre d'impression de l'ordinateur : la page des états est affichée le temps
 * de l'impression (paramètre imprimer=1), puis on revient à l'écran d'origine quand la fenêtre se ferme.
 */
export function useAutoPrint(ready, backTo) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const auto = params.get('imprimer') === '1';
  useEffect(() => {
    if (!ready || !auto) return undefined;
    const back = () => navigate(backTo, { replace: true });
    window.addEventListener('afterprint', back, { once: true });
    const t = setTimeout(() => window.print(), 400);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', back); };
  }, [ready, auto, backTo, navigate]);
}

const rowClass = l => [l.total ? 'liasse-total' : '', l.grand ? 'liasse-grand' : '', l.strong ? 'liasse-strong' : ''].join(' ');

export function useLiasse(fy, draft) {
  return useResource(fy ? `${L}/${fy}${draft ? '?draft=1' : ''}` : null);
}

export default function Liasse() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const meta = useResource(`${L}/meta`);
  const years = meta.data?.fiscal_years || [];
  const fy = Number(params.get('exercice')) || years.find(y => y.status === 'ouvert')?.id || years[0]?.id;
  const draft = params.get('brouillons') === '1';
  const view = params.get('vue') || 'actif';
  const data = useLiasse(fy, draft);
  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  if (meta.error) return <ErrorBox error={meta.error} />;
  if (!meta.data) return <Skeleton h={300} />;
  if (!years.length) return <Card title="Liasse fiscale"><Empty>Aucun exercice comptable : créez-le dans les Réglages de la Comptabilité.</Empty></Card>;
  const s = data.data;
  const q = `${draft ? '?draft=1' : ''}`;
  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="select" style={{ width: 'auto' }} value={fy || ''} onChange={e => set('exercice', e.target.value)} aria-label="Exercice">
            {years.map(y => <option key={y.id} value={y.id}>Exercice {y.label}{y.status === 'cloture' ? ' (clôturé)' : ''}</option>)}
          </select>
          <label className="checkbox small" title="Par défaut, seules les écritures validées entrent dans la liasse"><input type="checkbox" checked={draft} onChange={e => set('brouillons', e.target.checked ? '1' : '')} />Brouillons compris (provisoire)</label>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn btn-sm" to={`/compta/liasse/impression/${fy}?imprimer=1${draft ? '&draft=1' : ''}`}><Printer />Imprimer / PDF</Link>
          <a className="btn btn-sm btn-primary" href={`/api${L}/${fy}/classeur${q}`} title="Classeur officiel de la DGI rempli : balances N et N-1, identité, renseignements du TFT ; Excel calcule les notes annexes à l’ouverture"><FileSpreadsheet />Classeur DGI (Excel)</a>
        </div>
      </div>
      <ErrorBox error={data.error} />
      {!s ? <Skeleton h={400} /> : (
        <>
          <Controls s={s} />
          <div className="tabs" role="tablist">
            {VIEWS.filter(([id]) => id !== 'preparation' || can('liasse:prepare')).map(([id, l]) => <button key={id} role="tab" aria-selected={view === id} className={`tab ${view === id ? 'active' : ''}`} onClick={() => set('vue', id)}>{l}</button>)}
          </div>
          {view === 'actif' && <Actif s={s} />}
          {view === 'passif' && <Passif s={s} />}
          {view === 'resultat' && <Resultat s={s} />}
          {view === 'tft' && <Tft s={s} />}
          {view === 'preparation' && can('liasse:prepare') && <Preparation s={s} draft={draft} onChange={() => { data.reload(); meta.reload(); }} />}
          <p className="small muted">Postes et comptes repris du modèle DGI de la Comptabilité (SYSCOHADA révisé, système normal). Les notes annexes (1 à 39) et les états supplémentaires DGI se calculent dans le classeur Excel rempli ; les renseignements qui ne sont pas en comptabilité (effectifs, dirigeants…) s’y complètent.</p>
        </>
      )}
    </div>
  );
}

function Controls({ s }) {
  const icon = c => (c.ok === true ? <CheckCircle2 size={15} style={{ color: 'var(--ok)' }} /> : c.ok == null ? <AlertTriangle size={15} style={{ color: 'var(--muted, #888)' }} /> : c.warn ? <AlertTriangle size={15} style={{ color: 'var(--warn, #b7791f)' }} /> : <XCircle size={15} style={{ color: 'var(--danger)' }} />);
  return (
    <Card title={`Contrôles — exercice ${s.fiscal_year.label} (${date(s.fiscal_year.start_date)} → ${date(s.fiscal_year.end_date)})`}>
      <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
        {s.controls.map(c => <li key={c.key} className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ flexShrink: 0, marginTop: 1 }}>{icon(c)}</span><span><b>{c.label}</b>{c.detail ? <span className="muted"> — {c.detail}</span> : null}</span></li>)}
      </ul>
      {s.unmapped.length > 0 && <p className="small" style={{ marginTop: 8 }}>Comptes hors modèle : {s.unmapped.map(u => `${u.code} ${u.label} (${n0(u.balance)})`).join(' · ')}</p>}
    </Card>
  );
}

export function Actif({ s, print }) {
  return (
    <Card title={print ? undefined : 'Bilan — actif'} bodyClass="">
      {print && <DgiHeader s={s} title="BILAN — ACTIF" />}
      <div className="table-wrap"><table className="table liasse-table">
        <thead><tr><th>Réf</th><th>Actif</th><th>Note</th><th className="right">Brut</th><th className="right">Amort. et dépréc.</th><th className="right">Net {s.fiscal_year.label}</th><th className="right">Net N-1</th></tr></thead>
        <tbody>{s.actif.map(l => <tr key={l.ref} className={rowClass(l)}><td className="tabular">{l.ref}</td><td>{l.label}</td><td className="small muted">{l.note || ''}</td><td className="right tabular">{n0(l.brut)}</td><td className="right tabular">{n0(l.amort)}</td><td className="right tabular">{n0(l.net)}</td><td className="right tabular">{n0(l.net_n1)}</td></tr>)}</tbody>
      </table></div>
    </Card>
  );
}

export function Passif({ s, print }) {
  return (
    <Card title={print ? undefined : 'Bilan — passif'} bodyClass="">
      {print && <DgiHeader s={s} title="BILAN — PASSIF" />}
      <div className="table-wrap"><table className="table liasse-table">
        <thead><tr><th>Réf</th><th>Passif</th><th>Note</th><th className="right">{s.fiscal_year.label}</th><th className="right">N-1</th></tr></thead>
        <tbody>{s.passif.map(l => <tr key={l.ref} className={rowClass(l)}><td className="tabular">{l.ref}</td><td>{l.label}</td><td className="small muted">{l.note || ''}</td><td className="right tabular">{n0(l.n)}</td><td className="right tabular">{n0(l.n1)}</td></tr>)}</tbody>
      </table></div>
    </Card>
  );
}

export function Resultat({ s, print }) {
  return (
    <Card title={print ? undefined : 'Compte de résultat'} bodyClass="">
      {print && <DgiHeader s={s} title="COMPTE DE RÉSULTAT" />}
      <div className="table-wrap"><table className="table liasse-table">
        <thead><tr><th>Réf</th><th>Libellés</th><th>Note</th><th className="right">{s.fiscal_year.label}</th><th className="right">N-1</th></tr></thead>
        <tbody>{s.resultat.map(l => <tr key={l.ref} className={rowClass(l)}><td className="tabular">{l.ref}</td><td>{l.label}</td><td className="small muted">{l.note || ''}</td><td className="right tabular">{n0(l.n)}</td><td className="right tabular">{n0(l.n1)}</td></tr>)}</tbody>
      </table></div>
      <p className="small muted" style={{ padding: '8px 16px' }}>Charges entre parenthèses (solde débiteur), produits en positif, comme sur l’imprimé DGI.</p>
    </Card>
  );
}

export function Tft({ s, print }) {
  return (
    <Card title={print ? undefined : 'Tableau des flux de trésorerie'} bodyClass="">
      {print && <DgiHeader s={s} title="TABLEAU DES FLUX DE TRÉSORERIE" />}
      <div className="table-wrap"><table className="table liasse-table">
        <thead><tr><th>Réf</th><th>Libellés</th><th className="right">{s.fiscal_year.label}</th></tr></thead>
        <tbody>{s.tft.map((l, i) => (l.section
          ? <tr key={`s${i}`} className="group-row"><td colSpan={3}>{l.section}</td></tr>
          : <tr key={l.ref} className={rowClass(l)}><td className="tabular">{l.ref}{l.letter ? ` (${l.letter})` : ''}</td><td>{l.label}</td><td className="right tabular">{l.n == null ? '—' : n0(l.n)}</td></tr>))}
        </tbody>
      </table></div>
      <p className="small muted" style={{ padding: '8px 16px' }}>Variations du BFR calculées entre le bilan {s.fiscal_year.label} et le bilan N-1 ({s.previous.label}). Acquisitions, cessions, apports, emprunts et dividendes : renseignements de l’onglet Préparation, proposés depuis les écritures.</p>
    </Card>
  );
}

function Preparation({ s, draft, onChange }) {
  const saved = useSaved();
  const [error, setError] = useState(null);
  const [id, setId] = useState(s.identity);
  const [tft, setTft] = useState(() => Object.fromEntries(Object.entries(s.tft_inputs).map(([k, x]) => [k, x.saved ?? ''])));
  const [text, setText] = useState('');
  useEffect(() => { setId(s.identity); setTft(Object.fromEntries(Object.entries(s.tft_inputs).map(([k, x]) => [k, x.saved ?? '']))); }, [s]);
  const qd = draft ? '?draft=1' : '';
  const act = async (fn, msg) => { setError(null); try { await fn(); saved(msg); onChange(); } catch (e) { setError(e); } };
  const num = v => Math.round(Number(String(v || '').replace(/[\s  ]/g, '').replace(',', '.')) || 0);
  const rows = text.split(/\r?\n/).map(l => l.split(/[;\t]/)).filter(c => /^\d{2,12}$/.test((c[0] || '').trim()))
    .map(c => ({ account: c[0].trim(), debit: num(c[1]), credit: num(c[2]), label: (c[3] || '').trim() || null }));
  const d = rows.reduce((t, r) => t + r.debit, 0), c = rows.reduce((t, r) => t + r.credit, 0);
  const readFile = f => { const r = new FileReader(); r.onload = () => setText(String(r.result || '')); r.readAsText(f, 'utf-8'); };
  return (
    <div className="stack">
      <ErrorBox error={error} />
      <Card title="Fiche d’identification de l’entité">
        <form className="form-grid" onSubmit={e => { e.preventDefault(); act(() => api.put(`${L}/identity`, id), 'Fiche d’identification enregistrée'); }}>
          {Object.entries(s.identity_fields).map(([k, l]) => <Field key={k} label={l} className={k === 'adresse' ? 'full' : ''}><input className="input" maxLength={255} value={id[k] || ''} onChange={e => setId(x => ({ ...x, [k]: e.target.value }))} /></Field>)}
          <div className="full"><button className="btn btn-primary">Enregistrer</button></div>
        </form>
      </Card>

      <Card title="Exercice N-1">
        <div className="stack" style={{ gap: 10 }}>
          <p className="small"><b>Source :</b> {s.previous.label}.</p>
          {s.previous.source !== 'erp' && (
            <>
              <p className="small">Si l’exercice précédent n’est pas tenu dans l’ERP, collez sa balance de clôture (Sage ou Excel), une ligne par compte : <b>compte ; solde débiteur ; solde créditeur ; intitulé</b>. Toutes les classes (1 à 8) : le compte de résultat N-1 en dépend.</p>
              <textarea className="textarea tabular" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder={'101100;;10000000;Capital social\n521100;6500000;;Banque\n601100;2500000;;Achats'} aria-label="Balance N-1" />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="btn btn-sm"><Upload />Fichier CSV ou TXT<input type="file" hidden accept=".csv,.txt,text/csv,text/plain" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f); }} /></label>
                <span className="small tabular" style={{ color: d === c && d ? 'var(--ok)' : 'var(--danger)' }}>{rows.length} ligne(s) · débit {amt(d, { zero: '0' })} · crédit {amt(c, { zero: '0' })}</span>
                <button className="btn btn-sm btn-primary" disabled={!rows.length || d !== c} onClick={() => act(() => api.put(`${L}/${s.fiscal_year.id}/balance-n1${qd}`, { rows }), 'Balance N-1 importée').then(() => setText(''))}>Importer</button>
                {s.previous.source === 'import' && <button className="btn btn-sm btn-ghost btn-danger" onClick={() => window.confirm('Retirer la balance N-1 importée ?') && act(() => api.del(`${L}/${s.fiscal_year.id}/balance-n1${qd}`), 'Balance N-1 retirée')}><Trash2 />Retirer la balance importée</button>}
              </div>
            </>
          )}
        </div>
      </Card>

      <Card title="Renseignements du tableau des flux de trésorerie" bodyClass="">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Réf</th><th>Renseignement</th><th className="right">Proposé (écritures)</th><th>Montant retenu</th></tr></thead>
          <tbody>{Object.entries(s.tft_inputs).map(([k, x]) => (
            <tr key={k}><td className="tabular">{k}</td><td className="small">{x.label}</td><td className="right tabular small">{amt(x.proposed, { zero: '0' })}</td>
              <td><input className="input tabular" inputMode="numeric" style={{ maxWidth: 170 }} value={tft[k]} placeholder="proposé" onChange={e => setTft(t => ({ ...t, [k]: e.target.value }))} aria-label={`Montant retenu ${k}`} /></td></tr>
          ))}</tbody>
        </table></div>
        <div className="row" style={{ padding: 16, gap: 8 }}>
          <button className="btn btn-primary" onClick={() => act(() => api.put(`${L}/${s.fiscal_year.id}/tft${qd}`, Object.fromEntries(Object.entries(tft).map(([k, v]) => [k, v === '' ? null : num(v)]))), 'Renseignements enregistrés')}>Enregistrer</button>
          <span className="small muted">Vide : le montant proposé depuis les écritures de l’exercice est repris.</span>
        </div>
      </Card>
    </div>
  );
}

/** Liasse imprimable (PDF) : page d'identification, bilan actif et passif, compte de résultat, TFT, contrôles. */
export function LiassePrint() {
  const { fy } = useParams();
  const [params] = useSearchParams();
  const data = useLiasse(fy, params.get('draft') === '1');
  const s = data.data;
  useEffect(() => { if (s) document.title = `Liasse fiscale ${s.fiscal_year.label}`; }, [s]);
  useAutoPrint(!!s, s ? `/compta/etats?onglet=liasse&exercice=${s.fiscal_year.id}${s.include_draft ? '&brouillons=1' : ''}` : '/compta/etats?onglet=liasse');
  if (!s) return data.error ? <ErrorBox error={data.error} /> : <Skeleton h={400} />;
  const id = s.identity;
  return (
    <article className="appro-print stack liasse-print" aria-label={`Liasse fiscale ${s.fiscal_year.label}`}>
      <div className="row appro-print-actions">
        <Link className="btn btn-ghost" to={`/compta/etats?onglet=liasse&exercice=${s.fiscal_year.id}`}>Retour</Link>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer />Imprimer / PDF</button>
      </div>
      <section className="stack" style={{ gap: 6 }}>
        <h2 style={{ margin: 0 }}>États financiers — système normal (SYSCOHADA révisé)</h2>
        <p className="small" style={{ margin: 0 }}>Exercice du {date(s.fiscal_year.start_date)} au {date(s.fiscal_year.end_date)}{s.include_draft ? ' — PROVISOIRE (brouillons compris)' : ''}</p>
        <dl className="dl erp-panel small">{Object.entries(s.identity_fields).flatMap(([k, l]) => [<dt key={`t${k}`}>{l}</dt>, <dd key={`d${k}`}>{id[k] || '—'}</dd>])}</dl>
      </section>
      <Actif s={s} print />
      <Passif s={s} print />
      <Resultat s={s} print />
      <Tft s={s} print />
      <Controls s={s} />
    </article>
  );
}
