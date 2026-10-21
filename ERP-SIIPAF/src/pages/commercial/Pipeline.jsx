import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Star, Clock, UserRound } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Skeleton, ErrorBox, Modal, Field } from '@admin/components/ui';
import PipelineBoard from '@admin/components/PipelineBoard';
import { initials } from '@admin/lib/format';
import { useCommercialMeta, compact, ACTIVITY_STATE, STAGE_COLORS } from '../../lib/commercial';
import LeadDrawer, { LostModal } from './LeadDrawer';

export default function Pipeline() {
  const { can } = useAuth();
  const toast = useToast();
  const meta = useCommercialMeta();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dragOver, setDragOver] = useState(null);
  const [lost, setLost] = useState(null);
  const [creating, setCreating] = useState(false);
  const projectId = params.get('project_id') || '';
  const assigned = params.get('assigned_to') || '';
  const showLost = params.get('perdus') === '1';
  const leadId = Number(params.get('p')) || null;

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  const list = useResource(`/admin/erp/commercial/pipeline${qs({ project_id: projectId, assigned_to: assigned, q: debounced, include_lost: showLost ? '1' : '' })}`);
  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  const open = id => set('p', id ? String(id) : '');

  const move = async (lead, to) => {
    setDragOver(null);
    if (!lead || lead.stage === to) return;
    if (to === 'perdu') { setLost(lead); return; }
    list.setData(rows => rows.map(r => (r.id === lead.id ? { ...r, stage: to } : r)));
    try { await api.post(`/admin/erp/commercial/leads/${lead.id}/stage`, { stage: to }); } catch (e) { toast(e.message, 'err'); }
    list.reload();
  };

  const columns = [...(meta?.pipeline_stages || []), ...(showLost ? ['perdu'] : [])];
  const stageInfo = id => meta?.stages.find(s => s.id === id);
  const rows = list.data || [];

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <label className="search">
            <Search aria-hidden="true" />
            <input className="input" type="search" placeholder="Nom, téléphone, code client…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" />
          </label>
          <select className="select" style={{ width: 'auto' }} value={projectId} onChange={e => set('project_id', e.target.value)} aria-label="Programme">
            <option value="">Tous les programmes</option>
            {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={assigned} onChange={e => set('assigned_to', e.target.value)} aria-label="Commercial">
            <option value="">Toute l’équipe</option>
            {meta?.sellers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <label className="checkbox small"><input type="checkbox" checked={showLost} onChange={e => set('perdus', e.target.checked ? '1' : '')} />Afficher les perdus</label>
        </div>
        {can('leads:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouveau prospect</button>}
      </div>
      <ErrorBox error={list.error} />
      {!meta && <Skeleton h={320} />}

      <PipelineBoard>
        {columns.map(st => {
          const col = rows.filter(r => r.stage === st);
          const total = col.reduce((s, r) => s + (r.expected_revenue_fcfa || 0), 0);
          return (
            <div key={st} className={`pipe-col ${dragOver === st ? 'drop' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(st); }} onDragLeave={() => setDragOver(null)}
              onDrop={e => { e.preventDefault(); move(rows.find(r => r.id === Number(e.dataTransfer.getData('text/plain'))), st); }}>
              <div className="pipe-head" style={{ borderTop: `3px solid ${STAGE_COLORS[st]}`, borderRadius: 'var(--radius) var(--radius) 0 0' }}>
                <span>{stageInfo(st)?.label || st}<span className="muted small" style={{ fontWeight: 400 }}> · {stageInfo(st)?.probability} %</span></span>
                <span className="n">{col.length}</span>
              </div>
              <div className="pipe-total small muted tabular">{total ? `${compact(total)} FCFA` : '—'}</div>
              <div className="pipe-list">
                {!list.data && <Skeleton h={70} />}
                {col.map(r => {
                  const act = r.next_activity && ACTIVITY_STATE[r.next_activity.state];
                  return (
                    <div key={r.id} className="pipe-card" draggable={can('leads:write')} onDragStart={e => e.dataTransfer.setData('text/plain', String(r.id))}
                      onClick={() => open(r.id)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && open(r.id)}>
                      <div className="row-between" style={{ gap: 6 }}>
                        <b className="ellipsis">{r.name}</b>
                        {r.priority > 0 && <span className="stars" aria-label={`Priorité ${r.priority} sur 3`}>{[1, 2, 3].map(n => <Star key={n} className={n <= r.priority ? 'on' : ''} style={{ width: 12, height: 12 }} aria-hidden="true" />)}</span>}
                      </div>
                      <div className="meta">{r.project_name || 'Programme à préciser'}{r.lot_code ? ` · lot ${r.lot_code}` : ''}</div>
                      {r.stage === 'perdu' && r.lost_reason && <div className="meta" style={{ color: 'var(--danger)' }}>{meta?.lost_reasons[r.lost_reason]}</div>}
                      <div className="row-between" style={{ marginTop: 8, gap: 6 }}>
                        <span className="small tabular"><b>{r.expected_revenue_fcfa ? compact(r.expected_revenue_fcfa) : '—'}</b></span>
                        <span className="row" style={{ gap: 6 }}>
                          <span title={act ? `${act.label} : ${r.next_activity.summary || ''}` : 'Aucune activité planifiée'} className="act-dot" style={{ color: act ? act.color : 'var(--border-strong)' }}><Clock aria-hidden="true" /></span>
                          <span className="avatar xs" title={r.assigned_name || 'Non attribué'}>{r.assigned_name ? initials(r.assigned_name) : <UserRound aria-hidden="true" />}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </PipelineBoard>

      {leadId && <LeadDrawer id={leadId} onClose={() => open(null)} onChange={() => list.reload()} />}
      {lost && <LostModal lead={lost} onClose={() => setLost(null)} onDone={() => { setLost(null); list.reload(); }} />}
      {creating && <NewLead meta={meta} onClose={() => setCreating(false)} onCreated={l => { setCreating(false); list.reload(); open(l.id); }} />}
    </div>
  );
}

function NewLead({ meta, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', project_id: '', is_diaspora: false, message: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const lead = await api.post('/admin/leads', {
        name: form.name, phone: form.phone || null, email: form.email || null, project_id: Number(form.project_id) || null,
        is_diaspora: form.is_diaspora, message: form.message || null,
      });
      onCreated(lead);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title="Nouveau prospect" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="new-lead" disabled={busy}>Créer</button></>}>
      <form id="new-lead" className="form-grid" onSubmit={submit}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Nom complet" className="full"><input className="input" required minLength={2} value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Téléphone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Programme qui l’intéresse">
          <select className="select" value={form.project_id} onChange={set('project_id')}>
            <option value="">—</option>
            {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={form.is_diaspora} onChange={set('is_diaspora')} />Client de la diaspora</label>
        <Field label="Premier échange" className="full"><textarea className="textarea" rows={3} value={form.message} onChange={set('message')} placeholder="Besoin exprimé, budget, délai…" /></Field>
      </form>
      <p className="small muted" style={{ marginTop: 8 }}>Si le téléphone ou l’e-mail existe déjà, la fiche existante est reprise (pas de doublon).</p>
    </Modal>
  );
}
