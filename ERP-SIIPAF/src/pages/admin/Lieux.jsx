/**
 * Administration générale › Lieux (choix du client du 24/10) : siège social, bureaux annexes, dépôts et autres
 * emplacements hors programmes. Ils servent d'imputation aux achats, dépenses du Parc, notes de frais, demandes,
 * pointages et contrats, et d'axe analytique à la Comptabilité. Le siège reçoit tout ce qui n'est imputé nulle part.
 */
import { useState } from 'react';
import { Plus, Pencil, Check, Trash2, MapPinned, Info } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Modal, Badge } from '@admin/components/ui';

const URL = '/admin/erp/lieux';

export default function Lieux() {
  const { can } = useAuth();
  const write = can('lieux:write');
  const res = useResource(`${URL}?tous=1`);
  const [form, setForm] = useState(null);
  const data = res.data;
  return (
    <div className="stack">
      <div className="callout-erp"><Info /><span className="small">
        Lieux hors programmes : on les choisit comme imputation des achats, dépenses du parc, notes de frais, demandes internes, pointages et contrats.
        La Comptabilité en fait un axe analytique (états par lieu). Une pièce sans programme ni lieu est imputée au <b>siège social</b>.
      </span></div>
      <Card title="Lieux" actions={write && <button className="btn btn-primary" onClick={() => setForm({})}><Plus />Nouveau lieu</button>} bodyClass="">
        <ErrorBox error={res.error} />
        {!data ? <div className="card-body"><Skeleton h={160} /></div> : !data.places.length ? <div className="card-body"><Empty icon={MapPinned}>Aucun lieu.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Lieu</th><th>Type</th><th>Emplacement</th><th>État</th>{write && <th />}</tr></thead>
            <tbody>{data.places.map(p => (
              <tr key={p.id}>
                <td><b>{p.name}</b></td>
                <td>{p.kind === 'siege' ? <Badge tone="brand">{p.kind_label}</Badge> : p.kind_label}</td>
                <td className="small">{[p.address, p.location_label, p.city_label].filter(Boolean).join(', ') || '—'}</td>
                <td>{p.active ? <Badge tone="ok">Proposé</Badge> : <Badge>Désactivé</Badge>}</td>
                {write && <td className="right"><button className="btn btn-ghost btn-icon" onClick={() => setForm(p)} aria-label={`Modifier ${p.name}`}><Pencil /></button></td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {form && data && <PlaceForm place={form.id ? form : null} kinds={data.kinds} cities={data.cities} locations={data.locations} onClose={() => setForm(null)} onSaved={list => { setForm(null); res.setData(d => ({ ...d, places: list })); }} />}
    </div>
  );
}

function PlaceForm({ place: p, kinds, cities, locations, onClose, onSaved }) {
  const saved = useSaved();
  const toast = useToast();
  const [f, setF] = useState({ kind: p?.kind || 'annexe', kind_other: p?.kind_other || '', name: p?.name || '', address: p?.address || '', city_id: p?.city_id || '', location_id: p?.location_id || '', active: p ? p.active : true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const siege = p?.kind === 'siege';
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = { ...f, kind_other: f.kind === 'autre' ? f.kind_other.trim() || null : null, address: f.address.trim() || null, city_id: Number(f.city_id) || null, location_id: Number(f.location_id) || null };
      const list = p ? await api.patch(`${URL}/${p.id}`, body) : await api.post(URL, body);
      saved(p ? 'Lieu enregistré' : 'Lieu ajouté');
      onSaved(list);
    } catch (err) { setError(err); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Supprimer le lieu « ${p.name} » ? Un lieu déjà utilisé se désactive au lieu d’être supprimé.`)) return;
    try { onSaved(await api.del(`${URL}/${p.id}`)); saved('Lieu supprimé'); } catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Modal title={p ? `Lieu « ${p.name} »` : 'Nouveau lieu'} onClose={onClose}
      footer={<>
        {p && !siege && <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={remove}><Trash2 />Supprimer</button>}
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="place-form" disabled={busy}><Check />Enregistrer</button>
      </>}>
      <form id="place-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Type" hint={siege ? 'Le siège social garde son type : il reçoit les pièces sans programme ni lieu' : 'Un seul siège social'}>
          <select className="select" value={f.kind} disabled={siege} onChange={set('kind')}>{Object.entries(kinds).filter(([k]) => siege || k !== 'siege').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        {f.kind === 'autre' ? <Field label="Type précis"><input className="input" required maxLength={80} value={f.kind_other} onChange={set('kind_other')} placeholder="Logement de fonction, terrain en prospection…" /></Field> : <div />}
        <Field label="Nom" className="full"><input className="input" required minLength={2} maxLength={160} value={f.name} onChange={set('name')} placeholder="Bureau annexe de Yamoussoukro, dépôt de Bingerville…" /></Field>
        <Field label="Ville" hint="Liste réglée dans le dashboard (Paramètres › Villes)">
          <select className="select" value={f.city_id} onChange={e => setF(x => ({ ...x, city_id: e.target.value, location_id: '' }))}>
            <option value="">—</option>{cities.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Localité" hint={f.city_id ? 'Localités de cette ville (Paramètres › Localisations)' : 'Choisissez d’abord la ville'}>
          <select className="select" value={f.location_id} disabled={!f.city_id} onChange={set('location_id')}>
            <option value="">—</option>{locations.filter(l => String(l.city_id) === String(f.city_id)).map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Field>
        <Field label="Adresse ou repère" className="full"><input className="input" maxLength={255} value={f.address} onChange={set('address')} placeholder="Rue, immeuble, repère…" /></Field>
        {!siege && <label className="full row small" style={{ gap: 8 }}><input type="checkbox" checked={f.active} onChange={e => setF(x => ({ ...x, active: e.target.checked }))} />Proposé dans les listes (décoché : gardé sur les pièces déjà saisies, plus proposé)</label>}
      </form>
    </Modal>
  );
}
