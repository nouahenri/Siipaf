/**
 * Planifier un rendez-vous avec un prospect ou un client (fiche prospect, fiche client, écran Rendez-vous).
 * Un commercial le planifie avec ses prospects et clients, à son nom ; le responsable (portée « toute l'équipe »)
 * choisit le commercial qui le tiendra (par défaut celui de la personne).
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
  const pick = l => { setLead(l); setF(x => ({ ...x, assigned_to: l.assigned_to ? String(l.assigned_to) : x.assigned_to })); };

  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post('/admin/appointments', {
        lead_id: lead.id, kind: f.kind, status: 'confirme', starts_at: new Date(f.starts_at).toISOString(), duration_min: Number(f.duration_min) || 60,
        project_id: projectId ?? lead.project_id ?? null, notes: f.notes || null,
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
          <Field label="Commercial">
            <select className="select" value={f.assigned_to} onChange={set('assigned_to')}>
              <option value="">Celui de la personne (sinon vous)</option>
              {sellers.data?.map(u => <option key={u.id} value={u.id}>{u.name}{u.id === user.id ? ' (vous)' : ''}</option>)}
            </select>
          </Field>
        ) : <Field label="Commercial"><input className="input" readOnly value={user.name} /></Field>}
        <Field label="Notes" className="full"><input className="input" value={f.notes} onChange={set('notes')} placeholder="Lieu de rendez-vous, documents à apporter…" /></Field>
      </form>
    </Modal>
  );
}
