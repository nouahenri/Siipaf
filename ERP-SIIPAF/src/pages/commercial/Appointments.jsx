import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Phone, MapPin, User } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Badge } from '@admin/components/ui';
import { APPT_KINDS, APPT_STATUS } from '@admin/lib/domain';
import LeadDrawer from './LeadDrawer';

const startOfWeek = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Agenda de la semaine : visites, appels, rendez-vous au bureau ; une visite effectuée fait avancer le prospect. */
export default function Appointments() {
  const { can } = useAuth();
  const toast = useToast();
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [leadId, setLeadId] = useState(null);
  const list = useResource(`/admin/appointments?from=${week.toISOString()}&to=${addDays(week, 7).toISOString()}`);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const byDay = useMemo(() => {
    const out = {};
    (list.data || []).forEach(a => { (out[ymd(new Date(a.starts_at))] ||= []).push(a); });
    return out;
  }, [list.data]);

  const setStatus = async (a, status) => {
    try { await api.patch(`/admin/appointments/${a.id}`, { status }); toast('Rendez-vous mis à jour'); list.reload(); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn-icon" onClick={() => setWeek(w => addDays(w, -7))} aria-label="Semaine précédente"><ChevronLeft /></button>
        <button className="btn btn-sm" onClick={() => setWeek(startOfWeek(new Date()))}>Cette semaine</button>
        <button className="btn btn-icon" onClick={() => setWeek(w => addDays(w, 7))} aria-label="Semaine suivante"><ChevronRight /></button>
        <strong>{week.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} – {addDays(week, 6).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? <Skeleton h={300} /> : !list.data.length ? <Card><Empty icon={CalendarDays}>Aucun rendez-vous cette semaine. Planifiez-les depuis la fiche d’un prospect.</Empty></Card> : (
        <div className="agenda">
          {days.map(d => {
            const items = byDay[ymd(d)] || [];
            return (
              <section key={ymd(d)} className={`agenda-day ${ymd(d) === ymd(new Date()) ? 'today' : ''} ${items.length ? '' : 'empty'}`}>
                <h3>{d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
                {items.map(a => (
                  <div key={a.id} className={`agenda-item st-${a.status === 'annule' ? 'annulee' : a.status}`} style={{ cursor: 'default' }}>
                    <span className="agenda-time tabular">{new Date(a.starts_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}<small>{a.duration_min} min</small></span>
                    <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <button className="link" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, textAlign: 'left' }} onClick={() => setLeadId(a.lead_id)}>{APPT_KINDS[a.kind]} · {a.lead_name}</button>
                      <span className="small muted"><MapPin className="ico" aria-hidden="true" />{a.project_name || '—'} · <User className="ico" aria-hidden="true" />{a.assigned_name || 'à attribuer'}{a.lead_phone && <> · <Phone className="ico" aria-hidden="true" />{a.lead_phone}</>}</span>
                      {can('appointments:write') && ['demande', 'confirme'].includes(a.status) && (
                        <span className="row" style={{ gap: 6, marginTop: 4 }}>
                          {a.status === 'demande' && <button className="btn btn-sm" onClick={() => setStatus(a, 'confirme')}>Confirmer</button>}
                          <button className="btn btn-sm" onClick={() => setStatus(a, 'effectue')}>Effectué</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setStatus(a, 'absent')}>Absent</button>
                          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setStatus(a, 'annule')}>Annuler</button>
                        </span>
                      )}
                    </span>
                    <Badge tone={APPT_STATUS[a.status]?.tone}>{APPT_STATUS[a.status]?.label}</Badge>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {leadId && <LeadDrawer id={leadId} onClose={() => setLeadId(null)} onChange={() => list.reload()} />}
    </div>
  );
}
