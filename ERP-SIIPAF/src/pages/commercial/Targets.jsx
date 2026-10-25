import { useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Target } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field } from '@admin/components/ui';
import { fcfa } from '@admin/lib/format';
import { compact, thisMonth, monthName } from '../../lib/commercial';
import { Progress } from './CommercialDashboard';
import { PortfolioCounters, ImportLists } from './Portfolio';

const shift = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const METRICS = [
  ['ca_fcfa', 'CA signé', v => compact(v)],
  ['ventes', 'Ventes', v => v],
  ['rdv', 'RDV réalisés', v => v],
  ['encaissements_fcfa', 'Encaissements', v => compact(v)],
];

const TABS = [['objectifs', 'Objectifs du mois'], ['portefeuille', 'Prospects et clients'], ['listes', 'Listes importées']];

/**
 * Objectifs et performance des commerciaux : objectifs du mois comparés au réalisé, portefeuille de prospects et de
 * clients de chacun (par semaine, mois, trimestre, année) et bilan des listes de prospects importées.
 */
export default function Targets() {
  const [tab, setTab] = useState('objectifs');
  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'objectifs' && <MonthlyTargets />}
      {tab === 'portefeuille' && <PortfolioCounters />}
      {tab === 'listes' && <ImportLists />}
    </div>
  );
}

/** Objectifs mensuels par commercial, comparés au réalisé (dossiers ouverts, RDV effectués, versements reçus). */
function MonthlyTargets() {
  const { can } = useAuth();
  const [month, setMonth] = useState(thisMonth());
  const [edit, setEdit] = useState(null);
  const report = useResource(`/admin/erp/commercial/targets?month=${month}`);
  const rows = report.data?.rows || [];
  const team = rows.reduce((o, r) => {
    METRICS.forEach(([k]) => { o.target[k] += r.target[k] || 0; o.done[k] += r.done[k] || 0; });
    return o;
  }, { target: { ca_fcfa: 0, ventes: 0, rdv: 0, encaissements_fcfa: 0 }, done: { ca_fcfa: 0, ventes: 0, rdv: 0, encaissements_fcfa: 0 } });

  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn-icon" onClick={() => setMonth(m => shift(m, -1))} aria-label="Mois précédent"><ChevronLeft /></button>
        <strong style={{ minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>{monthName(month)}</strong>
        <button className="btn btn-icon" onClick={() => setMonth(m => shift(m, 1))} aria-label="Mois suivant"><ChevronRight /></button>
        {month !== thisMonth() && <button className="btn btn-sm" onClick={() => setMonth(thisMonth())}>Ce mois-ci</button>}
      </div>
      <ErrorBox error={report.error} />
      {rows.length > 1 && (
        <div className="grid grid-4">
          {METRICS.map(([k, l, f]) => (
            <div key={k} className="card kpi">
              <span className="kpi-label">{l} — équipe</span>
              <span className="kpi-value">{f(team.done[k])}</span>
              {team.target[k] ? <Progress value={Math.round((team.done[k] / team.target[k]) * 1000) / 10} /> : <span className="kpi-foot">pas d’objectif</span>}
            </div>
          ))}
        </div>
      )}
      <Card bodyClass="">
        {!report.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? <div className="card-body"><Empty icon={Target}>Aucun commercial.</Empty></div> : (
          <div className="table-wrap table-scroll"><table className="table">
            <thead><tr><th>Commercial</th>{METRICS.map(([k, l]) => <th key={k}>{l}</th>)}<th /></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.user_id}>
                  <td><b>{r.name}</b></td>
                  {METRICS.map(([k, , f]) => (
                    <td key={k} style={{ minWidth: 140 }}>
                      <span className="tabular"><b>{f(r.done[k])}</b>{r.target[k] != null && <span className="muted"> / {f(r.target[k])}</span>}</span>
                      {r.pct[k] != null && <Progress value={r.pct[k]} />}
                    </td>
                  ))}
                  <td>{can('targets:write') && <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setEdit(r)} aria-label={`Objectifs de ${r.name}`}><Pencil /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      <p className="small muted">Réalisé : dossiers de vente ouverts dans le mois (prix convenu), rendez-vous marqués « effectué », versements reçus sur les dossiers du commercial.</p>
      {edit && <TargetModal month={month} row={edit} onClose={() => setEdit(null)} onSaved={data => { setEdit(null); report.setData(data); }} />}
    </div>
  );
}

function TargetModal({ month, row, onClose, onSaved }) {
  const toast = useToast();
  const saved = useSaved();
  const [f, setF] = useState(Object.fromEntries(METRICS.map(([k]) => [k, row.target[k] ?? ''])));
  const [error, setError] = useState(null);
  const save = async e => {
    e.preventDefault();
    try {
      const out = await api.put('/admin/erp/commercial/targets', { month, user_id: row.user_id, ...Object.fromEntries(METRICS.map(([k]) => [k, f[k] === '' ? null : Number(f[k])])) });
      saved('Objectifs enregistrés'); onSaved(out);
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={`Objectifs de ${row.name} — ${monthName(month)}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="tgt">Enregistrer</button></>}>
      <form id="tgt" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Chiffre d’affaires signé (FCFA)" hint={f.ca_fcfa ? fcfa(f.ca_fcfa) : undefined}><input className="input" type="number" min="0" step="1000000" value={f.ca_fcfa} onChange={e => setF(x => ({ ...x, ca_fcfa: e.target.value }))} /></Field>
        <Field label="Nombre de ventes"><input className="input" type="number" min="0" value={f.ventes} onChange={e => setF(x => ({ ...x, ventes: e.target.value }))} /></Field>
        <Field label="Rendez-vous réalisés"><input className="input" type="number" min="0" value={f.rdv} onChange={e => setF(x => ({ ...x, rdv: e.target.value }))} /></Field>
        <Field label="Encaissements (FCFA)" hint={f.encaissements_fcfa ? fcfa(f.encaissements_fcfa) : undefined}><input className="input" type="number" min="0" step="1000000" value={f.encaissements_fcfa} onChange={e => setF(x => ({ ...x, encaissements_fcfa: e.target.value }))} /></Field>
      </form>
    </Modal>
  );
}
