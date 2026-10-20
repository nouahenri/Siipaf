import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarClock, User, MapPin, Phone } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Badge } from '@admin/components/ui';
import { useSavMeta } from '../../components/SavBits';
import { INTERVENTION_LABELS } from '../../lib/sav';
import TicketDrawer from './TicketDrawer';

const startOfWeek = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = v => new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Planning hebdomadaire des interventions, jour par jour. */
export default function Interventions() {
  const meta = useSavMeta();
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [tech, setTech] = useState('');
  const [ticket, setTicket] = useState(null);
  const end = addDays(week, 7);
  const list = useResource(`/admin/erp/sav/interventions?from=${week.toISOString()}&to=${end.toISOString()}${tech ? `&technician_id=${tech}` : ''}`);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const byDay = useMemo(() => {
    const out = {};
    (list.data || []).forEach(i => { (out[ymd(new Date(i.scheduled_at))] ||= []).push(i); });
    return out;
  }, [list.data]);
  const today = ymd(new Date());
  const label = `${week.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} – ${addDays(week, 6).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <button className="btn btn-icon" onClick={() => setWeek(w => addDays(w, -7))} aria-label="Semaine précédente"><ChevronLeft /></button>
          <button className="btn btn-sm" onClick={() => setWeek(startOfWeek(new Date()))}>Cette semaine</button>
          <button className="btn btn-icon" onClick={() => setWeek(w => addDays(w, 7))} aria-label="Semaine suivante"><ChevronRight /></button>
          <strong className="tabular">{label}</strong>
        </div>
        <select className="select" style={{ width: 'auto' }} value={tech} onChange={e => setTech(e.target.value)} aria-label="Technicien">
          <option value="">Tous les intervenants</option>
          {meta?.technicians.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? <Skeleton h={320} /> : !list.data.length ? (
        <Card><Empty icon={CalendarClock}>Aucune intervention cette semaine. Planifiez-les depuis une réclamation.</Empty></Card>
      ) : (
        <div className="agenda">
          {days.map(d => {
            const items = byDay[ymd(d)] || [];
            return (
              <section key={ymd(d)} className={`agenda-day ${ymd(d) === today ? 'today' : ''} ${items.length ? '' : 'empty'}`}>
                <h3>{d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
                {items.map(i => (
                  <button key={i.id} className={`agenda-item st-${i.status}`} onClick={() => i.ticket_id && setTicket(i.ticket_id)} disabled={!i.ticket_id}>
                    <span className="agenda-time tabular">{time(i.scheduled_at)}<small>{i.duration_min} min</small></span>
                    <span className="stack" style={{ gap: 2, minWidth: 0, textAlign: 'left' }}>
                      <b className="ellipsis">{i.ticket_ref ? `${i.ticket_ref} · ${i.ticket_title}` : i.reserve_label}</b>
                      <span className="small muted"><MapPin className="ico" aria-hidden="true" />{i.client_name || '—'} · {i.project_name || '—'}{i.lot_code ? ` · lot ${i.lot_code}` : ''}</span>
                      <span className="small muted">
                        <User className="ico" aria-hidden="true" />{i.technician_name || i.contractor || 'Intervenant à désigner'}
                        {i.client_phone && <> · <Phone className="ico" aria-hidden="true" />{i.client_phone}</>}
                      </span>
                    </span>
                    <Badge tone={i.status === 'realisee' ? 'ok' : i.status === 'annulee' ? '' : 'warn'}>{INTERVENTION_LABELS[i.status]}</Badge>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {ticket && <TicketDrawer id={ticket} onClose={() => setTicket(null)} onChange={() => list.reload()} />}
    </div>
  );
}
