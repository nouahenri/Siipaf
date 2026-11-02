/**
 * QHSE › Contrôles journaliers : liste, formulaire de contrôle rapide (utilisable sur téléphone : gros boutons Mauvais / Passable /
 * Bon / Très bon, photos) et fiche d'un contrôle. Quatre volets : Qualité et Hygiène (notes), Sécurité (ouvriers respectant les
 * consignes en %, proposés depuis les pointages du jour, et points de contrôle du chantier), Environnement (points conformes).
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, ClipboardCheck, Pencil, Users, AlertTriangle, Trash2, Info } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { usePersistentState } from '@admin/lib/navigation';
import { Badge, Card, Empty, ErrorBox, Field, Skeleton } from '@admin/components/ui';
import {
  QH, useQhseRefs, RatingPicker, RatingBadge, PctBadge, Checklist, itemsState, itemsPayload, meanOf, conformityOf, PendingPhotos, uploadFiles, PhotoBlock,
  CONTROL_TONES, ACTION_TONES, frDay,
} from '../../lib/qhse';
import { ActionForm } from './Actions';

export default function Controls() {
  const { can } = useAuth();
  const refs = useQhseRefs();
  const [worksite, setWorksite] = usePersistentState('chantier', ''); // filtres gardés au retour d'un contrôle
  const [from, setFrom] = usePersistentState('depuis', '');
  const list = useResource(`${QH}/controls?kind=journalier${worksite ? `&worksite_id=${worksite}` : ''}${from ? `&from=${from}` : ''}`);
  if (list.error) return <ErrorBox error={list.error} />;
  if (!refs || !list.data) return <Skeleton h={300} />;
  const t = refs.settings.threshold;

  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <p className="muted" style={{ margin: 0 }}>Un contrôle par chantier et par jour : qualité, hygiène, sécurité (en %) et environnement. Le conducteur saisit ceux de ses chantiers.</p>
        {can('qhse:control') && <Link to="/qhse/controles/nouveau" className="btn btn-primary"><Plus />Contrôle du jour</Link>}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="select" style={{ width: 'auto' }} value={worksite} onChange={e => setWorksite(e.target.value)} aria-label="Chantier">
          <option value="">Tous les chantiers</option>{refs.worksites.map(w => <option key={w.id} value={w.id}>{w.reference} · {w.name}</option>)}
        </select>
        <label className="row small" style={{ gap: 6 }}>Depuis le<input className="input" type="date" max={refs.today} value={from} onChange={e => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
      </div>
      <Card title="Contrôles journaliers" bodyClass="">
        {!list.data.length ? <div className="card-body"><Empty icon={ClipboardCheck}>Aucun contrôle journalier.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Jour</th><th>Chantier</th><th>Qualité</th><th>Hygiène</th><th>Sécurité</th><th>Environnement</th><th>Saisi par</th></tr></thead>
            <tbody>{list.data.map(c => (
              <tr key={c.id}>
                <td className="nowrap"><Link className="link" to={`/qhse/controles/${c.id}`}><b>{frDay(c.period_start)}</b></Link></td>
                <td className="small">{c.worksite_reference} · {c.worksite_name}</td>
                <td><RatingBadge value={c.rating_qualite} labels={refs.ratings} /></td>
                <td><RatingBadge value={c.rating_hygiene} labels={refs.ratings} /></td>
                <td><PctBadge value={c.safety_pct} threshold={t} /> <span className="small muted">{c.workers_present != null ? `${c.workers_compliant}/${c.workers_present}` : ''}</span></td>
                <td>{c.env_rate == null ? <span className="muted">—</span> : <PctBadge value={c.env_rate} threshold={80} />}</td>
                <td className="small">{c.created_by_name || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

// ─── Page : nouveau contrôle, ou fiche d'un contrôle ──────────────────────

export function ControlPage() {
  const { id } = useParams();
  const refs = useQhseRefs();
  if (!refs) return <Skeleton h={400} />;
  return id === 'nouveau' ? <ControlForm refs={refs} /> : <ControlView id={Number(id)} refs={refs} />;
}

function ControlForm({ refs, initial = null, onDone }) {
  const navigate = useNavigate();
  const toast = useToast();
  const saved = useSaved();
  const [params] = useSearchParams();
  const mine = refs.worksites.filter(w => w.status !== 'clos');
  const [worksite, setWorksite] = useState(initial ? String(initial.worksite_id) : params.get('chantier') || (mine.length === 1 ? String(mine[0].id) : ''));
  const [day, setDay] = useState(initial ? initial.period_start : refs.today);
  const [ratings, setRatings] = useState({ qualite: initial?.rating_qualite ?? null, hygiene: initial?.rating_hygiene ?? null });
  const [items, setItems] = useState(() => itemsState(initial?.items));
  const [present, setPresent] = useState(initial?.workers_present ?? '');
  const [compliant, setCompliant] = useState(initial?.workers_compliant ?? '');
  const [touched, setTouched] = useState(!!initial);
  const [workers, setWorkers] = useState(() => (initial?.workers || []).map(w => ({ employee_id: w.employee_id || '', name: w.name, issue: w.issue || '' })));
  const [remarks, setRemarks] = useState({ qualite: initial?.remark_qualite || '', hygiene: initial?.remark_hygiene || '', securite: initial?.remark_securite || '', environnement: initial?.remark_environnement || '' });
  const [observations, setObservations] = useState(initial?.observations || '');
  const [photos, setPhotos] = useState([]);
  const [att, setAtt] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(() => ({ qualite: !!initial?.items?.some(i => i.pillar === 'qualite'), hygiene: !!initial?.items?.some(i => i.pillar === 'hygiene') }));

  // Effectif du jour d'après les pointages du chantier
  useEffect(() => {
    if (!worksite || !day) { setAtt(null); return; }
    let live = true;
    api.get(`${QH}/worksites/${worksite}/attendance?day=${day}`).then(a => {
      if (!live) return;
      setAtt(a);
      if (!touched && a.present) setPresent(a.present);
    }).catch(() => live && setAtt(null));
    return () => { live = false; };
  }, [worksite, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = present === '' ? null : Number(present);
  const c = compliant === '' ? null : Number(compliant);
  const pct = p > 0 && c != null ? Math.round((Math.min(c, p) / p) * 100) : null;
  const missing = p != null && c != null ? Math.max(0, p - c) : 0;
  const proposedQ = meanOf(items, 'qualite');
  const proposedH = meanOf(items, 'hygiene');
  const sitePct = conformityOf(items, 'securite');
  const envPct = conformityOf(items, 'environnement');
  const w = refs.worksites.find(x => String(x.id) === String(worksite));

  const save = async e => {
    e.preventDefault(); setError(null);
    if (!worksite) return setError(new Error('Choisissez le chantier.'));
    if (!ratings.qualite && !proposedQ) return setError(new Error('Indiquez la note de la qualité.'));
    if (!ratings.hygiene && !proposedH) return setError(new Error('Indiquez la note de l’hygiène.'));
    if (p == null || c == null) return setError(new Error('Indiquez le nombre d’ouvriers présents et celui des ouvriers qui respectent la sécurité.'));
    if (c > p) return setError(new Error('Les ouvriers respectant la sécurité ne peuvent pas dépasser les ouvriers présents.'));
    setBusy(true);
    try {
      const out = await api.post(`${QH}/controls/daily`, {
        worksite_id: Number(worksite), day, rating_qualite: ratings.qualite, rating_hygiene: ratings.hygiene, workers_present: p, workers_compliant: c,
        workers: workers.filter(x => x.employee_id || x.name.trim()).map(x => ({ employee_id: x.employee_id ? Number(x.employee_id) : null, name: x.name.trim() || null, issue: x.issue.trim() || null })).slice(0, missing),
        items: itemsPayload(items), remark_qualite: remarks.qualite || null, remark_hygiene: remarks.hygiene || null, remark_securite: remarks.securite || null,
        remark_environnement: remarks.environnement || null, observations: observations || null,
      });
      if (photos.length) { try { await uploadFiles('controle', out.id, photos); } catch (err) { toast(`Contrôle enregistré, mais les photos n’ont pas été envoyées : ${err.message}`, 'err'); } }
      saved('Contrôle enregistré');
      if (onDone) onDone(out.id); else navigate(`/qhse/controles/${out.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  const poolEmployees = att?.employees || [];
  const setWorker = (i, patch) => setWorkers(list => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <form className="stack" onSubmit={save}>
      <ErrorBox error={error} />
      <Card title={initial ? 'Corriger le contrôle' : 'Contrôle du jour'}>
        <div className="form-grid">
          <Field label="Chantier">
            <select className="select" required value={worksite} onChange={e => setWorksite(e.target.value)} disabled={!!initial}>
              <option value="">Choisir…</option>{mine.map(x => <option key={x.id} value={x.id}>{x.reference} · {x.name}</option>)}
            </select>
          </Field>
          <Field label="Jour"><input className="input" type="date" required max={refs.today} value={day} onChange={e => setDay(e.target.value)} disabled={!!initial} /></Field>
        </div>
        {att?.control_id && !initial && (
          <div className="callout-erp" style={{ marginTop: 12 }}><Info aria-hidden="true" /><span className="small">Un contrôle existe déjà pour ce jour : <Link className="link" to={`/qhse/controles/${att.control_id}`}>l’ouvrir pour le corriger</Link>. L’enregistrer ici le remplacerait.</span></div>
        )}
      </Card>

      {['qualite', 'hygiene'].map(k => {
        const proposed = k === 'qualite' ? proposedQ : proposedH;
        return (
          <Card key={k} title={refs.pillars[k].label} actions={<span className="small muted">{refs.pillars[k].hint}</span>}>
            <div className="qhse-pillar">
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>Note globale</div>
                <RatingPicker labels={refs.ratings} value={ratings[k]} name={`Note ${refs.pillars[k].label}`} onChange={v => setRatings(r => ({ ...r, [k]: v }))} />
                {!ratings[k] && proposed && <p className="small muted" style={{ margin: '6px 0 0' }}>Note proposée d’après les points notés : <b>{refs.ratings[proposed]}</b> (enregistrée si vous n’en choisissez pas).</p>}
              </div>
              <div>
                <button type="button" className="btn btn-sm" onClick={() => setDetail(d => ({ ...d, [k]: !d[k] }))} aria-expanded={detail[k]}>{detail[k] ? 'Masquer' : 'Noter'} les points de contrôle</button>
                {detail[k] && <div style={{ marginTop: 8 }}><Checklist pillar={k} refs={refs} state={items} setState={setItems} /></div>}
              </div>
              <Field label="Remarques"><textarea className="textarea" rows={2} maxLength={2000} value={remarks[k]} onChange={e => setRemarks(r => ({ ...r, [k]: e.target.value }))} /></Field>
            </div>
          </Card>
        );
      })}

      <Card title="Sécurité" actions={<span className="small muted">{refs.pillars.securite.hint}</span>}>
        <div className="qhse-pillar">
          <div className="form-grid">
            <Field label="Ouvriers présents" hint={att ? `${att.present} pointé(s) ce jour sur ce chantier (Ressources humaines › Présences) — modifiable` : 'Choisissez le chantier pour voir les pointages du jour'}>
              <input className="input" type="number" inputMode="numeric" min={0} max={5000} required value={present} onChange={e => { setTouched(true); setPresent(e.target.value); }} />
            </Field>
            <Field label="Ouvriers qui respectent la sécurité" hint="Équipements de protection, consignes, comportement">
              <input className="input" type="number" inputMode="numeric" min={0} max={5000} required value={compliant} onChange={e => setCompliant(e.target.value)} />
            </Field>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="qhse-pct tabular">{pct == null ? '—' : `${pct} %`}</span>
            <span className="small muted">des ouvriers respectent la sécurité{pct != null && pct < refs.settings.threshold ? ` — sous le seuil de ${refs.settings.threshold} % : le conducteur et la direction seront prévenus` : ''}</span>
          </div>
          {missing > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="small"><b>Nommer les {missing} ouvrier(s) concerné(s)</b> <span className="muted">(facultatif ; visible sur leur fiche employé comme remarque sécurité)</span></div>
              {workers.map((x, i) => (
                <div key={i} className="qhse-worker-row">
                  <div className="stack" style={{ gap: 4 }}>
                    <select className="select" value={x.employee_id} onChange={e => setWorker(i, { employee_id: e.target.value })} aria-label="Ouvrier pointé">
                      <option value="">Autre ouvrier (nom ci-dessous)</option>{poolEmployees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                    </select>
                    {!x.employee_id && <input className="input" placeholder="Nom de l’ouvrier" maxLength={160} value={x.name} onChange={e => setWorker(i, { name: e.target.value })} />}
                  </div>
                  <input className="input" placeholder="Ce qui n’était pas respecté (casque, harnais…)" maxLength={300} value={x.issue} onChange={e => setWorker(i, { issue: e.target.value })} />
                  <button type="button" className="btn btn-ghost btn-icon" onClick={() => setWorkers(list => list.filter((_, j) => j !== i))} aria-label="Retirer"><Trash2 /></button>
                </div>
              ))}
              {workers.length < missing && <div><button type="button" className="btn btn-sm" onClick={() => setWorkers(list => [...list, { employee_id: '', name: '', issue: '' }])}><Users />Nommer un ouvrier</button></div>}
            </div>
          )}
          <div>
            <button type="button" className="btn btn-sm" onClick={() => setDetail(d => ({ ...d, securite: !d.securite }))} aria-expanded={!!detail.securite}>{detail.securite ? 'Masquer' : 'Contrôler'} la sécurité du chantier (balisage, échafaudages, extincteurs…)</button>
            {sitePct != null && <span className="small muted"> · conformité {sitePct} %</span>}
            {detail.securite && <div style={{ marginTop: 8 }}><Checklist pillar="securite" refs={refs} state={items} setState={setItems} /></div>}
          </div>
          <Field label="Remarques"><textarea className="textarea" rows={2} maxLength={2000} value={remarks.securite} onChange={e => setRemarks(r => ({ ...r, securite: e.target.value }))} /></Field>
        </div>
      </Card>

      <Card title="Environnement" actions={<span className="small muted">{refs.pillars.environnement.hint}</span>}>
        <div className="qhse-pillar">
          <div>
            <button type="button" className="btn btn-sm" onClick={() => setDetail(d => ({ ...d, environnement: !d.environnement }))} aria-expanded={!!detail.environnement}>{detail.environnement ? 'Masquer' : 'Contrôler'} les points environnementaux</button>
            {envPct != null && <span className="small muted"> · conformité {envPct} %</span>}
            {detail.environnement && <div style={{ marginTop: 8 }}><Checklist pillar="environnement" refs={refs} state={items} setState={setItems} /></div>}
          </div>
          <Field label="Remarques"><textarea className="textarea" rows={2} maxLength={2000} value={remarks.environnement} onChange={e => setRemarks(r => ({ ...r, environnement: e.target.value }))} /></Field>
        </div>
      </Card>

      <Card title="Photos et observations">
        <div className="stack" style={{ gap: 12 }}>
          {initial ? <p className="small muted" style={{ margin: 0 }}>Les photos se gèrent sur la fiche du contrôle (ajout et retrait immédiats).</p> : <PendingPhotos files={photos} setFiles={setPhotos} />}
          <Field label="Observations générales"><textarea className="textarea" rows={2} maxLength={2000} value={observations} onChange={e => setObservations(e.target.value)} /></Field>
        </div>
      </Card>

      <div className="qhse-sticky">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : initial ? 'Enregistrer les corrections' : 'Enregistrer le contrôle'}</button>
        {initial && <button type="button" className="btn btn-ghost" onClick={() => onDone(null)}>Annuler</button>}
        {w && <span className="small muted" style={{ alignSelf: 'center' }}>{w.reference} · {frDay(day)}</span>}
      </div>
    </form>
  );
}

// ─── Fiche d'un contrôle ──────────────────────────────────────────────────

function PillarItems({ items, pillar, refs }) {
  const rows = items.filter(i => i.pillar === pillar);
  if (!rows.length) return null;
  const note = refs.pillars[pillar].scale === 'note';
  return (
    <div className="table-wrap"><table className="table table-compact">
      <tbody>{rows.map(i => (
        <tr key={i.id}>
          <td>{i.label}{i.remark && <div className="small muted">{i.remark}</div>}</td>
          <td className="right nowrap">{note ? <RatingBadge value={i.rating} labels={refs.ratings} /> : <Badge tone={i.answer === 'conforme' ? 'ok' : i.answer === 'non_conforme' ? 'danger' : ''}>{i.answer_label}</Badge>}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function ControlView({ id, refs }) {
  const { can } = useAuth();
  const res = useResource(`${QH}/controls/${id}`);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState(false);
  const navigate = useNavigate();
  const d = res.data;
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d) return <Skeleton h={400} />;
  if (d.kind === 'hebdomadaire') return <Navigate to={`/qhse/hebdomadaires/${id}`} replace />;
  if (editing) return <ControlForm refs={refs} initial={d} onDone={async () => { setEditing(false); await res.reload(); }} />;
  const t = refs.settings.threshold;
  const bad = d.rating_qualite === 1 || d.rating_hygiene === 1 || (d.safety_pct != null && d.safety_pct < t);

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
        <div className="row" style={{ gap: 8 }}>
          {can('qhse:actions') && <button className="btn" onClick={() => setAction(true)}><AlertTriangle />Ouvrir une action corrective</button>}
          {d.editable && <button className="btn btn-primary" onClick={() => setEditing(true)}><Pencil />Corriger</button>}
        </div>
      </div>
      <Card>
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Contrôle du {frDay(d.period_start)}</h2>
            <div className="small muted" style={{ marginTop: 4 }}><Link className="link" to={`/chantiers/${d.worksite_id}?onglet=qhse`}>{d.worksite_reference} · {d.worksite_name}</Link> · {d.project_name} · saisi par {d.created_by_name || '—'}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>{bad && <Badge tone="danger">À corriger</Badge>}{d.locked && <Badge>Semaine validée</Badge>}<Badge tone={CONTROL_TONES[d.status]}>{d.status_label}</Badge></div>
        </div>
      </Card>

      <div className="grid grid-2">
        {['qualite', 'hygiene'].map(k => (
          <Card key={k} title={refs.pillars[k].label} actions={<RatingBadge value={d[`rating_${k}`]} labels={refs.ratings} />} bodyClass="">
            <div className="card-body stack" style={{ gap: 8 }}>
              <PillarItems items={d.items} pillar={k} refs={refs} />
              {d[`remark_${k}`] ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d[`remark_${k}`]}</p> : <p className="small muted" style={{ margin: 0 }}>Pas de remarque.</p>}
            </div>
          </Card>
        ))}
        <Card title="Sécurité" actions={<PctBadge value={d.safety_pct} threshold={t} />} bodyClass="">
          <div className="card-body stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 10 }}><span className="qhse-pct tabular">{d.safety_pct == null ? '—' : `${d.safety_pct} %`}</span><span className="small muted">{d.workers_compliant} ouvrier(s) sur {d.workers_present} respectent les consignes</span></div>
            {d.workers.length > 0 && (
              <ul className="list">{d.workers.map(x => (
                <li key={x.id} className="list-row"><span>{x.employee_id && can('qhse:all') ? <Link className="link" to={`/rh/personnel/${x.employee_id}`}>{x.name}</Link> : x.name}</span><span className="small muted">{x.issue || 'Consignes non respectées'}</span></li>
              ))}</ul>
            )}
            {d.site_safety_pct != null && <div className="small">Sécurité du chantier : <PctBadge value={d.site_safety_pct} threshold={t} /></div>}
            <PillarItems items={d.items} pillar="securite" refs={refs} />
            {d.remark_securite && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.remark_securite}</p>}
          </div>
        </Card>
        <Card title="Environnement" actions={d.env_rate == null ? null : <PctBadge value={d.env_rate} threshold={80} />} bodyClass="">
          <div className="card-body stack" style={{ gap: 8 }}>
            {d.env_rate == null && !d.items.some(i => i.pillar === 'environnement') ? <p className="small muted" style={{ margin: 0 }}>Aucun point environnemental contrôlé.</p> : <PillarItems items={d.items} pillar="environnement" refs={refs} />}
            {d.remark_environnement && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.remark_environnement}</p>}
          </div>
        </Card>
      </div>

      {d.observations && <Card title="Observations"><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.observations}</p></Card>}
      <Card title="Photos"><PhotoBlock kind="controle" id={d.id} files={d.files} writable={d.editable} onChange={files => res.setData(x => ({ ...x, files }))} /></Card>
      <Card title="Actions correctives liées" bodyClass="">
        {!d.actions.length ? <div className="card-body"><p className="small muted" style={{ margin: 0 }}>Aucune action ouverte pour ce contrôle.</p></div> : (
          <ul className="list">{d.actions.map(a => <li key={a.id}><Link className="list-row" to={`/qhse/actions?fiche=${a.id}`}><span><b>{a.title}</b><span className="small muted"> · {a.reference}</span></span><span className="small nowrap">échéance {frDay(a.due_on)} <Badge tone={ACTION_TONES[a.status]}>{refs.action_statuses[a.status]}</Badge></span></Link></li>)}</ul>
        )}
      </Card>
      {action && (
        <ActionForm refs={refs} context={`Rattachée au contrôle du ${frDay(d.period_start)} — ${d.worksite_reference} ${d.worksite_name}`}
          defaults={{ worksite_id: d.worksite_id, control_id: d.id, gravity: bad ? 'majeure' : 'mineure', pillar: d.rating_qualite === 1 ? 'qualite' : d.rating_hygiene === 1 ? 'hygiene' : d.safety_pct != null && d.safety_pct < t ? 'securite' : '' }}
          onClose={() => setAction(false)} onSaved={a => { setAction(false); navigate(`/qhse/actions?fiche=${a.id}`); }} />
      )}
    </div>
  );
}
