/**
 * QHSE › Inspections et audits : planifiés ou inopinés, sur un chantier ou au siège, avec un auditeur. Grille Q/H/S/E (mêmes points
 * de contrôle que les contrôles de chantier), constats avec gravité, plan d'actions correctives, puis validation. Un constat majeur
 * ou critique demande une action corrective avant la soumission.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, SearchCheck, Play, Send, Check, X, Ban, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Badge, Card, Empty, ErrorBox, Field, Skeleton } from '@admin/components/ui';
import {
  QH, useQhseRefs, AUDIT_TONES, GRAVITY_TONES, ACTION_TONES, RatingPicker, RatingBadge, PctBadge, Checklist, itemsState, itemsPayload, meanOf, conformityOf, PhotoBlock, frDay, PILLAR_ORDER,
} from '../../lib/qhse';
import { ActionForm } from './Actions';

export default function Audits() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const refs = useQhseRefs();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('etat') || '');
  const list = useResource(`${QH}/audits${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'planifie', place_kind: 'chantier', worksite_id: '', place_label: '', auditor_id: '', auditor_name: '', planned_on: '', objective: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (list.error) return <ErrorBox error={list.error} />;
  if (!refs || !list.data) return <Skeleton h={300} />;
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));

  const create = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const a = await api.post(`${QH}/audits`, {
        kind: f.kind, place_kind: f.place_kind, worksite_id: f.place_kind === 'chantier' ? Number(f.worksite_id) || null : null, place_label: f.place_kind === 'siege' ? f.place_label || null : null,
        auditor_id: f.auditor_id ? Number(f.auditor_id) : null, auditor_name: f.auditor_id ? null : f.auditor_name || null, planned_on: f.kind === 'planifie' ? f.planned_on || null : null, objective: f.objective || null,
      });
      navigate(`/qhse/audits/${a.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <p className="muted" style={{ margin: 0 }}>Inspections et audits du QHSE, planifiés ou inopinés, sur un chantier ou au siège : grille, constats, plan d’actions, validation.</p>
        {can('qhse:audit') && <button className="btn btn-primary" onClick={() => setOpen(o => !o)}><Plus />Planifier ou lancer un audit</button>}
      </div>
      {open && (
        <Card title="Nouvelle inspection ou audit">
          <form className="form-grid" onSubmit={create}>
            <ErrorBox error={error} />
            <Field label="Type">
              <select className="select" value={f.kind} onChange={set('kind')}><option value="planifie">Planifié (date annoncée)</option><option value="inopine">Inopiné (démarre tout de suite)</option></select>
            </Field>
            <Field label="Lieu"><select className="select" value={f.place_kind} onChange={set('place_kind')}>{Object.entries(refs.audit_places).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            {f.place_kind === 'chantier'
              ? <Field label="Chantier"><select className="select" required value={f.worksite_id} onChange={set('worksite_id')}><option value="">Choisir…</option>{refs.worksites.map(w => <option key={w.id} value={w.id}>{w.reference} · {w.name}</option>)}</select></Field>
              : <Field label="Lieu au siège" hint="Bureaux, dépôt, atelier…"><input className="input" maxLength={160} value={f.place_label} onChange={set('place_label')} placeholder="Siège" /></Field>}
            {f.kind === 'planifie' && <Field label="Date prévue"><input className="input" type="date" required min={refs.today} value={f.planned_on} onChange={set('planned_on')} /></Field>}
            <Field label="Auditeur (compte)"><select className="select" value={f.auditor_id} onChange={set('auditor_id')}><option value="">Auditeur extérieur ou à désigner</option>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            {!f.auditor_id && <Field label="Nom de l’auditeur extérieur"><input className="input" required maxLength={120} value={f.auditor_name} onChange={set('auditor_name')} /></Field>}
            <Field label="Objectif" className="full"><input className="input" maxLength={300} value={f.objective} onChange={set('objective')} placeholder="Inspection générale, suite à un accident, préparation de la réception…" /></Field>
            <div className="full row"><button className="btn btn-primary" disabled={busy}>{f.kind === 'inopine' ? 'Lancer l’audit' : 'Planifier'}</button><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Annuler</button></div>
          </form>
        </Card>
      )}
      <div className="row" style={{ gap: 8 }}>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="État">
          <option value="">Tous les états</option>{Object.entries(refs.audit_statuses).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <Card title="Inspections et audits" bodyClass="">
        {!list.data.length ? <div className="card-body"><Empty icon={SearchCheck}>Aucun audit.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Audit</th><th>Lieu</th><th>Auditeur</th><th>Date</th><th className="right">Constats</th><th className="right">Score</th><th>État</th></tr></thead>
            <tbody>{list.data.map(a => (
              <tr key={a.id}>
                <td><Link className="link" to={`/qhse/audits/${a.id}`}><b>{a.reference}</b></Link><div className="small muted">{a.kind_label}{a.objective ? ` · ${a.objective}` : ''}</div></td>
                <td className="small">{a.place_label}</td>
                <td className="small">{a.auditor_name || '—'}</td>
                <td className="small nowrap">{frDay(a.done_on || a.planned_on)}</td>
                <td className="right tabular">{a.findings}</td>
                <td className="right tabular">{a.score_pct == null ? '—' : `${a.score_pct} %`}</td>
                <td><Badge tone={AUDIT_TONES[a.status]}>{a.status_label}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

export function AuditPage() {
  const { id } = useParams();
  const refs = useQhseRefs();
  const res = useResource(`${QH}/audits/${id}`);
  if (res.error) return <ErrorBox error={res.error} />;
  if (!res.data || !refs) return <Skeleton h={400} />;
  return <AuditBody d={res.data} refs={refs} setData={res.setData} />;
}


function AuditBody({ d, refs, setData }) {
  const { can } = useAuth();
  const saved = useSaved();
  const [items, setItems] = useState(() => itemsState(d.items));
  const [ratings, setRatings] = useState({ qualite: d.rating_qualite, hygiene: d.rating_hygiene });
  const [summary, setSummary] = useState(d.summary || '');
  const [finding, setFinding] = useState({ pillar: 'securite', gravity: 'mineure', description: '' });
  const [actionFor, setActionFor] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const base = `${QH}/audits/${d.id}`;
  const editable = d.can_edit && d.status === 'en_cours';

  const call = async (fn, message) => {
    setBusy(true); setError(null);
    try { setData(await fn()); setRejecting(false); if (message) saved(message); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const results = () => ({ items: itemsPayload(items), rating_qualite: ratings.qualite, rating_hygiene: ratings.hygiene, summary: summary || null });
  const saveResults = () => call(() => api.put(`${base}/results`, results()), 'Grille enregistrée');
  const submit = () => call(async () => { await api.put(`${base}/results`, results()); return api.post(`${base}/submit`); }, 'Audit soumis à validation');
  const addFinding = async e => {
    e.preventDefault();
    await call(() => api.post(`${base}/findings`, finding), 'Constat ajouté');
    setFinding(f => ({ ...f, description: '' }));
  };
  const proposedQ = meanOf(items, 'qualite');
  const proposedH = meanOf(items, 'hygiene');

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <Card>
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>{d.reference} · {d.kind_label}</h2>
            <div className="small muted" style={{ marginTop: 4 }}>
              {d.worksite_id ? <Link className="link" to={`/chantiers/${d.worksite_id}?onglet=qhse`}>{d.place_label}</Link> : d.place_label}
              {' · '}auditeur : {d.auditor_name || '—'} · {d.done_on ? `réalisé le ${frDay(d.done_on)}` : `prévu le ${frDay(d.planned_on)}`}
            </div>
            {d.objective && <p className="small" style={{ margin: '6px 0 0' }}>{d.objective}</p>}
          </div>
          <div className="row" style={{ gap: 8 }}>{d.score_pct != null && <Badge tone={d.score_pct >= 80 ? 'ok' : d.score_pct >= 60 ? 'warn' : 'danger'}>Score {d.score_pct} %</Badge>}<Badge tone={AUDIT_TONES[d.status]}>{d.status_label}</Badge></div>
        </div>
        {d.reject_reason && d.status === 'en_cours' && <div className="alert" role="alert" style={{ marginTop: 12 }}><b>Refusé :</b> {d.reject_reason}</div>}
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {d.can_start && <button className="btn btn-primary" disabled={busy} onClick={() => call(() => api.post(`${base}/start`), 'Audit démarré')}><Play />Démarrer l’audit</button>}
          {d.can_submit && <button className="btn btn-primary" disabled={busy} onClick={submit}><Send />Soumettre à validation</button>}
          {d.can_cancel && <button className="btn" disabled={busy} onClick={() => window.confirm('Annuler cet audit ?') && call(() => api.post(`${base}/cancel`), 'Audit annulé')}><Ban />Annuler</button>}
          {d.can_decide && !rejecting && <>
            <button className="btn btn-primary" disabled={busy || !d.can_approve} title={d.own ? 'Vous avez planifié, mené ou soumis cet audit : un autre responsable doit le valider.' : undefined} onClick={() => call(() => api.post(`${base}/validate`), 'Audit validé')}><Check />Valider l’audit</button>
            <button className="btn" disabled={busy} onClick={() => setRejecting(true)}><X />Refuser…</button>
            {d.own && <span className="small muted">Vous avez planifié, mené ou soumis cet audit : un autre responsable doit le valider.</span>}
          </>}
        </div>
        {rejecting && (
          <div className="stack" style={{ gap: 10, marginTop: 12 }}>
            <Field label="Motif du refus"><textarea className="textarea" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>
            <div className="row" style={{ gap: 8 }}><button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => call(() => api.post(`${base}/reject`, { reason }), 'Audit refusé')}>Refuser</button><button className="btn btn-ghost" onClick={() => setRejecting(false)}>Annuler</button></div>
          </div>
        )}
      </Card>

      {d.status === 'planifie' && <p className="muted">Démarrez l’audit le jour venu pour renseigner la grille et les constats.</p>}

      {d.status !== 'planifie' && d.status !== 'annule' && (
        <>
          <div className="grid grid-4">
            <div className="card kpi"><span className="kpi-label">Qualité</span><span className="kpi-value"><RatingBadge value={d.rating_qualite} labels={refs.ratings} /></span></div>
            <div className="card kpi"><span className="kpi-label">Hygiène</span><span className="kpi-value"><RatingBadge value={d.rating_hygiene} labels={refs.ratings} /></span></div>
            <div className="card kpi"><span className="kpi-label">Sécurité (points conformes)</span><span className="kpi-value"><PctBadge value={d.safety_rate} threshold={refs.settings.threshold} /></span></div>
            <div className="card kpi"><span className="kpi-label">Environnement (points conformes)</span><span className="kpi-value"><PctBadge value={d.env_rate} threshold={80} /></span></div>
          </div>

          {PILLAR_ORDER.map(k => (
            <Card key={k} title={`Grille — ${refs.pillars[k].label}`} actions={k === 'securite' ? (conformityOf(items, k) != null && <span className="small muted">conformité {conformityOf(items, k)} %</span>) : k === 'environnement' ? (conformityOf(items, k) != null && <span className="small muted">conformité {conformityOf(items, k)} %</span>) : null}>
              <div className="stack" style={{ gap: 12 }}>
                {editable && (k === 'qualite' || k === 'hygiene') && (
                  <div>
                    <div className="small muted" style={{ marginBottom: 6 }}>Note globale {(k === 'qualite' ? proposedQ : proposedH) && !ratings[k] ? `(proposée d’après les points : ${refs.ratings[k === 'qualite' ? proposedQ : proposedH]})` : ''}</div>
                    <RatingPicker size="small" labels={refs.ratings} value={ratings[k]} name={`Note ${refs.pillars[k].label}`} onChange={v => setRatings(r => ({ ...r, [k]: v }))} />
                  </div>
                )}
                <Checklist pillar={k} refs={refs} state={items} setState={setItems} disabled={!editable} />
              </div>
            </Card>
          ))}
          <Card title="Synthèse de l’auditeur">
            {editable ? <Field label="Constatations générales, conclusion"><textarea className="textarea" rows={4} maxLength={4000} value={summary} onChange={e => setSummary(e.target.value)} /></Field>
              : <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.summary || 'Pas de synthèse.'}</p>}
            {editable && <div style={{ marginTop: 12 }}><button className="btn" disabled={busy} onClick={saveResults}>Enregistrer la grille</button></div>}
          </Card>

          <Card title="Constats (écarts)" actions={<span className="small muted">{d.findings.length} constat(s)</span>} bodyClass="">
            {!d.findings.length ? <div className="card-body"><p className="small muted" style={{ margin: 0 }}>Aucun constat.</p></div> : (
              <ul className="list">{d.findings.map(f => (
                <li key={f.id} className="card-body stack" style={{ gap: 8 }}>
                  <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <div><Badge tone={GRAVITY_TONES[f.gravity]}>{f.gravity_label}</Badge> <Badge>{f.pillar_label}</Badge><p style={{ margin: '6px 0 0' }}>{f.description}</p></div>
                    <div className="row" style={{ gap: 6 }}>
                      {can('qhse:actions') && ['en_cours', 'a_valider'].includes(d.status) && <button className="btn btn-sm" onClick={() => setActionFor(f)}><AlertTriangle />Action corrective</button>}
                      {editable && !f.actions.length && <button className="btn btn-ghost btn-icon" aria-label="Supprimer le constat" onClick={() => window.confirm('Supprimer ce constat ?') && call(() => api.del(`/admin/erp/qhse/findings/${f.id}`), 'Constat supprimé')}><Trash2 /></button>}
                    </div>
                  </div>
                  <PhotoBlock kind="constat" id={f.id} files={f.files} writable={editable} onChange={files => setData(x => ({ ...x, findings: x.findings.map(y => (y.id === f.id ? { ...y, files } : y)) }))} />
                  {f.actions.length > 0 && <ul className="list">{f.actions.map(a => <li key={a.id}><Link className="list-row" to={`/qhse/actions?fiche=${a.id}`}><span><b>{a.title}</b><span className="small muted"> · {a.owner_name || '—'}</span></span><span className="small nowrap">échéance {frDay(a.due_on)} <Badge tone={ACTION_TONES[a.status]}>{a.status_label}</Badge></span></Link></li>)}</ul>}
                  {!f.actions.length && ['majeure', 'critique'].includes(f.gravity) && <span className="small" style={{ color: 'var(--danger)' }}>Une action corrective est obligatoire pour ce constat avant la soumission.</span>}
                </li>
              ))}</ul>
            )}
            {editable && (
              <form className="card-body form-grid" onSubmit={addFinding}>
                <Field label="Volet"><select className="select" value={finding.pillar} onChange={e => setFinding(f => ({ ...f, pillar: e.target.value }))}>{Object.entries(refs.pillars).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></Field>
                <Field label="Gravité"><select className="select" value={finding.gravity} onChange={e => setFinding(f => ({ ...f, gravity: e.target.value }))}>{Object.entries(refs.gravities).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Constat" className="full"><input className="input" required minLength={3} maxLength={500} value={finding.description} onChange={e => setFinding(f => ({ ...f, description: e.target.value }))} placeholder="Écart relevé : ce qui n’est pas conforme, où" /></Field>
                <div className="full"><button className="btn" disabled={busy}><Plus />Ajouter le constat</button></div>
              </form>
            )}
          </Card>

          <Card title="Photos de l’audit"><PhotoBlock kind="audit" id={d.id} files={d.files} writable={editable} onChange={files => setData(x => ({ ...x, files }))} /></Card>
        </>
      )}
      {actionFor && (
        <ActionForm refs={refs} context={`Constat ${actionFor.gravity_label.toLowerCase()} de l’audit ${d.reference} : ${actionFor.description}`}
          defaults={{ finding_id: actionFor.id, audit_id: d.id, worksite_id: d.worksite_id || '', gravity: actionFor.gravity, pillar: actionFor.pillar, title: actionFor.description.slice(0, 120) }}
          onClose={() => setActionFor(null)} onSaved={async () => { setActionFor(null); setData(await api.get(`${base}`)); saved('Action corrective ouverte'); }} />
      )}
    </div>
  );
}
