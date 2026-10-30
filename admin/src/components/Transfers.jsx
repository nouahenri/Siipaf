/**
 * Demandes de transfert d'un prospect ou d'un client (choix du client du 29/10) : le commercial demande, motif à
 * l'appui, de confier son prospect à un collègue (ou de le rendre au responsable), ou de reprendre une personne
 * suivie par un collègue ; le responsable (leads:assign) valide ou refuse. Pour un client, le changement de commercial
 * demande l'accord du responsable commercial ET l'approbation de l'administrateur général (super admin). Dashboard et ERP.
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
  const { user, can } = useAuth();
  const client = !!lead.client_code;
  const pick = mine || can('leads:assign');
  const saved = useSaved();
  const sellers = useResource(pick ? '/admin/users/commerciaux' : null);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/leads/${lead.id}/transfert`, { reason, ...(pick ? { to_user_id: to ? Number(to) : null } : {}) });
      saved(client ? 'Demande envoyée : accord du responsable commercial et de l’administrateur général' : 'Demande de transfert envoyée au responsable');
      onDone?.(); onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={client ? 'Changer le commercial du client' : 'Demander un transfert'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy || reason.trim().length < 5} onClick={send}>Envoyer la demande</button></>}>
      <ErrorBox error={error} />
      <p className="small muted" style={{ marginBottom: 12 }}>
        {client ? <>Le changement s’applique après l’accord du responsable commercial <b>et</b> l’approbation de l’administrateur général ; d’ici là, {lead.name || 'le client'} garde son commercial.</>
          : mine ? <>Le responsable commercial valide ou refuse ; tant qu’il n’a pas décidé, {lead.name || 'la personne'} reste dans votre portefeuille.</>
          : <>Cette personne est suivie par un collègue. Le responsable décidera si elle vous est confiée ; votre collègue est prévenu.</>}
      </p>
      <div className="stack">
        {pick && (
          <Field label="Confier à">
            <select className="select" value={to} onChange={e => setTo(e.target.value)}>
              <option value="">Rendre au responsable (à répartir)</option>
              {sellers.data?.filter(u => u.id !== lead.assigned_to && (u.id !== user.id || !mine)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Motif" hint="Obligatoire : il est conservé dans l’historique du prospect"><textarea className="textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder={client || mine ? 'Ex. : départ en congé, réorganisation du portefeuille, client qui préfère un autre interlocuteur…' : 'Ex. : le client m’a contacté directement…'} /></Field>
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
  const admin = user?.role === 'super_admin';
  const myTurn = t => manager && (t.awaiting === 'administrateur' ? admin : t.awaiting === 'responsable' && (!t.client || !admin));
  const list = useResource(`/admin/lead-transfers?status=en_attente${leadId ? `&lead_id=${leadId}` : ''}`);
  const rows = list.data || [];
  if (!rows.length) return null;
  const decide = async (t, ok) => {
    const note = ok ? undefined : window.prompt('Motif du refus (transmis au commercial)');
    if (!ok && !note) return;
    try {
      const out = await api.post(`/admin/lead-transfers/${t.id}/${ok ? 'valider' : 'refuser'}`, ok ? {} : { note });
      saved(!ok ? 'Transfert refusé' : out.status === 'validee' ? `Changement appliqué : ${t.lead_name}` : out.awaiting === 'administrateur' ? 'Accord donné : en attente de l’administrateur général' : 'Approbation donnée : en attente du responsable commercial');
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
            <td><b>{t.lead_name}</b>{t.client_code && <span className="small muted"> · {t.client_code}</span>}<div className="small muted">{t.from_name || 'non attribué'} → {t.to_name || 'responsable'} · demandé par {t.requested_by_name} · {dateTime(t.created_at)}</div><div className="small">{t.reason}</div>
              {t.client && <div className="row small" style={{ gap: 6, marginTop: 4 }}>
                <Badge tone={t.manager_by ? 'ok' : 'warn'}>Responsable commercial : {t.manager_by ? `accord (${t.manager_name})` : 'en attente'}</Badge>
                <Badge tone={t.admin_by ? 'ok' : 'warn'}>Administrateur général : {t.admin_by ? `approuvé (${t.admin_name})` : 'en attente'}</Badge>
              </div>}</td>
            <td className="nowrap right" style={{ width: 1 }}>
              {myTurn(t) ? (
                <><button className="btn btn-sm btn-primary" onClick={() => decide(t, true)}><Check />{t.client ? (admin ? 'Approuver' : 'Donner mon accord') : 'Valider'}</button> <button className="btn btn-sm btn-ghost btn-danger" onClick={() => decide(t, false)}><X />Refuser</button></>
              ) : manager ? (
                <>{t.requested_by === user.id && <button className="btn btn-sm btn-ghost" onClick={() => withdraw(t)}>Retirer</button>} <button className="btn btn-sm btn-ghost btn-danger" onClick={() => decide(t, false)}><X />Refuser</button></>
              ) : t.requested_by === user.id ? <button className="btn btn-sm btn-ghost" onClick={() => withdraw(t)}>Retirer</button> : <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>}
            </td>
          </tr>
        ))}
      </tbody></table></div>
    </Card>
  );
}
