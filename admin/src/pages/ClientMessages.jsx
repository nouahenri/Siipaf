import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MessagesSquare, Send, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useResource, useSaved } from '../lib/app-context';
import { Card, Drawer, Modal, Field, Badge, Empty, ErrorBox, Skeleton } from '../components/ui';
import { MessageThread } from '../components/ClientSpace';
import { relative } from '../lib/format';

/** Fils de discussion avec les acquéreurs (espace client), du plus récent au plus ancien. */
export default function ClientMessages() {
  const { stats } = useOutletContext(); // pastille du menu
  const threads = useResource('/admin/client-messages');
  const [open, setOpen] = useState(null);

  const onRead = () => { threads.reload(); stats.reload(); };
  const [group, setGroup] = useState(false);

  return (
    <div className="stack">
      <div className="row-between">
        <p className="small muted">Les messages envoyés par les acquéreurs depuis leur espace client. Ouvrez un fil pour le lire et répondre.</p>
        <button className="btn btn-primary" onClick={() => setGroup(true)}><Send />Message à plusieurs clients</button>
      </div>
      <ErrorBox error={threads.error} />
      <Card bodyClass="">
        {threads.loading && !threads.data ? <div className="card-body"><Skeleton h={160} /></div>
          : !threads.data?.length ? <Empty icon={MessagesSquare}>Aucun message de client pour l’instant.</Empty>
          : (
            <div className="table-wrap"><table className="table"><tbody>
              {threads.data.map(t => (
                <tr key={t.lead_id} className="clickable" onClick={() => setOpen(t)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(t)}>
                  <td style={{ width: '30%' }}><strong>{t.name}</strong><div className="small muted tabular">{t.client_code}</div></td>
                  <td>
                    <div className="small muted" style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {t.last.sender === 'equipe' ? 'Vous : ' : ''}{t.last.body}
                    </div>
                  </td>
                  <td className="small muted nowrap">{relative(t.last.created_at)}</td>
                  <td className="right">{t.unread > 0 ? <Badge tone="brand">{t.unread} non lu{t.unread > 1 ? 's' : ''}</Badge> : <span className="small muted">{t.total} message{t.total > 1 ? 's' : ''}</span>}</td>
                </tr>
              ))}
            </tbody></table></div>
          )}
      </Card>

      {group && <GroupMessage onClose={() => setGroup(false)} onSent={() => threads.reload()} />}
      {open && (
        <Drawer title={<>{open.name} <span className="muted tabular" style={{ fontWeight: 400 }}>· {open.client_code}</span></>} onClose={() => setOpen(null)}>
          <MessageThread leadId={open.lead_id} onRead={onRead} />
        </Drawer>
      )}
    </div>
  );
}

/**
 * Même message à plusieurs clients : chacun le reçoit dans sa propre conversation (espace client) avec une alerte
 * par e-mail. La liste ne propose que les clients du compte (tous avec la portée « toute l'équipe »).
 */
function GroupMessage({ onClose, onSent }) {
  const saved = useSaved();
  const clients = useResource('/admin/clients');
  const [picked, setPicked] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const projects = useMemo(() => [...new Set((clients.data || []).flatMap(c => c.sales.map(s => s.project_name)).filter(Boolean))].sort(), [clients.data]);
  const shown = (clients.data || []).filter(c => (!q || `${c.name} ${c.client_code}`.toLowerCase().includes(q.toLowerCase()))
    && (!project || c.sales.some(s => s.project_name === project)));
  const toggle = id => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShown = shown.length > 0 && shown.every(c => picked.has(c.lead_id));
  const toggleAll = () => setPicked(s => { const n = new Set(s); shown.forEach(c => (allShown ? n.delete(c.lead_id) : n.add(c.lead_id))); return n; });
  const send = async () => {
    setBusy(true); setError(null);
    try {
      const out = await api.post('/admin/client-messages/groupe', { lead_ids: [...picked], body });
      saved(`Message envoyé à ${out.sent} client${out.sent > 1 ? 's' : ''}`);
      onSent(); onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Message à plusieurs clients" onClose={onClose}
      footer={<><span className="small muted" style={{ marginRight: 'auto' }}>{picked.size} destinataire{picked.size > 1 ? 's' : ''}</span><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy || !picked.size || !body.trim()} onClick={send}><Send />Envoyer</button></>}>
      <ErrorBox error={error || clients.error} />
      <div className="stack">
        <div className="row">
          <div className="search" style={{ flex: 1 }}><Search aria-hidden="true" /><input className="input" placeholder="Nom ou code client…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un client" /></div>
          <select className="select" style={{ width: 'auto' }} value={project} onChange={e => setProject(e.target.value)} aria-label="Programme">
            <option value="">Tous les programmes</option>
            {projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {!clients.data ? <Skeleton h={160} /> : !shown.length ? <Empty>Aucun client ne correspond.</Empty> : (
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}><table className="table table-compact"><tbody>
            <tr><td colSpan={2}><label className="checkbox"><input type="checkbox" checked={allShown} onChange={toggleAll} />Tout cocher ({shown.length})</label></td></tr>
            {shown.map(c => (
              <tr key={c.lead_id}>
                <td><label className="checkbox"><input type="checkbox" checked={picked.has(c.lead_id)} onChange={() => toggle(c.lead_id)} />{c.name}</label></td>
                <td className="small muted tabular right">{c.client_code}{c.access?.active ? '' : ' · sans accès'}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        <Field label="Message" hint="Chaque client le reçoit dans sa conversation ; ceux qui ont un accès actif sont prévenus par e-mail">
          <textarea className="textarea" rows={5} value={body} onChange={e => setBody(e.target.value)} maxLength={4000} />
        </Field>
      </div>
    </Modal>
  );
}
