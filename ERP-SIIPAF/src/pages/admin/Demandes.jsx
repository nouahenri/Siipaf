import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, Check, X, Hand, CheckCheck, Receipt } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Drawer, Badge } from '@admin/components/ui';
import { date, dateTime, fcfa } from '@admin/lib/format';
import { today } from '../../lib/rh';
import { REQUEST_TONES } from '../../components/MyRequests';
import { placeLabel } from '../../components/PlacePicker';

const URL = '/admin/erp/demandes';

/**
 * Demandes internes (choix du client du 22/10) : le responsable direct valide, la direction générale valide les
 * achats au-delà du plafond, les services généraux prennent en charge et clôturent ; un achat traité devient une
 * facture d'achat en brouillon pour le comptable. Les employés demandent depuis RH › Mon espace.
 */
export default function Demandes() {
  const { can } = useAuth();
  const handle = can('demandes:handle');
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState(handle ? 'handle' : 'approve');
  const list = useResource(`${URL}${qs({ scope })}`);
  const refs = useResource(`${URL}/refs`);
  const open = Number(params.get('fiche')) || null;
  const setOpen = id => setParams(id ? { fiche: String(id) } : {}, { replace: true });
  const tabs = [handle && ['handle', 'À traiter'], ['approve', 'À valider par moi'], (handle || can('demandes:dg')) && ['all', 'Toutes']].filter(Boolean);
  return (
    <div className="stack">
      <div className="row-between">
        <div className="seg" role="group" aria-label="Affichage">{tabs.map(([k, l]) => <button key={k} className={scope === k ? 'active' : ''} onClick={() => setScope(k)}>{l}</button>)}</div>
        {refs.data && <span className="small muted">Validation de la DG à partir de {fcfa(refs.data.threshold)} (Paramètres › Général du dashboard)</span>}
      </div>
      <Card bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !list.data.length ? (
          <div className="card-body"><Empty icon={Inbox}>{scope === 'approve' ? 'Aucune demande à valider.' : scope === 'handle' ? 'Aucune demande à traiter.' : 'Aucune demande.'} Les employés demandent depuis RH › Mon espace.</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Référence</th><th>Demande</th><th>Demandeur</th><th className="right">Montant</th><th>Pour le</th><th>Avancement</th></tr></thead>
            <tbody>{list.data.map(r => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                <td className="small tabular nowrap"><b>{r.reference}</b></td>
                <td>{r.title}<div className="small muted">{r.kind_label}{` · ${placeLabel(r)}`}{r.urgency === 'urgente' ? ' · ' : ''}{r.urgency === 'urgente' && <span style={{ color: 'var(--danger)' }}>urgente</span>}</div></td>
                <td className="small">{r.requested_by_name}</td>
                <td className="right small tabular">{r.final_amount ? fcfa(r.final_amount) : r.estimated_amount ? fcfa(r.estimated_amount) : ''}</td>
                <td className="small nowrap">{r.needed_by ? date(r.needed_by) : '—'}</td>
                <td><Badge tone={REQUEST_TONES[r.status]}>{r.status_label}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {open && refs.data && <RequestDrawer id={open} refs={refs.data} onClose={() => setOpen(null)} onChange={list.reload} />}
    </div>
  );
}

function RequestDrawer({ id, refs, onClose, onChange }) {
  const toast = useToast();
  const x = useResource(`${URL}/${id}`);
  const r = x.data;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const call = async (path, body, message) => {
    setBusy(true);
    try { x.setData(await api.post(`${URL}/${id}/${path}`, body)); onChange(); toast(message); setNote(''); setClosing(false); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Drawer title={r ? `${r.reference} · ${r.kind_label}` : 'Demande'} onClose={onClose}>
      {x.error ? <ErrorBox error={x.error} /> : !r ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={REQUEST_TONES[r.status]}>{r.status_label}</Badge>
            {r.urgency === 'urgente' && <Badge tone="danger">Urgente</Badge>}
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px' }}>{r.title}</h3>
            <div className="kv"><span>Demandeur</span><b>{r.requested_by_name} · {dateTime(r.created_at)}</b></div>
            {r.quantity && <div className="kv"><span>Quantité</span><b>{r.quantity}</b></div>}
            {r.estimated_amount ? <div className="kv"><span>Montant estimé</span><b>{fcfa(r.estimated_amount)}</b></div> : null}
            <div className="kv"><span>Pour</span><b>{[placeLabel(r), r.location].filter(Boolean).join(' · ')}</b></div>
            {r.needed_by && <div className="kv"><span>Pour le</span><b>{date(r.needed_by)}</b></div>}
          </div>
          {r.details && <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.details}</p>}

          <div className="erp-panel">
            <b>Circuit</b>
            <div className="kv"><span>Responsable direct</span><b>{r.manager_name ? `${r.manager_name}${r.manager_at ? ` · validé le ${dateTime(r.manager_at)}` : ''}` : 'aucun (étape sautée)'}</b></div>
            {(r.dg_at || r.status === 'attente_dg') && <div className="kv"><span>Direction générale</span><b>{r.dg_at ? `validé le ${dateTime(r.dg_at)}` : 'en attente'}</b></div>}
            <div className="kv"><span>Services généraux</span><b>{r.handled_by_name ? `${r.handled_by_name}${r.closed_at ? ` · clos le ${dateTime(r.closed_at)}` : ''}` : '—'}</b></div>
            {r.decision_note && <div className="kv"><span>{r.status === 'refusee' ? 'Motif' : 'Réponse'}</span><b>{r.decision_note}</b></div>}
            {r.invoice_number && <div className="kv"><span>Facture d’achat</span><b><Receipt style={{ width: 14, height: 14, verticalAlign: -2 }} /> {r.invoice_number} · {r.supplier_name} · {fcfa(r.final_amount)} (brouillon à valider en Comptabilité)</b></div>}
          </div>

          {r.rights.approve && (
            <div className="erp-panel stack" style={{ gap: 10 }}>
              <Field label="Commentaire (obligatoire pour un refus)"><input className="input" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></Field>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary" disabled={busy} onClick={() => call('decision', { approve: true, note: note.trim() || undefined }, 'Demande validée')}><Check />Valider</button>
                <button className="btn" disabled={busy || !note.trim()} onClick={() => call('decision', { approve: false, note: note.trim() }, 'Demande refusée')}><X />Refuser</button>
              </div>
            </div>
          )}
          {r.rights.handle && r.status === 'attente_sg' && <button className="btn btn-primary" style={{ alignSelf: 'start' }} disabled={busy} onClick={() => call('prendre', {}, 'Demande prise en charge')}><Hand />Prendre en charge</button>}
          {r.rights.handle && !closing && <button className="btn" style={{ alignSelf: 'start' }} onClick={() => setClosing(true)}><CheckCheck />Clôturer</button>}
          {closing && <ClosePanel r={r} refs={refs} busy={busy} onCancel={() => setClosing(false)} onSubmit={body => call('cloturer', body, body.outcome === 'refusee' ? 'Demande refusée' : body.invoice ? 'Demande traitée — facture d’achat préparée' : 'Demande traitée')} />}
        </div>
      )}
    </Drawer>
  );
}

function ClosePanel({ r, refs, busy, onCancel, onSubmit }) {
  const [f, setF] = useState({ outcome: 'traitee', note: '', invoice: r.purchase, supplier_id: '', amount_ttc: r.estimated_amount || '', vat_rate: 0, expense_account: '', date: today() });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const invoice = f.outcome === 'traitee' && r.purchase && f.invoice;
  const ready = f.outcome === 'refusee' ? f.note.trim() : !invoice || (f.supplier_id && f.amount_ttc);
  return (
    <div className="erp-panel form-grid">
      <Field label="Issue"><select className="select" value={f.outcome} onChange={set('outcome')}><option value="traitee">Traitée</option><option value="refusee">Refusée</option></select></Field>
      <Field label={f.outcome === 'refusee' ? 'Motif' : 'Réponse au demandeur'}><input className="input" maxLength={500} value={f.note} onChange={set('note')} /></Field>
      {f.outcome === 'traitee' && r.purchase && <label className="full row" style={{ gap: 6 }}><input type="checkbox" checked={f.invoice} onChange={set('invoice')} />Préparer la facture d’achat (brouillon en Comptabilité)</label>}
      {invoice && (
        <>
          <Field label="Fournisseur"><select className="select" value={f.supplier_id} onChange={set('supplier_id')}><option value="">—</option>{refs.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Montant TTC (FCFA)"><input className="input" type="number" min="1" value={f.amount_ttc} onChange={set('amount_ttc')} /></Field>
          <Field label="TVA incluse"><select className="select" value={f.vat_rate} onChange={set('vat_rate')}><option value="0">0 %</option><option value="9">9 %</option><option value="18">18 %</option></select></Field>
          <Field label="Date de la facture"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
          <Field label="Compte de charge" hint="Vide : celui de la fiche du fournisseur" className="full"><input className="input" maxLength={12} value={f.expense_account} onChange={set('expense_account')} placeholder="6041, 6056…" /></Field>
        </>
      )}
      <div className="full row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || !ready} onClick={() => onSubmit({
          outcome: f.outcome, note: f.note.trim() || undefined, invoice: !!invoice,
          ...(invoice ? { supplier_id: Number(f.supplier_id), amount_ttc: Number(f.amount_ttc), vat_rate: Number(f.vat_rate), date: f.date, expense_account: f.expense_account.trim() || undefined } : {}),
        })}><Check />Clôturer</button>
        <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}
