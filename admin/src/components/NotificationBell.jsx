import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, Volume2, VolumeX } from 'lucide-react';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { SOURCES } from '../lib/domain';

const POLL_MS = 30000;
const MUTE_KEY = 'notifications.muted';
const readMuted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } };

// Carillon court à deux notes (Web Audio, sans fichier). Le navigateur ne joue un son
// qu'après une première interaction avec la page : avant, l'appel échoue sans bruit.
let audioCtx;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [[880, 0], [1318.5, 0.14]].forEach(([freq, at]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.5);
    });
  } catch { /* audio indisponible */ }
}

/**
 * Nouveaux prospects : interroge le serveur toutes les 30 s (et quand l'onglet revient, ou qu'une fiche est
 * ouverte) ; sonne quand le nombre de non-lus augmente. `new_leads` alimente le compteur du menu Prospects.
 */
export function useNotifications(enabled) {
  const [data, setData] = useState(null);
  const last = useRef(null);
  const [muted, setMuted] = useState(readMuted);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const load = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return api.get('/admin/notifications').then(d => {
      if (last.current != null && d.unread > last.current && !mutedRef.current) chime();
      last.current = d.unread;
      setData(d);
    }).catch(() => { /* réseau : on réessaie au prochain tour */ });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('siipaf:notifications', load);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('siipaf:notifications', load); };
  }, [enabled, load]);

  const markSeen = useCallback(() => {
    last.current = 0;
    setData(d => d && { ...d, unread: 0 });
    return api.post('/admin/notifications/seen').catch(() => {});
  }, []);

  const toggleMute = () => setMuted(m => {
    try { localStorage.setItem(MUTE_KEY, m ? '0' : '1'); } catch { /* stockage indisponible */ }
    if (m) chime(); // réactivé : on fait entendre le son
    return !m;
  });

  return { data, load, markSeen, muted, toggleMute };
}

const origin = n => (n.created_by_name ? `Saisi par ${n.created_by_name}` : SOURCES[n.source] || n.source);

export default function NotificationBell({ notif }) {
  const { data, markSeen, muted, toggleMute } = notif;
  const [open, setOpen] = useState(false);
  // Pendant l'ouverture, on garde la liste telle qu'elle était (points « non lu ») même si on la marque lue
  const [snapshot, setSnapshot] = useState(null);
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

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setSnapshot(data);
    setOpen(true);
    if (unread) markSeen();
  };
  const go = id => { setOpen(false); navigate(`/prospects?fiche=${id}`); };
  const items = (snapshot || data)?.items || [];

  return (
    <div className="notif" ref={ref}>
      <button type="button" className={`btn btn-ghost btn-icon notif-btn ${unread ? 'ringing' : ''}`} onClick={toggle}
        aria-label={unread ? `${unread} nouvelle${unread > 1 ? 's' : ''} notification${unread > 1 ? 's' : ''}` : 'Notifications'} aria-expanded={open}>
        {muted ? <BellOff /> : <Bell />}
        {unread > 0 && <span className="notif-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Nouveaux prospects">
          <div className="notif-head">
            <strong>Nouveaux prospects</strong>
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleMute} title={muted ? 'Réactiver le son' : 'Couper le son'}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}{muted ? 'Son coupé' : 'Son activé'}
            </button>
          </div>
          {items.length === 0
            ? <p className="notif-empty muted">Aucun prospect pour l’instant.</p>
            : (
              <ul className="notif-list">
                {items.map(n => (
                  <li key={n.id}>
                    <button type="button" className={n.unread ? 'unread' : ''} onClick={() => go(n.id)}>
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
          <button type="button" className="notif-foot" onClick={() => { setOpen(false); navigate('/prospects'); }}>Voir tous les prospects</button>
        </div>
      )}
    </div>
  );
}
