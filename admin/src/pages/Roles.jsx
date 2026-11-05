import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ShieldCheck, Lock, RotateCcw, Save, Info, Plus, Pencil, Trash2, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast, useSaved } from '../lib/app-context';
import { Card, ErrorBox, Skeleton, Badge, Drawer, Field } from '../components/ui';
import { permRows } from '../lib/permissions';

/**
 * Version imprimée de la grille (bouton « Imprimer ») : privilèges ENREGISTRÉS (pas les cases modifiées non enregistrées),
 * A4 paysage, rôles par tranches de 10 colonnes (la colonne des privilèges est répétée sur chaque tranche).
 * Invisible à l'écran ; à l'impression, elle remplace toute la page (styles.css, « roles-print »).
 */
const PRINT_COLS = 10;
function RolesPrint({ catalog, roles }) {
  const { user } = useAuth();
  const has = (r, id) => r.locked || r.permissions.includes(id);
  const chunks = [];
  for (let i = 0; i < roles.length; i += PRINT_COLS) chunks.push(roles.slice(i, i + PRINT_COLS));
  return (
    <article className="roles-print" aria-hidden="true">
      <header className="roles-print-head">
        <img src="/logo-siipaf.png" alt="SIIPAF SA" />
        <div>
          <h2>Rôles et privilèges</h2>
          <div>{roles.length} rôle(s) — privilèges enregistrés</div>
          <div className="small">Édité le {new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}{user?.name ? ` par ${user.name}` : ''}</div>
        </div>
      </header>
      {chunks.map((part, k) => (
        <table key={k} className="roles-print-table">
          <thead>
            <tr>
              <th>Privilège{chunks.length > 1 ? ` (rôles ${k * PRINT_COLS + 1} à ${k * PRINT_COLS + part.length} sur ${roles.length})` : ''}</th>
              {part.map(r => <th key={r.id}>{r.label}<small>{r.users_total ?? 0} compte(s)</small></th>)}
            </tr>
          </thead>
          <tbody>
            {catalog.map(g => [
              <tr key={g.group} className="grp"><td colSpan={part.length + 1}>{g.group}</td></tr>,
              ...permRows(g.items).map(p => (p.heading ? (
                <tr key={`h:${p.heading}`} className="head">
                  <td>{p.heading}</td>
                  {part.map(r => {
                    const n = p.ids.filter(id => has(r, id)).length;
                    return <td key={r.id}>{n === p.ids.length ? '✓' : n ? `${n}/${p.ids.length}` : ''}</td>;
                  })}
                </tr>
              ) : (
                <tr key={p.id} className={p.parent ? 'sub' : undefined}>
                  <td>{p.label}</td>
                  {part.map(r => <td key={r.id}>{has(r, p.id) ? '✓' : ''}</td>)}
                </tr>
              ))),
            ])}
          </tbody>
        </table>
      ))}
    </article>
  );
}

/** Grille des privilèges : une colonne par rôle, une ligne par privilège, regroupés par domaine. */
export default function Roles() {
  const toast = useToast();
  const saved = useSaved();
  const data = useResource('/admin/permissions');
  const [draft, setDraft] = useState({}); // rôle → Set de privilèges
  const [saving, setSaving] = useState(null);
  const [roleForm, setRoleForm] = useState(null); // {} = nouveau rôle, sinon le rôle à renommer

  useEffect(() => {
    if (data.data) setDraft(Object.fromEntries(data.data.roles.map(r => [r.id, new Set(r.permissions)])));
  }, [data.data]);

  const d = data.data;
  const editable = d?.can_edit;
  const roles = d?.roles || [];
  const changed = useMemo(() => Object.fromEntries(roles.map(r => {
    const a = draft[r.id] || new Set(), b = new Set(r.permissions);
    return [r.id, a.size !== b.size || [...a].some(p => !b.has(p))];
  })), [draft, roles]);

  const toggle = (role, perm) => setDraft(x => {
    const s = new Set(x[role]);
    s.has(perm) ? s.delete(perm) : s.add(perm);
    return { ...x, [role]: s };
  });
  // Ligne d'intitulé : coche ou décoche toutes les actions détaillées du privilège
  const toggleAll = (role, ids, on) => setDraft(x => {
    const s = new Set(x[role]);
    ids.forEach(id => (on ? s.add(id) : s.delete(id)));
    return { ...x, [role]: s };
  });

  const save = async role => {
    setSaving(role.id);
    try {
      await api.put(`/admin/permissions/roles/${role.id}`, { permissions: [...draft[role.id]] });
      saved(`Privilèges du rôle « ${role.label} » enregistrés`);
      data.reload();
    } catch (e) { toast(e.message, 'err'); } finally { setSaving(null); }
  };
  const reset = async role => {
    if (!window.confirm(`Revenir aux privilèges par défaut pour « ${role.label} » ?`)) return;
    try { await api.post(`/admin/permissions/roles/${role.id}/reset`); toast('Privilèges par défaut rétablis'); data.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async role => {
    if (role.users_total > 0) {
      toast(`« ${role.label} » est encore attribué à ${role.users_total} compte(s) : changez d’abord leur rôle dans Utilisateurs.`, 'err');
      return;
    }
    if (!window.confirm(`Supprimer le rôle « ${role.label} » ?`)) return;
    try { await api.del(`/admin/permissions/roles/${role.id}`); toast(`Rôle « ${role.label} » supprimé`); data.reload(); } catch (e) { toast(e.message, 'err'); }
  };

  if (data.loading && !d) return <Skeleton h={400} />;
  if (data.error) return <ErrorBox error={data.error} />;

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted" style={{ maxWidth: 760 }}>
          Cochez ce que chaque rôle peut faire. Les changements s’appliquent dès l’enregistrement, à tous les comptes du rôle.
          Pour une exception sur une seule personne, ouvrez son compte dans <Link to="/utilisateurs" style={{ textDecoration: 'underline' }}>Utilisateurs</Link>.
        </p>
        <div className="row" style={{ gap: 8 }}>
          {editable
            ? <button className="btn btn-primary" onClick={() => setRoleForm({})}><Plus />Nouveau rôle</button>
            : <Badge tone="warn"><Lock size={13} />Lecture seule — réservé au super administrateur</Badge>}
          <button className="btn" onClick={() => window.print()} title="Grille enregistrée, en A4 paysage (ou PDF)"><Printer />Imprimer</button>
        </div>
      </div>
      {createPortal(<RolesPrint catalog={d.catalog} roles={roles} />, document.body)}
      {d.users_with_overrides > 0 && (
        <div className="alert alert-info"><Info size={15} /> {d.users_with_overrides} privilège(s) individuel(s) sont définis sur des comptes précis, en plus de cette grille.</div>
      )}

      <Card bodyClass="">
        <div className="table-wrap perm-wrap">
          <table className="table perm-table">
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>Privilège</th>
                {roles.map(r => (
                  <th key={r.id} className="perm-col" title={r.description || undefined}>
                    <div>{r.label}</div>
                    <small className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                      {r.users} compte(s){!r.system && ' · créé ici'}
                    </small>
                    {editable && !r.locked && (
                      <div className="row" style={{ gap: 2, justifyContent: 'center', marginTop: 4 }}>
                        <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setRoleForm(r)} title="Renommer" aria-label={`Renommer « ${r.label} »`}><Pencil /></button>
                        <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => remove(r)} title="Supprimer" aria-label={`Supprimer « ${r.label} »`}><Trash2 /></button>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.catalog.map(g => [
                <tr key={g.group} className="perm-group"><td colSpan={roles.length + 1}><span>{g.group}</span></td></tr>,
                ...permRows(g.items).map(p => (p.heading ? (
                  <tr key={`h:${p.heading}`} className="perm-parent">
                    <td><strong>{p.heading}</strong><div className="small muted">Cochez le tout ou action par action</div></td>
                    {roles.map(r => {
                      const n = r.locked ? p.ids.length : p.ids.filter(id => draft[r.id]?.has(id)).length;
                      return (
                        <td key={r.id} className="perm-col">
                          <label className="perm-check" title={r.locked ? 'Le super administrateur a tous les droits' : n === p.ids.length ? 'Tout retirer' : 'Tout cocher'}>
                            <input type="checkbox" checked={n === p.ids.length} ref={el => { if (el) el.indeterminate = n > 0 && n < p.ids.length; }} disabled={!editable || r.locked}
                              onChange={() => toggleAll(r.id, p.ids, n !== p.ids.length)} aria-label={`${p.heading} (toutes les actions) — ${r.label}`} />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ) : (
                  <tr key={p.id} className={p.parent ? 'perm-sub' : undefined}>
                    <td>
                      <strong style={{ fontWeight: 500 }}>{p.label}</strong>
                      {p.hint && <div className="small muted">{p.hint}</div>}
                    </td>
                    {roles.map(r => {
                      const on = r.locked || draft[r.id]?.has(p.id);
                      const isDefault = r.defaults.includes(p.id) || r.locked;
                      return (
                        <td key={r.id} className="perm-col">
                          <label className={`perm-check ${on !== isDefault && !r.locked ? 'diff' : ''}`} title={r.locked ? 'Le super administrateur a tous les droits' : on !== isDefault ? 'Différent du réglage par défaut' : ''}>
                            <input type="checkbox" checked={!!on} disabled={!editable || r.locked} onChange={() => toggle(r.id, p.id)} aria-label={`${p.label} — ${r.label}`} />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))),
              ])}
            </tbody>
            {editable && (
              <tfoot>
                <tr>
                  <td className="small muted">Les cases entourées diffèrent du réglage par défaut.</td>
                  {roles.map(r => (
                    <td key={r.id} className="perm-col">
                      {r.locked ? <ShieldCheck size={18} className="muted" aria-label="Tous les droits" /> : (
                        <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
                          <button className="btn btn-sm btn-primary" disabled={!changed[r.id] || saving === r.id} onClick={() => save(r)}><Save />Enregistrer</button>
                          {r.system && <button className="btn btn-sm btn-ghost" onClick={() => reset(r)} title="Revenir au réglage par défaut"><RotateCcw />Défaut</button>}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
      {roleForm && (
        <RoleDrawer role={roleForm} catalog={d.catalog} roles={roles} onClose={() => setRoleForm(null)}
          onSaved={() => { setRoleForm(null); data.reload(); }} />
      )}
    </div>
  );
}

/** Création d'un rôle (libellé, description, droits cochés) ou renommage d'un rôle existant. */
function RoleDrawer({ role, catalog, roles, onClose, onSaved }) {
  const toast = useToast();
  const saved = useSaved();
  const isNew = !role.id;
  const [form, setForm] = useState({ label: role.label || '', description: role.description || '' });
  const [perms, setPerms] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggle = id => setPerms(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Partir des droits d'un rôle existant, puis ajuster
  const copyFrom = id => {
    const src = roles.find(r => r.id === id);
    if (src) setPerms(new Set(src.locked ? catalog.flatMap(g => g.items.map(p => p.id)) : src.permissions));
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = { label: form.label, description: form.description || null };
      if (isNew) await api.post('/admin/permissions/roles', { ...body, permissions: [...perms] });
      else await api.patch(`/admin/permissions/roles/${role.id}`, body);
      saved(isNew ? `Rôle « ${form.label.trim()} » créé` : 'Rôle renommé');
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Drawer title={isNew ? 'Nouveau rôle' : `Renommer « ${role.label} »`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy || form.label.trim().length < 2} onClick={save}>{isNew ? 'Créer le rôle' : 'Enregistrer'}</button></>}>
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="Nom du rôle" className="full" hint={isNew ? 'Ex. : Assistant commercial, Juriste, Secrétariat…' : 'Les comptes de ce rôle et leurs droits ne changent pas.'}>
          <input className="input" value={form.label} maxLength={120} autoFocus onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        </Field>
        <Field label="Description (facultatif)" className="full">
          <input className="input" value={form.description} maxLength={255} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </Field>
      </div>
      {isNew && (
        <div className="stack" style={{ gap: 14, marginTop: 20 }}>
          <div className="row-between">
            <strong>Ce que ce rôle peut faire</strong>
            <select className="select" style={{ width: 'auto', height: 32 }} value="" onChange={e => copyFrom(e.target.value)} aria-label="Partir des droits d’un rôle existant">
              <option value="">Partir des droits de…</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          {catalog.map(g => (
            <div key={g.group}>
              <div className="perm-group-title">{g.group}</div>
              {permRows(g.items).map(p => (p.heading ? <div key={`h:${p.heading}`} className="perm-line perm-line-parent">{p.heading}</div> : (
                <label key={p.id} className={`perm-line checkbox ${p.parent ? 'perm-line-sub' : ''}`} style={{ display: 'flex' }}>
                  <input type="checkbox" checked={perms.has(p.id)} onChange={() => toggle(p.id)} aria-label={p.label} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {p.label}
                    {p.hint && <span className="small muted" style={{ display: 'block' }}>{p.hint}</span>}
                  </span>
                </label>
              )))}
            </div>
          ))}
          <p className="small muted">{perms.size} privilège(s) coché(s). Vous pourrez les modifier ensuite dans la grille.</p>
        </div>
      )}
    </Drawer>
  );
}
