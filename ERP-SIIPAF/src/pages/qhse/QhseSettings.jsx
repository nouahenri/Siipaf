/**
 * QHSE › Réglages : seuil de sécurité, heure du contrôle du jour, délais des actions correctives (paramètres du module, comme les
 * autres modules) et grilles de points de contrôle de chaque volet (ajouter, renommer, ordonner, désactiver, supprimer).
 * Les grilles servent aux contrôles journaliers, hebdomadaires et aux audits ; un contrôle passé garde l'intitulé de son époque.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Badge, Card, ErrorBox, Skeleton } from '@admin/components/ui';
import ModuleSettings from '../ModuleSettings';
import { QH, useQhseRefs, PILLAR_ORDER } from '../../lib/qhse';

function Grid({ pillar, label, hint, items, onChange }) {
  const toast = useToast();
  const saved = useSaved();
  const [text, setText] = useState('');
  const [edit, setEdit] = useState(null); // { id, label }
  const [busy, setBusy] = useState(false);
  const mine = items.filter(i => i.pillar === pillar);
  const run = async (fn, message) => {
    setBusy(true);
    try { onChange(await fn()); if (message) saved(message); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const move = (i, d) => {
    const ids = mine.map(x => x.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    run(() => api.put(`${QH}/checkpoints/ordre`, { pillar, ids }));
  };
  const add = async e => {
    e.preventDefault();
    await run(() => api.post(`${QH}/checkpoints`, { pillar, label: text }), 'Point ajouté');
    setText('');
  };

  return (
    <Card title={label} actions={<span className="small muted">{hint}</span>} bodyClass="">
      {!mine.length ? <div className="card-body"><p className="small muted" style={{ margin: 0 }}>Aucun point de contrôle : le volet se note sans détail.</p></div> : (
        <ul className="list">{mine.map((c, i) => (
          <li key={c.id} className="list-row" style={{ gap: 8, opacity: c.active ? 1 : 0.6 }}>
            {edit?.id === c.id ? (
              <form className="row" style={{ flex: 1, gap: 6 }} onSubmit={e => { e.preventDefault(); run(() => api.patch(`${QH}/checkpoints/${c.id}`, { label: edit.label }), 'Point renommé').then(() => setEdit(null)); }}>
                <input className="input" autoFocus required minLength={3} maxLength={200} value={edit.label} onChange={e => setEdit({ id: c.id, label: e.target.value })} />
                <button className="btn btn-sm btn-primary" disabled={busy}><Check />Enregistrer</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>Annuler</button>
              </form>
            ) : (
              <>
                <button type="button" style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => setEdit({ id: c.id, label: c.label })} title="Renommer">{c.label}{!c.active && <> <Badge>Désactivé</Badge></>}</button>
                <span className="row" style={{ gap: 2, flexShrink: 0 }}>
                  <button type="button" className="btn btn-ghost btn-icon" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Monter"><ArrowUp /></button>
                  <button type="button" className="btn btn-ghost btn-icon" disabled={busy || i === mine.length - 1} onClick={() => move(i, 1)} aria-label="Descendre"><ArrowDown /></button>
                  <button type="button" className="btn btn-ghost btn-icon" disabled={busy} onClick={() => run(() => api.patch(`${QH}/checkpoints/${c.id}`, { active: !c.active }), c.active ? 'Point désactivé' : 'Point réactivé')} aria-label={c.active ? 'Désactiver' : 'Réactiver'} title={c.active ? 'Désactiver (n’apparaît plus dans les contrôles)' : 'Réactiver'}>{c.active ? <EyeOff /> : <Eye />}</button>
                  <button type="button" className="btn btn-ghost btn-icon" disabled={busy} onClick={() => window.confirm('Supprimer ce point de contrôle ?') && run(() => api.del(`${QH}/checkpoints/${c.id}`), 'Point supprimé')} aria-label="Supprimer"><Trash2 /></button>
                </span>
              </>
            )}
          </li>
        ))}</ul>
      )}
      <form className="card-body row" style={{ gap: 8 }} onSubmit={add}>
        <input className="input" style={{ flex: 1 }} required minLength={3} maxLength={200} placeholder="Nouveau point de contrôle" value={text} onChange={e => setText(e.target.value)} />
        <button className="btn" disabled={busy}><Plus />Ajouter</button>
      </form>
    </Card>
  );
}

export default function QhseSettings() {
  const refs = useQhseRefs();
  const res = useResource(`${QH}/checkpoints`);
  if (res.error) return <ErrorBox error={res.error} />;
  if (!refs || !res.data) return <Skeleton h={300} />;
  return (
    <div className="stack">
      <ModuleSettings module="qhse" prefs={false} />
      <h2 className="erp-h3" style={{ marginBottom: 0 }}>Grilles de points de contrôle</h2>
      <p className="small muted" style={{ margin: 0 }}>Qualité et Hygiène : chaque point reçoit une note (Mauvais, Passable, Bon, Très bon). Sécurité et Environnement : conforme, non conforme ou sans objet. Cliquez un intitulé pour le renommer. Un point déjà utilisé se désactive au lieu de se supprimer.</p>
      {PILLAR_ORDER.map(k => <Grid key={k} pillar={k} label={refs.pillars[k].label} hint={refs.pillars[k].hint} items={res.data} onChange={res.setData} />)}
    </div>
  );
}
