import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Target, Star, CheckCheck, FolderOpen, Gauge, UserCheck, GraduationCap } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge, Drawer } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { GroupedBars, HighlightBars } from '@admin/components/ChartsPlus';
import { RH, useRhMeta, metricValue } from '../../lib/rh';
import PerformanceCurves from './PerformanceCurves';

const thisYear = new Date().getFullYear();
const Pct = ({ v }) => <div className="pct-bar"><div className="pct-track"><div style={{ width: `${v ?? 0}%`, background: v >= 100 ? 'var(--ok)' : v >= 50 ? 'var(--series-1)' : 'var(--warn)' }} /></div><span className="small tabular">{v == null ? '—' : `${v} %`}</span></div>;

/**
 * Performance et évaluations (référence : Odoo Évaluations) : tableau par service, puis objectifs pondérés et
 * entretien de chaque employé ou de l'équipe.
 */
export default function Reviews() {
  const [params, setParams] = useSearchParams();
  const [year, setYear] = useState(thisYear);
  const tab = params.get('onglet') || 'services';
  return (
    <div className="stack">
      <div className="row-between">
        <div className="tabs" role="tablist" style={{ marginBottom: 0, flex: 1 }}>
          {[['services', 'Performance par service'], ['courbes', 'Courbes par employé'], ['employes', 'Objectifs et entretiens']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setParams({ onglet: k })}>{l}</button>)}
        </div>
        {tab !== 'courbes' && <select className="select" style={{ width: 'auto' }} value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année">{[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}</option>)}</select>}
      </div>
      {tab === 'services' ? <Departments year={year} /> : tab === 'courbes' ? <TeamCurves /> : <Campaign year={year} />}
    </div>
  );
}

/** Courbes avec recherche : tout le personnel pour le service RH, l'équipe pour un responsable. */
function TeamCurves() {
  const { meta } = useRhMeta();
  const team = useResource(meta && !meta.employees.length ? `${RH}/objectives?year=${thisYear}` : null);
  const people = meta?.employees.length ? meta.employees : (team.data?.rows || []).map(r => ({ id: r.employee_id, matricule: r.matricule, last_name: r.name, first_name: '' }));
  if (!meta || (!meta.employees.length && !team.data)) return <Skeleton h={300} />;
  return <PerformanceCurves key={people.length} employees={people} />;
}

const Delta = ({ now, before }) => {
  if (now == null || before == null) return null;
  const d = now - before;
  return <span className={`trend ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`} title={`${before} % l’an dernier`}>{d > 0 ? '+' : ''}{d} pt{Math.abs(d) > 1 ? 's' : ''}</span>;
};

/** Tableau par service : score moyen, évolution, objectifs atteints / en retard, assiduité, classement des employés. */
function Departments({ year }) {
  const rep = useResource(`${RH}/performance?year=${year}`);
  const [open, setOpen] = useState(null);
  const [person, setPerson] = useState(null);
  if (rep.error) return <ErrorBox error={rep.error} />;
  if (!rep.data) return <Skeleton h={300} />;
  const { overall, departments } = rep.data;
  const scored = departments.filter(d => d.score != null);
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi tint-blue"><span className="kpi-label"><Gauge aria-hidden="true" />Performance moyenne</span><span className="kpi-value">{overall.score == null ? '—' : `${overall.score} %`}</span><span className="kpi-foot row" style={{ gap: 8 }}><Delta now={overall.score} before={overall.prev_score} />{overall.scored} employé(s) évalué(s) sur {overall.headcount}</span></div>
        <div className="card kpi tint-green"><span className="kpi-label"><CheckCheck aria-hidden="true" />Objectifs atteints</span><span className="kpi-value">{overall.achieved} / {overall.objectives}</span><span className="kpi-foot">{overall.late} en retard sur leur échéance</span></div>
        <div className="card kpi tint-violet"><span className="kpi-label"><UserCheck aria-hidden="true" />Taux de présence</span><span className="kpi-value">{overall.presence == null ? '—' : `${overall.presence.toLocaleString('fr-FR')} %`}</span><span className="kpi-foot">{overall.absences} j d’absence non planifiée</span></div>
        <div className="card kpi"><span className="kpi-label"><GraduationCap aria-hidden="true" />Formation</span><span className="kpi-value">{metricValue('heures', overall.formation_heures)}</span><span className="kpi-foot">suivies en {year}</span></div>
      </div>
      <div className="grid grid-2">
        <Card title="Score moyen par service">
          {scored.length ? <GroupedBars data={scored} labelOf={(d, long) => (long ? d.label : d.label.split(/[ /]/)[0])} format={v => `${Math.round(v)} %`} ariaLabel="Score moyen par service, cette année et l’an dernier"
            series={[{ key: 'score', label: String(year), color: 'var(--series-1)' }, { key: 'prev_score', label: String(year - 1), color: '#b9c2d0' }]} /> : <Empty icon={Target}>Fixez des objectifs pour voir les scores.</Empty>}
        </Card>
        <Card title="Taux de présence par service">
          <HighlightBars data={departments.filter(d => d.presence != null)} labelOf={d => d.label.split(/[ /]/)[0]} valueKey="presence" format={v => `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`} color="#1baf7a" />
        </Card>
      </div>
      <Card bodyClass="">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Service</th><th className="right">Effectif</th><th style={{ width: 200 }}>Score moyen</th><th>Évolution</th><th className="right">Objectifs atteints</th><th className="right">En retard</th><th className="right">Présence</th><th className="right">Formation</th></tr></thead>
          <tbody>{departments.map(d => (
            <Fragment key={d.key}>
              <tr className="clickable" onClick={() => setOpen(open === d.key ? null : d.key)} aria-expanded={open === d.key}>
                <td><b>{d.label}</b></td><td className="right tabular">{d.headcount}</td>
                <td>{d.score == null ? <span className="small muted">aucun objectif</span> : <Pct v={d.score} />}</td>
                <td><Delta now={d.score} before={d.prev_score} /></td>
                <td className="right tabular">{d.achieved} / {d.objectives}</td>
                <td className="right tabular" style={{ color: d.late ? 'var(--warn)' : undefined }}>{d.late}</td>
                <td className="right tabular">{d.presence == null ? '—' : `${d.presence.toLocaleString('fr-FR')} %`}</td>
                <td className="right tabular">{metricValue('heures', d.formation_heures)}</td>
              </tr>
              {open === d.key && d.employees.map((e, i) => (
                <tr key={e.employee_id} className="sub-row clickable" onClick={() => setPerson(e)}>
                  <td><span className="rank">{e.score == null ? '–' : i + 1}</span>{e.name}<div className="small muted">{e.job_title}</div></td>
                  <td />
                  <td>{e.score == null ? <span className="small muted">à fixer</span> : <Pct v={e.score} />}</td>
                  <td><Delta now={e.score} before={e.prev_score} /></td>
                  <td className="right tabular">{e.achieved} / {e.objectives}</td>
                  <td className="right tabular" style={{ color: e.late ? 'var(--warn)' : undefined }}>{e.late}</td>
                  <td className="right tabular">{e.presence == null ? '—' : `${e.presence.toLocaleString('fr-FR')} %`}</td>
                  <td className="right tabular">{metricValue('heures', e.formation_heures)}</td>
                </tr>
              ))}
            </Fragment>
          ))}</tbody>
        </table></div>
        <p className="card-body small muted" style={{ borderTop: '1px solid var(--border)' }}>Score = moyenne des objectifs pondérée par leur poids ; les indicateurs chiffrés (ventes, chantier, SAV, assiduité, formation) se calculent seuls à partir des données de l’ERP. Présence = jours ouvrables moins les absences non planifiées ({rep.data.unplanned.join(', ').toLowerCase()}). Cliquez un service pour le classement de ses employés.</p>
      </Card>
      {person && (
        <Drawer title={person.name} onClose={() => setPerson(null)}>
          <Indicators employeeId={person.employee_id} year={year} />
          <div style={{ marginTop: 16 }}><ObjectivesPanel employee={{ id: person.employee_id }} year={year} /></div>
        </Drawer>
      )}
    </div>
  );
}

/** Indicateurs de l'année d'un employé, par famille (ceux de son service et ceux où il a des résultats). */
export function Indicators({ employeeId, year = thisYear }) {
  const ind = useResource(`${RH}/employees/${employeeId}/indicators?year=${year}`);
  if (ind.error) return <ErrorBox error={ind.error} />;
  if (!ind.data) return <Skeleton h={140} />;
  const d = ind.data;
  return (
    <Card title={`Indicateurs ${year}`} actions={d.score != null && <span className="row small" style={{ gap: 8 }}>Performance <b style={{ fontSize: 18 }}>{d.score} %</b></span>}>
      <p className="small muted" style={{ marginBottom: 12 }}>{d.objectives ? `${d.achieved} objectif(s) atteint(s) sur ${d.objectives}${d.late ? ` · ${d.late} en retard` : ''}.` : 'Aucun objectif fixé pour l’année.'} Valeurs calculées depuis l’ERP et le dashboard, servant de base aux objectifs chiffrés.</p>
      <div className="indicator-groups">
        {d.groups.map(g => (
          <div key={g.group}>
            <h3 className="erp-h3">{g.group}</h3>
            {g.items.map(i => (
              <div key={i.key} className="kv"><span>{i.label}</span><b className="tabular">{i.value == null ? <span className="muted" title={i.needs === 'user' ? 'Fiche non reliée à un compte du dashboard' : i.needs === 'project' ? 'Employé non affecté à un programme' : 'Pas de donnée'}>—</span> : metricValue(i.unit, i.value)}</b></div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Campaign({ year }) {
  const { meta } = useRhMeta();
  const [open, setOpen] = useState(null);
  const list = useResource(`${RH}/objectives?year=${year}`);
  const rows = list.data?.rows || [];
  const done = rows.filter(r => r.review?.status === 'finalise').length;
  return (
    <div className="stack">
      {list.data && <span className="small muted">{rows.length} employé(s) · {done} entretien(s) finalisé(s) · {rows.filter(r => r.objectives.length).length} avec objectifs</span>}
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !rows.length ? <div className="card-body"><Empty icon={Target}>Aucun employé dans votre périmètre.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Employé</th><th className="right">Objectifs</th><th style={{ width: 220 }}>Atteinte pondérée</th><th>Entretien {year}</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.employee_id} className="clickable" onClick={() => setOpen(r)}>
                <td><b>{r.name}</b><div className="small muted">{r.job_title} · {meta?.departments[r.department]}</div></td>
                <td className="right tabular">{r.objectives.length}</td>
                <td>{r.objectives.length ? <Pct v={r.score} /> : <span className="small muted">à fixer</span>}</td>
                <td>{r.review?.status === 'finalise' ? <Badge tone="ok">Finalisé · {meta?.ratings[r.review.rating]}</Badge> : r.review ? <Badge tone="warn">En cours</Badge> : <span className="small muted">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {open && (
        <Drawer title={open.name} onClose={() => { setOpen(null); list.reload(); }}>
          <ObjectivesPanel employee={{ id: open.employee_id }} year={year} />
          <p style={{ marginTop: 12 }}><Link className="link small" to={`/rh/personnel/${open.employee_id}`}><FolderOpen className="ico" />Ouvrir le dossier</Link></p>
        </Drawer>
      )}
    </div>
  );
}

/** Objectifs et entretien d'un employé pour une année (dossier, campagne). */
export function ObjectivesPanel({ employee, year: initialYear = thisYear }) {
  const { meta } = useRhMeta();
  const { can } = useAuth();
  const toast = useToast();
  const [year, setYear] = useState(initialYear);
  const file = useResource(`${RH}/employees/${employee.id}?year=${year}`);
  const [adding, setAdding] = useState(false);
  if (!file.data) return <Skeleton h={200} />;
  const coach = can('evaluation:write') || file.data.access === 'manager';
  const { objectives } = file.data;
  const review = file.data.reviews.find(r => r.year === year) || null;
  const weight = objectives.reduce((t, o) => t + o.weight, 0);
  const score = weight ? Math.round(objectives.reduce((t, o) => t + o.progress * o.weight, 0) / weight) : null;
  const patch = async (o, data) => { try { await api.patch(`${RH}/objectives/${o.id}`, data); file.reload(); } catch (e) { toast(e.message, 'err'); } };
  const del = async o => { if (!window.confirm(`Supprimer « ${o.title} » ?`)) return; try { await api.del(`${RH}/objectives/${o.id}`); file.reload(); } catch (e) { toast(e.message, 'err'); } };

  return (
    <div className="stack">
      <Card title={`Objectifs ${year}`} actions={<div className="row" style={{ gap: 8 }}>
        <select className="select" style={{ width: 'auto' }} value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année">{[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}</option>)}</select>
        {coach && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Plus />Objectif</button>}
      </div>}>
        {!objectives.length ? <Empty icon={Target}>Aucun objectif pour {year}.</Empty> : (
          <ul className="stack" style={{ gap: 14, listStyle: 'none' }}>
            {objectives.map(o => (
              <li key={o.id} className="erp-panel">
                <div className="row-between">
                  <span><b>{o.title}</b> <span className="small muted">· poids {o.weight}{o.due_date ? ` · échéance ${date(o.due_date)}` : ''}</span></span>
                  {coach && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => del(o)} aria-label="Supprimer"><Trash2 /></button>}
                </div>
                {o.description && <p className="small muted prewrap">{o.description}</p>}
                {o.auto ? (
                  <p className="small">{meta?.objective_metrics[o.metric]?.label} : <b className="tabular">{metricValue(o.unit, o.actual)}</b> pour une cible de {metricValue(o.unit, o.target_value)}{meta?.objective_metrics[o.metric]?.lower ? ' au plus' : ''} <span className="muted">(calculé depuis l’ERP)</span></p>
                ) : coach ? (
                  <label className="row small" style={{ gap: 8 }}>Avancement <input type="range" min="0" max="100" step="5" defaultValue={o.progress} onMouseUp={e => patch(o, { progress: Number(e.target.value) })} onKeyUp={e => patch(o, { progress: Number(e.target.value) })} style={{ flex: 1 }} aria-label="Avancement" /></label>
                ) : null}
                <div className="row-between" style={{ gap: 10 }}>
                  <div style={{ flex: 1 }}><Pct v={o.progress} /></div>
                  {coach ? (
                    <select className="select" style={{ width: 'auto' }} value={o.status} onChange={e => patch(o, { status: e.target.value })} aria-label="Statut">{meta && Object.entries(meta.objective_statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  ) : <Badge>{meta?.objective_statuses[o.status]}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {score != null && <p className="small" style={{ marginTop: 12 }}>Atteinte pondérée : <b>{score} %</b></p>}
      </Card>
      <ReviewForm key={`${year}-${review?.id || 0}-${review?.status}`} employeeId={employee.id} year={year} review={review} coach={coach} onSaved={file.reload} />
      {adding && <ObjectiveForm employeeId={employee.id} year={year} hasAccount={!!file.data.employee.user_id} hasProject={!!file.data.employee.project_id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); file.reload(); }} />}
    </div>
  );
}

function ObjectiveForm({ employeeId, year, hasAccount, hasProject, onClose, onSaved }) {
  const { meta } = useRhMeta();
  const [f, setF] = useState({ title: '', description: '', metric: 'manuel', target_value: '', weight: 1, due_date: `${year}-12-31` });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault();
    try {
      await api.post(`${RH}/employees/${employeeId}/objectives`, { ...f, year, weight: Number(f.weight), target_value: f.target_value === '' ? null : Number(f.target_value), description: f.description || null, due_date: f.due_date || null });
      onSaved();
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={`Nouvel objectif ${year}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="obj">Ajouter</button></>}>
      <form id="obj" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Objectif" className="full"><input className="input" required minLength={3} value={f.title} onChange={set('title')} autoFocus placeholder="Livrer les 20 villas de la phase 2 à temps, vendre 12 lots…" /></Field>
        <Field label="Précisions" className="full"><textarea className="textarea" rows={2} value={f.description} onChange={set('description')} /></Field>
        <Field label="Mesure" className="full" hint={[!hasAccount && 'fiche non reliée à un compte : indicateurs commerciaux, SAV et réserves indisponibles', !hasProject && 'aucune affectation : avancement de chantier indisponible'].filter(Boolean).join(' · ') || 'Les indicateurs chiffrés se calculent seuls depuis l’ERP'}>
          <select className="select" value={f.metric} onChange={set('metric')}>
            {meta && Object.entries(Object.entries(meta.objective_metrics).filter(([, m]) => !m.needs || (m.needs === 'user' ? hasAccount : hasProject)).reduce((g, [k, m]) => ({ ...g, [m.group]: [...(g[m.group] || []), [k, m]] }), {}))
              .map(([group, list]) => <optgroup key={group} label={group}>{list.map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</optgroup>)}
          </select>
        </Field>
        {f.metric !== 'manuel' && <Field label={`Cible ${meta?.objective_metrics[f.metric]?.lower ? '(au plus)' : ''} — ${({ fcfa: 'FCFA', pct: '%', heures: 'heures', jours: 'jours', note: 'sur 5' })[meta?.objective_metrics[f.metric]?.unit] || 'nombre'}`}><input className="input" type="number" min="0" required value={f.target_value} onChange={set('target_value')} /></Field>}
        <Field label="Poids (1 à 10)"><input className="input" type="number" min="1" max="10" value={f.weight} onChange={set('weight')} /></Field>
        <Field label="Échéance"><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></Field>
      </form>
    </Modal>
  );
}

function ReviewForm({ employeeId, year, review, coach, onSaved }) {
  const { meta } = useRhMeta();
  const toast = useToast();
  const saved = useSaved();
  const [f, setF] = useState({ rating: review?.rating || '', manager_comment: review?.manager_comment || '', strengths: review?.strengths || '', improvements: review?.improvements || '', training_needs: review?.training_needs || '' });
  const locked = review?.status === 'finalise';
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async finalize => {
    if (finalize && !window.confirm('Finaliser l’entretien ? Il ne pourra plus être modifié.')) return;
    try {
      await api.put(`${RH}/employees/${employeeId}/reviews/${year}`, { ...f, rating: f.rating ? Number(f.rating) : null, finalize });
      saved(finalize ? 'Entretien finalisé et ajouté au dossier' : 'Entretien enregistré'); onSaved();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title={`Entretien annuel ${year}`} actions={locked && <Badge tone="ok">Finalisé le {date(review.finalized_at)}</Badge>}>
      <h3 className="erp-h3">Auto-évaluation de l’employé</h3>
      <p className="small prewrap" style={{ marginBottom: 14 }}>{review?.self_comment || <span className="muted">Pas encore rédigée (Mon espace).</span>}</p>
      {!coach && !locked ? <p className="small muted">L’entretien est mené par le responsable direct.</p> : (
        <div className="form-grid">
          <Field label="Appréciation globale" className="full">
            <span className="stars-input-sm" role="radiogroup" aria-label="Appréciation">
              {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" disabled={locked} className={n <= Number(f.rating) ? 'on' : ''} onClick={() => setF(x => ({ ...x, rating: n }))} title={meta?.ratings[n]} aria-label={meta?.ratings[n]}><Star /></button>)}
              <span className="small muted" style={{ marginLeft: 8 }}>{meta?.ratings[f.rating] || ''}</span>
            </span>
          </Field>
          <Field label="Points forts"><textarea className="textarea" rows={2} disabled={locked} value={f.strengths} onChange={set('strengths')} /></Field>
          <Field label="Axes de progrès"><textarea className="textarea" rows={2} disabled={locked} value={f.improvements} onChange={set('improvements')} /></Field>
          <Field label="Besoins de formation" className="full" hint="Repris dans le plan de formation (Compétences et formations)"><textarea className="textarea" rows={2} disabled={locked} value={f.training_needs} onChange={set('training_needs')} /></Field>
          <Field label="Commentaire du responsable" className="full"><textarea className="textarea" rows={3} disabled={locked} value={f.manager_comment} onChange={set('manager_comment')} /></Field>
          {!locked && <div className="full row" style={{ gap: 8 }}><button className="btn" onClick={() => save(false)}>Enregistrer</button><button className="btn btn-primary" onClick={() => save(true)}><CheckCheck />Finaliser l’entretien</button></div>}
        </div>
      )}
    </Card>
  );
}
