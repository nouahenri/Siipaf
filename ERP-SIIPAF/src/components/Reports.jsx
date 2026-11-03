/**
 * Exporter et Imprimer le rapport d'un module (demande du client du 03/11) : boutons de l'en-tête sur le tableau de bord de chaque
 * module et sur la liste des chantiers ; période au choix (mois en cours par défaut) ; classeur Excel (synthèse + une feuille par
 * tableau) ou page de rapport à imprimer ou enregistrer en PDF. Données et droits : serveur, services/rapports.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, Printer, Download } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useResource, useToast } from '@admin/lib/app-context';
import { Modal, Field, ErrorBox, Skeleton, Empty } from '@admin/components/ui';
import { date, fcfa, num } from '@admin/lib/format';
import { downloadReportExcel } from '@admin/lib/report-excel';

const R = '/admin/erp/rapports';
const iso = d => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));

/** Périodes proposées ; « Dates libres » ouvre les deux champs. */
function presets(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), q = Math.floor(m / 3) * 3;
  return {
    mois: ['Ce mois-ci', iso(utc(y, m, 1)), iso(utc(y, m + 1, 0))],
    precedent: ['Le mois précédent', iso(utc(y, m - 1, 1)), iso(utc(y, m, 0))],
    trimestre: ['Ce trimestre', iso(utc(y, q, 1)), iso(utc(y, q + 3, 0))],
    annee: ['Cette année', iso(utc(y, 0, 1)), iso(utc(y, 11, 31))],
    annee_prec: ['L’année précédente', iso(utc(y - 1, 0, 1)), iso(utc(y - 1, 11, 31))],
    libre: ['Dates libres', null, null],
  };
}

/** Boutons de l'en-tête : la fenêtre de période s'ouvre sur l'action choisie. */
export function ReportActions({ module, title }) {
  const [action, setAction] = useState(null);
  return (
    <>
      <button type="button" className="btn btn-sm report-btn" onClick={() => setAction('export')} title={`Exporter le rapport — ${title} (Excel)`}><FileSpreadsheet /><span>Exporter</span></button>
      <button type="button" className="btn btn-sm report-btn" onClick={() => setAction('print')} title={`Imprimer le rapport — ${title}`}><Printer /><span>Imprimer</span></button>
      {/* Hors de l'en-tête : son flou (backdrop-filter) enfermerait la fenêtre dans la barre */}
      {action && createPortal(<PeriodModal module={module} title={title} action={action} onClose={() => setAction(null)} />, document.body)}
    </>
  );
}

function PeriodModal({ module, title, action, onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const list = presets();
  const [choice, setChoice] = useState('mois');
  const [from, setFrom] = useState(list.mois[1]);
  const [to, setTo] = useState(list.mois[2]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pick = k => { setChoice(k); if (list[k][1]) { setFrom(list[k][1]); setTo(list[k][2]); } };
  const go = async e => {
    e.preventDefault(); setError(null);
    if (to < from) return setError(new Error('La fin de la période précède son début.'));
    if (action === 'print') { onClose(); navigate(`/rapports/${module}${qs({ du: from, au: to })}`); return; }
    setBusy(true);
    try { await downloadReportExcel(await api.get(`${R}/${module}${qs({ du: from, au: to })}`)); toast('Rapport exporté (Excel)'); onClose(); } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={`${action === 'print' ? 'Imprimer' : 'Exporter'} le rapport — ${title}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="report-period" disabled={busy}>{action === 'print' ? <><Printer />Afficher le rapport</> : <><Download />{busy ? 'Préparation…' : 'Télécharger (Excel)'}</>}</button></>}>
      <form id="report-period" className="stack" style={{ gap: 12 }} onSubmit={go}>
        <ErrorBox error={error} />
        <div className="seg report-periods" role="group" aria-label="Période">
          {Object.entries(list).map(([k, [label]]) => <button key={k} type="button" className={choice === k ? 'active' : ''} aria-pressed={choice === k} onClick={() => pick(k)}>{label}</button>)}
        </div>
        <div className="form-grid">
          <Field label="Du"><input className="input" type="date" required value={from} onChange={e => { setFrom(e.target.value); setChoice('libre'); }} /></Field>
          <Field label="Au"><input className="input" type="date" required value={to} onChange={e => { setTo(e.target.value); setChoice('libre'); }} /></Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {action === 'print' ? 'Le rapport s’affiche avec les indicateurs et le détail de la période ; imprimez-le ou enregistrez-le en PDF depuis la fenêtre d’impression.'
            : 'Classeur Excel : une feuille de synthèse (indicateurs) puis une feuille par tableau de détail.'}
        </p>
      </form>
    </Modal>
  );
}

const show = (value, format) => (value == null || value === '' ? '—' : format === 'fcfa' ? fcfa(value) : format === 'number' ? num(value)
  : format === 'percent' ? `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : format === 'date' ? date(value) : String(value));

/** Page du rapport (/rapports/:module?du=&au=) : à imprimer ou enregistrer en PDF ; menu et en-tête masqués à l'impression. */
export function ReportPage() {
  const { module } = useParams();
  const [params] = useSearchParams();
  const rep = useResource(`${R}/${module}${qs({ du: params.get('du') || '', au: params.get('au') || '' })}`);
  const r = rep.data;
  if (rep.error) return <ErrorBox error={rep.error} />;
  if (!r) return <Skeleton h={400} />;
  return (
    <article className="appro-print report-print stack" aria-label={`Rapport ${r.title}`}>
      <div className="row appro-print-actions" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => downloadReportExcel(r)}><FileSpreadsheet />Exporter (Excel)</button>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer />Imprimer / PDF</button>
      </div>
      <header className="row-between report-head">
        <img src="/logo-siipaf.png" alt="SIIPAF SA" style={{ width: 150 }} />
        <div className="right">
          <h2 style={{ margin: 0 }}>Rapport — {r.title}</h2>
          <div><b>Période {r.period.label}</b></div>
          <div className="small muted">Édité le {new Date(r.generated_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })} par {r.generated_by}</div>
        </div>
      </header>
      <section className="report-kpis">
        {r.summary.map(s => <div key={s.label} className="report-kpi"><span className="small muted">{s.label}</span><b className="tabular">{show(s.value, s.format)}</b></div>)}
      </section>
      {r.sections.map(s => (
        <section key={s.title} className="report-section">
          <h3 className="erp-h3">{s.title} <span className="small muted">({s.rows.length})</span></h3>
          {!s.rows.length ? <Empty>Aucune donnée sur la période.</Empty> : (
            <div className="table-wrap"><table className="table table-compact">
              <thead><tr>{s.columns.map(c => <th key={c.key} className={['fcfa', 'number', 'percent'].includes(c.format) ? 'right' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>{s.rows.map((row, i) => <tr key={i}>{s.columns.map(c => <td key={c.key} className={['fcfa', 'number', 'percent'].includes(c.format) ? 'right tabular' : ''}>{show(row[c.key], c.format)}</td>)}</tr>)}</tbody>
            </table></div>
          )}
        </section>
      ))}
    </article>
  );
}
