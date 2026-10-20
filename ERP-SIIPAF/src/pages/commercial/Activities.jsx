import { useState } from 'react';
import { Clock, ListTodo } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox } from '@admin/components/ui';
import { dateTime } from '@admin/lib/format';
import { useCommercialMeta, ACTIVITY_STATE } from '../../lib/commercial';
import LeadDrawer from './LeadDrawer';

const GROUPS = [['retard', 'En retard'], ['aujourdhui', 'Aujourd’hui'], ['a_venir', 'À venir']];

/** Activités à faire, regroupées par échéance (vue « Mes activités » d'Odoo). */
export default function Activities() {
  const { can } = useAuth();
  const meta = useCommercialMeta();
  const [scope, setScope] = useState('mine');
  const [assigned, setAssigned] = useState('');
  const [leadId, setLeadId] = useState(null);
  const list = useResource(`/admin/erp/commercial/activities?mine=${scope === 'mine' ? '1' : '0'}${scope === 'team' && assigned ? `&assigned_to=${assigned}` : ''}`);
  const rows = list.data || [];

  return (
    <div className="stack">
      <div className="row">
        <div className="seg" role="group" aria-label="Portée">
          <button className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}>Les miennes</button>
          {can('leads:read') && <button className={scope === 'team' ? 'active' : ''} onClick={() => setScope('team')}>Toute l’équipe</button>}
        </div>
        {scope === 'team' && (
          <select className="select" style={{ width: 'auto' }} value={assigned} onChange={e => setAssigned(e.target.value)} aria-label="Commercial">
            <option value="">Tous</option>
            {meta?.sellers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? <Skeleton h={240} /> : !rows.length ? <Card><Empty icon={ListTodo}>Rien à faire pour l’instant.</Empty></Card> : (
        <div className="grid grid-3">
          {GROUPS.map(([st, label]) => {
            const items = rows.filter(a => a.state === st);
            return (
              <Card key={st} title={<span style={{ color: ACTIVITY_STATE[st].color }}>{label} · {items.length}</span>} bodyClass="">
                {!items.length ? <div className="card-body muted small">—</div> : (
                  <ul className="list">
                    {items.map(a => (
                      <li key={a.id}>
                        <button className="list-row" style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => setLeadId(a.lead_id)}>
                          <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                            <b className="ellipsis"><Clock className="ico" aria-hidden="true" style={{ color: ACTIVITY_STATE[st].color }} />{a.label} · {a.lead_name}</b>
                            <span className="small muted ellipsis">{a.summary !== a.label ? a.summary : ''}{a.project_name ? ` · ${a.project_name}` : ''}{scope === 'team' && a.assigned_name ? ` · ${a.assigned_name}` : ''}</span>
                          </span>
                          <span className="small nowrap">{dateTime(a.due_at)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {leadId && <LeadDrawer id={leadId} onClose={() => setLeadId(null)} onChange={() => list.reload()} />}
    </div>
  );
}
