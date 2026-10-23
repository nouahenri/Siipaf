import { useEffect, useState } from 'react';
import { Plus, UserCog } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast, useSaved } from '../lib/app-context';
import { Card, Drawer, Field, Badge, Empty, ErrorBox, Skeleton } from '../components/ui';
import { initials, relative } from '../lib/format';

// L'ERP est sur erp.siipaf.com quand le dashboard est sur admin.siipaf.com (erp.localhost en local)
const erpUrl = path => `${window.location.protocol}//${window.location.host.replace(/^admin\./, 'erp.')}${path}`;

export default function UsersPage() {
  const { can } = useAuth();
  const users = useResource('/admin/users');
  // Rôles d'origine et rôles créés dans « Rôles & privilèges »
  const roles = useResource('/admin/users/roles');
  const roleLabel = id => roles.data?.find(r => r.id === id)?.label || id;
  const [edit, setEdit] = useState(null);

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">Chaque rôle donne accès aux rubriques utiles à son métier.</p>
        {can('users:write') && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus />Nouvel utilisateur</button>}
      </div>
      <ErrorBox error={users.error} />
      <Card bodyClass="">
        {users.loading && !users.data ? <div className="card-body"><Skeleton h={160} /></div>
          : !users.data?.length ? <Empty icon={UserCog}>Aucun utilisateur.</Empty>
          : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Dernière connexion</th><th>Statut</th></tr></thead>
              <tbody>{users.data.map(u => (
                <tr key={u.id} className={can('users:write') ? 'clickable' : ''} onClick={() => can('users:write') && setEdit(u)}>
                  <td><div className="row"><span className="avatar" aria-hidden="true">{initials(u.name)}</span><div><strong>{u.name}</strong><div className="small muted">{u.email}</div></div></div></td>
                  <td>{roleLabel(u.role)}</td>
                  <td className="small muted">{u.last_login_at ? relative(u.last_login_at) : 'Jamais'}</td>
                  <td>{u.active ? <Badge tone="ok">Actif</Badge> : <Badge>Désactivé</Badge>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>
      {edit && <UserDrawer user={edit} roles={roles.data || []} roleLabel={roleLabel} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); users.reload(); }} />}
    </div>
  );
}

function UserDrawer({ user, roles, roleLabel, onClose, onSaved }) {
  const toast = useToast();
  const saved = useSaved();
  const isNew = !user.id;
  const [form, setForm] = useState({ name: user.name || '', email: user.email || '', phone: user.phone || '', role: user.role || 'commercial', active: user.active ?? true, password: '' });
  const [error, setError] = useState(null);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    setError(null);
    const body = { ...form, phone: form.phone || null };
    if (!body.password) delete body.password;
    try {
      if (isNew) {
        const created = await api.post('/admin/users', body);
        // Affiché une seule fois : à transmettre à la personne (champ sélectionnable pour le copier)
        if (created.temporary_password) window.prompt(`Mot de passe provisoire de ${created.name} (affiché une seule fois) :`, created.temporary_password);
      }
      else await api.patch(`/admin/users/${user.id}`, body);
      saved(isNew ? 'Utilisateur créé' : 'Utilisateur mis à jour');
      onSaved();
    } catch (e) { setError(e); }
  };

  return (
    <Drawer title={isNew ? 'Nouvel utilisateur' : user.name} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <ErrorBox error={error} />
      {isNew && (
        // Un employé de SIIPAF se crée dans l'ERP : compte, fiche employé et poste en une fois (choix du client du 23/10)
        <div className="alert" style={{ background: 'var(--bg)', color: 'var(--ink)', marginBottom: 12 }}>
          <b>Pour un employé de SIIPAF</b>, créez plutôt le compte depuis <a className="link" href={erpUrl('/comptes')}>ERP › Comptes utilisateurs</a> : sa fiche employé et son poste sont créés en même temps (sans fiche, pas de « Mon espace » : congés, frais, demandes, documents à lire). Ici : un compte sans fiche (prestataire, agence…).
        </div>
      )}
      <div className="form-grid">
        <Field label="Nom complet" className="full"><input className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Téléphone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Rôle" className="full">
          <select className="select" value={form.role} onChange={set('role')}>
            {roles.filter(r => r.system).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            {roles.some(r => !r.system) && (
              <optgroup label="Rôles créés (Rôles & privilèges ou ERP › RH › Postes)">
                {roles.filter(r => !r.system).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </optgroup>
            )}
          </select>
        </Field>
        <Field label={isNew ? 'Mot de passe' : 'Nouveau mot de passe'} hint={isNew ? 'Laisser vide pour générer un mot de passe provisoire. La personne choisira le sien à sa première connexion.' : 'Laisser vide pour ne pas le changer. Un mot de passe fixé ici est provisoire : la personne devra le changer.'} className="full">
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        {!isNew && <label className="checkbox"><input type="checkbox" checked={form.active} onChange={set('active')} />Compte actif</label>}
      </div>
      {!isNew && user.role !== 'super_admin' && <UserPrivileges user={user} roleLabel={roleLabel} />}
    </Drawer>
  );
}

/** Privilèges propres à un compte : hérités du rôle, accordés en plus, ou retirés. */
function UserPrivileges({ user, roleLabel }) {
  const toast = useToast();
  const saved = useSaved();
  const { user: me } = useAuth();
  const catalog = useResource('/admin/permissions');
  const perms = useResource(`/admin/users/${user.id}/permissions`);
  const [overrides, setOverrides] = useState(null);
  const editable = me.role === 'super_admin';

  useEffect(() => { if (perms.data) setOverrides(perms.data.overrides); }, [perms.data]);
  if (!catalog.data || !perms.data || !overrides) return <Skeleton h={120} />;

  const fromRole = new Set(perms.data.role_permissions);
  const set = (id, v) => setOverrides(o => { const n = { ...o }; if (v === 'role') delete n[id]; else n[id] = v === 'grant'; return n; });
  const count = Object.keys(overrides).length;

  const save = async () => {
    try {
      const res = await api.put(`/admin/users/${user.id}/permissions`, { overrides });
      perms.setData(res);
      saved('Privilèges du compte enregistrés');
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <Card title={`Privilèges propres à ce compte${count ? ` (${count})` : ''}`} actions={editable && <button className="btn btn-sm btn-primary" onClick={save}>Enregistrer</button>}>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Par défaut, ce compte a les droits de son rôle ({roleLabel(user.role)}). Accordez ou retirez un droit uniquement pour cette personne.
      </p>
      <div className="stack" style={{ gap: 14 }}>
        {catalog.data.catalog.map(g => (
          <div key={g.group}>
            <div className="perm-group-title">{g.group}</div>
            {g.items.map(p => {
              const state = p.id in overrides ? (overrides[p.id] ? 'grant' : 'deny') : 'role';
              const effective = state === 'role' ? fromRole.has(p.id) : state === 'grant';
              return (
                <div key={p.id} className="perm-line">
                  <span className={`perm-dot ${effective ? 'on' : ''}`} aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0 }}>{p.label}</span>
                  <select className="select" style={{ width: 'auto', height: 32 }} value={state} disabled={!editable} onChange={e => set(p.id, e.target.value)} aria-label={p.label}>
                    <option value="role">Selon le rôle ({fromRole.has(p.id) ? 'oui' : 'non'})</option>
                    <option value="grant">Accordé</option>
                    <option value="deny">Retiré</option>
                  </select>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Card>
  );
}
