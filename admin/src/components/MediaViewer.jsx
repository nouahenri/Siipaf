/**
 * Vignettes de photos et vidéos (chantier, journal, avancement client) : un clic ouvre la visionneuse plein écran,
 * photo en grand ou vidéo lue, avec précédent / suivant (flèches du clavier, glisser sur mobile) — même visionneuse
 * que l'espace client. Partagée par le dashboard et l'ERP.
 */
import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Play } from 'lucide-react';

const isVideo = m => m.kind === 'video' || String(m.mime || '').startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(m.url || '');

export function Lightbox({ items, index, onClose, onIndex, caption }) {
  const [touch, setTouch] = useState(null);
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [index, items.length, onClose, onIndex]);
  const item = items[index];
  if (!item) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={caption || 'Photos et vidéos'} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lightbox-top">
        <span>{index + 1} / {items.length}</span>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer"><X /></button>
      </div>
      <div className="lightbox-stage"
        onTouchStart={e => setTouch(e.touches[0].clientX)}
        onTouchEnd={e => {
          if (touch == null) return;
          const dx = e.changedTouches[0].clientX - touch;
          if (dx < -50 && index < items.length - 1) onIndex(index + 1);
          if (dx > 50 && index > 0) onIndex(index - 1);
          setTouch(null);
        }}>
        {isVideo(item)
          ? <video key={item.url} src={item.url} controls autoPlay playsInline />
          : <img src={item.url} alt={item.alt || caption || ''} />}
        {index > 0 && <button type="button" className="lightbox-nav prev" onClick={() => onIndex(index - 1)} aria-label="Précédent"><ChevronLeft /></button>}
        {index < items.length - 1 && <button type="button" className="lightbox-nav next" onClick={() => onIndex(index + 1)} aria-label="Suivant"><ChevronRight /></button>}
      </div>
      {caption && <div className="lightbox-caption">{caption}</div>}
    </div>
  );
}

/** Vignettes cliquables ; `actions(item)` ajoute un bouton sur la vignette (retirer la photo…). */
export function MediaThumbs({ items, caption, actions, width = 96, height = 72 }) {
  const [open, setOpen] = useState(null);
  if (!items?.length) return null;
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {items.map((m, i) => (
          <span key={m.id ?? m.url} className="media-thumb" style={{ width, height }}>
            <button type="button" onClick={() => setOpen(i)} aria-label={isVideo(m) ? 'Lire la vidéo' : 'Voir la photo en grand'}>
              {isVideo(m) ? <><video src={m.url} muted preload="metadata" /><span className="media-play" aria-hidden="true"><Play /></span></> : <img src={m.url} alt={m.alt || m.name || ''} loading="lazy" />}
            </button>
            {actions?.(m)}
          </span>
        ))}
      </div>
      {open != null && <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} caption={caption} />}
    </>
  );
}
