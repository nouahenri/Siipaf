import { useEffect, useRef, useState } from 'react';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fait défiler un nombre de 0 jusqu'à sa valeur (ignoré si l'utilisateur réduit les animations). */
export function useCountUp(target, duration = 900) {
  const [v, setV] = useState(reducedMotion() ? target : 0);
  useEffect(() => {
    if (target == null || reducedMotion()) { setV(target); return undefined; }
    let raf; const start = performance.now();
    const tick = t => {
      const p = Math.min(1, (t - start) / duration);
      setV(target * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

/** Largeur réelle du conteneur (graphiques adaptatifs). */
export function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Graduations « rondes » de 0 au maximum. */
export function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const monthLabel = key => { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`; };
export const monthLong = key => { const [y, m] = key.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); };

/**
 * Courbes d'évolution (une ou plusieurs séries sur la même échelle).
 * Survol : réticule vertical + info-bulle listant toutes les séries du mois.
 * Par défaut l'axe est mensuel (clé AAAA-MM) ; `labelOf` / `titleOf` permettent semaines, trimestres, années.
 * Une valeur nulle interrompt la courbe ; `dashed` sur une série la trace en pointillés (cible, trajectoire).
 */
export function LineChart({ data, xKey, series, format = v => v, area = false, height = 240, ariaLabel, labelOf = monthLabel, titleOf = monthLong }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { t: 16, r: 16, b: 28, l: 56 };
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const max = Math.max(...data.flatMap(d => series.map(s => d[s.key] ?? 0)), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = i => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = v => pad.t + ih - (v / top) * ih;
  const step = Math.ceil(data.length / Math.max(2, Math.floor(iw / 64)));

  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = Math.round(((px - pad.l) / iw) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={pad.l - 8} y={y(t)} className="axis-label" textAnchor="end" dominantBaseline="central">{format(t, true)}</text>
          </g>
        ))}
        {data.map((d, i) => ((i % step === 0 && data.length - 1 - i >= step) || i === data.length - 1) && (
          <text key={d[xKey]} x={x(i)} y={height - 8} className="axis-label" textAnchor={i === data.length - 1 ? 'end' : 'middle'}>{labelOf(d[xKey])}</text>
        ))}
        {series.map((s, si) => {
          // Segments continus (une valeur nulle coupe la courbe)
          const segments = [];
          data.forEach((d, i) => {
            if (d[s.key] == null) { segments.push([]); return; }
            if (!segments.length) segments.push([]);
            segments[segments.length - 1].push([i, d[s.key]]);
          });
          return (
            <g key={s.key}>
              {segments.filter(seg => seg.length).map((seg, k) => {
                const pts = seg.map(([i, v]) => `${x(i)},${y(v)}`);
                return (
                  <g key={k}>
                    {area && !s.dashed && <path className="chart-area" d={`M${x(seg[0][0])},${y(0)} L${pts.join(' L')} L${x(seg[seg.length - 1][0])},${y(0)} Z`} fill={s.color} fillOpacity="0.12" />}
                    {seg.length === 1 && <circle cx={x(seg[0][0])} cy={y(seg[0][1])} r="3" fill={s.color} />}
                    <polyline className={s.dashed ? '' : 'chart-line'} pathLength="1" style={{ animationDelay: `${si * 0.25}s` }} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                );
              })}
            </g>
          );
        })}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="crosshair" />
            {series.filter(s => data[hover][s.key] != null).map(s => <circle key={s.key} cx={x(hover)} cy={y(data[hover][s.key])} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover), 90), width - 90), top: pad.t }}>
          <div className="tip-title">{titleOf(data[hover][xKey])}</div>
          {series.map(s => (
            <div key={s.key} className="tip-row"><i style={{ background: s.color }} /><strong>{data[hover][s.key] == null ? '—' : format(data[hover][s.key])}</strong><span>{s.label}</span></div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="legend" style={{ marginTop: 6 }}>
          {series.map(s => <span key={s.key} className="legend-item"><i className="line-key" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
    </div>
  );
}

/** Barres horizontales triées (ex. origine des prospects). */
export function BarList({ items, format = v => v, color = 'var(--series-1)' }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...items.map(i => i.value));
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!items.length) return <p className="muted">Pas encore de données.</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {items.map((i, idx) => (
        <div key={i.label} className="bar-row" onPointerEnter={() => setHover(i.label)} onPointerLeave={() => setHover(null)} title={`${i.label} : ${format(i.value)} (${Math.round((i.value / total) * 100)} %)`}>
          <span className="small">{i.label}</span>
          <div className="bar-track"><div style={{ width: `${(i.value / max) * 100}%`, background: color, opacity: hover && hover !== i.label ? 0.45 : 1, animationDelay: `${idx * 0.08}s` }} /></div>
          <span className="small tabular right"><strong>{format(i.value)}</strong> <span className="muted">{Math.round((i.value / total) * 100)} %</span></span>
        </div>
      ))}
    </div>
  );
}
