/**
 * Administration générale › vue Direction : synthèse de tous les services (commercial, chantiers, finance, RH, SAV),
 * avancement des chantiers par programme, îlot et dossier. Lecture seule : chaque chiffre renvoie à son module.
 */
import { Banknote, Wallet, Landmark, HardHat, Gauge, Target, Users, UserMinus, LifeBuoy, AlarmClock, Star, Scale, ReceiptText, Briefcase } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useResource } from '@admin/lib/app-context';
import { Card, Skeleton, Empty, ErrorBox, Advance, Badge } from '@admin/components/ui';
import { LineChart } from '@admin/components/Charts';
import { fcfa, num, date, dateTime } from '@admin/lib/format';
import { compact, monthName } from '../../lib/commercial';
import { Kpi, Progress, trendOf } from '../commercial/CommercialDashboard';

const money = v => `${compact(v)} FCFA`;
const pct = (done, target) => (target ? Math.round((done / target) * 1000) / 10 : null);

function Section({ icon: Icon, title, to, children }) {
  return (
    <section className="stack" style={{ gap: 12 }}>
      <h2 className="row" style={{ gap: 8, fontSize: 16, fontWeight: 600 }}><Icon size={18} aria-hidden="true" />{title}{to && <Link className="small muted" style={{ fontWeight: 400, marginLeft: 'auto' }} to={to}>Ouvrir le module</Link>}</h2>
      {children}
    </section>
  );
}

export default function Direction() {
  const res = useResource('/admin/erp/direction/overview');
  const d = res.data;
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d) return <div className="grid grid-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</div>;
  const { commercial: c, chantiers: ch, finance: f, rh, sav } = d;
  const lastPay = rh.payroll[rh.payroll.length - 1];
  const withSales = ch.projects.filter(p => p.dossiers || p.lots);

  return (
    <div className="stack">
      <p className="muted">Situation au {dateTime(d.at)} — chiffres calculés par chaque module, en temps réel.</p>
      <div className="grid grid-4">
        <Kpi icon={Banknote} label="CA signé depuis janvier" count={c.ytd.ca_fcfa} format={money} foot={`${num(c.ytd.ventes)} ventes`} tint="blue" />
        <Kpi icon={Wallet} label="Encaissé depuis janvier" count={c.ytd.encaissements_fcfa} format={money} foot="versements des clients" tint="green" />
        <Kpi icon={Landmark} label="Trésorerie" count={f.fiscal_year ? f.treasury_total : null} format={money} foot={f.fiscal_year ? `exercice ${f.fiscal_year.label}` : 'aucun exercice comptable ouvert'} tint="violet" />
        <Kpi icon={HardHat} label="Avancement moyen des dossiers" count={ch.dossiers_progress_pct} format={v => `${v} %`} foot="dossiers en cours, d’après le journal de chantier" tint="amber" />
      </div>

      <Section icon={Briefcase} title={`Commercial — ${monthName(c.month)}`} to="/commercial">
        <div className="grid grid-4">
          <Kpi icon={Banknote} label="CA signé du mois" count={c.current.ca_fcfa} format={money} trend={trendOf(c.current.ca_fcfa, c.previous.ca_fcfa)} foot={`${num(c.current.ventes)} ventes`} />
          <Kpi icon={Wallet} label="Encaissements du mois" count={c.current.encaissements_fcfa} format={money} trend={trendOf(c.current.encaissements_fcfa, c.previous.encaissements_fcfa)} />
          <Kpi icon={Gauge} label="Pipeline pondéré" count={c.pipeline_weighted_fcfa} format={money} foot={`${num(c.open_leads)} opportunités · conversion ${c.current.conversion_pct == null ? '—' : c.current.conversion_pct.toLocaleString('fr-FR')} %`} />
          <Kpi icon={Target} label="Objectif de CA du mois" count={pct(c.targets.done.ca_fcfa, c.targets.target.ca_fcfa)} format={v => `${v} %`} foot={c.targets.target.ca_fcfa ? `${money(c.targets.done.ca_fcfa)} / ${money(c.targets.target.ca_fcfa)}` : 'aucun objectif fixé'} />
        </div>
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <Card title="Chiffre d’affaires et encaissements" actions={<span className="small muted">12 mois</span>}>
            <LineChart data={c.series} xKey="month" area format={(v, axis) => (axis ? compact(v) : fcfa(v))} ariaLabel="Chiffre d’affaires signé et encaissements par mois"
              series={[{ key: 'ca', label: 'CA signé', color: 'var(--series-1)' }, { key: 'encaissements', label: 'Encaissements', color: 'var(--series-3)' }]} />
          </Card>
          <Card title="Commerciaux" actions={<span className="small muted">mois en cours · portefeuille depuis janvier</span>} bodyClass="">
            {!c.sellers.length ? <Empty icon={Users}>Aucun commercial.</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Commercial</th><th className="right">CA signé</th><th className="right">Ventes</th><th>Objectif CA</th></tr></thead>
                <tbody>{c.sellers.map(s => (
                  <tr key={s.user_id}>
                    <td><strong>{s.name}</strong></td>
                    <td className="right tabular">{compact(s.done.ca_fcfa)}</td>
                    <td className="right tabular">{num(s.done.ventes)}</td>
                    <td>{s.pct.ca_fcfa != null ? <Progress value={s.pct.ca_fcfa} /> : <span className="small muted">—</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <p className="small muted card-body" style={{ paddingTop: 10 }}>
              Depuis janvier : {num(c.portfolio.total.prospects.net)} prospects nets ({num(c.portfolio.total.prospects.brut)} attribués, {num(c.portfolio.total.prospects.pertes)} perdus) · {num(c.portfolio.total.clients.net)} clients nets{c.portfolio.unassigned ? ` · ${num(c.portfolio.unassigned)} prospect(s) à répartir` : ''}.
            </p>
          </Card>
        </div>
      </Section>

      <Section icon={HardHat} title="Programmes et chantiers" to="/commercial/parc">
        <div className="grid grid-4">
          <Kpi icon={HardHat} label="Programmes sans point récent" count={ch.stale} foot="avec des dossiers, sans point de chantier publié depuis 60 jours" tint={ch.stale ? 'amber' : undefined} />
          <Kpi icon={ReceiptText} label="Appels de fonds VEFA émis" count={ch.vefa.called_fcfa} format={money} foot={`${num(ch.vefa.calls)} appel(s) · ${num(ch.vefa.upcoming)} à venir`} />
          <Kpi icon={Wallet} label="Versé sur les dossiers VEFA" count={ch.vefa.paid_fcfa} format={money} />
          <Kpi icon={AlarmClock} label="Échéances en retard" count={f.overdue_fcfa} format={money} foot={`${num(f.late_clients)} client(s) · ${num(f.overdue_installments)} échéance(s)`} tint={f.overdue_fcfa ? 'amber' : undefined} />
        </div>
        <Card bodyClass="">
          {!withSales.length ? <Empty icon={HardHat}>Aucun programme.</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Programme</th><th className="right">Lots</th><th className="right">Dossiers</th><th className="right">CA signé</th><th className="right">Encaissé</th><th className="right">Reste à encaisser</th><th>Avancement du programme</th><th>Moyenne des dossiers</th><th>Îlots</th><th>Dernier point</th></tr></thead>
              <tbody>{withSales.map(p => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong>{p.stage_label && <div className="small muted">{p.stage_label}</div>}</td>
                  <td className="right tabular">{num(p.lots)}<div className="small muted nowrap">dont {num((p.by_status.vendu || 0) + (p.by_status.reserve || 0))} vendus</div></td>
                  <td className="right tabular">{num(p.dossiers)}{p.vefa ? <div className="small muted">{num(p.vefa)} VEFA</div> : null}</td>
                  <td className="right tabular">{compact(p.ca_fcfa)}</td>
                  <td className="right tabular">{compact(p.encaisse_fcfa)}</td>
                  <td className="right tabular">{compact(p.reste_fcfa)}</td>
                  <td>{p.progress_pct == null ? <span className="small muted">aucun point</span> : <Advance value={p.progress_pct} />}</td>
                  <td>{p.dossiers_progress_pct == null ? <span className="small muted">—</span> : <Advance value={p.dossiers_progress_pct} />}</td>
                  <td className="small">{p.ilots.length ? p.ilots.map(i => `${i.ilot} : ${i.progress_pct} %`).join(' · ') : '—'}</td>
                  <td className="small nowrap">{p.last_update_at ? date(p.last_update_at) : '—'}{p.stale && p.dossiers ? <> <Badge tone="warn">À relancer</Badge></> : null}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <p className="small muted">Avancement : dernier point publié aux clients pour le programme, l’îlot ou le lot (journal de chantier du dashboard). Le détail par client se trouve dans Service commercial › Dossiers de vente.</p>
      </Section>

      <Section icon={Scale} title="Finance" to="/compta">
        {!f.fiscal_year && <div className="alert alert-info">Aucun exercice comptable ouvert : trésorerie, résultat et soldes s’afficheront quand le comptable aura créé l’exercice (Comptabilité › Paramètres). Les échéances en retard, elles, sont déjà suivies.</div>}
        <div className="grid grid-4">
          <Kpi icon={Landmark} label="Résultat provisoire" count={f.fiscal_year ? f.result : null} format={money} foot="brouillons compris" />
          <Kpi icon={Wallet} label="Créances clients" count={f.fiscal_year ? f.receivables : null} format={money} foot={f.fiscal_year ? `${money(f.advances)} d’avances reçues` : null} />
          <Kpi icon={ReceiptText} label="Dettes fournisseurs" count={f.fiscal_year ? f.payables : null} format={money} />
          <Kpi icon={AlarmClock} label="Impayés clients" count={f.overdue_fcfa} format={money} foot={`${num(f.late_clients)} client(s) en retard`} tint={f.overdue_fcfa ? 'amber' : undefined} />
        </div>
        {f.fiscal_year && f.margins?.length > 0 && (
          <Card title="Marge par programme" bodyClass="">
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Programme</th><th className="right">Produits</th><th className="right">Charges</th><th className="right">Marge</th></tr></thead>
              <tbody>{f.margins.map(m => (
                <tr key={m.project_id ?? 'aucun'}><td>{m.name}</td><td className="right tabular">{compact(m.produits)}</td><td className="right tabular">{compact(m.charges)}</td><td className="right tabular"><strong>{compact(m.marge)}</strong>{m.taux != null && <span className="muted"> · {m.taux} %</span>}</td></tr>
              ))}</tbody>
            </table></div>
          </Card>
        )}
      </Section>

      <Section icon={Users} title="Ressources humaines" to="/rh">
        <div className="grid grid-4">
          <Kpi icon={Users} label="Effectif" count={rh.headcount} foot={`${num(rh.present_now)} pointé(s) en ce moment`} />
          <Kpi icon={UserMinus} label="Absentéisme du mois" count={rh.absenteeism_pct == null ? null : rh.absenteeism_pct * 10} format={v => `${(v / 10).toLocaleString('fr-FR')} %`} foot={`${num(rh.pending_leaves)} congé(s) à valider`} />
          <Kpi icon={Banknote} label="Masse salariale" count={lastPay?.employer_cost ?? null} format={money} foot={lastPay ? `coût employeur · ${monthName(lastPay.month)}` : 'aucune paie validée'} />
          <Kpi icon={Target} label="Performance moyenne" count={rh.performance.overall} format={v => `${v} %`} foot="objectifs pondérés de l’année" />
        </div>
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <Card title="Performance par service" bodyClass="">
            {!rh.performance.departments.length ? <Empty icon={Target}>Aucun employé.</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Service</th><th className="right">Effectif</th><th>Score</th><th className="right">Présence</th></tr></thead>
                <tbody>{rh.performance.departments.map(s => (
                  <tr key={s.key}><td>{s.label}</td><td className="right tabular">{num(s.headcount)}</td><td>{s.score == null ? <span className="small muted">pas d’objectif</span> : <Progress value={s.score} />}</td><td className="right tabular">{s.presence == null ? '—' : `${s.presence} %`}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
          <Card title="Masse salariale" actions={<span className="small muted">coût employeur, 12 mois</span>}>
            {rh.payroll.length ? (
              <LineChart data={rh.payroll} xKey="month" area format={(v, axis) => (axis ? compact(v) : fcfa(v))} ariaLabel="Masse salariale par mois"
                series={[{ key: 'employer_cost', label: 'Coût employeur', color: 'var(--series-2)' }, { key: 'gross', label: 'Salaires bruts', color: 'var(--series-1)' }]} />
            ) : <Empty icon={Banknote}>Aucune paie validée.</Empty>}
          </Card>
        </div>
      </Section>

      <Section icon={LifeBuoy} title="Client & SAV" to="/sav">
        <div className="grid grid-4">
          <Kpi icon={LifeBuoy} label="Réclamations ouvertes" count={sav.open} foot={`${num(sav.urgent)} urgente(s) ou haute(s)`} />
          <Kpi icon={AlarmClock} label="En retard" count={sav.overdue} tint={sav.overdue ? 'amber' : undefined} foot="échéance de traitement dépassée" />
          <Kpi icon={Gauge} label="Traitées dans le délai" count={sav.on_time_rate} format={v => `${v} %`} foot={sav.avg_resolution_hours != null ? `délai moyen ${sav.avg_resolution_hours} h` : null} />
          <Kpi icon={Star} label="Satisfaction" count={sav.satisfaction_avg == null ? null : sav.satisfaction_avg * 10} format={v => `${(v / 10).toLocaleString('fr-FR')} / 5`} foot={`${num(sav.satisfaction_count)} avis`} />
        </div>
      </Section>
    </div>
  );
}
