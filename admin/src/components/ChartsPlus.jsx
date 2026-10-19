/**
 * Graphiques complémentaires du tableau de bord : courbe lissée avec dégradé,
 * barres groupées, barres avec période mise en avant, anneau de répartition.
 */
import { useRef, useState } from 'react';
import { useWidth, niceTicks, monthLabel, monthLong } from './Charts';

/* Courbe lissée (interpolation monotone : la courbe ne dépasse jamais les valeurs réelles) */
export function smoothPath(points) {
  const n = points.length;
  if (n < 2) return n ? `M${points[0][0]},${points[0][1]}` : '';
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = points[i + 1][0] - points[i][0]; m[i] = (points[i + 1][1] - points[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${points[i][0] + h},${points[i][1] + t[i] * h} ${points[i + 1][0] - h},${points[i + 1][1] - t[i + 1] * h} ${points[i + 1][0]},${points[i + 1][1]}`;
  }
  return d;
}

/** Courbe lissée avec dégradé (style « historique de solde »). */
export function SmoothAreaChart({ data, xKey, valueKey, label, color = 'var(--series-1)', format = v => v, height = 240, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const gid = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current;
  const pad = { t: 16, r: 16, b: 28, l: 56 };
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const ticks = niceTicks(Math.max(...data.map(d => d[valueKey]), 0));
  const top = ticks[ticks.length - 1] || 1;
  const x = i => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = v => pad.t + ih - (v / top) * ih;
  const pts = data.map((d, i) => [x(i), y(d[valueKey])]);
  const line = smoothPath(pts);
  const step = Math.ceil(data.length / Math.max(2, Math.floor(iw / 64)));
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((((e.clientX - r.left) / r.width) * width - pad.l) / iw) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid-line" strokeDasharray="3 4" />
            <text x={pad.l - 8} y={y(t)} className="axis-label" textAnchor="end" dominantBaseline="central">{format(t, true)}</text>
          </g>
        ))}
        {data.map((d, i) => ((i % step === 0 && data.length - 1 - i >= step) || i === data.length - 1) && (
          <text key={d[xKey]} x={x(i)} y={height - 8} className="axis-label" textAnchor={i === data.length - 1 ? 'end' : 'middle'}>{monthLabel(d[xKey])}</text>
        ))}
        <path className="chart-area" d={`${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gid})`} />
        <path className="chart-line" pathLength="1" d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="crosshair" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="5" fill={color} stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover), 90), width - 90), top: pad.t }}>
          <div className="tip-title">{monthLong(data[hover][xKey])}</div>
          <div className="tip-row"><i style={{ background: color }} /><strong>{format(data[hover][valueKey])}</strong><span>{label}</span></div>
        </div>
      )}
    </div>
  );
}

/** Barres groupées verticales (plusieurs séries par catégorie), bouts arrondis. */
export function GroupedBars({ data, labelOf, series, format = v => v, height = 240, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { t: 12, r: 8, b: 28, l: 36 };
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const ticks = niceTicks(Math.max(...data.flatMap(d => series.map(s => d[s.key])), 0), 4);
  const top = ticks[ticks.length - 1] || 1;
  const group = iw / data.length;
  const barW = Math.min(14, (group * 0.6) / series.length);
  const gap = 4;
  const y = v => pad.t + ih - (v / top) * ih;
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={pad.l - 8} y={y(t)} className="axis-label" textAnchor="end" dominantBaseline="central">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + group * i + group / 2;
          const start = cx - (series.length * barW + (series.length - 1) * gap) / 2;
          return (
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect x={pad.l + group * i} y={pad.t} width={group} height={ih} fill="transparent" />
              {hover === i && <rect x={pad.l + group * i + 2} y={pad.t} width={group - 4} height={ih} rx="6" className="hover-band" />}
              {series.map((s, si) => {
                const h = d[s.key] ? Math.max(4, (d[s.key] / top) * ih) : 0;
                return <rect key={s.key} className="bar-v" style={{ animationDelay: `${i * 0.05 + si * 0.08}s` }} x={start + si * (barW + gap)} y={pad.t + ih - h} width={barW} height={h} rx={Math.min(barW / 2, 5)} fill={s.color} />;
              })}
              <text x={cx} y={height - 8} className="axis-label" textAnchor="middle">{labelOf(d)}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(pad.l + group * hover + group / 2, 90), width - 90), top: pad.t }}>
          <div className="tip-title">{labelOf(data[hover], true)}</div>
          {series.map(s => <div key={s.key} className="tip-row"><i style={{ background: s.color }} /><strong>{format(data[hover][s.key])}</strong><span>{s.label}</span></div>)}
        </div>
      )}
      <div className="legend" style={{ marginTop: 6 }}>
        {series.map(s => <span key={s.key} className="legend-item"><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}

/** Barres avec la dernière période mise en avant (valeur affichée au-dessus, survol pour les autres). */
export function HighlightBars({ data, labelOf, valueKey, format = v => v, height = 200, color = 'var(--series-1)' }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map(d => d[valueKey]));
  const active = hover ?? data.length - 1;
  return (
    <div className="hl-bars" style={{ height }} onPointerLeave={() => setHover(null)}>
      {data.map((d, i) => (
        <div key={i} className="hl-col" onPointerEnter={() => setHover(i)}>
          <span className={`hl-value tabular ${i === active ? 'on' : ''}`}>{format(d[valueKey])}</span>
          <div className="hl-track">
            <div className="hl-bar" style={{ height: `${Math.max(3, (d[valueKey] / max) * 100)}%`, background: i === active ? color : undefined, animationDelay: `${i * 0.07}s` }} />
          </div>
          <span className="axis-label small">{labelOf(d)}</span>
        </div>
      ))}
    </div>
  );
}

// Ordre fixe validé (dataviz) : bleu, orange, vert d'eau, jaune, magenta
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

/** Anneau de répartition : parts séparées, total au centre, légende avec valeurs et %. */
export function Donut({ items, format = v => v, centerLabel = 'Total', size = 190 }) {
  const [hover, setHover] = useState(null);
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total) return <p className="muted">Pas encore de données.</p>;
  // Au-delà de 5 parts, les plus petites sont regroupées dans « Autres »
  const shown = items.length > 5 ? [...items.slice(0, 4), { label: 'Autres', value: items.slice(4).reduce((a, b) => a + b.value, 0) }] : items;
  const r = 70, c = 2 * Math.PI * r, gapLen = shown.length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={shown.map(i => `${i.label} ${Math.round((i.value / total) * 100)} %`).join(', ')}>
        <g transform="rotate(-90 100 100)">
          {shown.map((it, i) => {
            const len = Math.max(0, (it.value / total) * c - gapLen);
            const seg = (
              <circle
                key={it.label} cx="100" cy="100" r={r} fill="none" stroke={CATEGORICAL[i]} strokeWidth={hover === i ? 30 : 24}
                className="donut-seg" style={{ '--len': `${len}px`, '--c': `${c}px`, animationDelay: `${i * 0.12}s`, opacity: hover != null && hover !== i ? 0.45 : 1 }}
                strokeDasharray={`${len} ${c}`} strokeDashoffset={-offset}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
              >
                <title>{`${it.label} : ${format(it.value)}`}</title>
              </circle>
            );
            offset += (it.value / total) * c;
            return seg;
          })}
        </g>
        <text x="100" y="96" textAnchor="middle" className="donut-total">{hover != null ? `${Math.round((shown[hover].value / total) * 100)} %` : format(total, true)}</text>
        <text x="100" y="116" textAnchor="middle" className="axis-label">{hover != null ? shown[hover].label.slice(0, 22) : centerLabel}</text>
      </svg>
      <div className="stack" style={{ gap: 6, flex: 1, minWidth: 200 }}>
        {shown.map((it, i) => (
          <div key={it.label} className="donut-legend" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <i style={{ background: CATEGORICAL[i] }} />
            <span className="small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
            <span className="small tabular"><strong>{Math.round((it.value / total) * 100)} %</strong></span>
            <span className="small muted tabular" style={{ minWidth: 64, textAlign: 'right' }}>{format(it.value, true)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
