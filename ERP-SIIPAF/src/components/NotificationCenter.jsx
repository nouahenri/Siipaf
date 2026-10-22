import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '@admin/lib/api';
import { relative } from '@admin/lib/format';

const POLL_MS = 30000;
const URL = '/admin/erp/notifications';

/**
 * Centre de notifications commun (docs/analyse-liaisons-inter-services.md §6.1) : interroge le serveur toutes les 30 s
 * et au retour sur l'onglet. L'événement « siipaf:erp-notifications » relance la lecture (après une action).
 */
export function useErpNotifications() {
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get(`${URL}?limit=40`).then(setData).catch(() => { /* réseau : prochain tour */ }), []);
  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('siipaf:erp-notifications', load);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('siipaf:erp-notifications', load); };
  }, [load]);
  const markRead = useCallback(body => api.post(`${URL}/read`, body).then(() => window.dispatchEvent(new Event('siipaf:erp-notifications'))).catch(() => {}), []);
  return { data, load, markRead };
}

export default function NotificationCenter() {
  const { data, markRead } = useErpNotifications();
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const unread = data?.unread || 0;

  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const go = n => {
    setOpen(false);
    if (!n.read) markRead({ ids: [n.id] });
    if (n.link) navigate(n.link);
  };
  const items = (data?.items || []).filter(n => !onlyUnread || !n.read);

  return (
    <div className="notif" ref={ref}>
      <button type="button" className={`btn btn-ghost btn-icon notif-btn ${unread ? 'ringing' : ''}`} onClick={() => setOpen(o => !o)}
        aria-label={unread ? `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}` : 'Notifications'} aria-expanded={open}>
        <Bell />
        {unread > 0 && <span className="notif-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel erp-notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            <div className="erp-notif-tools">
              <span className="erp-notif-seg" role="group" aria-label="Afficher">
                <button type="button" aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>Toutes</button>
                <button type="button" aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>Non lues</button>
              </span>
              {unread > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => markRead({})} title="Tout marquer comme lu"><CheckCheck size={16} />Tout lu</button>
              )}
            </div>
          </div>
          {items.length === 0
            ? <p className="notif-empty muted">{onlyUnread ? 'Rien de nouveau.' : 'Aucune notification pour l’instant.'}</p>
            : (
              <ul className="notif-list">
                {items.map(n => (
                  <li key={n.id}>
                    <button type="button" className={n.read ? '' : 'unread'} onClick={() => go(n)}>
                      <span className="notif-dot" aria-hidden="true" />
                      <span className="notif-body">
                        <b>{n.title}</b>
                        {n.body && <span className="small">{n.body}</span>}
                        <span className="small muted">
                          {n.priority === 'urgent' && <span className="erp-notif-urgent">Urgent · </span>}
                          {n.module_label} · {relative(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}
