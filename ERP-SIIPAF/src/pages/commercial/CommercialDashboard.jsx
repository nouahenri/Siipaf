import { Link } from 'react-router-dom';
import { Banknote, FileSignature, Gauge, Percent, Wallet, AlarmClock, ListTodo, ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Card, Skeleton, Empty } from '@admin/components/ui';
import { LineChart, BarList, useCountUp } from '@admin/components/Charts';
import { fcfa, num } from '@admin/lib/format';
import { useCommercialMeta, compact, STAGE_COLORS, monthName } from '../../lib/commercial';

export const trendOf = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);
const Trend = ({ value }) => {
  if (value == null) return null;
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return <span className={`trend ${value > 0 ? 'up' : value < 0 ? 'down' : 'flat'}`} title="Par rapport au mois précédent"><Icon aria-hidden="true" />{value > 0 ? '+' : ''}{value.toLocaleString('fr-FR')} %</span>;
};

export function Kpi({ icon: Icon, label, count, format = num, foot, trend, to, tint }) {
  const v = useCountUp(count ?? 0);
  const body = (
    <div className={`card kpi ${tint ? `tint-${tint}` : ''}`}>
      <span className="kpi-label"><Icon aria-hidden="true" />{label}</span>
      <span className="kpi-value">{count == null ? '—' : format(Math.round(v))}</span>
      <span className="kpi-foot row" style={{ gap: 8 }}><Trend value={trend} />{foot}</span>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function CommercialDashboard() {
  const meta = useCommercialMeta();
  const d = useResource('/admin/erp/commercial/dashboard').data;
  if (!d) return <div className="grid grid-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</div>;
  const { current: c, previous: p } = d;
  const team = d.team.filter(r => r.target.ca_fcfa || r.done.ca_fcfa || r.done.ventes);

  return (
    <div className="stack">
      <p className="muted">Activité de {monthName(d.month)}.</p>
      <div className="grid grid-4">
        <Kpi icon={Banknote} label="Chiffre d’affaires signé" count={c.ca_fcfa} format={v => `${compact(v)} FCFA`} trend={trendOf(c.ca_fcfa, p.ca_fcfa)} foot="dossiers ouverts ce mois" tint="blue" to="/commercial/ventes" />
        <Kpi icon={FileSignature} label="Ventes du mois" count={c.ventes} trend={trendOf(c.ventes, p.ventes)} foot={`${c.nouveaux_prospects} nouveaux prospects`} tint="violet" />
        <Kpi icon={Gauge} label="Pipeline pondéré" count={d.pipeline_weighted_fcfa} format={v => `${compact(v)} FCFA`} foot={`${d.open_leads} opportunités · ${compact(d.pipeline_value_fcfa)} brut`} tint="green" to="/commercial/pipeline" />
        <Kpi icon={Wallet} label="Encaissements du mois" count={c.encaissements_fcfa} format={v => `${compact(v)} FCFA`} trend={trendOf(c.encaissements_fcfa, p.encaissements_fcfa)} foot="tous modes de paiement" tint="amber" />
      </div>
      <div className="grid grid-3">
        <Kpi icon={Percent} label="Taux de conversion" count={c.conversion_pct ?? null} format={v => `${v} %`} foot="prospects du mois passés au paiement ou au-delà" />
        <Kpi icon={ListTodo} label="Activités en retard" count={d.late_activities} foot="relances et rappels à faire" to="/commercial/activites" tint={d.late_activities ? 'amber' : undefined} />
        <Kpi icon={AlarmClock} label="Appels de fonds en retard" count={d.late_fund_calls.n} foot={d.late_fund_calls.n ? `${fcfa(d.late_fund_calls.amount_fcfa)} à recouvrer` : 'aucun impayé VEFA'} to="/commercial/vefa?filter=retard" tint={d.late_fund_calls.n ? 'amber' : undefined} />
      </div>

      <div className="grid grid-2">
        <Card title="Ventes signées et encaissements — 12 mois">
          <LineChart data={d.series} xKey="month" area format={(v, axis) => (axis ? compact(v) : fcfa(v))} ariaLabel="Chiffre d’affaires signé et encaissements par mois"
            series={[{ key: 'ca', label: 'CA signé', color: 'var(--series-1)' }, { key: 'encaissements', label: 'Encaissements', color: '#1baf7a' }]} />
        </Card>
        <Card title="Pipeline par étape" actions={<Link className="btn btn-sm btn-ghost" to="/commercial/pipeline">Ouvrir <ArrowRight /></Link>}>
          <div className="stack" style={{ gap: 10 }}>
            {d.stages.map(s => {
              const max = Math.max(1, ...d.stages.map(x => x.value_fcfa));
              return (
                <div key={s.stage} className="bar-row" title={`${s.n} opportunité(s) · ${fcfa(s.value_fcfa)} · pondéré ${fcfa(s.weighted_fcfa)}`}>
                  <span className="small">{s.label} <span className="muted">({s.n})</span></span>
                  <div className="bar-track"><div style={{ width: `${(s.value_fcfa / max) * 100}%`, background: STAGE_COLORS[s.stage] }} /></div>
                  <span className="small tabular right"><strong>{compact(s.value_fcfa)}</strong></span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title={`Équipe commerciale — objectifs de ${monthName(d.month)}`} bodyClass="" actions={<Link className="btn btn-sm btn-ghost" to="/commercial/objectifs">Objectifs <ArrowRight /></Link>}>
          {!team.length ? <div className="card-body"><Empty icon={Gauge}>Aucun objectif fixé ce mois-ci.</Empty></div> : (
            <div className="table-wrap table-scroll"><table className="table">
              <thead><tr><th>Commercial</th><th className="right">CA signé</th><th>Atteinte</th><th className="right">Ventes</th></tr></thead>
              <tbody>
                {team.map(r => (
                  <tr key={r.user_id}>
                    <td>{r.name}</td>
                    <td className="right tabular">{compact(r.done.ca_fcfa)}<div className="muted small">obj. {r.target.ca_fcfa ? compact(r.target.ca_fcfa) : '—'}</div></td>
                    <td style={{ minWidth: 120 }}>{r.pct.ca_fcfa == null ? <span className="muted small">—</span> : <Progress value={r.pct.ca_fcfa} />}</td>
                    <td className="right tabular">{r.done.ventes}{r.target.ventes ? <span className="muted"> / {r.target.ventes}</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
        <Card title="Motifs de perte">
          <BarList items={Object.entries(d.lost_reasons).map(([k, v]) => ({ label: meta?.lost_reasons[k] || k, value: v })).sort((a, b) => b.value - a.value)} color="#9f1239" />
        </Card>
      </div>
    </div>
  );
}

export function Progress({ value }) {
  const tone = value >= 100 ? 'var(--ok)' : value >= 60 ? 'var(--series-1)' : 'var(--warn)';
  return (
    <div className="pct-bar" title={`${value} %`}>
      <div className="pct-track"><div style={{ '--p': Math.min(100, value) / 100, background: tone }} /></div>
      <span className="small tabular">{value.toLocaleString('fr-FR')} %</span>
    </div>
  );
}
