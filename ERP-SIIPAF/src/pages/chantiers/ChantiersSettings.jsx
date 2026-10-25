/**
 * Chantiers › Réglages : seuil d'alerte du budget, heures de travail par mois (coût horaire tiré du salaire),
 * listes réglables (postes du budget, météo du journal).
 * Distincts des Paramètres du dashboard ; modifiables par les gestionnaires des chantiers.
 */
import { useEffect, useState } from 'react';
import { Check, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Lock } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Field, Badge } from '@admin/components/ui';
import { CH } from '../../lib/chantiers';

export default function ChantiersSettings() {
  const { can } = useAuth();
  const saved = useSaved();
  const refs = useResource(`${CH}/refs`);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (refs.data) setF(Object.fromEntries(Object.entries(refs.data.settings).map(([k, v]) => [k, String(v)]))); }, [refs.data]);
  if (refs.error) return <ErrorBox error={refs.error} />;
  if (!refs.data || !f) return <Skeleton h={200} />;
  const fields = refs.data.setting_fields;
  const write = can('chantiers:write');
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const out = await api.put(`${CH}/reglages`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fields[k].options ? v : Number(v)])));
      setF(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, String(v)])));
      saved('Réglages enregistrés');
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
    <Card title="Réglages des chantiers">
      <form className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        {Object.entries(fields).map(([k, x]) => (
          <Field key={k} label={x.label} hint={x.options ? `${x.hint} (par défaut : ${x.options[x.default]})` : `${x.hint} (de ${x.min} à ${x.max} ; par défaut ${x.default})`} className="full">
            {x.options
              ? <select className="select" disabled={!write} value={f[k]} onChange={e => setF(v => ({ ...v, [k]: e.target.value }))} style={{ maxWidth: 320 }}>{Object.entries(x.options).map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
              : <input className="input" type="number" required min={x.min} max={x.max} disabled={!write} value={f[k]} onChange={e => setF(v => ({ ...v, [k]: e.target.value }))} style={{ maxWidth: 160 }} />}
          </Field>
        ))}
        {write && <div className="full"><button className="btn btn-primary" disabled={busy}><Check />Enregistrer</button></div>}
      </form>
    </Card>
    {Object.entries(refs.data.list_kinds).map(([kind, title]) => <ListEditor key={kind} kind={kind} title={title} initial={refs.data.lists[kind]} write={write} />)}
    </div>
  );
}

const LIST_HINTS = {
  poste: 'Postes du budget prévu et du coût réel (lignes de budget, factures d’achat affectées à un chantier). Les postes marqués d’un cadenas servent au calcul des coûts réels : ils se renomment mais ne se suppriment pas.',
  meteo: 'Choix proposés dans le journal quotidien des chantiers.',
  unite: 'Unités proposées pour les besoins en matériaux (sac, tonne, m³…). Une unité déjà utilisée se désactive au lieu d’être supprimée.',
};

/** Liste réglable : ajouter, renommer, ordonner, désactiver (élément utilisé) ou supprimer (jamais utilisé). */
function ListEditor({ kind, title, initial, write }) {
  const toast = useToast();
  const saved = useSaved();
  const [items, setItems] = useState(initial);
  const [label, setLabel] = useState('');
  const [edit, setEdit] = useState(null);
  const run = async (fn, msg) => { try { setItems(await fn()); if (msg) saved(msg); return true; } catch (e) { toast(e.message, 'err'); return false; } };
  const add = e => { e.preventDefault(); if (label.trim()) run(() => api.post(`${CH}/reglages/listes`, { kind, label: label.trim() }), 'Élément ajouté').then(ok => ok && setLabel('')); };
  const move = (i, d) => { const ids = items.map(x => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; run(() => api.put(`${CH}/reglages/listes/${kind}/ordre`, { ids })); };
  return (
    <Card title={title} bodyClass="">
      <p className="small muted card-body" style={{ margin: 0 }}>{LIST_HINTS[kind]}</p>
      <ul className="list">
        {items.map((it, i) => (
          <li key={it.id} className="list-row">
            {edit?.id === it.id ? (
              <form className="row" style={{ gap: 6, flex: 1 }} onSubmit={e => { e.preventDefault(); run(() => api.patch(`${CH}/reglages/listes/${it.id}`, { label: edit.label.trim() }), 'Libellé enregistré').then(ok => ok && setEdit(null)); }}>
                <input className="input" autoFocus required minLength={2} maxLength={120} value={edit.label} onChange={e => setEdit({ ...edit, label: e.target.value })} aria-label="Libellé" />
                <button className="btn btn-primary btn-sm"><Check />OK</button>
              </form>
            ) : (
              <span>{it.system && <Lock className="ico" aria-label="Utilisé par les calculs" />}{it.label}{!it.active && <> <Badge>Désactivé</Badge></>}</span>
            )}
            {write && edit?.id !== it.id && (
              <span className="row nowrap" style={{ gap: 2 }}>
                <button className="btn btn-ghost btn-icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Monter ${it.label}`}><ArrowUp /></button>
                <button className="btn btn-ghost btn-icon" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Descendre ${it.label}`}><ArrowDown /></button>
                <button className="btn btn-ghost btn-icon" onClick={() => setEdit({ id: it.id, label: it.label })} aria-label={`Renommer ${it.label}`}><Pencil /></button>
                {!it.system && <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.patch(`${CH}/reglages/listes/${it.id}`, { active: !it.active }), it.active ? 'Élément désactivé' : 'Élément réactivé')}>{it.active ? 'Désactiver' : 'Réactiver'}</button>}
                {!it.system && <button className="btn btn-ghost btn-icon" onClick={() => window.confirm(`Supprimer « ${it.label} » ? Un élément déjà utilisé se désactive au lieu d’être supprimé.`) && run(() => api.del(`${CH}/reglages/listes/${it.id}`), 'Élément supprimé')} aria-label={`Supprimer ${it.label}`}><Trash2 /></button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {write && (
        <form className="card-body row" style={{ gap: 8 }} onSubmit={add}>
          <input className="input" minLength={2} maxLength={120} value={label} onChange={e => setLabel(e.target.value)} placeholder={kind === 'poste' ? 'Études et honoraires, VRD…' : kind === 'unite' ? 'Rouleau, paquet, voyage de camion…' : 'Harmattan, brouillard…'} aria-label={`Nouvel élément : ${title}`} />
          <button className="btn btn-primary" disabled={!label.trim()}><Plus />Ajouter</button>
        </form>
      )}
    </Card>
  );
}
