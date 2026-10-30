/**
 * Planifier un rendez-vous avec un prospect ou un client (fiche prospect, fiche client, écran Rendez-vous).
 * Un commercial le planifie avec ses prospects et clients, à son nom ; le responsable (portée « toute l'équipe »)
 * choisit le commercial qui le tiendra : par défaut celui de la fiche ; sur une fiche à attribuer, le commercial choisi
 * reçoit aussi la fiche (choix du client du 30/10). Même fenêtre dans l'ERP et le dashboard.
 */
import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useSaved } from '../lib/app-context';
import { Modal, Field, ErrorBox } from './ui';
import LeadAutocomplete from './LeadAutocomplete';
import { APPT_KINDS } from '../lib/domain';
import { toLocalInput } from '../lib/format';

export default function ApptModal({ lead: initial = null, projectId = null, onClose, onDone }) {
  const { can, user } = useAuth();
  const saved = useSaved();
  const team = can('leads:all');
  const sellers = useResource(team ? '/admin/users/commerciaux' : null);
  const [lead, setLead] = useState(initial);
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ kind: 'visite', starts_at: toLocalInput(Date.now() + 86400000), duration_min: 60, assigned_to: initial?.assigned_to ? String(initial.assigned_to) : '', notes: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const pick = l => { setLead(l); setF(x => ({ ...x, assigned_to: l.assigned_to ? String(l.assigned_to) : '' })); };
  const owner = lead?.assigned_to ? Number(lead.assigned_to) : null;
  const ownerName = owner && (sellers.data?.find(u => u.id === owner)?.name || lead.assigned_name);

  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post('/admin/appointments', {
        lead_id: lead.id, kind: f.kind, status: 'confirme', starts_at: new Date(f.starts_at).toISOString(), duration_min: Number(f.duration_min) || 60,
        project_id: projectId ?? lead.project_id ?? null, ...(lead.lot_id ? { lot_id: lead.lot_id } : {}), notes: f.notes || null,
        ...(team && f.assigned_to ? { assigned_to: Number(f.assigned_to) } : {}),
      });
      saved(`Rendez-vous planifié avec ${lead.name}`);
      onDone?.(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title={lead ? `Rendez-vous avec ${lead.name}` : 'Nouveau rendez-vous'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="appt-form" disabled={!lead || busy}><CalendarPlus />Planifier</button></>}>
      <ErrorBox error={error} />
      <form id="appt-form" className="form-grid" onSubmit={save}>
        {!initial && (
          <Field label="Prospect ou client" className="full" hint={team ? 'Toute l’équipe' : 'Vos prospects et clients'}>
            <LeadAutocomplete value={lead ? lead.name : search} selectedId={lead?.id} onChange={v => { setLead(null); setSearch(v); }} onSelect={pick} />
          </Field>
        )}
        <Field label="Type"><select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(APPT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Date et heure"><input className="input" type="datetime-local" required value={f.starts_at} onChange={set('starts_at')} /></Field>
        <Field label="Durée (minutes)"><input className="input" type="number" min="5" max="480" value={f.duration_min} onChange={set('duration_min')} /></Field>
        {team ? (
          <Field label="Commercial" hint={!lead ? undefined : !owner ? 'Fiche à attribuer : elle sera attribuée à ce commercial' : Number(f.assigned_to) !== owner ? `Commercial de la fiche : ${ownerName || '—'}` : 'Commercial de la fiche'}>
            <select className="select" required value={f.assigned_to} onChange={set('assigned_to')}>
              <option value="">— Choisir le commercial —</option>
              {sellers.data?.map(u => <option key={u.id} value={u.id}>{u.name}{u.id === user.id ? ' (vous)' : ''}</option>)}
            </select>
          </Field>
        ) : <Field label="Commercial"><input className="input" readOnly value={user.name} /></Field>}
        <Field label="Notes" className="full"><input className="input" value={f.notes} onChange={set('notes')} placeholder="Lieu de rendez-vous, documents à apporter…" /></Field>
      </form>
    </Modal>
  );
}
