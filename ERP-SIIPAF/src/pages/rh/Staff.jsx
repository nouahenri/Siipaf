import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Users, List, Network, ExternalLink } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Badge } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { initials } from '@admin/lib/format';
import { RH, useRhMeta } from '../../lib/rh';

/** Annuaire du personnel (référence : Odoo Employés) et organigramme tiré du responsable direct. */
export default function Staff() {
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const navigate = useNavigate();
  const [view, setView] = useState('liste');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [scope, setScope] = useState('1');
  const list = useResource(`${RH}/employees?active=${scope}`);
  const rows = (list.data || []).filter(e => (!dept || e.department === dept) && (!q || `${e.last_name} ${e.first_name} ${e.matricule} ${e.job_title}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <div className="seg" role="group" aria-label="Affichage">
            <button className={view === 'liste' ? 'active' : ''} onClick={() => setView('liste')}><List />Liste</button>
            <button className={view === 'organigramme' ? 'active' : ''} onClick={() => setView('organigramme')}><Network />Organigramme</button>
          </div>
          {view === 'liste' && <>
            <label className="search"><Search aria-hidden="true" /><input className="input" type="search" placeholder="Nom, matricule, poste…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" /></label>
            <select className="select" style={{ width: 'auto' }} value={dept} onChange={e => setDept(e.target.value)} aria-label="Service"><option value="">Tous les services</option>{meta && Object.entries(meta.departments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <div className="seg" role="group" aria-label="Statut">{[['1', 'En poste'], ['0', 'Sortis'], ['all', 'Tous']].map(([k, l]) => <button key={k} className={scope === k ? 'active' : ''} onClick={() => setScope(k)}>{l}</button>)}</div>
          </>}
        </div>
        {can('paie:employees') && <Link className="btn" to="/compta/employes"><ExternalLink />Créer une fiche (Comptabilité › Employés)</Link>}
      </div>
      <ErrorBox error={list.error} />
      {view === 'organigramme' ? <OrgChart /> : (
        <Card bodyClass="">
          {!list.data ? <div className="card-body"><Skeleton h={260} /></div> : !rows.length ? <div className="card-body"><Empty icon={Users}>Aucun employé.</Empty></div> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Employé</th><th>Poste · service</th><th>Responsable</th><th>Contrat</th><th className="right">Congés dispo.</th><th>Aujourd’hui</th></tr></thead>
              <tbody>
                {rows.map(e => (
                  <tr key={e.id} className="clickable" onClick={() => navigate(`/rh/personnel/${e.id}`)}>
                    <td><span className="row" style={{ gap: 10 }}><span className="avatar xs">{initials(`${e.first_name} ${e.last_name}`)}</span><span><b>{e.last_name} {e.first_name}</b><div className="small muted tabular">{e.matricule}</div></span></span></td>
                    <td className="small">{e.job_title}<div className="muted">{meta?.departments[e.department]}{e.project_name ? ` · ${e.project_name}` : ''}</div></td>
                    <td className="small">{e.manager_name || <span className="muted">—</span>}</td>
                    <td className="small">{meta?.contract_types[e.contract_type]}{e.end_date && <div className="muted">jusqu’au {date(e.end_date)}</div>}{e.trial_end_date && e.trial_end_date >= new Date().toISOString().slice(0, 10) && <div style={{ color: 'var(--warn)' }}>essai jusqu’au {date(e.trial_end_date)}</div>}</td>
                    <td className="right tabular">{e.leave_available.toLocaleString('fr-FR')} j</td>
                    <td>{e.absent ? <Badge tone="warn">{e.absent}</Badge> : <span className="small muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}

function OrgChart() {
  const { meta } = useRhMeta();
  const org = useResource(`${RH}/orgchart`);
  if (!org.data) return <Skeleton h={260} />;
  if (!org.data.length) return <Card><Empty icon={Network}>Aucun employé.</Empty></Card>;
  const Node = ({ n }) => (
    <li>
      <Link to={`/rh/personnel/${n.id}`} className="org-node">
        <span className="avatar xs">{initials(`${n.first_name} ${n.last_name}`)}</span>
        <span><b>{n.name}</b><small>{n.job_title}</small><small className="muted">{meta?.departments[n.department]}</small></span>
      </Link>
      {n.reports.length > 0 && <ul>{n.reports.map(c => <Node key={c.id} n={c} />)}</ul>}
    </li>
  );
  return (
    <Card>
      <p className="small muted" style={{ marginBottom: 12 }}>Établi à partir du « responsable direct » de chaque fiche (dossier › Contrat). Il sert aussi au circuit d’approbation des congés et des notes de frais.</p>
      <div className="org"><ul>{org.data.map(n => <Node key={n.id} n={n} />)}</ul></div>
    </Card>
  );
}
