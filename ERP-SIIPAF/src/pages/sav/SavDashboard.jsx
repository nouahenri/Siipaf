import { Link } from 'react-router-dom';
import { ClipboardList, AlarmClock, Timer, Smile, ClipboardCheck, CalendarClock, ArrowRight } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, DistributionBar } from '@admin/components/ui';
import { LineChart, BarList, useCountUp } from '@admin/components/Charts';
import { dateTime, relative, num } from '@admin/lib/format';
import { useSavMeta, Priority } from '../../components/SavBits';
import { STATUS_COLORS } from '../../lib/sav';

const Kpi = ({ icon: Icon, label, count, format = num, foot, to, tint }) => {
  const animated = useCountUp(count ?? 0);
  const body = (
    <div className={`card kpi ${tint ? `tint-${tint}` : ''}`}>
      <span className="kpi-label"><Icon aria-hidden="true" />{label}</span>
      <span className="kpi-value">{count == null ? '—' : format(Math.round(animated * 10) / 10)}</span>
      {foot && <span className="kpi-foot">{foot}</span>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
};

const hoursLabel = h => (h >= 48 ? `${Math.round(h / 24)} j` : `${Math.round(h)} h`);

export default function SavDashboard() {
  const meta = useSavMeta();
  const stats = useResource('/admin/erp/sav/stats');
  const late = useResource('/admin/erp/sav/tickets?overdue=1&limit=6');
  const next = useResource(`/admin/erp/sav/interventions?status=planifiee&from=${new Date().toISOString().slice(0, 10)}`);
  const s = stats.data;

  if (!s) return <div className="grid grid-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</div>;

  const statusItems = (meta?.statuses || []).filter(k => s.by_status[k]).map(k => ({ id: k, label: meta.status_labels[k], value: s.by_status[k], color: STATUS_COLORS[k] }));
  const categoryItems = Object.entries(s.by_category).map(([k, v]) => ({ label: meta?.categories?.[k] || k, value: v })).sort((a, b) => b.value - a.value);

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Kpi icon={ClipboardList} label="Réclamations ouvertes" count={s.open} to="/sav/reclamations?open=1" tint="blue" foot={`${s.urgent} haute ou urgente`} />
        <Kpi icon={AlarmClock} label="En retard sur l’échéance" count={s.overdue} to="/sav/reclamations?overdue=1" tint={s.overdue ? 'amber' : undefined} foot="délai de la priorité dépassé" />
        <Kpi icon={Timer} label="Délai moyen de résolution" count={s.avg_resolution_hours} format={hoursLabel}
          foot={s.on_time_rate == null ? 'aucune réclamation résolue' : `${s.on_time_rate} % dans les délais`} tint="green" />
        <Kpi icon={Smile} label="Satisfaction client" count={s.satisfaction_avg} format={v => `${v.toLocaleString('fr-FR')} / 5`}
          foot={`${s.satisfaction_count} avis`} tint="violet" />
      </div>

      <div className="grid grid-2">
        <Card title="Réclamations ouvertes et résolues — 6 mois">
          <LineChart data={s.months} xKey="month" area ariaLabel="Réclamations ouvertes et résolues par mois"
            series={[{ key: 'ouvertes', label: 'Ouvertes', color: 'var(--series-1)' }, { key: 'resolues', label: 'Résolues', color: '#1baf7a' }]} />
        </Card>
        <Card title="Répartition par statut">
          {statusItems.length ? (
            <DistributionBar items={statusItems} />
          ) : <Empty>Aucune réclamation pour l’instant.</Empty>}
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="Par type de problème">
          <BarList items={categoryItems} />
        </Card>
        <Card title="Ouvertes par programme">
          <BarList items={s.open_by_project.map(p => ({ label: p.name, value: p.n }))} color="var(--series-2)" />
        </Card>
        <Card title="Livraisons et interventions">
          <div className="stack" style={{ gap: 14 }}>
            <Link to="/sav/reserves" className="mini-stat"><ClipboardCheck aria-hidden="true" /><span><b>{s.reserves.ouverte || 0}</b> réserve(s) à lever</span><span className="muted small">{s.reserves.levee || 0} levée(s)</span></Link>
            <Link to="/sav/interventions" className="mini-stat"><CalendarClock aria-hidden="true" /><span><b>{s.upcoming_interventions}</b> intervention(s) à venir</span><ArrowRight aria-hidden="true" /></Link>
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="En retard : à traiter d’abord" bodyClass="" actions={<Link className="btn btn-sm btn-ghost" to="/sav/reclamations?overdue=1">Tout voir <ArrowRight /></Link>}>
          {!late.data ? <div className="card-body"><Skeleton h={120} /></div> : !late.data.rows.length ? <div className="card-body"><Empty icon={Smile}>Aucune réclamation en retard.</Empty></div> : (
            <ul className="list">
              {late.data.rows.map(t => (
                <li key={t.id}>
                  <Link to={`/sav/reclamations?t=${t.id}`} className="list-row">
                    <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <b className="ellipsis">{t.ref} · {t.title}</b>
                      <span className="muted small">{t.client_name || '—'} · {t.project_name || '—'} {t.lot_code ? `· lot ${t.lot_code}` : ''}</span>
                    </span>
                    <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                      <Priority priority={t.priority} meta={meta} />
                      <span className="small" style={{ color: 'var(--danger)' }}>échéance {relative(t.due_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Prochaines interventions" bodyClass="" actions={<Link className="btn btn-sm btn-ghost" to="/sav/interventions">Planning <ArrowRight /></Link>}>
          {!next.data ? <div className="card-body"><Skeleton h={120} /></div> : !next.data.length ? <div className="card-body"><Empty icon={CalendarClock}>Aucune intervention planifiée.</Empty></div> : (
            <ul className="list">
              {next.data.slice(0, 6).map(i => (
                <li key={i.id}>
                  <Link to={i.ticket_id ? `/sav/reclamations?t=${i.ticket_id}` : '/sav/interventions'} className="list-row">
                    <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <b className="ellipsis">{i.ticket_ref ? `${i.ticket_ref} · ${i.ticket_title}` : i.reserve_label}</b>
                      <span className="muted small">{i.client_name || '—'} · {i.technician_name || i.contractor || 'intervenant à désigner'}</span>
                    </span>
                    <span className="small tabular nowrap">{dateTime(i.scheduled_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
