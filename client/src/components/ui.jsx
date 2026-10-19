import { useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, RefreshCw, X } from 'lucide-react';

export function Badge({ tone = 'muted', plain, children }) {
  return <span className={`badge tone-${tone}${plain ? ' plain' : ''}`}>{children}</span>;
}

/** Anneau de progression (chantier). `light` : sur fond clair. */
export function Ring({ value = 0, size = 88, stroke = 7, label, light }) {
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(value)); return () => cancelAnimationFrame(t); }, [value]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={`ring${light ? ' light' : ''}`} style={{ width: size, height: size }} role="img" aria-label={`${value} % ${label || ''}`}>
      <svg width={size} height={size} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="ring-value" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, shown)) / 100)} />
      </svg>
      <div className="ring-label"><strong>{value}%</strong>{label && <small>{label}</small>}</div>
    </div>
  );
}

export function PayBar({ percent }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setW(percent)); return () => cancelAnimationFrame(t); }, [percent]);
  return <div className="paybar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, w)}%` }} /></div>;
}

export function PageHead({ eyebrow, title, sub, children }) {
  return (
    <header className="page-head reveal">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1 className="page-title">{title}</h1>
      {sub && <p className="page-sub">{sub}</p>}
      {children}
    </header>
  );
}

export function SectionHead({ title, children }) {
  return <div className="section-head"><h2 className="section-title">{title}</h2>{children}</div>;
}

export function Empty({ icon: Icon, title, text, children }) {
  return (
    <div className="empty">
      {Icon && <div className="empty-icon"><Icon aria-hidden="true" /></div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="card">
      <Empty icon={AlertCircle} title="Impossible d’afficher cette page" text={error?.message || 'Une erreur est survenue.'}>
        {onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}><RefreshCw aria-hidden="true" /> Réessayer</button>}
      </Empty>
    </div>
  );
}

export function Skeleton({ h = 18, w = '100%', r, style }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r, ...style }} aria-hidden="true" />;
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement">
      <div className="page-head"><Skeleton h={12} w={110} /><Skeleton h={34} w="60%" style={{ marginTop: 10 }} /></div>
      <Skeleton h={260} r={22} />
      <div className="grid grid-2" style={{ marginTop: 14 }}><Skeleton h={140} r={16} /><Skeleton h={140} r={16} /></div>
    </div>
  );
}

export function Spinner() {
  return <Loader2 className="spin" aria-hidden="true" />;
}

export function Alert({ tone = 'error', children }) {
  if (!children) return null;
  return <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><AlertCircle aria-hidden="true" /><div>{children}</div></div>;
}

/** Visionneuse plein écran des photos et vidéos de chantier. */
export function Lightbox({ items, index, onClose, onIndex, caption }) {
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

  const [touch, setTouch] = useState(null);
  const item = items[index];
  if (!item) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photos du chantier">
      <div className="lightbox-top">
        <span>{index + 1} / {items.length}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer"><X /></button>
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
        {item.kind === 'video'
          ? <video src={item.url} controls autoPlay playsInline />
          : <img src={item.url} alt={item.alt || caption || ''} />}
        {index > 0 && <button className="lightbox-nav prev" onClick={() => onIndex(index - 1)} aria-label="Photo précédente"><ChevronLeft /></button>}
        {index < items.length - 1 && <button className="lightbox-nav next" onClick={() => onIndex(index + 1)} aria-label="Photo suivante"><ChevronRight /></button>}
      </div>
      {caption && <div className="lightbox-caption">{caption}</div>}
    </div>
  );
}

/** Petit message éphémère en bas de l'écran. */
export function useToast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2800); return () => clearTimeout(t); }, [msg]);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg];
}

/** Panneau de détail : glisse du bas sur téléphone, fenêtre centrée sur ordinateur. */
export function Sheet({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="sheet-wrap" role="presentation" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-head">
          <div className="sheet-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer"><X /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Pagination simple : « ‹ Précédent · page x sur n · Suivant › ». */
export function Pager({ page, pages, onPage, label = 'Pagination' }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" className="pager-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente"><ChevronLeft aria-hidden="true" />Précédent</button>
      <span className="pager-info">Page <strong>{page}</strong> sur {pages}</span>
      <button type="button" className="pager-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Page suivante">Suivant<ChevronRight aria-hidden="true" /></button>
    </nav>
  );
}
