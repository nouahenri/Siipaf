import { useEffect } from 'react';
import { X, Inbox } from 'lucide-react';
import { lotStatus } from '../lib/domain';

export const Card = ({ title, actions, children, bodyClass = 'card-body', style }) => (
  <section className="card" style={style}>
    {(title || actions) && (
      <header className="card-head">
        {title && <h2>{title}</h2>}
        <div className="spacer" />
        {actions}
      </header>
    )}
    <div className={bodyClass}>{children}</div>
  </section>
);

/** Avancement du chantier : barre + pourcentage (listes clients et dossiers, dashboard et ERP). */
export const Advance = ({ value, title }) => (
  <div className="advance" title={title} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? 0} aria-label="Avancement du chantier">
    <div className="progress"><div style={{ width: `${value ?? 0}%` }} /></div>
    <span className="small tabular">{value ?? 0} %</span>
  </div>
);

export const Field = ({ label, hint, children, className = '' }) => (
  <label className={`field ${className}`}>
    <span>{label}</span>
    {children}
    {hint && <small>{hint}</small>}
  </label>
);

export const StatusBadge = ({ status }) => {
  const s = lotStatus(status);
  return <span className="badge status-badge"><i style={{ background: s.color }} />{s.label}</span>;
};

export const Badge = ({ tone = '', dot, children }) => (
  <span className={`badge ${tone ? `badge-${tone}` : ''} ${dot ? 'badge-dot' : ''}`}>{children}</span>
);

export const Empty = ({ icon: Icon = Inbox, children }) => (
  <div className="empty"><Icon />{children}</div>
);

export const Skeleton = ({ h = 16, w = '100%' }) => <div className="skeleton" style={{ height: h, width: w }} />;

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert" role="alert">{error.message || String(error)}</div>;
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function Drawer({ title, onClose, children, footer }) {
  useEscape(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer"><X /></button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </>
  );
}

export function Modal({ title, onClose, children, footer }) {
  useEscape(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <header className="drawer-head">
          <h2>{title}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer"><X /></button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </div>
    </>
  );
}

/** Barre de répartition horizontale (statuts de lots) avec légende et valeurs. */
export function DistributionBar({ items }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return <p className="muted">Aucun lot enregistré pour l’instant.</p>;
  return (
    <div>
      <div className="dist-bar" role="img" aria-label={items.map(i => `${i.label} : ${i.value}`).join(', ')}>
        {items.filter(i => i.value > 0).map(i => (
          <div key={i.id} style={{ flex: i.value, background: i.color }} title={`${i.label} : ${i.value} (${Math.round((i.value / total) * 100)} %)`} />
        ))}
      </div>
      <div className="legend">
        {items.map(i => (
          <span key={i.id} className="legend-item"><i style={{ background: i.color }} />{i.label} <b>{i.value}</b></span>
        ))}
      </div>
    </div>
  );
}

export const PAGE_SIZES = [5, 10, 15, 20, 25, 50, 75, 100];

/** Pagination avec choix du nombre de lignes par page. */
export function Pagination({ total, page, pageSize, onPage, onPageSize, label = 'éléments' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  // Numéros affichés : première, dernière et voisines de la page courante
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <div className="pager">
      <label className="row small muted" style={{ gap: 8 }}>
        Afficher
        <select className="select" style={{ width: 'auto', height: 32 }} value={pageSize} onChange={e => onPageSize(Number(e.target.value))} aria-label="Nombre de lignes par page">
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        par page
      </label>
      <span className="small muted tabular">{from}–{to} sur {total} {label}</span>
      <nav className="row" style={{ gap: 4 }} aria-label="Pagination">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente">‹</button>
        {nums.map((n, i) => (
          <span key={n} className="row" style={{ gap: 4 }}>
            {i > 0 && n - nums[i - 1] > 1 && <span className="muted">…</span>}
            <button className={`btn btn-sm ${n === page ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>
          </span>
        ))}
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Page suivante">›</button>
      </nav>
    </div>
  );
}

/** Tri naturel des numéros de lot : A2 avant A10. */
export const naturalCompare = (a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
