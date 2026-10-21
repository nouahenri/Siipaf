/** Formulaires de la gestion des lots : créer ou modifier un lot, changer son statut, modifier un dossier d'acquisition. */
import { useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Modal, Field, ErrorBox, StatusBadge } from './ui';
import { FINANCING, LOT_TRANSITIONS, lotStatus } from '../lib/domain';
import { fcfa } from '../lib/format';

/**
 * Changement de statut d'un lot (transitions autorisées, motif conservé dans l'historique).
 * `onDone` reçoit le nouveau statut. Utilisé par « Lots & disponibilités » et l'éditeur de plan.
 */
export function LotStatusModal({ lot, onClose, onDone }) {
  const { user } = useAuth();
  const toast = useToast();
  const options = LOT_TRANSITIONS[lot.status].filter(s => !(lot.status === 'vendu' && user.role !== 'super_admin'));
  const [to, setTo] = useState(options[0] || '');
  const [reason, setReason] = useState('');
  const [lead, setLead] = useState({ name: '', phone: '', email: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (to === 'option') {
        await api.post(`/admin/lots/${lot.id}/option`, { name: lead.name, phone: lead.phone || undefined, email: lead.email || undefined });
      } else {
        await api.post(`/admin/lots/${lot.id}/status`, { status: to, reason: reason || undefined });
      }
      toast(`Lot ${lot.code} : ${lotStatus(to).label}`);
      onDone(to);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal
      title={`Lot ${lot.code}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy || !to} onClick={submit}>Valider</button></>}
    >
      <p>Statut actuel : <StatusBadge status={lot.status} /></p>
      {!options.length ? <p className="muted">Aucun changement possible pour votre rôle.</p> : (
        <>
          <ErrorBox error={error} />
          <fieldset style={{ border: 'none' }} className="stack">
            <legend className="small muted" style={{ marginBottom: 8 }}>Nouveau statut</legend>
            <div className="row">
              {options.map(s => (
                <label key={s} className={`btn btn-sm ${to === s ? '' : 'btn-ghost'}`} style={to === s ? { borderColor: lotStatus(s).color } : undefined}>
                  <input type="radio" name="status" value={s} checked={to === s} onChange={() => setTo(s)} style={{ position: 'absolute', opacity: 0 }} />
                  <i style={{ width: 10, height: 10, borderRadius: 3, background: lotStatus(s).color, display: 'inline-block' }} />{lotStatus(s).label}
                </label>
              ))}
            </div>
          </fieldset>
          {to === 'option' ? (
            <div className="form-grid">
              <Field label="Nom du prospect" className="full"><input className="input" value={lead.name} onChange={e => setLead({ ...lead, name: e.target.value })} /></Field>
              <Field label="Téléphone"><input className="input" value={lead.phone} onChange={e => setLead({ ...lead, phone: e.target.value })} /></Field>
              <Field label="E-mail"><input className="input" type="email" value={lead.email} onChange={e => setLead({ ...lead, email: e.target.value })} /></Field>
              <p className="small muted full">L’option bloque le lot pendant la durée prévue pour le projet, puis le libère automatiquement.</p>
            </div>
          ) : (
            <Field label="Motif (facultatif)" hint="Conservé dans l’historique du lot."><input className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
          )}
        </>
      )}
    </Modal>
  );
}

const toNumber = v => (String(v).trim() === '' ? null : Number(String(v).replace(/[\s  ]/g, '').replace(',', '.')));
// Date « AAAA-MM-JJ » pour un champ date, quel que soit le format reçu (texte, millisecondes)
const day = v => {
  if (!v) return '';
  if (typeof v === 'string' && /^d{4}-d{2}-d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(typeof v === 'number' || /^d+$/.test(v) ? Number(v) : v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** Créer un lot (lot absent) ou modifier ses caractéristiques. Le statut se change ailleurs, pour garder l'historique. */
export function LotFormModal({ projectId, lot, onClose, onDone }) {
  const toast = useToast();
  const project = useResource(`/admin/projects/${projectId}`);
  const isNew = !lot;
  const [f, setF] = useState({
    code: lot?.code || '', ilot: lot?.ilot || '', offer_id: lot?.offer_id ? String(lot.offer_id) : '',
    surface_m2: lot?.surface_m2 ?? '', price_fcfa: lot?.price_fcfa ?? '', notes: lot?.notes || '', status: 'disponible',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const offers = project.data?.offers || [];

  // Choisir un type de bien propose son prix catalogue
  const pickOffer = e => {
    const offer = offers.find(o => String(o.id) === e.target.value);
    setF(x => ({ ...x, offer_id: e.target.value, price_fcfa: offer?.price_fcfa && !x.price_fcfa ? offer.price_fcfa : x.price_fcfa }));
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    const body = {
      code: f.code.trim(), ilot: f.ilot.trim() || null, offer_id: f.offer_id ? Number(f.offer_id) : null,
      surface_m2: toNumber(f.surface_m2), price_fcfa: toNumber(f.price_fcfa) == null ? null : Math.round(toNumber(f.price_fcfa)),
      notes: f.notes.trim() || null,
    };
    try {
      if (isNew) await api.post(`/admin/projects/${projectId}/lots`, { ...body, status: f.status });
      else await api.patch(`/admin/lots/${lot.id}`, body);
      toast(isNew ? `Lot ${body.code} créé` : 'Lot mis à jour');
      onDone();
    } catch (e) { setError(e); }
    setBusy(false);
  };

  return (
    <Modal
      title={isNew ? `Nouveau lot${project.data ? ` — ${project.data.name}` : ''}` : `Modifier le lot ${lot.code}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit} disabled={busy || !f.code.trim()}><Save />{isNew ? 'Créer le lot' : 'Enregistrer'}</button></>}
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="N° de lot"><input className="input" value={f.code} onChange={set('code')} placeholder="Ex. : A12" autoFocus /></Field>
        <Field label="Îlot"><input className="input" value={f.ilot} onChange={set('ilot')} placeholder="Ex. : A" /></Field>
        <Field label="Type de bien" className="full">
          <select className="select" value={f.offer_id} onChange={pickOffer}>
            <option value="">— Non précisé —</option>
            {offers.map(o => <option key={o.id} value={o.id}>{o.label}{o.surface ? ` · ${o.surface}` : ''}{o.price_fcfa ? ` · ${fcfa(o.price_fcfa)}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Surface du terrain (m²)"><input className="input tabular" inputMode="decimal" value={f.surface_m2} onChange={set('surface_m2')} /></Field>
        <Field label="Prix catalogue (FCFA)"><input className="input tabular" inputMode="numeric" value={f.price_fcfa} onChange={set('price_fcfa')} /></Field>
        {isNew && (
          <Field label="Statut de départ">
            <select className="select" value={f.status} onChange={set('status')}>
              <option value="disponible">Disponible</option>
              <option value="bloque">Non commercialisé</option>
            </select>
          </Field>
        )}
        <Field label="Notes internes" className="full"><textarea className="textarea" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {isNew && <p className="small muted" style={{ marginTop: 10 }}>Le lot n’a pas encore de forme sur le plan de masse : placez-le ensuite dans l’éditeur de plan, rubrique « Lots à placer ».</p>}
    </Modal>
  );
}

/** Modifier le dossier d'acquisition. Changer le prix, le financement ou la date de réservation recalcule l'échéancier type. */
export function SaleEditModal({ sale, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({
    price_fcfa: sale.price_fcfa ?? '', financing: sale.financing || '', reserved_at: day(sale.reserved_at),
    signed_at: day(sale.signed_at), notes: sale.notes || '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const scheduleChanges = Number(toNumber(f.price_fcfa)) !== Number(sale.price_fcfa) || (f.financing || null) !== (sale.financing || null) || f.reserved_at !== day(sale.reserved_at);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const body = {
      price_fcfa: Math.round(toNumber(f.price_fcfa)), financing: f.financing || null,
      reserved_at: f.reserved_at || null, signed_at: f.signed_at || null, notes: f.notes.trim() || null,
    };
    try {
      const data = await api.patch(`/admin/sales/${sale.id}`, body);
      toast('Dossier mis à jour');
      onDone(data);
    } catch (e) { setError(e); }
    setBusy(false);
  };

  return (
    <Modal
      title={`Dossier ${sale.lead.client_code} — ${sale.lead.name}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit} disabled={busy || !toNumber(f.price_fcfa)}><Save />Enregistrer</button></>}
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="Prix convenu (FCFA)"><input className="input tabular" inputMode="numeric" value={f.price_fcfa} onChange={set('price_fcfa')} /></Field>
        <Field label="Financement">
          <select className="select" value={f.financing} onChange={set('financing')}>
            <option value="">— Non précisé —</option>
            {Object.entries(FINANCING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Date de réservation"><input className="input" type="date" value={f.reserved_at} onChange={set('reserved_at')} /></Field>
        <Field label="Date de signature du contrat"><input className="input" type="date" value={f.signed_at} onChange={set('signed_at')} /></Field>
        <Field label="Notes internes" className="full"><textarea className="textarea" rows={3} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {scheduleChanges && <p className="small" style={{ marginTop: 10, color: 'var(--warn)' }}>L’échéancier type sera recalculé ; les versements déjà enregistrés sont conservés.</p>}
    </Modal>
  );
}
