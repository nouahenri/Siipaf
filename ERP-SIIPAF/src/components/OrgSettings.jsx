/**
 * Directions et services (demande du client du 03/11), sur le modèle des postes : ajouter, modifier, archiver, fusionner,
 * supprimer. Deux niveaux : une direction regroupe des services ; un employé appartient à un service ; chaque service peut
 * être rattaché à un module de l'ERP (« Demandes du service » dans son menu). Glisser-déposer : ranger un service sous une
 * direction, changer l'ordre des services et des directions. Un clic sur une entrée ouvre son panneau : son personnel, à
 * réaffecter (tracé sur la fiche, l'employé prévenu), et la suppression avec un service de reprise. Même carte dans
 * RH › Réglages et Administration générale › Réglages ; écriture avec le privilège « Directions et services ».
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Save, Network, GripVertical, Trash2, ArrowRightLeft } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Field, Empty, Drawer } from '@admin/components/ui';
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
  const [panel, setPanel] = useState(null); // entrée dont le panneau est ouvert
  const [drag, setDrag] = useState(null); // entrée tirée
  const [over, setOver] = useState(null); // cible survolée : 'd12', 's4' ou 'none'
  const d = res.data;
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const close = () => { setOpen(null); setF(BLANK); };
  const start = (kind, unit = null) => {
    setOpen(unit ? unit.id : 'new');
    setF(unit ? { kind, label: unit.label, direction_id: unit.direction_id ? String(unit.direction_id) : '', module: unit.module || '' } : { ...BLANK, kind });
    setTimeout(() => document.getElementById('org-form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  };
  const call = async (promise, message) => {
    try { const data = await promise; res.setData(data); rhMeta.reload(); paieMeta.reload(); toast(message); return data; } catch (err) { toast(err.message, 'err'); return null; }
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

  // Glisser-déposer : nouvel ordre complet (directions puis services, chacun avec sa direction) envoyé au serveur
  const arrange = (moved, target) => {
    let dirs = directions.map(x => x.id);
    let svc = services.map(s => ({ id: s.id, direction_id: dirs.includes(s.direction_id) ? s.direction_id : null }));
    if (moved.kind === 'direction') {
      if (target.kind === 'service' || target.id === moved.id) return null;
      dirs = dirs.filter(i => i !== moved.id);
      dirs.splice(target.kind === 'none' ? dirs.length : dirs.indexOf(target.id), 0, moved.id);
    } else {
      if (target.id === moved.id) return null;
      svc = svc.filter(s => s.id !== moved.id);
      if (target.kind === 'service') {
        const at = svc.findIndex(s => s.id === target.id);
        svc.splice(at, 0, { id: moved.id, direction_id: svc[at].direction_id });
      } else {
        const dir = target.kind === 'direction' ? target.id : null;
        const last = svc.map(s => s.direction_id).lastIndexOf(dir);
        svc.splice(last === -1 ? svc.length : last + 1, 0, { id: moved.id, direction_id: dir });
      }
    }
    return [...dirs.map(id => ({ id, direction_id: null })), ...svc];
  };
  const targetKey = t => (t.kind === 'none' ? 'none' : `${t.kind[0]}${t.id}`);
  const dropProps = target => (!write ? {} : {
    onDragOver: e => { if (drag && arrange(drag, target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== targetKey(target)) setOver(targetKey(target)); } },
    onDragLeave: () => setOver(o => (o === targetKey(target) ? null : o)),
    onDrop: async e => {
      e.preventDefault();
      const items = drag && arrange(drag, target);
      setDrag(null); setOver(null);
      if (items) await call(api.put(`${URL}/order`, { items }), drag.kind === 'direction' ? 'Ordre des directions enregistré' : target.kind === 'service' ? 'Service déplacé' : target.kind === 'direction' ? `Service rangé sous « ${target.label} »` : 'Service sans direction');
    },
  });
  const dragProps = u => (!write ? {} : {
    draggable: true,
    onDragStart: e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(u.id)); setDrag(u); },
    onDragEnd: () => { setDrag(null); setOver(null); },
  });
  // Indicateur de dépôt : trait au-dessus (placer avant) ou fond teinté (ranger dans la direction) ; entrée tirée estompée
  const dropClass = target => [
    over === targetKey(target) && (drag?.kind === 'service' && target.kind !== 'service' ? 'org-into' : 'org-before'),
    drag && target.kind === drag.kind && target.id === drag.id && 'org-dragged',
  ].filter(Boolean).join(' ') || undefined;

  const name = (u, text) => <span className="org-name">{write && <GripVertical className="ico org-grip" aria-hidden />}<button type="button" className="link-btn" onClick={() => setPanel(u)} title="Personnel, réaffectation et suppression"
      style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'left', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
      {text}
    </button></span>;
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
      <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setPanel(u)} title="Réaffecter le personnel puis supprimer">Supprimer</button>
    </>;
  };
  const serviceRow = s => (
    <tr key={`s${s.id}`} {...dragProps(s)} {...dropProps(s)} className={dropClass(s)} style={s.active ? undefined : { opacity: 0.55 }}>
      <td style={{ paddingLeft: 28 }}>{name(s, s.label)}{!s.active && <span className="small muted"> · archivé</span>}</td>
      <td className="small">{s.module_label || <span className="muted">— (Mon espace)</span>}</td>
      <td className="small">{s.head || '—'}</td>
      <td className="right tabular">{s.employees}</td>
      <td className="right nowrap">{actions(s)}</td>
    </tr>
  );
  const none = { kind: 'none', label: 'Sans direction' };
  const loose = services.filter(s => !directions.some(x => x.id === s.direction_id));
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Network className="ico" />Directions et services</span>} bodyClass="">
      <div className="card-body" style={{ borderBottom: '1px solid var(--border)' }}>
        <p className="small muted" style={{ margin: 0 }}>
          Une direction regroupe des services ; chaque employé appartient à un service (fiche employé, postes, courrier, demandes, objectifs). Renommer change le libellé partout.
          {' '}Archiver retire l’entrée des nouvelles saisies sans toucher à l’historique ; fusionner fait passer tout ce qu’elle porte à une autre.
          {' '}Le module de l’ERP d’un service donne à son chef et à ses membres « Demandes du service » dans le menu de ce module (sans module : depuis Mon espace). Les chefs se désignent dans RH › Réglages › Chefs de direction et de service.
        </p>
        {write && <p className="small muted" style={{ margin: '6px 0 0' }}>
          <b>Glisser-déposer</b> par la poignée <GripVertical className="ico" style={{ width: 14, height: 14, verticalAlign: 'middle' }} /> : un service lâché sur une direction s’y range, lâché sur un autre service se place avant lui ; une direction se place avant une autre. <b>Cliquer sur un nom</b> ouvre son personnel pour le réaffecter ou supprimer l’entrée.
        </p>}
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
              <tr key={`d${x.id}`} {...dragProps(x)} {...dropProps(x)} className={dropClass(x)} style={x.active ? { background: 'var(--surface-2)' } : { opacity: 0.55, background: 'var(--surface-2)' }}>
                <td><b>{name(x, x.label)}</b>{!x.active && <span className="small muted"> · archivée</span>}</td>
                <td className="small muted">{x.services.length} service(s)</td>
                <td className="small">{x.head || '—'}</td>
                <td className="right tabular">{x.services.reduce((n, s) => n + s.employees, 0)}</td>
                <td className="right nowrap">{actions(x)}</td>
              </tr>,
              ...services.filter(s => s.direction_id === x.id).map(serviceRow),
            ])}
            {(loose.length > 0 || drag) && (
              <tr {...dropProps(none)} className={dropClass(none)}>
                <td colSpan={5} className="small" style={{ background: 'var(--surface-2)' }}><b>Sans direction</b>{drag && <span className="muted"> — {drag.kind === 'direction' ? 'déposer ici pour placer la direction en dernier' : 'déposer ici pour retirer le service de sa direction'}</span>}</td>
              </tr>
            )}
            {loose.map(serviceRow)}
          </tbody>
        </table></div>
      )}
      {/* Hors de la carte : son animation d'entrée (transform) piégerait le panneau fixe */}
      {panel && createPortal(<OrgPanel unit={panel} directions={directions} services={services} write={write} onClose={() => setPanel(null)} call={call} />, document.body)}
    </Card>
  );
}

/**
 * Panneau d'une direction ou d'un service : son personnel actif, réaffectable un par un ou en groupe (inscrit dans
 * l'historique de chaque fiche, l'employé prévenu), puis la suppression. Service qui a servi : une fois son personnel
 * réaffecté, ses postes, courrier, demandes, objectifs et son historique passent à un service de reprise.
 */
function OrgPanel({ unit, directions, services, write, onClose, call }) {
  const info = useResource(`${URL}/${unit.id}`);
  const [picked, setPicked] = useState([]);
  const [target, setTarget] = useState('');
  const [into, setInto] = useState('');
  const p = info.data;
  const isDir = unit.kind === 'direction';
  const reload = () => { setPicked([]); info.reload(); };
  const label = k => services.find(s => s.key === k)?.label || k;
  // Services proposés : actifs, groupés par direction ; pour un service, pas lui-même
  const choices = [...directions.map(x => [x.label, x.id]), ['Sans direction', null]]
    .map(([group, id]) => [group, services.filter(s => s.active && (id ? s.direction_id === id : !directions.some(x => x.id === s.direction_id)) && (isDir || s.id !== unit.id))])
    .filter(([, list]) => list.length);
  // Valeur : la clé du service pour réaffecter, son numéro pour le service de reprise
  const serviceOptions = by => choices.map(([group, items]) => <optgroup key={group} label={group}>{items.map(s => <option key={s.id} value={s[by]}>{s.label}</option>)}</optgroup>);

  const reassign = async () => {
    const to = services.find(s => s.key === target);
    if (!to || !picked.length) return;
    if (!window.confirm(`Réaffecter ${picked.length} employé(s) au service « ${to.label} » ? Le changement s’inscrit dans l’historique de chaque fiche et chaque employé ayant un compte est prévenu.`)) return;
    const done = await call(api.post(`${URL}/reassign`, { employee_ids: picked, department: target }), `${picked.length} employé(s) réaffecté(s) à « ${to.label} »`);
    if (done) { setTarget(''); reload(); }
  };
  const remove = async () => {
    const dest = isDir ? directions.find(x => x.id === Number(into)) : services.find(s => s.id === Number(into));
    const what = isDir
      ? `Ses ${p.services.length} service(s) passeront ${dest ? `à « ${dest.label} »` : 'sans direction'}.`
      : p.used ? `Ses postes, son courrier, ses demandes, ses objectifs et son historique passeront à « ${dest?.label} ».` : 'Il n’a jamais servi.';
    if (!window.confirm(`Supprimer ${isDir ? 'la direction' : 'le service'} « ${unit.label} » ? ${what} Cette suppression est définitive.`)) return;
    if (await call(api.del(`${URL}/${unit.id}${qs({ into })}`), isDir ? 'Direction supprimée' : 'Service supprimé')) onClose();
  };

  const all = p?.employees || [];
  const allPicked = all.length > 0 && picked.length === all.length;
  const needsInto = !isDir && p?.used > 0;
  const blocked = !isDir && all.length > 0;
  return (
    <Drawer title={<>{isDir ? 'Direction' : 'Service'} · {unit.label}</>} onClose={onClose}>
      {!p ? (info.error ? <ErrorBox error={info.error} /> : <Skeleton h={200} />) : <>
        {isDir && <p className="small muted" style={{ margin: 0 }}>Services : {p.services.length ? p.services.map(s => s.label).join(', ') : 'aucun'}.</p>}
        <section>
          <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Personnel ({all.length})</h3>
          {!all.length ? <Empty icon={Network}>Aucun employé actif {isDir ? 'dans ses services' : 'dans ce service'}.</Empty> : <>
            <div className="table-wrap"><table className="table table-compact">
              <thead><tr>
                {write && <th style={{ width: 32 }}><input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? [] : all.map(e => e.id))} aria-label="Tout sélectionner" /></th>}
                <th>Employé</th><th>Poste</th>{isDir && <th>Service</th>}
              </tr></thead>
              <tbody>{all.map(e => (
                <tr key={e.id}>
                  {write && <td><input type="checkbox" checked={picked.includes(e.id)} onChange={() => setPicked(x => (x.includes(e.id) ? x.filter(i => i !== e.id) : [...x, e.id]))} aria-label={`Sélectionner ${e.last_name} ${e.first_name}`} /></td>}
                  <td className="small"><b>{e.last_name} {e.first_name}</b><div className="muted">{e.matricule}{!e.has_account && ' · sans compte (non prévenu)'}</div></td>
                  <td className="small">{e.job_title || '—'}</td>
                  {isDir && <td className="small">{label(e.department)}</td>}
                </tr>
              ))}</tbody>
            </table></div>
            {write && (
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <select className="select" style={{ flex: '1 1 220px' }} value={target} onChange={e => setTarget(e.target.value)} aria-label="Nouveau service">
                  <option value="">Réaffecter à… (direction › service)</option>{serviceOptions('key')}
                </select>
                <button className="btn btn-primary btn-sm" disabled={!picked.length || !target} onClick={reassign}><ArrowRightLeft />Réaffecter{picked.length ? ` (${picked.length})` : ''}</button>
              </div>
            )}
            {write && <p className="small muted" style={{ margin: '6px 0 0' }}>Cochez une ou plusieurs personnes. Le changement de service s’inscrit dans l’historique de la fiche (Carrière) et l’employé est prévenu.</p>}
          </>}
        </section>
        {write && (
          <section style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Supprimer {isDir ? 'la direction' : 'le service'}</h3>
            {isDir ? (
              <Field label="Ses services passent à">
                <select className="select" value={into} onChange={e => setInto(e.target.value)}>
                  <option value="">— Sans direction —</option>{directions.filter(x => x.id !== unit.id && x.active).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </Field>
            ) : blocked ? (
              <p className="small" style={{ margin: 0 }}>Réaffectez d’abord {all.length === 1 ? 'l’employé' : `les ${all.length} employés`} ci-dessus (cochez « Tout sélectionner » pour les envoyer ensemble dans un même service).</p>
            ) : needsInto ? (
              <Field label="Service de reprise" hint={`Reprend ce que porte encore le service (${p.used} élément(s) : postes, fiches des anciens employés, courrier, demandes, objectifs, historique)`}>
                <select className="select" required value={into} onChange={e => setInto(e.target.value)}>
                  <option value="">— Choisir le service —</option>{serviceOptions('id')}
                </select>
              </Field>
            ) : <p className="small muted" style={{ margin: 0 }}>Ce service n’a jamais servi : il est supprimé sans reprise.</p>}
            <button className="btn btn-sm btn-danger" style={{ marginTop: 10 }} disabled={blocked || (needsInto && !into)} onClick={remove}><Trash2 />Supprimer {isDir ? 'la direction' : 'le service'}</button>
          </section>
        )}
      </>}
    </Drawer>
  );
}
