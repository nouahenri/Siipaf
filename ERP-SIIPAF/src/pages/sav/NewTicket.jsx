import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { Modal, Field, ErrorBox } from '@admin/components/ui';
import { useSavMeta } from '../../components/SavBits';
import { PhotoPicker } from '../../components/Photos';
import { useSaved } from '@admin/lib/app-context';

/** Recherche d'un dossier d'acquisition (client, code client, lot, téléphone). */
export function SalePicker({ value, onChange, autoFocus }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (value) return undefined;
    const id = setTimeout(() => api.get(`/admin/erp/sav/sales${qs({ q, limit: 8 })}`).then(setRows).catch(() => setRows([])), 250);
    return () => clearTimeout(id);
  }, [q, value]);

  if (value) {
    return (
      <div className="erp-panel row-between">
        <span><b>{value.client_name}</b> <span className="muted small">{value.client_code}</span><div className="small muted">{value.project_name} · lot {value.lot_code}{value.ilot ? ` (îlot ${value.ilot})` : ''}</div></span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>Changer</button>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="search" style={{ minWidth: 0 }}>
        <Search aria-hidden="true" />
        <input className="input" type="search" placeholder="Nom, code client, lot, téléphone…" value={q} onChange={e => setQ(e.target.value)} autoFocus={autoFocus} aria-label="Rechercher un dossier" />
      </label>
      <ul className="pick-list">
        {rows.map(s => (
          <li key={s.id}>
            <button type="button" onClick={() => onChange(s)}>
              <b>{s.client_name}</b> <span className="muted small">{s.client_code}</span>
              <span className="small muted">{s.project_name} · lot {s.lot_code}{s.delivered_at ? ' · livré' : ''}</span>
            </button>
          </li>
        ))}
        {!rows.length && <li className="muted small" style={{ padding: 8 }}>Aucun dossier trouvé.</li>}
      </ul>
    </div>
  );
}

export default function NewTicket({ onClose, onCreated }) {
  const saved = useSaved();
  const meta = useSavMeta();
  const [sale, setSale] = useState(null);
  const [form, setForm] = useState({ category: '', priority: 'normale', title: '', description: '', location: '', assigned_to: '' });
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const t = await api.post('/admin/erp/sav/tickets', {
        sale_id: sale?.id, category: form.category, priority: form.priority, title: form.title,
        description: form.description || null, location: form.location || null,
        assigned_to: Number(form.assigned_to) || null, media_ids: photos.map(p => p.id),
      });
      saved("Réclamation enregistrée"); onCreated(t);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title="Nouvelle réclamation" onClose={onClose} footer={(
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" form="new-ticket" disabled={busy || !sale || !form.category}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>
    )}>
      <form id="new-ticket" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Dossier du client"><SalePicker value={sale} onChange={setSale} autoFocus /></Field>
        <div className="form-grid">
          <Field label="Type de problème">
            <select className="select" required value={form.category} onChange={set('category')}>
              <option value="">— Choisir —</option>
              {meta && Object.entries(meta.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Priorité" hint={meta ? `À traiter sous ${meta.priorities[form.priority].hours} h` : undefined}>
            <select className="select" value={form.priority} onChange={set('priority')}>
              {meta && Object.entries(meta.priorities).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Titre" className="full"><input className="input" required minLength={3} maxLength={160} value={form.title} onChange={set('title')} placeholder="Ex. Infiltration au plafond de la chambre" /></Field>
          <Field label="Emplacement"><input className="input" maxLength={120} value={form.location} onChange={set('location')} placeholder="Pièce, façade, jardin…" /></Field>
          <Field label="Responsable">
            <select className="select" value={form.assigned_to} onChange={set('assigned_to')}>
              <option value="">— Personne —</option>
              {meta?.technicians.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Description" className="full"><textarea className="textarea" rows={4} value={form.description} onChange={set('description')} /></Field>
        </div>
        <Field label="Photos" hint="Visibles par le client dans son espace">
          <PhotoPicker value={photos} onChange={setPhotos} leadId={sale?.lead_id} />
        </Field>
      </form>
    </Modal>
  );
}
