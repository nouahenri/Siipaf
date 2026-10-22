import { Link, useOutletContext } from 'react-router-dom';
import { Users, CalendarDays, Mail, Newspaper, ArrowRight, Wallet, TrendingUp, TrendingDown, Minus, Hourglass, Landmark, Smartphone, Banknote, ScrollText } from 'lucide-react';
import { LineChart, BarList, useCountUp, monthLabel } from '../components/Charts';
import { SmoothAreaChart, GroupedBars, HighlightBars, Donut } from '../components/ChartsPlus';
import { useAuth, useResource } from '../lib/app-context';
import { Card, DistributionBar, Empty, Skeleton, Badge } from '../components/ui';
import { LOT_STATUSES, LEAD_STAGES, APPT_KINDS, APPT_STATUS, SOURCES, stageLabel } from '../lib/domain';
import { dateTime, relative, num, fcfa, date } from '../lib/format';

// Pastille de chaque moyen de paiement dans « Derniers versements »
const METHOD_STYLE = {
  virement: { icon: Landmark, bg: '#e8f0fb', fg: '#2a78d6' },
  mobile_money: { icon: Smartphone, bg: '#fdeee6', fg: '#c4501f' },
  especes: { icon: Banknote, bg: '#e6f6ef', fg: '#15845c' },
  cheque: { icon: ScrollText, bg: '#fdf4e0', fg: '#a16207' },
  autre: { icon: Wallet, bg: 'var(--bg)', fg: 'var(--ink-2)' },
};

// Montants compacts pour les axes : 12 500 000 → « 12,5 M »
const compact = v => (v >= 1e9 ? `${(v / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Md` : v >= 1e6 ? `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : v >= 1e3 ? `${Math.round(v / 1e3)} k` : String(v));
const money = (v, axis) => (axis ? compact(v) : fcfa(v));

/** `count` (nombre) défile jusqu'à sa valeur ; `format` le met en forme. */
/** Évolution en % par rapport à la période précédente (null si pas de base de comparaison). */
const trendOf = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);
const Trend = ({ value, label }) => {
  if (value == null) return null;
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const Icon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  return <span className={`trend ${dir}`} title={label}><Icon aria-hidden="true" />{value > 0 ? '+' : ''}{value.toLocaleString('fr-FR')} %<span className="sr-only"> {label}</span></span>;
};

const Kpi = ({ icon: Icon, label, value, count, format = num, foot, to, tint, trend, trendLabel }) => {
  const animated = useCountUp(count);
  if (count != null) value = format(Math.round(animated));
  const body = (
    <div className={`card kpi ${tint ? `tint-${tint}` : ''}`}>
      <span className="kpi-label"><Icon aria-hidden="true" />{label}</span>
      <span className="kpi-value">{value ?? <Skeleton h={30} w={60} />}</span>
      {(foot || trend != null) && <span className="kpi-foot row" style={{ gap: 8 }}><Trend value={trend} label={trendLabel} />{foot}</span>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
};

const lotItems = counts => LOT_STATUSES.map(s => ({ ...s, value: counts?.[s.id] || 0 }));

export default function Dashboard() {
  const { can, user } = useAuth();
  const { stats } = useOutletContext();
  const s = stats.data;
  const projects = useResource(can('projects:read') ? '/admin/projects' : null);
  const upcoming = useResource(can('appointments:read') ? `/admin/appointments?from=${new Date().toISOString().slice(0, 10)}&status=demande,confirme` : null);
  const leads = useResource(can('leads:read') ? '/admin/leads?type=prospects&limit=6' : null);
  const timeline = useResource('/admin/stats/timeline?months=12');
  const tl = timeline.data;

  const pipelineTotal = s ? Object.entries(s.leads).filter(([k]) => k !== 'perdu').reduce((a, [, v]) => a + v, 0) : null;

  return (
    <div className="stack">
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Bonjour {user.name.split(' ')[0]}</h2>
        <p className="muted">Voici l’activité commerciale et l’état des programmes.</p>
      </div>

      <div className="grid grid-4">
        {can('leads:read') && <Kpi icon={Users} label="Nouveaux prospects" count={s?.new_leads_30d} tint="blue" trend={s && trendOf(s.new_leads_30d, s.new_leads_prev_30d)} trendLabel="par rapport aux 30 jours précédents" foot={s && `30 jours · ${num(pipelineTotal)} en cours`} to="/prospects" />}
        {can('appointments:read') && <Kpi icon={CalendarDays} label="Rendez-vous à venir" count={s?.upcoming_appointments} tint="violet" foot="Demandés ou confirmés" to="/rendez-vous" />}
        {can('contacts:read') && <Kpi icon={Mail} label="Messages non traités" count={s?.new_messages} tint="amber" foot="Formulaire de contact" to="/messages" />}
        <Kpi icon={Newspaper} label="Abonnés newsletter" count={s?.newsletter_active} tint="green" foot="Inscriptions actives" to={can('newsletter:read') ? '/newsletter' : undefined} />
      </div>

      {tl?.finance && (
        <div className="grid grid-3">
          <Kpi icon={TrendingUp} label="Chiffre d’affaires réservé" count={tl.finance.chiffre_affaires} format={fcfa} foot={`${num(tl.finance.dossiers_actifs)} dossiers d’acquisition actifs`} />
          <Kpi icon={Wallet} label="Encaissé" count={tl.finance.encaisse} format={fcfa} trend={trendOf(tl.series[tl.series.length - 1].encaissements, tl.series[tl.series.length - 2].encaissements)} trendLabel="encaissements du mois par rapport au mois précédent" foot={tl.finance.chiffre_affaires ? `${Math.round((tl.finance.encaisse / tl.finance.chiffre_affaires) * 100)} % du chiffre d’affaires` : '—'} />
          <Kpi icon={Hourglass} label="Reste à encaisser" count={tl.finance.reste} format={fcfa} foot="Sur les dossiers en cours" />
        </div>
      )}

      {tl && tl.finance && (
        <div className="grid wide-grid">
          <Card title="Encaissements mensuels" actions={<span className="small muted">12 derniers mois</span>}>
            <SmoothAreaChart data={tl.series} xKey="month" valueKey="encaissements" label="Encaissements" format={money} ariaLabel="Courbe des encaissements des 12 derniers mois" />
          </Card>
          <Card title="Encaissements par projet">
            <Donut items={tl.by_project.map(p => ({ label: p.name, value: p.total }))} format={money} centerLabel="encaissés" />
          </Card>
        </div>
      )}

      {tl && (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          {can('leads:read') && (
            <Card title="Activité des 7 derniers jours">
              <GroupedBars
                data={tl.week} format={v => num(v)}
                labelOf={(d, long) => new Date(d.day + 'T12:00:00').toLocaleDateString('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short' })}
                series={[
                  { key: 'leads', label: 'Nouveaux prospects', color: 'var(--series-1)' },
                  { key: 'rdv', label: 'Rendez-vous pris', color: 'var(--series-2)' },
                ]}
                ariaLabel="Nouveaux prospects et rendez-vous pris sur les 7 derniers jours"
              />
            </Card>
          )}
          {tl.finance && (
            <Card title="Encaissements récents" actions={<span className="small muted">6 derniers mois</span>}>
              <HighlightBars data={tl.series.slice(-6)} valueKey="encaissements" labelOf={d => monthLabel(d.month)} format={v => compact(v)} />
            </Card>
          )}
          {can('leads:read') && (
            <Card title="Prospects et réservations" actions={<span className="small muted">par mois</span>}>
              <LineChart
                data={tl.series} xKey="month" format={v => num(v)}
                series={[
                  { key: 'leads', label: 'Nouveaux prospects', color: 'var(--series-1)' },
                  ...(tl.finance ? [{ key: 'reservations', label: 'Réservations', color: 'var(--series-2)' }] : []),
                ]}
                ariaLabel="Nouveaux prospects et réservations par mois"
              />
            </Card>
          )}
          {tl.finance && (
            <Card title="Derniers versements" actions={can('lots:read') && <Link className="btn btn-sm btn-ghost" to="/lots">Lots <ArrowRight /></Link>}>
              {!tl.recent_payments.length ? <p className="muted">Aucun versement enregistré.</p> : tl.recent_payments.map(p => (
                <div key={p.id} className="pay-row">
                  <span className="pay-icon" style={{ background: METHOD_STYLE[p.method]?.bg, color: METHOD_STYLE[p.method]?.fg }} aria-hidden="true">{(() => { const I = METHOD_STYLE[p.method]?.icon || Wallet; return <I />; })()}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong>{p.buyer}</strong>
                    <div className="small muted">{p.project} · lot {p.lot} · {date(p.paid_at)}</div>
                  </div>
                  <strong className="tabular nowrap" style={{ color: 'var(--ok)' }}>+{fcfa(p.amount_fcfa)}</strong>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Disponibilité des lots" actions={can('lots:read') && <Link className="btn btn-sm btn-ghost" to="/lots">Voir les lots <ArrowRight /></Link>}>
          {s ? <DistributionBar items={lotItems(s.lots)} /> : <Skeleton h={14} />}
          {projects.data && (
            <div className="stack" style={{ gap: 14, marginTop: 24 }}>
              {projects.data.map(p => {
                const total = Object.values(p.lots).reduce((a, b) => a + b, 0);
                return (
                  <div key={p.id}>
                    <div className="row-between small" style={{ marginBottom: 6 }}>
                      <strong>{p.name}</strong>
                      <span className="muted tabular">{total ? `${p.lots.disponible || 0} disponibles / ${total}` : 'Plan non saisi'}</span>
                    </div>
                    {total > 0 && (
                      <div className="dist-bar" style={{ height: 8 }}>
                        {lotItems(p.lots).filter(i => i.value).map(i => (
                          <div key={i.id} style={{ flex: i.value, background: i.color }} title={`${i.label} : ${i.value}`} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {can('leads:read') && (
          <Card title="Circuit de vente" actions={<Link className="btn btn-sm btn-ghost" to="/prospects?vue=pipeline">Pipeline <ArrowRight /></Link>}>
            {!s ? <Skeleton h={120} /> : (
              <div className="stack" style={{ gap: 10 }}>
                {LEAD_STAGES.filter(st => st.id !== 'perdu').map(st => {
                  const v = s.leads[st.id] || 0;
                  const max = Math.max(1, ...Object.values(s.leads));
                  return (
                    <div key={st.id} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 40px', gap: 12, alignItems: 'center' }}>
                      <span className="small muted">{st.label}</span>
                      <div style={{ height: 10, background: 'var(--bg)', borderRadius: 4 }}>
                        <div style={{ width: `${(v / max) * 100}%`, height: '100%', background: 'var(--ink-2)', borderRadius: 4, minWidth: v ? 4 : 0 }} title={`${st.label} : ${v}`} />
                      </div>
                      <span className="small tabular right">{v}</span>
                    </div>
                  );
                })}
                <p className="small muted">Perdus : {s.leads.perdu || 0}</p>
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {can('appointments:read') && (
          <Card title="Prochains rendez-vous" bodyClass="">
            {upcoming.loading ? <div className="card-body"><Skeleton h={60} /></div>
              : !upcoming.data?.length ? <Empty icon={CalendarDays}>Aucun rendez-vous prévu.</Empty>
              : (
                <table className="table"><tbody>
                  {upcoming.data.slice(0, 6).map(a => (
                    <tr key={a.id}>
                      <td className="nowrap"><strong>{dateTime(a.starts_at)}</strong><div className="small muted">{relative(a.starts_at)}</div></td>
                      <td>{a.lead_name}<div className="small muted">{APPT_KINDS[a.kind]}{a.project_name ? ` · ${a.project_name}` : ''}</div></td>
                      <td className="right"><Badge tone={APPT_STATUS[a.status].tone}>{APPT_STATUS[a.status].label}</Badge></td>
                    </tr>
                  ))}
                </tbody></table>
              )}
          </Card>
        )}
        {can('leads:read') && tl && (
          <Card title="Origine des prospects">
            <BarList items={Object.entries(tl.sources).map(([k, v]) => ({ label: SOURCES[k] || k, value: v })).sort((a, b) => b.value - a.value)} format={v => num(v)} />
          </Card>
        )}
        {can('leads:read') && (
          <Card title="Derniers prospects" bodyClass="">
            {leads.loading ? <div className="card-body"><Skeleton h={60} /></div>
              : !leads.data?.rows.length ? <Empty icon={Users}>Aucun prospect pour l’instant.</Empty>
              : (
                <table className="table"><tbody>
                  {leads.data.rows.map(l => (
                    <tr key={l.id}>
                      <td><strong>{l.name}</strong><div className="small muted">{l.phone || l.email}</div></td>
                      <td className="small">{l.project_name || '—'}{l.lot_code ? ` · lot ${l.lot_code}` : ''}<div className="muted">{SOURCES[l.source] || l.source}</div></td>
                      <td className="right"><Badge>{stageLabel(l.stage)}</Badge></td>
                    </tr>
                  ))}
                </tbody></table>
              )}
          </Card>
        )}
      </div>
    </div>
  );
}
