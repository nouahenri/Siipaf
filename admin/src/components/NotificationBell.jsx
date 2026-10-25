import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CheckCheck, Volume2 } from 'lucide-react';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { SOURCES } from '../lib/domain';
import { playSound, soundFor } from '../lib/sounds';

const POLL_MS = 30000;
const ERP = '/admin/erp/notifications';
// L'ERP est sur erp.siipaf.com quand le dashboard est sur admin.siipaf.com (erp.localhost en local)
const erpUrl = path => `${window.location.protocol}//${window.location.host.replace(/^admin\./, 'erp.')}${path || '/'}`;

/**
 * Cloche du dashboard : nouveaux prospects (comptes qui les voient) et notifications des services de l'ERP
 * (circuit d'information : étapes de chantier, appels de fonds, actes, réclamations…) pour tous les comptes.
 * Interroge le serveur toutes les 30 s (et quand l'onglet revient, ou qu'une fiche est ouverte) ; joue le son
 * choisi par le compte (le même que dans l'ERP) quand le nombre de non-lus augmente. `new_leads` alimente le
 * compteur du menu Prospects.
 */
export function useNotifications(leadsEnabled) {
  const [leads, setLeads] = useState(null);
  const [erp, setErp] = useState(null);
  const last = useRef(null); // { leads, erp } du dernier passage
  const load = useCallback(() => Promise.all([
    leadsEnabled ? api.get('/admin/notifications').catch(() => null) : null,
    api.get(`${ERP}?limit=20`).catch(() => null),
  ]).then(([l, e]) => {
    if (l) setLeads(l);
    if (e) setErp(e);
    if (last.current) {
      const erpSound = e && soundFor(last.current.erp, e);
      if (erpSound) playSound(erpSound);
      else if (l && last.current.leads && l.unread > last.current.leads.unread) playSound(e?.prefs?.commercial?.sound || e?.sound || last.current.erp?.sound);
    }
    last.current = { leads: l || last.current?.leads, erp: e || last.current?.erp };
  }), [leadsEnabled]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('siipaf:notifications', load);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('siipaf:notifications', load); };
  }, [load]);

  // Ouvrir la cloche vaut lecture des nouveaux prospects ; les notifications des services se lisent une à une
  const markSeen = useCallback(() => {
    if (!leads?.unread) return Promise.resolve();
    if (last.current?.leads) last.current = { ...last.current, leads: { ...last.current.leads, unread: 0 } };
    setLeads(d => d && { ...d, unread: 0 });
    return api.post('/admin/notifications/seen').catch(() => {});
  }, [leads]);

  const markRead = useCallback(body => api.post(`${ERP}/read`, body).then(load).catch(() => {}), [load]);

  const chooseSound = useCallback(sound => {
    playSound(sound);
    return api.put(`${ERP}/son`, { sound }).then(load).catch(() => {});
  }, [load]);

  const data = leads || erp ? { ...(leads || {}), unread: (leads?.unread || 0) + (erp?.unread || 0) } : null;
  return { data, leads, erp, load, markSeen, markRead, chooseSound };
}

const origin = n => (n.created_by_name ? `Saisi par ${n.created_by_name}` : SOURCES[n.source] || n.source);

export default function NotificationBell({ notif }) {
  const { data, leads, erp, markSeen, markRead, chooseSound } = notif;
  const [open, setOpen] = useState(false);
  // Pendant l'ouverture, on garde la liste des prospects telle qu'elle était (points « non lu ») même si on la marque lue
  const [snapshot, setSnapshot] = useState(null);
  const ref = useRef(null);
  const navigate = useNavigate();
  const unread = data?.unread || 0;
  const sound = erp?.sound || 'carillon';

  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setSnapshot(leads);
    setOpen(true);
    markSeen();
  };
  const goLead = id => { setOpen(false); navigate(`/prospects?fiche=${id}`); };
  const goErp = n => {
    setOpen(false);
    (n.read ? Promise.resolve() : markRead({ ids: [n.id] })).finally(() => { window.location.href = erpUrl(n.link); });
  };
  const leadItems = (snapshot || leads)?.items || [];
  const erpItems = erp?.items || [];

  return (
    <div className="notif" ref={ref}>
      <button type="button" className={`btn btn-ghost btn-icon notif-btn ${unread ? 'ringing' : ''}`} onClick={toggle}
        aria-label={unread ? `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}` : 'Notifications'} aria-expanded={open}>
        {sound === 'aucun' ? <BellOff /> : <Bell />}
        {unread > 0 && <span className="notif-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {erp?.unread > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => markRead({})} title="Marquer lues les notifications des services"><CheckCheck size={16} />Tout lu</button>}
          </div>
          <div className="notif-scroll">
            {leads && (
              <>
                <div className="notif-section">Nouveaux prospects</div>
                {leadItems.length === 0
                  ? <p className="notif-empty muted">Aucun prospect pour l’instant.</p>
                  : (
                    <ul className="notif-list">
                      {leadItems.map(n => (
                        <li key={`p${n.id}`}>
                          <button type="button" className={n.unread ? 'unread' : ''} onClick={() => goLead(n.id)}>
                            <span className="notif-dot" aria-hidden="true" />
                            <span className="notif-body">
                              <b>{n.name}</b>
                              <span className="small">{[n.project_name, n.property_type].filter(Boolean).join(' · ') || n.phone || '—'}</span>
                              <span className="small muted">{origin(n)} · {relative(n.alert_at)}{n.alert_at && !n.seen_at ? ' · à traiter' : ''}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </>
            )}
            <div className="notif-section">Services SIIPAF (ERP)</div>
            {erpItems.length === 0
              ? <p className="notif-empty muted">Aucune information des services pour l’instant.</p>
              : (
                <ul className="notif-list">
                  {erpItems.map(n => (
                    <li key={`e${n.id}`}>
                      <button type="button" className={n.read ? '' : 'unread'} onClick={() => goErp(n)}>
                        <span className="notif-dot" aria-hidden="true" />
                        <span className="notif-body">
                          <b>{n.title}</b>
                          {n.body && <span className="small">{n.body}</span>}
                          <span className="small muted">{n.priority === 'urgent' ? 'Urgent · ' : ''}{n.module_label} · {relative(n.created_at)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </div>
          {erp?.sounds && (
            <div className="notif-sound">
              <label className="small muted" htmlFor="notif-sound">Son des notifications</label>
              <select id="notif-sound" className="select" value={sound} onChange={e => chooseSound(e.target.value)}>
                {Object.entries(erp.sounds).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => playSound(sound)} disabled={sound === 'aucun'} aria-label="Écouter le son" title="Écouter"><Volume2 size={16} /></button>
            </div>
          )}
          {leads && <button type="button" className="notif-foot" onClick={() => { setOpen(false); navigate('/prospects'); }}>Voir tous les prospects</button>}
        </div>
      )}
    </div>
  );
}
