import { useState } from 'react';
import { Car, Plus, Check } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { today } from '../lib/rh';

const URL = '/admin/erp/parc/reservations';
export const RESERVATION_TONES = { demandee: 'warn', accordee: 'ok', refusee: 'danger', annulee: '' };
export const slotLabel = r => {
  const [d1, h1] = r.start_at.split('T');
  const [d2, h2] = r.end_at.split('T');
  return d1 === d2 ? `${date(d1)}, ${h1} → ${h2}` : `${date(d1)} ${h1} → ${date(d2)} ${h2}`;
};

/** Mon espace : demandes de véhicule de service ; les services généraux accordent et choisissent le véhicule. */
export default function VehicleRequests() {
  const list = useResource(`${URL}?mine=1`);
  const toast = useToast();
  const [form, setForm] = useState(false);
  const cancel = async r => {
    if (!window.confirm('Annuler cette demande de véhicule ?')) return;
    try { await api.post(`${URL}/${r.id}/cancel`); toast('Demande annulée'); list.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const now = `${today()}T00:00`;
  return (
    <Card title="Mes demandes de véhicule" actions={<button className="btn btn-sm" onClick={() => setForm(true)}><Plus />Demander un véhicule</button>} bodyClass="">
      {!list.data ? <div className="card-body"><Skeleton h={60} /></div> : !list.data.length ? (
        <div className="card-body"><Empty icon={Car}>Besoin d’un véhicule de service (visite client, banque, chantier) ? Faites la demande : les services généraux vous attribuent un véhicule.</Empty></div>
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Créneau</th><th>Motif</th><th>Véhicule</th><th>Statut</th><th /></tr></thead>
          <tbody>{list.data.map(r => (
            <tr key={r.id}>
              <td className="small nowrap">{slotLabel(r)}</td>
              <td>{r.purpose}{r.destination && <div className="small muted">{r.destination}</div>}</td>
              <td className="small">{r.asset_name ? `${r.asset_name}${r.asset_plate ? ` · ${r.asset_plate}` : ''}` : '—'}</td>
              <td><Badge tone={RESERVATION_TONES[r.status]}>{r.status_label}</Badge>{r.decision_note && <div className="small muted">{r.decision_note}</div>}</td>
              <td className="right">{['demandee', 'accordee'].includes(r.status) && r.end_at >= now && <button className="btn btn-ghost btn-sm" onClick={() => cancel(r)}>Annuler</button>}</td>
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
  const [f, setF] = useState({ date: today(), start: '08:00', end_date: today(), end: '17:00', purpose: '', destination: '', passengers: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value, ...(k === 'date' && x.end_date < e.target.value ? { end_date: e.target.value } : {}) }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post(URL, {
        start_at: `${f.date}T${f.start}`, end_at: `${f.end_date}T${f.end}`, purpose: f.purpose.trim(), destination: f.destination.trim() || null,
        passengers: f.passengers ? Number(f.passengers) : null,
      });
      toast('Demande envoyée aux services généraux');
      onSaved();
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title="Demander un véhicule" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="vehicle-form" disabled={busy}><Check />Envoyer la demande</button></>}>
      <form id="vehicle-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Départ le"><input className="input" type="date" required min={today()} value={f.date} onChange={set('date')} /></Field>
        <Field label="à"><input className="input" type="time" required value={f.start} onChange={set('start')} /></Field>
        <Field label="Retour le"><input className="input" type="date" required min={f.date} value={f.end_date} onChange={set('end_date')} /></Field>
        <Field label="à"><input className="input" type="time" required value={f.end} onChange={set('end')} /></Field>
        <Field label="Motif" className="full"><input className="input" required minLength={3} maxLength={255} value={f.purpose} onChange={set('purpose')} placeholder="Visite client, dépôt à la banque, réunion de chantier…" /></Field>
        <Field label="Destination"><input className="input" maxLength={160} value={f.destination} onChange={set('destination')} /></Field>
        <Field label="Passagers"><input className="input" type="number" min="1" max="60" value={f.passengers} onChange={set('passengers')} /></Field>
      </form>
    </Modal>
  );
}
