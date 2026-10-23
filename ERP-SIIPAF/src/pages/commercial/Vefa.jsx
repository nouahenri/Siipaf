import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Landmark, Plus, Trash2, RotateCcw, CheckCircle2, ShieldCheck, AlertTriangle, HardHat } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { useCommercialMeta, CALL_STATUS, compact } from '../../lib/commercial';
import { SaleDrawer } from './Sales';

const TABS = [['appels', 'Appels de fonds'], ['avancement', 'Avancement & constat'], ['plan', 'Plan du programme']];

export default function Vefa() {
  const meta = useCommercialMeta();
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') || 'appels';
  const projectId = params.get('project_id') || '';
  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  useEffect(() => { if (!projectId && meta?.projects.length) set('project_id', String(meta.projects[0].id)); /* eslint-disable-next-line */ }, [meta, projectId]);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
          {TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => set('onglet', id)}>{l}</button>)}
        </div>
        <select className="select" style={{ width: 'auto' }} value={projectId} onChange={e => set('project_id', e.target.value)} aria-label="Programme">
          {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {projectId && tab === 'appels' && <Calls projectId={projectId} filter={params.get('filter') || ''} setFilter={v => set('filter', v)} />}
      {projectId && tab === 'avancement' && <Progress projectId={projectId} />}
      {projectId && tab === 'plan' && <Plan projectId={projectId} />}
    </div>
  );
}

function Calls({ projectId, filter, setFilter }) {
  const list = useResource(`/admin/erp/commercial/vefa/calls?project_id=${projectId}&filter=${filter}`);
  const [saleId, setSaleId] = useState(null);
  // Le dossier de vente s'ouvre avec les droits du Service commercial (le conducteur de travaux suit les appels sans eux)
  const { can } = useAuth();
  const canOpen = can('commercial:read') && can('sales:read');
  const rows = list.data || [];
  const FILTERS = [['', 'Tous'], ['appele', 'Émis, non soldés'], ['retard', 'En retard'], ['a_venir', 'À venir']];
  return (
    <>
      <div className="seg" role="group" aria-label="Filtre">
        {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? (
          <div className="card-body"><Empty icon={Landmark}>Aucun appel de fonds ici. Les dossiers ouverts en mode VEFA apparaissent dans cette liste.</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Client · lot</th><th>Étape</th><th className="right">Montant</th><th>Émis le</th><th>Échéance</th><th>État</th></tr></thead>
            <tbody>
              {rows.map(c => {
                const st = c.payment_status ? CALL_STATUS[c.payment_status] : null;
                return (
                  <tr key={c.id} className={canOpen ? 'clickable' : undefined} onClick={canOpen ? () => setSaleId(c.sale_id) : undefined}>
                    <td><b>{c.client_name}</b><div className="small muted">{c.ilot ? `îlot ${c.ilot} · ` : ''}lot {c.lot_code}</div></td>
                    <td className="small">{c.label} <span className="muted">· {c.pct} %</span></td>
                    <td className="right tabular small">{fcfa(c.amount_fcfa)}</td>
                    <td className="small">{c.called_at ? date(c.called_at) : '—'}</td>
                    <td className="small">{c.due_date ? date(c.due_date) : '—'}</td>
                    <td>{st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>Étape non atteinte</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>
      {saleId && <SaleDrawer id={saleId} onClose={() => setSaleId(null)} onChange={() => list.reload()} />}
    </>
  );
}

function Progress({ projectId }) {
  const { can } = useAuth();
  const toast = useToast();
  const meta = useCommercialMeta();
  const progress = useResource(`/admin/erp/commercial/vefa/progress?project_id=${projectId}`);
  const property = useResource(`/admin/erp/commercial/property?project_id=${projectId}`);
  const [f, setF] = useState({ scope: 'projet', ilot: '', building_id: '', stage: 'fondations', date: new Date().toISOString().slice(0, 10) });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const label = s => meta?.site_stages.find(x => x.id === s)?.label || '—';
  const p = progress.data;

  const record = async e => {
    e.preventDefault(); setError(null); setResult(null);
    if (!window.confirm(`Constater l’achèvement de « ${label(f.stage)} » ? Les appels de fonds correspondants seront émis et les clients prévenus dans leur espace.`)) return;
    try {
      const out = await api.post('/admin/erp/commercial/vefa/milestones', {
        project_id: Number(projectId), stage: f.stage, date: f.date,
        ...(f.scope === 'ilot' ? { ilot: f.ilot } : f.scope === 'batiment' ? { building_id: Number(f.building_id) } : {}),
      });
      setResult(out); toast(out.calls ? `${out.calls} appel(s) de fonds émis` : 'Aucun nouvel appel à émettre');
    } catch (err) { setError(err); }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Avancement déclaré au journal de chantier">
        {!p ? <Skeleton h={160} /> : (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row-between"><b>Tout le programme</b><Badge>{label(p.project)}</Badge></div>
            {p.ilots.map(i => <div key={i.ilot} className="row-between small"><span>Îlot {i.ilot}</span><span className="muted">{i.stage ? label(i.stage) : '—'}</span></div>)}
            <p className="small muted" style={{ marginTop: 6 }}>
              <HardHat className="ico" aria-hidden="true" />Chaque point publié dans le suivi de chantier déclenche automatiquement les appels des étapes achevées
              (une étape est réputée achevée quand le chantier est passé à la suivante).
            </p>
          </div>
        )}
      </Card>
      {can('vefa:write') && (
        <Card title="Constater l’achèvement d’une étape">
          <form className="stack" style={{ gap: 12 }} onSubmit={record}>
            <ErrorBox error={error} />
            <p className="small muted">Sur attestation de l’architecte ou du maître d’œuvre : l’étape choisie et les précédentes sont appelées pour les dossiers VEFA concernés.</p>
            <div className="form-grid">
              <Field label="Portée">
                <select className="select" value={f.scope} onChange={e => setF(x => ({ ...x, scope: e.target.value }))}>
                  <option value="projet">Tout le programme</option>
                  <option value="ilot">Un îlot</option>
                  {property.data?.buildings.length > 0 && <option value="batiment">Un bâtiment</option>}
                </select>
              </Field>
              {f.scope === 'ilot' && (
                <Field label="Îlot">
                  <select className="select" required value={f.ilot} onChange={e => setF(x => ({ ...x, ilot: e.target.value }))}>
                    <option value="">—</option>
                    {p?.ilots.map(i => <option key={i.ilot} value={i.ilot}>Îlot {i.ilot}</option>)}
                  </select>
                </Field>
              )}
              {f.scope === 'batiment' && (
                <Field label="Bâtiment">
                  <select className="select" required value={f.building_id} onChange={e => setF(x => ({ ...x, building_id: e.target.value }))}>
                    <option value="">—</option>
                    {property.data.buildings.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Étape achevée">
                <select className="select" value={f.stage} onChange={e => setF(x => ({ ...x, stage: e.target.value }))}>
                  {meta?.site_stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Date du constat"><input className="input" type="date" required value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></Field>
            </div>
            <div><button className="btn btn-primary"><CheckCircle2 />Constater et émettre les appels</button></div>
            {result && <div className="erp-panel small">{result.sales} dossier(s) VEFA concerné(s) · {result.calls} appel(s) émis · {fcfa(result.amount_fcfa)}</div>}
          </form>
        </Card>
      )}
    </div>
  );
}

function Plan({ projectId }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const meta = useCommercialMeta();
  const plan = useResource(`/admin/erp/commercial/vefa/plans/${projectId}`);
  const [rows, setRows] = useState(null);
  const [due, setDue] = useState(15);
  const [error, setError] = useState(null);
  const write = can('vefa:write');
  useEffect(() => { if (plan.data) { setRows(plan.data.milestones.map(m => ({ ...m }))); setDue(plan.data.due_days); } }, [plan.data]);

  // Contrôle en direct des plafonds légaux (art. 124) sur le cumul
  const checks = useMemo(() => {
    if (!rows || !meta) return [];
    const order = s => (s === 'signature' ? -1 : meta.site_stages.findIndex(x => x.id === s));
    let cumul = 0;
    return rows.map(r => {
      cumul += Number(r.pct) || 0;
      const cap = meta.vefa_caps.find(c => order(r.stage) <= order(c.upTo));
      return { cumul, cap, over: cap && cumul > cap.pct };
    });
  }, [rows, meta]);
  if (!rows || !meta) return <Skeleton h={260} />;
  const total = checks.length ? checks[checks.length - 1].cumul : 0;
  const setRow = (i, k, v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const save = async () => {
    setError(null);
    try {
      await api.put(`/admin/erp/commercial/vefa/plans/${projectId}`, { milestones: rows.map(r => ({ stage: r.stage, label: r.label, pct: Number(r.pct) })), due_days: Number(due) });
      saved('Plan d’appels de fonds enregistré'); plan.reload();
    } catch (e) { setError(e); }
  };

  return (
    <Card title="Plan d’appels de fonds" actions={!plan.data.custom && <Badge>Plan par défaut</Badge>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="callout-erp">
          <ShieldCheck aria-hidden="true" />
          <span className="small">
            Code de la construction et de l’habitat (loi n° 2019-576) : aucun versement avant la signature de l’acte (art. 121, hors dépôt de garantie de réservation),
            puis au plus <b>20 %</b> du prix à l’achèvement des fondations, <b>60 %</b> à la mise hors d’eau, <b>90 %</b> à l’achèvement des travaux ; le solde à la remise des clés (art. 124).
          </span>
        </div>
        <ErrorBox error={error} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Étape du chantier</th><th>Libellé de l’appel</th><th className="right">Appel</th><th className="right">Cumul</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ minWidth: 190 }}>
                  <select className="select" disabled={!write} value={r.stage} onChange={e => setRow(i, 'stage', e.target.value)}>
                    <option value="signature">Signature de l’acte</option>
                    {meta.site_stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </td>
                <td style={{ minWidth: 220 }}><input className="input" disabled={!write} value={r.label} onChange={e => setRow(i, 'label', e.target.value)} /></td>
                <td className="right" style={{ width: 110 }}><input className="input right" disabled={!write} type="number" min="1" max="100" step="0.5" value={r.pct} onChange={e => setRow(i, 'pct', e.target.value)} aria-label="Pourcentage" /></td>
                <td className="right tabular nowrap" style={{ color: checks[i].over ? 'var(--danger)' : undefined }}>
                  {checks[i].cumul} %{checks[i].cap && <div className="small muted">max {checks[i].cap.pct} %</div>}
                  {checks[i].over && <AlertTriangle className="ico" aria-label="Plafond légal dépassé" />}
                </td>
                <td>{write && rows.length > 1 && <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label="Retirer l’étape"><Trash2 /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={2} className="right small"><b>Total</b></td><td /><td className="right tabular" style={{ color: total === 100 ? 'var(--ok)' : 'var(--danger)' }}><b>{total} %</b></td><td /></tr></tfoot>
        </table></div>
        <div className="row-between">
          <span className="row" style={{ gap: 8 }}>
            {write && <button className="btn btn-sm" onClick={() => setRows(rs => [...rs.slice(0, -1), { stage: 'second_oeuvre', label: 'Second œuvre', pct: 5 }, rs[rs.length - 1]])}><Plus />Étape</button>}
            {write && <button className="btn btn-sm btn-ghost" onClick={() => setRows(meta.vefa_default.map(m => ({ ...m })))}><RotateCcw />Plan par défaut</button>}
          </span>
          <span className="row" style={{ gap: 8 }}>
            <label className="small row" style={{ gap: 6 }}>Délai de paiement
              <input className="input" style={{ width: 72 }} disabled={!write} type="number" min="0" max="120" value={due} onChange={e => setDue(e.target.value)} aria-label="Délai de paiement en jours" /> jours
            </label>
            {write && <button className="btn btn-primary" onClick={save} disabled={total !== 100 || checks.some(c => c.over)}>Enregistrer</button>}
          </span>
        </div>
        <p className="small muted">Exemple pour un prix de 30 M FCFA : {rows.map(r => `${r.label} ${compact((30e6 * (Number(r.pct) || 0)) / 100)}`).join(' · ')}. Le plan s’applique aux dossiers ouverts ensuite ; les dossiers existants gardent leurs appels.</p>
      </div>
    </Card>
  );
}
