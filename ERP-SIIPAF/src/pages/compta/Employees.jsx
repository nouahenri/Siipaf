import { useState } from 'react';
import { Search, Users } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { usePaieMeta } from '../../lib/paie';
import EmployeeForm from '../../components/EmployeeForm';

/** Registre des employés : bureau, commerciaux, chantier ; relié aux comptes du dashboard quand l'employé en a un. */
export default function Employees() {
  const { can } = useAuth();
  const { meta } = usePaieMeta();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('1');
  const [edit, setEdit] = useState(null);
  const list = useResource(`/admin/erp/paie/employees?active=${scope === 'all' ? 'all' : scope}`);
  const withPay = can('paie:read');
  const rows = (list.data || []).filter(e => !q || `${e.last_name} ${e.first_name} ${e.matricule} ${e.job_title}`.toLowerCase().includes(q.toLowerCase()));
  const mass = rows.reduce((t, e) => t + (e.base_salary || 0) + (e.housing_allowance || 0) + (e.transport_allowance || 0) + (e.other_allowance || 0), 0);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <label className="search"><Search aria-hidden="true" /><input className="input" type="search" placeholder="Nom, matricule, poste…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" /></label>
          <div className="seg" role="group" aria-label="Statut">
            {[['1', 'En poste'], ['0', 'Sortis'], ['all', 'Tous']].map(([k, l]) => <button key={k} className={scope === k ? 'active' : ''} onClick={() => setScope(k)}>{l}</button>)}
          </div>
          {withPay && list.data && <span className="small muted">{rows.length} employé(s) · salaires fixes mensuels : <b>{fcfa(mass)}</b></span>}
        </div>
        {/* Les fiches se créent dans RH › Personnel (demande du client du 02/11) ; la Comptabilité y fixe le salaire, prévenue à chaque embauche */}
        <span className="small muted">Nouvel employé : créé par le service RH (RH › Personnel) ; vous êtes prévenu pour fixer son salaire.</span>
      </div>
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={240} /></div> : !rows.length ? <div className="card-body"><Empty icon={Users}>Aucun employé. Le service RH crée les fiches du personnel (RH › Personnel).</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Matricule</th><th>Nom</th><th>Poste · service</th><th>Contrat</th><th>Entrée</th>{withPay && <th className="right">Salaire de base</th>}<th>Compte</th></tr></thead>
            <tbody>
              {rows.map(e => (
                <tr key={e.id} className={can('paie:employees') ? 'clickable' : ''} onClick={() => can('paie:employees') && setEdit(e)}>
                  <td className="small tabular">{e.matricule}</td>
                  <td><b>{e.last_name} {e.first_name}</b>{e.expatriate && <Badge> Expatrié</Badge>}</td>
                  <td className="small">{e.job_title}<div className="muted">{meta?.departments[e.department]}{e.project_name ? ` · ${e.project_name}` : ''}</div></td>
                  <td className="small">{meta?.contract_types[e.contract_type]}{e.end_date && <div className="muted">jusqu’au {date(e.end_date)}</div>}</td>
                  <td className="small nowrap">{date(e.hire_date)}</td>
                  {withPay && <td className="right tabular small">{e.base_salary ? fcfa(e.base_salary) : <Badge tone="warn">Salaire à fixer</Badge>}</td>}
                  <td className="small">{e.user_name ? <Badge tone="ok">{e.user_name}</Badge> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {edit && <EmployeeForm employee={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

