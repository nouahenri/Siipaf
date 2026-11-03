import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Users, List, Network, Plus, Link2, FileSpreadsheet, Printer, ArrowLeft } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { usePersistentState } from '@admin/lib/navigation';
import { Card, Empty, Skeleton, ErrorBox, Badge } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { initials } from '@admin/lib/format';
import { downloadReportExcel } from '@admin/lib/report-excel';
import { RH, useRhMeta, DEPT_COLORS } from '../../lib/rh';
import EmployeeForm from '../../components/EmployeeForm';
import EmployeesFromUsers from '../../components/EmployeesFromUsers';

/** Annuaire du personnel (référence : Odoo Employés) et organigramme tiré du responsable direct. */
export default function Staff() {
  const { can, user } = useAuth();
  const { meta } = useRhMeta();
  const navigate = useNavigate();
  const [view, setView] = usePersistentState('vue', 'liste'); // filtres gardés au retour d'une fiche
  const [q, setQ] = usePersistentState('recherche', '');
  const [dept, setDept] = usePersistentState('service', '');
  const [scope, setScope] = usePersistentState('statut', '1');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const list = useResource(`${RH}/employees?active=${scope}`);
  const rows = (list.data || []).filter(e => (!dept || e.department === dept) && (!q || `${e.last_name} ${e.first_name} ${e.matricule} ${e.job_title}`.toLowerCase().includes(q.toLowerCase())));
  // Exporter / Imprimer (demande du client du 03/11) : la liste telle que filtrée (recherche, service, statut)
  const report = () => staffReport(rows, meta, { scope, dept, q, by: user?.name });
  if (printing) return <StaffPrint report={report()} onBack={() => setPrinting(false)} />;
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
        <div className="row">
          {can('rh:files') && <>
            <button className="btn" onClick={() => setImporting(true)}><Link2 />Depuis les comptes du dashboard</button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouvel employé</button>
          </>}
          {view === 'liste' && list.data && meta && <>
            <button className="btn" onClick={() => downloadReportExcel(report())} disabled={!rows.length} title="Classeur Excel de la liste affichée (filtres compris)"><FileSpreadsheet />Exporter</button>
            <button className="btn" onClick={() => { setPrinting(true); window.scrollTo(0, 0); }} disabled={!rows.length} title="Version imprimable de la liste affichée (ou PDF)"><Printer />Imprimer</button>
          </>}
        </div>
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
      {/* Nouvelle fiche : créée par le service RH, la Comptabilité est prévenue pour fixer le salaire (demande du client du 02/11) */}
      {creating && <EmployeeForm employee={{}} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload(); }} />}
      {importing && <EmployeesFromUsers onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); }} />}
    </div>
  );
}

const STATUS = { 1: 'En poste', 0: 'Sortis', all: 'En poste et sortis' };
const STAFF_COLUMNS = [
  { key: 'matricule', label: 'Matricule' }, { key: 'last_name', label: 'Nom' }, { key: 'first_name', label: 'Prénom' },
  { key: 'job_title', label: 'Poste' }, { key: 'direction', label: 'Direction' }, { key: 'department', label: 'Service' },
  { key: 'manager', label: 'Responsable' }, { key: 'contract', label: 'Contrat' }, { key: 'hire_date', label: 'Embauche', format: 'date' },
  { key: 'end_date', label: 'Fin de contrat', format: 'date' }, { key: 'leave', label: 'Congés dispo. (j)', format: 'decimal' }, { key: 'today', label: 'Aujourd’hui' },
];

/** Liste filtrée mise au format des rapports de l'ERP (Excel : feuilles Synthèse et Personnel). */
function staffReport(rows, meta, { scope, dept, q, by }) {
  const today = new Date().toISOString().slice(0, 10);
  const filters = [STATUS[scope], dept ? meta.departments[dept] : 'tous les services', q && `recherche « ${q} »`].filter(Boolean).join(' · ');
  const columns = scope === 'all' ? [...STAFF_COLUMNS, { key: 'status', label: 'Statut' }] : STAFF_COLUMNS;
  const contracts = rows.reduce((m, e) => ({ ...m, [e.contract_type]: (m[e.contract_type] || 0) + 1 }), {});
  return {
    module: 'personnel', title: 'Personnel', filename: `personnel-${today}.xlsx`, filters,
    period: { from: today, to: today, label: `au ${date(today)} — ${filters}` },
    generated_at: new Date().toISOString(), generated_by: by,
    summary: [
      { label: 'Employés listés', value: rows.length, format: 'number' },
      ...Object.entries(contracts).map(([k, n]) => ({ label: `Contrats : ${meta.contract_types[k] || k}`, value: n, format: 'number' })),
      { label: 'Absents aujourd’hui', value: rows.filter(e => e.absent).length, format: 'number' },
    ],
    sections: [{
      title: 'Personnel', columns,
      rows: rows.map(e => ({
        matricule: e.matricule, last_name: e.last_name, first_name: e.first_name, job_title: e.job_title,
        direction: meta.directions?.[meta.department_directions?.[e.department]] || '',
        department: (meta.departments[e.department] || e.department) + (e.project_name ? ` · ${e.project_name}` : ''),
        manager: e.manager_name || '', contract: meta.contract_types[e.contract_type] || e.contract_type, hire_date: e.hire_date, end_date: e.end_date,
        leave: e.leave_available, today: e.absent || '', status: e.active ? 'En poste' : 'Sorti',
      })),
    }],
  };
}

/** Version imprimable (ou PDF) de la liste, avec l'en-tête des rapports de l'ERP. */
function StaffPrint({ report: r, onBack }) {
  const s = r.sections[0];
  const show = (v, f) => (v == null || v === '' ? '—' : f === 'date' ? date(v) : f === 'decimal' ? Number(v).toLocaleString('fr-FR') : v);
  return (
    <article className="appro-print report-print staff-print stack" aria-label="Liste du personnel">
      <div className="row appro-print-actions" style={{ gap: 8, justifyContent: 'space-between' }}>
        <button className="btn btn-ghost" onClick={onBack}><ArrowLeft />Retour à la liste</button>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => downloadReportExcel(r)}><FileSpreadsheet />Exporter (Excel)</button>
          <button className="btn btn-primary" onClick={() => window.print()}><Printer />Imprimer / PDF</button>
        </div>
      </div>
      <header className="row-between report-head">
        <img src="/logo-siipaf.png" alt="SIIPAF SA" style={{ width: 150 }} />
        <div className="right">
          <h2 style={{ margin: 0 }}>Liste du personnel</h2>
          <div><b>{r.filters}</b> — {s.rows.length} employé(s)</div>
          <div className="small muted">Édité le {new Date(r.generated_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })} par {r.generated_by}</div>
        </div>
      </header>
      <div className="table-wrap"><table className="table table-compact">
        <thead><tr>{s.columns.map(c => <th key={c.key} className={c.format === 'decimal' ? 'right' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>{s.rows.map((row, i) => <tr key={i}>{s.columns.map(c => <td key={c.key} className={c.format === 'decimal' ? 'right tabular' : c.key === 'matricule' ? 'tabular' : ''}>{show(row[c.key], c.format)}</td>)}</tr>)}</tbody>
      </table></div>
    </article>
  );
}

function OrgChart() {
  const { meta } = useRhMeta();
  const org = useResource(`${RH}/orgchart`);
  if (!org.data) return <Skeleton h={260} />;
  if (!org.data.length) return <Card><Empty icon={Network}>Aucun employé.</Empty></Card>;
  const used = new Set();
  const walk = n => { used.add(n.department); n.reports.forEach(walk); };
  org.data.forEach(walk);
  const Node = ({ n }) => (
    <li>
      <Link to={`/rh/personnel/${n.id}`} className="org-node" style={{ '--c': DEPT_COLORS[n.department] }}>
        <span className="avatar xs">{initials(`${n.first_name} ${n.last_name}`)}</span>
        <span><b>{n.name}</b><small>{n.job_title}</small><small className="muted">{meta?.departments[n.department]}</small></span>
      </Link>
      {n.reports.length > 0 && <ul>{n.reports.map(c => <Node key={c.id} n={c} />)}</ul>}
    </li>
  );
  return (
    <Card>
      <div className="org-legend" aria-label="Services">
        {meta && Object.entries(meta.departments).filter(([k]) => used.has(k)).map(([k, v]) => <span key={k} className="org-chip" style={{ '--c': DEPT_COLORS[k] }}><i />{v}</span>)}
      </div>
      <p className="small muted" style={{ marginBottom: 12 }}>Établi à partir du « responsable direct » de chaque fiche (dossier › Contrat). Il sert aussi au circuit d’approbation des congés et des notes de frais.</p>
      <div className="org"><ul>{org.data.map(n => <Node key={n.id} n={n} />)}</ul></div>
    </Card>
  );
}
