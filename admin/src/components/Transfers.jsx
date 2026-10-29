/**
 * Demandes de transfert d'un prospect ou d'un client (choix du client du 29/10) : le commercial demande, motif à
 * l'appui, de confier son prospect à un collègue (ou de le rendre au responsable), ou de reprendre une personne
 * suivie par un collègue ; le responsable (leads:assign) valide ou refuse. Utilisé par le dashboard et l'ERP.
 */
import { useState } from 'react';
import { ArrowRightLeft, Check, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast, useSaved } from '../lib/app-context';
import { Modal, Card, Field, ErrorBox, Badge } from './ui';
import { dateTime } from '../lib/format';

const STATUS = { en_attente: ['En attente', 'warn'], validee: ['Validée', 'ok'], refusee: ['Refusée', 'danger'], annulee: ['Retirée', ''] };

/** Formulaire de demande. `mine` : le prospect est au demandeur (il choisit à qui le confier). */
export function TransferModal({ lead, mine = true, onClose, onDone }) {
  const { user } = useAuth();
  const saved = useSaved();
  const sellers = useResource(mine ? '/admin/users/commerciaux' : null);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/leads/${lead.id}/transfert`, { reason, ...(mine ? { to_user_id: to ? Number(to) : null } : {}) });
      saved('Demande de transfert envoyée au responsable');
      onDone?.(); onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Demander un transfert" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy || reason.trim().length < 5} onClick={send}>Envoyer la demande</button></>}>
      <ErrorBox error={error} />
      <p className="small muted" style={{ marginBottom: 12 }}>
        {mine ? <>Le responsable commercial valide ou refuse ; tant qu’il n’a pas décidé, {lead.name || 'la personne'} reste dans votre portefeuille.</>
          : <>Cette personne est suivie par un collègue. Le responsable décidera si elle vous est confiée ; votre collègue est prévenu.</>}
      </p>
      <div className="stack">
        {mine && (
          <Field label="Confier à">
            <select className="select" value={to} onChange={e => setTo(e.target.value)}>
              <option value="">Rendre au responsable (à répartir)</option>
              {sellers.data?.filter(u => u.id !== user.id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Motif" hint="Obligatoire : il est conservé dans l’historique du prospect"><textarea className="textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder={mine ? 'Ex. : départ en congé, client qui préfère un autre interlocuteur…' : 'Ex. : le client m’a contacté directement…'} /></Field>
      </div>
    </Modal>
  );
}

/**
 * Demandes en attente : le responsable valide ou refuse, un commercial suit les siennes. Rien n'est affiché
 * s'il n'y a aucune demande. `leadId` : celles d'un seul prospect (fiche).
 */
export function TransferRequests({ leadId = null, onChange }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const manager = can('leads:assign');
  const list = useResource(`/admin/lead-transfers?status=en_attente${leadId ? `&lead_id=${leadId}` : ''}`);
  const rows = list.data || [];
  if (!rows.length) return null;
  const decide = async (t, ok) => {
    const note = ok ? undefined : window.prompt('Motif du refus (transmis au commercial)');
    if (!ok && !note) return;
    try {
      await api.post(`/admin/lead-transfers/${t.id}/${ok ? 'valider' : 'refuser'}`, ok ? {} : { note });
      saved(ok ? `Transfert validé : ${t.lead_name}` : 'Transfert refusé');
      list.reload(); onChange?.();
    } catch (e) { toast(e.message, 'err'); }
  };
  const withdraw = async t => {
    try { await api.del(`/admin/lead-transfers/${t.id}`); toast('Demande retirée'); list.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><ArrowRightLeft aria-hidden="true" />{manager ? 'Demandes de transfert à décider' : 'Demandes de transfert en cours'}</span>} bodyClass="">
      <div className="table-wrap"><table className="table table-compact"><tbody>
        {rows.map(t => (
          <tr key={t.id}>
            <td><b>{t.lead_name}</b>{t.client_code && <span className="small muted"> · {t.client_code}</span>}<div className="small muted">{t.from_name || 'non attribué'} → {t.to_name || 'responsable'} · demandé par {t.requested_by_name} · {dateTime(t.created_at)}</div><div className="small">{t.reason}</div></td>
            <td className="nowrap right" style={{ width: 1 }}>
              {manager ? (
                <><button className="btn btn-sm btn-primary" onClick={() => decide(t, true)}><Check />Valider</button> <button className="btn btn-sm btn-ghost btn-danger" onClick={() => decide(t, false)}><X />Refuser</button></>
              ) : t.requested_by === user.id ? <button className="btn btn-sm btn-ghost" onClick={() => withdraw(t)}>Retirer</button> : <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>}
            </td>
          </tr>
        ))}
      </tbody></table></div>
    </Card>
  );
}
