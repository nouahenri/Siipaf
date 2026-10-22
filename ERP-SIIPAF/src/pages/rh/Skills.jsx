import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Users, CheckCheck, Ban, GraduationCap, Pencil, Trash2, Search } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { RH, today, useRhMeta } from '../../lib/rh';

const thisYear = new Date().getFullYear();

/** Compétences et formations (référence : Odoo Compétences et eLearning) : plan de formation, matrice, référentiel. */
export default function Skills() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') || 'formations';
  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {[['formations', 'Plan de formation'], ['matrice', 'Qui sait faire quoi'], ['referentiel', 'Référentiel des compétences']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setParams({ onglet: k })}>{l}</button>)}
      </div>
      {tab === 'formations' && <Trainings />}
      {tab === 'matrice' && <Matrix />}
      {tab === 'referentiel' && <Referential />}
    </div>
  );
}

function Trainings() {
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const toast = useToast();
  const [year, setYear] = useState(thisYear);
  const list = useResource(`${RH}/trainings`);
  const sum = useResource(`${RH}/trainings/summary?year=${year}`);
  const skills = useResource(`${RH}/skills`);
  const [edit, setEdit] = useState(null);
  const [people, setPeople] = useState(null);
  const [closing, setClosing] = useState(null);
  const rows = (list.data || []).filter(t => t.start_date.startsWith(String(year)));
  const cancel = async t => { if (!window.confirm(`Annuler « ${t.title} » ?`)) return; try { await api.post(`${RH}/trainings/${t.id}/cancel`); list.reload(); sum.reload(); } catch (e) { toast(e.message, 'err'); } };
  const reload = () => { list.reload(); sum.reload(); };
  const s = sum.data;
  return (
    <div className="stack">
      <div className="row-between">
        <select className="select" style={{ width: 'auto' }} value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année">{[thisYear + 1, thisYear, thisYear - 1].map(y => <option key={y} value={y}>{y}</option>)}</select>
        {can('formation:write') && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus />Formation</button>}
      </div>
      {s && (
        <div className="grid grid-4">
          <div className="card kpi"><span className="kpi-label">Formations {year}</span><span className="kpi-value">{s.trainings}</span><span className="kpi-foot">{s.done} réalisée(s)</span></div>
          <div className="card kpi"><span className="kpi-label">Heures de formation</span><span className="kpi-value">{Math.round(s.hours).toLocaleString('fr-FR')}</span><span className="kpi-foot">heures × participants présents</span></div>
          <div className="card kpi"><span className="kpi-label">Coût</span><span className="kpi-value">{fcfa(s.cost)}</span><span className="kpi-foot">dont {fcfa(s.fdfp_requested)} présentés au FDFP</span></div>
          <div className="card kpi"><span className="kpi-label">Taxe de formation continue</span><span className="kpi-value">{s.training_tax_paid == null ? '—' : fcfa(s.training_tax_paid)}</span><span className="kpi-foot">versée avec les salaires (paies validées)</span></div>
        </div>
      )}
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? <div className="card-body"><Empty icon={GraduationCap}>Aucune formation en {year}. Les besoins notés lors des entretiens annuels servent de point de départ.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Formation</th><th>Dates</th><th>Compétence visée</th><th className="right">Coût</th><th>Participants</th><th>Statut</th><th /></tr></thead>
            <tbody>{rows.map(t => (
              <tr key={t.id}>
                <td><b>{t.title}</b><div className="small muted">{t.kind === 'interne' ? 'Interne' : t.provider || 'Externe'}{t.location ? ` · ${t.location}` : ''}{t.hours ? ` · ${t.hours} h` : ''}{t.fdfp ? ' · FDFP' : ''}</div></td>
                <td className="small nowrap">{date(t.start_date)}{t.end_date !== t.start_date ? ` → ${date(t.end_date)}` : ''}</td>
                <td className="small">{t.skill_name || '—'}</td>
                <td className="right tabular">{fcfa(t.cost)}</td>
                <td className="small">{t.participants.length ? t.participants.map(p => <div key={p.id}>{p.employee_name}{p.status !== 'inscrit' && <span className="muted"> · {p.status === 'present' ? 'présent' : 'absent'}</span>}</div>) : <span className="muted">—</span>}</td>
                <td><Badge tone={t.status === 'realisee' ? 'ok' : t.status === 'annulee' ? '' : 'brand'}>{t.status_label}</Badge></td>
                <td className="right nowrap">{can('formation:write') && t.status === 'planifiee' && <>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEdit(t)} aria-label="Modifier"><Pencil /></button>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setPeople(t)} aria-label="Participants"><Users /></button>
                  <button className="btn btn-ghost btn-icon btn-sm" disabled={!t.participants.length} onClick={() => setClosing(t)} aria-label="Clôturer" title="Clôturer (présences)"><CheckCheck /></button>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => cancel(t)} aria-label="Annuler"><Ban /></button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && <TrainingForm training={edit} skills={skills.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {people && <Participants training={people} employees={meta?.employees || []} onClose={() => setPeople(null)} onSaved={() => { setPeople(null); reload(); }} />}
      {closing && <CloseTraining training={closing} onClose={() => setClosing(null)} onSaved={() => { setClosing(null); reload(); }} />}
    </div>
  );
}

function TrainingForm({ training, skills, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({
    title: training.title || '', provider: training.provider || '', kind: training.kind || 'externe', skill_id: training.skill_id || '', start_date: training.start_date || today(),
    end_date: training.end_date || today(), hours: training.hours ?? '', location: training.location || '', cost: training.cost ?? 0, fdfp: !!training.fdfp,
  });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault();
    const body = { ...f, skill_id: Number(f.skill_id) || null, hours: f.hours === '' ? null : Number(f.hours), cost: Number(f.cost) || 0, provider: f.provider || null, location: f.location || null };
    try { await (training.id ? api.patch(`${RH}/trainings/${training.id}`, body) : api.post(`${RH}/trainings`, body)); saved("Formation enregistrée"); onSaved(); } catch (err) { setError(err); }
  };
  return (
    <Modal title={training.id ? training.title : 'Nouvelle formation'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="training">Enregistrer</button></>}>
      <form id="training" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Intitulé" className="full"><input className="input" required minLength={3} value={f.title} onChange={set('title')} autoFocus /></Field>
        <Field label="Type"><select className="select" value={f.kind} onChange={set('kind')}><option value="externe">Externe (organisme)</option><option value="interne">Interne</option></select></Field>
        <Field label="Organisme / formateur"><input className="input" value={f.provider} onChange={set('provider')} /></Field>
        <Field label="Du"><input className="input" type="date" required value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="Au"><input className="input" type="date" required min={f.start_date} value={f.end_date} onChange={set('end_date')} /></Field>
        <Field label="Durée (heures)"><input className="input" type="number" min="0" step="0.5" value={f.hours} onChange={set('hours')} /></Field>
        <Field label="Coût (FCFA)"><input className="input" type="number" min="0" value={f.cost} onChange={set('cost')} /></Field>
        <Field label="Lieu"><input className="input" value={f.location} onChange={set('location')} /></Field>
        <Field label="Compétence visée" hint="Ajoutée au profil des présents à la clôture">
          <select className="select" value={f.skill_id} onChange={set('skill_id')}><option value="">—</option>{skills.map(t => <optgroup key={t.id} label={t.name}>{t.skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}</select>
        </Field>
        <label className="checkbox full"><input type="checkbox" checked={f.fdfp} onChange={set('fdfp')} />Financement demandé au FDFP (plan de formation)</label>
      </form>
    </Modal>
  );
}

function Participants({ training, employees, onClose, onSaved }) {
  const saved = useSaved();
  const [ids, setIds] = useState(training.participants.map(p => p.employee_id));
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const save = async () => { try { await api.put(`${RH}/trainings/${training.id}/participants`, { employee_ids: ids }); saved("Participants enregistrés"); onSaved(); } catch (e) { setError(e); } };
  const shown = employees.filter(e => !q || `${e.last_name} ${e.first_name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={`Participants — ${training.title}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer ({ids.length})</button></>}>
      <div className="stack" style={{ gap: 10 }}>
        <ErrorBox error={error} />
        <label className="search"><Search aria-hidden="true" /><input className="input" type="search" placeholder="Rechercher" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" /></label>
        <ul className="pick-list">{shown.map(e => <li key={e.id}><label className="checkbox" style={{ padding: '8px 12px', width: '100%' }}><input type="checkbox" checked={ids.includes(e.id)} onChange={ev => setIds(s => (ev.target.checked ? [...s, e.id] : s.filter(x => x !== e.id)))} /><b>{e.last_name} {e.first_name}</b> <span className="small muted">{e.matricule}</span></label></li>)}</ul>
      </div>
    </Modal>
  );
}

function CloseTraining({ training, onClose, onSaved }) {
  const saved = useSaved();
  const [att, setAtt] = useState(training.participants.map(p => ({ employee_id: p.employee_id, name: p.employee_name, present: true, evaluation: '' })));
  const [error, setError] = useState(null);
  const save = async () => { try { await api.post(`${RH}/trainings/${training.id}/complete`, { attendance: att.map(({ name, ...a }) => ({ ...a, evaluation: a.evaluation || null })) }); saved("Formation clôturée"); onSaved(); } catch (e) { setError(e); } };
  return (
    <Modal title={`Clôturer — ${training.title}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}><CheckCheck />Clôturer la formation</button></>}>
      <div className="stack" style={{ gap: 10 }}>
        <ErrorBox error={error} />
        <p className="small muted">Pour chaque présent : ligne ajoutée au CV, événement « Formation » au dossier{training.skill_name ? ` et compétence « ${training.skill_name} » au profil` : ''}.</p>
        {att.map((a, i) => (
          <div key={a.employee_id} className="row" style={{ gap: 10 }}>
            <label className="checkbox" style={{ minWidth: 200 }}><input type="checkbox" checked={a.present} onChange={e => setAtt(s => s.map((x, j) => (j === i ? { ...x, present: e.target.checked } : x)))} />{a.name}</label>
            <input className="input" style={{ flex: 1 }} placeholder="Appréciation (facultatif)" value={a.evaluation} onChange={e => setAtt(s => s.map((x, j) => (j === i ? { ...x, evaluation: e.target.value } : x)))} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Matrix() {
  const ref = useResource(`${RH}/skills`);
  const [skill, setSkill] = useState('');
  const m = useResource(`${RH}/skills/matrix${skill ? `?skill_id=${skill}` : ''}`);
  const now = today();
  const rows = m.data || [];
  const bySkill = rows.reduce((acc, r) => ({ ...acc, [r.skill_name]: [...(acc[r.skill_name] || []), r] }), {});
  return (
    <div className="stack">
      <select className="select" style={{ width: 'auto', alignSelf: 'start' }} value={skill} onChange={e => setSkill(e.target.value)} aria-label="Compétence">
        <option value="">Toutes les compétences</option>{ref.data?.map(t => <optgroup key={t.id} label={t.name}>{t.skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
      </select>
      {!m.data ? <Skeleton h={200} /> : !rows.length ? <Card><Empty>Aucune compétence renseignée. Chaque employé complète son profil depuis « Mon espace › Mon dossier ».</Empty></Card> : (
        <div className="grid grid-3" style={{ alignItems: 'start' }}>
          {Object.entries(bySkill).map(([name, list]) => (
            <Card key={name} title={`${name} (${list.length})`} bodyClass="">
              <ul className="list">{list.sort((a, b) => b.level - a.level).map(r => (
                <li key={`${r.employee_id}-${r.skill_id}`} className="list-row">
                  <Link to={`/rh/personnel/${r.employee_id}?onglet=competences`}><b className="small">{r.employee_name}</b></Link>
                  <span className="row" style={{ gap: 6 }}>{r.expires_at && r.expires_at < now && <Badge tone="danger">expirée</Badge>}<Badge>{r.level_label}</Badge></span>
                </li>
              ))}</ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Referential() {
  const { can } = useAuth();
  const toast = useToast();
  const ref = useResource(`${RH}/skills`);
  const [typeForm, setTypeForm] = useState(null);
  const [names, setNames] = useState({});
  const write = can('formation:write');
  const addSkill = async t => {
    const name = (names[t.id] || '').trim();
    if (!name) return;
    try { await api.post(`${RH}/skills`, { type_id: t.id, name }); setNames(n => ({ ...n, [t.id]: '' })); ref.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const del = async s => { try { await api.del(`${RH}/skills/${s.id}`); ref.reload(); } catch (e) { toast(e.message, 'err'); } };
  if (!ref.data) return <Skeleton h={200} />;
  return (
    <div className="stack">
      {write && <button className="btn btn-primary" style={{ alignSelf: 'end' }} onClick={() => setTypeForm({})}><Plus />Domaine de compétences</button>}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {ref.data.map(t => (
          <Card key={t.id} title={t.name} actions={write && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setTypeForm(t)} aria-label="Modifier"><Pencil /></button>}>
            <p className="small muted" style={{ marginBottom: 10 }}>Niveaux : {t.levels.join(' → ')}</p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {t.skills.map(s => <span key={s.id} className="chip">{s.name}{write && <button onClick={() => del(s)} aria-label={`Supprimer ${s.name}`}><Trash2 /></button>}</span>)}
            </div>
            {write && <form className="row" style={{ gap: 6, marginTop: 12 }} onSubmit={e => { e.preventDefault(); addSkill(t); }}><input className="input" placeholder="Nouvelle compétence" value={names[t.id] || ''} onChange={e => setNames(n => ({ ...n, [t.id]: e.target.value }))} /><button className="btn btn-sm">Ajouter</button></form>}
          </Card>
        ))}
      </div>
      {typeForm && <TypeForm type={typeForm} onClose={() => setTypeForm(null)} onSaved={() => { setTypeForm(null); ref.reload(); }} />}
    </div>
  );
}

function TypeForm({ type, onClose, onSaved }) {
  const saved = useSaved();
  const [name, setName] = useState(type.name || '');
  const [levels, setLevels] = useState((type.levels || ['Débutant', 'Intermédiaire', 'Avancé', 'Expert']).join('\n'));
  const [error, setError] = useState(null);
  const save = async e => {
    e.preventDefault();
    const body = { name, levels: levels.split('\n').map(l => l.trim()).filter(Boolean) };
    try { await (type.id ? api.patch(`${RH}/skill-types/${type.id}`, body) : api.post(`${RH}/skill-types`, body)); saved("Domaine enregistré"); onSaved(); } catch (err) { setError(err); }
  };
  return (
    <Modal title={type.id ? type.name : 'Nouveau domaine'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="type">Enregistrer</button></>}>
      <form id="type" className="stack" style={{ gap: 12 }} onSubmit={save}>
        <ErrorBox error={error} />
        <Field label="Nom du domaine"><input className="input" required minLength={2} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field>
        <Field label="Niveaux, du plus faible au plus élevé (un par ligne)"><textarea className="textarea" rows={5} value={levels} onChange={e => setLevels(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
