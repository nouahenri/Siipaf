import { useState } from 'react';
import { useWidth, niceTicks, monthLabel, monthLong } from '@admin/components/Charts';

/**
 * Barres positives et négatives autour de zéro (résultat mensuel) : bénéfice en vert, perte en rouge,
 * survol avec info-bulle, barres qui poussent à l'apparition de la carte (animation « bar-v » du dashboard).
 */
export default function SignedBars({ data, xKey = 'month', valueKey, label, format = v => v, height = 240, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { t: 14, r: 12, b: 28, l: 56 };
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const maxPos = Math.max(0, ...data.map(d => d[valueKey]));
  const maxNeg = Math.max(0, ...data.map(d => -d[valueKey]));
  const ticksPos = niceTicks(maxPos || (maxNeg ? 0 : 1), 3).filter(t => t > 0 || !maxNeg);
  const ticksNeg = maxNeg ? niceTicks(maxNeg, 2).filter(t => t > 0) : [];
  const top = ticksPos.length ? ticksPos[ticksPos.length - 1] : 0;
  const bottom = ticksNeg.length ? ticksNeg[ticksNeg.length - 1] : 0;
  const span = top + bottom || 1;
  const y = v => pad.t + ((top - v) / span) * ih;
  const group = iw / data.length;
  const barW = Math.min(22, group * 0.56);
  const zero = y(0);
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {[...ticksPos, 0, ...ticksNeg.map(t => -t)].map(t => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis-zero' : 'grid-line'} strokeDasharray={t === 0 ? undefined : '3 4'} />
            {(t === 0 || Math.abs(y(t) - zero) > 14) && <text x={pad.l - 8} y={y(t)} className="axis-label" textAnchor="end" dominantBaseline="central">{format(t, true)}</text>}
          </g>
        ))}
        {data.map((d, i) => {
          const v = d[valueKey];
          const cx = pad.l + group * i + group / 2;
          const h = Math.max(v ? 3 : 0, Math.abs(y(v) - zero));
          const step = Math.ceil(data.length / Math.max(2, Math.floor(iw / 56)));
          return (
            <g key={d[xKey]} onPointerEnter={() => setHover(i)}>
              <rect x={pad.l + group * i} y={pad.t} width={group} height={ih} fill="transparent" />
              {hover === i && <rect x={pad.l + group * i + 2} y={pad.t} width={group - 4} height={ih} rx="6" className="hover-band" />}
              <rect className={`bar-v ${v < 0 ? 'neg' : ''}`} style={{ animationDelay: `${i * 0.05}s` }}
                x={cx - barW / 2} y={v >= 0 ? zero - h : zero} width={barW} height={h} rx={Math.min(barW / 2, 5)} fill={v >= 0 ? '#1baf7a' : 'var(--danger)'} />
              {(i % step === 0 || i === data.length - 1) && <text x={cx} y={height - 8} className="axis-label" textAnchor="middle">{monthLabel(d[xKey])}</text>}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(pad.l + group * hover + group / 2, 90), width - 90), top: pad.t }}>
          <div className="tip-title">{monthLong(data[hover][xKey])}</div>
          <div className="tip-row"><i style={{ background: data[hover][valueKey] >= 0 ? '#1baf7a' : 'var(--danger)' }} /><strong>{format(data[hover][valueKey])}</strong><span>{label}</span></div>
        </div>
      )}
    </div>
  );
}
