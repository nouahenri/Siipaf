/**
 * Comptes ayant un rôle donné : ouvert au clic sur « N compte(s) » dans les grilles de privilèges
 * (dashboard « Rôles & privilèges » et onglet « Rôles et privilèges » de chaque module de l'ERP).
 * `userHref(u)` donne le lien vers la fiche du compte ; `internal` = lien dans la même application (react-router).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserCog, Search } from 'lucide-react';
import { useResource } from '../lib/app-context';
import { Drawer, Badge, Empty, ErrorBox, Skeleton } from './ui';
import { initials, relative } from '../lib/format';

export default function RoleUsersDrawer({ role, onClose, userHref, internal = false }) {
  const data = useResource(`/admin/permissions/roles/${encodeURIComponent(role.id)}/users`);
  const [q, setQ] = useState('');
  const users = data.data?.users || [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? users.filter(u => `${u.name} ${u.email} ${u.phone || ''}`.toLowerCase().includes(needle)) : users;
  const active = users.filter(u => u.active).length;

  const row = u => (
    <div className="row" style={{ gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="avatar" aria-hidden="true">{initials(u.name)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{u.name}</strong>
        <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
        <div className="small muted">
          Dernière connexion : {u.last_login_at ? relative(u.last_login_at) : 'jamais'}
          {u.overrides > 0 && ` · ${u.overrides} privilège(s) individuel(s)`}
        </div>
      </div>
      {u.active ? <Badge tone="ok">Actif</Badge> : <Badge>Désactivé</Badge>}
    </div>
  );

  return (
    <Drawer title={`Comptes « ${role.label} »`} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Fermer</button>}>
      <ErrorBox error={data.error} />
      {data.loading && !data.data ? <Skeleton h={160} /> : data.data && (
        <div className="stack" style={{ gap: 12 }}>
          <p className="small muted">
            {users.length} compte(s) — {active} actif(s){users.length - active ? `, ${users.length - active} désactivé(s)` : ''}.
            {role.description ? ` ${role.description.replace(/\.\s*$/, '')}.` : ''} Cliquez un compte pour ouvrir sa fiche (changer son rôle, ses privilèges individuels…).
          </p>
          {users.length > 6 && (
            <div className="row" style={{ gap: 6 }}>
              <Search size={15} className="muted" aria-hidden="true" />
              <input className="input" placeholder="Rechercher un nom, un e-mail…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un compte" />
            </div>
          )}
          {!users.length ? <Empty icon={UserCog}>Aucun compte n’a ce rôle.</Empty>
            : !shown.length ? <p className="small muted">Aucun compte ne correspond.</p>
            : (
              <div>
                {shown.map(u => (internal
                  ? <Link key={u.id} to={userHref(u)} className="role-user-link" style={{ display: 'block', color: 'inherit' }}>{row(u)}</Link>
                  : <a key={u.id} href={userHref(u)} className="role-user-link" style={{ display: 'block', color: 'inherit' }}>{row(u)}</a>))}
              </div>
            )}
        </div>
      )}
    </Drawer>
  );
}
