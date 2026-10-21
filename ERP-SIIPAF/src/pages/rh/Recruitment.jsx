import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Star, FileText, UserPlus, Ban, Globe, Search, Briefcase, RotateCcw, Paperclip } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Drawer } from '@admin/components/ui';
import { date, dateTime, fcfa, initials } from '@admin/lib/format';
import { RH, today, formData, useRhMeta, STAGE_COLORS } from '../../lib/rh';

/** Recrutement (référence : Odoo Recrutement) : postes ouverts, candidatures par étapes, embauche. */
export default function Recruitment() {
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const toast = useToast();
  const [job, setJob] = useState('');
  const [q, setQ] = useState('');
  const [refused, setRefused] = useState(false);
  const [open, setOpen] = useState(null);
  const [jobForm, setJobForm] = useState(null);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const jobs = useResource(`${RH}/jobs?all=1`);
  const list = useResource(`${RH}/applicants${qs({ job_id: job, q, refused: refused ? '1' : '' })}`);
  const stages = meta ? Object.entries(meta.recruit_stages) : [];
  const rows = list.data?.rows || [];
  const move = async (a, stage) => {
    setDragOver(null);
    if (!a || a.stage === stage || stage === 'embauche') { if (stage === 'embauche' && a && a.stage !== 'embauche') setOpen(a.id); return; }
    list.setData(d => ({ ...d, rows: d.rows.map(r => (r.id === a.id ? { ...r, stage } : r)) }));
    try { await api.post(`${RH}/applicants/${a.id}/move`, { stage }); } catch (e) { toast(e.message, 'err'); }
    list.reload(); jobs.reload();
  };

  return (
    <div className="recruit-layout">
      <Card title="Postes" actions={can('recrutement:write') && <button className="btn btn-sm btn-primary" onClick={() => setJobForm({})}><Plus />Poste</button>} bodyClass="">
        {!jobs.data ? <div className="card-body"><Skeleton h={160} /></div> : (
          <div className="tree">
            <button className={`tree-item ${job === '' ? 'on' : ''}`} onClick={() => setJob('')}><Briefcase />Toutes les candidatures</button>
            <button className={`tree-item ${job === 'none' ? 'on' : ''}`} onClick={() => setJob('none')}>Candidatures spontanées</button>
            {jobs.data.map(j => (
              <div key={j.id} className="job-item">
                <button className={`tree-item ${job === String(j.id) ? 'on' : ''}`} onClick={() => setJob(String(j.id))}>
                  <span style={{ minWidth: 0 }}><span className="ellipsis">{j.title}</span><small className="muted" style={{ display: 'block', fontWeight: 400 }}>{meta?.job_statuses[j.status]}{j.published ? ' · sur le site' : ''} · {j.hired}/{j.openings} pourvu(s)</small></span>
                  <span className="muted">{j.applicants}</span>
                </button>
                {can('recrutement:write') && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setJobForm(j)} aria-label={`Modifier ${j.title}`}><Pencil /></button>}
              </div>
            ))}
          </div>
        )}
        <p className="card-body small muted" style={{ borderTop: '1px solid var(--border)' }}><Globe className="ico" />Les postes « publiés » sont lus par le site (<code>/api/public/emplois</code>) ; les candidatures envoyées depuis le site (<code>/api/public/candidatures</code>, avec CV) arrivent ici et l’équipe est prévenue par e-mail.</p>
      </Card>

      <div className="stack" style={{ minWidth: 0 }}>
        <div className="row-between">
          <div className="row">
            <label className="search"><Search aria-hidden="true" /><input className="input" type="search" placeholder="Nom, e-mail…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" /></label>
            <label className="checkbox small"><input type="checkbox" checked={refused} onChange={e => setRefused(e.target.checked)} />Candidatures refusées</label>
          </div>
          {can('recrutement:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Candidature</button>}
        </div>
        <ErrorBox error={list.error} />
        {refused ? (
          <Card bodyClass="">
            {!rows.length ? <div className="card-body"><Empty>Aucune candidature refusée.</Empty></div> : <ul className="list">{rows.map(a => <li key={a.id} className="list-row clickable" onClick={() => setOpen(a.id)}><span><b>{a.name}</b><div className="small muted">{a.job_title || 'Spontanée'} · {a.refuse_label}</div></span><span className="small muted">{date(a.created_at)}</span></li>)}</ul>}
          </Card>
        ) : (
          <div className="pipeline">
            {stages.map(([st, label]) => {
              const col = rows.filter(r => r.stage === st);
              return (
                <div key={st} className={`pipe-col ${dragOver === st ? 'drop' : ''}`} onDragOver={e => { e.preventDefault(); setDragOver(st); }} onDragLeave={() => setDragOver(null)}
                  onDrop={e => { e.preventDefault(); move(rows.find(r => r.id === Number(e.dataTransfer.getData('text/plain'))), st); }}>
                  <div className="pipe-head" style={{ borderTop: `3px solid ${STAGE_COLORS[st]}`, borderRadius: 'var(--radius) var(--radius) 0 0' }}><span>{label}</span><span className="n">{col.length}</span></div>
                  <div className="pipe-list">
                    {!list.data && <Skeleton h={60} />}
                    {col.map(a => (
                      <div key={a.id} className="pipe-card" draggable={can('recrutement:write') && !a.employee_id} onDragStart={e => e.dataTransfer.setData('text/plain', String(a.id))} onClick={() => setOpen(a.id)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(a.id)}>
                        <div className="row-between" style={{ gap: 6 }}><b className="ellipsis">{a.name}</b>{a.rating > 0 && <span className="stars">{[1, 2, 3].map(n => <Star key={n} className={n <= a.rating ? 'on' : ''} style={{ width: 12, height: 12 }} aria-hidden="true" />)}</span>}</div>
                        <div className="meta">{a.job_title || 'Candidature spontanée'}</div>
                        <div className="row-between" style={{ marginTop: 6, gap: 6 }}><span className="small muted">{a.source_label}</span>{a.interview_at && <span className="small">{dateTime(a.interview_at)}</span>}{a.cv_url && <FileText className="ico" aria-label="CV joint" />}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {open && <ApplicantDrawer id={open} onClose={() => setOpen(null)} onChange={() => { list.reload(); jobs.reload(); }} />}
      {jobForm && <JobForm job={jobForm} onClose={() => setJobForm(null)} onSaved={() => { setJobForm(null); jobs.reload(); }} />}
      {creating && <ApplicantForm jobs={jobs.data || []} jobId={job && job !== 'none' ? job : ''} onClose={() => setCreating(false)} onSaved={a => { setCreating(false); list.reload(); jobs.reload(); setOpen(a.id); }} />}
    </div>
  );
}

function JobForm({ job, onClose, onSaved }) {
  const { meta } = useRhMeta();
  const [f, setF] = useState({
    title: job.title || '', department: job.department || 'chantier', project_id: job.project_id || '', contract_type: job.contract_type || 'cdi', openings: job.openings || 1,
    location: job.location || '', description: job.description || '', status: job.status || 'ouvert', published: !!job.published, closing_date: job.closing_date || '',
  });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault();
    const body = { ...f, openings: Number(f.openings), project_id: Number(f.project_id) || null, closing_date: f.closing_date || null, location: f.location || null, description: f.description || null };
    try { await (job.id ? api.patch(`${RH}/jobs/${job.id}`, body) : api.post(`${RH}/jobs`, body)); onSaved(); } catch (err) { setError(err); }
  };
  return (
    <Modal title={job.id ? job.title : 'Nouveau poste'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="job">Enregistrer</button></>}>
      <form id="job" className="form-grid wide-form" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Intitulé du poste" className="full"><input className="input" required minLength={3} value={f.title} onChange={set('title')} autoFocus /></Field>
        <Field label="Service"><select className="select" value={f.department} onChange={set('department')}>{meta && Object.entries(meta.departments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Contrat"><select className="select" value={f.contract_type} onChange={set('contract_type')}>{meta && Object.entries(meta.contract_types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Programme / chantier"><select className="select" value={f.project_id} onChange={set('project_id')}><option value="">Siège</option>{meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Nombre de postes"><input className="input" type="number" min="1" max="50" value={f.openings} onChange={set('openings')} /></Field>
        <Field label="Lieu"><input className="input" value={f.location} onChange={set('location')} placeholder="Abidjan, Bingerville…" /></Field>
        <Field label="Date limite de candidature"><input className="input" type="date" value={f.closing_date} onChange={set('closing_date')} /></Field>
        <Field label="Description (affichée sur le site)" className="full"><textarea className="textarea" rows={6} value={f.description} onChange={set('description')} placeholder="Missions, profil recherché, conditions…" /></Field>
        {job.id && <Field label="Statut"><select className="select" value={f.status} onChange={set('status')}>{meta && Object.entries(meta.job_statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
        <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={f.published} disabled={f.status !== 'ouvert'} onChange={set('published')} />Publier sur le site (page carrières)</label>
      </form>
    </Modal>
  );
}

function ApplicantForm({ jobs, jobId, onClose, onSaved }) {
  const { meta } = useRhMeta();
  const [f, setF] = useState({ job_id: jobId, name: '', email: '', phone: '', source: 'autre', expected_salary: '', available_from: '', message: '' });
  const [cv, setCv] = useState(null);
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => { e.preventDefault(); try { onSaved(await api.post(`${RH}/applicants`, formData(f, { cv }))); } catch (err) { setError(err); } };
  return (
    <Modal title="Nouvelle candidature" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="app">Enregistrer</button></>}>
      <form id="app" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Prénom et nom" className="full"><input className="input" required minLength={3} value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Poste"><select className="select" value={f.job_id} onChange={set('job_id')}><option value="">Candidature spontanée</option>{jobs.filter(j => j.status === 'ouvert').map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select></Field>
        <Field label="Source"><select className="select" value={f.source} onChange={set('source')}>{meta && Object.entries(meta.recruit_sources).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Téléphone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Prétentions (FCFA / mois)"><input className="input" type="number" min="0" value={f.expected_salary} onChange={set('expected_salary')} /></Field>
        <Field label="Disponible le"><input className="input" type="date" value={f.available_from} onChange={set('available_from')} /></Field>
        <Field label="CV" className="full"><label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{cv ? cv.name : 'Joindre le CV'}<input type="file" hidden accept="application/pdf,.doc,.docx,image/*" onChange={e => setCv(e.target.files[0] || null)} /></label></Field>
        <Field label="Notes" className="full"><textarea className="textarea" rows={2} value={f.message} onChange={set('message')} /></Field>
      </form>
    </Modal>
  );
}

function ApplicantDrawer({ id, onClose, onChange }) {
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const toast = useToast();
  const a = useResource(`${RH}/applicants/${id}`);
  const [note, setNote] = useState('');
  const [refuse, setRefuse] = useState('');
  const [hiring, setHiring] = useState(false);
  const [interview, setInterview] = useState(null);
  const write = can('recrutement:write');
  const post = async body => { try { a.setData(await api.post(`${RH}/applicants/${id}/move`, body)); onChange(); setNote(''); setRefuse(''); } catch (e) { toast(e.message, 'err'); } };
  const patch = async body => { try { a.setData(await api.patch(`${RH}/applicants/${id}`, formData(body))); onChange(); } catch (e) { toast(e.message, 'err'); } };
  const d = a.data;
  const stages = meta ? Object.entries(meta.recruit_stages) : [];
  return (
    <Drawer title={d ? d.name : 'Candidature'} onClose={onClose}>
      {!d ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="stagebar">
            {stages.map(([k, l]) => <button key={k} className={d.stage === k ? 'on' : ''} style={d.stage === k ? { background: STAGE_COLORS[k], borderColor: STAGE_COLORS[k] } : undefined} disabled={!write || d.employee_id || d.refuse_reason || k === 'embauche' || d.stage === k} onClick={() => post({ stage: k })}>{l}</button>)}
          </div>
          {d.refuse_reason && <div className="alert row-between">Refusée : {d.refuse_label}{write && <button className="btn btn-sm" onClick={() => post({ stage: d.stage })}><RotateCcw />Réactiver</button>}</div>}
          {d.employee_id && <div className="callout-erp"><UserPlus /><span>Embauché(e) — <Link className="link" to={`/rh/personnel/${d.employee_id}`}>ouvrir la fiche employé</Link></span></div>}
          <div>
            <div className="kv"><span>Poste</span><b>{d.job_title || 'Candidature spontanée'}</b></div>
            <div className="kv"><span>Contact</span><b>{[d.phone, d.email].filter(Boolean).join(' · ') || '—'}</b></div>
            <div className="kv"><span>Source</span><b>{d.source_label} · reçue le {date(d.created_at)}</b></div>
            <div className="kv"><span>Prétentions</span><b>{d.expected_salary ? fcfa(d.expected_salary) : '—'}</b></div>
            <div className="kv"><span>Disponible le</span><b>{d.available_from ? date(d.available_from) : '—'}</b></div>
            <div className="kv"><span>Évaluation</span><b><span className="stars-input-sm">{[1, 2, 3].map(n => <button key={n} disabled={!write} className={n <= d.rating ? 'on' : ''} onClick={() => patch({ rating: n === d.rating ? 0 : n })} aria-label={`${n} étoile(s)`}><Star /></button>)}</span></b></div>
            <div className="kv"><span>Entretien</span><b>{d.interview_at ? `${dateTime(d.interview_at)}${d.interviewer_name ? ` avec ${d.interviewer_name}` : ''}` : '—'} {write && <button className="btn btn-ghost btn-sm" onClick={() => setInterview(d.interview_at ? d.interview_at.slice(0, 16) : `${today()}T10:00`)}>Planifier</button>}</b></div>
          </div>
          {d.cv_url && <a className="btn" href={d.cv_url} target="_blank" rel="noreferrer"><FileText />Ouvrir le CV</a>}
          {d.message && <div className="erp-panel small prewrap">{d.message}</div>}
          {interview != null && (
            <div className="erp-panel row" style={{ gap: 8 }}>
              <input className="input" type="datetime-local" value={interview} onChange={e => setInterview(e.target.value)} aria-label="Date de l’entretien" style={{ width: 'auto' }} />
              <button className="btn btn-primary btn-sm" onClick={() => { patch({ interview_at: `${interview}:00Z` }); setInterview(null); }}>Enregistrer</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setInterview(null)}>Annuler</button>
            </div>
          )}
          {write && !d.employee_id && !d.refuse_reason && (
            <div className="row" style={{ gap: 8 }}>
              {d.stage === 'proposition' && <button className="btn btn-primary" onClick={() => setHiring(true)}><UserPlus />Embaucher</button>}
              <select className="select" style={{ width: 'auto' }} value={refuse} onChange={e => setRefuse(e.target.value)} aria-label="Motif de refus"><option value="">Refuser : motif…</option>{meta && Object.entries(meta.refuse_reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {refuse && <button className="btn" onClick={() => post({ refuse_reason: refuse, note: note || null })}><Ban />Refuser</button>}
            </div>
          )}
          {write && (
            <div className="reply">
              <textarea className="textarea" rows={2} placeholder="Note d’entretien, retour d’un responsable…" value={note} onChange={e => setNote(e.target.value)} />
              <button className="btn btn-sm" style={{ alignSelf: 'end' }} disabled={!note.trim()} onClick={() => post({ note })}>Ajouter la note</button>
            </div>
          )}
          <ul className="timeline">
            {d.logs.map(l => (
              <li key={l.id} className={`tl-${l.kind === 'note' ? 'note' : 'etape'}`}>
                <span className="tl-dot">{initials(l.user_name || 'S')}</span>
                <div><div className="row-between"><b className="small">{l.summary}</b><span className="small muted">{dateTime(l.created_at)}</span></div>{l.note && <p className="small prewrap">{l.note}</p>}{l.user_name && <div className="small muted">{l.user_name}</div>}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hiring && d && <HireForm applicant={d} onClose={() => setHiring(false)} onDone={() => { setHiring(false); a.reload(); onChange(); }} />}
    </Drawer>
  );
}

function HireForm({ applicant, onClose, onDone }) {
  const { meta } = useRhMeta();
  const toast = useToast();
  const [f, setF] = useState({ hire_date: applicant.available_from || today(), base_salary: applicant.proposed_salary || applicant.expected_salary || '', trial_end_date: '', contract_type: '', job_title: applicant.job_title || '' });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault();
    try {
      await api.post(`${RH}/applicants/${applicant.id}/hire`, { hire_date: f.hire_date, base_salary: Number(f.base_salary) || 0, trial_end_date: f.trial_end_date || null, ...(f.contract_type ? { contract_type: f.contract_type } : {}), ...(f.job_title ? { job_title: f.job_title } : {}) });
      toast('Fiche employé créée : complétez-la dans le dossier et la paie'); onDone();
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={`Embaucher ${applicant.name}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="hire"><UserPlus />Créer la fiche employé</button></>}>
      <form id="hire" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /><p className="small muted">La fiche reprend le nom, le contact, le poste, le service et le contrat de l’offre. Elle apparaît dans le personnel et la paie.</p></div>
        <Field label="Poste"><input className="input" value={f.job_title} onChange={set('job_title')} /></Field>
        <Field label="Contrat"><select className="select" value={f.contract_type} onChange={set('contract_type')}><option value="">Celui de l’offre</option>{meta && Object.entries(meta.contract_types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Date d’entrée"><input className="input" type="date" required value={f.hire_date} onChange={set('hire_date')} /></Field>
        <Field label="Fin de la période d’essai"><input className="input" type="date" value={f.trial_end_date} onChange={set('trial_end_date')} /></Field>
        <Field label="Salaire de base (FCFA)" className="full"><input className="input" type="number" min="0" value={f.base_salary} onChange={set('base_salary')} /></Field>
      </form>
    </Modal>
  );
}
