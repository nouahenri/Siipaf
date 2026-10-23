import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRightLeft, X } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Field, Modal, ErrorBox, Skeleton, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { RH, today, useRhMeta } from '../lib/rh';

/** Postes de RH › Réglages, rôles proposables et motifs de changement. */
export const usePositions = () => useResource(`${RH}/positions`);

/**
 * Liste déroulante des postes (RH › Réglages). `value` : l'intitulé actuel de la fiche ; `onPick` reçoit le poste choisi
 * ({ id, title, department, category, default_role }). Un intitulé hors liste (ancienne fiche) reste affiché.
 */
export function PositionSelect({ value, onPick, required = true, positions }) {
  const { can } = useAuth();
  const list = (positions || []).filter(p => p.active || p.title === value);
  const known = list.some(p => p.title === value);
  return (
    <>
      <select className="select" required={required} value={known ? value : value ? `__${value}` : ''}
        onChange={e => { const p = list.find(x => x.title === e.target.value); if (p) onPick(p); }}>
        <option value="">— Choisir le poste —</option>
        {value && !known && <option value={`__${value}`}>{value} (hors liste)</option>}
        {list.map(p => <option key={p.id} value={p.title}>{p.title} · {p.department_label}</option>)}
      </select>
      {can('rh:settings') && <span className="small muted">Liste gérée dans <Link className="link" to="/rh/reglages">RH › Réglages</Link></span>}
    </>
  );
}

/**
 * Changement de poste (choix du client du 23/10) : nouveau poste et service, date d'effet, motif, catégorie, salaire,
 * responsable direct, équipe rattachée, rôle du compte proposé par le poste. Futur : appliqué à la date d'effet.
 */
export function ChangePositionModal({ d, onClose, onSaved }) {
  const { can, user } = useAuth();
  const { meta } = useRhMeta();
  const toast = useToast();
  const pos = usePositions();
  const e = d.employee;
  const [f, setF] = useState({
    position_id: '', department: e.department, effective_date: today(), reason: 'promotion', note: '', category: e.category || '',
    base_salary: '', change_manager: false, manager_id: e.manager_id || '', team_ids: [], role: '', reset_overrides: true,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => ev => setF(x => ({ ...x, [k]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value }));
  const positions = pos.data?.positions || [];
  const roles = pos.data?.roles || [];
  const chosen = positions.find(p => p.id === Number(f.position_id));
  const pick = ev => {
    const p = positions.find(x => x.id === Number(ev.target.value));
    setF(x => ({ ...x, position_id: ev.target.value, department: p?.department || x.department, category: p?.category || x.category, role: p?.default_role && d.user && p.default_role !== d.user.role ? p.default_role : '' }));
  };
  const toggleTeam = id => setF(x => ({ ...x, team_ids: x.team_ids.includes(id) ? x.team_ids.filter(y => y !== id) : [...x.team_ids, id] }));
  const canRole = can('users:write') && d.user && d.user.id !== user.id && (d.user.role !== 'super_admin' || user.role === 'super_admin');
  // Privilèges accordés ou retirés à la personne elle-même (Dashboard › Utilisateurs) : signalés, retirés au choix
  const userPerms = useResource(canRole && can('users:read') ? `/admin/users/${d.user.id}/permissions` : null);
  const catalog = useResource(canRole && can('users:read') ? '/admin/permissions' : null);
  const overrides = Object.entries(userPerms.data?.overrides || {});
  const permLabel = id => catalog.data?.catalog.flatMap(g => g.items).find(i => i.id === id)?.label || id;
  const others = (meta?.employees || []).filter(x => x.id !== e.id);
  const future = f.effective_date > today();
  const save = async ev => {
    ev.preventDefault(); setError(null); setBusy(true);
    try {
      const c = await api.post(`${RH}/employees/${e.id}/position`, {
        position_id: Number(f.position_id), department: f.department, effective_date: f.effective_date, reason: f.reason, note: f.note.trim() || null,
        category: f.category.trim() || null, base_salary: f.base_salary === '' ? null : Number(f.base_salary), change_manager: f.change_manager,
        manager_id: f.change_manager && f.manager_id ? Number(f.manager_id) : null, team_ids: f.team_ids, role: canRole && f.role ? f.role : null,
        reset_overrides: !!(canRole && f.role && overrides.length && f.reset_overrides),
      });
      toast(c.status === 'applique' ? `Nouveau poste appliqué : ${c.job_title}` : `Changement planifié au ${date(c.effective_date)}`);
      onSaved();
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={`Changer de poste — ${e.last_name} ${e.first_name}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="change-position" disabled={busy || !f.position_id}><Check />{future ? 'Planifier' : 'Appliquer'}</button></>}>
      {!pos.data ? <Skeleton h={240} /> : (
        <form id="change-position" className="form-grid" onSubmit={save}>
          <div className="full"><ErrorBox error={error} /><p className="small muted" style={{ margin: 0 }}>Poste actuel : <b>{e.job_title}</b> · {meta?.departments[e.department]}{e.category ? ` · ${e.category}` : ''}</p></div>
          <Field label="Nouveau poste" className="full">
            <select className="select" required value={f.position_id} onChange={pick}>
              <option value="">— Choisir —</option>
              {positions.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.title} · {p.department_label}</option>)}
            </select>
          </Field>
          <Field label="Service"><select className="select" value={f.department} onChange={set('department')}>{meta && Object.entries(meta.departments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Motif"><select className="select" value={f.reason} onChange={set('reason')}>{Object.entries(pos.data.reasons).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></Field>
          <Field label="Date d’effet" hint={future ? 'Appliqué automatiquement ce jour-là' : 'Appliqué dès l’enregistrement'}><input className="input" type="date" required value={f.effective_date} onChange={set('effective_date')} /></Field>
          <Field label="Catégorie professionnelle"><input className="input" maxLength={40} value={f.category} onChange={set('category')} /></Field>
          {can('paie:employees') ? (
            <Field label="Nouveau salaire de base (FCFA)" hint={e.base_salary != null ? `Actuel : ${fcfa(e.base_salary)} ; vide = inchangé` : 'Vide = inchangé'}><input className="input" type="number" min="0" value={f.base_salary} onChange={set('base_salary')} /></Field>
          ) : <p className="small muted" style={{ alignSelf: 'end' }}>Le salaire se révise dans Comptabilité › Employés (droit paie).</p>}
          <label className="full row" style={{ gap: 6 }}><input type="checkbox" checked={f.change_manager} onChange={set('change_manager')} />Changer son responsable direct</label>
          {f.change_manager && (
            <Field label="Nouveau responsable direct" className="full">
              <select className="select" value={f.manager_id} onChange={set('manager_id')}><option value="">— Aucun —</option>{others.map(x => <option key={x.id} value={x.id}>{x.last_name} {x.first_name}</option>)}</select>
            </Field>
          )}
          <Field label="Équipe à lui rattacher" hint="Ces employés l’auront pour responsable direct (congés, notes de frais, demandes)" className="full">
            <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
              {others.filter(x => !f.department || x.department === f.department || f.team_ids.includes(x.id)).map(x => (
                <label key={x.id} className="row" style={{ gap: 6, padding: '2px 0' }}><input type="checkbox" checked={f.team_ids.includes(x.id)} onChange={() => toggleTeam(x.id)} />{x.last_name} {x.first_name} <span className="small muted">{x.matricule}</span></label>
              ))}
              <p className="small muted" style={{ margin: '4px 0 0' }}>Employés du service choisi.</p>
            </div>
          </Field>
          {d.user ? (
            <Field label="Rôle du compte (droits dans le dashboard et l’ERP)" className="full" hint={canRole ? `Actuel : ${roles.find(r => r.id === d.user.role)?.label || d.user.role}${chosen?.default_role ? ` — le poste propose « ${roles.find(r => r.id === chosen.default_role)?.label} »` : ''}` : 'Réservé aux personnes qui gèrent les utilisateurs'}>
              <select className="select" disabled={!canRole} value={f.role} onChange={set('role')}><option value="">Inchangé</option>{roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
            </Field>
          ) : <p className="full small muted" style={{ margin: 0 }}>Pas de compte relié : aucun droit à ajuster.</p>}
          {canRole && f.role && overrides.length > 0 && (
            <div className="full" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <p className="small" style={{ margin: '0 0 6px' }}><b>Privilèges propres à la personne</b> (en plus ou en moins de son rôle actuel) :</p>
              <ul className="small" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                {overrides.map(([p, granted]) => <li key={p}>{granted ? 'accordé' : 'retiré'} : {permLabel(p)}</li>)}
              </ul>
              <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={f.reset_overrides} onChange={set('reset_overrides')} />Les retirer : le nouveau rôle s’applique seul
              </label>
            </div>
          )}
          <Field label="Commentaire" className="full"><input className="input" maxLength={500} value={f.note} onChange={set('note')} placeholder="Note de nomination du…" /></Field>
        </form>
      )}
    </Modal>
  );
}

/** Changements de poste de la fiche (planifiés, appliqués, annulés). */
export function PositionChanges({ employeeId, hr, onChange }) {
  const toast = useToast();
  const list = useResource(`${RH}/employees/${employeeId}/position-changes`);
  if (!list.data?.length) return null;
  const cancel = async c => {
    if (!window.confirm('Annuler ce changement planifié ?')) return;
    try { await api.del(`${RH}/position-changes/${c.id}`); toast('Changement annulé'); list.reload(); onChange?.(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <ul className="list">{list.data.map(c => (
      <li key={c.id} className="list-row">
        <span><b>{c.job_title}</b> · {c.department_label}<div className="small muted">{c.reason_label} · effet le {date(c.effective_date)}{c.created_by_name ? ` · saisi par ${c.created_by_name}` : ''}{c.note ? ` · ${c.note}` : ''}</div></span>
        <span className="row" style={{ gap: 6 }}>
          <Badge tone={c.status === 'applique' ? 'ok' : c.status === 'planifie' ? 'warn' : ''}>{c.status === 'applique' ? 'Appliqué' : c.status === 'planifie' ? 'Planifié' : 'Annulé'}</Badge>
          {hr && c.status === 'planifie' && <button className="btn btn-ghost btn-icon" aria-label="Annuler ce changement" onClick={() => cancel(c)}><X /></button>}
        </span>
      </li>
    ))}</ul>
  );
}

/**
 * Nouveau rôle et ses privilèges, sans quitter l'ERP (même table que Dashboard › Rôles et privilèges : le rôle y
 * apparaît aussitôt, et inversement). Réservé au super administrateur et au droit « Créer de nouveaux rôles » ; un
 * privilège qu'on n'a pas soi-même reste grisé. Régler un rôle existant reste au super administrateur.
 */
export function NewRoleModal({ onClose, onCreated }) {
  const toast = useToast();
  const perms = useResource('/admin/permissions');
  const [f, setF] = useState({ label: '', description: '', from: '', permissions: [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = perms.data;
  const mine = d?.my_permissions || [];
  const allowed = p => mine.includes('*') || mine.includes(p);
  const toggle = p => setF(x => ({ ...x, permissions: x.permissions.includes(p) ? x.permissions.filter(y => y !== p) : [...x.permissions, p] }));
  const copy = id => {
    const role = d.roles.find(r => r.id === id);
    setF(x => ({ ...x, from: id, permissions: role ? role.permissions.filter(p => p !== '*' && allowed(p)) : [] }));
  };
  const save = async e => {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const role = await api.post('/admin/permissions/roles', { label: f.label.trim(), description: f.description.trim() || null, permissions: f.permissions });
      toast(`Rôle « ${role.label} » créé avec ${f.permissions.length} privilège(s)`);
      onCreated(role);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title="Nouveau rôle et ses privilèges" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="new-role" disabled={busy || !d?.can_create}><Check />Créer le rôle</button></>}>
      {perms.error ? <ErrorBox error={perms.error} /> : !d ? <Skeleton h={240} /> : !d.can_create ? (
        <p className="small">Créer un rôle demande le droit « Créer de nouveaux rôles » (ou le super administrateur).</p>
      ) : (
        <form id="new-role" className="stack" style={{ gap: 12 }} onSubmit={save}>
          <ErrorBox error={error} />
          <div className="form-grid">
            <Field label="Nom du rôle"><input className="input" required minLength={2} maxLength={120} value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} placeholder="Directeur des ressources humaines, secrétaire…" autoFocus /></Field>
            <Field label="Partir des privilèges de" hint="Coche d’office ses privilèges, à ajuster ensuite">
              <select className="select" value={f.from} onChange={e => copy(e.target.value)}><option value="">— Aucun —</option>{d.roles.filter(r => !r.locked).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
            </Field>
            <Field label="Description" className="full"><input className="input" maxLength={255} value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} /></Field>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{f.permissions.length} privilège(s) coché(s). Le rôle apparaît aussitôt dans Dashboard › Rôles et privilèges, où le super administrateur peut l’ajuster.{!mine.includes('*') && ' Les privilèges que vous n’avez pas vous-même sont grisés.'}</p>
          <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            {d.catalog.map(g => (
              <fieldset key={g.group} style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
                <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{g.group}</legend>
                {g.items.map(i => (
                  <label key={i.id} style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, alignItems: 'flex-start', padding: '3px 0', cursor: 'pointer', opacity: allowed(i.id) ? 1 : 0.5 }} title={i.hint || undefined}>
                    <input type="checkbox" disabled={!allowed(i.id)} checked={f.permissions.includes(i.id)} onChange={() => toggle(i.id)} style={{ marginTop: 3, flexShrink: 0 }} />
                    <span className="small">{i.label}{i.hint && <span className="muted"> — {i.hint}</span>}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </form>
      )}
    </Modal>
  );
}

export const ChangePositionButton =({ onClick }) => <button className="btn btn-sm" onClick={onClick}><ArrowRightLeft />Changer de poste</button>;
