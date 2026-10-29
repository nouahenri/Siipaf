import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Target, Star, CheckCheck, FolderOpen, Gauge, UserCheck, GraduationCap, Pencil, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge, Drawer } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { GroupedBars, HighlightBars } from '@admin/components/ChartsPlus';
import { RH, useRhMeta, metricValue } from '../../lib/rh';
import PeriodPicker, { MONTHS, thisYear, yearPeriod, periodQuery, periodName } from '../../components/PeriodPicker';
import PerformanceCurves from './PerformanceCurves';
import KpiReferential from './KpiReferential';

/** Barre d'atteinte : vert à partir du seuil d'atteinte de l'indicateur, orange sous son seuil d'alerte. */
export const Pct = ({ v, ok = 100, warn = 50 }) => (
  <div className="pct-bar"><div className="pct-track"><div style={{ '--p': Math.min(100, v ?? 0) / 100, background: v >= ok ? 'var(--ok)' : v >= warn ? 'var(--series-1)' : 'var(--warn)' }} /></div><span className="small tabular">{v == null ? '—' : `${v} %`}</span></div>
);
const UNITS = { fcfa: 'FCFA', pct: '%', heures: 'heures', jours: 'jours', note: 'sur 5' };

/**
 * Performance et évaluations (référence : Odoo Évaluations) : tableau par service avec ses objectifs collectifs, courbes,
 * objectifs pondérés et entretien de chaque employé ou de l'équipe, référentiel des indicateurs et modèles d'objectifs.
 * Toutes les vues se filtrent par année, trimestre ou mois.
 */
export default function Reviews() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState(yearPeriod());
  const tab = params.get('onglet') || 'services';
  const tabs = [['services', 'Performance par service'], ['courbes', 'Courbes par employé'], ['employes', 'Objectifs et entretiens']];
  if (can('kpi:write') || can('rh:read')) tabs.push(['referentiel', 'Référentiel KPI']);
  return (
    <div className="stack">
      <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setParams({ onglet: k })}>{l}</button>)}
      </div>
      {['services', 'employes'].includes(tab) && <PeriodPicker value={period} onChange={setPeriod} />}
      {tab === 'services' ? <Departments period={period} /> : tab === 'courbes' ? <TeamCurves /> : tab === 'referentiel' ? <KpiReferential /> : <Campaign period={period} />}
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
  return <span className={`trend ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`} title={`${before} % un an plus tôt`}>{d > 0 ? '+' : ''}{d} pt{Math.abs(d) > 1 ? 's' : ''}</span>;
};

/** Tableau par service : score (objectifs collectifs et employés), évolution, objectifs, assiduité, classement des employés. */
function Departments({ period }) {
  const { can } = useAuth();
  const rep = useResource(`${RH}/performance${periodQuery(period)}`);
  const [open, setOpen] = useState(null);
  const [person, setPerson] = useState(null);
  if (rep.error) return <ErrorBox error={rep.error} />;
  if (!rep.data) return <Skeleton h={300} />;
  const { overall, departments, collective_pct: share } = rep.data;
  const scored = departments.filter(d => d.score != null);
  const name = periodName(period);
  const team = !can('rh:read'); // vue d'un responsable : son équipe, sans objectifs collectifs
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi tint-blue"><span className="kpi-label"><Gauge aria-hidden="true" />Performance moyenne</span><span className="kpi-value">{overall.score == null ? '—' : `${overall.score} %`}</span><span className="kpi-foot row" style={{ gap: 8 }}><Delta now={overall.score} before={overall.prev_score} />{overall.scored} employé(s) évalué(s) sur {overall.headcount}</span></div>
        <div className="card kpi tint-green"><span className="kpi-label"><CheckCheck aria-hidden="true" />Objectifs atteints</span><span className="kpi-value">{overall.achieved} / {overall.objectives}</span><span className="kpi-foot">{overall.late} en retard sur leur échéance</span></div>
        <div className="card kpi tint-violet"><span className="kpi-label"><UserCheck aria-hidden="true" />Taux de présence</span><span className="kpi-value">{overall.presence == null ? '—' : `${overall.presence.toLocaleString('fr-FR')} %`}</span><span className="kpi-foot">{overall.absences} j d’absence non planifiée</span></div>
        <div className="card kpi"><span className="kpi-label"><GraduationCap aria-hidden="true" />Formation</span><span className="kpi-value">{metricValue('heures', overall.formation_heures)}</span><span className="kpi-foot">suivies · {name}</span></div>
      </div>
      <div className="grid grid-2">
        <Card title="Score par service">
          {scored.length ? <GroupedBars data={scored} labelOf={(d, long) => (long ? d.label : d.label.split(/[ /]/)[0])} format={v => `${Math.round(v)} %`} ariaLabel={`Score par service, ${name} et un an plus tôt`}
            series={[{ key: 'score', label: name, color: 'var(--series-1)' }, { key: 'prev_score', label: periodName({ ...period, annee: period.annee - 1 }), color: '#b9c2d0' }]} /> : <Empty icon={Target}>Fixez des objectifs pour voir les scores.</Empty>}
        </Card>
        <Card title="Taux de présence par service">
          <HighlightBars data={departments.filter(d => d.presence != null)} labelOf={d => d.label.split(/[ /]/)[0]} valueKey="presence" format={v => `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`} color="#1baf7a" />
        </Card>
      </div>
      <Card bodyClass="">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Service</th><th className="right">Effectif</th><th style={{ width: 200 }}>Score</th><th>Évolution</th><th className="right">Objectifs atteints</th><th className="right">En retard</th><th className="right">Présence</th><th className="right">Formation</th></tr></thead>
          <tbody>{departments.map(d => (
            <Fragment key={d.key}>
              <tr className="clickable" onClick={() => setOpen(open === d.key ? null : d.key)} aria-expanded={open === d.key}>
                <td><b>{d.label}</b>{d.collective.length > 0 && <div className="small muted">{d.collective.length} objectif(s) du service</div>}</td>
                <td className="right tabular">{d.headcount}</td>
                <td title={d.collective_score != null && d.employees_score != null ? `${share} % objectifs du service (${d.collective_score} %) + ${100 - share} % employés (${d.employees_score} %)` : undefined}>{d.score == null ? <span className="small muted">aucun objectif</span> : <Pct v={d.score} />}</td>
                <td><Delta now={d.score} before={d.prev_score} /></td>
                <td className="right tabular">{d.achieved} / {d.objectives}</td>
                <td className="right tabular" style={{ color: d.late ? 'var(--warn)' : undefined }}>{d.late}</td>
                <td className="right tabular">{d.presence == null ? '—' : `${d.presence.toLocaleString('fr-FR')} %`}</td>
                <td className="right tabular">{metricValue('heures', d.formation_heures)}</td>
              </tr>
              {open === d.key && !team && (
                <tr className="sub-row"><td colSpan={8}><ServicePanel dept={d} share={share} period={period} onChange={rep.reload} /></td></tr>
              )}
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
        <p className="card-body small muted" style={{ borderTop: '1px solid var(--border)' }}>
          Score d’un employé = moyenne de ses objectifs pondérée par leur poids ; les objectifs mensuels ou trimestriels d’un même indicateur comptent comme une ligne (cibles et réalisés additionnés, ou moyenne pour un taux). {team ? '' : `Score d’un service = ${share} % ses objectifs collectifs + ${100 - share} % la moyenne de ses employés (réglable dans Référentiel KPI) ; sans objectif collectif, la moyenne des employés. `}Les indicateurs chiffrés se calculent seuls depuis l’ERP. Présence = jours ouvrables moins les absences non planifiées ({rep.data.unplanned.join(', ').toLowerCase()}). Cliquez un service pour {team ? 'le classement de ses employés' : 'ses objectifs collectifs, ses indicateurs et le classement de ses employés'}.
        </p>
      </Card>
      {person && (
        <Drawer title={person.name} onClose={() => setPerson(null)}>
          <Indicators employeeId={person.employee_id} period={period} />
          <div style={{ marginTop: 16 }}><ObjectivesPanel employee={{ id: person.employee_id }} period={period} /></div>
        </Drawer>
      )}
    </div>
  );
}

/** Objectifs collectifs d'un service et indicateurs mesurés sur le service entier. */
function ServicePanel({ dept, share, period, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const write = can('kpi:write');
  const del = async o => {
    if (!window.confirm(`Supprimer l’objectif du service « ${o.title} » ?`)) return;
    try { await api.del(`${RH}/department-objectives/${o.id}`); onChange(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack" style={{ gap: 12, padding: '4px 0 8px' }}>
      <div className="row-between">
        <h3 className="erp-h3" style={{ margin: 0 }}><Users size={15} aria-hidden="true" /> Objectifs collectifs — {dept.label}</h3>
        {write && <button className="btn btn-sm" onClick={() => setForm({ department: dept.key })}><Plus />Objectif du service</button>}
      </div>
      {dept.collective_score != null && dept.employees_score != null && (
        <p className="small muted" style={{ margin: 0 }}>Score {dept.score} % = {share} % objectifs du service ({dept.collective_score} %) + {100 - share} % employés ({dept.employees_score} %).</p>
      )}
      {!dept.collective.length ? <p className="small muted" style={{ margin: 0 }}>Aucun objectif collectif sur la période : le score du service est la moyenne de ses employés.</p> : (
        <ul className="stack" style={{ gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
          {dept.collective.map(o => (
            <li key={o.id} className="erp-panel">
              <div className="row-between">
                <span><b>{o.title}</b> <span className="small muted">· {o.period_label} · poids {o.weight}</span></span>
                {write && <span className="row" style={{ gap: 4 }}>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setForm(o)} aria-label={`Modifier ${o.title}`}><Pencil /></button>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => del(o)} aria-label={`Supprimer ${o.title}`}><Trash2 /></button>
                </span>}
              </div>
              {o.auto && <p className="small">{o.kpi_name || o.title} : <b className="tabular">{metricValue(o.unit, o.actual)}</b> pour une cible de {metricValue(o.unit, o.target)}{o.lower ? ' au plus' : ''} <span className="muted">(calculé sur le service)</span></p>}
              <Pct v={o.progress} ok={o.ok_pct} warn={o.warn_pct} />
            </li>
          ))}
        </ul>
      )}
      {dept.service_indicators.length > 0 && (
        <div>
          <h3 className="erp-h3">Indicateurs du service · {periodName(period)}</h3>
          {dept.service_indicators.map(i => <div key={i.key} className="kv"><span>{i.label}</span><b className="tabular">{i.value == null ? <span className="muted" title="Rien de mesurable sur la période">—</span> : metricValue(i.unit, i.value)}</b></div>)}
        </div>
      )}
      {form && <CollectiveForm objective={form} period={period} onClose={() => setForm(null)} onSaved={() => { setForm(null); onChange(); }} />}
    </div>
  );
}

/** Indicateurs du référentiel proposés pour un niveau (employé ou service), actifs, rangés par famille. */
function useKpis(level) {
  const res = useResource(`${RH}/kpis`);
  const list = (res.data?.kpis || []).filter(k => k.active && (level === 'service' ? k.level !== 'individuel' : k.level !== 'service'));
  const families = list.reduce((g, k) => ({ ...g, [k.family]: [...(g[k.family] || []), k] }), {});
  return { kpis: list, families, loaded: !!res.data };
}

/** Découpage et numéro de la période d'un objectif. */
function PeriodFields({ f, setF }) {
  return (
    <>
      <Field label="Période">
        <select className="select" value={f.period} onChange={e => setF(x => ({ ...x, period: e.target.value, period_index: e.target.value === 'annee' ? '' : x.period_index || 1 }))}>
          <option value="annee">Toute l’année</option><option value="trimestre">Un trimestre</option><option value="mois">Un mois</option>
        </select>
      </Field>
      {f.period !== 'annee' ? (
        <Field label={f.period === 'mois' ? 'Mois' : 'Trimestre'}>
          <select className="select" value={f.period_index} onChange={e => setF(x => ({ ...x, period_index: Number(e.target.value) }))}>
            {f.period === 'mois' ? MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>) : [1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 1 ? '1er' : `${n}e`} trimestre</option>)}
          </select>
        </Field>
      ) : <div />}
    </>
  );
}

/** Création ou modification d'un objectif collectif d'un service. */
function CollectiveForm({ objective, period, onClose, onSaved }) {
  const { meta } = useRhMeta();
  const { kpis, families } = useKpis('service');
  const editing = !!objective.id;
  const [f, setF] = useState(editing
    ? { kpi_id: objective.kpi_id || '', title: objective.title, description: objective.description || '', period: objective.period, period_index: objective.period_index || '', target_value: objective.target_value ?? '', weight: objective.weight, progress: objective.progress, status: objective.status, due_date: objective.due_date || '' }
    : { kpi_id: '', title: '', description: '', period: period.periode, period_index: period.n || '', target_value: '', weight: 1, progress: 0, status: 'en_cours', due_date: '' });
  const [error, setError] = useState(null);
  const k = kpis.find(x => x.id === Number(f.kpi_id));
  const set = key => e => setF(x => ({ ...x, [key]: e.target.value }));
  const save = async e => {
    e.preventDefault();
    const body = {
      kpi_id: f.kpi_id ? Number(f.kpi_id) : null, title: f.title, description: f.description || null, period: f.period, period_index: f.period === 'annee' ? null : Number(f.period_index),
      target_value: k?.auto && f.target_value !== '' ? Number(f.target_value) : null, weight: Number(f.weight), due_date: f.due_date || null,
      ...(k?.auto ? {} : { progress: Number(f.progress) }), ...(editing ? { status: f.status } : { department: objective.department, year: period.annee }),
    };
    try {
      if (editing) await api.patch(`${RH}/department-objectives/${objective.id}`, body);
      else await api.post(`${RH}/department-objectives`, body);
      onSaved();
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={editing ? 'Objectif du service' : `Nouvel objectif du service — ${meta?.departments[objective.department] || ''}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="colobj">{editing ? 'Enregistrer' : 'Ajouter'}</button></>}>
      <form id="colobj" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Indicateur" className="full" hint={k?.auto ? (k.service_only ? 'Mesuré sur le service entier' : 'Somme ou moyenne des employés du service') : 'Avancement saisi à la main'}>
          <select className="select" value={f.kpi_id} onChange={e => { const n = kpis.find(x => x.id === Number(e.target.value)); setF(x => ({ ...x, kpi_id: e.target.value, title: x.title || n?.name || '' })); }}>
            <option value="">Objectif libre (suivi manuel)</option>
            {Object.entries(families).map(([fam, list]) => <optgroup key={fam} label={fam}>{list.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
          </select>
        </Field>
        <Field label="Objectif" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} placeholder="Clôturer chaque mois avant le 10, régler les fournisseurs à l’échéance…" /></Field>
        <PeriodFields f={f} setF={setF} />
        {k?.auto ? <Field label={`Cible${k.lower ? ' (au plus)' : ''} — ${UNITS[k.unit] || 'nombre'}`}><input className="input" type="number" min="0" required value={f.target_value} onChange={set('target_value')} /></Field>
          : <Field label="Avancement (%)"><input className="input" type="number" min="0" max="100" value={f.progress} onChange={set('progress')} /></Field>}
        <Field label="Poids (1 à 10)"><input className="input" type="number" min="1" max="10" value={f.weight} onChange={set('weight')} /></Field>
        <Field label="Échéance" hint="Fin de la période si vide"><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        {editing && <Field label="Statut"><select className="select" value={f.status} onChange={set('status')}>{meta && Object.entries(meta.objective_statuses).map(([key, v]) => <option key={key} value={key}>{v}</option>)}</select></Field>}
        <Field label="Précisions" className="full"><textarea className="textarea" rows={2} value={f.description} onChange={set('description')} /></Field>
      </form>
    </Modal>
  );
}

/** Indicateurs d'un employé sur la période, par famille (ceux de son service et ceux où il a des résultats). */
export function Indicators({ employeeId, period = yearPeriod() }) {
  const ind = useResource(`${RH}/employees/${employeeId}/indicators${periodQuery(period)}`);
  if (ind.error) return <ErrorBox error={ind.error} />;
  if (!ind.data) return <Skeleton h={140} />;
  const d = ind.data;
  return (
    <Card title={`Indicateurs · ${periodName(period)}`} actions={d.score != null && <span className="row small" style={{ gap: 8 }}>Performance <b style={{ fontSize: 18 }}>{d.score} %</b></span>}>
      <p className="small muted" style={{ marginBottom: 12 }}>{d.objectives ? `${d.achieved} objectif(s) atteint(s) sur ${d.objectives}${d.late ? ` · ${d.late} en retard` : ''}.` : 'Aucun objectif fixé sur la période.'} Valeurs calculées depuis l’ERP et le dashboard, servant de base aux objectifs chiffrés.</p>
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

function Campaign({ period }) {
  const { meta } = useRhMeta();
  const [open, setOpen] = useState(null);
  const list = useResource(`${RH}/objectives${periodQuery(period)}`);
  const rows = list.data?.rows || [];
  const done = rows.filter(r => r.review?.status === 'finalise').length;
  return (
    <div className="stack">
      {list.data && <span className="small muted">{rows.length} employé(s) · {done} entretien(s) {period.annee} finalisé(s) · {rows.filter(r => r.objectives.length).length} avec objectifs sur la période</span>}
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !rows.length ? <div className="card-body"><Empty icon={Target}>Aucun employé dans votre périmètre.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Employé</th><th className="right">Objectifs</th><th style={{ width: 220 }}>Atteinte pondérée</th><th>Entretien {period.annee}</th></tr></thead>
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
          <ObjectivesPanel employee={{ id: open.employee_id }} period={period} />
          <p style={{ marginTop: 12 }}><Link className="link small" to={`/rh/personnel/${open.employee_id}`}><FolderOpen className="ico" />Ouvrir le dossier</Link></p>
        </Drawer>
      )}
    </div>
  );
}

/** Objectifs d'un employé sur une période (dossier, campagne) et entretien de l'année. */
export function ObjectivesPanel({ employee, period: initial = yearPeriod() }) {
  const { meta } = useRhMeta();
  const { can } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(initial);
  const card = useResource(`${RH}/employees/${employee.id}/objectives${periodQuery(period)}`);
  const file = useResource(`${RH}/employees/${employee.id}?year=${period.annee}`);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);
  if (card.error) return <ErrorBox error={card.error} />;
  if (!card.data || !file.data) return <Skeleton h={200} />;
  const coach = can('evaluation:write') || card.data.access === 'manager';
  const { lines, objectives, score } = card.data;
  const review = file.data.reviews.find(r => r.year === period.annee) || null;
  const byId = Object.fromEntries(objectives.map(o => [o.id, o]));
  const reload = () => { card.reload(); file.reload(); };
  const patch = async (o, data) => { try { await api.patch(`${RH}/objectives/${o.id}`, data); reload(); } catch (e) { toast(e.message, 'err'); } };
  const del = async o => { if (!window.confirm(`Supprimer « ${o.title} » ?`)) return; try { await api.del(`${RH}/objectives/${o.id}`); reload(); } catch (e) { toast(e.message, 'err'); } };
  const abandoned = objectives.filter(o => o.status === 'abandonne');

  return (
    <div className="stack">
      <Card title={`Objectifs · ${periodName(period)}`} actions={coach && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Plus />Objectif</button>}>
        <div style={{ marginBottom: 12 }}><PeriodPicker value={period} onChange={setPeriod} /></div>
        {!lines.length && !abandoned.length ? <Empty icon={Target}>Aucun objectif sur la période.</Empty> : (
          <ul className="stack" style={{ gap: 14, listStyle: 'none' }}>
            {lines.map(l => {
              const single = l.count === 1 ? byId[l.ids[0]] : null;
              return (
                <li key={l.key} className="erp-panel">
                  <div className="row-between">
                    <span><b>{l.title}</b> <span className="small muted">· poids {l.weight}{single ? `${single.title.toLowerCase().includes(single.period_label) ? '' : ` · ${single.period_label}`}${single.due_date ? ` · échéance ${date(single.due_date)}` : ''}` : ''}</span>
                      {single?.source === 'modele' && <> <Badge tone={single.adjusted ? 'warn' : ''}>{single.adjusted ? 'Modèle ajusté' : 'Modèle'}</Badge></>}
                      {single?.source === 'commercial' && <> <Badge>Commercial › Objectifs</Badge></>}</span>
                    {coach && single && <span className="row" style={{ gap: 4 }}>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing(single)} aria-label={`Modifier ${single.title}`}><Pencil /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => del(single)} aria-label={`Supprimer ${single.title}`}><Trash2 /></button>
                    </span>}
                  </div>
                  {single?.description && <p className="small muted prewrap">{single.description}</p>}
                  {l.auto ? (
                    <p className="small">{l.label} : <b className="tabular">{metricValue(l.unit, l.actual)}</b> pour une cible de {metricValue(l.unit, l.target)}{l.lower ? ' au plus' : ''} <span className="muted">(calculé depuis l’ERP{l.count > 1 ? `, ${l.count} périodes` : ''})</span></p>
                  ) : coach && single ? (
                    <label className="row small" style={{ gap: 8 }}>Avancement <input type="range" min="0" max="100" step="5" defaultValue={single.progress} onMouseUp={e => patch(single, { progress: Number(e.target.value) })} onKeyUp={e => patch(single, { progress: Number(e.target.value) })} style={{ flex: 1 }} aria-label="Avancement" /></label>
                  ) : null}
                  <div className="row-between" style={{ gap: 10 }}>
                    <div style={{ flex: 1 }}><Pct v={l.progress} ok={l.ok_pct} warn={l.warn_pct} /></div>
                    {single && (coach ? (
                      <select className="select" style={{ width: 'auto' }} value={single.status} onChange={e => patch(single, { status: e.target.value })} aria-label="Statut">{meta && Object.entries(meta.objective_statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    ) : <Badge>{meta?.objective_statuses[single.status]}</Badge>)}
                  </div>
                  {l.count > 1 && (
                    <>
                      <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setOpen(open === l.key ? null : l.key)} aria-expanded={open === l.key}>
                        {open === l.key ? <ChevronDown /> : <ChevronRight />}Détail des {l.count} objectifs
                      </button>
                      {open === l.key && (
                        <div className="table-wrap"><table className="table table-compact">
                          <thead><tr><th>Période</th><th className="right">Cible</th><th className="right">Réalisé</th><th style={{ width: 150 }}>Atteinte</th><th /></tr></thead>
                          <tbody>{l.ids.map(id => byId[id]).map(o => (
                            <tr key={o.id}>
                              <td style={{ textTransform: 'capitalize' }}>{o.period_label}{o.adjusted && <span className="small muted"> · ajusté</span>}</td>
                              <td className="right tabular">{metricValue(o.unit, o.target)}</td>
                              <td className="right tabular">{metricValue(o.unit, o.actual)}</td>
                              <td><Pct v={o.progress} ok={o.ok_pct} warn={o.warn_pct} /></td>
                              <td className="right">{coach && <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing(o)} aria-label={`Modifier ${o.title}`}><Pencil /></button>
                                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => del(o)} aria-label={`Supprimer ${o.title}`}><Trash2 /></button>
                              </span>}</td>
                            </tr>
                          ))}</tbody>
                        </table></div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {abandoned.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="small muted" style={{ margin: '0 0 6px' }}>Abandonné(s), hors du score{coach ? ' — changez le statut pour reprendre un objectif' : ''} :</p>
            <ul className="stack" style={{ gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
              {abandoned.map(o => (
                <li key={o.id} className="row-between small" style={{ gap: 8 }}><span>{o.title} <span className="muted">· {o.period_label}</span></span>
                  {coach ? <select className="select" style={{ width: 'auto' }} value={o.status} onChange={e => patch(o, { status: e.target.value })} aria-label={`Statut de ${o.title}`}>{meta && Object.entries(meta.objective_statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : <Badge>{meta?.objective_statuses[o.status]}</Badge>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {score != null && <p className="small" style={{ marginTop: 12 }}>Atteinte pondérée : <b>{score} %</b></p>}
      </Card>
      <ReviewForm key={`${period.annee}-${review?.id || 0}-${review?.status}`} employeeId={employee.id} year={period.annee} review={review} coach={coach} onSaved={reload} />
      {adding && <ObjectiveForm employeeId={employee.id} period={period} hasAccount={card.data.has_account} hasProject={card.data.has_project} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      {editing && <ObjectiveEdit objective={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

/** Nouvel objectif d'un employé : indicateur du référentiel (ou objectif libre), période, cible et poids. */
function ObjectiveForm({ employeeId, period, hasAccount, hasProject, onClose, onSaved }) {
  const { families, kpis, loaded } = useKpis('individuel');
  const [f, setF] = useState({ kpi_id: '', title: '', description: '', period: period.periode, period_index: period.n || '', target_value: '', weight: 1, due_date: '' });
  const [error, setError] = useState(null);
  const k = kpis.find(x => x.id === Number(f.kpi_id));
  const set = key => e => setF(x => ({ ...x, [key]: e.target.value }));
  const usable = x => !x.needs || (x.needs === 'user' ? hasAccount : hasProject);
  const save = async e => {
    e.preventDefault();
    try {
      await api.post(`${RH}/employees/${employeeId}/objectives`, {
        year: period.annee, title: f.title, description: f.description || null, kpi_id: f.kpi_id ? Number(f.kpi_id) : null, period: f.period,
        period_index: f.period === 'annee' ? null : Number(f.period_index), weight: Number(f.weight), target_value: k?.auto && f.target_value !== '' ? Number(f.target_value) : null, due_date: f.due_date || null,
      });
      onSaved();
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={`Nouvel objectif ${period.annee}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="obj">Ajouter</button></>}>
      <form id="obj" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Indicateur" className="full" hint={[!hasAccount && 'fiche non reliée à un compte : indicateurs commerciaux, SAV, comptables, juridiques et administratifs indisponibles', !hasProject && 'aucune affectation : avancement de chantier indisponible'].filter(Boolean).join(' · ') || 'Les indicateurs chiffrés se calculent seuls depuis l’ERP (Référentiel KPI)'}>
          <select className="select" value={f.kpi_id} disabled={!loaded} onChange={e => { const n = kpis.find(x => x.id === Number(e.target.value)); setF(x => ({ ...x, kpi_id: e.target.value, title: x.title || n?.name || '' })); }}>
            <option value="">Objectif libre (suivi manuel)</option>
            {Object.entries(families).map(([fam, list]) => <optgroup key={fam} label={fam}>{list.map(x => <option key={x.id} value={x.id} disabled={!usable(x)}>{x.name}</option>)}</optgroup>)}
          </select>
        </Field>
        <Field label="Objectif" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} autoFocus placeholder="Livrer les 20 villas de la phase 2 à temps, vendre 12 lots…" /></Field>
        <Field label="Précisions" className="full"><textarea className="textarea" rows={2} value={f.description} onChange={set('description')} /></Field>
        <PeriodFields f={f} setF={setF} />
        {k?.auto && <Field label={`Cible de la période${k.lower ? ' (au plus)' : ''} — ${UNITS[k.unit] || 'nombre'}`}><input className="input" type="number" min="0" required value={f.target_value} onChange={set('target_value')} /></Field>}
        <Field label="Poids (1 à 10)"><input className="input" type="number" min="1" max="10" value={f.weight} onChange={set('weight')} /></Field>
        <Field label="Échéance" hint="Fin de la période si vide"><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></Field>
      </form>
    </Modal>
  );
}

/** Ajustement d'un objectif : intitulé, cible, poids, échéance (un objectif d'un modèle ajusté n'est plus repris par le modèle). */
function ObjectiveEdit({ objective: o, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ title: o.title, description: o.description || '', target_value: o.target_value ?? '', weight: o.weight, due_date: o.due_date || '' });
  const [error, setError] = useState(null);
  const set = key => e => setF(x => ({ ...x, [key]: e.target.value }));
  const save = async e => {
    e.preventDefault();
    try {
      await api.patch(`${RH}/objectives/${o.id}`, { title: f.title, description: f.description || null, weight: Number(f.weight), due_date: f.due_date || null, ...(o.auto ? { target_value: Number(f.target_value) } : {}) });
      saved('Objectif enregistré'); onSaved();
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={`Objectif — ${o.period_label}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="objedit">Enregistrer</button></>}>
      <form id="objedit" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        {o.source === 'modele' && <p className="full small muted" style={{ margin: 0 }}>Objectif créé par un modèle : si vous changez sa cible ou son poids, il ne sera plus mis à jour quand le modèle sera réappliqué.</p>}
        {o.source === 'commercial' && <p className="full small muted" style={{ margin: 0 }}>Cible fixée dans Commercial › Objectifs : la modifier ici la change aussi là-bas.</p>}
        <Field label="Objectif" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} /></Field>
        {o.auto && <Field label={`Cible${o.lower ? ' (au plus)' : ''} — ${UNITS[o.unit] || 'nombre'}`}><input className="input" type="number" min="0" required value={f.target_value} onChange={set('target_value')} /></Field>}
        <Field label="Poids (1 à 10)"><input className="input" type="number" min="1" max="10" value={f.weight} onChange={set('weight')} /></Field>
        <Field label="Échéance"><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        <Field label="Précisions" className="full"><textarea className="textarea" rows={2} value={f.description} onChange={set('description')} /></Field>
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
