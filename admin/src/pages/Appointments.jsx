import { useMemo, useState } from 'react';
import { CalendarDays, Phone } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Card, Badge, Empty, ErrorBox, Skeleton } from '../components/ui';
import { APPT_KINDS, APPT_STATUS } from '../lib/domain';

const DAY = 86400000;
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const toDate = v => new Date(typeof v === 'number' || /^\d+$/.test(v) ? Number(v) : v);

const RANGES = {
  avenir: { label: 'À venir (30 jours)', from: () => startOfDay(Date.now()), to: () => new Date(Date.now() + 30 * DAY) },
  semaine: { label: 'Cette semaine', from: () => startOfDay(Date.now()), to: () => new Date(startOfDay(Date.now()).getTime() + 7 * DAY) },
  passes: { label: 'Passés (30 jours)', from: () => new Date(Date.now() - 30 * DAY), to: () => new Date() },
};

export default function Appointments() {
  const { can } = useAuth();
  const toast = useToast();
  const [range, setRange] = useState('avenir');
  const [status, setStatus] = useState('');
  // Bornes figées par plage : les recalculer à chaque rendu relancerait le chargement en boucle
  const bounds = useMemo(() => ({ from: RANGES[range].from().toISOString(), to: RANGES[range].to().toISOString() }), [range]);
  const appts = useResource(`/admin/appointments${qs({ ...bounds, status })}`);

  const setApptStatus = async (a, next) => {
    try {
      await api.patch(`/admin/appointments/${a.id}`, { status: next });
      appts.setData(list => list.map(x => (x.id === a.id ? { ...x, status: next } : x)));
      toast(`Rendez-vous ${APPT_STATUS[next].label.toLowerCase()}`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const groups = {};
  for (const a of appts.data || []) {
    const key = startOfDay(toDate(a.starts_at)).getTime();
    (groups[key] ||= []).push(a);
  }

  return (
    <div className="stack">
      <div className="row-between">
        <div className="seg">
          {Object.entries(RANGES).map(([k, v]) => <button key={k} className={range === k ? 'active' : ''} onClick={() => setRange(k)}>{v.label}</button>)}
        </div>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {Object.entries(APPT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <p className="small muted">Les rendez-vous se planifient depuis la fiche d’un prospect. Les demandes faites sur le site arrivent ici avec le statut « Demandé ».</p>
      <ErrorBox error={appts.error} />
      {appts.loading && !appts.data ? <Card><Skeleton h={200} /></Card>
        : !appts.data?.length ? <Card><Empty icon={CalendarDays}>Aucun rendez-vous sur cette période.</Empty></Card>
        : Object.entries(groups).map(([day, list]) => (
          <Card key={day} title={new Date(Number(day)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} bodyClass="">
            <div className="table-wrap"><table className="table"><tbody>
              {list.map(a => (
                <tr key={a.id}>
                  <td className="nowrap tabular" style={{ width: 80 }}><strong>{toDate(a.starts_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong><div className="small muted">{a.duration_min} min</div></td>
                  <td><strong>{a.lead_name}</strong><div className="small muted">{APPT_KINDS[a.kind]}{a.project_name ? ` · ${a.project_name}` : ''}{a.notes ? ` · ${a.notes}` : ''}</div></td>
                  <td className="small">{a.assigned_name || <span className="muted">Non assigné</span>}</td>
                  <td>{a.lead_phone && <a className="btn btn-sm btn-ghost" href={`tel:${a.lead_phone}`} aria-label={`Appeler ${a.lead_name}`}><Phone /></a>}</td>
                  <td className="right nowrap">
                    {can('appointments:write') ? (
                      <select className="select" style={{ width: 'auto', height: 32 }} value={a.status} onChange={e => setApptStatus(a, e.target.value)} aria-label="Statut du rendez-vous">
                        {Object.entries(APPT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    ) : <Badge tone={APPT_STATUS[a.status].tone}>{APPT_STATUS[a.status].label}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody></table></div>
          </Card>
        ))}
    </div>
  );
}
