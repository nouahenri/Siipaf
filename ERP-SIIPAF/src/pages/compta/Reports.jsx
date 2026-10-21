import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Advance } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { useComptaMeta, amt, signed, PeriodPicker, periodQuery, AccountInput, downloadCsv } from '../../lib/compta';
import { EntryDrawer } from './Entries';

const TABS = [
  ['balance', 'Balance'], ['grand-livre', 'Grand livre'], ['resultat', 'Résultat et bilan'], ['tva', 'TVA'],
  ['marges', 'Marge par programme'], ['tiers', 'Clients et fournisseurs'], ['export', 'Export Sage'],
];
const CLASSES = { 1: 'Ressources durables', 2: 'Actif immobilisé', 3: 'Stocks', 4: 'Tiers', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits', 8: 'Hors activités ordinaires' };
const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); };

export default function Reports() {
  const { meta } = useComptaMeta();
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') || 'balance';
  const [period, setPeriod] = useState(() => ({ fiscal_year_id: '', from: '', to: '', draft: true }));
  const current = meta?.fiscal_years.find(y => y.status === 'ouvert');
  const p = period.fiscal_year_id || period.from || period.to ? period : { ...period, fiscal_year_id: current?.id || '' };
  const q = periodQuery(p);

  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setParams({ onglet: id })}>{l}</button>)}
      </div>
      {tab !== 'export' && meta && <PeriodPicker meta={meta} value={p} onChange={setPeriod} />}
      {tab === 'balance' && <Balance q={q} />}
      {tab === 'grand-livre' && <Ledger q={q} />}
      {tab === 'resultat' && <Statements q={q} />}
      {tab === 'tva' && <Vat q={q} />}
      {tab === 'marges' && <Margins q={q} />}
      {tab === 'tiers' && <Partners q={q} />}
      {tab === 'export' && <SageExport />}
    </div>
  );
}

function Balance({ q }) {
  const data = useResource(`/admin/erp/compta/reports/balance?${q}`);
  const rows = data.data || [];
  const byClass = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(c => ({ c, rows: rows.filter(r => r.class === c) })).filter(g => g.rows.length);
  const tot = k => rows.reduce((t, r) => t + r[k], 0);
  return (
    <Card bodyClass="" title="Balance générale" actions={rows.length > 0 && (
      <button className="btn btn-sm" onClick={() => downloadCsv('balance.csv', ['Compte', 'Intitulé', 'Débit', 'Crédit', 'Solde débiteur', 'Solde créditeur'], rows.map(r => [r.code, r.label, r.debit, r.credit, r.balance > 0 ? r.balance : '', r.balance < 0 ? -r.balance : '']))}><FileSpreadsheet />Excel</button>
    )}>
      <ErrorBox error={data.error} />
      {!data.data ? <div className="card-body"><Skeleton h={240} /></div> : !rows.length ? <div className="card-body"><Empty>Aucun mouvement sur la période.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Compte</th><th>Intitulé</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde débiteur</th><th className="right">Solde créditeur</th></tr></thead>
          <tbody>
            {byClass.map(g => [
              <tr key={`c${g.c}`} className="group-row"><td colSpan={6}>Classe {g.c} — {CLASSES[g.c] || ''}</td></tr>,
              ...g.rows.map(r => (
                <tr key={r.code}>
                  <td className="tabular small"><b>{r.code}</b></td><td className="small">{r.label}</td>
                  <td className="right tabular small">{amt(r.debit)}</td><td className="right tabular small">{amt(r.credit)}</td>
                  <td className="right tabular small">{r.balance > 0 ? amt(r.balance) : ''}</td><td className="right tabular small">{r.balance < 0 ? amt(-r.balance) : ''}</td>
                </tr>
              )),
            ])}
          </tbody>
          <tfoot><tr>
            <td colSpan={2} className="right small"><b>Totaux</b></td>
            <td className="right tabular small"><b>{amt(tot('debit'))}</b></td><td className="right tabular small"><b>{amt(tot('credit'))}</b></td>
            <td className="right tabular small"><b>{amt(rows.reduce((t, r) => t + Math.max(0, r.balance), 0))}</b></td><td className="right tabular small"><b>{amt(rows.reduce((t, r) => t + Math.max(0, -r.balance), 0))}</b></td>
          </tr></tfoot>
        </table></div>
      )}
    </Card>
  );
}

function Ledger({ q }) {
  const [account, setAccount] = useState('4111');
  const [entryId, setEntryId] = useState(null);
  const data = useResource(account.length >= 2 ? `/admin/erp/compta/reports/ledger?account=${account}&${q}` : null);
  const d = data.data;
  return (
    <Card bodyClass="" title="Grand livre" actions={<span style={{ width: 160 }}><AccountInput value={account} onChange={setAccount} placeholder="Compte ou racine" /></span>}>
      <ErrorBox error={data.error} />
      {!d ? <div className="card-body"><Skeleton h={200} /></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>N°</th><th>Jnl</th><th>Compte</th><th>Libellé · tiers</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde</th></tr></thead>
          <tbody>
            <tr className="group-row"><td colSpan={7}>Report à nouveau (mouvements antérieurs de la période)</td><td className="right tabular">{signed(d.opening)}</td></tr>
            {d.lines.map(l => (
              <tr key={l.id} className="clickable" onClick={() => setEntryId(l.entry_id)}>
                <td className="small nowrap">{date(l.date)}</td>
                <td className="small tabular nowrap">{l.number || <span className="muted">brouillon</span>}</td>
                <td className="small">{l.journal_code}</td>
                <td className="small tabular">{l.account_code}</td>
                <td className="small" style={{ minWidth: 220 }}>{l.label}{(l.partner_name || l.project_name) && <div className="muted">{[l.partner_name, l.project_name].filter(Boolean).join(' · ')}</div>}</td>
                <td className="right tabular small">{amt(l.debit)}</td><td className="right tabular small">{amt(l.credit)}</td>
                <td className="right tabular small">{signed(l.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={7} className="right small"><b>Solde final</b> (débiteur positif, créditeur entre parenthèses)</td><td className="right tabular"><b>{signed(d.closing)}</b></td></tr></tfoot>
        </table></div>
      )}
      {entryId && <EntryDrawer id={entryId} onClose={() => setEntryId(null)} />}
    </Card>
  );
}

function Statements({ q }) {
  const data = useResource(`/admin/erp/compta/reports/statements?${q}`);
  const d = data.data;
  if (!d) return <Skeleton h={300} />;
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Compte de résultat" bodyClass="">
        <table className="table">
          <tbody>
            {d.income.map(g => (
              <tr key={g.key}><td className="small">{g.sign === 1 ? '+ ' : '− '}{g.label}</td><td className="right tabular small">{signed(g.value)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td><b>Résultat net</b></td><td className="right tabular" style={{ color: d.result >= 0 ? 'var(--ok)' : 'var(--danger)' }}><b>{signed(d.result)}</b></td></tr></tfoot>
        </table>
      </Card>
      <Card title="Bilan (présentation simplifiée)" bodyClass="">
        <table className="table">
          <thead><tr><th>Actif</th><th className="right">Montant</th></tr></thead>
          <tbody>{d.actif.map(g => <tr key={g.key}><td className="small">{g.label}</td><td className="right tabular small">{signed(g.value)}</td></tr>)}</tbody>
          <tfoot><tr><td><b>Total actif</b></td><td className="right tabular"><b>{amt(d.total_actif, { zero: '0' })}</b></td></tr></tfoot>
        </table>
        <table className="table">
          <thead><tr><th>Passif</th><th className="right">Montant</th></tr></thead>
          <tbody>{d.passif.map(g => <tr key={g.key}><td className="small">{g.label}</td><td className="right tabular small">{signed(g.value)}</td></tr>)}</tbody>
          <tfoot><tr><td><b>Total passif</b></td><td className="right tabular"><b>{amt(d.total_passif, { zero: '0' })}</b></td></tr></tfoot>
        </table>
        <p className="small muted" style={{ padding: '10px 16px' }}>Regroupements indicatifs : les états financiers officiels SYSCOHADA (et la DSF) sont à établir avec le comptable à partir de la balance.</p>
      </Card>
    </div>
  );
}

function Vat({ q }) {
  const data = useResource(`/admin/erp/compta/reports/vat?${q}`);
  const rows = data.data || [];
  return (
    <Card bodyClass="" title="TVA par mois">
      {!data.data ? <div className="card-body"><Skeleton h={160} /></div> : !rows.length ? <div className="card-body"><Empty>Aucune TVA sur la période.</Empty></div> : (
        <table className="table">
          <thead><tr><th>Mois</th><th className="right">Collectée (443)</th><th className="right">Récupérable (445)</th><th className="right">À payer / (crédit)</th></tr></thead>
          <tbody>{rows.map(m => <tr key={m.month}><td className="small" style={{ textTransform: 'capitalize' }}>{monthLabel(m.month)}</td><td className="right tabular small">{amt(m.collected, { zero: '0' })}</td><td className="right tabular small">{amt(m.deductible, { zero: '0' })}</td><td className="right tabular small"><b>{signed(m.due)}</b></td></tr>)}</tbody>
        </table>
      )}
    </Card>
  );
}

function Margins({ q }) {
  const data = useResource(`/admin/erp/compta/reports/margins?${q}`);
  const rows = data.data || [];
  return (
    <Card bodyClass="" title="Marge par programme (comptabilité analytique)">
      {!data.data ? <div className="card-body"><Skeleton h={160} /></div> : !rows.length ? <div className="card-body"><Empty>Aucun produit ni charge sur la période.</Empty></div> : (
        <table className="table">
          <thead><tr><th>Programme</th><th className="right">Produits (classe 7)</th><th className="right">Charges (classe 6)</th><th className="right">Marge</th><th className="right">Taux</th><th>Avancement chantier</th></tr></thead>
          <tbody>{rows.map(m => <tr key={m.project_id || 0}><td className="small">{m.name}</td><td className="right tabular small">{amt(m.produits, { zero: '0' })}</td><td className="right tabular small">{amt(m.charges, { zero: '0' })}</td><td className="right tabular small"><b>{signed(m.marge)}</b></td><td className="right tabular small">{m.taux == null ? '—' : `${m.taux} %`}</td><td>{m.progress_pct == null ? <span className="muted">—</span> : <Advance value={m.progress_pct} />}</td></tr>)}</tbody>
        </table>
      )}
      <p className="small muted" style={{ padding: '10px 16px' }}>Les ventes et appels de fonds sont affectés au programme du lot ; les achats, au programme choisi sur la facture. Les charges non affectées apparaissent en frais généraux.</p>
    </Card>
  );
}

function Partners({ q }) {
  const [kind, setKind] = useState('client');
  const data = useResource(`/admin/erp/compta/reports/partners?kind=${kind}&${q}`);
  const rows = data.data || [];
  return (
    <Card bodyClass="" title={kind === 'client' ? 'Soldes clients' : 'Soldes fournisseurs'} actions={(
      <div className="seg" role="group" aria-label="Tiers">
        <button className={kind === 'client' ? 'active' : ''} onClick={() => setKind('client')}>Clients</button>
        <button className={kind === 'fournisseur' ? 'active' : ''} onClick={() => setKind('fournisseur')}>Fournisseurs</button>
      </div>
    )}>
      {!data.data ? <div className="card-body"><Skeleton h={160} /></div> : !rows.length ? <div className="card-body"><Empty>Aucun solde.</Empty></div> : (
        <table className="table">
          <thead><tr><th>{kind === 'client' ? 'Client' : 'Fournisseur'}</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde</th>{kind === 'client' && <th>Avancement</th>}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.partner_id}><td className="small">{r.name}</td><td className="right tabular small">{amt(r.debit)}</td><td className="right tabular small">{amt(r.credit)}</td>
              <td className="right tabular small"><b>{signed(r.balance)}</b><div className="muted">{kind === 'client' ? (r.balance > 0 ? 'nous doit' : 'avance reçue') : (r.balance < 0 ? 'nous lui devons' : 'avance versée')}</div></td>
              {kind === 'client' && <td>{r.progress_pct == null ? <span className="muted">—</span> : <Advance value={r.progress_pct} />}</td>}</tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function SageExport() {
  const { can } = useAuth();
  const toast = useToast();
  const { meta } = useComptaMeta();
  const fy = meta?.fiscal_years.find(y => y.status === 'ouvert');
  const [range, setRange] = useState({ from: fy?.start_date || '', to: new Date().toISOString().slice(0, 10) });
  const s = meta?.settings.sage;
  const download = async () => {
    try {
      const res = await fetch(`/api/admin/erp/compta/export/sage?from=${range.from}&to=${range.to}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json()).error || 'Export impossible');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `ecritures-sage-${range.from}-${range.to}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`${res.headers.get('X-Lines') || 0} ligne(s) exportée(s)`);
    } catch (e) { toast(e.message, 'err'); }
  };
  if (!can('compta:export')) return <Card><Empty>L’export demande le droit « Exporter vers Sage ».</Empty></Card>;
  return (
    <Card title="Export des écritures validées vers Sage">
      <div className="stack" style={{ gap: 14 }}>
        <p className="small">Fichier texte délimité, à importer dans Sage par un <b>format paramétrable</b> (à déclarer une fois dans Sage, colonnes dans cet ordre) :</p>
        <ol className="small" style={{ paddingLeft: 20 }}>
          <li>Code journal (VT, AC, BQ, CA, MM, OD, AN, PA)</li><li>Date ({s?.date_format})</li><li>N° de pièce (numéro de l’écriture)</li>
          <li>Compte général</li><li>Compte tiers (code client SIIPAF-…, ou F00001 pour un fournisseur)</li><li>Libellé (69 caractères)</li><li>Débit</li><li>Crédit</li><li>Référence de la pièce</li>
        </ol>
        <p className="small muted">Séparateur « {s?.separator === '\t' ? 'tabulation' : s?.separator} », décimales « {s?.decimal} », {s?.header ? 'avec' : 'sans'} ligne d’en-tête, encodage UTF-8 (réglables dans Paramètres). Seules les écritures validées sont exportées.</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Du"><input className="input" type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></Field>
          <Field label="Au"><input className="input" type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></Field>
          <button className="btn btn-primary" onClick={download}><Download />Télécharger le fichier</button>
        </div>
      </div>
    </Card>
  );
}
