/**
 * Chantiers › Liste (choix du client du 24/10) : plusieurs chantiers par programme, chacun avec sa zone, son
 * conducteur, son avancement (phases pondérées par leur durée), ses phases en retard et son budget.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, HardHat, Check, Flag, ShoppingCart } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Modal, Badge, Advance } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { CH, WS_TONES, useChantierRefs, body } from '../../lib/chantiers';

export default function Chantiers() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const refs = useChantierRefs();
  const [status, setStatus] = useState('ouverts');
  const [project, setProject] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useResource(`${CH}${qs({ status, project_id: project, q })}`);
  // Direction : étapes signalées par les conducteurs, à déclarer (elles émettront les appels de fonds)
  const pending = useResource(can('chantiers:direction') ? `${CH}/etapes?status=signalee` : null);
  const situations = useResource(can('chantiers:direction') ? `${CH}/situations` : null);
  // Direction et acheteurs : besoins en matériaux exprimés par les conducteurs, à valider
  const needs = useResource(can('chantiers:direction') || can('achats:write') ? `${CH}/besoins?statut=demande` : null);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="Statut">
            {[['ouverts', 'En cours'], ['receptionne', 'Réceptionnés'], ['clos', 'Clos'], ['', 'Tous']].map(([k, l]) => <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}
          </div>
          <select className="select" style={{ width: 'auto' }} value={project} onChange={e => setProject(e.target.value)} aria-label="Programme">
            <option value="">Tous les programmes</option>{refs?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label style={{ position: 'relative' }}>
            <Search aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, opacity: 0.5 }} />
            <input className="input" style={{ paddingLeft: 32, width: 220 }} type="search" placeholder="Référence, nom, programme…" value={text} onChange={e => setText(e.target.value)} aria-label="Rechercher" />
          </label>
        </div>
        {can('chantiers:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouveau chantier</button>}
      </div>

      {pending.data?.length > 0 && (
        <Card title={`Étapes à déclarer (${pending.data.length})`} bodyClass="">
          <ul className="list">
            {pending.data.map(d => (
              <li key={d.id}>
                <button type="button" className="list-row btn-link" style={{ width: '100%' }} onClick={() => navigate(d.worksite_id ? `/chantiers/${d.worksite_id}?onglet=etapes&etape=${d.id}` : '/commercial/vefa')}>
                  <span><Flag className="ico" /><b>{d.stage_label}</b> — {d.scope_label}<div className="small muted">{d.project_name} · atteinte le {date(d.reached_on)}{d.reported_by_name ? ` · signalée par ${d.reported_by_name}` : ''}</div></span>
                  <span className="small">Déclarer ou refuser</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {situations.data?.length > 0 && (
        <Card title={`Situations de sous-traitants à valider (${situations.data.length})`} bodyClass="">
          <ul className="list">
            {situations.data.map(s => (
              <li key={s.id}>
                <button type="button" className="list-row btn-link" style={{ width: '100%' }} onClick={() => navigate(`/chantiers/${s.worksite_id}?onglet=sous-traitants`)}>
                  <span><b>{s.contract_reference} · situation n° {s.number}</b> — {s.supplier_name || s.contract_title}<div className="small muted">{s.worksite_reference} — {s.worksite_name} · arrêtée au {date(s.period_end)}</div></span>
                  <span className="small tabular">{fcfa(s.amount_ttc)} TTC</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {needs.data?.length > 0 && (
        <Card title={`Besoins en matériaux à valider (${needs.data.length})`} bodyClass="">
          <ul className="list">
            {needs.data.map(n => (
              <li key={n.id}>
                <button type="button" className="list-row btn-link" style={{ width: '100%' }} onClick={() => navigate(`/chantiers/${n.worksite_id}?onglet=besoins`)}>
                  <span><ShoppingCart className="ico" /><b>{n.label}</b> — {n.quantity.toLocaleString('fr-FR')} {n.unit_label}<div className="small muted">{n.worksite_reference} · demandé par {n.requested_by_name || '—'}{n.needed_on ? ` · souhaité le ${date(n.needed_on)}` : ''}</div></span>
                  <span className="small">Valider ou refuser</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !list.data.length ? (
          <div className="card-body"><Empty icon={HardHat}>Aucun chantier.{can('chantiers:write') ? ' Créez le premier avec « Nouveau chantier ».' : ''}</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Chantier</th><th>Programme et zone</th><th>Conducteur</th><th>Période prévue</th><th style={{ minWidth: 140 }}>Avancement</th><th className="right">Réel / budget</th></tr></thead>
            <tbody>{list.data.map(w => (
              <tr key={w.id} className="clickable" onClick={() => navigate(`/chantiers/${w.id}`)}>
                <td><b>{w.name}</b><div className="small muted tabular">{w.reference} · <Badge tone={WS_TONES[w.status]}>{w.status_label}</Badge></div></td>
                <td>{w.project_name}<div className="small muted">{w.zone_label}</div></td>
                <td className="small">{w.manager_name || <span className="muted">—</span>}</td>
                <td className="small nowrap">{w.planned_start ? `${date(w.planned_start)} → ${date(w.planned_end)}` : '—'}</td>
                <td><Advance value={w.progress_pct} />{w.late_phases > 0 && <div className="small" style={{ marginTop: 4 }}><Badge tone="danger">{w.late_phases} phase{w.late_phases > 1 ? 's' : ''} en retard</Badge></div>}</td>
                <td className="right tabular small">{fcfa(w.spent_fcfa)}<div className="muted">{w.budget_fcfa ? `sur ${fcfa(w.budget_fcfa)} · ${w.consumed_pct} %` : 'sans budget'}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      {creating && refs && <WorksiteForm refs={refs} onClose={() => setCreating(false)} onSaved={w => navigate(`/chantiers/${w.id}`)} />}
    </div>
  );
}

/** Création ou modification d'un chantier : programme (fixé après création), zone, conducteur, dates, phases de départ. */
export function WorksiteForm({ worksite: w, refs, onClose, onSaved }) {
  const saved = useSaved();
  const { can } = useAuth();
  const [f, setF] = useState({
    project_id: w?.project_id || '', name: w?.name || '', zone_kind: w?.zone_kind || 'programme', zone: w?.zone || [],
    manager_id: w?.manager_id || '', status: w?.status || 'preparation', planned_start: w?.planned_start || '', planned_end: w?.planned_end || '',
    actual_start: w?.actual_start || '', actual_end: w?.actual_end || '', description: w?.description || '',
    stages: w ? [] : refs.stages.map(s => s.key),
  });
  const prog = useResource(f.project_id ? `${CH}/programmes/${f.project_id}` : null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const toggle = (k, v) => setF(x => ({ ...x, [k]: x[k].some(y => String(y) === String(v)) ? x[k].filter(y => String(y) !== String(v)) : [...x[k], v] }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const data = body(f, ['project_id', 'manager_id']);
      data.zone = f.zone_kind === 'programme' ? [] : f.zone;
      if (w) { delete data.project_id; delete data.stages; }
      if (w && !can('chantiers:write')) delete data.manager_id; // le conducteur ne change pas de conducteur
      const res = w ? await api.patch(`${CH}/${w.id}`, data) : await api.post(CH, data);
      saved(w ? 'Chantier modifié' : `Chantier créé sous la référence ${res.reference}`);
      onSaved(res);
    } catch (err) { setError(err); setBusy(false); }
  };
  const P = prog.data;
  const choices = f.zone_kind === 'ilots' ? P?.ilots.map(i => ({ id: i, label: `Îlot ${i}` }))
    : f.zone_kind === 'batiments' ? P?.buildings.map(b => ({ id: b.id, label: b.name ? `${b.code} — ${b.name}` : b.code }))
      : f.zone_kind === 'lots' ? P?.lots.map(l => ({ id: l.id, label: l.ilot ? `${l.code} (îlot ${l.ilot})` : l.code })) : null;
  return (
    <Modal title={w ? `Modifier ${w.reference}` : 'Nouveau chantier'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="worksite-form" disabled={busy}><Check />Enregistrer</button></>}>
      <form id="worksite-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error || prog.error} /></div>
        <Field label="Programme" hint={w ? 'Un chantier ne change pas de programme' : 'Un programme peut avoir plusieurs chantiers (tranches, VRD, villas…)'}>
          <select className="select" required disabled={!!w} value={f.project_id} onChange={e => setF(x => ({ ...x, project_id: e.target.value, zone: [] }))}>
            <option value="">— Choisir —</option>{refs.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Nom du chantier"><input className="input" required minLength={2} maxLength={160} value={f.name} onChange={set('name')} placeholder="Tranche 1 — îlots A et B, VRD…" /></Field>
        <Field label="Zone couverte" hint="Lots concernés : leurs acquéreurs suivront l’avancement de ce chantier" className="full">
          <div className="seg" role="group" aria-label="Zone couverte">
            {Object.entries(refs.zones).map(([k, l]) => <button type="button" key={k} className={f.zone_kind === k ? 'active' : ''} onClick={() => setF(x => ({ ...x, zone_kind: k, zone: [] }))}>{l}</button>)}
          </div>
        </Field>
        {choices && (
          <div className="full">
            {!f.project_id ? <p className="small muted">Choisissez d’abord le programme.</p> : !P ? <Skeleton h={40} /> : !choices.length ? <p className="small muted">Ce programme n’a encore rien de ce type.</p> : (
              <div className="chip-pick" role="group" aria-label="Éléments de la zone">
                {choices.map(c => {
                  const on = f.zone.some(z => String(z) === String(c.id));
                  return <button type="button" key={c.id} className={`chip-opt ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle('zone', c.id)}>{c.label}</button>;
                })}
              </div>
            )}
          </div>
        )}
        <Field label="Conducteur de travaux" hint={can('chantiers:write') ? 'Reçoit la cloche et un e-mail ; il gère ce chantier' : 'Changé par un gestionnaire des chantiers'}>
          <select className="select" value={f.manager_id} disabled={w && !can('chantiers:write')} onChange={set('manager_id')}><option value="">—</option>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </Field>
        <Field label="Statut"><select className="select" value={f.status} onChange={set('status')}>{Object.entries(refs.statuses).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Début prévu"><input className="input" type="date" value={f.planned_start} onChange={set('planned_start')} /></Field>
        <Field label="Fin prévue"><input className="input" type="date" value={f.planned_end} onChange={set('planned_end')} /></Field>
        {w && <Field label="Début réel"><input className="input" type="date" value={f.actual_start} onChange={set('actual_start')} /></Field>}
        {w && <Field label="Fin réelle"><input className="input" type="date" value={f.actual_end} onChange={set('actual_end')} /></Field>}
        {!w && (
          <Field label="Phases de départ" hint="Étapes du journal de chantier ; vous pourrez en retirer, en ajouter et les dater" className="full">
            <div className="chip-pick" role="group" aria-label="Phases de départ">
              {refs.stages.map(s => { const on = f.stages.includes(s.key); return <button type="button" key={s.key} className={`chip-opt ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle('stages', s.key)}>{s.label}</button>; })}
            </div>
          </Field>
        )}
        <Field label="Description" className="full"><textarea className="textarea" rows={2} maxLength={4000} value={f.description} onChange={set('description')} /></Field>
      </form>
    </Modal>
  );
}
