/**
 * Directions et services (demande du client du 03/11), sur le modèle des postes : ajouter, modifier, archiver, fusionner,
 * supprimer ce qui n'a jamais servi. Deux niveaux : une direction regroupe des services ; un employé appartient à un service ;
 * chaque service peut être rattaché à un module de l'ERP (« Demandes du service » dans son menu). Même carte dans
 * RH › Réglages et Administration générale › Réglages ; écriture avec le privilège « Directions et services ».
 */
import { useState } from 'react';
import { Plus, Save, Network } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Field, Empty } from '@admin/components/ui';
import { useRhMeta } from '../lib/rh';
import { usePaieMeta } from '../lib/paie';

const URL = '/admin/erp/organisation';
const BLANK = { kind: 'service', label: '', direction_id: '', module: '' };

export default function OrgSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const res = useResource(URL);
  // Listes des services des autres cartes et formulaires (postes, chefs, fiche employé) relues après chaque changement
  const rhMeta = useRhMeta(), paieMeta = usePaieMeta();
  const write = can('org:structure');
  const [f, setF] = useState(BLANK);
  const [open, setOpen] = useState(null); // null : formulaire replié ; 'new' : ajout ; id : entrée modifiée
  const [merging, setMerging] = useState(null);
  const d = res.data;
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const close = () => { setOpen(null); setF(BLANK); };
  const start = (kind, unit = null) => {
    setOpen(unit ? unit.id : 'new');
    setF(unit ? { kind, label: unit.label, direction_id: unit.direction_id ? String(unit.direction_id) : '', module: unit.module || '' } : { ...BLANK, kind });
    setTimeout(() => document.getElementById('org-form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  };
  const call = async (promise, message) => {
    try { res.setData(await promise); rhMeta.reload(); paieMeta.reload(); toast(message); return true; } catch (err) { toast(err.message, 'err'); return false; }
  };
  const save = async e => {
    e.preventDefault();
    const body = { label: f.label.trim(), ...(f.kind === 'service' ? { direction_id: f.direction_id ? Number(f.direction_id) : null, module: f.module || null } : {}) };
    const ok = open === 'new'
      ? await call(api.post(URL, { kind: f.kind, ...body }), f.kind === 'direction' ? 'Direction ajoutée' : 'Service ajouté')
      : await call(api.patch(`${URL}/${open}`, body), 'Modification enregistrée');
    if (ok) close();
  };
  const toggle = u => call(api.patch(`${URL}/${u.id}`, { active: !u.active }), u.active ? 'Archivé : plus proposé dans les nouvelles saisies' : 'Réactivé');
  const remove = u => window.confirm(`Supprimer « ${u.label} » ?`) && call(api.delete(`${URL}/${u.id}`), 'Supprimé');
  const merge = async (u, into, list) => {
    const target = list.find(x => x.id === Number(into));
    if (!target) return;
    const what = u.kind === 'direction' ? `Ses services passeront à « ${target.label} ».` : `Ses ${u.employees} employé(s), ses postes, courriers, demandes et objectifs passeront à « ${target.label} ».`;
    if (!window.confirm(`Fusionner « ${u.label} » dans « ${target.label} » ? ${what}`)) return;
    if (await call(api.post(`${URL}/${u.id}/merge`, { into: target.id }), 'Fusion faite')) setMerging(null);
  };

  if (!d) return <Card title="Directions et services">{res.error ? <ErrorBox error={res.error} /> : <Skeleton h={160} />}</Card>;
  const directions = d.directions.map(x => ({ ...x, kind: 'direction' }));
  const services = [...d.directions.flatMap(x => x.services), ...d.without_direction].map(x => ({ ...x, kind: 'service' }));
  const actions = u => {
    const peers = (u.kind === 'direction' ? directions : services).filter(x => x.id !== u.id);
    return write && <>
      <button className="btn btn-ghost btn-sm" onClick={() => start(u.kind, u)}>Modifier</button>
      <button className="btn btn-ghost btn-sm" onClick={() => toggle(u)}>{u.active ? 'Archiver' : 'Réactiver'}</button>
      {merging === u.id
        ? <select className="select" style={{ width: 'auto', display: 'inline-block' }} autoFocus value="" onChange={e => merge(u, e.target.value, peers)} onBlur={() => setMerging(null)} aria-label="Fusionner dans">
            <option value="">Fusionner dans…</option>{peers.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        : <button className="btn btn-ghost btn-sm" onClick={() => setMerging(u.id)} title="Doublon ou réorganisation : tout ce qui porte l’entrée passe à l’autre">Fusionner</button>}
      {(u.kind === 'direction' ? !u.services.length : !u.used) && <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(u)}>Supprimer</button>}
    </>;
  };
  const serviceRow = s => (
    <tr key={`s${s.id}`} style={s.active ? undefined : { opacity: 0.55 }}>
      <td style={{ paddingLeft: 28 }}>{s.label}{!s.active && <span className="small muted"> · archivé</span>}</td>
      <td className="small">{s.module_label || <span className="muted">— (Mon espace)</span>}</td>
      <td className="small">{s.head || '—'}</td>
      <td className="right tabular">{s.employees}</td>
      <td className="right nowrap">{actions(s)}</td>
    </tr>
  );
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Network className="ico" />Directions et services</span>} bodyClass="">
      <div className="card-body" style={{ borderBottom: '1px solid var(--border)' }}>
        <p className="small muted" style={{ margin: 0 }}>
          Une direction regroupe des services ; chaque employé appartient à un service (fiche employé, postes, courrier, demandes, objectifs). Renommer change le libellé partout.
          {' '}Archiver retire l’entrée des nouvelles saisies sans toucher à l’historique ; fusionner fait passer tout ce qu’elle porte à une autre ; seule une entrée jamais utilisée se supprime.
          {' '}Le module de l’ERP d’un service donne à son chef et à ses membres « Demandes du service » dans le menu de ce module (sans module : depuis Mon espace). Les chefs se désignent dans RH › Réglages › Chefs de service.
        </p>
        {write && !open && (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button className="btn btn-sm" onClick={() => start('direction')}><Plus />Ajouter une direction</button>
            <button className="btn btn-primary btn-sm" onClick={() => start('service')}><Plus />Ajouter un service</button>
          </div>
        )}
      </div>
      {write && open && (
        <form id="org-form" className="card-body form-grid" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }} onSubmit={save}>
          <Field label={open === 'new' ? (f.kind === 'direction' ? 'Nouvelle direction' : 'Nouveau service') : f.kind === 'direction' ? 'Nom de la direction' : 'Nom du service'}>
            <input className="input" required minLength={2} maxLength={80} value={f.label} onChange={set('label')} placeholder={f.kind === 'direction' ? 'Direction des opérations…' : 'Trésorerie, Logistique…'} autoFocus />
          </Field>
          {f.kind === 'service' && <>
            <Field label="Direction"><select className="select" value={f.direction_id} onChange={set('direction_id')}><option value="">— Sans direction —</option>{directions.filter(x => x.active || String(x.id) === f.direction_id).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
            <Field label="Module de l’ERP" hint="« Demandes du service » apparaît dans le menu de ce module pour le chef et les membres du service">
              <select className="select" value={f.module} onChange={set('module')}><option value="">— Aucun (Mon espace) —</option>{Object.entries(d.modules).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </Field>
          </>}
          <div className="full row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm"><Save />Enregistrer</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Annuler</button>
          </div>
        </form>
      )}
      {!directions.length && !services.length ? <div className="card-body"><Empty icon={Network}>Aucune direction ni service : ajoutez-en ci-dessus.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Direction / service</th><th>Module de l’ERP</th><th>Chef</th><th className="right">Employés</th><th /></tr></thead>
          <tbody>
            {directions.map(x => [
              <tr key={`d${x.id}`} style={x.active ? { background: 'var(--surface-2)' } : { opacity: 0.55, background: 'var(--surface-2)' }}>
                <td><b>{x.label}</b>{!x.active && <span className="small muted"> · archivée</span>}</td>
                <td className="small muted">{x.services.length} service(s)</td>
                <td className="small">{x.head || '—'}</td>
                <td className="right tabular">{x.services.reduce((n, s) => n + s.employees, 0)}</td>
                <td className="right nowrap">{actions(x)}</td>
              </tr>,
              ...services.filter(s => s.direction_id === x.id).map(serviceRow),
            ])}
            {d.without_direction.length > 0 && <tr><td colSpan={5} className="small" style={{ background: 'var(--surface-2)' }}><b>Sans direction</b></td></tr>}
            {services.filter(s => !directions.some(x => x.id === s.direction_id)).map(serviceRow)}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}
