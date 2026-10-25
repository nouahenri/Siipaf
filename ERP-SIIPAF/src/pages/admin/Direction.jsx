/**
 * Administration générale › vue Direction : synthèse de tous les services (commercial, chantiers, finance, RH, SAV,
 * courrier, contrats, parc, documents et demandes internes) et liste des délais dépassés à traiter en priorité ;
 * avancement des chantiers par programme, îlot et dossier. Lecture seule : chaque chiffre renvoie à son module.
 */
import {
  Banknote, Wallet, Landmark, HardHat, Gauge, Target, Users, UserMinus, LifeBuoy, AlarmClock, Star, Scale, ReceiptText, Briefcase,
  Building, Mail, FileClock, Truck, Inbox, FileText, ListChecks, Stamp, ShieldHalf, Flag, Handshake, CalendarClock,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useResource } from '@admin/lib/app-context';
import { Card, Skeleton, Empty, ErrorBox, Advance, Badge } from '@admin/components/ui';
import { LineChart } from '@admin/components/Charts';
import { fcfa, num, date, dateTime } from '@admin/lib/format';
import { compact, monthName } from '../../lib/commercial';
import { Kpi, Progress, trendOf } from '../commercial/CommercialDashboard';

const money = v => `${compact(v)} FCFA`;
const pct = (done, target) => (target ? Math.round((done / target) * 1000) / 10 : null);
// Retards de l'Administration générale : icône et nom de la partie
const ATTENTION = {
  courrier: { icon: Mail, label: 'Courrier' }, contrats: { icon: FileClock, label: 'Contrats' },
  parc: { icon: Truck, label: 'Parc' }, documents: { icon: FileText, label: 'Documents internes' },
  litiges: { icon: Scale, label: 'Litiges' }, cautions: { icon: ShieldHalf, label: 'Cautions' }, impayes: { icon: AlarmClock, label: 'Impayés' },
  chantiers: { icon: HardHat, label: 'Chantiers' },
};

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
  const { commercial: c, chantiers: ch, finance: f, rh, sav, administration: a, juridique: j } = d;
  const lastPay = rh.payroll[rh.payroll.length - 1];
  const withSales = ch.projects.filter(p => p.dossiers || p.lots);
  const w = ch.worksites;

  return (
    <div className="stack">
      <p className="muted">Situation au {dateTime(d.at)} — chiffres calculés par chaque module, en temps réel.</p>
      <div className="grid grid-4">
        <Kpi icon={Banknote} label="CA signé depuis janvier" count={c.ytd.ca_fcfa} format={money} foot={`${num(c.ytd.ventes)} ventes`} tint="blue" />
        <Kpi icon={Wallet} label="Encaissé depuis janvier" count={c.ytd.encaissements_fcfa} format={money} foot="versements des clients" tint="green" />
        <Kpi icon={Landmark} label="Trésorerie" count={f.fiscal_year ? f.treasury_total : null} format={money} foot={f.fiscal_year ? `exercice ${f.fiscal_year.label}` : 'aucun exercice comptable ouvert'} tint="violet" />
        <Kpi icon={HardHat} label="Avancement moyen des dossiers" count={ch.dossiers_progress_pct} format={v => `${v} %`} foot="dossiers en cours, d’après le journal de chantier" tint="amber" />
      </div>

      {a.attention.length > 0 && (
        <Card title="À traiter en priorité" actions={<span className="small muted">{num(a.attention_total)} point(s) : délais dépassés et décisions attendues</span>} bodyClass="">
          <ul className="list">
            {a.attention.map(x => {
              const M = ATTENTION[x.module];
              return (
                <li key={`${x.module}-${x.link}-${x.label}`}>
                  <Link to={x.link} className="list-row">
                    <span className="row" style={{ gap: 10, minWidth: 0, flex: 1, flexWrap: 'nowrap' }}>
                      <M.icon size={16} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--ink-3)' }} />
                      <span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{x.label}</strong>{x.detail && <span className="small muted ellipsis">{M.label} · {x.detail}</span>}</span>
                    </span>
                    <span className="small nowrap" style={{ color: 'var(--danger)' }}>{x.date ? `depuis le ${date(x.date)}` : 'à faire'}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

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
              <div className="table-wrap table-scroll"><table className="table table-compact">
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
            <div className="table-wrap table-scroll"><table className="table table-compact">
              <thead><tr><th>Programme</th><th className="right">Lots · dossiers</th><th className="right">CA signé</th><th>Avancement</th><th>Îlots · dernier point</th></tr></thead>
              <tbody>{withSales.map(p => (
                <tr key={p.id}>
                  <td style={{ minWidth: 150 }}><strong>{p.name}</strong>{p.stage_label && <div className="small muted">{p.stage_label}</div>}</td>
                  <td className="right tabular nowrap">
                    <div>{num(p.lots)} lots <span className="small muted">· {num((p.by_status.vendu || 0) + (p.by_status.reserve || 0))} vendus</span></div>
                    <div className="small muted">{num(p.dossiers)} dossier(s){p.vefa ? ` · ${num(p.vefa)} VEFA` : ''}</div>
                  </td>
                  <td className="right tabular nowrap">
                    <div><strong>{compact(p.ca_fcfa)}</strong></div>
                    <div className="small muted">encaissé {compact(p.encaisse_fcfa)}</div>
                    <div className="small muted">reste {compact(p.reste_fcfa)}</div>
                  </td>
                  <td>
                    <div className="cell-stack">
                      {p.progress_pct == null ? <span className="small muted">aucun point publié</span> : <Advance value={p.progress_pct} />}
                      <span className="small muted">{p.dossiers_progress_pct == null ? 'dossiers : —' : `dossiers : ${p.dossiers_progress_pct} % en moyenne`}</span>
                    </div>
                  </td>
                  <td className="small" style={{ minWidth: 120, maxWidth: 200 }}>
                    <div>{p.ilots.length ? p.ilots.map(i => `${i.ilot} : ${i.progress_pct} %`).join(' · ') : '—'}</div>
                    <div className="muted nowrap">{p.last_update_at ? `point du ${date(p.last_update_at)}` : 'aucun point'}{p.stale && p.dossiers ? <> <Badge tone="warn">À relancer</Badge></> : null}</div>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <p className="small muted">Avancement : dernier point publié aux clients pour le programme, l’îlot ou le lot (journal de chantier du dashboard). Le détail par client se trouve dans Service commercial › Dossiers de vente.</p>

        <h3 className="row" style={{ gap: 8, fontSize: 14, fontWeight: 600, marginTop: 4 }}>Chantiers en cours<Link className="small muted" style={{ fontWeight: 400, marginLeft: 'auto' }} to="/chantiers">Ouvrir ERP › Chantiers</Link></h3>
        <div className="grid grid-4">
          <Kpi to="/chantiers" icon={HardHat} label="Chantiers ouverts" count={w.open} foot={w.progress_pct == null ? 'aucun chantier ouvert' : `avancement moyen ${w.progress_pct} %`} />
          <Kpi to="/chantiers" icon={CalendarClock} label="Phases en retard" count={w.late_phases} tint={w.late_phases ? 'amber' : undefined} foot={`sur ${num(w.late_worksites)} chantier(s)`} />
          <Kpi to="/chantiers" icon={Wallet} label="Budget consommé" count={w.budget_fcfa ? Math.round((w.spent_fcfa / w.budget_fcfa) * 100) : null} format={v => `${v} %`} tint={w.over_budget ? 'amber' : undefined}
            foot={w.budget_fcfa ? `${money(w.spent_fcfa)} / ${money(w.budget_fcfa)} · ${num(w.over_budget)} dépassé(s)` : 'aucun budget saisi'} />
          <Kpi to="/chantiers" icon={Flag} label="Décisions de la Direction" count={w.to_declare + w.situations_to_validate} tint={w.to_declare + w.situations_to_validate ? 'amber' : undefined}
            foot={`${num(w.to_declare)} étape(s) à déclarer · ${num(w.situations_to_validate)} situation(s) à valider · ${num(w.late_deliveries)} livraison(s) en retard · ${num(w.declared_recent)} étape(s) déclarée(s) en ${w.decided_days} j (${num(w.calls_recent)} appel(s) de fonds)`} />
        </div>
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <Card title="Étapes de chantier" actions={<span className="small muted">la déclaration émet les appels de fonds VEFA</span>} bodyClass="">
            <div className="notif-section">À déclarer ({num(w.to_declare)})</div>
            {!w.declarations.length ? <p className="small muted card-body" style={{ margin: 0, paddingTop: 4 }}>Aucune étape signalée en attente.</p> : (
              <ul className="list">{w.declarations.map(x => (
                <li key={x.id}><Link to={x.worksite_id ? `/chantiers/${x.worksite_id}?onglet=etapes` : '/commercial/vefa'} className="list-row">
                  <span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{x.stage_label}</strong><span className="small muted ellipsis">{x.scope_label} · {x.project_name}{x.reported_by_name ? ` · signalée par ${x.reported_by_name}` : ''}</span></span>
                  <span className="small nowrap" style={{ color: 'var(--warn, #b45309)' }}>{x.reached_on ? `atteinte le ${date(x.reached_on)}` : 'à déclarer'}</span>
                </Link></li>
              ))}</ul>
            )}
            <div className="notif-section">Décidées depuis {num(w.decided_days)} jours ({num(w.decided.length)})</div>
            {!w.decided.length ? <p className="small muted card-body" style={{ margin: 0, paddingTop: 4 }}>Aucune étape déclarée ou refusée sur la période.</p> : (
              <ul className="list">{w.decided.map(x => (
                <li key={x.id}><Link to={x.worksite_id ? `/chantiers/${x.worksite_id}?onglet=etapes` : '/commercial/vefa'} className="list-row">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <strong className="ellipsis">{x.stage_label} {x.status === 'declaree' ? <Badge tone="ok">Déclarée</Badge> : <Badge tone="warn">Refusée</Badge>}</strong>
                    <span className="small muted ellipsis">{x.scope_label} · {x.project_name}{x.declared_by_name ? ` · par ${x.declared_by_name}` : ''}{x.status === 'declaree' ? ` · ${num(x.calls_count)} appel(s) de fonds${x.calls_amount ? ` (${money(x.calls_amount)})` : ''}` : x.refusal_reason ? ` · ${x.refusal_reason}` : ''}</span>
                  </span>
                  <span className="small nowrap muted">le {date(x.declared_at)}</span>
                </Link></li>
              ))}</ul>
            )}
          </Card>
          <Card title="Situations de sous-traitants à valider" bodyClass="">
            {!w.situations.length ? <Empty icon={Handshake}>Aucune situation en attente de validation.</Empty> : (
              <ul className="list">{w.situations.map(x => (
                <li key={x.id}><Link to={`/chantiers/${x.worksite_id}?onglet=sous-traitants`} className="list-row">
                  <span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{x.contract_reference} · situation n° {x.number}</strong><span className="small muted ellipsis">{x.supplier_name || x.contract_title} · {x.worksite_reference}</span></span>
                  <span className="small nowrap tabular">{compact(x.amount_ttc)} TTC</span>
                </Link></li>
              ))}</ul>
            )}
          </Card>
        </div>
        {w.worksites.length > 0 && (
          <Card bodyClass="">
            <div className="table-wrap table-scroll"><table className="table table-compact">
              <thead><tr><th>Chantier</th><th>Programme</th><th>Conducteur</th><th>Statut</th><th>Avancement</th><th className="right">Phases en retard</th><th className="right">Budget</th><th className="right">Consommé</th></tr></thead>
              <tbody>{w.worksites.map(x => (
                <tr key={x.id}>
                  <td><Link to={`/chantiers/${x.id}`}><strong>{x.reference}</strong></Link><div className="small muted">{x.name}</div></td>
                  <td>{x.project_name}</td>
                  <td>{x.manager_name || <span className="muted">—</span>}</td>
                  <td>{x.status_label}</td>
                  <td><Advance value={x.progress_pct} /></td>
                  <td className="right tabular">{x.late_phases ? <Badge tone="warn">{num(x.late_phases)}{x.late_days ? ` · ${num(x.late_days)} j` : ''}</Badge> : '0'}</td>
                  <td className="right tabular">{x.budget_fcfa ? compact(x.budget_fcfa) : '—'}</td>
                  <td className="right tabular">{x.consumed_pct == null ? '—' : <span style={x.consumed_pct > 100 ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{x.consumed_pct} %</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>
        )}
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
            <div className="table-wrap table-scroll"><table className="table table-compact">
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
              <div className="table-wrap table-scroll"><table className="table table-compact">
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

      <Section icon={Building} title="Administration générale">
        <div className="grid grid-4">
          <Kpi to="/administration/courrier" icon={Mail} label="Courrier à affecter" count={a.courrier.to_assign} tint={a.courrier.to_assign ? 'amber' : undefined}
            foot={`${num(a.courrier.open)} en traitement · ${num(a.courrier.late)} en retard · ce mois ${num(a.courrier.month_in)} reçu(s), ${num(a.courrier.month_out)} envoyé(s)`} />
          <Kpi to="/administration/contrats" icon={FileClock} label="Échéances de contrats (30 j)" count={a.contrats.due_30} tint={a.contrats.late ? 'amber' : undefined}
            foot={`${num(a.contrats.late)} dépassée(s) · ${num(a.contrats.active)} contrat(s) actif(s) · ${num(a.contrats.payments_30)} paiement(s) à venir`} />
          <Kpi to="/administration/parc" icon={Truck} label="Parc : échéances et entretiens (30 j)" count={a.parc.due_30} tint={a.parc.late ? 'amber' : undefined}
            foot={`${num(a.parc.late)} dépassé(s) · ${num(a.parc.broken)} bien(s) en panne sur ${num(a.parc.assets)} · ${num(a.parc.requests)} demande(s) de véhicule`} />
          <Kpi to="/administration/demandes" icon={Inbox} label="Demandes internes en cours" count={a.demandes.open}
            foot={`${num(a.demandes.by_status.attente_dg)} à valider par la DG · ${num(a.demandes.by_status.attente_sg + a.demandes.by_status.en_cours)} aux services généraux · achats ${money(a.demandes.purchases_fcfa)}`} />
        </div>
        <div className="grid grid-4">
          <Kpi to="/administration/documents" icon={FileText} label="Lectures attendues" count={a.documents.to_read} tint={a.documents.late_docs ? 'amber' : undefined}
            foot={`${num(a.documents.published)} document(s) publié(s) · ${num(a.documents.late_docs)} en retard`} />
          <Kpi to="/administration/documents" icon={ListChecks} label="Actions de réunion ouvertes" count={a.documents.actions_open} tint={a.documents.actions_late ? 'amber' : undefined}
            foot={`${num(a.documents.actions_late)} en retard`} />
        </div>
      </Section>

      <Section icon={Scale} title="Juridique" to="/juridique">
        <div className="grid grid-4">
          <Kpi to="/juridique/actes" icon={Stamp} label="Ventes en cours jusqu’à l’acte" count={j.deeds_open} foot={`${num(j.deeds_to_sign)} acte(s) à signer chez le notaire`} />
          <Kpi to="/juridique/litiges" icon={Scale} label="Litiges ouverts" count={j.litigations} foot={j.litigations_fcfa ? `${money(j.litigations_fcfa)} en jeu` : 'aucun montant en jeu'} />
          <Kpi to="/juridique/cautions" icon={ShieldHalf} label="Cautions : échéances (30 j)" count={j.guarantees_due_30} tint={j.guarantees_late ? 'amber' : undefined} foot={`${num(j.guarantees_late)} dépassée(s)`} />
          <Kpi to="/juridique/impayes" icon={AlarmClock} label={`Impayés de plus de ${j.unpaid_threshold} jours`} count={j.unpaid_transmitted} tint={j.unpaid_to_handle ? 'amber' : undefined} foot={`${num(j.unpaid_to_handle)} sans litige ouvert`} />
        </div>
      </Section>
    </div>
  );
}
