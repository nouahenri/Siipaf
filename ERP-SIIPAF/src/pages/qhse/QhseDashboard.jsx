/**
 * QHSE › Tableau de bord : indicateurs par chantier sur 30 jours (notes moyennes de qualité et d'hygiène, % d'ouvriers respectant la
 * sécurité, conformité environnementale), tendance de la semaine contre la précédente, contrôles du jour manquants, actions
 * correctives ouvertes ou en retard, audits à valider ou à venir.
 */
import { Link } from 'react-router-dom';
import { Gauge, SprayCan, HardHat, Leaf, ClipboardCheck, AlertTriangle, ListChecks, ShieldCheck, Plus, SearchCheck } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Badge, Card, Empty, ErrorBox, Skeleton } from '@admin/components/ui';
import { LineChart } from '@admin/components/Charts';
import { Kpi } from '../commercial/CommercialDashboard';
import { QH, useQhseRefs, RatingBadge, PctBadge, Trend, AUDIT_TONES, frDay, fmt1 } from '../../lib/qhse';

const dayLabel = d => `${d.slice(8)}/${d.slice(5, 7)}`;
const tenth = v => (v == null ? null : Math.round(v * 10));

export default function QhseDashboard() {
  const { can } = useAuth();
  const refs = useQhseRefs();
  const res = useResource(`${QH}/dashboard`);
  const d = res.data;
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d || !refs) return <div className="grid grid-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</div>;
  const k = d.kpis;
  const t = d.threshold;
  const series = d.series.map(s => ({ ...s, qualite: s.qualite, hygiene: s.hygiene }));

  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <p className="muted" style={{ margin: 0 }}>Les {d.days} derniers jours, sur {k.worksites} chantier(s) ouvert(s). Tendance : les 7 derniers jours contre les 7 précédents. Seuil de sécurité : {t} %.</p>
        {can('qhse:control') && <Link to="/qhse/controles/nouveau" className="btn btn-primary"><Plus />Contrôle du jour</Link>}
      </div>

      <div className="grid grid-4">
        <Kpi icon={Gauge} label="Qualité (note moyenne)" count={tenth(k.qualite_avg)} format={v => fmt1(v / 10)} foot={<><Trend value={k.trend.qualite} /> {k.qualite_avg != null && refs.ratings[Math.round(k.qualite_avg)]}</>} />
        <Kpi icon={SprayCan} label="Hygiène (note moyenne)" count={tenth(k.hygiene_avg)} format={v => fmt1(v / 10)} foot={<><Trend value={k.trend.hygiene} /> {k.hygiene_avg != null && refs.ratings[Math.round(k.hygiene_avg)]}</>} />
        <Kpi icon={HardHat} label="Sécurité : ouvriers conformes" count={k.safety_avg == null ? null : Math.round(k.safety_avg)} format={v => `${v} %`} tint={k.safety_avg != null && k.safety_avg < t ? 'amber' : undefined} foot={<Trend value={k.trend.safety} unit=" pt" />} />
        <Kpi icon={Leaf} label="Environnement : conformité" count={k.env_avg == null ? null : Math.round(k.env_avg)} format={v => `${v} %`} foot={<Trend value={k.trend.env} unit=" pt" />} />
      </div>
      <div className="grid grid-4">
        <Kpi to="/qhse/controles" icon={ClipboardCheck} label="Contrôles du jour manquants" count={k.missing_today} tint={k.missing_today ? 'amber' : undefined} foot={d.working_day ? `chantiers en cours, avant ${d.check_hour} h` : 'jour non ouvré'} />
        <Kpi to="/qhse/controles" icon={AlertTriangle} label="Alertes des 7 derniers jours" count={k.bad_7d + k.low_safety_7d} tint={k.bad_7d + k.low_safety_7d ? 'amber' : undefined} foot={`${k.bad_7d} note(s) « Mauvais » · ${k.low_safety_7d} sécurité sous le seuil`} />
        <Kpi to="/qhse/actions" icon={ListChecks} label="Actions correctives ouvertes" count={k.open_actions} tint={k.late_actions ? 'amber' : undefined} foot={`${k.late_actions} en retard`} />
        <Kpi to="/qhse/hebdomadaires?etat=a_valider" icon={ShieldCheck} label="À valider" count={k.weekly_to_validate + k.audits_to_validate} foot={`${k.weekly_to_validate} synthèse(s) hebdomadaire(s) · ${k.audits_to_validate} audit(s)`} />
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Qualité et hygiène" actions={<span className="small muted">note moyenne par jour (1 à 4)</span>}>
          <LineChart data={series} xKey="day" labelOf={dayLabel} titleOf={frDay} format={v => fmt1(v)} height={220} ariaLabel="Notes moyennes de qualité et d’hygiène par jour"
            series={[{ key: 'qualite', label: 'Qualité', color: 'var(--series-1)' }, { key: 'hygiene', label: 'Hygiène', color: 'var(--series-3)' }]} />
        </Card>
        <Card title="Sécurité et environnement" actions={<span className="small muted">% moyen par jour</span>}>
          <LineChart data={series} xKey="day" labelOf={dayLabel} titleOf={frDay} format={v => `${Math.round(v)} %`} height={220} ariaLabel="Ouvriers respectant la sécurité et conformité environnementale par jour"
            series={[{ key: 'safety', label: 'Sécurité', color: 'var(--series-2)' }, { key: 'env', label: 'Environnement', color: '#6d28d9' }]} />
        </Card>
      </div>

      <Card title="Chantiers" bodyClass="">
        {!d.worksites.length ? <div className="card-body"><Empty icon={HardHat}>Aucun chantier ouvert à suivre.</Empty></div> : (
          <div className="table-wrap table-scroll"><table className="table table-compact">
            <thead><tr><th>Chantier</th><th>Aujourd’hui</th><th>Qualité</th><th>Hygiène</th><th>Sécurité</th><th>Environnement</th><th className="right">Actions</th></tr></thead>
            <tbody>{d.worksites.map(w => (
              <tr key={w.id}>
                <td><Link className="link" to={`/chantiers/${w.id}?onglet=qhse`}><b>{w.reference}</b></Link><div className="small muted">{w.name}{w.manager_name ? ` · ${w.manager_name}` : ''}</div></td>
                <td>{w.today_done ? <Badge tone="ok">Fait</Badge> : w.missing_today ? <Link to={`/qhse/controles/nouveau?chantier=${w.id}`}><Badge tone="warn">À saisir</Badge></Link> : <span className="small muted">{w.last_day ? `dernier ${frDay(w.last_day)}` : 'aucun'}</span>}</td>
                <td><RatingBadge value={w.qualite_avg} labels={refs.ratings} avg /> <Trend value={w.trend.qualite} /></td>
                <td><RatingBadge value={w.hygiene_avg} labels={refs.ratings} avg /> <Trend value={w.trend.hygiene} /></td>
                <td><PctBadge value={w.safety_avg} threshold={t} /> <Trend value={w.trend.safety} unit=" pt" /></td>
                <td>{w.env_avg == null ? <span className="muted">—</span> : <PctBadge value={w.env_avg} threshold={80} />}</td>
                <td className="right tabular">{w.open_actions}{w.late_actions > 0 && <> <Badge tone="danger">{w.late_actions} en retard</Badge></>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Actions correctives en retard" actions={<Link className="small" to="/qhse/actions?statut=retard">Toutes les actions</Link>} bodyClass="">
          {!d.late_actions.length ? <div className="card-body"><p className="small muted" style={{ margin: 0 }}>Aucune action en retard.</p></div> : (
            <ul className="list">{d.late_actions.map(a => (
              <li key={a.id}><Link className="list-row" to={`/qhse/actions?fiche=${a.id}`}><span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{a.title}</strong><span className="small muted ellipsis">{a.owner_name || '—'}{a.worksite_reference ? ` · ${a.worksite_reference}` : ''}</span></span><span className="small nowrap" style={{ color: 'var(--danger)' }}>{a.days_late} j de retard</span></Link></li>
            ))}</ul>
          )}
        </Card>
        <Card title="Audits" actions={<Link className="small" to="/qhse/audits">Tous les audits</Link>} bodyClass="">
          {!d.audits_to_validate.length && !d.audits_upcoming.length ? <div className="card-body"><Empty icon={SearchCheck}>Aucun audit à valider ni à venir dans les 14 jours.</Empty></div> : (
            <ul className="list">
              {d.audits_to_validate.map(a => <li key={a.id}><Link className="list-row" to={`/qhse/audits/${a.id}`}><span><strong>{a.reference}</strong><span className="small muted"> · {a.place_label}</span></span><Badge tone={AUDIT_TONES.a_valider}>À valider</Badge></Link></li>)}
              {d.audits_upcoming.map(a => <li key={a.id}><Link className="list-row" to={`/qhse/audits/${a.id}`}><span><strong>{a.reference}</strong><span className="small muted"> · {a.place_label}</span></span><span className="small nowrap">{frDay(a.planned_on)}</span></Link></li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
