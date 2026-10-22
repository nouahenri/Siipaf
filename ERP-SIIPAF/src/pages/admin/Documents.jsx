import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, BookOpenCheck, Check, Pencil, Send, Archive, Paperclip, FileText, Search, Trash2, GitBranch, ListChecks, Undo2 } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Drawer, Modal, Badge } from '@admin/components/ui';
import { date, dateTime } from '@admin/lib/format';
import { today, formData } from '../../lib/rh';

const URL = '/admin/erp/documents';
const STATUS_TONES = { brouillon: 'warn', publie: 'ok', archive: '' };

/**
 * Documents internes (choix du client du 22/10) : notes de service, procédures et règlements (versions), PV de
 * réunion (actions suivies), modèles et formulaires ; diffusion à tous, par service ou à des personnes ; accusé
 * « J'ai lu et compris » avec délai et relances. La direction et les services généraux publient pour tous, un chef
 * de service pour son service.
 */
export default function Documents() {
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const refs = useResource(`${URL}/refs`);
  const list = useResource(`${URL}${qs({ kind, status, q })}`);
  const open = Number(params.get('fiche')) || null;
  const setOpen = id => setParams(id ? { fiche: String(id) } : {}, { replace: true });
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const scope = refs.data?.scope;
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {refs.data && (
            <>
              <select className="select" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)} aria-label="Sorte"><option value="">Tous les documents</option>{Object.entries(refs.data.kinds).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select>
              <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut"><option value="">Tous les statuts</option>{Object.entries(refs.data.statuses).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </>
          )}
          <label style={{ position: 'relative' }}>
            <Search aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, opacity: 0.5 }} />
            <input className="input" style={{ paddingLeft: 32, width: 220 }} type="search" placeholder="Référence, titre…" value={text} onChange={e => setText(e.target.value)} aria-label="Rechercher" />
          </label>
        </div>
        {scope?.can_publish && <button className="btn btn-primary" onClick={() => setForm({})}><Plus />Nouveau document</button>}
      </div>
      {scope && !scope.all && scope.chief && <p className="small muted" style={{ margin: 0 }}>Chef de service : vos documents sont diffusés à votre service.</p>}
      <Card bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !list.data.length ? <div className="card-body"><Empty icon={BookOpenCheck}>Aucun document.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Référence</th><th>Document</th><th>Diffusion</th><th>Lectures</th><th>Délai</th><th>Statut</th></tr></thead>
            <tbody>{list.data.map(d => (
              <tr key={d.id} className="clickable" onClick={() => setOpen(d.id)}>
                <td className="small tabular nowrap"><b>{d.reference}</b>{d.version > 1 && <div className="muted">v{d.version}</div>}</td>
                <td>{d.title}<div className="small muted">{d.kind_label}{d.author_name ? ` · ${d.author_name}` : ''}</div></td>
                <td className="small">{d.audience_label}{d.audience === 'services' && refs.data ? ` : ${d.audience_departments.map(k => refs.data.departments[k]).join(', ')}` : ''}</td>
                <td className="small tabular">{d.status === 'brouillon' ? '—' : d.ack_required ? `${d.reads} / ${d.recipients}` : `${d.recipients} destinataire(s)`}</td>
                <td className="small nowrap">{d.ack_deadline ? date(d.ack_deadline) : '—'}</td>
                <td><Badge tone={STATUS_TONES[d.status]}>{d.status_label}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {open && refs.data && <DocDrawer id={open} refs={refs.data} onClose={() => setOpen(null)} onChange={list.reload} onEdit={d => setForm({ doc: d })} />}
      {form && refs.data && <DocForm doc={form.doc} refs={refs.data} onClose={() => setForm(null)} onSaved={d => { setForm(null); list.reload(); setOpen(d.id); }} />}
    </div>
  );
}

function DocDrawer({ id, refs, onClose, onChange, onEdit }) {
  const toast = useToast();
  const x = useResource(`${URL}/${id}`);
  const d = x.data;
  const [version, setVersion] = useState(false);
  const [action, setAction] = useState(false);
  const call = async (path, body, message, method = 'post') => {
    try { const r = await api[method](`${URL}${path}`, body); if (r?.id) x.setData(r); onChange(); toast(message); return r; } catch (e) { toast(e.message, 'err'); return null; }
  };
  const remove = async () => {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    if (await call(`/${id}`, undefined, 'Brouillon supprimé', 'del')) onClose();
  };
  return (
    <Drawer title={d ? `${d.reference} · ${d.kind_label}` : 'Document'} onClose={onClose}>
      {x.error ? <ErrorBox error={x.error} /> : !d ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={STATUS_TONES[d.status]}>{d.status_label}</Badge>
            {d.version > 1 && <Badge>Version {d.version}</Badge>}
            {d.ack_required && <Badge>Accusé de lecture{d.ack_deadline ? ` avant le ${date(d.ack_deadline)}` : ''}</Badge>}
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px' }}>{d.title}</h3>
            <div className="kv"><span>Diffusion</span><b>{d.audience_label}{d.audience === 'services' ? ` : ${d.audience_departments.map(k => refs.departments[k]).join(', ')}` : d.audience === 'personnes' ? ` (${d.audience_users.length})` : ''}</b></div>
            {d.meeting_date && <div className="kv"><span>Réunion du</span><b>{date(d.meeting_date)}</b></div>}
            <div className="kv"><span>Auteur</span><b>{d.author_name || '—'}{d.published_at ? ` · publié le ${dateTime(d.published_at)}` : ''}</b></div>
          </div>
          {d.body && <div className="erp-panel" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 260, overflow: 'auto' }}>{d.body}</div>}
          {d.file_url && <a className="btn" style={{ alignSelf: 'start' }} href={d.file_url} target="_blank" rel="noreferrer"><FileText />Ouvrir {d.file_name || 'le fichier'}</a>}

          {d.can_manage && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {d.status === 'brouillon' && <button className="btn btn-primary" onClick={() => window.confirm('Publier et prévenir les destinataires ?') && call(`/${id}/publier`, {}, 'Document publié — les destinataires sont prévenus')}><Send />Publier</button>}
              {d.status !== 'archive' && <button className="btn" onClick={() => onEdit(d)}><Pencil />Modifier</button>}
              {d.status === 'publie' && <button className="btn" onClick={() => setVersion(true)}><GitBranch />Nouvelle version</button>}
              {d.status === 'publie' && <button className="btn btn-ghost" onClick={() => call(`/${id}/archiver`, {}, 'Document archivé')}><Archive />Archiver</button>}
              {d.status === 'archive' && <button className="btn btn-ghost" onClick={() => call(`/${id}/archiver`, {}, 'Document republié')}><Undo2 />Republier</button>}
              {d.status === 'brouillon' && <button className="btn btn-ghost" onClick={remove}><Trash2 />Supprimer</button>}
            </div>
          )}

          {d.kind === 'pv' && (
            <div className="erp-panel">
              <div className="row-between"><b>Actions décidées</b>{d.can_manage && <button className="btn btn-ghost btn-sm" onClick={() => setAction(true)}><Plus />Action</button>}</div>
              {!d.actions.length ? <p className="small muted" style={{ margin: '6px 0 0' }}>Aucune action : ajoutez celles décidées en réunion (responsable, échéance).</p> : d.actions.map(a => (
                <div key={a.id} className="kv">
                  <span style={{ flexShrink: 1 }}>{a.label}<div className="small muted">{a.owner_name || '—'}{a.due_date ? ` · avant le ${date(a.due_date)}` : ''}{a.done_note ? ` · ${a.done_note}` : ''}</div></span>
                  <b className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <Badge tone={a.status === 'fait' ? 'ok' : a.late ? 'danger' : ''}>{a.late ? 'En retard' : a.status_label}</Badge>
                    {d.can_manage && <button className="btn btn-ghost btn-icon" title={a.status === 'fait' ? 'Rouvrir' : 'Déclarer faite'} aria-label={a.status === 'fait' ? 'Rouvrir' : 'Déclarer faite'} onClick={() => call(`/actions/${a.id}`, { status: a.status === 'fait' ? 'a_faire' : 'fait' }, 'Action mise à jour', 'patch')}>{a.status === 'fait' ? <Undo2 /> : <ListChecks />}</button>}
                  </b>
                </div>
              ))}
              {action && <ActionForm refs={refs} onCancel={() => setAction(false)} onSubmit={async body => { if (await call(`/${id}/actions`, body, 'Action ajoutée')) setAction(false); }} />}
            </div>
          )}

          {d.tracking && (
            <div className="erp-panel">
              <div className="row-between"><b>Suivi des lectures {d.version > 1 ? `(version ${d.version})` : ''}</b><span className="small">{d.ack_required ? `${d.tracking.read} / ${d.tracking.total} lu(s)${d.tracking.late ? ` · ${d.tracking.late} en retard` : ''}` : `${d.tracking.total} destinataire(s)`}</span></div>
              {d.ack_required && d.tracking.total > 0 && <div className="progress" style={{ margin: '8px 0' }}><span style={{ width: `${Math.round((d.tracking.read / d.tracking.total) * 100)}%` }} /></div>}
              {d.ack_required && d.tracking.people.map(p => (
                <div key={p.user_id} className="kv"><span style={{ flexShrink: 1 }}>{p.name}{p.department_label && <div className="small muted">{p.department_label}</div>}</span>
                  <b>{p.read_at ? <Badge tone="ok">lu le {date(p.read_at.slice(0, 10))}</Badge> : <Badge tone={p.late ? 'danger' : 'warn'}>{p.late ? 'en retard' : 'non lu'}</Badge>}</b></div>
              ))}
            </div>
          )}

          {d.versions.length > 0 && (
            <div className="erp-panel">
              <b>Versions publiées</b>
              {d.versions.map(v => <div key={v.version} className="kv"><span style={{ flexShrink: 1 }}>Version {v.version}{v.change_note && <div className="small muted">{v.change_note}</div>}</span><b className="small">{dateTime(v.published_at)}{v.published_by_name ? ` · ${v.published_by_name}` : ''}</b></div>)}
            </div>
          )}
        </div>
      )}
      {version && d && <VersionForm d={d} onClose={() => setVersion(false)} onSaved={data => { setVersion(false); x.setData(data); onChange(); }} />}
    </Drawer>
  );
}

function ActionForm({ refs, onCancel, onSubmit }) {
  const [f, setF] = useState({ label: '', owner_id: '', due_date: '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  return (
    <div className="form-grid" style={{ marginTop: 10 }}>
      <Field label="Action" className="full"><input className="input" maxLength={255} value={f.label} onChange={set('label')} placeholder="Commander les fers pour l’îlot 4…" /></Field>
      <Field label="Responsable"><select className="select" value={f.owner_id} onChange={set('owner_id')}><option value="">—</option>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      <Field label="Échéance"><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></Field>
      <div className="full row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={f.label.trim().length < 2} onClick={() => onSubmit({ label: f.label.trim(), owner_id: f.owner_id ? Number(f.owner_id) : null, due_date: f.due_date || null })}><Check />Ajouter</button>
        <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

function VersionForm({ d, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ change_note: '', body: d.body || '', ack_deadline: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try { onSaved(await api.post(`${URL}/${d.id}/version`, formData({ ...f, ack_deadline: f.ack_deadline || 'null' }, { file }))); toast('Nouvelle version publiée — chacun doit relire'); } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={`Nouvelle version de ${d.reference}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy || f.change_note.trim().length < 3} onClick={save}><Send />Publier la version {d.version + 1}</button></>}>
      <div className="form-grid">
        <Field label="Ce qui change" className="full"><input className="input" maxLength={255} value={f.change_note} onChange={set('change_note')} placeholder="Article 4 : nouveaux horaires du chantier" /></Field>
        <Field label="Texte" className="full"><textarea className="textarea" rows={8} value={f.body} onChange={set('body')} /></Field>
        <Field label="Nouveau délai de lecture"><input className="input" type="date" min={today()} value={f.ack_deadline} onChange={set('ack_deadline')} /></Field>
        <Field label="Fichier"><label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : 'Remplacer le fichier'}<input type="file" hidden onChange={e => setFile(e.target.files[0] || null)} /></label></Field>
      </div>
    </Modal>
  );
}

function DocForm({ doc: d, refs, onClose, onSaved }) {
  const toast = useToast();
  const scope = refs.scope;
  const [f, setF] = useState({
    kind: d?.kind || 'note', title: d?.title || '', body: d?.body || '', audience: d?.audience || (scope.all ? 'tous' : 'services'),
    audience_departments: d?.audience_departments || (scope.all ? [] : [scope.department]), audience_users: d?.audience_users || [],
    ack_required: d?.ack_required ?? true, ack_deadline: d?.ack_deadline || '', meeting_date: d?.meeting_date || '',
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggle = (k, v) => setF(x => ({ ...x, [k]: x[k].includes(v) ? x[k].filter(y => y !== v) : [...x[k], v] }));
  const published = d && d.status !== 'brouillon';
  const ackable = refs.kinds[f.kind]?.ack;
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const fields = {
        title: f.title, audience: f.audience, audience_departments: JSON.stringify(f.audience_departments), audience_users: JSON.stringify(f.audience_users),
        ack_required: ackable && f.ack_required, ack_deadline: f.ack_deadline || 'null',
        ...(published ? {} : { kind: f.kind, body: f.body || 'null', meeting_date: f.meeting_date || 'null' }),
      };
      const saved = d ? await api.patch(`${URL}/${d.id}`, formData(fields, { file })) : await api.post(URL, formData(fields, { file }));
      toast(d ? 'Document enregistré' : `Brouillon ${saved.reference} enregistré`);
      onSaved(saved);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={d ? `Modifier ${d.reference}` : 'Nouveau document'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="doc-form" disabled={busy}><Check />Enregistrer</button></>}>
      <form id="doc-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} />{published && <p className="small muted" style={{ margin: 0 }}>Document publié : le contenu change par « Nouvelle version ».</p>}</div>
        <Field label="Sorte"><select className="select" disabled={!!d} value={f.kind} onChange={set('kind')}>{Object.entries(refs.kinds).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select></Field>
        {f.kind === 'pv' ? <Field label="Réunion du"><input className="input" type="date" disabled={published} value={f.meeting_date} onChange={set('meeting_date')} /></Field> : <div />}
        <Field label="Titre" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} /></Field>
        {!published && <Field label={f.kind === 'pv' ? 'Ordre du jour et décisions' : 'Texte'} className="full"><textarea className="textarea" rows={7} value={f.body} onChange={set('body')} /></Field>}
        {!published && <Field label="Fichier" className="full" hint="PDF, Word, Excel, PowerPoint ou image ; 20 Mo au plus"><label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : d?.file_url ? 'Remplacer le fichier' : 'Joindre un fichier'}<input type="file" hidden onChange={e => setFile(e.target.files[0] || null)} /></label></Field>}
        <Field label="Diffusion">
          <select className="select" disabled={!scope.all} value={f.audience} onChange={set('audience')}>{Object.entries(refs.audiences).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        {ackable ? <Field label="À lire avant le" hint="Relance la veille puis une fois le délai passé"><input className="input" type="date" min={today()} value={f.ack_deadline} onChange={set('ack_deadline')} disabled={!f.ack_required} /></Field> : <div />}
        {f.audience === 'services' && (
          <div className="full row" style={{ gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(refs.departments).map(([k, l]) => <label key={k} className="row" style={{ gap: 6 }}><input type="checkbox" disabled={!scope.all} checked={f.audience_departments.includes(k)} onChange={() => toggle('audience_departments', k)} />{l}</label>)}
          </div>
        )}
        {f.audience === 'personnes' && (
          <div className="full" style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            {refs.users.map(u => <label key={u.id} className="row" style={{ gap: 6, padding: '3px 0' }}><input type="checkbox" checked={f.audience_users.includes(u.id)} onChange={() => toggle('audience_users', u.id)} />{u.name}</label>)}
          </div>
        )}
        {ackable && <label className="full row" style={{ gap: 6 }}><input type="checkbox" checked={f.ack_required} onChange={set('ack_required')} />Demander l’accusé « J’ai lu et compris »</label>}
      </form>
    </Modal>
  );
}
