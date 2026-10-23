/**
 * Juridique › Tableau de bord : ventes par étape jusqu'à l'acte, litiges ouverts, cautions en cours, impayés transmis
 * à traiter, échéances des 30 prochains jours et courriers affectés au service Juridique.
 */
import { Link } from 'react-router-dom';
import { Stamp, Scale, ShieldCheck, AlarmClock, Mail, CalendarClock } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Badge, Empty } from '@admin/components/ui';
import { date, fcfa, num } from '@admin/lib/format';
import { compact } from '../../lib/commercial';
import { Kpi } from '../commercial/CommercialDashboard';
import { JUR, DaysLeft } from '../../lib/juridique';

const money = v => `${compact(v)} FCFA`;

export default function JuridiqueDashboard() {
  const res = useResource(`${JUR}/overview`);
  const d = res.data;
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d) return <div className="grid grid-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</div>;
  const { deeds, litigations: l, guarantees: g, unpaid: u } = d;

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Kpi to="/juridique/actes" icon={Stamp} label="Ventes en cours jusqu’à l’acte" count={deeds.total - deeds.by_step.termine} foot={`${num(deeds.by_step.acte)} acte(s) à signer · ${num(deeds.by_step.remise)} expédition(s) à remettre`} tint="violet" />
        <Kpi to="/juridique/litiges" icon={Scale} label="Litiges ouverts" count={l.open} foot={l.amount_fcfa ? `${money(l.amount_fcfa)} en jeu` : 'aucun montant en jeu'} />
        <Kpi to="/juridique/cautions" icon={ShieldCheck} label="Cautions en cours" count={g.active} foot={`reçues ${money(g.received_fcfa)} · données ${money(g.given_fcfa)} · retenues ${money(g.retained_fcfa)}`} />
        <Kpi to="/juridique/impayes" icon={AlarmClock} label={`Impayés de plus de ${u.threshold} jours`} count={u.transmitted} tint={u.to_handle_total ? 'amber' : undefined} foot={`${num(u.to_handle_total)} sans litige ouvert · ${num(u.late)} vente(s) en retard`} />
      </div>

      <Card title="Avancement des ventes jusqu’à l’acte" bodyClass="">
        <ul className="list">
          {deeds.steps.map(s => (
            <li key={s.key}><Link to="/juridique/actes" className="list-row"><span>À faire : {s.label.toLowerCase()}</span><b className="tabular">{num(deeds.by_step[s.key])}</b></Link></li>
          ))}
          <li><Link to="/juridique/actes" className="list-row"><span>Dossiers terminés</span><b className="tabular">{num(deeds.by_step.termine)}</b></Link></li>
        </ul>
      </Card>

      <div className="grid grid-2">
        <Card title="Échéances des 30 prochains jours" actions={d.agenda_total > d.agenda.length ? <span className="small muted">{d.agenda_total} au total</span> : null} bodyClass="">
          {!d.agenda.length ? <div className="card-body"><Empty icon={CalendarClock}>Aucune échéance de litige ou de caution.</Empty></div> : (
            <ul className="list">
              {d.agenda.map(a => (
                <li key={`${a.kind}-${a.link}`}>
                  <Link to={a.link} className="list-row">
                    <span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{a.label}</strong><span className="small muted ellipsis">{a.title}{a.amount_fcfa ? ` · ${fcfa(a.amount_fcfa)}` : ''}</span></span>
                    <span className="small nowrap">{date(a.date)} <DaysLeft n={a.days_left} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Impayés à traiter" actions={<Link className="small" to="/juridique/impayes">Tous les impayés</Link>} bodyClass="">
          {!u.to_handle.length ? <div className="card-body"><Empty icon={AlarmClock}>Aucun impayé transmis sans litige.</Empty></div> : (
            <ul className="list">
              {u.to_handle.map(x => (
                <li key={x.sale_id}>
                  <Link to="/juridique/impayes" className="list-row">
                    <span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{x.client_name}</strong><span className="small muted ellipsis">{x.project_name} · lot {x.lot_code} · {x.commercial_name || 'sans commercial'}</span></span>
                    <span className="small nowrap">{fcfa(x.overdue_fcfa)} <Badge tone="danger">{x.days_late} j</Badge></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Courriers affectés au service Juridique" bodyClass="">
        {!d.mail.length ? <div className="card-body"><Empty icon={Mail}>Aucun courrier affecté au service en ce moment.</Empty></div> : (
          <ul className="list">
            {d.mail.map(m => (
              <li key={m.id}>
                <Link to={`/administration/courrier?fiche=${m.id}`} className="list-row">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <strong className="ellipsis">{m.number} · {m.masked ? 'Courrier confidentiel' : m.subject}</strong>
                    {!m.masked && <span className="small muted ellipsis">{m.correspondent} · {m.suite_label || ''}</span>}
                  </span>
                  <span className="small nowrap">
                    {m.status === 'traite' ? <Badge tone="ok">Traité</Badge> : m.due_date ? <>{date(m.due_date)} {m.late && <Badge tone="danger">en retard</Badge>}</> : <Badge>{m.status_label}</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
