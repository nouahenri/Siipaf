/**
 * Demandes adressées à ce service par les employés (Mon espace › Demandes internes › « Demande à un service »),
 * affichées au tableau de bord du module (choix du client du 29/10) : prendre en charge, répondre ou refuser.
 * Mêmes droits que le serveur (lib/domain.js, REQUEST_SERVICES). Rien n'est affiché à qui ne traite pas ce service.
 */
import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, Badge, ErrorBox } from '@admin/components/ui';
import { date, relative } from '@admin/lib/format';
import { RequestDrawer } from '../pages/admin/Demandes';
import { REQUEST_TONES } from './MyRequests';

const URL = '/admin/erp/demandes';
export const SERVICE_PERMS = { rh: ['rh:files'], commercial: ['leads:assign'], sav: ['sav:handle'], compta: ['compta:entries', 'achats:write'], juridique: ['juridique:write'] };

export default function ServiceRequests({ service }) {
  const { can } = useAuth();
  const allowed = can(SERVICE_PERMS[service] || []);
  const list = useResource(allowed ? `${URL}?scope=service&service=${service}` : null);
  const refs = useResource(allowed ? `${URL}/refs` : null);
  const [open, setOpen] = useState(null);
  if (!allowed) return null;
  const rows = list.data || [];
  return (
    <Card title={<span className="row" style={{ gap: 8 }}>Demandes reçues{rows.length > 0 && <Badge tone="warn">{rows.length}</Badge>}</span>} actions={<span className="small muted">Adressées à ce service depuis Mon espace</span>} bodyClass="">
      <ErrorBox error={list.error} />
      {!list.data ? <div className="card-body"><Skeleton h={80} /></div> : !rows.length ? <div className="card-body"><Empty icon={Inbox}>Aucune demande en attente. Les employés écrivent au service depuis Mon espace › Demandes internes.</Empty></div> : (
        <div className="table-wrap"><table className="table table-compact"><tbody>{rows.map(r => (
          <tr key={r.id} className="clickable" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={e => e.key === 'Enter' && setOpen(r.id)}>
            <td><b>{r.title}</b><div className="small muted">{r.reference} · {r.requested_by_name} · {relative(r.created_at)}{r.urgency === 'urgente' ? ' · urgente' : ''}</div></td>
            <td className="small nowrap">{r.needed_by ? `pour le ${date(r.needed_by)}` : ''}</td>
            <td className="right"><Badge tone={REQUEST_TONES[r.status]}>{r.status === 'en_cours' ? 'En cours' : 'À traiter'}</Badge></td>
          </tr>
        ))}</tbody></table></div>
      )}
      {open && refs.data && <RequestDrawer id={open} refs={refs.data} onClose={() => setOpen(null)} onChange={list.reload} />}
    </Card>
  );
}
