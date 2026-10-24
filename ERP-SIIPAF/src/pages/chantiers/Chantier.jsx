/**
 * Chantiers › Fiche d'un chantier : en-tête (avancement, retards, budget, lots de la zone), onglets Planning
 * (Gantt et phases), Tâches (Kanban), Budget par poste. Le conducteur nommé et les gestionnaires modifient ;
 * les autres comptes autorisés consultent.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Check, Trash2, CalendarRange, ListChecks, Wallet, Flag, BookText, Megaphone, Truck, Handshake, ArrowUp, ArrowDown, HardHat, MapPin, Gauge, AlertTriangle } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Modal, Badge, Advance } from '@admin/components/ui';
import { date, fcfa, num } from '@admin/lib/format';
import Gantt from '../../components/Gantt';
import { CH, WS_TONES, PHASE_TONES, TASK_COLORS, useChantierRefs, body } from '../../lib/chantiers';
import { WorksiteForm } from './Chantiers';
import { Journal, Progress, Stages, Deliveries } from './Suivi';
import SousTraitance from './SousTraitance';

const TABS = [
  ['planning', 'Planning', CalendarRange], ['taches', 'Tâches', ListChecks], ['journal', 'Journal', BookText], ['avancement', 'Avancement client', Megaphone],
  ['etapes', 'Étapes et appels de fonds', Flag], ['sous-traitants', 'Sous-traitants', Handshake], ['livraisons', 'Livraisons', Truck], ['budget', 'Budget', Wallet],
];

export default function Chantier() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const refs = useChantierRefs();
  const res = useResource(`${CH}/${id}`);
  const [editing, setEditing] = useState(false);
  const tab = TABS.some(t => t[0] === params.get('onglet')) ? params.get('onglet') : 'planning';
  const setTab = t => setParams(t === 'planning' ? {} : { onglet: t }, { replace: true });
  const w = res.data;
  if (res.error) return <div className="stack"><BackLink /><ErrorBox error={res.error} /></div>;
  if (!w || !refs) return <div className="stack"><BackLink /><Skeleton h={120} /><Skeleton h={300} /></div>;
  const update = data => res.setData(data);

  return (
    <div className="stack">
      <div className="row-between">
        <BackLink />
        {w.can_manage && <button className="btn" onClick={() => setEditing(true)}><Pencil />Modifier le chantier</button>}
      </div>

      <Card>
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>{w.name}</h2>
            <div className="row small muted" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <span className="tabular">{w.reference}</span><Badge tone={WS_TONES[w.status]}>{w.status_label}</Badge>
              <span><MapPin className="ico" />{w.project_name} · {w.zone_label}</span>
              <span><HardHat className="ico" />{w.manager_name || 'Conducteur non nommé'}</span>
            </div>
            {w.description && <p className="small" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{w.description}</p>}
          </div>
        </div>
        <div className="ws-figures">
          <div><span className="small muted"><Gauge className="ico" />Avancement</span><Advance value={w.progress_pct} /></div>
          <div><span className="small muted"><CalendarRange className="ico" />Période prévue</span><b className="small">{w.planned_start ? `${date(w.planned_start)} → ${date(w.planned_end)}` : '—'}</b>
            {w.actual_start && <span className="small muted">Démarré le {date(w.actual_start)}{w.actual_end ? `, terminé le ${date(w.actual_end)}` : ''}</span>}</div>
          <div><span className="small muted"><AlertTriangle className="ico" />Phases en retard</span><b>{w.late_phases ? <Badge tone="danger">{w.late_phases} · jusqu’à {w.late_days} j</Badge> : 'Aucune'}</b></div>
          <div><span className="small muted"><Wallet className="ico" />Budget consommé</span><b className="tabular">{fcfa(w.spent_fcfa)}<span className="small muted"> sur {w.budget_fcfa ? fcfa(w.budget_fcfa) : '—'}</span></b>{w.consumed_pct != null && <Advance value={Math.min(100, w.consumed_pct)} />}</div>
          <div><span className="small muted">Lots de la zone</span><b className="tabular">{num(w.lots.total)}<span className="small muted"> dont {num(w.lots.sold)} réservé(s) ou vendu(s)</span></b></div>
        </div>
      </Card>

      <div className="tabs" role="tablist">
        {TABS.map(([k, l, Icon]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}><Icon className="ico" />{l}</button>)}
      </div>
      {tab === 'planning' && <Planning w={w} refs={refs} onChange={update} />}
      {tab === 'taches' && <Tasks w={w} refs={refs} onChange={update} />}
      {tab === 'journal' && <Journal w={w} refs={refs} />}
      {tab === 'avancement' && <Progress w={w} refs={refs} />}
      {tab === 'etapes' && <Stages w={w} refs={refs} onChange={() => res.reload()} />}
      {tab === 'sous-traitants' && <SousTraitance w={w} refs={refs} onChange={() => res.reload()} />}
      {tab === 'livraisons' && <Deliveries w={w} />}
      {tab === 'budget' && <Budget w={w} refs={refs} onChange={update} />}

      {editing && <WorksiteForm worksite={w} refs={refs} onClose={() => setEditing(false)} onSaved={data => { setEditing(false); update(data); }} />}
      {can('chantiers:write') && <DeleteWorksite w={w} onDeleted={() => navigate('/chantiers/liste')} />}
    </div>
  );
}

const BackLink = () => <Link to="/chantiers/liste" className="btn btn-ghost"><ArrowLeft />Tous les chantiers</Link>;

// ─── Planning ───────────────────────────────────────────────────────────────

function Planning({ w, refs, onChange }) {
  const toast = useToast();
  const [phase, setPhase] = useState(null);
  const move = async (i, d) => {
    const ids = w.phases.map(p => p.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    try { onChange(await api.put(`${CH}/${w.id}/phases/ordre`, { ids })); } catch (e) { toast(e.message, 'err'); }
  };
  const milestones = w.tasks.filter(t => t.milestone && t.due_on);
  return (
    <div className="stack">
      <Card title="Planning" actions={w.can_manage && <button className="btn btn-primary" onClick={() => setPhase({})}><Plus />Ajouter une phase</button>}>
        {!w.phases.length ? <Empty icon={CalendarRange}>Aucune phase.{w.can_manage ? ' Ajoutez les phases du chantier.' : ''}</Empty>
          : <Gantt phases={w.phases} milestones={milestones} onSelect={w.can_manage ? setPhase : undefined} />}
      </Card>
      {w.phases.length > 0 && (
        <Card title="Phases" bodyClass="">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Phase</th><th>Prévu</th><th>Réel</th><th style={{ minWidth: 130 }}>Avancement</th><th>État</th>{w.can_manage && <th />}</tr></thead>
            <tbody>{w.phases.map((p, i) => {
              const after = w.phases.find(x => x.id === p.depends_on_id);
              return (
                <tr key={p.id}>
                  <td><b>{p.label}</b>{(p.stage_label && p.stage_label !== p.label) || after ? <div className="small muted">{[p.stage_label !== p.label && p.stage_label, after && `après « ${after.label} »`].filter(Boolean).join(' · ')}</div> : null}</td>
                  <td className="small nowrap">{p.planned_start ? `${date(p.planned_start)} → ${date(p.planned_end)}` : '—'}</td>
                  <td className="small nowrap">{p.actual_start ? `${date(p.actual_start)} → ${p.actual_end ? date(p.actual_end) : 'en cours'}` : '—'}</td>
                  <td><Advance value={p.progress_pct} /></td>
                  <td><Badge tone={PHASE_TONES[p.state]}>{p.state_label}{p.late_days > 0 ? ` · ${p.late_days} j` : ''}</Badge></td>
                  {w.can_manage && (
                    <td className="right nowrap">
                      <button className="btn btn-ghost btn-icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Monter ${p.label}`}><ArrowUp /></button>
                      <button className="btn btn-ghost btn-icon" disabled={i === w.phases.length - 1} onClick={() => move(i, 1)} aria-label={`Descendre ${p.label}`}><ArrowDown /></button>
                      <button className="btn btn-ghost btn-icon" onClick={() => setPhase(p)} aria-label={`Modifier ${p.label}`}><Pencil /></button>
                    </td>
                  )}
                </tr>
              );
            })}</tbody>
          </table></div>
        </Card>
      )}
      {phase && <PhaseForm w={w} phase={phase.id ? phase : null} refs={refs} onClose={() => setPhase(null)} onSaved={d => { setPhase(null); onChange(d); }} />}
    </div>
  );
}

function PhaseForm({ w, phase: p, refs, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({
    stage: p?.stage || '', label: p?.label || '', planned_start: p?.planned_start || '', planned_end: p?.planned_end || '',
    actual_start: p?.actual_start || '', actual_end: p?.actual_end || '', progress_pct: p?.progress_pct ?? 0, depends_on_id: p?.depends_on_id || '', notes: p?.notes || '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const pickStage = e => {
    const stage = e.target.value;
    const label = refs.stages.find(s => s.key === stage)?.label;
    setF(x => ({ ...x, stage, label: !x.label || refs.stages.some(s => s.label === x.label) ? label || x.label : x.label }));
  };
  // Phase précédente suggérée : sa fin + 1 jour devient le début prévu si rien n'est daté
  const pickAfter = e => {
    const after = w.phases.find(x => String(x.id) === e.target.value);
    setF(x => {
      const next = { ...x, depends_on_id: e.target.value };
      if (after?.planned_end && !x.planned_start) {
        const d = new Date(`${after.planned_end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); next.planned_start = d.toISOString().slice(0, 10);
      }
      return next;
    });
  };
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const data = body(f, ['progress_pct', 'depends_on_id']);
      const res = p ? await api.patch(`${CH}/${w.id}/phases/${p.id}`, data) : await api.post(`${CH}/${w.id}/phases`, data);
      saved(p ? 'Phase enregistrée' : 'Phase ajoutée');
      onSaved(res);
    } catch (err) { setError(err); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Supprimer la phase « ${p.label} » ? Ses tâches restent, sans phase.`)) return;
    setBusy(true);
    try { const res = await api.del(`${CH}/${w.id}/phases/${p.id}`); saved('Phase supprimée'); onSaved(res); } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={p ? `Phase « ${p.label} »` : 'Nouvelle phase'} onClose={onClose}
      footer={<>
        {p && <button className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}><Trash2 />Supprimer</button>}
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="phase-form" disabled={busy}><Check />Enregistrer</button>
      </>}>
      <form id="phase-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Étape du journal de chantier" hint="Vide : phase propre à ce chantier"><select className="select" value={f.stage} onChange={pickStage}><option value="">— Phase libre —</option>{refs.stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
        <Field label="Libellé"><input className="input" required minLength={2} maxLength={160} value={f.label} onChange={set('label')} /></Field>
        <Field label="Après la phase" hint="Enchaînement du planning" className="full">
          <select className="select" value={f.depends_on_id} onChange={pickAfter}><option value="">— Aucune —</option>{w.phases.filter(x => x.id !== p?.id).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        </Field>
        <Field label="Début prévu"><input className="input" type="date" value={f.planned_start} onChange={set('planned_start')} /></Field>
        <Field label="Fin prévue"><input className="input" type="date" value={f.planned_end} onChange={set('planned_end')} /></Field>
        <Field label="Début réel" hint="Rempli à aujourd’hui dès qu’un avancement est saisi"><input className="input" type="date" value={f.actual_start} onChange={set('actual_start')} /></Field>
        <Field label="Fin réelle" hint="La phase passe à 100 %"><input className="input" type="date" value={f.actual_end} onChange={set('actual_end')} /></Field>
        <Field label={`Avancement : ${f.progress_pct} %`} hint="100 % termine la phase aujourd’hui si la fin réelle est vide" className="full">
          <input type="range" min="0" max="100" step="5" value={f.progress_pct} onChange={set('progress_pct')} aria-label="Avancement de la phase" />
        </Field>
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}

// ─── Tâches (Kanban) ────────────────────────────────────────────────────────

function Tasks({ w, refs, onChange }) {
  const toast = useToast();
  const [task, setTask] = useState(null);
  const [phase, setPhase] = useState('');
  const [dragOver, setDragOver] = useState(null);
  const rows = w.tasks.filter(t => !phase || String(t.phase_id || '') === phase);
  const drop = async (t, status) => {
    setDragOver(null);
    if (!t || t.status === status) return;
    try { onChange(await api.patch(`${CH}/${w.id}/taches/${t.id}`, { status })); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <div className="row-between">
        <select className="select" style={{ width: 'auto' }} value={phase} onChange={e => setPhase(e.target.value)} aria-label="Phase">
          <option value="">Toutes les phases</option>{w.phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {w.can_manage && <button className="btn btn-primary" onClick={() => setTask({ phase_id: phase || '' })}><Plus />Nouvelle tâche</button>}
      </div>
      {!w.tasks.length ? <Card><Empty icon={ListChecks}>Aucune tâche.{w.can_manage ? ' Ajoutez les tâches et jalons du chantier.' : ''}</Empty></Card> : (
        <div className="pipeline">
          {Object.entries(refs.task_statuses).map(([st, label]) => {
            const col = rows.filter(t => t.status === st);
            return (
              <div key={st} className={`pipe-col ${dragOver === st ? 'drop' : ''}`}
                onDragOver={e => { if (w.can_manage) { e.preventDefault(); setDragOver(st); } }} onDragLeave={() => setDragOver(null)}
                onDrop={e => { e.preventDefault(); drop(w.tasks.find(t => t.id === Number(e.dataTransfer.getData('text/plain'))), st); }}>
                <div className="pipe-head"><i className="dot" style={{ background: TASK_COLORS[st] }} />{label}<span className="n">{col.length}</span></div>
                <div className="pipe-list">
                  {col.map(t => (
                    <div key={t.id} className="pipe-card" draggable={w.can_manage} onDragStart={e => e.dataTransfer.setData('text/plain', String(t.id))}
                      onClick={() => setTask(t)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setTask(t)}>
                      <b>{t.milestone && <Flag className="ico" aria-label="Jalon" />} {t.title}</b>
                      <div className="meta">{[t.phase_label, t.employee_name || t.supplier_name || t.team].filter(Boolean).join(' · ') || '—'}</div>
                      {(t.due_on || t.late) && (
                        <div className="row" style={{ gap: 6, marginTop: 6 }}>
                          {t.due_on && <span className="small muted">{t.status === 'fait' && t.done_on ? `faite le ${date(t.done_on)}` : `pour le ${date(t.due_on)}`}</span>}
                          {t.late && <Badge tone="danger">en retard</Badge>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {task && <TaskForm w={w} task={task.id ? task : null} preset={task} refs={refs} onClose={() => setTask(null)} onSaved={d => { setTask(null); onChange(d); }} />}
    </div>
  );
}

function TaskForm({ w, task: t, preset, refs, onClose, onSaved }) {
  const saved = useSaved();
  const subcontractors = refs.suppliers.filter(s => s.kind === 'sous_traitant' || s.id === t?.supplier_id);
  const [f, setF] = useState({
    title: t?.title || '', description: t?.description || '', status: t?.status || 'a_faire', phase_id: t?.phase_id || preset?.phase_id || '', milestone: !!t?.milestone,
    employee_id: t?.employee_id || '', supplier_id: t?.supplier_id || '', team: t?.team || '', start_on: t?.start_on || '', due_on: t?.due_on || '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const data = body(f, ['phase_id', 'employee_id', 'supplier_id']);
      data.milestone = f.milestone;
      const res = t ? await api.patch(`${CH}/${w.id}/taches/${t.id}`, data) : await api.post(`${CH}/${w.id}/taches`, data);
      saved(t ? 'Tâche enregistrée' : 'Tâche ajoutée');
      onSaved(res);
    } catch (err) { setError(err); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Supprimer la tâche « ${t.title} » ?`)) return;
    setBusy(true);
    try { const res = await api.del(`${CH}/${w.id}/taches/${t.id}`); saved('Tâche supprimée'); onSaved(res); } catch (err) { setError(err); setBusy(false); }
  };
  const ro = !w.can_manage;
  return (
    <Modal title={t ? t.title : 'Nouvelle tâche'} onClose={onClose}
      footer={ro ? <button className="btn" onClick={onClose}>Fermer</button> : <>
        {t && <button className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}><Trash2 />Supprimer</button>}
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="task-form" disabled={busy}><Check />Enregistrer</button>
      </>}>
      <form id="task-form" className="form-grid" onSubmit={save}>
        <fieldset disabled={ro} className="form-grid full" style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="full"><ErrorBox error={error} /></div>
          <Field label="Tâche" className="full"><input className="input" required minLength={2} maxLength={200} value={f.title} onChange={set('title')} placeholder="Implantation, coulage des semelles, pose des bordures…" /></Field>
          <Field label="Phase"><select className="select" value={f.phase_id} onChange={set('phase_id')}><option value="">— Sans phase —</option>{w.phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
          <Field label="Statut"><select className="select" value={f.status} onChange={set('status')}>{Object.entries(refs.task_statuses).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Employé responsable" hint="Prévenu par la cloche s’il a un compte"><select className="select" value={f.employee_id} onChange={set('employee_id')}><option value="">—</option>{refs.employees.map(e => <option key={e.id} value={e.id}>{e.label}{e.job_title ? ` — ${e.job_title}` : ''}</option>)}</select></Field>
          <Field label="Sous-traitant" hint="Fiches fournisseurs de catégorie « Sous-traitant »"><select className="select" value={f.supplier_id} onChange={set('supplier_id')}><option value="">—</option>{subcontractors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Équipe ou intervenant" className="full"><input className="input" maxLength={120} value={f.team} onChange={set('team')} placeholder="Équipe maçonnerie 2, géomètre…" /></Field>
          <Field label="Début"><input className="input" type="date" value={f.start_on} onChange={set('start_on')} /></Field>
          <Field label="Échéance"><input className="input" type="date" value={f.due_on} onChange={set('due_on')} /></Field>
          <label className="full row small" style={{ gap: 8 }}><input type="checkbox" checked={f.milestone} onChange={e => setF(x => ({ ...x, milestone: e.target.checked }))} />Jalon (affiché sur le planning à son échéance)</label>
          <Field label="Détails" className="full"><textarea className="textarea" rows={3} maxLength={4000} value={f.description} onChange={set('description')} /></Field>
          {t?.done_on && <p className="full small muted">Faite le {date(t.done_on)}.</p>}
        </fieldset>
      </form>
    </Modal>
  );
}

// ─── Budget ─────────────────────────────────────────────────────────────────

function Budget({ w, refs, onChange }) {
  const [line, setLine] = useState(null);
  const total = w.budget_fcfa;
  const c = w.costs;
  const tone = pct => (pct == null ? '' : pct > 100 ? 'danger' : pct >= (refs.settings?.chantier_budget_alert_pct ?? 90) ? 'warn' : 'ok');
  return (
    <div className="stack">
      <Card title="Prévu et réel par poste" bodyClass="">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Poste</th><th className="right">Prévu</th><th className="right">Réel</th><th className="right">Écart</th><th style={{ minWidth: 140 }}>Consommé</th></tr></thead>
          <tbody>
            {w.budget_by_category.filter(x => x.amount_fcfa || x.spent_fcfa).map(x => {
              const pct = x.amount_fcfa ? Math.round((x.spent_fcfa / x.amount_fcfa) * 100) : null;
              return (
                <tr key={x.category}>
                  <td><b>{x.label}</b></td>
                  <td className="right tabular">{x.amount_fcfa ? fcfa(x.amount_fcfa) : '—'}</td>
                  <td className="right tabular">{fcfa(x.spent_fcfa)}</td>
                  <td className="right tabular" style={{ color: x.spent_fcfa > x.amount_fcfa ? 'var(--danger)' : undefined }}>{fcfa(x.amount_fcfa - x.spent_fcfa)}</td>
                  <td>{pct == null ? <Badge tone="warn">hors budget</Badge> : <Badge tone={tone(pct)}>{pct} %</Badge>}</td>
                </tr>
              );
            })}
            <tr>
              <td><b>Total</b></td><td className="right tabular"><b>{fcfa(total)}</b></td><td className="right tabular"><b>{fcfa(w.spent_fcfa)}</b></td>
              <td className="right tabular"><b>{fcfa(total - w.spent_fcfa)}</b></td><td>{w.consumed_pct == null ? '—' : <Badge tone={tone(w.consumed_pct)}>{w.consumed_pct} %</Badge>}</td>
            </tr>
          </tbody>
        </table></div>
        <p className="small muted card-body" style={{ margin: 0 }}>
          Réel = factures d’achat affectées au chantier (HT, brouillons compris : {fcfa(c.drafts_fcfa)} à valider par la Comptabilité), dépenses du parc,
          heures pointées sur le chantier valorisées au coût horaire, et bientôt les situations des sous-traitants. Réglé aux fournisseurs : {fcfa(c.paid_fcfa)}.
        </p>
      </Card>

      <Card title="Budget prévu" actions={w.can_manage && <button className="btn btn-primary" onClick={() => setLine({})}><Plus />Ajouter une ligne</button>} bodyClass="">
        {!w.budget_lines.length ? <div className="card-body"><Empty icon={Wallet}>Aucune ligne de budget.{w.can_manage ? ' Ajoutez les postes prévus (matériaux, main-d’œuvre, sous-traitance…).' : ''}</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Poste</th><th>Ligne</th><th>Phase</th><th className="right">Montant prévu</th>{w.can_manage && <th />}</tr></thead>
            <tbody>
              {w.budget_by_category.filter(x => x.amount_fcfa > 0).flatMap(x => w.budget_lines.filter(l => l.category === x.category).map((l, i, arr) => (
                <tr key={l.id}>
                  {i === 0 && <td rowSpan={arr.length}><b>{x.label}</b></td>}
                  <td>{l.label}{l.notes && <div className="small muted">{l.notes}</div>}</td>
                  <td className="small">{w.phases.find(p => p.id === l.phase_id)?.label || '—'}</td>
                  <td className="right tabular">{fcfa(l.amount_fcfa)}</td>
                  {w.can_manage && <td className="right"><button className="btn btn-ghost btn-icon" onClick={() => setLine(l)} aria-label={`Modifier ${l.label}`}><Pencil /></button></td>}
                </tr>
              )))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Card title="Coûts réels" bodyClass="">
        {!c.purchases.length && !c.parc.length && !c.labor.length ? <div className="card-body"><Empty icon={Wallet}>Aucun coût affecté à ce chantier pour l’instant. Choisissez ce chantier comme affectation d’une facture d’achat, d’une dépense du parc ou d’un pointage.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Source</th><th>Détail</th><th>Poste</th><th className="right">Montant HT</th></tr></thead>
            <tbody>
              {c.purchases.map(p => (
                <tr key={`a${p.id}`}><td className="small nowrap">Achat {p.number}<div className="muted">{date(p.date)}</div></td><td>{p.label}<div className="small muted">{p.supplier_name}{p.status === 'brouillon' ? ' · à valider' : ''}</div></td><td className="small">{refs.budget_labels[p.category] || p.category}</td><td className="right tabular">{fcfa(p.amount_fcfa)}</td></tr>
              ))}
              {c.parc.map(p => (
                <tr key={`p${p.id}`}><td className="small nowrap">Parc<div className="muted">{date(p.date)}</div></td><td>{p.asset}<div className="small muted">{p.label || p.kind}</div></td><td className="small">{refs.budget_labels.engins}</td><td className="right tabular">{fcfa(p.amount_fcfa)}</td></tr>
              ))}
              {c.labor.map(l => (
                <tr key={`m${l.employee_id}`}><td className="small nowrap">Pointages</td><td>{l.name}<div className="small muted">{l.job_title} · {num(l.hours)} h × {fcfa(l.rate)}{l.source === 'salaire' ? ' (tiré du salaire)' : l.source === 'aucun' ? ' (aucun salaire ni taux)' : ''}</div></td><td className="small">{refs.budget_labels.main_oeuvre}</td><td className="right tabular">{fcfa(l.amount_fcfa)}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {line && <BudgetForm w={w} line={line.id ? line : null} refs={refs} onClose={() => setLine(null)} onSaved={d => { setLine(null); onChange(d); }} />}
    </div>
  );
}

function BudgetForm({ w, line: l, refs, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ category: l?.category || 'materiaux', label: l?.label || '', phase_id: l?.phase_id || '', amount_fcfa: l?.amount_fcfa ?? '', notes: l?.notes || '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const data = body(f, ['phase_id', 'amount_fcfa']);
      const res = l ? await api.patch(`${CH}/${w.id}/budget/${l.id}`, data) : await api.post(`${CH}/${w.id}/budget`, data);
      saved(l ? 'Ligne enregistrée' : 'Ligne ajoutée');
      onSaved(res);
    } catch (err) { setError(err); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Supprimer la ligne « ${l.label} » ?`)) return;
    setBusy(true);
    try { const res = await api.del(`${CH}/${w.id}/budget/${l.id}`); saved('Ligne supprimée'); onSaved(res); } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={l ? `Ligne « ${l.label} »` : 'Nouvelle ligne de budget'} onClose={onClose}
      footer={<>
        {l && <button className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}><Trash2 />Supprimer</button>}
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="budget-form" disabled={busy}><Check />Enregistrer</button>
      </>}>
      <form id="budget-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Poste" hint="Liste réglable dans Chantiers › Réglages"><select className="select" value={f.category} onChange={set('category')}>{Object.entries(refs.budget_categories).map(([k, x]) => <option key={k} value={k}>{x}</option>)}{l && !refs.budget_categories[l.category] && <option value={l.category}>{refs.budget_labels[l.category] || l.category} (désactivé)</option>}</select></Field>
        <Field label="Montant prévu (FCFA)"><input className="input" type="number" min="0" required value={f.amount_fcfa} onChange={set('amount_fcfa')} /></Field>
        <Field label="Libellé" className="full"><input className="input" required minLength={2} maxLength={160} value={f.label} onChange={set('label')} placeholder="Ciment et acier, lot VRD, location de pelle…" /></Field>
        <Field label="Phase" hint="Facultatif" className="full"><select className="select" value={f.phase_id} onChange={set('phase_id')}><option value="">— Tout le chantier —</option>{w.phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} maxLength={1000} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}

/** Suppression d'un chantier vide (sans tâche ni avancement) ; sinon le serveur demande de le clore. */
function DeleteWorksite({ w, onDeleted }) {
  const toast = useToast();
  const saved = useSaved();
  const remove = async () => {
    if (!window.confirm(`Supprimer le chantier ${w.reference} ? Seul un chantier sans tâche ni avancement peut l’être.`)) return;
    try { await api.del(`${CH}/${w.id}`); saved('Chantier supprimé'); onDeleted(); } catch (e) { toast(e.message, 'err'); }
  };
  return <div><button className="btn btn-ghost" onClick={remove}><Trash2 />Supprimer ce chantier</button></div>;
}
