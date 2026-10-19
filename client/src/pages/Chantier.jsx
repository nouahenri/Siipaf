import { useState } from 'react';
import { Camera, Check, Play } from 'lucide-react';
import { useSession, useResource } from '../lib/session';
import { api } from '../lib/api';
import { dayLabel, monthYear } from '../lib/format';
import { SITE_STAGES, SCOPE_LABELS, stageIndex } from '../lib/domain';
import { Badge, Empty, ErrorState, Lightbox, PageHead, PageSkeleton, PayBar, Ring, SectionHead } from '../components/ui';
import { NoDossier } from './Home';

function Stages({ current }) {
  const idx = stageIndex(current);
  return (
    <ol className="stages horizontal" aria-label="Étapes du chantier">
      {SITE_STAGES.map((s, i) => {
        const state = idx < 0 ? 'todo' : i < idx ? 'done' : i === idx ? 'current' : 'todo';
        return (
          <li key={s.id} className={`stage ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="stage-dot">{state === 'done' ? <Check aria-hidden="true" /> : i + 1}</span>
            <span className="stage-name">{s.label}</span>
            <span className="stage-state">{state === 'done' ? 'Terminé' : state === 'current' ? 'En cours' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Gallery({ media, onOpen }) {
  if (!media.length) return null;
  const shown = media.slice(0, 4);
  return (
    <div className={`update-media count-${shown.length}`}>
      {shown.map((m, i) => (
        <button key={m.id} type="button" onClick={() => onOpen(i)} aria-label={`Agrandir ${m.kind === 'video' ? 'la vidéo' : 'la photo'} ${i + 1}`}>
          {m.kind === 'video'
            ? <><video src={m.url} muted playsInline preload="metadata" /><span className="media-play"><span><Play aria-hidden="true" /></span></span></>
            : <img src={m.url} alt={m.alt || ''} loading="lazy" />}
          {i === 3 && media.length > 4 && <span className="media-more">+{media.length - 4}</span>}
        </button>
      ))}
    </div>
  );
}

export default function Chantier() {
  const { selected } = useSession();
  const { data, error, loading, reload } = useResource(selected ? `chantier:${selected.id}` : null, () => api.get(`/dossiers/${selected.id}/chantier`));
  const [viewer, setViewer] = useState(null);

  if (!selected) return <NoDossier />;
  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const updates = data.updates;
  const latest = updates[0];
  const delivery = data.property.project.delivery;

  return (
    <>
      <PageHead eyebrow={data.property.project.name} title="Avancement du chantier"
        sub={`Lot ${data.property.lot_code}${data.property.ilot ? ` · Îlot ${data.property.ilot}` : ''}${delivery ? ` · Délai de livraison : ${delivery}` : ''}`} />

      <section className="card card-pad reveal reveal-2">
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 22 }}>
          <Ring value={latest?.progress_pct ?? 0} light size={92} label="réalisé" />
          <div>
            <div className="money-label">Étape actuelle</div>
            <div className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>{latest ? latest.stage_label : 'Démarrage à venir'}</div>
            {latest && <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Mis à jour {dayLabel(latest.published_at).toLowerCase()}</div>}
          </div>
        </div>
        <Stages current={latest?.stage} />
      </section>

      <section className="section">
        <SectionHead title="Journal du chantier">{updates.length > 0 && <span className="muted" style={{ fontSize: 13 }}>{updates.length} publication{updates.length > 1 ? 's' : ''}</span>}</SectionHead>
        {updates.length === 0 ? (
          <div className="card"><Empty icon={Camera} title="Pas encore de publication" text="Nos équipes publieront ici les photos et les étapes franchies sur votre chantier." /></div>
        ) : (
          <div className="feed">
            {updates.map((u, i) => (
              <article key={u.id} className={`card update reveal reveal-${Math.min(i + 2, 4)}`}>
                <Gallery media={u.media} onOpen={idx => setViewer({ items: u.media, index: idx, caption: u.title })} />
                <div className="update-body">
                  <div className="update-meta">
                    <Badge tone="gold" plain>{u.stage_label}</Badge>
                    <span>{SCOPE_LABELS[u.scope]}{u.scope === 'ilot' && u.ilot ? ` (${u.ilot})` : ''}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={u.published_at}>{dayLabel(u.published_at)}</time>
                  </div>
                  <h3 className="update-title">{u.title}</h3>
                  {u.body && <p className="update-text">{u.body}</p>}
                  <div className="update-progress"><span>Avancement</span><PayBar percent={u.progress_pct} /><strong className="num" style={{ color: 'var(--ink)' }}>{u.progress_pct} %</strong></div>
                </div>
              </article>
            ))}
            <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>Début du journal · {monthYear(updates[updates.length - 1].published_at)}</p>
          </div>
        )}
      </section>

      {viewer && <Lightbox items={viewer.items} index={viewer.index} caption={viewer.caption} onClose={() => setViewer(null)} onIndex={index => setViewer(v => ({ ...v, index }))} />}
    </>
  );
}
