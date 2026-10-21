import { useMemo, useState } from 'react';
import { Search, TrendingUp } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field } from '@admin/components/ui';
import { LineChart } from '@admin/components/Charts';
import { qs } from '@admin/lib/api';
import { RH, metricValue } from '../../lib/rh';

const GRAINS = [['semaine', 'Semaine'], ['mois', 'Mois'], ['trimestre', 'Trimestre'], ['annee', 'Année']];
const iso = d => d.toISOString().slice(0, 10);
const y = new Date().getUTCFullYear();
const PRESETS = {
  annee: { label: 'Cette année', du: `${y}-01-01`, au: `${y}-12-31` },
  douze: { label: '12 derniers mois', du: iso(new Date(Date.UTC(y, new Date().getUTCMonth() - 11, 1))), au: iso(new Date()) },
  trimestre: { label: 'Ce trimestre', du: iso(new Date(Date.UTC(y, Math.floor(new Date().getUTCMonth() / 3) * 3, 1))), au: iso(new Date(Date.UTC(y, Math.floor(new Date().getUTCMonth() / 3) * 3 + 3, 0))) },
  passee: { label: 'Année dernière', du: `${y - 1}-01-01`, au: `${y - 1}-12-31` },
  trois: { label: '3 dernières années', du: `${y - 2}-01-01`, au: `${y}-12-31` },
};
const pct = v => `${Math.round(v)} %`;

/**
 * Courbes d'objectifs et de performance d'un employé, par semaine, mois, trimestre ou année, sur une période choisie.
 * `employees` : liste pour la recherche (service RH, responsable) ; sinon `employeeId` fixe (dossier, Mon espace).
 */
export default function PerformanceCurves({ employeeId = null, employees = null }) {
  const [picked, setPicked] = useState(employeeId || employees?.[0]?.id || null);
  const [q, setQ] = useState('');
  const [grain, setGrain] = useState('mois');
  const [preset, setPreset] = useState('annee');
  const [range, setRange] = useState({ du: PRESETS.annee.du, au: PRESETS.annee.au });
  const [metric, setMetric] = useState('');
  const id = employeeId || picked;
  const data = useResource(id ? `${RH}/employees/${id}/performance${qs({ granularite: grain, du: range.du, au: range.au })}` : null);
  const choosePreset = k => { setPreset(k); if (PRESETS[k]) { setRange({ du: PRESETS[k].du, au: PRESETS[k].au }); if (k === 'trois' && grain === 'semaine') setGrain('mois'); } };
  const shown = (employees || []).filter(e => !q || `${e.last_name} ${e.first_name} ${e.matricule}`.toLowerCase().includes(q.toLowerCase()));
  const d = data.data;
  const labels = useMemo(() => Object.fromEntries((d?.buckets || []).map(b => [b.key, b])), [d]);
  const axis = { xKey: 'key', labelOf: k => labels[k]?.label || k, titleOf: k => labels[k]?.title || k };
  const m = d?.metrics.find(x => x.key === metric) || d?.metrics[0];
  const done = (d?.buckets || []).filter(b => !b.future);
  const lastScore = [...done].reverse().find(b => b.score != null)?.score;

  return (
    <div className="stack">
      <Card>
        <div className="curves-controls">
          {employees && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="search"><Search aria-hidden="true" /><input className="input" type="search" placeholder="Rechercher un employé" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un employé" /></label>
              <select className="select" style={{ width: 'auto', minWidth: 220 }} value={picked || ''} onChange={e => setPicked(Number(e.target.value))} aria-label="Employé">
                {!shown.some(e => e.id === picked) && picked && <option value={picked}>{(employees.find(e => e.id === picked) || {}).last_name}</option>}
                {shown.map(e => <option key={e.id} value={e.id}>{e.last_name} {e.first_name} · {e.matricule}</option>)}
              </select>
            </div>
          )}
          <div className="seg" role="group" aria-label="Découpage">{GRAINS.map(([k, l]) => <button key={k} className={grain === k ? 'active' : ''} onClick={() => setGrain(k)}>{l}</button>)}</div>
          <select className="select" style={{ width: 'auto' }} value={preset} onChange={e => choosePreset(e.target.value)} aria-label="Période">
            {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}<option value="perso">Période personnalisée</option>
          </select>
          {preset === 'perso' && <>
            <Field label="Du"><input className="input" type="date" value={range.du} onChange={e => setRange(r => ({ ...r, du: e.target.value }))} /></Field>
            <Field label="Au"><input className="input" type="date" value={range.au} min={range.du} onChange={e => setRange(r => ({ ...r, au: e.target.value }))} /></Field>
          </>}
        </div>
      </Card>
      <ErrorBox error={data.error} />
      {!id ? <Card><Empty>Aucun employé dans votre périmètre.</Empty></Card> : !d ? <Skeleton h={280} /> : (
        <>
          <Card title={`Performance globale — ${d.employee.name}`} actions={lastScore != null && <span className="small">Dernière période : <b style={{ fontSize: 16 }}>{lastScore} %</b></span>}>
            {done.some(b => b.score != null) ? (
              <LineChart data={d.buckets} {...axis} area format={pct} ariaLabel={`Score de performance de ${d.employee.name} par période`}
                series={[{ key: 'score', label: 'Score pondéré des objectifs', color: 'var(--series-1)' }]} />
            ) : <Empty icon={TrendingUp}>Aucun objectif sur la période : fixez des objectifs pour suivre la performance.</Empty>}
            <p className="small muted" style={{ marginTop: 8 }}>Atteinte pondérée des objectifs de l’année sur chaque période ; les cibles annuelles des indicateurs cumulés (ventes, heures…) sont ramenées à la durée de la période.</p>
          </Card>

          {d.objectives.length > 0 && (
            <div className="grid grid-2" style={{ alignItems: 'start' }}>
              {d.objectives.map(o => {
                const rows = d.buckets.map((b, i) => ({ key: b.key, ...o.points[i] }));
                const series = o.metric === 'manuel'
                  ? [{ key: 'attainment', label: 'Avancement', color: 'var(--series-1)' }]
                  : o.cumul && grain !== 'annee'
                    ? [{ key: 'ytd', label: 'Réalisé depuis le 1er janvier', color: 'var(--series-1)' }, { key: 'ytd_target', label: 'Trajectoire de la cible', color: '#eb6834', dashed: true }]
                    : [{ key: 'actual', label: 'Réalisé', color: 'var(--series-1)' }, { key: 'target', label: o.cumul ? 'Cible de la période' : 'Cible', color: '#eb6834', dashed: true }];
                const fmt = o.metric === 'manuel' ? pct : v => metricValue(o.unit, v);
                return (
                  <Card key={o.id} title={o.title} actions={<span className="small muted">{o.year} · poids {o.weight}</span>}>
                    <p className="small muted" style={{ marginBottom: 8 }}>{o.label}{o.target_value != null ? ` · cible ${o.year} : ${metricValue(o.unit, o.target_value)}${o.lower ? ' au plus' : ''}` : ''}</p>
                    <LineChart data={rows} {...axis} format={fmt} height={200} ariaLabel={`Évolution de l’objectif ${o.title}`} series={series} />
                  </Card>
                );
              })}
            </div>
          )}

          {d.metrics.length > 0 && m && (
            <Card title="Indicateurs" actions={
              <select className="select" style={{ width: 'auto' }} value={m.key} onChange={e => setMetric(e.target.value)} aria-label="Indicateur">
                {Object.entries(d.metrics.reduce((g, x) => ({ ...g, [x.group]: [...(g[x.group] || []), x] }), {})).map(([g, list]) => <optgroup key={g} label={g}>{list.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
              </select>
            }>
              <LineChart data={d.buckets.map(b => ({ key: b.key, v: b.future ? null : b.values[m.key] ?? null }))} {...axis} area format={v => metricValue(m.unit, v)}
                ariaLabel={`${m.label} par période`} series={[{ key: 'v', label: m.label, color: '#1baf7a' }]} />
              <p className="small muted" style={{ marginTop: 8 }}>{m.cumul ? 'Total de chaque période.' : 'Valeur sur chaque période.'}{m.lower ? ' Plus la valeur est basse, mieux c’est.' : ''} Calculé depuis l’ERP et le dashboard.</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
