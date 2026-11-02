/**
 * Chantiers › Déboursé sec (cadrage docs/cadrage-debourse-sec.md, choix du client du 02/11/2026) : estimation du coût du gros
 * œuvre d'un bâtiment type (villa, duplex, immeuble) depuis quelques paramètres, quantités modifiables (métré), prix figés au
 * calcul, matériaux à approvisionner, coût de revient (frais de chantier, aléas) et report au budget d'un chantier.
 * Référentiels (ressources, ouvrages, modèles) : Chantiers › Réglages (DebourseSettings).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Calculator, ArrowLeft, RefreshCw, Printer, Trash2, Wallet, Check, Pencil, TriangleAlert, Save, X } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Modal, Badge } from '@admin/components/ui';
import { date, fcfa, num } from '@admin/lib/format';
import { CH } from '../../lib/chantiers';

export const DS = `${CH}/debourse`;
const qty = n => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
const unitLabel = (refs, code) => refs?.units.find(u => u.code === code)?.label || code;
const NATURE_TONES = { materiau: 'brand', main_oeuvre: 'ok', materiel: '' };

/** Champs des paramètres d'un bâtiment (définis côté serveur : lib/debourse PARAMS). */
function ParamsFields({ defs, value, onChange, disabled }) {
  return Object.entries(defs).map(([k, d]) => (
    <Field key={k} label={`${d.label}${d.unit ? ` (${d.unit})` : ''}`}>
      <input className="input" type="number" step={d.integer ? 1 : 'any'} min={d.min} max={d.max} required={k !== 'logements'} disabled={disabled}
        value={value[k] ?? ''} onChange={e => onChange({ ...value, [k]: e.target.value === '' ? '' : Number(e.target.value) })} />
    </Field>
  ));
}

// ─── Liste des estimations (onglet de Chantiers › Liste) ──────────────────

export function EstimatesTab() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useResource(`${DS}/estimations`);
  const [creating, setCreating] = useState(false);
  return (
    <div className="stack">
      <div className="callout-erp"><Calculator /><span className="small">
        <b>Déboursé sec</b> : coût direct du gros œuvre (matériaux, main-d’œuvre, matériel) calculé depuis un modèle de bâtiment et quelques paramètres ;
        chaque quantité reste modifiable (métré réel). Le coût de revient ajoute les frais de chantier et les aléas. Prix, ouvrages et modèles : Chantiers › Réglages.
      </span></div>
      <Card title="Estimations" actions={can('chantiers:estimate') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouvelle estimation</button>} bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={160} /></div> : !list.data.length ? <div className="card-body"><Empty icon={Calculator}>Aucune estimation.{can('chantiers:estimate') ? ' Créez la première avec « Nouvelle estimation ».' : ''}</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Estimation</th><th>Modèle · bâtiments</th><th>Programme ou chantier</th><th className="right">Déboursé sec</th><th className="right">Coût de revient</th><th className="right">Au m²</th><th>Budget</th></tr></thead>
            <tbody>{list.data.map(e => (
              <tr key={e.id} className="clickable" onClick={() => navigate(`/chantiers/estimations/${e.id}`)}>
                <td><b>{e.label}</b><div className="small muted tabular">{e.reference} · prix du {date(e.priced_at)}{e.unchecked_prices && <> · <Badge tone="warn">prix à vérifier</Badge></>}</div></td>
                <td className="small">{e.model_label || '—'}<div className="muted">{e.units} bâtiment{e.units > 1 ? 's' : ''}{e.property_type_label ? ` · ${e.property_type_label}` : ''}</div></td>
                <td className="small">{e.worksite_label || e.project_name || <span className="muted">—</span>}</td>
                <td className="right tabular small">{fcfa(e.dry_cost)}</td>
                <td className="right tabular small"><b>{fcfa(e.cost_price)}</b></td>
                <td className="right tabular small">{fcfa(e.per_m2)}</td>
                <td className="small">{e.budget_worksite_reference ? <Badge tone="ok">{e.budget_worksite_reference}</Badge> : <span className="muted">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {creating && <NewEstimate onClose={() => setCreating(false)} onCreated={e => navigate(`/chantiers/estimations/${e.id}`)} />}
    </div>
  );
}

/** Nouvelle estimation : modèle, paramètres préremplis, aperçu du résultat pendant la saisie. */
function NewEstimate({ onClose, onCreated }) {
  const refs = useResource(`${DS}/refs`).data;
  const places = useResource(`${CH}/lieux`).data;
  const [f, setF] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const models = (refs?.models || []).filter(m => m.active);
  const pick = m => setF(x => ({ ...(x || {}), model_id: m.id, label: m.label, params: { ...m.params }, with_roof: m.with_roof, units: x?.units || 1, place: x?.place || '' }));
  useEffect(() => { if (models.length && !f) pick(models[0]); }, [models.length]);
  // Aperçu recalculé une demi-seconde après la dernière saisie
  useEffect(() => {
    if (!f) return undefined;
    const t = setTimeout(() => {
      api.post(`${DS}/apercu`, { model_id: f.model_id, params: f.params, units: Number(f.units) || 1, with_roof: f.with_roof })
        .then(p => { setPreview(p); setError(null); }).catch(err => { setPreview(null); setError(err); });
    }, 500);
    return () => clearTimeout(t);
  }, [f?.model_id, JSON.stringify(f?.params), f?.units, f?.with_roof]);
  const model = models.find(m => m.id === f?.model_id);
  const save = async e => {
    e.preventDefault(); setBusy(true);
    const [kind, id] = (f.place || '').split(':');
    try {
      onCreated(await api.post(`${DS}/estimations`, { model_id: f.model_id, label: f.label, params: f.params, units: Number(f.units) || 1, with_roof: f.with_roof, ...(kind === 'w' ? { worksite_id: Number(id) } : kind === 'p' ? { project_id: Number(id) } : {}) }));
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title="Nouvelle estimation du déboursé sec" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="est-form" disabled={busy || !f}><Check />Créer l’estimation</button></>}>
      {!refs || !f ? <Skeleton h={240} /> : !models.length ? <Empty>Aucun modèle de bâtiment actif : créez-en un dans Chantiers › Réglages.</Empty> : (
        <form id="est-form" className="form-grid" onSubmit={save}>
          <div className="full"><ErrorBox error={error} /></div>
          <Field label="Modèle de bâtiment" hint={model?.description || undefined} className="full">
            <select className="select" value={f.model_id} onChange={e => pick(models.find(m => m.id === Number(e.target.value)))}>{models.map(m => <option key={m.id} value={m.id}>{m.label}{m.property_type_label && m.property_type_label !== m.label ? ` (${m.property_type_label})` : ''}</option>)}</select>
          </Field>
          <Field label="Intitulé" className="full"><input className="input" required minLength={2} maxLength={200} value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} /></Field>
          <Field label="Programme ou chantier" hint="Facultatif : une estimation peut précéder le chantier">
            <select className="select" value={f.place} onChange={e => setF(x => ({ ...x, place: e.target.value }))}>
              <option value="">— Aucun —</option>
              {places?.map(p => <optgroup key={p.id} label={p.name}><option value={`p:${p.id}`}>{p.name} (programme)</option>{p.worksites.map(w => <option key={w.id} value={`w:${w.id}`}>{w.reference} — {w.name}</option>)}</optgroup>)}
            </select>
          </Field>
          <Field label="Bâtiments identiques" hint="Le coût d’un bâtiment est multiplié par ce nombre"><input className="input" type="number" min={1} max={500} required value={f.units} onChange={e => setF(x => ({ ...x, units: e.target.value }))} /></Field>
          <ParamsFields defs={refs.params} value={f.params} onChange={params => setF(x => ({ ...x, params }))} />
          <label className="checkbox full"><input type="checkbox" checked={f.with_roof} onChange={e => setF(x => ({ ...x, with_roof: e.target.checked }))} />Compter la toiture (charpente-couverture ou étanchéité, selon le modèle)</label>
          <div className="full">{preview ? <PreviewBox e={preview} refs={refs} /> : <Skeleton h={60} />}</div>
        </form>
      )}
    </Modal>
  );
}

function PreviewBox({ e, refs }) {
  return (
    <div className="callout-erp" style={{ display: 'block' }}>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <span>Déboursé sec <b className="tabular">{fcfa(e.dry_cost)}</b></span>
        <span>Coût de revient <b className="tabular">{fcfa(e.cost_price)}</b></span>
        <span>Au m² <b className="tabular">{fcfa(e.per_m2)}</b></span>
        {e.calc.housing > e.calc.units && <span>Par logement <b className="tabular">{fcfa(e.per_housing)}</b></span>}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>{e.calc.resources.filter(r => r.nature === 'materiau').slice(0, 5).map(r => `${r.label} : ${qty(r.quantity)} ${unitLabel(refs, r.unit).toLowerCase()}`).join(' · ')}</div>
    </div>
  );
}

// ─── Fiche d'une estimation (/chantiers/estimations/:id) ──────────────────

export function EstimatePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const saved = useSaved();
  const est = useResource(`${DS}/estimations/${id}`);
  const refs = useResource(`${DS}/refs`).data;
  const [params, setParams] = useState(null);
  const [edits, setEdits] = useState({});
  const [adding, setAdding] = useState({ work_id: '', quantity: '' });
  const [budget, setBudget] = useState(false);
  const [busy, setBusy] = useState(false);
  const write = can('chantiers:estimate');
  const e = est.data;
  useEffect(() => { if (e) { setParams({ ...e.params }); setEdits({}); } }, [e?.updated_at, e?.priced_at]);
  const patch = async (body, msg) => {
    setBusy(true);
    try { est.setData(await api.patch(`${DS}/estimations/${id}`, body)); if (msg) saved(msg); } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  const lots = useMemo(() => (refs ? Object.entries(refs.lots).sort((a, b) => a[1].sort - b[1].sort) : []), [refs]);
  if (est.error) return <ErrorBox error={est.error} />;
  if (!e || !refs || !params) return <Skeleton h={300} />;
  const calc = e.calc;
  const dirtyQty = Object.keys(edits).length > 0;
  const dirtyParams = JSON.stringify(params) !== JSON.stringify(e.params);
  const reprice = async () => {
    if (!window.confirm('Recalculer cette estimation aux prix actuels du référentiel ? Les quantités ne changent pas.')) return;
    setBusy(true);
    try { est.setData(await api.post(`${DS}/estimations/${id}/prix`)); saved('Estimation recalculée aux prix actuels'); } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Supprimer l’estimation ${e.reference} ? Les lignes déjà reportées au budget d’un chantier restent.`)) return;
    try { await api.del(`${DS}/estimations/${id}`); navigate('/chantiers/liste?onglet=debourse'); } catch (err) { toast(err.message, 'err'); }
  };
  return (
    <div className="stack">
      <div className="row-between">
        <Link to="/chantiers/liste?onglet=debourse" className="btn btn-ghost btn-sm"><ArrowLeft />Estimations</Link>
        <div className="row" style={{ gap: 8 }}>
          {write && <button className="btn btn-sm" disabled={busy} onClick={reprice}><RefreshCw />Recalculer aux prix actuels</button>}
          {write && <button className="btn btn-sm" onClick={() => setBudget(true)}><Wallet />Reporter au budget d’un chantier</button>}
          <button className="btn btn-sm" onClick={() => window.print()}><Printer />Imprimer</button>
          {write && <button className="btn btn-ghost btn-sm" onClick={remove} aria-label="Supprimer l’estimation"><Trash2 /></button>}
        </div>
      </div>
      <div>
        <h2 style={{ margin: 0 }}>{e.label}</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {e.reference} · {e.model_label || 'modèle supprimé'}{e.property_type_label && e.property_type_label !== e.model_label ? ` · ${e.property_type_label}` : ''} · {e.units} bâtiment{e.units > 1 ? 's' : ''} identique{e.units > 1 ? 's' : ''}
          {(e.worksite_label || e.project_name) && ` · ${e.worksite_label || e.project_name}`} · prix du {date(e.priced_at)}
          {e.budget_worksite_reference && <> · <Badge tone="ok">reporté au budget de {e.budget_worksite_reference} le {date(e.budget_at)}</Badge></>}
        </p>
      </div>
      {e.unchecked_prices && <div className="callout-erp"><TriangleAlert /><span className="small">Certains prix sont <b>indicatifs, à vérifier</b> (Chantiers › Réglages › Ressources) : le résultat est un ordre de grandeur tant qu’ils ne sont pas confirmés.</span></div>}

      <div className="grid grid-4">
        <div className="card kpi"><span className="kpi-label">Déboursé sec</span><span className="kpi-value" style={{ fontSize: 22 }}>{fcfa(e.dry_cost)}</span><span className="kpi-foot">{fcfa(calc.per_m2)} / m²</span></div>
        <div className="card kpi"><span className="kpi-label">Frais de chantier ({num(e.site_pct)} %)</span><span className="kpi-value" style={{ fontSize: 22 }}>{fcfa(calc.site_costs)}</span><span className="kpi-foot">Aléas ({num(e.contingency_pct)} %) : {fcfa(calc.contingency)}</span></div>
        <div className="card kpi"><span className="kpi-label">Coût de revient estimatif</span><span className="kpi-value" style={{ fontSize: 22 }}>{fcfa(e.cost_price)}</span><span className="kpi-foot">{fcfa(calc.cost_price_per_m2)} / m²</span></div>
        <div className="card kpi"><span className="kpi-label">{calc.housing > calc.units ? 'Par logement' : 'Par bâtiment'}</span><span className="kpi-value" style={{ fontSize: 22 }}>{fcfa(calc.housing > calc.units ? e.per_housing : Math.round(e.cost_price / e.units))}</span><span className="kpi-foot">Matériaux {fcfa(calc.natures.materiau)} · main-d’œuvre {fcfa(calc.natures.main_oeuvre)} · matériel {fcfa(calc.natures.materiel)}</span></div>
      </div>

      <Card key={e.updated_at} title="Paramètres du bâtiment" actions={write && dirtyParams && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => patch({ params }, 'Paramètres enregistrés : quantités recalculées (métrés saisis gardés)')}><Save />Recalculer les quantités</button>}>
        <div className="form-grid">
          <ParamsFields defs={refs.params} value={params} onChange={setParams} disabled={!write} />
          <Field label="Bâtiments identiques"><input className="input" type="number" min={1} max={500} disabled={!write} defaultValue={e.units} onBlur={ev => Number(ev.target.value) !== e.units && Number(ev.target.value) >= 1 && patch({ units: Number(ev.target.value) }, 'Nombre de bâtiments enregistré')} /></Field>
          <Field label="Frais de chantier (%)"><input className="input" type="number" min={0} max={30} step="0.5" disabled={!write} defaultValue={e.site_pct} onBlur={ev => Number(ev.target.value) !== e.site_pct && patch({ site_pct: Number(ev.target.value) }, 'Taux enregistré')} /></Field>
          <Field label="Aléas (%)"><input className="input" type="number" min={0} max={30} step="0.5" disabled={!write} defaultValue={e.contingency_pct} onBlur={ev => Number(ev.target.value) !== e.contingency_pct && patch({ contingency_pct: Number(ev.target.value) }, 'Taux enregistré')} /></Field>
          <label className="checkbox full"><input type="checkbox" disabled={!write || busy} checked={e.with_roof} onChange={ev => patch({ with_roof: ev.target.checked }, ev.target.checked ? 'Toiture comptée' : 'Toiture retirée')} />Compter la toiture (lot facultatif)</label>
        </div>
      </Card>

      <Card title="Ouvrages par lot" actions={write && dirtyQty && <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setEdits({})}><X />Annuler</button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => patch({ quantities: Object.entries(edits).map(([key, v]) => ({ key, quantity: v === '' ? null : Number(v) })) }, 'Quantités enregistrées')}><Save />Enregistrer les quantités</button>
      </div>} bodyClass="">
        <p className="card-body small muted" style={{ borderBottom: '1px solid var(--border)', margin: 0 }}>La quantité calculée vient du modèle (ratio × paramètre). Saisissez le métré réel pour la remplacer ; videz le champ pour revenir au calcul.</p>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Ouvrage</th><th className="right">Calculée</th><th className="right" style={{ width: 130 }}>Retenue</th><th>Unité</th><th className="right">Coût unitaire sec</th><th className="right">Montant</th>{write && <th />}</tr></thead>
          <tbody>{lots.map(([lot, d]) => {
            const rows = e.lines.filter(l => l.lot === lot);
            if (!rows.length) return null;
            const off = d.optional && !e.with_roof;
            const total = calc.lots.find(x => x.lot === lot)?.total;
            return [
              <tr key={lot} style={{ background: 'var(--surface-2)' }}><td colSpan={5}><b>{d.label}</b>{off && <span className="small muted"> · non compté (toiture décochée)</span>}</td><td className="right tabular"><b>{off ? '—' : fcfa(total)}</b></td>{write && <td />}</tr>,
              ...rows.map(l => (
                <tr key={l.key} style={off ? { opacity: 0.5 } : undefined}>
                  <td className="small">{l.label}<div className="muted">{l.base ? `${num(l.ratio)} × ${refs.bases[l.base]?.label.toLowerCase()}` : 'ouvrage ajouté (métré)'}</div></td>
                  <td className="right tabular small">{l.base ? qty(l.auto_quantity) : '—'}</td>
                  <td className="right">{write
                    ? <input className="input tabular" style={{ textAlign: 'right', minWidth: 96, fontWeight: l.quantity != null ? 600 : 400 }} type="number" step="any" min={0} aria-label={`Quantité retenue : ${l.label}`}
                        placeholder={qty(l.auto_quantity)} value={edits[l.key] ?? (l.quantity ?? '')} onChange={ev => setEdits(x => ({ ...x, [l.key]: ev.target.value }))} />
                    : <span className="tabular small">{qty(l.quantity ?? l.auto_quantity)}</span>}</td>
                  <td className="small">{unitLabel(refs, l.unit)}</td>
                  <td className="right tabular small">{fcfa(l.unit_cost)}</td>
                  <td className="right tabular small">{off ? '—' : fcfa(l.total)}</td>
                  {write && <td className="right"><button className="btn btn-ghost btn-icon btn-sm" disabled={busy} onClick={() => window.confirm(`Retirer « ${l.label} » de l’estimation ?`) && patch({ remove: [l.key] }, 'Ouvrage retiré')} aria-label={`Retirer ${l.label}`}><Trash2 /></button></td>}
                </tr>
              )),
            ];
          })}</tbody>
        </table></div>
        {write && (
          <form className="card-body row" style={{ gap: 8, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }} onSubmit={ev => { ev.preventDefault(); patch({ add: [{ work_id: Number(adding.work_id), quantity: Number(adding.quantity) }] }, 'Ouvrage ajouté').then(() => setAdding({ work_id: '', quantity: '' })); }}>
            <select className="select" style={{ flex: 1, minWidth: 220 }} required value={adding.work_id} onChange={ev => setAdding(x => ({ ...x, work_id: ev.target.value }))} aria-label="Ouvrage à ajouter">
              <option value="">Ajouter un ouvrage du référentiel…</option>
              {lots.map(([lot, d]) => <optgroup key={lot} label={d.label}>{refs.works.filter(w => w.lot === lot && w.active).map(w => <option key={w.id} value={w.id}>{w.label} ({unitLabel(refs, w.unit)})</option>)}</optgroup>)}
            </select>
            <input className="input" style={{ width: 140 }} type="number" step="any" min={0} required placeholder="Quantité" value={adding.quantity} onChange={ev => setAdding(x => ({ ...x, quantity: ev.target.value }))} aria-label="Quantité de l’ouvrage ajouté" />
            <button className="btn btn-sm" disabled={busy}><Plus />Ajouter</button>
          </form>
        )}
      </Card>

      <Card title="Matériaux, main-d’œuvre et matériel à prévoir" bodyClass="">
        <p className="card-body small muted" style={{ borderBottom: '1px solid var(--border)', margin: 0 }}>Totaux pour {e.units} bâtiment{e.units > 1 ? 's' : ''}, pertes comprises pour les matériaux ; prix figés le {date(e.priced_at)}.</p>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Ressource</th><th>Nature</th><th className="right">Quantité</th><th>Unité</th><th className="right">Prix unitaire</th><th className="right">Montant</th></tr></thead>
          <tbody>{calc.resources.map(r => (
            <tr key={r.code}>
              <td className="small">{r.label}<div className="muted tabular">{r.code}</div></td>
              <td><Badge tone={NATURE_TONES[r.nature]}>{refs.natures[r.nature]?.label}</Badge></td>
              <td className="right tabular"><b>{qty(r.quantity)}</b></td>
              <td className="small">{unitLabel(refs, r.unit)}</td>
              <td className="right tabular small">{fcfa(r.unit_price)}</td>
              <td className="right tabular small">{fcfa(r.amount)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      {budget && <BudgetModal est={e} onClose={() => setBudget(false)} onDone={() => { setBudget(false); est.reload(); }} />}
    </div>
  );
}

/** Report au budget prévu d'un chantier : une ligne par poste ; un nouveau report remplace le précédent de cette estimation. */
function BudgetModal({ est, onClose, onDone }) {
  const saved = useSaved();
  const places = useResource(`${CH}/lieux`).data;
  const [worksite, setWorksite] = useState(est.worksite_id || est.budget_worksite_id || '');
  const [withCosts, setWithCosts] = useState(true);
  const [error, setError] = useState(null);
  const lines = [['Matériaux', est.calc.natures.materiau], ['Main-d’œuvre', est.calc.natures.main_oeuvre], ['Engins et matériel', est.calc.natures.materiel], ...(withCosts ? [['Frais de chantier', est.calc.site_costs], ['Frais de chantier (aléas)', est.calc.contingency]] : [])].filter(([, v]) => v > 0);
  const send = async () => {
    setError(null);
    try { const r = await api.post(`${DS}/estimations/${est.id}/budget`, { worksite_id: Number(worksite), with_costs: withCosts }); saved(`${r.lines} ligne(s) reportée(s) au budget : ${fcfa(r.total)}`); onDone(); } catch (err) { setError(err); }
  };
  return (
    <Modal title={`Reporter ${est.reference} au budget d’un chantier`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!worksite} onClick={send}><Wallet />Reporter</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <ErrorBox error={error} />
        <Field label="Chantier">
          <select className="select" value={worksite} onChange={ev => setWorksite(ev.target.value)}>
            <option value="">— Choisir —</option>
            {places?.map(p => p.worksites.length > 0 && <optgroup key={p.id} label={p.name}>{p.worksites.map(w => <option key={w.id} value={w.id}>{w.reference} — {w.name}</option>)}</optgroup>)}
          </select>
        </Field>
        <label className="checkbox"><input type="checkbox" checked={withCosts} onChange={ev => setWithCosts(ev.target.checked)} />Ajouter les frais de chantier et les aléas (coût de revient)</label>
        <ul className="list">{lines.map(([l, v]) => <li key={l} className="list-row"><span className="small">{l}</span><b className="tabular small">{fcfa(v)}</b></li>)}</ul>
        <p className="small muted" style={{ margin: 0 }}>Les lignes déjà reportées depuis cette estimation sur ce chantier sont remplacées ; les autres lignes du budget ne changent pas.</p>
      </div>
    </Modal>
  );
}

// ─── Référentiels (Chantiers › Réglages) ──────────────────────────────────

export function DebourseSettings() {
  const { can } = useAuth();
  const write = can('chantiers:settings');
  const refs = useResource(`${DS}/refs`);
  if (refs.error) return <ErrorBox error={refs.error} />;
  if (!refs.data) return <Skeleton h={200} />;
  const set = patch => refs.setData(d => ({ ...d, ...patch }));
  return (
    <div className="stack" id="debourse-sec">
      <h2 style={{ margin: '12px 0 0' }}>Déboursé sec</h2>
      <p className="small muted" style={{ margin: 0 }}>Prix des ressources, composition des ouvrages (sous-détail par unité) et modèles de bâtiment (ratios) utilisés par les estimations. Une estimation garde les prix du jour de son calcul. Taux par défaut des frais de chantier et des aléas : réglages ci-dessus.</p>
      <Resources refs={refs.data} write={write} onList={resources => set({ resources })} />
      <Works refs={refs.data} write={write} onList={works => set({ works })} />
      <Models refs={refs.data} write={write} onList={models => set({ models })} />
    </div>
  );
}

function Resources({ refs, write, onList }) {
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const remove = async r => {
    if (!window.confirm(`Supprimer la ressource « ${r.label} » ?`)) return;
    try { onList(await api.del(`${DS}/ressources/${r.id}`)); } catch (err) { toast(err.message, 'err'); }
  };
  const unchecked = refs.resources.filter(r => !r.price_checked).length;
  return (
    <Card title={`Ressources et prix (${refs.resources.length})`} actions={write && <button className="btn btn-primary btn-sm" onClick={() => setEdit({})}><Plus />Ressource</button>} bodyClass="">
      {unchecked > 0 && <p className="card-body small" style={{ margin: 0, borderBottom: '1px solid var(--border)', color: 'var(--warn)' }}>{unchecked} prix indicatif{unchecked > 1 ? 's' : ''} à vérifier : ouvrez la ressource, ajustez le prix au marché et cochez « Prix vérifié ».</p>}
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Ressource</th><th>Nature</th><th>Unité</th><th className="right">Prix unitaire</th><th className="right">Perte</th><th>Dernier achat</th>{write && <th />}</tr></thead>
        <tbody>{refs.resources.map(r => (
          <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
            <td className="small"><b>{r.label}</b><div className="muted tabular">{r.code}{!r.active && ' · désactivée'}</div></td>
            <td><Badge tone={NATURE_TONES[r.nature]}>{refs.natures[r.nature]?.label}</Badge></td>
            <td className="small">{unitLabel(refs, r.unit)}</td>
            <td className="right tabular small">{fcfa(r.unit_price)}{!r.price_checked && <div><Badge tone="warn">à vérifier</Badge></div>}</td>
            <td className="right tabular small">{r.nature === 'materiau' ? `${num(r.loss_pct)} %` : '—'}</td>
            <td className="small">{r.last_purchase ? <>{fcfa(r.last_purchase.price)}<div className="muted">{r.last_purchase.reference}</div></> : <span className="muted">{r.article_id ? 'aucun achat' : '—'}</span>}</td>
            {write && <td className="right nowrap"><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEdit(r)} aria-label={`Modifier ${r.label}`}><Pencil /></button><button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(r)} aria-label={`Supprimer ${r.label}`}><Trash2 /></button></td>}
          </tr>
        ))}</tbody>
      </table></div>
      {edit && <ResourceForm r={edit.id ? edit : null} refs={refs} onClose={() => setEdit(null)} onSaved={list => { setEdit(null); onList(list); }} />}
    </Card>
  );
}

function ResourceForm({ r, refs, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ code: r?.code || '', nature: r?.nature || 'materiau', label: r?.label || '', unit: r?.unit || 'u', unit_price: r?.unit_price ?? '', loss_pct: r?.loss_pct ?? 0, article_id: r?.article_id || '', price_checked: r ? r.price_checked : true, active: r ? r.active : true });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault(); setError(null);
    const body = { ...f, unit_price: Number(f.unit_price), loss_pct: f.nature === 'materiau' ? Number(f.loss_pct) : 0, article_id: Number(f.article_id) || null };
    try { onSaved(r ? await api.patch(`${DS}/ressources/${r.id}`, body) : await api.post(`${DS}/ressources`, body)); saved('Ressource enregistrée'); } catch (err) { setError(err); }
  };
  const last = r?.last_purchase;
  return (
    <Modal title={r ? `Ressource « ${r.label} »` : 'Nouvelle ressource'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="res-form"><Check />Enregistrer</button></>}>
      <form id="res-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Code"><input className="input" required maxLength={30} pattern="[A-Za-z0-9._\-]+" value={f.code} onChange={set('code')} placeholder="CIM-42" /></Field>
        <Field label="Nature"><select className="select" value={f.nature} onChange={set('nature')}>{Object.entries(refs.natures).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select></Field>
        <Field label="Libellé" className="full"><input className="input" required minLength={2} maxLength={160} value={f.label} onChange={set('label')} /></Field>
        <Field label="Unité" hint="Liste « Unités » ci-dessus"><select className="select" value={f.unit} onChange={set('unit')}>{refs.units.filter(u => u.active || u.code === f.unit).map(u => <option key={u.code} value={u.code}>{u.label}</option>)}</select></Field>
        <Field label="Prix unitaire (FCFA)" hint={last ? `Dernier achat : ${fcfa(last.price)} (${last.reference})` : undefined}>
          <div className="row" style={{ gap: 6 }}><input className="input" type="number" min={0} required value={f.unit_price} onChange={set('unit_price')} />{last && <button type="button" className="btn btn-sm" onClick={() => setF(x => ({ ...x, unit_price: last.price, price_checked: true }))}>Reprendre</button>}</div>
        </Field>
        {f.nature === 'materiau' && <Field label="Perte (%)" hint="Casse, chutes, foisonnement"><input className="input" type="number" min={0} max={50} step="0.5" value={f.loss_pct} onChange={set('loss_pct')} /></Field>}
        <Field label="Article du catalogue Achats" hint="Facultatif : propose le dernier prix d’achat">
          <select className="select" value={f.article_id} onChange={set('article_id')}><option value="">— Aucun —</option>{refs.articles.map(a => <option key={a.id} value={a.id}>{a.code} — {a.label} ({a.unit})</option>)}</select>
        </Field>
        <label className="checkbox full"><input type="checkbox" checked={f.price_checked} onChange={set('price_checked')} />Prix vérifié (sinon signalé « à vérifier » dans les estimations)</label>
        {r && <label className="checkbox full"><input type="checkbox" checked={f.active} onChange={set('active')} />Active (décochée : plus proposée dans les nouveaux ouvrages)</label>}
      </form>
    </Modal>
  );
}

function Works({ refs, write, onList }) {
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const remove = async w => {
    if (!window.confirm(`Supprimer l’ouvrage « ${w.label} » ?`)) return;
    try { onList(await api.del(`${DS}/ouvrages/${w.id}`)); } catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Card title={`Ouvrages élémentaires (${refs.works.length})`} actions={write && <button className="btn btn-primary btn-sm" onClick={() => setEdit({})}><Plus />Ouvrage</button>} bodyClass="">
      <p className="card-body small muted" style={{ margin: 0, borderBottom: '1px solid var(--border)' }}>Composition par unité d’ouvrage (sous-détail de prix) : ex. 1 m³ de béton dosé à 350 kg/m³ = 7 sacs de ciment, 0,4 m³ de sable, 0,8 m³ de gravier, acier, coffrage et heures de main-d’œuvre.</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Ouvrage</th><th>Lot</th><th>Unité</th><th className="right">Coût unitaire sec</th><th className="right">Ressources</th>{write && <th />}</tr></thead>
        <tbody>{Object.entries(refs.lots).sort((a, b) => a[1].sort - b[1].sort).flatMap(([lot]) => refs.works.filter(w => w.lot === lot)).map(w => (
          <tr key={w.id} style={w.active ? undefined : { opacity: 0.55 }}>
            <td className="small"><b>{w.label}</b><div className="muted tabular">{w.code}{!w.active && ' · désactivé'}</div></td>
            <td className="small">{w.lot_label}</td>
            <td className="small">{unitLabel(refs, w.unit)}</td>
            <td className="right tabular small">{fcfa(w.unit_cost)}</td>
            <td className="right tabular small">{w.composition.length}</td>
            {write && <td className="right nowrap"><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEdit(w)} aria-label={`Modifier ${w.label}`}><Pencil /></button><button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(w)} aria-label={`Supprimer ${w.label}`}><Trash2 /></button></td>}
          </tr>
        ))}</tbody>
      </table></div>
      {edit && <WorkForm w={edit.id ? edit : null} refs={refs} onClose={() => setEdit(null)} onSaved={list => { setEdit(null); onList(list); }} />}
    </Card>
  );
}

function WorkForm({ w, refs, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ code: w?.code || '', lot: w?.lot || 'elevation', label: w?.label || '', unit: w?.unit || 'm2', active: w ? w.active : true });
  const [items, setItems] = useState(w?.composition.map(c => ({ ...c })) || []);
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const byId = Object.fromEntries(refs.resources.map(r => [r.id, r]));
  const cost = items.reduce((t, c) => { const r = byId[c.resource_id]; return r ? t + Number(c.quantity || 0) * (r.nature === 'materiau' ? 1 + r.loss_pct / 100 : 1) * r.unit_price : t; }, 0);
  const save = async e => {
    e.preventDefault(); setError(null);
    const body = { ...f, composition: items.filter(c => c.resource_id).map(c => ({ resource_id: Number(c.resource_id), quantity: Number(c.quantity) })) };
    try { onSaved(w ? await api.patch(`${DS}/ouvrages/${w.id}`, body) : await api.post(`${DS}/ouvrages`, body)); saved('Ouvrage enregistré'); } catch (err) { setError(err); }
  };
  return (
    <Modal title={w ? `Ouvrage « ${w.label} »` : 'Nouvel ouvrage'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="work-form"><Check />Enregistrer</button></>}>
      <form id="work-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Code"><input className="input" required maxLength={30} pattern="[A-Za-z0-9._\-]+" value={f.code} onChange={set('code')} /></Field>
        <Field label="Lot"><select className="select" value={f.lot} onChange={set('lot')}>{Object.entries(refs.lots).sort((a, b) => a[1].sort - b[1].sort).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select></Field>
        <Field label="Libellé" className="full"><input className="input" required minLength={2} maxLength={200} value={f.label} onChange={set('label')} /></Field>
        <Field label="Unité d’ouvrage"><select className="select" value={f.unit} onChange={set('unit')}>{refs.units.filter(u => u.active || u.code === f.unit).map(u => <option key={u.code} value={u.code}>{u.label}</option>)}</select></Field>
        <Field label="Coût unitaire sec (prix actuels)"><div className="input tabular" style={{ display: 'flex', alignItems: 'center' }}>{fcfa(Math.round(cost))}</div></Field>
        <div className="full">
          <b className="small">Composition pour 1 {unitLabel(refs, f.unit).toLowerCase()}</b>
          <table className="table table-compact" style={{ marginTop: 6 }}><tbody>
            {items.map((c, i) => (
              <tr key={i}>
                <td><select className="select" required value={c.resource_id} onChange={e => setItems(x => x.map((y, j) => (j === i ? { ...y, resource_id: Number(e.target.value) } : y)))} aria-label="Ressource">
                  <option value="">— Ressource —</option>
                  {Object.entries(refs.natures).map(([n, d]) => <optgroup key={n} label={d.label}>{refs.resources.filter(r => r.nature === n && (r.active || r.id === c.resource_id)).map(r => <option key={r.id} value={r.id}>{r.label} ({unitLabel(refs, r.unit)})</option>)}</optgroup>)}
                </select></td>
                <td style={{ width: 130 }}><input className="input tabular" type="number" step="any" min={0} required value={c.quantity} onChange={e => setItems(x => x.map((y, j) => (j === i ? { ...y, quantity: e.target.value } : y)))} aria-label="Quantité par unité d’ouvrage" /></td>
                <td className="small muted" style={{ width: 70 }}>{byId[c.resource_id] ? unitLabel(refs, byId[c.resource_id].unit) : ''}</td>
                <td style={{ width: 40 }}><button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setItems(x => x.filter((_, j) => j !== i))} aria-label="Retirer la ressource"><Trash2 /></button></td>
              </tr>
            ))}
          </tbody></table>
          <button type="button" className="btn btn-sm" onClick={() => setItems(x => [...x, { resource_id: '', quantity: '' }])}><Plus />Ressource</button>
        </div>
        {w && <label className="checkbox full"><input type="checkbox" checked={f.active} onChange={set('active')} />Actif (décoché : plus proposé dans les estimations)</label>}
      </form>
    </Modal>
  );
}

function Models({ refs, write, onList }) {
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const remove = async m => {
    if (!window.confirm(`Supprimer le modèle « ${m.label} » ? Les estimations déjà faites restent.`)) return;
    try { onList(await api.del(`${DS}/modeles/${m.id}`)); } catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Card title={`Modèles de bâtiment (${refs.models.length})`} actions={write && <button className="btn btn-primary btn-sm" onClick={() => setEdit({})}><Plus />Modèle</button>} bodyClass="">
      <p className="card-body small muted" style={{ margin: 0, borderBottom: '1px solid var(--border)' }}>Un modèle donne les paramètres par défaut d’un bâtiment type et, pour chaque ouvrage, la quantité = ratio × base de métré (surface, linéaire de murs…).</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Modèle</th><th>Type de bien</th><th className="right">Surface</th><th className="right">Niveaux</th><th>Toiture</th><th className="right">Ouvrages</th>{write && <th />}</tr></thead>
        <tbody>{refs.models.map(m => (
          <tr key={m.id} style={m.active ? undefined : { opacity: 0.55 }}>
            <td className="small"><b>{m.label}</b>{m.description && <div className="muted">{m.description}</div>}</td>
            <td className="small">{m.property_type_label || '—'}</td>
            <td className="right tabular small">{num(m.params.surface)} m²</td>
            <td className="right tabular small">{m.params.niveaux}</td>
            <td className="small">{m.with_roof ? 'Comptée' : 'Non comptée'}</td>
            <td className="right tabular small">{m.lines.length}</td>
            {write && <td className="right nowrap"><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEdit(m)} aria-label={`Modifier ${m.label}`}><Pencil /></button><button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(m)} aria-label={`Supprimer ${m.label}`}><Trash2 /></button></td>}
          </tr>
        ))}</tbody>
      </table></div>
      {edit && <ModelForm m={edit.id ? edit : null} refs={refs} onClose={() => setEdit(null)} onSaved={list => { setEdit(null); onList(list); }} />}
    </Card>
  );
}

function ModelForm({ m, refs, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ label: m?.label || '', property_type_id: m?.property_type_id || '', description: m?.description || '', with_roof: m ? m.with_roof : false, active: m ? m.active : true });
  const [params, setParams] = useState(m?.params || { surface: 100, emprise: 100, perimetre: 40, murs_interieurs: 30, hauteur: 3, niveaux: 1, ouvertures: 20, logements: 1 });
  const [lines, setLines] = useState(m?.lines.map(l => ({ ...l })) || []);
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault(); setError(null);
    const body = { ...f, property_type_id: Number(f.property_type_id) || null, description: f.description.trim() || null, params, lines: lines.map(l => ({ work_id: Number(l.work_id), base: l.base, ratio: Number(l.ratio) })) };
    try { onSaved(m ? await api.patch(`${DS}/modeles/${m.id}`, body) : await api.post(`${DS}/modeles`, body)); saved('Modèle enregistré'); } catch (err) { setError(err); }
  };
  const lots = Object.entries(refs.lots).sort((a, b) => a[1].sort - b[1].sort);
  return (
    <Modal title={m ? `Modèle « ${m.label} »` : 'Nouveau modèle de bâtiment'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="model-form"><Check />Enregistrer</button></>}>
      <form id="model-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Libellé" className="full"><input className="input" required minLength={2} maxLength={160} value={f.label} onChange={set('label')} placeholder="Villa basse F4, duplex, immeuble R+4…" /></Field>
        <Field label="Type de bien" hint="Paramètres du dashboard › Types de biens"><select className="select" value={f.property_type_id} onChange={set('property_type_id')}><option value="">—</option>{refs.property_types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <label className="checkbox" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.with_roof} onChange={set('with_roof')} />Toiture comptée par défaut</label>
        <Field label="Description" className="full"><input className="input" maxLength={500} value={f.description} onChange={set('description')} /></Field>
        <div className="full"><b className="small">Paramètres par défaut</b></div>
        <ParamsFields defs={refs.params} value={params} onChange={setParams} />
        <div className="full">
          <b className="small">Ouvrages : quantité = ratio × base de métré</b>
          <table className="table table-compact" style={{ marginTop: 6 }}><tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><select className="select" required value={l.work_id} onChange={e => setLines(x => x.map((y, j) => (j === i ? { ...y, work_id: Number(e.target.value) } : y)))} aria-label="Ouvrage">
                  <option value="">— Ouvrage —</option>
                  {lots.map(([lot, d]) => <optgroup key={lot} label={d.label}>{refs.works.filter(w => w.lot === lot && (w.active || w.id === l.work_id)).map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</optgroup>)}
                </select></td>
                <td style={{ width: 110 }}><input className="input tabular" type="number" step="any" min={0} required value={l.ratio} onChange={e => setLines(x => x.map((y, j) => (j === i ? { ...y, ratio: e.target.value } : y)))} aria-label="Ratio" /></td>
                <td style={{ width: 220 }}><select className="select" value={l.base} onChange={e => setLines(x => x.map((y, j) => (j === i ? { ...y, base: e.target.value } : y)))} aria-label="Base de métré">{Object.entries(refs.bases).map(([k, d]) => <option key={k} value={k}>× {d.label}</option>)}</select></td>
                <td style={{ width: 40 }}><button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setLines(x => x.filter((_, j) => j !== i))} aria-label="Retirer l’ouvrage"><Trash2 /></button></td>
              </tr>
            ))}
          </tbody></table>
          <button type="button" className="btn btn-sm" onClick={() => setLines(x => [...x, { work_id: '', base: 'surface', ratio: 1 }])}><Plus />Ouvrage</button>
        </div>
        {m && <label className="checkbox full"><input type="checkbox" checked={f.active} onChange={set('active')} />Actif (décoché : plus proposé pour une nouvelle estimation)</label>}
      </form>
    </Modal>
  );
}
