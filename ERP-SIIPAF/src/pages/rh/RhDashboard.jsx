import { Link } from 'react-router-dom';
import { Users, UserCheck, Palmtree, Inbox, Receipt, Briefcase, Activity, Hourglass, AlertTriangle, Cake, GraduationCap, ArrowRight } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Card, Skeleton, Empty, ErrorBox, Badge } from '@admin/components/ui';
import { useCountUp, monthLabel } from '@admin/components/Charts';
import { SmoothAreaChart, GroupedBars, HighlightBars, Donut } from '@admin/components/ChartsPlus';
import { date } from '@admin/lib/format';
import { RH, useRhMeta } from '../../lib/rh';

function Kpi({ icon: Icon, label, value, suffix = '', foot, tint, to }) {
  const v = useCountUp(value ?? 0);
  const body = (
    <div className={`card kpi ${tint ? `tint-${tint}` : ''}`}>
      <span className="kpi-label"><Icon aria-hidden="true" />{label}</span>
      <span className="kpi-value">{value == null ? '—' : `${(Math.round(v * 10) / 10).toLocaleString('fr-FR')}${suffix}`}</span>
      {foot && <span className="kpi-foot">{foot}</span>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

// Effectifs et comptes : entiers, mais les graduations intermédiaires d'un petit axe sont décimales
const count = v => (Number.isInteger(v) ? String(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));

const ALERT_ICONS = { essai: Hourglass, contrat: Briefcase, document: AlertTriangle, habilitation: AlertTriangle };

/** Tableau de bord RH : effectif, présence du jour, demandes à traiter, absentéisme, échéances du personnel. */
export default function RhDashboard() {
  const { meta } = useRhMeta();
  const dash = useResource(`${RH}/dashboard`);
  const d = dash.data;
  if (dash.error) return <ErrorBox error={dash.error} />;
  if (!d) return <div className="grid grid-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</div>;
  const short = m => monthLabel(m.month).split(' ')[0];
  const absences = d.months.map(m => ({ month: m.month, days: Object.values(m.absences).reduce((t, n) => t + n, 0) }));
  const label = (map, k) => map?.[k] || (k === '—' ? 'Non renseigné' : k);
  const cur = d.months[d.months.length - 1];

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Kpi icon={Users} label="Effectif" value={d.headcount} foot={`ancienneté moyenne ${d.avg_seniority.toLocaleString('fr-FR')} an(s) · ${cur.entrees} entrée(s) ce mois`} tint="blue" to="/rh/personnel" />
        <Kpi icon={UserCheck} label="Présents en ce moment" value={d.present_now} foot={`${d.absent_today.length} absent(s) aujourd’hui`} tint="green" to="/rh/presences" />
        <Kpi icon={Inbox} label="Congés à approuver" value={d.pending} foot="demandes en attente" tint={d.pending ? 'amber' : undefined} to="/rh/conges" />
        <Kpi icon={Activity} label="Absentéisme du mois" value={d.absenteeism_pct} suffix=" %" foot="maladie, accident, sans solde, injustifiées" tint={d.absenteeism_pct > 5 ? 'amber' : 'violet'} to="/rh/conges?onglet=planning" />
      </div>

      <div className="grid grid-2">
        <Card title="Évolution de l’effectif — 12 mois">
          <SmoothAreaChart data={d.months} xKey="month" valueKey="effectif" label="Effectif en fin de mois" format={count} ariaLabel="Effectif en fin de mois" />
        </Card>
        <Card title="Entrées et sorties">
          <GroupedBars data={d.months} labelOf={(m, long) => (long ? monthLabel(m.month) : short(m))} format={count} ariaLabel="Entrées et sorties par mois"
            series={[{ key: 'entrees', label: 'Entrées', color: '#1baf7a' }, { key: 'sorties', label: 'Sorties', color: '#eb6834' }]} />
        </Card>
      </div>

      <div className="grid grid-3" style={{ alignItems: 'start' }}>
        <Card title="Répartition par service">
          {d.headcount ? <Donut items={Object.entries(d.departments).map(([k, v]) => ({ label: label(meta?.departments, k), value: v }))} format={v => `${v} pers.`} centerLabel="Effectif" /> : <Empty>Aucun employé.</Empty>}
        </Card>
        <Card title="Types de contrat">
          {d.headcount ? <Donut items={Object.entries(d.contracts).map(([k, v]) => ({ label: label(meta?.contract_types, k), value: v }))} format={v => `${v} pers.`} centerLabel="Contrats" /> : <Empty>—</Empty>}
        </Card>
        <Card title="Jours d’absence par mois">
          <HighlightBars data={absences} labelOf={short} valueKey="days" format={v => `${Math.round(v)} j`} color="#eda100" />
        </Card>
      </div>

      <div className="grid grid-4">
        <Kpi icon={Receipt} label="Notes de frais à approuver" value={d.expenses_to_approve} to="/rh/frais" />
        <Kpi icon={Briefcase} label="Postes ouverts" value={d.open_jobs} foot={`${d.new_applicants} nouvelle(s) candidature(s)`} to="/rh/recrutement" />
        <Kpi icon={GraduationCap} label="Formations dans 30 jours" value={d.trainings_soon.length} to="/rh/competences" />
        <Kpi icon={Palmtree} label="Départs en congé (30 j)" value={d.upcoming.length} to="/rh/conges?onglet=planning" />
      </div>

      <div className="grid grid-3" style={{ alignItems: 'start' }}>
        <Card title="Absents aujourd’hui" bodyClass="">
          {!d.absent_today.length ? <div className="card-body"><Empty>Tout le monde est là.</Empty></div> : <ul className="list">{d.absent_today.map(l => <li key={l.id} className="list-row"><span><b>{l.employee_name}</b><div className="small muted">jusqu’au {date(l.end_date)}</div></span><Badge tone="warn">{l.label}</Badge></li>)}</ul>}
        </Card>
        <Card title="Échéances du personnel" bodyClass="">
          {!d.alerts.length ? <div className="card-body"><Empty>Aucune échéance dans les 60 jours.</Empty></div> : (
            <ul className="list">{d.alerts.slice(0, 10).map((a, i) => {
              const Icon = ALERT_ICONS[a.kind] || AlertTriangle;
              return <li key={i}><Link className="list-row" to={`/rh/personnel/${a.employee_id}`}><span className="row" style={{ gap: 10 }}><Icon className="ico" /><span><b>{a.employee_name}</b><div className="small muted">{a.label}</div></span></span><span className="small nowrap">{date(a.date)}</span></Link></li>;
            })}</ul>
          )}
        </Card>
        <Card title="Prochainement" bodyClass="">
          {!d.upcoming.length && !d.birthdays.length && !d.trainings_soon.length ? <div className="card-body"><Empty>Rien dans les 30 jours.</Empty></div> : (
            <ul className="list">
              {d.upcoming.slice(0, 5).map(l => <li key={`l${l.id}`} className="list-row"><span className="row" style={{ gap: 10 }}><Palmtree className="ico" /><span><b>{l.employee_name}</b><div className="small muted">{l.label} · {l.days} j</div></span></span><span className="small nowrap">{date(l.start_date)}</span></li>)}
              {d.trainings_soon.map(t => <li key={`t${t.id}`} className="list-row"><span className="row" style={{ gap: 10 }}><GraduationCap className="ico" /><b>{t.title}</b></span><span className="small nowrap">{date(t.start_date)}</span></li>)}
              {d.birthdays.map(b => <li key={`b${b.employee_id}`} className="list-row"><span className="row" style={{ gap: 10 }}><Cake className="ico" /><b>{b.employee_name}</b></span><span className="small nowrap">{date(b.date)}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
      <p className="small muted"><Link className="link" to="/rh/reglages">Réglages RH <ArrowRight className="ico" /></Link> : acquisition des congés, majorations, heures supplémentaires, jours fériés et catégories de frais — à faire valider par SIIPAF et le comptable.</p>
    </div>
  );
}
