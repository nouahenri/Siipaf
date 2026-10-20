import { useState } from 'react';
import { Plus, Search, UserPlus, Users, Link2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { usePaieMeta } from '../../lib/paie';

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
        {can('paie:write') && (
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
                <tr key={e.id} className={can('paie:write') ? 'clickable' : ''} onClick={() => can('paie:write') && setEdit(e)}>
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

function EmployeeForm({ employee, onClose, onSaved }) {
  const { meta, reload } = usePaieMeta();
  const blank = { last_name: '', first_name: '', gender: '', birth_date: '', nationality: 'Ivoirienne', expatriate: false, phone: '', email: '', address: '', id_number: '', cnps_number: '',
    marital_status: 'celibataire', children: 0, tax_parts: '', job_title: '', department: 'administratif', category: '', contract_type: 'cdi', hire_date: new Date().toISOString().slice(0, 10), end_date: '',
    base_salary: '', housing_allowance: 0, transport_allowance: 0, other_allowance: 0, accident_rate: '', pay_method: 'virement', bank_account: '', project_id: '', user_id: '', active: true, notes: '' };
  const [f, setF] = useState(() => {
    const init = { ...blank };
    for (const k of Object.keys(blank)) if (employee[k] != null) init[k] = employee[k];
    return init;
  });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const n = v => (v === '' || v == null ? null : Number(v));
  const suggested = Math.min(5, 1 + (f.marital_status === 'marie' ? 1 : 0) + 0.5 * (Number(f.children) || 0));
  const save = async e => {
    e.preventDefault(); setError(null);
    const body = {
      ...f, gender: f.gender || null, birth_date: f.birth_date || null, end_date: f.end_date || null, email: f.email || null,
      children: Number(f.children) || 0, tax_parts: n(f.tax_parts), base_salary: Number(f.base_salary) || 0, housing_allowance: Number(f.housing_allowance) || 0,
      transport_allowance: Number(f.transport_allowance) || 0, other_allowance: Number(f.other_allowance) || 0, accident_rate: n(f.accident_rate),
      project_id: n(f.project_id), user_id: n(f.user_id),
    };
    if (!employee.id) delete body.active;
    try {
      await (employee.id ? api.patch(`/admin/erp/paie/employees/${employee.id}`, body) : api.post('/admin/erp/paie/employees', body));
      reload(); onSaved();
    } catch (err) { setError(err); }
  };
  const users = (meta?.users || []).filter(u => !u.employee_id || u.employee_id === employee.id);
  return (
    <Modal title={employee.id ? `${employee.last_name} ${employee.first_name} · ${employee.matricule}` : 'Nouvel employé'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="emp-form">Enregistrer</button></>}>
      <form id="emp-form" className="stack wide-form" style={{ gap: 14 }} onSubmit={save}>
        <ErrorBox error={error} />
        <h3 className="erp-h3">Identité</h3>
        <div className="form-grid">
          <Field label="Nom"><input className="input" required value={f.last_name} onChange={set('last_name')} autoFocus={!employee.id} /></Field>
          <Field label="Prénoms"><input className="input" required value={f.first_name} onChange={set('first_name')} /></Field>
          <Field label="Sexe"><select className="select" value={f.gender} onChange={set('gender')}><option value="">—</option><option value="F">Femme</option><option value="M">Homme</option></select></Field>
          <Field label="Date de naissance"><input className="input" type="date" value={f.birth_date} onChange={set('birth_date')} /></Field>
          <Field label="Nationalité"><input className="input" value={f.nationality} onChange={set('nationality')} /></Field>
          <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={f.expatriate} onChange={set('expatriate')} />Personnel expatrié (contribution employeur majorée)</label>
          <Field label="Téléphone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="N° CNI / passeport"><input className="input" value={f.id_number} onChange={set('id_number')} /></Field>
          <Field label="N° CNPS"><input className="input" value={f.cnps_number} onChange={set('cnps_number')} /></Field>
          <Field label="Compte du dashboard" hint="Relie la fiche au compte de connexion de la même personne">
            <select className="select" value={f.user_id || ''} onChange={set('user_id')}><option value="">— Aucun —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select>
          </Field>
        </div>
        <h3 className="erp-h3">Poste et contrat</h3>
        <div className="form-grid">
          <Field label="Poste"><input className="input" required minLength={2} value={f.job_title} onChange={set('job_title')} placeholder="Conducteur de travaux, maçon, commerciale…" /></Field>
          <Field label="Service"><select className="select" value={f.department} onChange={set('department')}>{meta && Object.entries(meta.departments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Contrat"><select className="select" value={f.contract_type} onChange={set('contract_type')}>{meta && Object.entries(meta.contract_types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Catégorie professionnelle"><input className="input" value={f.category} onChange={set('category')} /></Field>
          <Field label="Date d’entrée"><input className="input" type="date" required value={f.hire_date} onChange={set('hire_date')} /></Field>
          <Field label="Date de sortie / fin de contrat"><input className="input" type="date" value={f.end_date} onChange={set('end_date')} /></Field>
          <Field label="Affectation (programme)" hint="Ventile le coût salarial sur le chantier (analytique)">
            <select className="select" value={f.project_id || ''} onChange={set('project_id')}><option value="">Frais généraux (siège)</option>{meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Field>
          {employee.id && <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={f.active} onChange={set('active')} />En poste</label>}
        </div>
        <h3 className="erp-h3">Rémunération mensuelle</h3>
        <div className="form-grid">
          <Field label="Salaire de base (FCFA)" hint={meta?.settings ? `SMIG : ${fcfa(meta.settings.smig)}` : undefined}><input className="input" type="number" min="0" required value={f.base_salary} onChange={set('base_salary')} /></Field>
          <Field label="Indemnité de logement"><input className="input" type="number" min="0" value={f.housing_allowance} onChange={set('housing_allowance')} /></Field>
          <Field label="Indemnité de transport" hint={meta?.settings ? `Non imposable jusqu’à ${fcfa(meta.settings.transport_exempt_ceiling)}` : undefined}><input className="input" type="number" min="0" value={f.transport_allowance} onChange={set('transport_allowance')} /></Field>
          <Field label="Autres primes fixes"><input className="input" type="number" min="0" value={f.other_allowance} onChange={set('other_allowance')} /></Field>
          <Field label="Paiement"><select className="select" value={f.pay_method} onChange={set('pay_method')}>{meta && Object.entries(meta.pay_methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="RIB / n° Mobile Money"><input className="input" value={f.bank_account} onChange={set('bank_account')} /></Field>
          <Field label="Taux accident du travail (%)" hint={meta?.settings ? `Barème : ${meta.settings.accident_rate} % (chantier : souvent plus élevé)` : undefined}><input className="input" type="number" min="0" max="10" step="0.5" value={f.accident_rate ?? ''} onChange={set('accident_rate')} placeholder="Barème" /></Field>
        </div>
        <h3 className="erp-h3">Famille (ITS et CMU)</h3>
        <div className="form-grid">
          <Field label="Situation"><select className="select" value={f.marital_status} onChange={set('marital_status')}>{meta && Object.entries(meta.marital).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Enfants à charge"><input className="input" type="number" min="0" max="20" value={f.children} onChange={set('children')} /></Field>
          <Field label="Parts fiscales" hint={`Proposé : ${suggested} (à confirmer par le comptable)`}><input className="input" type="number" min="1" max="5" step="0.5" value={f.tax_parts ?? ''} onChange={set('tax_parts')} placeholder={String(suggested)} /></Field>
        </div>
      </form>
    </Modal>
  );
}
