import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, X, ChevronLeft, ChevronRight, CalendarPlus, Inbox, FileText } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field } from '@admin/components/ui';
import { date, dateTime } from '@admin/lib/format';
import { monthLong } from '@admin/components/Charts';
import { RH, thisMonth, useRhMeta } from '../../lib/rh';
import { LeaveForm, LeaveBadge, TypeDot } from '../../components/RhForms';

/** Congés et absences (référence : Odoo Congés) : demandes à traiter, planning de l'équipe, historique. */
export default function Leaves() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') || 'approuver';
  const setTab = t => setParams({ onglet: t });
  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {[['approuver', 'À approuver'], ['planning', 'Planning'], ['demandes', 'Toutes les absences']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'approuver' && <Approvals />}
      {tab === 'planning' && <Planning />}
      {tab === 'demandes' && <AllLeaves />}
    </div>
  );
}

function Approvals() {
  const { meta } = useRhMeta();
  const list = useResource(`${RH}/approvals`);
  const [refusing, setRefusing] = useState(null);
  const toast = useToast();
  const approve = async l => {
    try { const r = await api.post(`${RH}/leaves/${l.id}/decide`, { action: 'approve' }); toast(r.status === 'approuvee' ? 'Absence approuvée' : 'Accord donné : la demande passe au service RH'); list.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card bodyClass="">
      <ErrorBox error={list.error} />
      {!list.data ? <div className="card-body"><Skeleton h={160} /></div> : !list.data.length ? <div className="card-body"><Empty icon={Inbox}>Aucune demande en attente de votre accord.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Employé</th><th>Absence</th><th>Période</th><th className="right">Jours</th><th>Étape</th><th /></tr></thead>
          <tbody>
            {list.data.map(l => (
              <tr key={l.id}>
                <td><b>{l.employee_name}</b><div className="small muted">{l.matricule} · {meta?.departments[l.department]}</div></td>
                <td><TypeDot type={l.type} meta={meta} />{l.label}{l.event_label && <div className="small muted">{l.event_label}</div>}{l.reason && <div className="small muted prewrap">« {l.reason} »</div>}
                  {l.document_id && <a className="link small" href={`/api${RH}/documents/${l.document_id}/file`} target="_blank" rel="noreferrer"><FileText className="ico" />Justificatif</a>}</td>
                <td className="small nowrap">{date(l.start_date)} → {date(l.end_date)}<div className="muted">demandé le {dateTime(l.created_at)}</div></td>
                <td className="right tabular"><b>{l.days}</b></td>
                <td><LeaveBadge leave={l} meta={meta} />{l.manager_name && <div className="small muted">accord de {l.manager_name}</div>}</td>
                <td className="right nowrap">
                  <button className="btn btn-sm btn-primary" onClick={() => approve(l)}><Check />Approuver</button>{' '}
                  <button className="btn btn-sm" onClick={() => setRefusing(l)}><X />Refuser</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {refusing && <DecisionModal leave={refusing} action="refuse" onClose={() => setRefusing(null)} onDone={() => { setRefusing(null); list.reload(); }} />}
    </Card>
  );
}

export function DecisionModal({ leave, action, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const toast = useToast();
  const save = async e => {
    e.preventDefault();
    try { await api.post(`${RH}/leaves/${leave.id}/decide`, { action, note }); toast(action === 'refuse' ? 'Demande refusée' : 'Absence annulée'); onDone(); } catch (err) { setError(err); }
  };
  return (
    <Modal title={action === 'refuse' ? `Refuser — ${leave.employee_name}` : `Annuler l’absence — ${leave.employee_name}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Retour</button><button className="btn btn-primary" form="decision">Confirmer</button></>}>
      <form id="decision" className="stack" style={{ gap: 12 }} onSubmit={save}>
        <ErrorBox error={error} />
        <p className="small">{leave.label} du {date(leave.start_date)} au {date(leave.end_date)} ({leave.days} j).</p>
        <Field label="Motif (communiqué à l’employé)"><textarea className="textarea" rows={3} required={action === 'refuse'} value={note} onChange={e => setNote(e.target.value)} autoFocus /></Field>
      </form>
    </Modal>
  );
}

/** Planning du mois : une ligne par employé, une colonne par jour ; dimanches et jours fériés grisés. */
function Planning() {
  const { meta } = useRhMeta();
  const [month, setMonth] = useState(thisMonth());
  const cal = useResource(`${RH}/calendar?month=${month}`);
  const shift = n => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const d = cal.data;
  const dayList = d ? Array.from({ length: Number(d.to.slice(8, 10)) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`) : [];
  const hol = new Map((d?.holidays || []).map(h => [h.date, h.label]));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card title={<span style={{ textTransform: 'capitalize' }}>{monthLong(month)}</span>} actions={<div className="row" style={{ gap: 4 }}><button className="btn btn-sm btn-icon" onClick={() => shift(-1)} aria-label="Mois précédent"><ChevronLeft /></button><button className="btn btn-sm" onClick={() => setMonth(thisMonth())}>Aujourd’hui</button><button className="btn btn-sm btn-icon" onClick={() => shift(1)} aria-label="Mois suivant"><ChevronRight /></button></div>} bodyClass="">
      {!d ? <div className="card-body"><Skeleton h={220} /></div> : (
        <>
          <div className="planning-wrap">
            <table className="planning">
              <thead><tr><th className="who">Employé</th>{dayList.map(x => { const wd = new Date(`${x}T00:00:00Z`).getUTCDay(); return <th key={x} className={`${wd === 0 || hol.has(x) ? 'off' : ''} ${x === today ? 'now' : ''}`} title={hol.get(x)}><span>{'DLMMJVS'[wd]}</span>{Number(x.slice(8))}</th>; })}</tr></thead>
              <tbody>
                {d.employees.map(e => (
                  <tr key={e.id}>
                    <td className="who"><b className="ellipsis">{e.last_name} {e.first_name}</b></td>
                    {dayList.map(x => {
                      const wd = new Date(`${x}T00:00:00Z`).getUTCDay();
                      const l = d.leaves.find(v => v.employee_id === e.id && v.start_date <= x && v.end_date >= x);
                      const t = l && meta?.leave_types[l.type];
                      return <td key={x} className={`${wd === 0 || hol.has(x) ? 'off' : ''} ${l && l.status !== 'approuvee' ? 'pending' : ''}`} title={l ? `${l.label} — ${meta?.statuses[l.status]?.label}` : hol.get(x)}>{l && <i style={{ background: t?.color }} />}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body row small" style={{ gap: 14, flexWrap: 'wrap' }}>
            {meta && Object.entries(meta.leave_types).map(([k, t]) => <span key={k} className="row" style={{ gap: 6 }}><TypeDot type={k} meta={meta} />{t.label}</span>)}
            <span className="row" style={{ gap: 6 }}><i className="legend-pending" />en attente d’accord</span>
          </div>
        </>
      )}
    </Card>
  );
}

function AllLeaves() {
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [employee, setEmployee] = useState('');
  const [creating, setCreating] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const list = useResource(`${RH}/leaves${qs({ status, type, employee_id: employee })}`);
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut"><option value="">Tous les statuts</option>{meta && Object.entries(meta.statuses).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>
          <select className="select" style={{ width: 'auto' }} value={type} onChange={e => setType(e.target.value)} aria-label="Type"><option value="">Tous les types</option>{meta && Object.entries(meta.leave_types).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select>
          {meta?.employees.length > 0 && <select className="select" style={{ width: 'auto' }} value={employee} onChange={e => setEmployee(e.target.value)} aria-label="Employé"><option value="">Tout le personnel</option>{meta.employees.map(e => <option key={e.id} value={e.id}>{e.last_name} {e.first_name}</option>)}</select>}
        </div>
        {can('conges:manage') && meta?.employees.length > 0 && (
          <select className="select" style={{ width: 'auto' }} value="" onChange={e => setCreating(meta.employees.find(x => x.id === Number(e.target.value)))} aria-label="Saisir une absence pour">
            <option value="">+ Saisir une absence pour…</option>{meta.employees.map(e => <option key={e.id} value={e.id}>{e.last_name} {e.first_name}</option>)}
          </select>
        )}
      </div>
      <Card bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !list.data.length ? <div className="card-body"><Empty icon={CalendarPlus}>Aucune absence.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Employé</th><th>Absence</th><th>Période</th><th className="right">Jours</th><th>Statut</th><th>Décision</th><th /></tr></thead>
            <tbody>
              {list.data.map(l => (
                <tr key={l.id}>
                  <td><b>{l.employee_name}</b><div className="small muted">{l.matricule}</div></td>
                  <td><TypeDot type={l.type} meta={meta} />{l.label}{!l.paid && <div className="small" style={{ color: 'var(--danger)' }}>non payée : retenue en paie</div>}</td>
                  <td className="small nowrap">{date(l.start_date)} → {date(l.end_date)}</td>
                  <td className="right tabular">{l.days}</td>
                  <td><LeaveBadge leave={l} meta={meta} /></td>
                  <td className="small muted">{l.decided_by_name || l.manager_name || '—'}{l.decision_note && <div className="prewrap">{l.decision_note}</div>}</td>
                  <td className="right">{can('conges:manage') && ['en_attente', 'approuve_manager', 'approuvee'].includes(l.status) && <button className="btn btn-ghost btn-sm" onClick={() => setCancelling(l)}>Annuler</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {creating && <LeaveForm employee={creating} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); list.reload(); }} />}
      {cancelling && <DecisionModal leave={cancelling} action="cancel" onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); list.reload(); }} />}
    </div>
  );
}
