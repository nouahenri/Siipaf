import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { Plus, RefreshCw, CheckCheck, Wallet, Printer, FileSpreadsheet, Trash2, ArrowLeft, Banknote } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { amt, downloadCsv } from '../../lib/compta';
import { usePaieMeta, RUN_STATUS, periodLabel } from '../../lib/paie';

/** Paies mensuelles et barème de paie. */
export default function Payroll() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') || 'paies';
  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {[['paies', 'Paies mensuelles'], ['bareme', 'Barème de paie']].map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setParams({ onglet: id })}>{l}</button>)}
      </div>
      {tab === 'paies' ? <Runs /> : <Scale />}
    </div>
  );
}

function Runs() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const list = useResource('/admin/erp/paie/runs');
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const create = async () => {
    try { const r = await api.post('/admin/erp/paie/runs', { period }); navigate(`/compta/paie/${r.id}`); } catch (e) { toast(e.message, 'err'); }
  };
  const rows = list.data || [];
  return (
    <>
      {can('paie:prepare') && (
        <div className="row erp-panel" style={{ alignItems: 'flex-end' }}>
          <Field label="Mois de paie"><input className="input" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></Field>
          <button className="btn btn-primary" onClick={create}><Plus />Préparer la paie</button>
          <span className="small muted">Un bulletin par employé en poste dans le mois (prorata en cas d’entrée ou de sortie en cours de mois).</span>
        </div>
      )}
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? <div className="card-body"><Empty icon={Banknote}>Aucune paie préparée.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Mois</th><th className="right">Employés</th><th className="right">Brut</th><th className="right">Net à payer</th><th className="right">Coût employeur</th><th>État</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/compta/paie/${r.id}`)}>
                  <td style={{ textTransform: 'capitalize' }}><b>{periodLabel(r.period)}</b></td>
                  <td className="right tabular small">{r.employees}</td>
                  <td className="right tabular small">{amt(r.gross)}</td>
                  <td className="right tabular small">{amt(r.net)}</td>
                  <td className="right tabular small">{amt(r.employer_cost)}</td>
                  <td><Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>{r.paid_at && <span className="small muted"> le {date(r.paid_at)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

/** Détail d'une paie : bulletins (éléments variables), totaux, validation, paiement, impressions. */
export function PayrollRun() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const run = useResource(`/admin/erp/paie/runs/${id}`);
  const [slip, setSlip] = useState(null);
  const [paying, setPaying] = useState(false);
  const [recap, setRecap] = useState(false);
  const d = run.data;
  const draft = d?.status === 'brouillon';
  const write = can('paie:prepare');
  const act = async (fn, msg) => { try { await fn(); toast(msg); run.reload(); } catch (e) { toast(e.message, 'err'); } };

  const patchSlip = async (s, k, v) => {
    try {
      const out = await api.patch(`/admin/erp/paie/payslips/${s.id}`, { [k]: Number(v) || 0 });
      run.setData(x => ({ ...x, slips: x.slips.map(y => (y.id === s.id ? out : y)) }));
      run.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const exportBook = () => downloadCsv(`livre-de-paie-${d.period}.csv`,
    ['Matricule', 'Nom', 'Poste', 'Jours', 'Brut', 'Brut imposable', 'CNPS salarié', 'CMU salarié', 'ITS', 'Avance', 'Net à payer', 'CNPS patronal', 'Impôts patronaux', 'Coût employeur'],
    d.slips.map(s => [s.employee.matricule, s.employee.name, s.employee.job_title, s.result.days_worked, s.result.gross, s.result.taxable, s.result.cnps_employee, s.result.cmu_employee, s.result.its, s.result.advance, s.result.net, s.result.employer_social, s.result.employer_taxes, s.result.employer_cost]));

  if (!d) return <Skeleton h={400} />;
  const t = d.totals;
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <Link className="btn btn-ghost btn-sm" to="/compta/paie"><ArrowLeft />Paies</Link>
          <h2 style={{ fontSize: 18 }}>Paie de {periodLabel(d.period)}</h2>
          <Badge tone={RUN_STATUS[d.status].tone}>{RUN_STATUS[d.status].label}</Badge>
          {d.entries.map(e => <Badge key={e.id}>{e.number || 'écriture en brouillon'}</Badge>)}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={exportBook}><FileSpreadsheet />Livre de paie</button>
          <button className="btn" onClick={() => setRecap(true)}>Déclarations CNPS / DGI</button>
          {write && draft && <button className="btn" onClick={() => act(() => api.post(`/admin/erp/paie/runs/${d.id}/refresh`), 'Bulletins recalculés')}><RefreshCw />Recalculer</button>}
          {write && draft && <button className="btn btn-ghost btn-danger" onClick={() => window.confirm('Supprimer cette paie en brouillon ?') && act(async () => { await api.del(`/admin/erp/paie/runs/${d.id}`); navigate('/compta/paie'); }, 'Paie supprimée')}><Trash2 /></button>}
          {write && draft && <button className="btn btn-primary" onClick={() => window.confirm('Valider la paie ? Les bulletins deviennent définitifs et l’écriture de paie est passée en comptabilité.') && act(() => api.post(`/admin/erp/paie/runs/${d.id}/validate`), 'Paie validée : écriture au journal PA')}><CheckCheck />Valider</button>}
          {write && d.status === 'valide' && <button className="btn btn-primary" onClick={() => setPaying(true)}><Wallet />Payer les salaires</button>}
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><span className="kpi-label">Masse salariale brute</span><span className="kpi-value">{fcfa(t.gross)}</span><span className="kpi-foot">{d.slips.length} bulletin(s)</span></div>
        <div className="card kpi tint-green"><span className="kpi-label">Net à payer</span><span className="kpi-value">{fcfa(t.net)}</span><span className="kpi-foot">après CNPS, CMU, ITS et avances</span></div>
        <div className="card kpi tint-blue"><span className="kpi-label">CNPS et CMU à reverser</span><span className="kpi-value">{fcfa(t.cnps_employee + t.cmu_employee + t.employer_social)}</span><span className="kpi-foot">parts salariales et patronales</span></div>
        <div className="card kpi tint-amber"><span className="kpi-label">Coût total employeur</span><span className="kpi-value">{fcfa(t.employer_cost)}</span><span className="kpi-foot">ITS {fcfa(t.its)} · taxes patronales {fcfa(t.employer_taxes)}</span></div>
      </div>

      <Card bodyClass="">
        <div className="table-wrap"><table className="table payroll-table">
          <thead><tr><th>Employé</th><th className="right">Jours</th><th className="right">Heures sup.</th><th className="right">Primes</th><th className="right">Non imposable</th><th className="right">Avance</th><th className="right">Brut</th><th className="right">Retenues</th><th className="right">Net</th><th /></tr></thead>
          <tbody>
            {d.slips.map(s => {
              const r = s.result;
              const cell = (k, max) => (draft && write
                ? <input className="input right tabular" type="number" min="0" max={max} defaultValue={s.inputs[k] || 0} onBlur={e => Number(e.target.value) !== Number(s.inputs[k] || 0) && patchSlip(s, k, e.target.value)} aria-label={k} />
                : <span className="tabular small">{amt(s.inputs[k], { zero: '—' })}</span>);
              return (
                <tr key={s.id}>
                  <td style={{ minWidth: 180 }}><b className="small">{s.employee.name}</b><div className="small muted">{s.employee.matricule} · {s.employee.job_title}</div></td>
                  <td className="right" style={{ width: 80 }}>{cell('days_worked', 30)}{s.inputs.unpaid_days > 0 && <div className="small" style={{ color: 'var(--danger)' }} title="Congé sans solde ou absence injustifiée approuvés dans le module RH">−{s.inputs.unpaid_days} j RH</div>}</td>
                  <td className="right" style={{ width: 110 }}>{cell('overtime')}{s.inputs.overtime_auto > 0 && <div className="small muted" title={(s.inputs.overtime_hours || []).map(h => `${h.label} : ${h.hours} h`).join('\n')}>{(s.inputs.overtime_hours || []).reduce((t, h) => t + h.hours, 0)} h pointées</div>}</td>
                  <td className="right" style={{ width: 110 }}>{cell('bonus')}</td>
                  <td className="right" style={{ width: 110 }}>{cell('non_taxable')}</td>
                  <td className="right" style={{ width: 110 }}>{cell('advance')}</td>
                  <td className="right tabular small">{amt(r.gross)}</td>
                  <td className="right tabular small">{amt(r.cnps_employee + r.cmu_employee + r.its + r.advance)}</td>
                  <td className="right tabular small"><b>{amt(r.net)}</b></td>
                  <td><button className="btn btn-sm btn-ghost btn-icon" onClick={() => setSlip(s)} aria-label={`Bulletin de ${s.employee.name}`}><Printer /></button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={6} className="right small"><b>Totaux</b></td><td className="right tabular small"><b>{amt(t.gross)}</b></td><td className="right tabular small"><b>{amt(t.cnps_employee + t.cmu_employee + t.its + t.advance)}</b></td><td className="right tabular small"><b>{amt(t.net)}</b></td><td /></tr></tfoot>
        </table></div>
      </Card>
      {draft && <p className="small muted">Les montants se recalculent dès qu’on quitte une case. Après une modification de fiche employé ou du barème, cliquez sur « Recalculer ».</p>}

      {slip && <Payslip run={d} slip={slip} onClose={() => setSlip(null)} />}
      {paying && <PayModal run={d} onClose={() => setPaying(false)} onDone={() => { setPaying(false); run.reload(); }} />}
      {recap && <Declarations run={d} onClose={() => setRecap(false)} />}
    </div>
  );
}

function PayModal({ run, onClose, onDone }) {
  const toast = useToast();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const by = run.slips.reduce((o, s) => ({ ...o, [s.employee.pay_method]: (o[s.employee.pay_method] || 0) + s.net }), {});
  const LABEL = { virement: 'Virement (banque)', cheque: 'Chèque (banque)', especes: 'Espèces (caisse)', mobile_money: 'Mobile Money' };
  const pay = async () => {
    try { await api.post(`/admin/erp/paie/runs/${run.id}/pay`, { date: day }); toast('Salaires payés : écritures de trésorerie créées'); onDone(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Payer les salaires" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={pay}><Wallet />Enregistrer le paiement</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <ul className="list">{Object.entries(by).map(([k, v]) => <li key={k} className="list-row" style={{ padding: '8px 0' }}><span className="small">{LABEL[k] || k}</span><b className="tabular small">{fcfa(v)}</b></li>)}</ul>
        <Field label="Date du paiement"><input className="input" type="date" value={day} onChange={e => setDay(e.target.value)} /></Field>
        <p className="small muted">Une écriture par moyen de paiement (journal banque, caisse ou Mobile Money) solde le net à payer de chaque salarié (compte 422).</p>
      </div>
    </Modal>
  );
}

/** Bulletin de paie imprimable (ou enregistrable en PDF par le navigateur). */
function Payslip({ run, slip, onClose }) {
  const r = slip.result, e = slip.employee;
  const { meta } = usePaieMeta();
  useEffect(() => { document.body.classList.add('printing-slip'); return () => document.body.classList.remove('printing-slip'); }, []);
  return (
    <Modal title={`Bulletin de paie — ${e.name}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Fermer</button><button className="btn btn-primary" onClick={() => window.print()}><Printer />Imprimer / PDF</button></>}>
      <div className="payslip wide-form">
        <header className="payslip-head">
          <div><b>SIIPAF SA</b><div className="small muted">Promoteur & aménageur agréé MCLU — Abidjan</div></div>
          <div className="right"><b>Bulletin de paie · {periodLabel(run.period)}</b><div className="small muted">{RUN_STATUS[run.status].label}</div></div>
        </header>
        <div className="payslip-id small">
          <span><b>{e.name}</b> · {e.matricule}</span><span>{e.job_title} · {meta?.contract_types[e.contract_type] || e.contract_type}</span>
          <span>N° CNPS : {e.cnps_number || '—'}</span><span>Entrée : {date(e.hire_date)}</span><span>Parts fiscales : {r.parts}</span><span>Jours payés : {r.days_worked} / 30</span>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Rubrique</th><th className="right">Base</th><th className="right">Taux</th><th className="right">Gain</th><th className="right">Retenue</th></tr></thead>
          <tbody>
            {r.lines.filter(l => l.kind === 'gain').map(l => <tr key={l.label}><td className="small">{l.label}</td><td /><td /><td className="right tabular small">{amt(l.amount)}</td><td /></tr>)}
            <tr className="group-row"><td>Salaire brut</td><td /><td /><td className="right tabular">{amt(r.gross)}</td><td /></tr>
            <tr><td className="small">CNPS retraite (salarié)</td><td className="right tabular small">{amt(r.pension_base)}</td><td className="right small">{meta?.settings?.cnps_pension_employee ?? 6.3} %</td><td /><td className="right tabular small">{amt(r.cnps_employee)}</td></tr>
            <tr><td className="small">CMU (salarié · {r.cmu_persons} personne(s))</td><td /><td /><td /><td className="right tabular small">{amt(r.cmu_employee)}</td></tr>
            <tr><td className="small">ITS (brut {amt(r.its_gross, { zero: '0' })} − réduction familiale {amt(r.ricf, { zero: '0' })})</td><td className="right tabular small">{amt(r.its_base)}</td><td /><td /><td className="right tabular small">{amt(r.its)}</td></tr>
            {r.advance > 0 && <tr><td className="small">Avance sur salaire</td><td /><td /><td /><td className="right tabular small">{amt(r.advance)}</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3}><b>Net à payer</b> ({meta?.pay_methods?.[e.pay_method] || e.pay_method})</td><td colSpan={2} className="right tabular"><b>{fcfa(r.net)}</b></td></tr></tfoot>
        </table></div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Charges patronales : CNPS retraite {amt(r.employer.pension, { zero: '0' })} · prestations familiales {amt(r.employer.family, { zero: '0' })} · maternité {amt(r.employer.maternity, { zero: '0' })} · accident du travail {amt(r.employer.accident, { zero: '0' })} · CMU {amt(r.employer.cmu, { zero: '0' })} · contribution employeur {amt(r.employer.salary_tax, { zero: '0' })} · taxe d’apprentissage {amt(r.employer.apprenticeship, { zero: '0' })} · formation continue {amt(r.employer.training, { zero: '0' })}. Coût employeur : <b>{fcfa(r.employer_cost)}</b>.
        </p>
      </div>
    </Modal>
  );
}

/** Récapitulatifs à déclarer : CNPS (bases et cotisations par branche) et DGI (ITS, contribution employeur, FDFP). */
function Declarations({ run, onClose }) {
  const t = run.totals;
  const row = (l, v) => <tr key={l}><td className="small">{l}</td><td className="right tabular small">{fcfa(v)}</td></tr>;
  return (
    <Modal title={`Déclarations — ${periodLabel(run.period)}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Fermer</button>}>
      <div className="stack" style={{ gap: 14 }}>
        <div>
          <h3 className="erp-h3">CNPS (déclaration mensuelle)</h3>
          <div className="table-wrap"><table className="table"><tbody>
            {row('Base retraite (plafonnée)', t.pension_base)}{row('Retraite — part salariale', t.cnps_employee)}{row('Retraite — part patronale', t.pension_employer)}
            {row('Base prestations familiales, maternité, AT (plafonnée)', t.small_base)}{row('Prestations familiales', t.family)}{row('Assurance maternité', t.maternity)}{row('Accidents du travail', t.accident)}
            {row('CMU (salarié + employeur)', t.cmu_employee + t.cmu_employer)}
          </tbody><tfoot><tr><td><b>Total à reverser à la CNPS</b></td><td className="right tabular"><b>{fcfa(t.cnps_employee + t.cmu_employee + t.employer_social)}</b></td></tr></tfoot></table></div>
        </div>
        <div>
          <h3 className="erp-h3">DGI (impôts sur salaires)</h3>
          <div className="table-wrap"><table className="table"><tbody>
            {row('Brut imposable', t.taxable)}{row('ITS retenu à la source', t.its)}{row('Contribution employeur', t.salary_tax)}{row('Taxe d’apprentissage (FDFP)', t.apprenticeship)}{row('Formation professionnelle continue (FDFP)', t.training)}
          </tbody><tfoot><tr><td><b>Total à reverser</b></td><td className="right tabular"><b>{fcfa(t.its + t.employer_taxes)}</b></td></tr></tfoot></table></div>
        </div>
        <p className="small muted">Récapitulatifs d’aide à la déclaration : les formulaires officiels (e-CNPS, e-impôts) restent à remplir par le comptable.</p>
      </div>
    </Modal>
  );
}

/** Barème de paie modifiable (taux CNPS, ITS, taxes patronales) — valeurs par défaut à valider par le comptable. */
function Scale() {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const { meta, reload } = usePaieMeta();
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { if (meta?.settings) setS(structuredClone(meta.settings)); }, [meta]);
  if (!s) return <Skeleton h={400} />;
  const write = can('paie:prepare');
  const num = k => ({ value: s[k], onChange: e => setS(x => ({ ...x, [k]: e.target.value })) });
  const save = async e => {
    e.preventDefault(); setError(null);
    const body = { ...s };
    for (const k of Object.keys(body)) if (typeof meta.defaults[k] === 'number') body[k] = Number(body[k]);
    body.its_brackets = s.its_brackets.map(([c, r]) => [c === '' || c == null ? null : Number(c), Number(r)]);
    try { await api.put('/admin/erp/paie/settings', body); saved('Barème enregistré'); reload(); } catch (err) { setError(err); }
  };
  const F = (label, k, hint) => <Field label={label} hint={hint}><input className="input" type="number" step="any" min="0" {...num(k)} /></Field>;
  return (
    <form className="stack" onSubmit={save}>
      <ErrorBox error={error} />
      <div className="callout-erp small">
        Valeurs par défaut issues des barèmes publiés (CNPS au 1er janvier 2025, ITS unique depuis le 1er janvier 2024, FDFP). Certaines sources divergent : <b>faites valider chaque taux par le comptable</b> avant la première paie réelle.
      </div>
      <fieldset disabled={!write} className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="CNPS et CMU">
          <div className="form-grid">
            {F('SMIG mensuel (FCFA)', 'smig')}{F('Plafond retraite (FCFA)', 'cnps_pension_ceiling', '45 × SMIG')}
            {F('Retraite — salarié (%)', 'cnps_pension_employee')}{F('Retraite — employeur (%)', 'cnps_pension_employer')}
            {F('Prestations familiales (%)', 'family_rate')}{F('Assurance maternité (%)', 'maternity_rate')}
            {F('Accidents du travail (%)', 'accident_rate', 'Taux de l’entreprise ; modifiable par employé')}{F('Plafond PF, maternité, AT (FCFA)', 'small_ceiling')}
            {F('CMU — salarié (FCFA / personne)', 'cmu_employee')}{F('CMU — employeur (FCFA / personne)', 'cmu_employer')}
          </div>
          <label className="checkbox" style={{ marginTop: 12 }}><input type="checkbox" checked={!!s.cmu_family} onChange={e => setS(x => ({ ...x, cmu_family: e.target.checked }))} />CMU étendue au conjoint et à 6 enfants</label>
        </Card>
        <Card title="ITS et taxes patronales">
          <div className="stack" style={{ gap: 12 }}>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Jusqu’à (FCFA / mois)</th><th>Taux</th></tr></thead>
              <tbody>{s.its_brackets.map(([c, r], i) => (
                <tr key={i}>
                  <td><input className="input tabular" type="number" min="0" value={c ?? ''} placeholder={i === s.its_brackets.length - 1 ? 'au-delà' : ''} onChange={e => setS(x => ({ ...x, its_brackets: x.its_brackets.map((b, j) => (j === i ? [e.target.value, b[1]] : b)) }))} aria-label="Plafond de tranche" /></td>
                  <td style={{ width: 110 }}><input className="input tabular" type="number" min="0" max="100" step="0.5" value={r} onChange={e => setS(x => ({ ...x, its_brackets: x.its_brackets.map((b, j) => (j === i ? [b[0], e.target.value] : b)) }))} aria-label="Taux de la tranche" /></td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="form-grid">
              {F('Réduction par demi-part (FCFA)', 'ricf_per_half_part')}{F('Parts maximum', 'max_parts')}
              {F('Contribution employeur — nationaux (%)', 'employer_tax_local')}{F('Contribution employeur — expatriés (%)', 'employer_tax_expat')}
              {F('Taxe d’apprentissage (%)', 'apprenticeship_tax')}{F('Formation continue (%)', 'training_tax')}
              {F('Transport non imposable jusqu’à (FCFA)', 'transport_exempt_ceiling')}
            </div>
            <label className="checkbox"><input type="checkbox" checked={!!s.cnps_deductible_from_its} onChange={e => setS(x => ({ ...x, cnps_deductible_from_its: e.target.checked }))} />Déduire la CNPS salariale de la base de l’ITS</label>
          </div>
        </Card>
      </fieldset>
      {write && <div><button className="btn btn-primary">Enregistrer le barème</button></div>}
    </form>
  );
}
