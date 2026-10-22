import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserCheck, Clock3, Palmtree, Save, Pencil, Trash2, Plus, Tablet, CheckCheck, Timer } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { RH, hours, hm, today, thisMonth, useRhMeta } from '../../lib/rh';

/** Présences (référence : Odoo Présences) : qui est là, feuilles de chantier, corrections, heures supplémentaires. */
export default function Attendance() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') || 'jour';
  const tabs = [['jour', 'Aujourd’hui'], ...(can('presence:write') ? [['feuille', 'Feuille de chantier']] : []), ['pointages', 'Pointages'], ['heures', 'Heures supplémentaires']];
  return (
    <div className="stack">
      <div className="row-between">
        <div className="tabs" role="tablist" style={{ marginBottom: 0, flex: 1 }}>
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setParams({ onglet: k })}>{l}</button>)}
        </div>
        {can('presence:write') && <Link className="btn" to="/rh/borne"><Tablet />Ouvrir la borne de pointage</Link>}
      </div>
      {tab === 'jour' && <Today />}
      {tab === 'feuille' && <Sheet />}
      {tab === 'pointages' && <Records />}
      {tab === 'heures' && <Overtime />}
    </div>
  );
}

function Today() {
  const t = useResource(`${RH}/attendance/today`);
  if (t.error) return <ErrorBox error={t.error} />;
  if (!t.data) return <Skeleton h={200} />;
  const List = ({ rows, render, empty }) => (!rows.length ? <div className="card-body"><Empty>{empty}</Empty></div> : <ul className="list">{rows.map(render)}</ul>);
  return (
    <div className="grid grid-3" style={{ alignItems: 'start' }}>
      <Card title={<span className="row" style={{ gap: 8 }}><UserCheck className="ico" />Présents ({t.data.present.length})</span>} bodyClass="">
        <List rows={t.data.present} empty="Personne n’a pointé pour l’instant." render={a => <li key={a.id} className="list-row"><span><b>{a.employee_name}</b><div className="small muted">{a.project_name || 'Siège'} · {a.source}</div></span><span className="tabular small">depuis {hm(a.check_in)}</span></li>} />
      </Card>
      <Card title={<span className="row" style={{ gap: 8 }}><Clock3 className="ico" />Partis ({t.data.done.length})</span>} bodyClass="">
        <List rows={t.data.done} empty="Aucun départ pointé." render={a => <li key={a.id} className="list-row"><span><b>{a.employee_name}</b><div className="small muted">{hm(a.check_in)} → {hm(a.check_out)}</div></span><span className="tabular small">{hours(a.hours)}</span></li>} />
      </Card>
      <Card title={<span className="row" style={{ gap: 8 }}><Palmtree className="ico" />Absents ({t.data.on_leave.length})</span>} bodyClass="">
        <List rows={t.data.on_leave} empty="Aucune absence approuvée aujourd’hui." render={l => <li key={l.employee_id} className="list-row"><b>{l.employee_name}</b><Badge tone="warn">{l.label}</Badge></li>} />
      </Card>
    </div>
  );
}

/** Feuille de présence du conducteur de travaux : une journée, un chantier, une ou deux plages par ouvrier. */
function Sheet() {
  const { meta } = useRhMeta();
  const toast = useToast();
  const saved = useSaved();
  const [day, setDay] = useState(today());
  const [project, setProject] = useState('');
  const [dept, setDept] = useState('chantier');
  const [rows, setRows] = useState({});
  const [busy, setBusy] = useState(false);
  const people = (meta?.employees || []).filter(e => !dept || e.department === dept);
  const row = id => rows[id] || { present: false, am: ['07:30', '12:00'], pm: ['13:00', '16:30'], pmOn: true };
  const set = (id, patch) => setRows(r => ({ ...r, [id]: { ...row(id), ...patch } }));
  const total = id => { const r = row(id); const h = ([a, b]) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); return Math.max(0, h2 * 60 + m2 - h1 * 60 - m1) / 60; }; return h(r.am) + (r.pmOn ? h(r.pm) : 0); };
  const save = async () => {
    const list = people.filter(e => row(e.id).present).map(e => ({ employee_id: e.id, periods: [row(e.id).am, ...(row(e.id).pmOn ? [row(e.id).pm] : [])] }));
    if (!list.length) return toast('Cochez les présents.', 'err');
    setBusy(true);
    try { const r = await api.post(`${RH}/attendance/sheet`, { date: day, project_id: Number(project) || null, rows: list }); saved(`${r.created} plage(s) enregistrée(s) pour ${list.length} personne(s)`); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Card title="Feuille de présence" actions={<button className="btn btn-primary btn-sm" disabled={busy} onClick={save}><Save />Enregistrer la feuille</button>} bodyClass="">
      <div className="card-body row" style={{ gap: 10, borderBottom: '1px solid var(--border)' }}>
        <input className="input" type="date" style={{ width: 'auto' }} max={today()} value={day} onChange={e => setDay(e.target.value)} aria-label="Jour" />
        <select className="select" style={{ width: 'auto' }} value={project} onChange={e => setProject(e.target.value)} aria-label="Chantier"><option value="">Siège</option>{meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="select" style={{ width: 'auto' }} value={dept} onChange={e => setDept(e.target.value)} aria-label="Service"><option value="">Tous les services</option>{meta && Object.entries(meta.departments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn btn-sm" onClick={() => setRows(Object.fromEntries(people.map(e => [e.id, { ...row(e.id), present: true }])))}><CheckCheck />Tous présents</button>
        <span className="small muted">Enregistrer à nouveau remplace la feuille du jour pour ce chantier.</span>
      </div>
      {!people.length ? <div className="card-body"><Empty>Aucun employé dans ce service.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Présent</th><th>Employé</th><th>Matin</th><th>Après-midi</th><th className="right">Heures</th></tr></thead>
          <tbody>{people.map(e => {
            const r = row(e.id);
            return (
              <tr key={e.id} style={{ opacity: r.present ? 1 : 0.6 }}>
                <td><input type="checkbox" checked={r.present} onChange={ev => set(e.id, { present: ev.target.checked })} aria-label={`${e.last_name} présent`} /></td>
                <td><b>{e.last_name} {e.first_name}</b><div className="small muted tabular">{e.matricule}</div></td>
                <td className="nowrap"><input className="input time" type="time" value={r.am[0]} onChange={ev => set(e.id, { am: [ev.target.value, r.am[1]] })} aria-label="Arrivée" /> → <input className="input time" type="time" value={r.am[1]} onChange={ev => set(e.id, { am: [r.am[0], ev.target.value] })} aria-label="Pause" /></td>
                <td className="nowrap"><input type="checkbox" checked={r.pmOn} onChange={ev => set(e.id, { pmOn: ev.target.checked })} aria-label="Après-midi travaillé" /> <input className="input time" type="time" disabled={!r.pmOn} value={r.pm[0]} onChange={ev => set(e.id, { pm: [ev.target.value, r.pm[1]] })} aria-label="Reprise" /> → <input className="input time" type="time" disabled={!r.pmOn} value={r.pm[1]} onChange={ev => set(e.id, { pm: [r.pm[0], ev.target.value] })} aria-label="Départ" /></td>
                <td className="right tabular">{r.present ? hours(total(e.id)) : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function Records() {
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const toast = useToast();
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const [employee, setEmployee] = useState('');
  const [edit, setEdit] = useState(null);
  const list = useResource(`${RH}/attendance${qs({ from, to, employee_id: employee })}`);
  const del = async a => { if (!window.confirm('Supprimer ce pointage ?')) return; try { await api.del(`${RH}/attendance/${a.id}`); list.reload(); } catch (e) { toast(e.message, 'err'); } };
  const editable = can('presence:write');
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <input className="input" type="date" style={{ width: 'auto' }} value={from} onChange={e => setFrom(e.target.value)} aria-label="Du" />
          <input className="input" type="date" style={{ width: 'auto' }} value={to} onChange={e => setTo(e.target.value)} aria-label="Au" />
          {meta?.employees.length > 0 && <select className="select" style={{ width: 'auto' }} value={employee} onChange={e => setEmployee(e.target.value)} aria-label="Employé"><option value="">Tout le personnel</option>{meta.employees.map(e => <option key={e.id} value={e.id}>{e.last_name} {e.first_name}</option>)}</select>}
        </div>
        {editable && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus />Saisie manuelle</button>}
      </div>
      <Card bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !list.data.length ? <div className="card-body"><Empty>Aucun pointage sur la période.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Employé</th><th>Jour</th><th>Arrivée</th><th>Départ</th><th className="right">Durée</th><th>Lieu</th><th>Source</th><th /></tr></thead>
            <tbody>{list.data.map(a => (
              <tr key={a.id}>
                <td><b>{a.employee_name}</b></td><td className="small nowrap">{date(a.check_in)}</td><td className="tabular">{hm(a.check_in)}</td>
                <td className="tabular">{a.check_out ? hm(a.check_out) : <Badge tone="warn">en cours</Badge>}</td><td className="right tabular">{hours(a.hours)}</td>
                <td className="small">{a.project_name || 'Siège'}{a.latitude != null && <a className="link" style={{ marginLeft: 6 }} href={`https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}#map=17/${a.latitude}/${a.longitude}`} target="_blank" rel="noreferrer">carte</a>}</td>
                <td className="small muted">{meta?.attendance_sources[a.source]}{a.note ? ` · ${a.note}` : ''}{a.created_by_name && a.source !== 'web' ? ` · ${a.created_by_name}` : ''}</td>
                <td className="right nowrap">{editable && <><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEdit(a)} aria-label="Corriger"><Pencil /></button><button className="btn btn-ghost btn-icon btn-sm" onClick={() => del(a)} aria-label="Supprimer"><Trash2 /></button></>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && <ManualForm record={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

const local = iso => (iso ? iso.slice(0, 16) : '');
function ManualForm({ record, onClose, onSaved }) {
  const saved = useSaved();
  const { meta } = useRhMeta();
  const [f, setF] = useState({ employee_id: record.employee_id || '', check_in: local(record.check_in) || `${today()}T07:30`, check_out: local(record.check_out), project_id: record.project_id || '', note: '' });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault();
    const body = { employee_id: Number(f.employee_id), check_in: `${f.check_in}:00Z`, check_out: f.check_out ? `${f.check_out}:00Z` : null, project_id: Number(f.project_id) || null, note: f.note };
    try { await (record.id ? api.patch(`${RH}/attendance/${record.id}`, body) : api.post(`${RH}/attendance`, body)); saved("Pointage enregistré"); onSaved(); } catch (err) { setError(err); }
  };
  return (
    <Modal title={record.id ? `Corriger — ${record.employee_name}` : 'Saisie manuelle d’un pointage'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="manual">Enregistrer</button></>}>
      <form id="manual" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        {!record.id && <Field label="Employé" className="full"><select className="select" required value={f.employee_id} onChange={set('employee_id')}><option value="">— Choisir —</option>{meta?.employees.map(e => <option key={e.id} value={e.id}>{e.last_name} {e.first_name}</option>)}</select></Field>}
        <Field label="Arrivée"><input className="input" type="datetime-local" required value={f.check_in} onChange={set('check_in')} /></Field>
        <Field label="Départ"><input className="input" type="datetime-local" value={f.check_out} onChange={set('check_out')} /></Field>
        <Field label="Lieu" className="full"><select className="select" value={f.project_id} onChange={set('project_id')}><option value="">Siège</option>{meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Motif de la correction" className="full" hint="Tracé avec votre nom : oubli de pointage, panne de la borne…"><input className="input" required minLength={3} value={f.note} onChange={set('note')} /></Field>
      </form>
    </Modal>
  );
}

function Overtime() {
  const { can } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(thisMonth());
  const rep = useResource(`${RH}/overtime?period=${period}`);
  const [busy, setBusy] = useState(false);
  const pay = can('paie:read');
  const rows = rep.data?.rows || [];
  const keys = useMemo(() => [...new Set(rows.flatMap(r => r.lines.map(l => l.key)))], [rows]);
  const labels = Object.fromEntries(rows.flatMap(r => r.lines.map(l => [l.key, l.label])));
  const approve = async () => {
    if (!window.confirm(`Arrêter les heures supplémentaires de ${period} ? Elles passeront dans les bulletins de la paie du mois (en brouillon).`)) return;
    setBusy(true);
    try { const r = await api.post(`${RH}/overtime/approve`, { period }); toast(`${r.approved} employé(s) : heures arrêtées${r.payroll_run_id ? ' et reprises dans la paie' : ' (elles seront reprises à la préparation de la paie)'}`); rep.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Card title="Heures travaillées et supplémentaires" actions={<div className="row" style={{ gap: 8 }}>
      <input className="input" type="month" style={{ width: 'auto' }} value={period} onChange={e => setPeriod(e.target.value || thisMonth())} aria-label="Mois" />
      {can('rh:overtime') && rows.length > 0 && <button className="btn btn-primary btn-sm" disabled={busy} onClick={approve}><CheckCheck />Arrêter et envoyer en paie</button>}
    </div>} bodyClass="">
      <ErrorBox error={rep.error} />
      <p className="card-body small muted" style={{ borderBottom: '1px solid var(--border)' }}>
        Semaine du lundi au dimanche, rattachée au mois de son jeudi. Au-delà de {rep.data ? '40' : '…'} h par semaine : majorations réglables dans RH › Réglages (à confirmer par le comptable). Plafond annuel indicatif : {rep.data?.year_cap ?? 220} h.
      </p>
      {!rep.data ? <div className="card-body"><Skeleton h={160} /></div> : !rows.length ? <div className="card-body"><Empty icon={Timer}>Aucun pointage ce mois-ci.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Employé</th><th className="right">Jours</th><th className="right">Travaillées</th><th className="right">Normales</th>{keys.map(k => <th key={k} className="right" title={labels[k]}>{labels[k].replace(/^Heures supplémentaires /, 'HS ').replace(/ \(.+/, '')}<div className="small muted">{labels[k].match(/\((.+)\)/)?.[1]}</div></th>)}{pay && <th className="right">Montant</th>}<th>Paie</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.employee_id}>
              <td><b>{r.name}</b>{r.open > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{r.open} pointage(s) sans départ</div>}</td>
              <td className="right tabular">{r.days}</td><td className="right tabular">{hours(r.worked)}</td><td className="right tabular">{hours(r.normal)}</td>
              {keys.map(k => <td key={k} className="right tabular">{hours(r.lines.find(l => l.key === k)?.hours || 0)}</td>)}
              {pay && <td className="right tabular"><b>{fcfa(r.amount)}</b></td>}
              <td>{r.exempt ? <Badge>Forfait (cadre)</Badge> : r.approved ? <Badge tone="ok">Arrêtées{pay ? ` · ${fcfa(r.approved.amount)}` : ''}</Badge> : <span className="small muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}
