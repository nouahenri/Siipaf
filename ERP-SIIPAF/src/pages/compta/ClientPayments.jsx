/**
 * Versements des clients côté Comptabilité (choix du client du 29/10), affichés dans Écritures et au tableau de bord :
 * - saisie directe d'un versement : il compte aussitôt ; le commercial du client et les responsables commerciaux sont prévenus ;
 * - versements déclarés par les commerciaux : la Comptabilité les ajuste au besoin (montant, date, moyen, référence),
 *   puis confirme la réception des fonds, ou les refuse avec un motif. Le commercial est prévenu dans les deux cas.
 * L'écriture d'encaissement est ensuite créée par « Synchroniser », comme pour tous les versements.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Check, X } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Badge, Modal, Field, ErrorBox } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';

export const METHODS = { virement: 'Virement', mobile_money: 'Mobile Money', especes: 'Espèces', cheque: 'Chèque', autre: 'Autre' };
const today = () => new Date().toISOString().slice(0, 10);

/** Bouton « Versement client » (saisie directe), pour les comptes qui enregistrent les versements. */
export function ClientPaymentButton({ className = 'btn', onDone }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can('payments:write')) return null;
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}><Banknote />Versement client</button>
      {open && <ClientPaymentModal onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

/** Champs d'un versement : montant, date, moyen, référence, note. */
function PaymentFields({ f, set, max }) {
  return (
    <>
      <Field label="Montant (FCFA)"><input className="input tabular" type="number" min="1" max={max || undefined} required value={f.amount_fcfa} onChange={set('amount_fcfa')} /></Field>
      <Field label="Date du paiement"><input className="input" type="date" max={today()} required value={f.paid_at} onChange={set('paid_at')} /></Field>
      <Field label="Moyen de paiement"><select className="select" value={f.method} onChange={set('method')}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Référence"><input className="input" value={f.reference} onChange={set('reference')} placeholder="N° de transaction, de chèque…" /></Field>
      <Field label="Note" className="full"><input className="input" value={f.note} onChange={set('note')} maxLength={255} /></Field>
    </>
  );
}

/** Saisie directe d'un versement par la Comptabilité, sans passer par le commercial (qui est prévenu). */
export function ClientPaymentModal({ onClose, onDone }) {
  const saved = useSaved();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sale, setSale] = useState(null);
  const [f, setF] = useState({ amount_fcfa: '', paid_at: today(), method: 'virement', reference: '', note: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  const found = useResource(debounced.length >= 2 ? `/admin/erp/commercial/sales${qs({ q: debounced, status: 'en_cours' })}` : null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post(`/admin/sales/${sale.id}/payments`, { amount_fcfa: Number(f.amount_fcfa), paid_at: f.paid_at, method: f.method, reference: f.reference || undefined, note: f.note || undefined });
      saved(`Versement enregistré pour ${sale.client_name} : le commercial est prévenu`);
      onDone?.(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title="Saisir un versement client" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="client-payment" disabled={!sale || busy || !f.amount_fcfa}>Enregistrer</button></>}>
      <ErrorBox error={error} />
      {!sale ? (
        <div className="stack">
          <Field label="Client ou dossier" hint="Nom, code client ou lot (dossiers en cours)"><input className="input" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Ex. : Koné, SIIPAF-2026-0040, A9" /></Field>
          {found.data && (!found.data.length ? <p className="small muted">Aucun dossier en cours ne correspond.</p> : (
            <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}><table className="table table-compact"><tbody>
              {found.data.slice(0, 30).map(s => (
                <tr key={s.id} className="clickable" tabIndex={0} onClick={() => setSale(s)} onKeyDown={e => e.key === 'Enter' && setSale(s)}>
                  <td><b>{s.client_name}</b><div className="small muted">{s.client_code} · {s.assigned_name || 'sans commercial'}</div></td>
                  <td className="small">{s.project_name} · lot {s.lot_code}</td>
                  <td className="right small tabular">reste {fcfa(s.remaining_fcfa)}</td>
                </tr>
              ))}
            </tbody></table></div>
          ))}
        </div>
      ) : (
        <form id="client-payment" className="form-grid" onSubmit={save}>
          <div className="full row-between erp-panel">
            <span><b>{sale.client_name}</b> <span className="small muted">· {sale.project_name}, lot {sale.lot_code} · commercial : {sale.assigned_name || '—'}</span><br /><span className="small">Reste à payer : <b className="tabular">{fcfa(sale.remaining_fcfa)}</b></span></span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSale(null)}>Changer</button>
          </div>
          <PaymentFields f={f} set={set} max={sale.remaining_fcfa} />
          <p className="full small muted">Le versement compte aussitôt dans le dossier (solde, espace client, reçu). Le commercial du client et les responsables commerciaux sont prévenus. L’écriture d’encaissement se crée avec « Synchroniser ».</p>
        </form>
      )}
    </Modal>
  );
}

/** Ajuster un versement déclaré par un commercial (montant, date, moyen, référence, note), puis confirmer la réception des fonds. */
function AdjustModal({ declaration: d, onClose, onDone }) {
  const saved = useSaved();
  const [f, setF] = useState({ amount_fcfa: String(d.amount_fcfa), paid_at: d.paid_at, method: d.method, reference: d.reference || '', note: d.note || '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const adjusted = Number(f.amount_fcfa) !== d.amount_fcfa || f.paid_at !== d.paid_at || f.method !== d.method;
  const confirm = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post(`/admin/payment-declarations/${d.id}/confirm`, { amount_fcfa: Number(f.amount_fcfa), paid_at: f.paid_at, method: f.method, reference: f.reference || '', note: f.note || '' });
      saved(`Réception des fonds confirmée : ${d.client_name}${adjusted ? ' (versement ajusté)' : ''}`);
      onDone(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Versement déclaré par ${d.declared_by_name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="adjust-payment" disabled={busy || !f.amount_fcfa}><Check />Confirmer la réception</button></>}>
      <ErrorBox error={error} />
      <form id="adjust-payment" className="form-grid" onSubmit={confirm}>
        <div className="full erp-panel small">
          <b>{d.client_name}</b> · {d.project_name}, lot {d.lot_code}<br />
          Déclaré : <b className="tabular">{fcfa(d.amount_fcfa)}</b> le {date(d.paid_at)} · {METHODS[d.method] || d.method}{d.reference ? ` · ${d.reference}` : ''}
        </div>
        <PaymentFields f={f} set={set} />
        <p className="full small muted">Corrigez au besoin d’après le relevé ou la caisse : le versement est enregistré tel que confirmé ici, la déclaration du commercial reste dans l’historique. Le commercial est prévenu{adjusted ? ' de l’ajustement' : ''}.</p>
      </form>
    </Modal>
  );
}

/**
 * Versements déclarés par les commerciaux, en attente de la confirmation de la réception des fonds : ajuster et
 * confirmer, ou refuser avec un motif. Rien n'est affiché s'il n'y en a aucun.
 */
export function PendingPayments({ onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const list = useResource(can('payments:write') ? '/admin/payment-declarations?status=a_confirmer' : null);
  const [adjusting, setAdjusting] = useState(null);
  const rows = list.data || [];
  if (!rows.length) return null;
  const refresh = () => { list.reload(); onChange?.(); };
  const reject = async x => {
    const reason = window.prompt('Motif du refus (transmis au commercial)');
    if (!reason) return;
    try { await api.post(`/admin/payment-declarations/${x.id}/reject`, { reason }); saved('Versement refusé : le commercial est prévenu'); refresh(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title={<span className="row" style={{ gap: 8 }}>Versements déclarés (commerciaux et clients), à confirmer <Badge tone="warn">{rows.length}</Badge></span>} bodyClass="">
      <div className="table-wrap"><table className="table table-compact">
        <thead><tr><th>Client</th><th>Bien</th><th>Versement</th><th>Déclaré par</th><th className="right">Montant</th><th /></tr></thead>
        <tbody>{rows.map(x => (
          <tr key={x.id}>
            <td><b>{x.client_name}</b><div className="small muted">{x.client_code}</div></td>
            <td className="small">{x.project_name} · lot {x.lot_code}</td>
            <td className="small">{date(x.paid_at)} · {METHODS[x.method] || x.method}{x.reference ? ` · ${x.reference}` : ''}{x.note && <div className="muted">{x.note}</div>}
              {x.proof_file_id ? <a href={`/api/admin/payment-declarations/${x.id}/proof`} target="_blank" rel="noreferrer">Voir la capture du reçu</a> : null}</td>
            <td className="small">{x.declared_by_name}</td>
            <td className="right tabular"><b>{fcfa(x.amount_fcfa)}</b></td>
            <td className="nowrap right">
              <button className="btn btn-sm btn-primary" onClick={() => setAdjusting(x)}><Check />Vérifier et confirmer</button>{' '}
              <button className="btn btn-sm btn-ghost btn-danger" onClick={() => reject(x)}><X />Refuser</button>{' '}
              <Link className="btn btn-sm btn-ghost" to={`/commercial/ventes?d=${x.sale_id}`}>Dossier</Link>
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      {adjusting && <AdjustModal declaration={adjusting} onClose={() => setAdjusting(null)} onDone={refresh} />}
    </Card>
  );
}
