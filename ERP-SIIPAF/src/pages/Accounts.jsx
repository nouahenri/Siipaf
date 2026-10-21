import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, UserCog, Copy, KeyRound, ShieldCheck, ExternalLink } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge, Drawer } from '@admin/components/ui';
import { initials, relative } from '@admin/lib/format';
import { useRhMeta } from '../lib/rh';

/**
 * Comptes utilisateurs depuis l'ERP : mêmes comptes que le dashboard (un seul compte par personne pour le dashboard
 * et l'ERP). Création avec mot de passe provisoire et rattachement à une fiche employé.
 */
export default function Accounts() {
  const { can } = useAuth();
  const users = useResource('/admin/users');
  const roles = useResource('/admin/users/roles');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState(null);
  const [created, setCreated] = useState(null);
  const roleLabel = id => roles.data?.find(r => r.id === id)?.label || id;
  const rows = (users.data || []).filter(u => !q || `${u.name} ${u.email} ${roleLabel(u.role)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <div className="callout-erp"><ShieldCheck /><span className="small">Un compte par personne, valable pour le dashboard et l’ERP. Son <b>rôle</b> décide des modules et des actions permises (page « Rôles et privilèges » de chaque module). Les ouvriers sans compte pointent sur la borne avec leur matricule.</span></div>
      <div className="row-between">
        <label className="search"><Search aria-hidden="true" /><input className="input" type="search" placeholder="Nom, e-mail, rôle…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un compte" /></label>
        {can('users:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouveau compte</button>}
      </div>
      <ErrorBox error={users.error} />
      <Card bodyClass="">
        {!users.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? <div className="card-body"><Empty icon={UserCog}>Aucun compte.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Compte</th><th>Rôle</th><th>Fiche employé</th><th>Dernière connexion</th><th>Statut</th></tr></thead>
            <tbody>{rows.map(u => (
              <tr key={u.id} className={can('users:write') ? 'clickable' : ''} onClick={() => can('users:write') && setEdit(u)}>
                <td><span className="row" style={{ gap: 10 }}><span className="avatar xs">{initials(u.name)}</span><span><b>{u.name}</b><div className="small muted">{u.email}</div></span></span></td>
                <td className="small">{roleLabel(u.role)}</td>
                <td className="small">{u.employee ? <Link className="link" to={`/rh/personnel/${u.employee.id}`} onClick={e => e.stopPropagation()}>{u.employee.matricule} · {u.employee.job_title}</Link> : <span className="muted">—</span>}</td>
                <td className="small muted">{u.last_login_at ? relative(u.last_login_at) : 'Jamais'}</td>
                <td>{!u.active ? <Badge>Désactivé</Badge> : u.must_change_password ? <Badge tone="warn">Mot de passe provisoire</Badge> : <Badge tone="ok">Actif</Badge>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {creating && <NewAccount roles={roles.data || []} onClose={() => setCreating(false)} onCreated={r => { setCreating(false); setCreated(r); users.reload(); }} />}
      {created && <TemporaryPassword account={created} onClose={() => setCreated(null)} />}
      {edit && <EditAccount user={edit} roles={roles.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); users.reload(); }} onReset={r => { setEdit(null); setCreated(r); users.reload(); }} />}
    </div>
  );
}

const assignable = (roles, me) => roles.filter(r => r.id !== 'super_admin' || me.role === 'super_admin');

function NewAccount({ roles, onClose, onCreated }) {
  const { can, user } = useAuth();
  const { meta } = useRhMeta();
  const files = can('rh:files') || can('paie:employees');
  const unlinked = useResource(files ? '/admin/users/unlinked-employees' : null);
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'commercial', link: files ? 'create' : 'none', employee_id: '', job_title: '', department: 'administratif', hire_date: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const pick = e => {
    const id = Number(e.target.value);
    const emp = unlinked.data?.find(x => x.id === id);
    setF(x => ({ ...x, employee_id: e.target.value, ...(emp && !x.name ? { name: `${emp.first_name} ${emp.last_name}`, email: emp.email || x.email } : {}) }));
  };
  const save = async e => {
    e.preventDefault(); setError(null); setBusy(true);
    const body = { name: f.name, email: f.email, phone: f.phone || null, role: f.role };
    if (f.link === 'existing') body.employee_id = Number(f.employee_id);
    if (f.link === 'create') body.employee = { job_title: f.job_title, department: f.department, hire_date: f.hire_date };
    try { onCreated(await api.post('/admin/users', body)); } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title="Nouveau compte utilisateur" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="new-account" disabled={busy}>Créer le compte</button></>}>
      <form id="new-account" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Prénom et nom" className="full"><input className="input" required minLength={2} value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="E-mail (identifiant de connexion)"><input className="input" type="email" required value={f.email} onChange={set('email')} /></Field>
        <Field label="Téléphone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Rôle" className="full" hint="Modules et actions permises : page « Rôles et privilèges » de chaque module">
          <select className="select" value={f.role} onChange={set('role')}>{assignable(roles, user).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </Field>
        {files && (
          <Field label="Fiche employé" className="full">
            <div className="seg" role="group" aria-label="Fiche employé">
              {[['create', 'Créer la fiche'], ['existing', 'Relier une fiche existante'], ['none', 'Sans fiche']].map(([k, l]) => <button type="button" key={k} className={f.link === k ? 'active' : ''} onClick={() => setF(x => ({ ...x, link: k }))}>{l}</button>)}
            </div>
          </Field>
        )}
        {f.link === 'existing' && (
          <Field label="Fiche sans compte" className="full">
            <select className="select" required value={f.employee_id} onChange={pick}><option value="">— Choisir —</option>{unlinked.data?.map(x => <option key={x.id} value={x.id}>{x.last_name} {x.first_name} · {x.matricule} · {x.job_title}</option>)}</select>
          </Field>
        )}
        {f.link === 'create' && <>
          <Field label="Poste"><input className="input" required minLength={2} value={f.job_title} onChange={set('job_title')} placeholder="Commerciale, comptable…" /></Field>
          <Field label="Service"><select className="select" value={f.department} onChange={set('department')}>{meta && Object.entries(meta.departments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Date d’entrée" hint="Salaire et contrat se complètent ensuite dans Comptabilité › Employés"><input className="input" type="date" required value={f.hire_date} onChange={set('hire_date')} /></Field>
        </>}
        <p className="full small muted"><KeyRound className="ico" />Un mot de passe provisoire est généré : vous le transmettez à la personne, qui en choisit un nouveau à sa première connexion.</p>
      </form>
    </Modal>
  );
}

/** Mot de passe provisoire : affiché une seule fois. */
function TemporaryPassword({ account, onClose }) {
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(account.temporary_password); toast('Mot de passe copié'); } catch { toast('Copie impossible : recopiez-le à la main', 'err'); } };
  const login = `${window.location.protocol}//${window.location.host}`;
  return (
    <Modal title={account.name ? `Compte de ${account.name}` : 'Nouveau mot de passe provisoire'} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>J’ai transmis le mot de passe</button>}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="small">Transmettez ces informations à la personne en main propre ou par un canal sûr. <b>Le mot de passe ne sera plus affiché</b> ; il devra être changé à la première connexion.</p>
        <div className="erp-panel">
          {account.email && <div className="kv"><span>Identifiant</span><b>{account.email}</b></div>}
          <div className="kv"><span>Mot de passe provisoire</span><b className="tabular temp-password">{account.temporary_password}</b></div>
          <div className="kv"><span>Adresse</span><b>{login}</b></div>
        </div>
        <button className="btn" style={{ alignSelf: 'start' }} onClick={copy}><Copy />Copier le mot de passe</button>
      </div>
    </Modal>
  );
}

function EditAccount({ user: u, roles, onClose, onSaved, onReset }) {
  const { can, user: me } = useAuth();
  const toast = useToast();
  const files = can('rh:files') || can('paie:employees');
  const unlinked = useResource(files ? '/admin/users/unlinked-employees' : null);
  const [f, setF] = useState({ name: u.name, phone: u.phone || '', role: u.role, active: u.active });
  const [employee, setEmployee] = useState(u.employee?.id ? String(u.employee.id) : '');
  const [error, setError] = useState(null);
  const self = u.id === me.id;
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    setError(null);
    try {
      await api.patch(`/admin/users/${u.id}`, { ...f, phone: f.phone || null });
      if (files && employee !== (u.employee?.id ? String(u.employee.id) : '')) await api.put(`/admin/users/${u.id}/employee`, { employee_id: employee ? Number(employee) : null });
      toast('Compte mis à jour'); onSaved();
    } catch (e) { setError(e); }
  };
  const reset = async () => {
    if (!window.confirm(`Générer un nouveau mot de passe provisoire pour ${u.name} ? L’ancien ne fonctionnera plus.`)) return;
    try { const r = await api.post(`/admin/users/${u.id}/reset-password`); onReset({ ...r, name: u.name, email: u.email }); } catch (e) { setError(e); }
  };
  return (
    <Drawer title={u.name} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <ErrorBox error={error} />
        <p className="small muted">{u.email}</p>
        <Field label="Nom"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Téléphone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Rôle"><select className="select" value={f.role} disabled={self} onChange={set('role')}>{assignable(roles, me).concat(roles.filter(r => r.id === u.role && !assignable(roles, me).includes(r))).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
        {files && (
          <Field label="Fiche employé">
            <select className="select" value={employee} onChange={e => setEmployee(e.target.value)}>
              <option value="">— Aucune —</option>
              {u.employee && <option value={u.employee.id}>{u.employee.matricule} · {u.employee.job_title}</option>}
              {unlinked.data?.map(x => <option key={x.id} value={x.id}>{x.last_name} {x.first_name} · {x.matricule}</option>)}
            </select>
          </Field>
        )}
        <label className="checkbox"><input type="checkbox" checked={f.active} disabled={self} onChange={set('active')} />Compte actif</label>
        {!self && <button className="btn" style={{ alignSelf: 'start' }} onClick={reset}><KeyRound />Nouveau mot de passe provisoire</button>}
        <a className="link small" href={`${window.location.protocol}//${window.location.host.replace(/^erp\./, 'admin.')}/utilisateurs`}>Gérer aussi dans le dashboard <ExternalLink className="ico" /></a>
      </div>
    </Drawer>
  );
}
