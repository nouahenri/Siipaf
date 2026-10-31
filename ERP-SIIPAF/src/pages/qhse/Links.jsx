/**
 * QHSE › liaisons avec les autres modules : onglet QHSE de la fiche d'un chantier (Chantiers), remarques de sécurité de la fiche d'un
 * employé (Ressources humaines), actions correctives et historique qualité d'une réclamation (Client & SAV).
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldAlert, Plus, ClipboardCheck, SearchCheck } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Badge, Card, ErrorBox, Skeleton } from '@admin/components/ui';
import { QH, useQhseRefs, RatingBadge, PctBadge, ACTION_TONES, AUDIT_TONES, CONTROL_TONES, frDay } from '../../lib/qhse';
import { ActionForm } from './Actions';

/** Fiche d'un chantier › QHSE : notes de la semaine, contrôle du jour, derniers contrôles, synthèses, actions et audits du chantier. */
export function WorksiteQhse({ w }) {
  const refs = useQhseRefs();
  const res = useResource(`${QH}/worksites/${w.id}/summary`);
  if (res.error) return <ErrorBox error={res.error} />;
  const d = res.data;
  if (!d || !refs) return <Skeleton h={300} />;
  const t = d.threshold;
  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <p className="muted" style={{ margin: 0 }}>Qualité, hygiène, sécurité et environnement de ce chantier : notes des 7 derniers jours, contrôles, actions correctives et audits.</p>
        <div className="row" style={{ gap: 8 }}>
          {d.can.control && (d.today_control_id
            ? <Link to={`/qhse/controles/${d.today_control_id}`} className="btn"><ClipboardCheck />Contrôle du jour fait</Link>
            : <Link to={`/qhse/controles/nouveau?chantier=${w.id}`} className="btn btn-primary"><Plus />Contrôle du jour</Link>)}
          <Link to={`/qhse/audits`} className="btn"><SearchCheck />Audits</Link>
        </div>
      </div>
      <div className="grid grid-4">
        <div className="card kpi"><span className="kpi-label">Qualité (7 jours)</span><span className="kpi-value"><RatingBadge value={d.week.qualite} labels={refs.ratings} avg /></span></div>
        <div className="card kpi"><span className="kpi-label">Hygiène (7 jours)</span><span className="kpi-value"><RatingBadge value={d.week.hygiene} labels={refs.ratings} avg /></span></div>
        <div className="card kpi"><span className="kpi-label">Sécurité (7 jours)</span><span className="kpi-value"><PctBadge value={d.week.safety} threshold={t} /></span></div>
        <div className="card kpi"><span className="kpi-label">Environnement (7 jours)</span><span className="kpi-value"><PctBadge value={d.week.env} threshold={80} /></span></div>
      </div>
      <Card title="Derniers contrôles journaliers" bodyClass="">
        {!d.recent.length ? <div className="card-body"><p className="small muted" style={{ margin: 0 }}>Aucun contrôle sur les 30 derniers jours.</p></div> : (
          <div className="table-wrap"><table className="table table-compact">
            <thead><tr><th>Jour</th><th>Qualité</th><th>Hygiène</th><th>Sécurité</th><th>Environnement</th></tr></thead>
            <tbody>{d.recent.map(c => (
              <tr key={c.control_id}>
                <td><Link className="link" to={`/qhse/controles/${c.control_id}`}>{frDay(c.day)}</Link></td>
                <td><RatingBadge value={c.rating_qualite} labels={refs.ratings} /></td><td><RatingBadge value={c.rating_hygiene} labels={refs.ratings} /></td>
                <td><PctBadge value={c.safety_pct} threshold={t} /> <span className="small muted">{c.workers_present != null ? `${c.workers_compliant}/${c.workers_present}` : ''}</span></td>
                <td>{c.env_rate == null ? '—' : <PctBadge value={c.env_rate} threshold={80} />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Synthèses hebdomadaires" actions={<Link className="small" to="/qhse/hebdomadaires">Toutes</Link>} bodyClass="">
          {!d.weekly.length ? <div className="card-body"><p className="small muted" style={{ margin: 0 }}>Aucune synthèse hebdomadaire.</p></div> : (
            <ul className="list">{d.weekly.map(c => <li key={c.id}><Link className="list-row" to={`/qhse/hebdomadaires/${c.id}`}><span>Semaine du {frDay(c.week_start)}</span><Badge tone={CONTROL_TONES[c.status]}>{c.status_label}</Badge></Link></li>)}</ul>
          )}
        </Card>
        <Card title="Audits" bodyClass="">
          {!d.audits.length ? <div className="card-body"><p className="small muted" style={{ margin: 0 }}>Aucun audit sur ce chantier.</p></div> : (
            <ul className="list">{d.audits.map(a => <li key={a.id}><Link className="list-row" to={`/qhse/audits/${a.id}`}><span><b>{a.reference}</b><span className="small muted"> · {a.kind_label} · {frDay(a.done_on || a.planned_on)}</span></span><Badge tone={AUDIT_TONES[a.status]}>{a.status_label}</Badge></Link></li>)}</ul>
          )}
        </Card>
      </div>
      <Card title="Actions correctives ouvertes" actions={<Link className="small" to={`/qhse/actions`}>Toutes</Link>} bodyClass="">
        {!d.actions.length ? <div className="card-body"><p className="small muted" style={{ margin: 0 }}>Aucune action ouverte.</p></div> : (
          <ul className="list">{d.actions.map(a => <li key={a.id}><Link className="list-row" to={`/qhse/actions?fiche=${a.id}`}><span><b>{a.title}</b><span className="small muted"> · {a.owner_name || '—'}</span></span><span className="small nowrap">{frDay(a.due_on)} {a.late ? <Badge tone="danger">{a.days_late} j de retard</Badge> : <Badge tone={ACTION_TONES[a.status]}>{a.status_label}</Badge>}</span></Link></li>)}</ul>
        )}
      </Card>
    </div>
  );
}

/** Fiche d'un employé : remarques de sécurité relevées lors des contrôles de chantier (rien à afficher sans remarque). */
export function SafetyRemarks({ employeeId }) {
  const { can } = useAuth();
  const res = useResource(can('qhse:all') ? `${QH}/employees/${employeeId}/remarks` : null);
  if (!can('qhse:all') || !res.data?.length) return null;
  return (
    <Card title="Remarques sécurité (QHSE)" actions={<Badge tone="warn">{res.data.length}</Badge>} bodyClass="">
      <ul className="list">{res.data.map(r => (
        <li key={r.id}><Link className="list-row" to={`/qhse/controles/${r.control_id}`}>
          <span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{r.issue || 'Consignes de sécurité non respectées'}</strong><span className="small muted ellipsis">{r.worksite_reference} · {r.worksite_name}</span></span>
          <span className="small nowrap">{frDay(r.day)}</span>
        </Link></li>
      ))}</ul>
    </Card>
  );
}

/** Réclamation › QHSE : actions correctives liées, historique qualité des chantiers du programme, ouverture d'une action. */
export function SavQhse({ ticket }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const allowed = can('qhse:read');
  const res = useResource(allowed ? `${QH}/sav/${ticket.id}` : null);
  const refs = useResource(allowed && can('qhse:actions') ? `${QH}/refs` : null).data;
  const [open, setOpen] = useState(false);
  const d = res.data;
  if (!allowed || !d || (!d.worksites.length && !d.actions.length && !d.can_open)) return null;
  const only = d.worksites.length === 1 ? d.worksites[0] : null;
  return (
    <section>
      <div className="row-between"><h3 className="erp-h3"><ShieldAlert className="ico" aria-hidden="true" /> QHSE</h3>
        {d.can_open && refs && <button className="btn btn-sm" onClick={() => setOpen(true)}><Plus />Action corrective</button>}</div>
      {d.actions.length > 0 && (
        <ul className="list">{d.actions.map(a => <li key={a.id}><Link className="list-row" to={`/qhse/actions?fiche=${a.id}`}><span><b>{a.title}</b><span className="small muted"> · {a.owner_name || '—'}</span></span><span className="small nowrap">{frDay(a.due_on)} <Badge tone={ACTION_TONES[a.status]}>{a.status_label}</Badge></span></Link></li>)}</ul>
      )}
      {d.worksites.map(w => (
        <div key={w.id} className="small" style={{ marginTop: 8 }}>
          <Link className="link" to={`/chantiers/${w.id}?onglet=qhse`}><b>{w.reference} · {w.name}</b></Link>
          <span className="muted"> — qualité sur 90 jours : {w.controls_90d ? <>{w.qualite_avg != null && `${w.qualite_avg.toLocaleString('fr-FR')} / 4`}, {w.bad_90d} note(s) « Mauvais » sur {w.controls_90d} contrôle(s)</> : 'aucun contrôle'}</span>
          {w.recent.length > 0 && <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>{w.recent.map(c => <Link key={c.id} to={`/qhse/controles/${c.id}`} title={frDay(c.day)}><Badge tone={c.rating === 1 ? 'danger' : c.rating === 2 ? 'warn' : 'ok'}>{frDay(c.day).slice(0, 5)} {c.label}</Badge></Link>)}</div>}
        </div>
      ))}
      {!d.worksites.length && !d.actions.length && <p className="small muted" style={{ margin: 0 }}>Aucun chantier du programme visible dans le QHSE.</p>}
      {open && refs && (
        <ActionForm refs={refs} context={`Rattachée à la réclamation ${ticket.ref} : ${ticket.title}`}
          defaults={{ sav_ticket_id: ticket.id, title: `Réclamation ${ticket.ref} : ${ticket.title}`.slice(0, 200), gravity: 'majeure', pillar: 'qualite', worksite_id: only ? only.id : '' }}
          onClose={() => setOpen(false)} onSaved={a => { setOpen(false); navigate(`/qhse/actions?fiche=${a.id}`); }} />
      )}
    </section>
  );
}
