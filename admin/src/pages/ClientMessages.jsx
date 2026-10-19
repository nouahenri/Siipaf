import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { useResource } from '../lib/app-context';
import { Card, Drawer, Badge, Empty, ErrorBox, Skeleton } from '../components/ui';
import { MessageThread } from '../components/ClientSpace';
import { relative } from '../lib/format';

/** Fils de discussion avec les acquéreurs (espace client), du plus récent au plus ancien. */
export default function ClientMessages() {
  const { stats } = useOutletContext(); // pastille du menu
  const threads = useResource('/admin/client-messages');
  const [open, setOpen] = useState(null);

  const onRead = () => { threads.reload(); stats.reload(); };

  return (
    <div className="stack">
      <p className="small muted">Les messages envoyés par les acquéreurs depuis leur espace client. Ouvrez un fil pour le lire et répondre.</p>
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

      {open && (
        <Drawer title={<>{open.name} <span className="muted tabular" style={{ fontWeight: 400 }}>· {open.client_code}</span></>} onClose={() => setOpen(null)}>
          <MessageThread leadId={open.lead_id} onRead={onRead} />
        </Drawer>
      )}
    </div>
  );
}
