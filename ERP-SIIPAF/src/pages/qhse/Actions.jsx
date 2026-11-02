/**
 * QHSE › Actions correctives : plan d'actions de tous les contrôles, audits et réclamations (responsable, échéance, statut, preuve
 * de levée). Le responsable d'une action la fait avancer et la lève sans autre droit que de consulter le QHSE.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, ListChecks, Check, Play, RotateCcw, Ban, Pencil } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { usePersistentState } from '@admin/lib/navigation';
import { Badge, Card, Drawer, Empty, ErrorBox, Field, Modal, Skeleton } from '@admin/components/ui';
import { QH, useQhseRefs, ACTION_TONES, GRAVITY_TONES, PhotoBlock, FileThumbs, frDay } from '../../lib/qhse';

const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Formulaire d'une action corrective (création ; `defaults` : rattachement et texte proposés). */
export function ActionForm({ refs, defaults = {}, context = null, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    title: '', description: '', gravity: 'mineure', pillar: '', owner_id: '', worksite_id: '', ...defaults,
    due_on: defaults.due_on || addDays(refs.today, refs.settings.due[defaults.gravity || 'mineure']),
  }));
  const [touched, setTouched] = useState(!!defaults.due_on);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const gravity = e => setF(v => ({ ...v, gravity: e.target.value, due_on: touched ? v.due_on : addDays(refs.today, refs.settings.due[e.target.value]) }));
  const fixedSite = !!defaults.worksite_id;

  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const out = await api.post(`${QH}/actions`, {
        title: f.title, description: f.description || null, gravity: f.gravity, pillar: f.pillar || null, owner_id: Number(f.owner_id), due_on: f.due_on,
        worksite_id: f.worksite_id ? Number(f.worksite_id) : null, control_id: f.control_id || null, audit_id: f.audit_id || null, finding_id: f.finding_id || null, sav_ticket_id: f.sav_ticket_id || null,
      });
      onSaved(out);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title="Nouvelle action corrective" onClose={onClose}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button><button form="qhse-action-form" className="btn btn-primary" disabled={busy}>Ouvrir l’action</button></>}>
      <form id="qhse-action-form" className="form-grid" onSubmit={save}>
        <ErrorBox error={error} />
        {context && <p className="small muted full" style={{ margin: 0 }}>{context}</p>}
        <Field label="Action à mener" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} /></Field>
        <Field label="Détail" className="full"><textarea className="textarea" rows={3} maxLength={4000} value={f.description || ''} onChange={set('description')} /></Field>
        <Field label="Gravité" hint={`Échéance proposée : ${refs.settings.due[f.gravity]} jour(s)`}>
          <select className="select" value={f.gravity} onChange={gravity}>{Object.entries(refs.gravities).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Volet"><select className="select" value={f.pillar || ''} onChange={set('pillar')}><option value="">Non précisé</option>{Object.entries(refs.pillars).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></Field>
        <Field label="Responsable" hint="Il est prévenu et peut faire avancer et lever l’action">
          <select className="select" required value={f.owner_id} onChange={set('owner_id')}><option value="">Choisir…</option>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </Field>
        <Field label="Échéance"><input className="input" type="date" required min={refs.today} value={f.due_on} onChange={e => { setTouched(true); set('due_on')(e); }} /></Field>
        <Field label="Chantier" className="full">
          <select className="select" value={f.worksite_id || ''} onChange={set('worksite_id')} disabled={fixedSite}>
            <option value="">Aucun chantier en particulier</option>{refs.worksites.map(w => <option key={w.id} value={w.id}>{w.reference} · {w.name}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

function EditAction({ action, refs, onClose, onSaved }) {
  const [f, setF] = useState({ title: action.title, description: action.description || '', gravity: action.gravity, pillar: action.pillar || '', owner_id: action.owner_id || '', due_on: action.due_on || '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onSaved(await api.patch(`${QH}/actions/${action.id}`, { title: f.title, description: f.description || null, gravity: f.gravity, pillar: f.pillar || null, owner_id: Number(f.owner_id), due_on: f.due_on })); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Modifier ${action.reference}`} onClose={onClose}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button><button form="qhse-action-edit" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="qhse-action-edit" className="form-grid" onSubmit={save}>
        <ErrorBox error={error} />
        <Field label="Action à mener" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} /></Field>
        <Field label="Détail" className="full"><textarea className="textarea" rows={3} maxLength={4000} value={f.description} onChange={set('description')} /></Field>
        <Field label="Gravité"><select className="select" value={f.gravity} onChange={set('gravity')}>{Object.entries(refs.gravities).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Volet"><select className="select" value={f.pillar} onChange={set('pillar')}><option value="">Non précisé</option>{Object.entries(refs.pillars).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></Field>
        <Field label="Responsable"><select className="select" required value={f.owner_id} onChange={set('owner_id')}>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Échéance"><input className="input" type="date" required value={f.due_on} onChange={set('due_on')} /></Field>
      </form>
    </Modal>
  );
}

/** Fiche d'une action : avancement, preuve de levée. */
export function ActionDrawer({ id, refs, onClose, onChanged }) {
  const { can } = useAuth();
  const saved = useSaved();
  const res = useResource(`${QH}/actions/${id}`);
  const [mode, setMode] = useState(null); // lever, annuler, modifier
  const [note, setNote] = useState('');
  const [liftedOn, setLiftedOn] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const a = res.data;

  const run = async (status, extra = {}, message) => {
    setBusy(true); setError(null);
    try { res.setData(await api.post(`${QH}/actions/${id}/status`, { status, ...extra })); setMode(null); setNote(''); saved(message); onChanged?.(); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Drawer title={a ? `${a.reference} · ${a.title}` : 'Action corrective'} onClose={onClose}>
      {res.error ? <ErrorBox error={res.error} /> : !a ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <ErrorBox error={error} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={ACTION_TONES[a.status]}>{a.status_label}</Badge>
            <Badge tone={GRAVITY_TONES[a.gravity]}>{a.gravity_label}</Badge>
            {a.late && <Badge tone="danger">En retard de {a.days_late} j</Badge>}
            {a.pillar_label && <Badge>{a.pillar_label}</Badge>}
          </div>
          <dl className="mk-brief">
            <dt>Responsable</dt><dd>{a.owner_name || '—'}</dd>
            <dt>Échéance</dt><dd>{frDay(a.due_on)}</dd>
            <dt>Chantier</dt><dd>{a.worksite_id ? <Link className="link" to={`/chantiers/${a.worksite_id}?onglet=qhse`}>{a.worksite_reference} · {a.worksite_name}</Link> : '—'}</dd>
            <dt>Origine</dt>
            <dd>
              {a.source_label}
              {a.audit_id && <> · <Link className="link" to={`/qhse/audits/${a.audit_id}`}>{a.audit_reference}</Link></>}
              {a.control_id && <> · <Link className="link" to={`/qhse/controles/${a.control_id}`}>contrôle</Link></>}
              {a.sav_ticket_id && <> · <Link className="link" to={`/sav/reclamations?t=${a.sav_ticket_id}`}>{a.sav_ref || 'réclamation'}</Link></>}
            </dd>
            <dt>Ouverte par</dt><dd>{a.created_by_name || '—'}</dd>
          </dl>
          {a.description && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.description}</p>}

          {a.status === 'levee' && (
            <div className="callout-erp"><Check aria-hidden="true" /><span className="small"><b>Levée le {frDay(a.lifted_on)}.</b> {a.lifted_note}</span></div>
          )}
          {a.status === 'annulee' && <div className="callout-erp"><Ban aria-hidden="true" /><span className="small"><b>Annulée.</b> {a.lifted_note}</span></div>}
          {a.files.some(f => f.purpose === 'preuve') && <div><h3 className="erp-h3">Preuve de levée</h3><FileThumbs files={a.files.filter(f => f.purpose === 'preuve')} /></div>}

          {a.can_progress && !mode && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {a.status === 'ouverte' && <button className="btn" disabled={busy} onClick={() => run('en_cours', {}, 'Traitement démarré')}><Play />Démarrer le traitement</button>}
              <button className="btn btn-primary" onClick={() => { setMode('lever'); setLiftedOn(refs.today); }}><Check />Lever l’action</button>
              {a.can_edit && <button className="btn" onClick={() => setMode('modifier')}><Pencil />Modifier</button>}
              {a.can_edit && <button className="btn btn-danger" onClick={() => setMode('annuler')}><Ban />Annuler</button>}
            </div>
          )}
          {a.can_reopen && <div><button className="btn" disabled={busy} onClick={() => run('ouverte', {}, 'Action rouverte')}><RotateCcw />Rouvrir l’action</button></div>}

          {mode === 'lever' && (
            <Card title="Lever l’action : preuve">
              <div className="stack" style={{ gap: 12 }}>
                <p className="small muted" style={{ margin: 0 }}>Joignez une photo de la correction faite, ou décrivez ce qui a été fait.</p>
                <PhotoBlock kind="action" id={a.id} files={a.files} purpose="preuve" writable label="Ajouter une photo de preuve" onChange={files => res.setData(d => ({ ...d, files }))} />
                <Field label="Ce qui a été fait"><textarea className="textarea" rows={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></Field>
                <Field label="Levée le"><input className="input" type="date" max={refs.today} value={liftedOn} onChange={e => setLiftedOn(e.target.value)} style={{ maxWidth: 180 }} /></Field>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-primary" disabled={busy} onClick={() => run('levee', { note: note || null, lifted_on: liftedOn || undefined }, 'Action levée')}>Confirmer la levée</button>
                  <button className="btn btn-ghost" onClick={() => setMode(null)}>Annuler</button>
                </div>
              </div>
            </Card>
          )}
          {mode === 'annuler' && (
            <Card title="Annuler l’action">
              <div className="stack" style={{ gap: 12 }}>
                <Field label="Motif de l’annulation"><textarea className="textarea" rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></Field>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-danger" disabled={busy} onClick={() => run('annulee', { note }, 'Action annulée')}>Annuler l’action</button>
                  <button className="btn btn-ghost" onClick={() => setMode(null)}>Annuler</button>
                </div>
              </div>
            </Card>
          )}
          {mode === 'modifier' && <EditAction action={a} refs={refs} onClose={() => setMode(null)} onSaved={out => { res.setData(out); setMode(null); saved('Action modifiée'); onChanged?.(); }} />}
        </div>
      )}
    </Drawer>
  );
}

export default function Actions() {
  const { can } = useAuth();
  const refs = useQhseRefs();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = usePersistentState('statut', 'ouvertes', { forced: params.get('statut') }); // un lien avec ?statut l'impose
  const [mine, setMine] = usePersistentState('miennes', false); // filtres gardés au retour
  const [worksite, setWorksite] = usePersistentState('chantier', '');
  const [creating, setCreating] = useState(false);
  const url = `${QH}/actions?status=${status}${mine ? '&mine=1' : ''}${worksite ? `&worksite_id=${worksite}` : ''}`;
  const list = useResource(url);
  const open = Number(params.get('fiche')) || null;
  useEffect(() => { if (list.data && refs && params.get('nouveau') && can('qhse:actions')) setCreating(true); }, [list.data, refs]); // eslint-disable-line react-hooks/exhaustive-deps
  if (list.error) return <ErrorBox error={list.error} />;
  if (!refs || !list.data) return <Skeleton h={300} />;
  const openAction = id => setParams(id ? { fiche: id } : {}, { replace: true });

  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <p className="muted" style={{ margin: 0 }}>Plan d’actions : chaque écart relevé (contrôle, audit, réclamation) a un responsable, une échéance et une preuve de levée.</p>
        {can('qhse:actions') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouvelle action</button>}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut">
          <option value="ouvertes">Ouvertes</option><option value="retard">En retard</option><option value="levees">Levées</option><option value="annulee">Annulées</option><option value="toutes">Toutes</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={worksite} onChange={e => setWorksite(e.target.value)} aria-label="Chantier">
          <option value="">Tous les chantiers</option>{refs.worksites.map(w => <option key={w.id} value={w.id}>{w.reference} · {w.name}</option>)}
        </select>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />Mes actions</label>
      </div>
      <Card title="Actions correctives" bodyClass="">
        {!list.data.length ? <div className="card-body"><Empty icon={ListChecks}>Aucune action.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Action</th><th>Chantier</th><th>Responsable</th><th>Échéance</th><th>Gravité</th><th>État</th></tr></thead>
            <tbody>{list.data.map(a => (
              <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => openAction(a.id)}>
                <td><button className="link" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => openAction(a.id)}><b>{a.title}</b></button><div className="small muted">{a.reference} · {a.source_label}{a.pillar_label ? ` · ${a.pillar_label}` : ''}</div></td>
                <td className="small">{a.worksite_reference ? `${a.worksite_reference} · ${a.worksite_name}` : '—'}</td>
                <td className="small">{a.owner_name || '—'}</td>
                <td className="small nowrap">{frDay(a.due_on)}{a.late && <> <Badge tone="danger">{a.days_late} j</Badge></>}</td>
                <td><Badge tone={GRAVITY_TONES[a.gravity]}>{a.gravity_label}</Badge></td>
                <td><Badge tone={ACTION_TONES[a.status]}>{a.status_label}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {creating && <ActionForm refs={refs} onClose={() => { setCreating(false); if (params.get('nouveau')) setParams({}, { replace: true }); }} onSaved={a => { setCreating(false); list.reload(); openAction(a.id); }} />}
      {open && <ActionDrawer id={open} refs={refs} onClose={() => openAction(null)} onChanged={list.reload} />}
    </div>
  );
}
