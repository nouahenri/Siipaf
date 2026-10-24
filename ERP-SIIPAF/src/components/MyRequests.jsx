import { useState } from 'react';
import { Plus, Check, Inbox } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { today } from '../lib/rh';
import PlacePicker from './PlacePicker';

const URL = '/admin/erp/demandes';
export const REQUEST_TONES = { attente_responsable: 'warn', attente_dg: 'warn', attente_sg: 'warn', en_cours: '', traitee: 'ok', refusee: 'danger', annulee: '' };

/** Mon espace : demandes internes (achat, équipement, intervention, prêt de matériel, autre) et leur avancement. */
export default function MyRequests() {
  const list = useResource(`${URL}?scope=mine`);
  const toast = useToast();
  const [form, setForm] = useState(false);
  const cancel = async r => {
    if (!window.confirm('Annuler cette demande ?')) return;
    try { await api.post(`${URL}/${r.id}/annuler`); toast('Demande annulée'); list.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title="Mes demandes internes" actions={<button className="btn btn-sm" onClick={() => setForm(true)}><Plus />Nouvelle demande</button>} bodyClass="">
      {!list.data ? <div className="card-body"><Skeleton h={60} /></div> : !list.data.length ? (
        <div className="card-body"><Empty icon={Inbox}>Fournitures, équipement pour le bureau ou le chantier, dépannage, prêt de matériel : votre responsable valide, les services généraux traitent.</Empty></div>
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Demande</th><th>Le</th><th className="right">Montant estimé</th><th>Avancement</th><th /></tr></thead>
          <tbody>{list.data.map(r => (
            <tr key={r.id}>
              <td><b>{r.title}</b><div className="small muted">{r.reference} · {r.kind_label}{r.urgency === 'urgente' ? ' · urgente' : ''}</div></td>
              <td className="small nowrap">{date(r.created_at.slice(0, 10))}</td>
              <td className="right small tabular">{r.estimated_amount ? fcfa(r.estimated_amount) : ''}</td>
              <td><Badge tone={REQUEST_TONES[r.status]}>{r.status_label}</Badge>{r.decision_note && <div className="small muted">{r.decision_note}</div>}</td>
              <td className="right">{r.rights.cancel && <button className="btn btn-ghost btn-sm" onClick={() => cancel(r)}>Annuler</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {form && <RequestForm onClose={() => setForm(false)} onSaved={() => { setForm(false); list.reload(); }} />}
    </Card>
  );
}

function RequestForm({ onClose, onSaved }) {
  const toast = useToast();
  const refs = useResource(`${URL}/refs`);
  const [f, setF] = useState({ kind: 'achat', kind_other: '', title: '', details: '', quantity: '', estimated_amount: '', site: { project_id: null, worksite_id: null, place_id: null }, location: '', needed_by: '', urgency: 'normale' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const kind = refs.data?.kinds[f.kind];
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
      body.estimated_amount = body.estimated_amount == null ? null : Number(body.estimated_amount);
      Object.assign(body, f.site);
      delete body.site;
      const r = await api.post(URL, body);
      toast(`Demande ${r.reference} envoyée — ${r.status_label.toLowerCase()}`);
      onSaved();
    } catch (err) { setError(err); setBusy(false); }
  };
  const over = kind?.purchase && refs.data && Number(f.estimated_amount) >= refs.data.threshold;
  return (
    <Modal title="Nouvelle demande interne" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="request-form" disabled={busy || !refs.data}><Check />Envoyer</button></>}>
      {!refs.data ? <Skeleton h={200} /> : (
        <form id="request-form" className="form-grid" onSubmit={save}>
          <div className="full"><ErrorBox error={error} /></div>
          <Field label="Nature"><select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(refs.data.kinds).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select></Field>
          {f.kind === 'autre' ? <Field label="Précisez"><input className="input" required maxLength={100} value={f.kind_other} onChange={set('kind_other')} placeholder="Badge, cartes de visite, accès…" /></Field>
            : <Field label="Urgence"><select className="select" value={f.urgency} onChange={set('urgency')}><option value="normale">Normale</option><option value="urgente">Urgente</option></select></Field>}
          <Field label="Objet" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} placeholder="Ramettes de papier, climatiseur en panne, groupe électrogène pour le chantier…" /></Field>
          <Field label="Détails" className="full"><textarea className="textarea" rows={3} maxLength={4000} value={f.details} onChange={set('details')} /></Field>
          <Field label="Quantité"><input className="input" maxLength={60} value={f.quantity} onChange={set('quantity')} placeholder="10 cartons, 2 unités…" /></Field>
          <Field label={kind?.purchase ? 'Montant estimé (FCFA)' : 'Montant estimé (facultatif)'} hint={over ? `Au-delà de ${fcfa(refs.data.threshold)} : validation de la direction générale` : undefined}>
            <input className="input" type="number" min="0" required={!!kind?.purchase} value={f.estimated_amount} onChange={set('estimated_amount')} />
          </Field>
          <Field label="Pour" hint="Programme, chantier ou lieu ; vide : siège social"><PlacePicker value={f.site} onChange={v => setF(x => ({ ...x, site: v }))} /></Field>
          <Field label="Lieu"><input className="input" maxLength={120} value={f.location} onChange={set('location')} placeholder="Siège, bureau 3, dépôt…" /></Field>
          <Field label="Pour le"><input className="input" type="date" min={today()} value={f.needed_by} onChange={set('needed_by')} /></Field>
        </form>
      )}
    </Modal>
  );
}
