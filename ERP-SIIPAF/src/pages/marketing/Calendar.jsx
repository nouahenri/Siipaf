/**
 * Marketing & Communication › Calendrier éditorial : quatre semaines de contenus par jour, avec leur état. Le contenu de la
 * semaine à venir est préparé par l'IA ; la responsable de la communication relit, valide, planifie et marque publié.
 */
import { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Badge, Card, ErrorBox, Skeleton } from '@admin/components/ui';
import { MK, ModeBanner, CONTENT_TONES, addDays, mondayOf, todayIso, fr } from '../../lib/marketing';
import { ContentDrawer } from '../../components/MarketingContent';

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function Calendar() {
  const [from, setFrom] = useState(mondayOf(todayIso()));
  const [open, setOpen] = useState(null);
  const to = addDays(from, 27);
  const res = useResource(`${MK}/calendar?from=${from}&to=${to}`);
  const refs = useResource(`${MK}/refs`).data;
  if (res.error) return <ErrorBox error={res.error} />;
  const items = res.data?.items || [];
  const today = todayIso();
  const weeks = [0, 1, 2, 3].map(w => Array.from({ length: 7 }, (_, d) => addDays(from, w * 7 + d)));
  const undated = items.filter(i => !i.scheduled_for);

  return (
    <div className="stack">
      {refs && <ModeBanner mode={refs.mode} reason={refs.mode_reason} />}
      <div className="row-between">
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-ghost btn-icon" onClick={() => setFrom(f => addDays(f, -28))} aria-label="Quatre semaines plus tôt"><ChevronLeft /></button>
          <b>Du {fr(from)} au {fr(to)}</b>
          <button className="btn btn-ghost btn-icon" onClick={() => setFrom(f => addDays(f, 28))} aria-label="Quatre semaines plus tard"><ChevronRight /></button>
          <button className="btn btn-sm" onClick={() => setFrom(mondayOf(today))}>Aujourd’hui</button>
        </div>
        <div className="row small muted" style={{ gap: 8 }}>{Object.entries(refs?.content_statuses || {}).filter(([k]) => k !== 'archive').map(([k, l]) => <Badge key={k} tone={CONTENT_TONES[k]}>{l}</Badge>)}</div>
      </div>
      {!res.data ? <Skeleton h={420} /> : (
        <div className="mk-cal" role="table" aria-label="Calendrier éditorial">
          <div className="mk-cal-head" role="row">{DAYS.map(d => <span key={d} role="columnheader">{d}</span>)}</div>
          {weeks.map(w => (
            <div className="mk-cal-week" key={w[0]} role="row">
              {w.map(day => {
                const list = items.filter(i => i.scheduled_for === day);
                return (
                  <div key={day} role="cell" className={`mk-cal-day ${day === today ? 'today' : ''} ${day < today ? 'past' : ''}`}>
                    <span className="mk-cal-date">{Number(day.slice(8))}{day.slice(8) === '01' || day === from ? ` ${new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short' })}` : ''}</span>
                    {list.map(i => (
                      <button key={i.id} className={`mk-cal-item tone-${CONTENT_TONES[i.status] || 'none'}`} onClick={() => setOpen(i.id)} title={`${i.channel_label} — ${i.title} (${i.status_label})`}>
                        <b>{i.channel_label}</b><span>{i.title}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {undated.length > 0 && (
        <Card title="Sans jour prévu" bodyClass="">
          <ul className="list">{undated.map(i => <li key={i.id}><button className="list-row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(i.id)}><span><b>{i.title}</b> <span className="small muted">{i.channel_label} · {i.campaign_name}</span></span><Badge tone={CONTENT_TONES[i.status]}>{i.status_label}</Badge></button></li>)}</ul>
        </Card>
      )}
      <p className="small muted row" style={{ gap: 6 }}><CalendarDays size={14} aria-hidden="true" />Les jours des contenus se règlent dans leur fiche. Rien n’est publié automatiquement.</p>
      {open && <ContentDrawer id={open} onClose={() => setOpen(null)} onChanged={res.reload} />}
    </div>
  );
}
