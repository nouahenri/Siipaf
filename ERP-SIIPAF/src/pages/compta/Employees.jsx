import { useState } from 'react';
import { Plus, Search, UserPlus, Users, Link2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
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
  const [importing, setImporting] = useState(false);
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
        {can('paie:employees') && (
          <div className="row">
            <button className="btn" onClick={() => setImporting(true)}><Link2 />Depuis les comptes du dashboard</button>
            <button className="btn btn-primary" onClick={() => setEdit({})}><Plus />Employé</button>
          </div>
        )}
      </div>
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={240} /></div> : !rows.length ? <div className="card-body"><Empty icon={Users}>Aucun employé. Créez les fiches du personnel (bureau, commerciaux, chantier) ou reprenez les comptes du dashboard.</Empty></div> : (
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
                  {withPay && <td className="right tabular small">{fcfa(e.base_salary)}</td>}
                  <td className="small">{e.user_name ? <Badge tone="ok">{e.user_name}</Badge> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {edit && <EmployeeForm employee={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
      {importing && <FromUsers onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); }} />}
    </div>
  );
}

function FromUsers({ onClose, onDone }) {
  const toast = useToast();
  const { meta, reload } = usePaieMeta();
  const free = (meta?.users || []).filter(u => !u.employee_id);
  const [ids, setIds] = useState([]);
  const [hire, setHire] = useState(new Date().toISOString().slice(0, 10));
  const save = async () => {
    try { const r = await api.post('/admin/erp/paie/employees/from-users', { user_ids: ids, hire_date: hire }); toast(`${r.created} fiche(s) créée(s) : complétez le salaire et le contrat`); reload(); onDone(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Créer les fiches depuis les comptes du dashboard" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!ids.length} onClick={save}><UserPlus />Créer {ids.length || ''}</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="small">Nom, e-mail et service sont repris du compte ; la fiche reste reliée au compte (même personne dans le dashboard et l’ERP).</p>
        {!free.length ? <p className="muted small">Tous les comptes ont déjà une fiche.</p> : (
          <ul className="pick-list">
            {free.map(u => <li key={u.id}><label className="checkbox" style={{ padding: '8px 12px', width: '100%' }}><input type="checkbox" checked={ids.includes(u.id)} onChange={e => setIds(s => (e.target.checked ? [...s, u.id] : s.filter(x => x !== u.id)))} /><b>{u.name}</b> <span className="small muted">{u.email}</span></label></li>)}
          </ul>
        )}
        <Field label="Date d’entrée"><input className="input" type="date" value={hire} onChange={e => setHire(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

