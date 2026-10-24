/**
 * Planning d'un chantier (Gantt) : une ligne par phase, barre prévue (avec son avancement) et barre réelle en
 * dessous, ligne du jour, jalons des tâches. Le cadre défile horizontalement sur un petit écran.
 */
import { date } from '@admin/lib/format';

const DAY = 86400000;
const ms = d => Date.parse(`${d}T00:00:00Z`);
const iso = t => new Date(t).toISOString().slice(0, 10);
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export default function Gantt({ phases, milestones = [], today = iso(Date.now()), onSelect }) {
  const dates = [today, ...phases.flatMap(p => [p.planned_start, p.planned_end, p.actual_start, p.actual_end]), ...milestones.map(m => m.due_on)].filter(Boolean);
  const dated = phases.some(p => p.planned_start || p.actual_start);
  if (!dated) return <p className="small muted">Datez le début et la fin prévus des phases pour voir le planning.</p>;
  const start = Math.min(...dates.map(ms)) - 3 * DAY;
  const end = Math.max(...dates.map(ms)) + 4 * DAY;
  const span = end - start;
  const x = d => ((ms(d) - start) / span) * 100;
  const w = (a, b) => Math.max(0.6, ((ms(b) + DAY - ms(a)) / span) * 100);
  const width = Math.min(2400, Math.max(640, Math.round(span / DAY) * 3));

  // Repères : le premier de chaque mois (un sur trois au-delà de 18 mois)
  const ticks = [];
  const d = new Date(start);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const step = span / DAY > 540 ? 3 : 1;
  while (d.getTime() < end) {
    ticks.push({ at: ((d.getTime() - start) / span) * 100, label: `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 || !ticks.length ? ` ${d.getUTCFullYear()}` : ''}` });
    d.setUTCMonth(d.getUTCMonth() + step);
  }

  return (
    <div className="gantt-wrap" role="figure" aria-label="Planning des phases du chantier">
      <div className="gantt" style={{ '--track': `${width}px` }}>
        <div className="gantt-row gantt-head">
          <div className="gantt-label">Phase</div>
          <div className="gantt-track">{ticks.map(t => <span key={t.at} className="gantt-tick" style={{ left: `${t.at}%` }}>{t.label}</span>)}</div>
        </div>
        {phases.map(p => {
          const realEnd = p.actual_end || (p.actual_start ? today : null);
          return (
            <button type="button" key={p.id} className={`gantt-row gantt-phase ${p.state}`} onClick={() => onSelect?.(p)}
              aria-label={`${p.label} : ${p.state_label}, ${p.progress_pct} %`}>
              <div className="gantt-label"><b>{p.label}</b><span className="small muted">{p.progress_pct} %{p.late_days > 0 && p.state !== 'termine' ? ` · ${p.late_days} j de retard` : ''}</span></div>
              <div className="gantt-track">
                {ticks.map(t => <i key={t.at} className="gantt-grid" style={{ left: `${t.at}%` }} />)}
                {p.planned_start && p.planned_end && (
                  <span className="gantt-plan" style={{ left: `${x(p.planned_start)}%`, width: `${w(p.planned_start, p.planned_end)}%` }}
                    title={`Prévu : ${date(p.planned_start)} → ${date(p.planned_end)}`}>
                    <span className="gantt-fill" style={{ width: `${p.progress_pct}%` }} />
                  </span>
                )}
                {p.actual_start && realEnd && (
                  <span className="gantt-real" style={{ left: `${x(p.actual_start)}%`, width: `${w(p.actual_start, realEnd)}%` }}
                    title={`Réel : ${date(p.actual_start)} → ${p.actual_end ? date(p.actual_end) : 'en cours'}`} />
                )}
                <i className="gantt-today" style={{ left: `${x(today)}%` }} />
              </div>
            </button>
          );
        })}
        {milestones.length > 0 && (
          <div className="gantt-row">
            <div className="gantt-label"><b>Jalons</b></div>
            <div className="gantt-track">
              {milestones.map(m => <span key={m.id} className={`gantt-milestone ${m.status === 'fait' ? 'done' : m.late ? 'late' : ''}`} style={{ left: `${x(m.due_on)}%` }} title={`${m.title} — ${date(m.due_on)}`} />)}
              <i className="gantt-today" style={{ left: `${x(today)}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="gantt-legend small muted">
        <span><i className="lg-plan" />Prévu (avancement en couleur)</span><span><i className="lg-real" />Réel</span><span><i className="lg-today" />Aujourd’hui</span>
        {milestones.length > 0 && <span><i className="lg-ms" />Jalon</span>}
      </div>
    </div>
  );
}
