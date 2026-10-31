/**
 * QHSE › Contrôles hebdomadaires : synthèse de la semaine d'un chantier (moyennes des contrôles journaliers, tendance sur la semaine
 * précédente, jours sans contrôle), observations du conducteur, soumission puis validation (direction des exploitations, RH, QHSE).
 * Une synthèse validée verrouille les contrôles journaliers de sa semaine.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, CalendarRange, ArrowLeft, Check, Send, X, Gauge, SprayCan, HardHat, Leaf } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Badge, Card, Empty, ErrorBox, Field, Skeleton } from '@admin/components/ui';
import { Kpi } from '../commercial/CommercialDashboard';
import { QH, useQhseRefs, RatingPicker, RatingBadge, PctBadge, Trend, PhotoBlock, CONTROL_TONES, frDay, fmt1 } from '../../lib/qhse';

export default function Weekly() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const refs = useQhseRefs();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('etat') || '');
  const list = useResource(`${QH}/controls?kind=hebdomadaire${status ? `&status=${status}` : ''}`);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ worksite_id: '', week: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (list.error) return <ErrorBox error={list.error} />;
  if (!refs || !list.data) return <Skeleton h={300} />;

  const create = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const c = await api.post(`${QH}/controls/weekly`, { worksite_id: Number(f.worksite_id), week: f.week || refs.week_start }); navigate(`/qhse/hebdomadaires/${c.id}`); } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <p className="muted" style={{ margin: 0 }}>Chaque semaine, le conducteur synthétise les contrôles journaliers de son chantier (moyennes, tendance, observations) ; la synthèse est validée par la direction des exploitations, les RH ou le QHSE.</p>
        {can('qhse:control') && <button className="btn btn-primary" onClick={() => setOpen(o => !o)}><Plus />Synthèse de la semaine</button>}
      </div>
      {open && (
        <Card title="Préparer la synthèse d’une semaine">
          <form className="form-grid" onSubmit={create}>
            <ErrorBox error={error} />
            <Field label="Chantier"><select className="select" required value={f.worksite_id} onChange={e => setF(v => ({ ...v, worksite_id: e.target.value }))}><option value="">Choisir…</option>{refs.worksites.filter(w => w.status !== 'clos').map(w => <option key={w.id} value={w.id}>{w.reference} · {w.name}</option>)}</select></Field>
            <Field label="Semaine contenant le" hint="La synthèse couvre du lundi au dimanche de cette semaine"><input className="input" type="date" max={refs.today} value={f.week || refs.week_start} onChange={e => setF(v => ({ ...v, week: e.target.value }))} /></Field>
            <div className="full row"><button className="btn btn-primary" disabled={busy}>Ouvrir la synthèse</button><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Annuler</button></div>
          </form>
        </Card>
      )}
      <div className="row" style={{ gap: 8 }}>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="État">
          <option value="">Tous les états</option><option value="brouillon">Brouillons</option><option value="a_valider">À valider</option><option value="valide">Validées</option>
        </select>
      </div>
      <Card title="Contrôles hebdomadaires" bodyClass="">
        {!list.data.length ? <div className="card-body"><Empty icon={CalendarRange}>Aucune synthèse hebdomadaire.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Semaine du</th><th>Chantier</th><th>Qualité</th><th>Hygiène</th><th>Sécurité</th><th>Environnement</th><th>État</th></tr></thead>
            <tbody>{list.data.map(c => (
              <tr key={c.id}>
                <td className="nowrap"><Link className="link" to={`/qhse/hebdomadaires/${c.id}`}><b>{frDay(c.period_start)}</b></Link></td>
                <td className="small">{c.worksite_reference} · {c.worksite_name}</td>
                <td><RatingBadge value={c.rating_qualite} labels={refs.ratings} /></td>
                <td><RatingBadge value={c.rating_hygiene} labels={refs.ratings} /></td>
                <td><PctBadge value={c.safety_pct} threshold={refs.settings.threshold} /></td>
                <td>{c.env_rate == null ? <span className="muted">—</span> : <PctBadge value={c.env_rate} threshold={80} />}</td>
                <td><Badge tone={CONTROL_TONES[c.status]}>{c.status_label}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

export function WeeklyPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const saved = useSaved();
  const refs = useQhseRefs();
  const res = useResource(`${QH}/controls/${id}`);
  const [f, setF] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = res.data;
  if (res.error) return <div className="stack"><BackLink /><ErrorBox error={res.error} /></div>;
  if (!d || !refs) return <Skeleton h={400} />;
  if (d.kind !== 'hebdomadaire') return <div className="stack"><BackLink /><ErrorBox error={new Error('Ce n’est pas un contrôle hebdomadaire.')} /></div>;
  const s = d.summary || {};
  const form = f || { rating_qualite: d.rating_qualite, rating_hygiene: d.rating_hygiene, remark_qualite: d.remark_qualite || '', remark_hygiene: d.remark_hygiene || '', remark_securite: d.remark_securite || '', remark_environnement: d.remark_environnement || '', observations: d.observations || '' };
  const set = patch => setF({ ...form, ...patch });
  const t = refs.settings.threshold;

  const call = async (fn, message) => {
    setBusy(true); setError(null);
    try { res.setData(await fn()); setF(null); setRejecting(false); saved(message); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const payload = () => ({ rating_qualite: form.rating_qualite, rating_hygiene: form.rating_hygiene, remark_qualite: form.remark_qualite || null, remark_hygiene: form.remark_hygiene || null, remark_securite: form.remark_securite || null, remark_environnement: form.remark_environnement || null, observations: form.observations || null });
  const save = () => call(() => api.patch(`${QH}/controls/${id}`, payload()), 'Synthèse enregistrée');
  const submit = () => call(async () => { await api.patch(`${QH}/controls/${id}`, payload()); return api.post(`${QH}/controls/${id}/submit`); }, 'Synthèse soumise à validation');
  const validate = () => call(() => api.post(`${QH}/controls/${id}/validate`), 'Synthèse validée');
  const reject = () => call(() => api.post(`${QH}/controls/${id}/reject`, { reason }), 'Synthèse refusée');

  return (
    <div className="stack">
      <BackLink />
      <ErrorBox error={error} />
      <Card>
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Semaine du {frDay(d.period_start)} au {frDay(s.week_end)}</h2>
            <div className="small muted" style={{ marginTop: 4 }}><Link className="link" to={`/chantiers/${d.worksite_id}?onglet=qhse`}>{d.worksite_reference} · {d.worksite_name}</Link> · {d.project_name} · conducteur {d.manager_name || '—'}</div>
          </div>
          <Badge tone={CONTROL_TONES[d.status]}>{d.status_label}</Badge>
        </div>
        {d.reject_reason && d.status === 'brouillon' && <div className="alert" role="alert" style={{ marginTop: 12 }}><b>Refusée :</b> {d.reject_reason}</div>}
      </Card>

      <div className="grid grid-4">
        <Kpi icon={Gauge} label="Qualité moyenne" count={s.qualite_avg == null ? null : Math.round(s.qualite_avg * 10)} format={v => fmt1(v / 10)} foot={<><Trend value={s.trend?.qualite} /> {s.qualite_avg != null && refs.ratings[Math.round(s.qualite_avg)]}</>} />
        <Kpi icon={SprayCan} label="Hygiène moyenne" count={s.hygiene_avg == null ? null : Math.round(s.hygiene_avg * 10)} format={v => fmt1(v / 10)} foot={<><Trend value={s.trend?.hygiene} /> {s.hygiene_avg != null && refs.ratings[Math.round(s.hygiene_avg)]}</>} />
        <Kpi icon={HardHat} label="Sécurité (ouvriers conformes)" count={s.safety_avg == null ? null : Math.round(s.safety_avg)} format={v => `${v} %`} tint={s.safety_avg != null && s.safety_avg < t ? 'amber' : undefined} foot={<><Trend value={s.trend?.safety} unit=" pt" /> {s.safety_min != null && `minimum ${s.safety_min} %`}</>} />
        <Kpi icon={Leaf} label="Environnement (conformité)" count={s.env_avg == null ? null : Math.round(s.env_avg)} format={v => `${v} %`} foot={<Trend value={s.trend?.env} unit=" pt" />} />
      </div>

      <div className="grid grid-2">
        <Card title="Contrôles de la semaine" actions={<span className="small muted">{s.days} / {s.expected_days} jour(s) ouvré(s) contrôlé(s)</span>} bodyClass="">
          {!d.daily?.length ? <div className="card-body"><p className="small muted" style={{ margin: 0 }}>Aucun contrôle journalier cette semaine.</p></div> : (
            <div className="table-wrap"><table className="table table-compact">
              <thead><tr><th>Jour</th><th>Qualité</th><th>Hygiène</th><th>Sécurité</th><th>Env.</th></tr></thead>
              <tbody>{d.daily.map(c => (
                <tr key={c.id}>
                  <td><Link className="link" to={`/qhse/controles/${c.id}`}>{frDay(c.day)}</Link></td>
                  <td><RatingBadge value={c.rating_qualite} labels={refs.ratings} /></td><td><RatingBadge value={c.rating_hygiene} labels={refs.ratings} /></td>
                  <td><PctBadge value={c.safety_pct} threshold={t} /></td><td>{c.env_rate == null ? '—' : `${c.env_rate} %`}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {s.missing_days?.length > 0 && <div className="card-body"><div className="small" style={{ color: 'var(--danger)' }}>Sans contrôle : {s.missing_days.map(frDay).join(', ')}</div></div>}
        </Card>
        <Card title="Points d’attention">
          <ul className="stack" style={{ gap: 8, margin: 0, paddingLeft: 18 }}>
            <li>{s.bad_ratings?.length ? <><b>{s.bad_ratings.length}</b> note(s) « Mauvais » : {s.bad_ratings.map(b => `${refs.pillars[b.pillar].label} le ${frDay(b.day)}`).join(' ; ')}</> : 'Aucune note « Mauvais ».'}</li>
            <li>{s.workers_non_compliant ? <><b>{s.workers_non_compliant}</b> présence(s) d’ouvrier sans respect des consignes de sécurité sur la semaine ({s.workers_compliant} / {s.workers_present}).</> : 'Aucun manquement de sécurité relevé chez les ouvriers.'}</li>
            <li>{s.open_actions ? <><b>{s.open_actions}</b> action(s) corrective(s) ouverte(s) sur ce chantier{s.late_actions ? <>, dont <b style={{ color: 'var(--danger)' }}>{s.late_actions} en retard</b></> : ''}.</> : 'Aucune action corrective ouverte.'}</li>
          </ul>
        </Card>
      </div>

      <Card title="Notes et observations de la semaine">
        <div className="stack" style={{ gap: 14 }}>
          <div className="grid grid-2">
            {['qualite', 'hygiene'].map(k => (
              <div key={k}>
                <div className="small muted" style={{ marginBottom: 6 }}>{refs.pillars[k].label}{s[`${k}_avg`] != null && ` — moyenne ${fmt1(s[`${k}_avg`])}`}</div>
                {d.editable
                  ? <RatingPicker labels={refs.ratings} value={form[`rating_${k}`]} name={`Note ${refs.pillars[k].label}`} onChange={v => set({ [`rating_${k}`]: v })} />
                  : <RatingBadge value={d[`rating_${k}`]} labels={refs.ratings} />}
              </div>
            ))}
          </div>
          {['qualite', 'hygiene', 'securite', 'environnement'].map(k => (d.editable
            ? <Field key={k} label={`Observations — ${refs.pillars[k].label}`}><textarea className="textarea" rows={2} maxLength={3000} value={form[`remark_${k}`]} onChange={e => set({ [`remark_${k}`]: e.target.value })} /></Field>
            : d[`remark_${k}`] && <div key={k}><div className="small muted">{refs.pillars[k].label}</div><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d[`remark_${k}`]}</p></div>))}
          {d.editable
            ? <Field label="Observations générales de la semaine"><textarea className="textarea" rows={3} maxLength={3000} value={form.observations} onChange={e => set({ observations: e.target.value })} /></Field>
            : d.observations && <div><div className="small muted">Observations générales</div><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.observations}</p></div>}
          <PhotoBlock kind="controle" id={d.id} files={d.files} writable={d.editable} onChange={files => res.setData(x => ({ ...x, files }))} />
        </div>
      </Card>

      {d.can_submit && (
        <div className="qhse-sticky">
          <button className="btn" disabled={busy} onClick={save}>Enregistrer le brouillon</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}><Send />Soumettre à validation</button>
        </div>
      )}
      {d.can_decide && (
        <Card title="Décision">
          {rejecting ? (
            <div className="stack" style={{ gap: 10 }}>
              <Field label="Motif du refus"><textarea className="textarea" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>
              <div className="row" style={{ gap: 8 }}><button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={reject}>Refuser</button><button className="btn btn-ghost" onClick={() => setRejecting(false)}>Retour</button></div>
            </div>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" disabled={busy} onClick={validate}><Check />Valider la synthèse</button>
              <button className="btn" disabled={busy} onClick={() => setRejecting(true)}><X />Refuser…</button>
              <span className="small muted">La validation verrouille les contrôles journaliers de la semaine.</span>
            </div>
          )}
        </Card>
      )}
      {d.status === 'valide' && <p className="small muted">Validée le {frDay(d.validated_at)}. {can('qhse:read') && 'Les contrôles journaliers de cette semaine ne se modifient plus.'}</p>}
    </div>
  );
}

const BackLink = () => <Link to="/qhse/hebdomadaires" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}><ArrowLeft />Contrôles hebdomadaires</Link>;
