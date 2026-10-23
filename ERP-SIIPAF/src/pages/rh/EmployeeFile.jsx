import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Upload, Trash2, FileText, Plus, CalendarPlus, Star, Briefcase, KeyRound, ExternalLink } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { date, fcfa, initials } from '@admin/lib/format';
import { RH, hours, hm, today, formData, useRhMeta, thisMonth } from '../../lib/rh';
import { LeaveForm, LeaveBadge, TypeDot } from '../../components/RhForms';
import { ObjectivesPanel, Indicators } from './Reviews';
import PerformanceCurves from './PerformanceCurves';
import { ChangePositionModal, ChangePositionButton, PositionChanges } from '../../components/Positions';

const TABS = [['dossier', 'Dossier'], ['conges', 'Congés'], ['documents', 'Documents'], ['carriere', 'Carrière'], ['competences', 'Compétences et CV'], ['objectifs', 'Objectifs et performance'], ['presences', 'Présences']];

/** Dossier d'un employé : RH (tout), l'employé lui-même (lecture, compétences et CV), son responsable (congés, objectifs). */
export default function EmployeeFile() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const file = useResource(`${RH}/employees/${id}`);
  const tab = params.get('onglet') || 'dossier';
  if (file.error) return <ErrorBox error={file.error} />;
  if (!file.data) return <Skeleton h={300} />;
  const d = file.data;
  const e = d.employee;
  const hr = can('rh:files');
  const tabs = TABS.filter(([k]) => d.access !== 'manager' || ['dossier', 'conges', 'objectifs', 'presences'].includes(k)).filter(([k]) => d.access !== 'self' || k !== 'objectifs');

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row" style={{ gap: 14 }}>
          <Link className="btn btn-ghost btn-icon" to={d.access === 'rh' ? '/rh/personnel' : '/rh/moi'} aria-label="Retour"><ArrowLeft /></Link>
          <span className="avatar">{initials(`${e.first_name} ${e.last_name}`)}</span>
          <div>
            <h2 className="erp-hello" style={{ fontSize: 20 }}>{e.last_name} {e.first_name} {!e.active && <Badge>Sorti(e)</Badge>}</h2>
            <p className="small muted">{e.matricule} · {e.job_title} · {meta?.departments[e.department]} · {meta?.contract_types[e.contract_type]} depuis le {date(e.hire_date)}{d.manager ? ` · responsable : ${d.manager.last_name} ${d.manager.first_name}` : ''}</p>
          </div>
        </div>
        {can('paie:employees') && <Link className="btn" to="/compta/employes"><ExternalLink />Salaire et paie</Link>}
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setParams({ onglet: k })}>{l}</button>)}
      </div>
      {tab === 'dossier' && <Identity d={d} hr={hr} onSaved={file.reload} />}
      {tab === 'conges' && <LeaveTab d={d} hr={hr} onChange={file.reload} />}
      {tab === 'documents' && <Documents d={d} hr={hr} onChange={file.reload} />}
      {tab === 'carriere' && <Career d={d} hr={hr} onChange={file.reload} />}
      {tab === 'competences' && <Profile employeeId={e.id} editable={hr || d.access === 'self'} />}
      {tab === 'objectifs' && <div className="stack"><Indicators employeeId={e.id} /><PerformanceCurves employeeId={e.id} /><ObjectivesPanel employee={e} /></div>}
      {tab === 'presences' && <EmployeeAttendance employeeId={e.id} />}
    </div>
  );
}

const Row = ({ label, children }) => <div className="kv"><span>{label}</span><b>{children || <span className="muted">—</span>}</b></div>;

function Identity({ d, hr, onSaved }) {
  const { meta } = useRhMeta();
  const [edit, setEdit] = useState(false);
  const [pin, setPin] = useState(false);
  const [change, setChange] = useState(false);
  const e = d.employee;
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Identité" actions={hr && <button className="btn btn-sm" onClick={() => setEdit(true)}><Pencil />Modifier</button>}>
        <Row label="Sexe">{e.gender === 'F' ? 'Femme' : e.gender === 'M' ? 'Homme' : null}</Row>
        <Row label="Naissance">{e.birth_date && `${date(e.birth_date)}${e.birth_place ? ` à ${e.birth_place}` : ''}`}</Row>
        <Row label="Nationalité">{e.nationality}{e.expatriate ? ' (expatrié)' : ''}</Row>
        <Row label="Situation de famille">{meta?.marital[e.marital_status]}{e.children ? ` · ${e.children} enfant(s) à charge` : ''}</Row>
        <Row label="Téléphone">{e.phone}</Row>
        <Row label="E-mail">{e.email}</Row>
        <Row label="Adresse">{e.address}</Row>
        <Row label="Contact en cas d’urgence">{e.emergency_contact}</Row>
        <Row label="CNI / passeport">{e.id_number}</Row>
        <Row label="N° CNPS">{e.cnps_number}</Row>
        <Row label="Compte du dashboard">{d.user && `${d.user.name} (${d.user.email})`}</Row>
      </Card>
      <Card title="Contrat" actions={hr && <div className="row" style={{ gap: 6 }}>{e.active && <ChangePositionButton onClick={() => setChange(true)} />}<button className="btn btn-sm" onClick={() => setPin(true)}><KeyRound />Code de pointage</button></div>}>
        <Row label="Poste">{e.job_title}</Row>
        <Row label="Service">{meta?.departments[e.department]}</Row>
        <Row label="Catégorie">{e.category}</Row>
        <Row label="Affectation">{e.project_name || 'Siège'}</Row>
        <Row label="Contrat">{meta?.contract_types[e.contract_type]}</Row>
        <Row label="Entrée">{date(e.hire_date)} · {d.balance.seniority_years} an(s) d’ancienneté</Row>
        <Row label="Fin de la période d’essai">{e.trial_end_date && date(e.trial_end_date)}</Row>
        <Row label="Fin de contrat / sortie">{e.end_date && date(e.end_date)}</Row>
        <Row label="Responsable direct">{d.manager && `${d.manager.last_name} ${d.manager.first_name}`}</Row>
        <Row label="Code de pointage">{e.has_pin ? 'défini' : 'non défini'}</Row>
        {e.base_salary != null && <Row label="Salaire de base">{fcfa(e.base_salary)}</Row>}
      </Card>
      {edit && <IdentityForm d={d} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onSaved(); }} />}
      {pin && <HrPin employee={e} onClose={() => setPin(false)} onSaved={() => { setPin(false); onSaved(); }} />}
      {change && <ChangePositionModal d={d} onClose={() => setChange(false)} onSaved={() => { setChange(false); onSaved(); }} />}
    </div>
  );
}

function IdentityForm({ d, onClose, onSaved }) {
  const saved = useSaved();
  const { meta } = useRhMeta();
  const e = d.employee;
  // Poste et service : par « Changer de poste » (date d'effet, motif, historique), plus dans ce formulaire
  const keys = ['phone', 'email', 'address', 'birth_date', 'birth_place', 'gender', 'nationality', 'id_number', 'cnps_number', 'marital_status', 'children', 'emergency_contact', 'category', 'contract_type', 'end_date', 'trial_end_date', 'manager_id', 'leave_opening_days', 'leave_opening_date', 'notes'];
  const [f, setF] = useState(Object.fromEntries(keys.map(k => [k, e[k] ?? ''])));
  const [error, setError] = useState(null);
  const set = k => ev => setF(x => ({ ...x, [k]: ev.target.value }));
  const save = async ev => {
    ev.preventDefault(); setError(null);
    const body = Object.fromEntries(keys.map(k => [k, f[k] === '' ? null : f[k]]));
    for (const k of ['children', 'manager_id', 'leave_opening_days']) body[k] = body[k] == null ? null : Number(body[k]);
    body.children = body.children ?? 0;
    try { await api.patch(`${RH}/employees/${e.id}`, body); saved("Dossier enregistré"); onSaved(); } catch (err) { setError(err); }
  };
  return (
    <Modal title={`Dossier — ${e.last_name} ${e.first_name}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="id-form">Enregistrer</button></>}>
      <form id="id-form" className="stack wide-form" style={{ gap: 14 }} onSubmit={save}>
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Téléphone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Adresse" className="full"><input className="input" value={f.address} onChange={set('address')} /></Field>
          <Field label="Date de naissance"><input className="input" type="date" value={f.birth_date} onChange={set('birth_date')} /></Field>
          <Field label="Lieu de naissance"><input className="input" value={f.birth_place} onChange={set('birth_place')} /></Field>
          <Field label="Sexe"><select className="select" value={f.gender} onChange={set('gender')}><option value="">—</option><option value="F">Femme</option><option value="M">Homme</option></select></Field>
          <Field label="Nationalité"><input className="input" value={f.nationality} onChange={set('nationality')} /></Field>
          <Field label="CNI / passeport"><input className="input" value={f.id_number} onChange={set('id_number')} /></Field>
          <Field label="N° CNPS"><input className="input" value={f.cnps_number} onChange={set('cnps_number')} /></Field>
          <Field label="Situation de famille"><select className="select" value={f.marital_status} onChange={set('marital_status')}>{meta && Object.entries(meta.marital).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Enfants à charge" hint="Compte pour les jours de congé supplémentaires et la paie"><input className="input" type="number" min="0" max="20" value={f.children} onChange={set('children')} /></Field>
          <Field label="Contact en cas d’urgence" className="full"><input className="input" value={f.emergency_contact} onChange={set('emergency_contact')} placeholder="Nom, lien, téléphone" /></Field>
          <Field label="Poste et service" className="full" hint="Pour un nouveau poste ou un autre service : bouton « Changer de poste » de la carte Contrat (date d’effet, motif, historique)">
            <input className="input" disabled value={`${e.job_title} · ${meta?.departments[e.department] || e.department}`} />
          </Field>
          <Field label="Catégorie professionnelle"><input className="input" value={f.category} onChange={set('category')} /></Field>
          <Field label="Contrat"><select className="select" value={f.contract_type} onChange={set('contract_type')}>{meta && Object.entries(meta.contract_types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Fin de la période d’essai"><input className="input" type="date" value={f.trial_end_date} onChange={set('trial_end_date')} /></Field>
          <Field label="Fin de contrat / sortie"><input className="input" type="date" value={f.end_date} onChange={set('end_date')} /></Field>
          <Field label="Responsable direct" hint="Premier niveau d’accord des congés et des notes de frais" className="full">
            <select className="select" value={f.manager_id ?? ''} onChange={set('manager_id')}><option value="">— Aucun —</option>{meta?.employees.filter(x => x.id !== e.id).map(x => <option key={x.id} value={x.id}>{x.last_name} {x.first_name}</option>)}</select>
          </Field>
          <Field label="Solde de congés repris (jours)" hint="Solde de l’ancienne gestion, à la date ci-contre"><input className="input" type="number" step="0.5" value={f.leave_opening_days} onChange={set('leave_opening_days')} /></Field>
          <Field label="Date de reprise du solde" hint="L’acquisition de 2,2 j / mois repart de cette date"><input className="input" type="date" value={f.leave_opening_date} onChange={set('leave_opening_date')} /></Field>
          <Field label="Notes internes" className="full"><textarea className="textarea" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        </div>
      </form>
    </Modal>
  );
}

function HrPin({ employee, onClose, onSaved }) {
  const toast = useToast();
  const saved = useSaved();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const save = async ev => { ev.preventDefault(); try { await api.put(`${RH}/employees/${employee.id}/pin`, { pin }); saved('Code de pointage défini'); onSaved(); } catch (err) { setError(err); } };
  return (
    <Modal title={`Code de pointage — ${employee.last_name} ${employee.first_name}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="hr-pin">Enregistrer</button></>}>
      <form id="hr-pin" className="stack" style={{ gap: 12 }} onSubmit={save}>
        <ErrorBox error={error} />
        <p className="small">Pour un ouvrier sans compte : communiquez-lui ce code en main propre. Il pointe sur la borne du chantier avec son matricule <b>{employee.matricule}</b>.</p>
        <Field label="Code (4 à 6 chiffres)"><input className="input" inputMode="numeric" type="password" autoComplete="new-password" pattern="\d{4,6}" required value={pin} onChange={ev => setPin(ev.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus /></Field>
      </form>
    </Modal>
  );
}

function LeaveTab({ d, hr, onChange }) {
  const { meta } = useRhMeta();
  const toast = useToast();
  const [form, setForm] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const b = d.balance;
  const delAdj = async a => { if (!window.confirm('Supprimer cet ajustement ?')) return; try { await api.del(`${RH}/adjustments/${a.id}`); onChange(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi"><span className="kpi-label">Disponibles</span><span className="kpi-value">{b.available.toLocaleString('fr-FR')}</span><span className="kpi-foot">jours ouvrables</span></div>
        <div className="card kpi"><span className="kpi-label">Acquis</span><span className="kpi-value">{(b.accrued + b.bonus + b.opening + b.adjustments).toLocaleString('fr-FR')}</span><span className="kpi-foot">{b.months} mois × {meta?.settings.accrual_per_month} j{b.bonus ? ` + ${b.bonus} j de majorations` : ''}{b.opening ? ` + reprise ${b.opening} j` : ''}</span></div>
        <div className="card kpi"><span className="kpi-label">Pris</span><span className="kpi-value">{b.taken.toLocaleString('fr-FR')}</span><span className="kpi-foot">{b.pending ? `${b.pending} j en attente d’accord` : 'aucune demande en attente'}</span></div>
        <div className="card kpi"><span className="kpi-label">Droit annuel</span><span className="kpi-value">{b.entitlement.total}</span><span className="kpi-foot">{b.entitlement.base} j de base{b.entitlement.seniority ? ` + ${b.entitlement.seniority} ancienneté` : ''}{b.entitlement.children ? ` + ${b.entitlement.children} enfants` : ''}</span></div>
      </div>
      <Card title="Absences" actions={hr && <div className="row" style={{ gap: 8 }}><button className="btn btn-sm" onClick={() => setAdjust(true)}><Plus />Ajuster le solde</button><button className="btn btn-sm btn-primary" onClick={() => setForm(true)}><CalendarPlus />Saisir une absence</button></div>} bodyClass="">
        {!d.leaves.length ? <div className="card-body"><Empty>Aucune absence.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Type</th><th>Période</th><th className="right">Jours</th><th>Statut</th><th>Décision</th></tr></thead>
            <tbody>{d.leaves.map(l => (
              <tr key={l.id}><td><TypeDot type={l.type} meta={meta} />{l.label}{l.event_label && <div className="small muted">{l.event_label}</div>}</td><td className="small nowrap">{date(l.start_date)} → {date(l.end_date)}</td><td className="right tabular">{l.days}</td><td><LeaveBadge leave={l} meta={meta} /></td><td className="small muted">{l.decided_by_name || l.manager_name || '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {d.adjustments.length > 0 && (
        <Card title="Ajustements du solde" bodyClass="">
          <ul className="list">{d.adjustments.map(a => <li key={a.id} className="list-row"><span><b className="tabular">{a.days > 0 ? '+' : ''}{a.days} j</b> · {a.label}<div className="small muted">{date(a.date)} · {a.created_by_name}</div></span>{hr && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => delAdj(a)} aria-label="Supprimer"><Trash2 /></button>}</li>)}</ul>
        </Card>
      )}
      {form && <LeaveForm employee={d.employee} onClose={() => setForm(false)} onSaved={() => { setForm(false); onChange(); }} />}
      {adjust && <AdjustForm employee={d.employee} onClose={() => setAdjust(false)} onSaved={() => { setAdjust(false); onChange(); }} />}
    </div>
  );
}

function AdjustForm({ employee, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ date: today(), days: '', label: '' });
  const [error, setError] = useState(null);
  const save = async ev => { ev.preventDefault(); try { await api.post(`${RH}/employees/${employee.id}/adjustments`, { ...f, days: Number(f.days) }); saved("Solde de congés ajusté"); onSaved(); } catch (err) { setError(err); } };
  return (
    <Modal title="Ajuster le solde de congés" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="adj">Enregistrer</button></>}>
      <form id="adj" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Jours (+ accordés, − retirés)"><input className="input" type="number" step="0.5" required value={f.days} onChange={ev => setF({ ...f, days: ev.target.value })} autoFocus /></Field>
        <Field label="Date"><input className="input" type="date" required value={f.date} onChange={ev => setF({ ...f, date: ev.target.value })} /></Field>
        <Field label="Motif" className="full" hint="Médaille du travail, congé de la convention, correction…"><input className="input" required minLength={3} value={f.label} onChange={ev => setF({ ...f, label: ev.target.value })} /></Field>
      </form>
    </Modal>
  );
}

function Documents({ d, hr, onChange }) {
  const { meta } = useRhMeta();
  const toast = useToast();
  const [kind, setKind] = useState('contrat');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const upload = async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    setBusy(true);
    try { await api.post(`${RH}/employees/${d.employee.id}/documents`, formData({ kind, expires_at: expires }, { file })); toast('Document ajouté au dossier'); setExpires(''); onChange(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const del = async doc => { if (!window.confirm(`Supprimer « ${doc.label} » ?`)) return; try { await api.del(`${RH}/documents/${doc.id}`); onChange(); } catch (e) { toast(e.message, 'err'); } };
  const now = today();
  return (
    <Card title="Documents du dossier" bodyClass="">
      {hr && (
        <div className="card-body row" style={{ gap: 10, borderBottom: '1px solid var(--border)' }}>
          <select className="select" style={{ width: 'auto' }} value={kind} onChange={ev => setKind(ev.target.value)} aria-label="Type de document">{meta && Object.entries(meta.document_kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label className="small row" style={{ gap: 6 }}>Expire le <input className="input" style={{ width: 'auto' }} type="date" value={expires} onChange={ev => setExpires(ev.target.value)} /></label>
          <label className="btn btn-primary" aria-disabled={busy}><Upload />Ajouter un fichier<input type="file" hidden accept="application/pdf,image/*,.doc,.docx" onChange={upload} disabled={busy} /></label>
          <span className="small muted">PDF, image ou Word · 15 Mo · stockés hors de la partie publique du serveur</span>
        </div>
      )}
      {!d.documents.length ? <div className="card-body"><Empty icon={FileText}>Aucun document.</Empty></div> : (
        <ul className="list">{d.documents.map(doc => (
          <li key={doc.id} className="list-row">
            <a className="row" style={{ gap: 10 }} href={doc.url} target="_blank" rel="noreferrer"><FileText className="ico" /><span><b>{doc.label}</b><div className="small muted">{meta?.document_kinds[doc.kind]} · {doc.original_name} · ajouté par {doc.uploaded_by_name || '—'}</div></span></a>
            <span className="row" style={{ gap: 8 }}>
              {doc.expires_at && <Badge tone={doc.expires_at < now ? 'danger' : 'warn'}>{doc.expires_at < now ? 'expiré' : 'expire'} le {date(doc.expires_at)}</Badge>}
              {hr && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => del(doc)} aria-label="Supprimer"><Trash2 /></button>}
            </span>
          </li>
        ))}</ul>
      )}
    </Card>
  );
}

function Career({ d, hr, onChange }) {
  const { meta } = useRhMeta();
  const [form, setForm] = useState(false);
  const person = id => { const x = meta?.employees.find(y => y.id === id); return x ? `${x.last_name} ${x.first_name}` : `#${id}`; };
  const fmt = (k, v) => (v == null || v === '' ? '—' : k === 'base_salary' ? fcfa(v) : k === 'department' ? meta?.departments[v] || v : k === 'contract_type' ? meta?.contract_types[v] || v
    : k === 'manager_id' ? person(v) : k === 'team' ? (v || []).map(person).join(', ') : /date/.test(k) ? date(v) : String(v));
  const LABELS = { job_title: 'Poste', department: 'Service', category: 'Catégorie', base_salary: 'Salaire de base', manager_id: 'Responsable direct', team: 'Équipe rattachée', role: 'Rôle du compte', contract_type: 'Contrat', project_id: 'Affectation' };
  return (
    <Card title="Parcours dans l’entreprise" actions={hr && <button className="btn btn-sm" onClick={() => setForm(true)}><Plus />Événement</button>}>
      <PositionChanges employeeId={d.employee.id} hr={hr} onChange={onChange} />
      {!d.career.length ? <Empty icon={Briefcase}>Aucun événement.</Empty> : (
        <ul className="timeline">{d.career.map(c => (
          <li key={c.id} className={`tl-${c.kind === 'embauche' || c.kind === 'promotion' ? 'vente' : c.kind === 'avertissement' ? 'sav' : 'etape'}`}>
            <span className="tl-dot">{(meta?.career_events[c.kind] || '?')[0]}</span>
            <div>
              <div className="row-between"><b className="small">{meta?.career_events[c.kind] || c.kind}</b><span className="small muted">{date(c.date)}</span></div>
              <div className="small">{c.label}</div>
              {Object.entries(c.details || {}).filter(([, v]) => v && typeof v === 'object' && 'to' in v).map(([k, v]) => <div key={k} className="small muted">{LABELS[k] ? `${LABELS[k]} : ` : ''}{k === 'team' ? <b>{fmt(k, v.to)}</b> : <>{fmt(k, v.from)} → <b>{fmt(k, v.to)}</b></>}</div>)}
              {typeof c.details?.note === 'string' && <div className="small muted">{c.details.note}</div>}
              {Array.isArray(c.details?.privileges_removed) && <div className="small muted">Privilèges individuels retirés : {c.details.privileges_removed.length}</div>}
              {c.created_by_name && <div className="small muted">par {c.created_by_name}</div>}
            </div>
          </li>
        ))}</ul>
      )}
      {form && <CareerForm employee={d.employee} onClose={() => setForm(false)} onSaved={() => { setForm(false); onChange(); }} />}
    </Card>
  );
}

function CareerForm({ employee, onClose, onSaved }) {
  const saved = useSaved();
  const { meta } = useRhMeta();
  const [f, setF] = useState({ date: today(), kind: 'formation', label: '' });
  const [error, setError] = useState(null);
  const save = async ev => { ev.preventDefault(); try { await api.post(`${RH}/employees/${employee.id}/career`, f); saved("Événement de carrière enregistré"); onSaved(); } catch (err) { setError(err); } };
  return (
    <Modal title="Événement de carrière" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="career">Enregistrer</button></>}>
      <form id="career" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /><p className="small muted">Les changements de poste, de service, de contrat et de salaire sont tracés automatiquement.</p></div>
        <Field label="Type"><select className="select" value={f.kind} onChange={ev => setF({ ...f, kind: ev.target.value })}>{meta && Object.entries(meta.career_events).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Date"><input className="input" type="date" required value={f.date} onChange={ev => setF({ ...f, date: ev.target.value })} /></Field>
        <Field label="Description" className="full"><input className="input" required minLength={3} value={f.label} onChange={ev => setF({ ...f, label: ev.target.value })} autoFocus /></Field>
      </form>
    </Modal>
  );
}

/** Compétences et CV : modifiables par l'employé (son propre profil) et le service RH. */
export function Profile({ employeeId, editable }) {
  const toast = useToast();
  const prof = useResource(`${RH}/employees/${employeeId}/profile`);
  const ref = useResource(`${RH}/skills`);
  const [adding, setAdding] = useState(false);
  const [line, setLine] = useState(false);
  const setLevel = async (skillId, level, expires_at) => {
    try { prof.setData(await api.put(`${RH}/employees/${employeeId}/skills/${skillId}`, { level, expires_at: expires_at || null })); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async skillId => { try { prof.setData(await api.del(`${RH}/employees/${employeeId}/skills/${skillId}`)); } catch (e) { toast(e.message, 'err'); } };
  const delLine = async l => { if (!window.confirm('Supprimer cette ligne ?')) return; try { prof.setData(await api.del(`${RH}/resume/${l.id}`)); } catch (e) { toast(e.message, 'err'); } };
  if (!prof.data || !ref.data) return <Skeleton h={200} />;
  const byType = Object.groupBy ? Object.groupBy(prof.data.skills, s => s.type_name) : prof.data.skills.reduce((m, s) => ({ ...m, [s.type_name]: [...(m[s.type_name] || []), s] }), {});
  const now = today();
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Compétences" actions={editable && <button className="btn btn-sm" onClick={() => setAdding(true)}><Plus />Compétence</button>}>
        {!prof.data.skills.length ? <Empty icon={Star}>Aucune compétence renseignée.</Empty> : Object.entries(byType).map(([type, list]) => (
          <div key={type} style={{ marginBottom: 14 }}>
            <h3 className="erp-h3">{type}</h3>
            {list.map(s => (
              <div key={s.id} className="skill-row">
                <span><b className="small">{s.skill_name}</b>{s.expires_at && <div className="small" style={{ color: s.expires_at < now ? 'var(--danger)' : 'var(--ink-3)' }}>valable jusqu’au {date(s.expires_at)}</div>}</span>
                <span className="skill-level" role="group" aria-label={`Niveau ${s.skill_name}`}>
                  {Array.from({ length: s.level_count }, (_, i) => <button key={i} disabled={!editable} className={i <= s.level ? 'on' : ''} title={ref.data.find(t => t.id === s.type_id)?.levels[i]} onClick={() => setLevel(s.skill_id, i, s.expires_at)} aria-label={ref.data.find(t => t.id === s.type_id)?.levels[i]} />)}
                  <small>{s.level_label}</small>
                </span>
                {editable && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(s.skill_id)} aria-label="Retirer"><Trash2 /></button>}
              </div>
            ))}
          </div>
        ))}
      </Card>
      <Card title="CV" actions={editable && <button className="btn btn-sm" onClick={() => setLine(true)}><Plus />Ligne</button>}>
        {!prof.data.resume.length ? <Empty>Expériences, diplômes et formations à compléter.</Empty> : (
          <ul className="timeline">{prof.data.resume.map(l => (
            <li key={l.id} className={l.kind === 'experience' ? 'tl-etape' : 'tl-note'}>
              <span className="tl-dot">{l.kind_label[0]}</span>
              <div>
                <div className="row-between"><b className="small">{l.title}</b>{editable && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => delLine(l)} aria-label="Supprimer"><Trash2 /></button>}</div>
                <div className="small muted">{l.kind_label}{l.organisation ? ` · ${l.organisation}` : ''}{l.start_date ? ` · ${date(l.start_date)}${l.end_date ? ` → ${date(l.end_date)}` : ' → aujourd’hui'}` : ''}</div>
                {l.description && <p className="small prewrap">{l.description}</p>}
              </div>
            </li>
          ))}</ul>
        )}
      </Card>
      {adding && <AddSkill types={ref.data} have={prof.data.skills.map(s => s.skill_id)} onClose={() => setAdding(false)} onAdd={async (id, level, exp) => { await setLevel(id, level, exp); setAdding(false); }} />}
      {line && <ResumeForm employeeId={employeeId} onClose={() => setLine(false)} onSaved={p => { prof.setData(p); setLine(false); }} />}
    </div>
  );
}

function AddSkill({ types, have, onClose, onAdd }) {
  const [typeId, setTypeId] = useState(types[0]?.id || '');
  const type = types.find(t => t.id === Number(typeId));
  const [skill, setSkill] = useState('');
  const [level, setLevel] = useState(0);
  const [exp, setExp] = useState('');
  return (
    <Modal title="Ajouter une compétence" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!skill} onClick={() => onAdd(Number(skill), Number(level), exp)}>Ajouter</button></>}>
      <div className="form-grid">
        <Field label="Domaine"><select className="select" value={typeId} onChange={e => { setTypeId(e.target.value); setSkill(''); setLevel(0); }}>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Compétence"><select className="select" value={skill} onChange={e => setSkill(e.target.value)}><option value="">— Choisir —</option>{type?.skills.filter(s => !have.includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Niveau"><select className="select" value={level} onChange={e => setLevel(e.target.value)}>{type?.levels.map((l, i) => <option key={l} value={i}>{l}</option>)}</select></Field>
        <Field label="Valable jusqu’au" hint="Habilitation, permis : rappel avant l’échéance"><input className="input" type="date" value={exp} onChange={e => setExp(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ResumeForm({ employeeId, onClose, onSaved }) {
  const saved = useSaved();
  const { meta } = useRhMeta();
  const [f, setF] = useState({ kind: 'experience', title: '', organisation: '', start_date: '', end_date: '', description: '' });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const kinds = { experience: 'Expérience', formation: 'Diplôme, formation', certification: 'Certification', interne: 'Formation interne SIIPAF' };
  const save = async e => { e.preventDefault(); try { const out = await api.post(`${RH}/employees/${employeeId}/resume`, f); saved("CV enregistré"); onSaved(out); } catch (err) { setError(err); } };
  return (
    <Modal title="Ligne de CV" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="resume">Ajouter</button></>}>
      <form id="resume" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Type"><select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(meta?.resume_kinds || kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Intitulé"><input className="input" required minLength={2} value={f.title} onChange={set('title')} autoFocus /></Field>
        <Field label="Entreprise / école" className="full"><input className="input" value={f.organisation} onChange={set('organisation')} /></Field>
        <Field label="Début"><input className="input" type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="Fin"><input className="input" type="date" value={f.end_date} onChange={set('end_date')} /></Field>
        <Field label="Description" className="full"><textarea className="textarea" rows={2} value={f.description} onChange={set('description')} /></Field>
      </form>
    </Modal>
  );
}

function EmployeeAttendance({ employeeId }) {
  const [month, setMonth] = useState(thisMonth());
  const [y, m] = month.split('-').map(Number);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const list = useResource(`${RH}/attendance?employee_id=${employeeId}&from=${month}-01&to=${to}`);
  const total = (list.data || []).reduce((t, a) => t + (a.hours || 0), 0);
  return (
    <Card title="Pointages" actions={<input className="input" type="month" style={{ width: 'auto' }} value={month} onChange={e => setMonth(e.target.value || thisMonth())} aria-label="Mois" />} bodyClass="">
      <ErrorBox error={list.error} />
      {!list.data ? <div className="card-body"><Skeleton h={120} /></div> : !list.data.length ? <div className="card-body"><Empty>Aucun pointage ce mois-ci.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Jour</th><th>Arrivée</th><th>Départ</th><th className="right">Durée</th><th>Lieu</th><th>Source</th></tr></thead>
          <tbody>{list.data.map(a => <tr key={a.id}><td className="small nowrap">{date(a.check_in)}</td><td className="tabular">{hm(a.check_in)}</td><td className="tabular">{hm(a.check_out)}</td><td className="right tabular">{hours(a.hours)}</td><td className="small">{a.project_name || 'Siège'}</td><td className="small muted">{a.source}{a.note ? ` · ${a.note}` : ''}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}><b>Total du mois</b></td><td className="right tabular"><b>{hours(total)}</b></td><td colSpan={2} /></tr></tfoot>
        </table></div>
      )}
    </Card>
  );
}
