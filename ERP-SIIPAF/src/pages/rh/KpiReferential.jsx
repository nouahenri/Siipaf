/**
 * RH › Performance et entretiens › Référentiel KPI (demande du client du 27/10) : indicateurs (nom, famille, calcul,
 * niveau, seuils), modèles d'objectifs de chaque service et de chaque poste avec leur application à une année (aperçu
 * puis confirmation), part des objectifs collectifs dans le score d'un service. Modification : droits « kpi:indicators » (indicateurs, part des objectifs collectifs) et « kpi:templates » (modèles)
 * (service RH et Direction) ; lecture : service RH.
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Search, Archive, ArchiveRestore, Play, Gauge } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { RH, metricValue } from '../../lib/rh';
import { thisYear } from '../../components/PeriodPicker';

const UNITS = { fcfa: 'FCFA', pct: '%', heures: 'heures', jours: 'jours', note: 'sur 5', nombre: 'nombre' };
const PERIOD_WORDS = { annee: 'Année', trimestre: 'Chaque trimestre', mois: 'Chaque mois' };

export default function KpiReferential() {
  const { can } = useAuth();
  const write = can('kpi:indicators') || can('kpi:templates') || can('kpi:department');
  const [writeIndicators, writeTemplates] = [can('kpi:indicators'), can('kpi:templates')];
  const ref = useResource(`${RH}/kpis`);
  const templates = useResource(`${RH}/kpi-templates`);
  if (ref.error) return <ErrorBox error={ref.error} />;
  if (!ref.data) return <Skeleton h={300} />;
  return (
    <div className="stack">
      {!write && <div className="alert alert-info">Lecture seule : le référentiel est géré par les comptes qui ont le privilège « Gérer le référentiel KPI » (service RH et Direction).</div>}
      <Indicators data={ref.data} write={writeIndicators} onChange={() => { ref.reload(); templates.reload(); }} />
      <Templates data={templates} kpis={ref.data.kpis} write={writeTemplates} />
      <ScoreRule pct={ref.data.collective_pct} write={writeIndicators} onSaved={ref.reload} />
    </div>
  );
}

/** Indicateurs du référentiel : calcul automatique (ERP) ou suivi manuel, niveau, seuils d'alerte et d'atteinte. */
function Indicators({ data, write, onChange }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [family, setFamily] = useState('');
  const [edit, setEdit] = useState(null);
  const families = [...new Set(data.kpis.map(k => k.family))];
  const shown = data.kpis.filter(k => (!family || k.family === family) && (!q || `${k.name} ${k.family} ${k.computed_label || ''}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = async k => {
    try { await api.patch(`${RH}/kpis/${k.id}`, { active: !k.active }); onChange(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title="Indicateurs" bodyClass="" actions={write && <button className="btn btn-sm btn-primary" onClick={() => setEdit({})}><Plus />Indicateur</button>}>
      <div className="card-body row" style={{ gap: 8, flexWrap: 'wrap', paddingBottom: 8 }}>
        <label className="search"><Search aria-hidden="true" /><input className="input" type="search" placeholder="Rechercher un indicateur" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un indicateur" /></label>
        <select className="select" style={{ width: 'auto' }} value={family} onChange={e => setFamily(e.target.value)} aria-label="Famille">
          <option value="">Toutes les familles</option>{families.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Indicateur</th><th>Famille</th><th>Mesure</th><th>Niveau</th><th className="right">Seuils</th><th className="right">Utilisé</th><th /></tr></thead>
        <tbody>{shown.map(k => (
          <tr key={k.id} style={{ opacity: k.active ? 1 : 0.6 }}>
            <td><b>{k.name}</b>{!k.active && <> <Badge>Archivé</Badge></>}{k.description && <div className="small muted">{k.description}</div>}</td>
            <td>{k.family}</td>
            <td className="small">{k.auto ? <>{k.computed_label !== k.name ? <div>{k.computed_label}</div> : null}<span className="muted">Calcul ERP · {UNITS[k.unit] || 'nombre'}{k.lower ? ' · plus bas = mieux' : ''}</span></> : <span className="muted">Suivi manuel</span>}</td>
            <td className="small">{data.levels[k.level]}</td>
            <td className="right small tabular" title={`Alerte sous ${k.warn_pct} % d’atteinte, atteint à partir de ${k.ok_pct} %`}>{k.warn_pct} % · {k.ok_pct} %</td>
            <td className="right small tabular">{k.objectives + k.collective ? `${k.objectives + k.collective} obj.` : '—'}{k.templates ? ` · ${k.templates} modèle(s)` : ''}</td>
            <td className="right">{write && <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEdit(k)} aria-label={`Modifier ${k.name}`}><Pencil /></button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggle(k)} aria-label={k.active ? `Archiver ${k.name}` : `Réactiver ${k.name}`} title={k.active ? 'Archiver : plus proposé pour de nouveaux objectifs' : 'Réactiver'}>{k.active ? <Archive /> : <ArchiveRestore />}</button>
            </span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="card-body small muted" style={{ borderTop: '1px solid var(--border)' }}>
        Les calculs automatiques viennent des données de l’ERP (ventes, chantiers, SAV, présences, comptabilité, juridique, courrier, demandes, parc) ; un indicateur « Service seulement » se mesure sur le service entier et sert aux objectifs collectifs. Seuils : barre orange sous le seuil d’alerte, verte à partir du seuil d’atteinte. Un indicateur ne se supprime pas : archivé, il n’est plus proposé mais les objectifs existants le gardent.
      </p>
      {edit && <KpiForm kpi={edit} data={data} families={families} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange(); }} />}
    </Card>
  );
}

function KpiForm({ kpi, data, families, onClose, onSaved }) {
  const saved = useSaved();
  const editing = !!kpi.id;
  const [f, setF] = useState({ name: kpi.name || '', family: kpi.family || '', metric: kpi.metric || 'manuel', level: kpi.level || 'tous', warn_pct: kpi.warn_pct ?? 50, ok_pct: kpi.ok_pct ?? 100, description: kpi.description || '' });
  const [error, setError] = useState(null);
  const used = editing && (kpi.objectives + kpi.collective + kpi.templates) > 0;
  const taken = new Set(data.kpis.filter(k => k.id !== kpi.id && k.metric !== 'manuel').map(k => k.metric));
  const metric = data.metrics[f.metric];
  const set = key => e => setF(x => ({ ...x, [key]: e.target.value }));
  const save = async e => {
    e.preventDefault();
    const body = { ...f, warn_pct: Number(f.warn_pct), ok_pct: Number(f.ok_pct), description: f.description || null };
    if (used) delete body.metric;
    try {
      if (editing) await api.patch(`${RH}/kpis/${kpi.id}`, body);
      else await api.post(`${RH}/kpis`, body);
      saved(editing ? 'Indicateur enregistré' : 'Indicateur ajouté'); onSaved();
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={editing ? `Indicateur — ${kpi.name}` : 'Nouvel indicateur'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="kpiform">{editing ? 'Enregistrer' : 'Ajouter'}</button></>}>
      <form id="kpiform" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Nom" className="full"><input className="input" required minLength={3} maxLength={120} value={f.name} onChange={set('name')} placeholder="Qualité des dossiers de vente, Délai de réponse aux acquéreurs…" /></Field>
        <Field label="Famille" hint="Regroupe les indicateurs dans les listes"><input className="input" required minLength={2} maxLength={60} list="kpi-families" value={f.family} onChange={set('family')} /><datalist id="kpi-families">{families.map(x => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Mesure" hint={used ? 'Indicateur déjà utilisé : sa mesure ne change plus' : metric ? `Calculé depuis l’ERP · ${UNITS[metric.unit] || 'nombre'}` : 'Avancement saisi à la main sur chaque objectif'}>
          <select className="select" value={f.metric} disabled={used} onChange={e => setF(x => ({ ...x, metric: e.target.value, level: data.metrics[e.target.value]?.service_only ? 'service' : x.level === 'service' ? 'tous' : x.level }))}>
            <option value="manuel">Suivi manuel</option>
            {Object.entries(Object.entries(data.metrics).filter(([k]) => !taken.has(k)).reduce((g, [k, m]) => ({ ...g, [m.group]: [...(g[m.group] || []), [k, m]] }), {}))
              .map(([g, list]) => <optgroup key={g} label={g}>{list.map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</optgroup>)}
          </select>
        </Field>
        <Field label="Niveau" hint={metric?.service_only ? 'Mesuré sur le service entier' : 'Objectif d’un employé, du service, ou des deux'}>
          <select className="select" value={f.level} disabled={metric?.service_only} onChange={set('level')}>{Object.entries(data.levels).map(([k, v]) => <option key={k} value={k} disabled={metric?.service_only && k !== 'service'}>{v}</option>)}</select>
        </Field>
        <Field label="Seuil d’alerte (%)" hint="Barre orange en dessous"><input className="input" type="number" min="0" max="100" value={f.warn_pct} onChange={set('warn_pct')} /></Field>
        <Field label="Seuil d’atteinte (%)" hint="Barre verte à partir de"><input className="input" type="number" min="0" max="100" value={f.ok_pct} onChange={set('ok_pct')} /></Field>
        <Field label="Description" className="full"><textarea className="textarea" rows={2} maxLength={500} value={f.description} onChange={set('description')} /></Field>
      </form>
    </Modal>
  );
}

/** Modèles d'objectifs : un par service, un par poste ; le modèle du poste remplace celui du service ligne à ligne. */
function Templates({ data, kpis, write }) {
  const [sel, setSel] = useState(null);
  const [applying, setApplying] = useState(null);
  if (data.error) return <ErrorBox error={data.error} />;
  if (!data.data) return <Skeleton h={240} />;
  const all = [...data.data.services, ...data.data.postes];
  const keyOf = t => (t.scope === 'service' ? `s:${t.department}` : `p:${t.position_id}`);
  const current = all.find(t => keyOf(t) === sel) || null;
  const Item = t => (
    <button key={keyOf(t)} type="button" className={`kpi-tpl-item ${sel === keyOf(t) ? 'active' : ''}`} onClick={() => setSel(keyOf(t))} aria-pressed={sel === keyOf(t)}
      aria-label={`${t.label} : ${t.headcount} personne(s), ${t.lines.length ? `${t.lines.length} ligne(s) au modèle` : 'aucun modèle'}`}>
      <span>{t.label}<span className="small muted"> · {t.headcount} pers.</span></span>
      {t.lines.length ? <Badge tone="brand">{t.lines.length}</Badge> : <span className="small muted">—</span>}
    </button>
  );
  return (
    <Card title="Modèles d’objectifs" actions={write && <button className="btn btn-sm" onClick={() => setApplying({})}><Play />Appliquer tous les modèles</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Un modèle liste les indicateurs, cibles et poids d’un service ou d’un poste. Appliqué à une année, il crée les objectifs de chaque employé concerné ; le modèle du poste remplace celui du service pour un même indicateur et un même découpage, et un objectif ajusté à la main n’est jamais écrasé. Un nouvel arrivant, ou un employé qui change de poste ou de service, reçoit les objectifs de l’année en cours à partir du mois en cours.</p>
      <div className="kpi-templates">
        <div className="kpi-tpl-list">
          <h3 className="erp-h3">Services</h3>
          {data.data.services.map(Item)}
          <h3 className="erp-h3" style={{ marginTop: 10 }}>Postes</h3>
          {data.data.postes.length ? data.data.postes.map(Item) : <p className="small muted">Aucun poste (RH › Réglages).</p>}
        </div>
        <div>
          {!current ? <Empty icon={Gauge}>Choisissez un service ou un poste.</Empty>
            : <TemplateEditor key={`${keyOf(current)}-${current.id}-${current.lines.length}`} template={current} kpis={kpis} write={write} onSaved={data.setData} onApply={() => setApplying(current)} />}
        </div>
      </div>
      {applying && <ApplyModal target={applying} onClose={() => setApplying(null)} />}
    </Card>
  );
}

function TemplateEditor({ template, kpis, write, onSaved, onApply }) {
  const saved = useSaved();
  const usable = kpis.filter(k => k.level !== 'service' && (k.active || template.lines.some(l => l.kpi_id === k.id)));
  const families = usable.reduce((g, k) => ({ ...g, [k.family]: [...(g[k.family] || []), k] }), {});
  const [lines, setLines] = useState(template.lines.map(l => ({ kpi_id: l.kpi_id, period: l.period, target_value: l.target_value ?? '', weight: l.weight })));
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => setDirty(false), [template.id]);
  const change = (i, patch) => { setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); setDirty(true); };
  const kOf = id => kpis.find(k => k.id === Number(id));
  const save = async () => {
    setError(null);
    try {
      const out = await api.put(`${RH}/kpi-templates`, {
        scope: template.scope, department: template.department, position_id: template.position_id || null,
        lines: lines.filter(l => l.kpi_id).map(l => ({ kpi_id: Number(l.kpi_id), period: l.period, weight: Number(l.weight), target_value: kOf(l.kpi_id)?.auto && l.target_value !== '' ? Number(l.target_value) : null })),
      });
      saved(lines.length ? 'Modèle enregistré' : 'Modèle supprimé'); setDirty(false); onSaved(out);
    } catch (err) { setError(err); }
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <h3 className="erp-h3" style={{ margin: 0 }}>{template.scope === 'service' ? 'Service' : 'Poste'} : {template.label}</h3>
        {write && template.id && !dirty && <button className="btn btn-sm" onClick={onApply}><Play />Appliquer…</button>}
      </div>
      <ErrorBox error={error} />
      {!lines.length ? <p className="small muted">Aucun objectif dans ce modèle.</p> : (
        <div className="table-wrap"><table className="table table-compact">
          <thead><tr><th>Indicateur</th><th>Découpage</th><th>Cible par période</th><th style={{ width: 80 }}>Poids</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => {
            const k = kOf(l.kpi_id);
            return (
              <tr key={i}>
                <td style={{ minWidth: 200 }}>
                  <select className="select" disabled={!write} value={l.kpi_id} onChange={e => change(i, { kpi_id: e.target.value })} aria-label="Indicateur">
                    <option value="">Choisir…</option>
                    {Object.entries(families).map(([fam, list]) => <optgroup key={fam} label={fam}>{list.map(x => <option key={x.id} value={x.id}>{x.name}{x.active ? '' : ' (archivé)'}</option>)}</optgroup>)}
                  </select>
                </td>
                <td><select className="select" disabled={!write} value={l.period} onChange={e => change(i, { period: e.target.value })} aria-label="Découpage">{Object.entries(PERIOD_WORDS).map(([p, w]) => <option key={p} value={p}>{w}</option>)}</select></td>
                <td style={{ minWidth: 130 }}>{k?.auto
                  ? <input className="input" type="number" min="0" disabled={!write} value={l.target_value} onChange={e => change(i, { target_value: e.target.value })} aria-label="Cible" title={l.target_value !== '' ? metricValue(k.unit, l.target_value) : undefined} placeholder={UNITS[k.unit] || 'nombre'} />
                  : <span className="small muted">suivi manuel</span>}</td>
                <td><input className="input" type="number" min="1" max="10" disabled={!write} value={l.weight} onChange={e => change(i, { weight: e.target.value })} aria-label="Poids" /></td>
                <td>{write && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { setLines(ls => ls.filter((_, j) => j !== i)); setDirty(true); }} aria-label="Retirer la ligne"><Trash2 /></button>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {write && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => { setLines(ls => [...ls, { kpi_id: '', period: 'annee', target_value: '', weight: 1 }]); setDirty(true); }}><Plus />Ligne</button>
          <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={save}>Enregistrer le modèle</button>
          {dirty && <span className="small muted">Modifications non enregistrées</span>}
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>« Chaque mois » crée 12 objectifs (un par mois) avec la même cible ; « Chaque trimestre » en crée 4. Retirer une ligne ne supprime pas les objectifs déjà créés.</p>
    </div>
  );
}

/** Aperçu puis confirmation de l'application d'un modèle (ou de tous) à une année. */
function ApplyModal({ target, onClose }) {
  const saved = useSaved();
  const [year, setYear] = useState(thisYear);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const scope = target.scope ? { scope: target.scope, department: target.department || null, position_id: target.position_id || null } : {};
  useEffect(() => {
    let live = true;
    setPreview(null); setError(null);
    api.post(`${RH}/kpi-templates/apply`, { ...scope, year }).then(p => live && setPreview(p)).catch(e => live && setError(e));
    return () => { live = false; };
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = async () => {
    setBusy(true);
    try {
      const out = await api.post(`${RH}/kpi-templates/apply`, { ...scope, year, confirm: true });
      saved(`${out.created} objectif(s) créé(s), ${out.updated} mis à jour`); onClose();
    } catch (e) { setError(e); setBusy(false); }
  };
  const nothing = preview && !preview.created && !preview.updated;
  return (
    <Modal title={target.label ? `Appliquer le modèle — ${target.label}` : 'Appliquer tous les modèles'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!preview || nothing || busy} onClick={confirm}>Créer les objectifs</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Année">
          <select className="select" value={year} onChange={e => setYear(Number(e.target.value))}>{[thisYear, thisYear + 1].map(y => <option key={y} value={y}>{y}</option>)}</select>
        </Field>
        {year === thisYear && <p className="small muted" style={{ margin: 0 }}>Année en cours : les objectifs mensuels et trimestriels commencent à la période en cours (les périodes écoulées ne sont pas créées après coup).</p>}
        <ErrorBox error={error} />
        {!preview ? !error && <Skeleton h={90} /> : (
          <>
            <div>
              <div className="kv"><span>Employés concernés</span><b className="tabular">{preview.employees}</b></div>
              <div className="kv"><span>Objectifs à créer</span><b className="tabular">{preview.created}</b></div>
              <div className="kv"><span>À mettre à jour (cible ou poids du modèle changés)</span><b className="tabular">{preview.updated}</b></div>
              <div className="kv"><span>Déjà à jour</span><b className="tabular">{preview.unchanged}</b></div>
              <div className="kv"><span>Conservés (saisis ou ajustés à la main)</span><b className="tabular">{preview.kept}</b></div>
            </div>
            {preview.people.length > 0 && <p className="small" style={{ margin: 0 }}>{preview.people.filter(p => p.created).map(p => `${p.name} (${p.created})`).join(', ') || 'Aucun nouvel objectif.'}</p>}
            {preview.skipped.length > 0 && (
              <div className="alert alert-warn small">
                <b>Non créés :</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{preview.skipped.map((s, i) => <li key={i}>{s.name} — {s.kpi} : {s.reason}</li>)}</ul>
              </div>
            )}
            {nothing && <p className="small muted" style={{ margin: 0 }}>Rien à créer ni à mettre à jour.</p>}
            {!nothing && <p className="small muted" style={{ margin: 0 }}>Les employés qui reçoivent de nouveaux objectifs sont prévenus dans l’ERP.</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Part des objectifs collectifs dans le score d'un service (choix du client du 27/10 : 50 %, réglable). */
function ScoreRule({ pct, write, onSaved }) {
  const saved = useSaved();
  const [v, setV] = useState(pct);
  const [error, setError] = useState(null);
  useEffect(() => setV(pct), [pct]);
  const save = async e => {
    e.preventDefault(); setError(null);
    try { await api.put(`${RH}/kpi-settings`, { service_collective_pct: Number(v) }); saved('Règle de calcul enregistrée'); onSaved(); } catch (err) { setError(err); }
  };
  return (
    <Card title="Score des services">
      <form className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={save}>
        <Field label="Part des objectifs collectifs du service (%)" hint={`Le reste (${100 - Number(v || 0)} %) : moyenne des employés du service. Sans objectif collectif, le score est la moyenne des employés.`}>
          <input className="input" type="number" min="0" max="100" disabled={!write} value={v} onChange={e => setV(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
        {write && <button className="btn btn-primary" disabled={Number(v) === pct}>Enregistrer</button>}
      </form>
      <ErrorBox error={error} />
    </Card>
  );
}
