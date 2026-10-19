/** Formulaires de la gestion des lots : créer ou modifier un lot, modifier un dossier d'acquisition. */
import { useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../lib/api';
import { useResource, useToast } from '../lib/app-context';
import { Modal, Field, ErrorBox } from './ui';
import { FINANCING } from '../lib/domain';
import { fcfa } from '../lib/format';

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
