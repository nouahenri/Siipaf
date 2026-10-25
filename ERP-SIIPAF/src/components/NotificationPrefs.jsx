/**
 * Réglages d'un module › Mes notifications : chaque compte active ou coupe les notifications du module dans sa
 * cloche (ERP et dashboard) et choisit leur son (par défaut, le son général choisi dans la cloche).
 */
import { useEffect, useState } from 'react';
import { Bell, BellOff, Volume2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox } from '@admin/components/ui';
import { playSound } from '@admin/lib/sounds';

const URL = '/admin/erp/notifications';

export default function NotificationPrefs({ module }) {
  const res = useResource(`${URL}?limit=1`);
  const saved = useSaved();
  const toast = useToast();
  const [pref, setPref] = useState(null);
  const d = res.data;
  useEffect(() => { if (d) setPref({ enabled: true, sound: null, ...(d.prefs?.[module] || {}) }); }, [d, module]);
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d || !pref) return <Skeleton h={120} />;

  const label = d.modules?.[module] || module;
  const effective = pref.sound || d.sound;
  const save = async next => {
    const before = pref;
    setPref(next);
    try {
      await api.put(`${URL}/preferences`, { module, enabled: next.enabled, sound: next.sound });
      window.dispatchEvent(new Event('siipaf:erp-notifications'));
      saved(next.enabled === before.enabled ? 'Son enregistré' : next.enabled ? 'Notifications activées' : 'Notifications coupées');
    } catch (e) { setPref(before); toast(e.message, 'err'); }
  };

  return (
    <Card title="Mes notifications" actions={<span className="small muted">{label} · réglage de votre compte</span>}>
      <div className="stack" style={{ gap: 14 }}>
        <label className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={pref.enabled} onChange={e => save({ ...pref, enabled: e.target.checked })} style={{ marginTop: 3 }} />
          <span className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
            <b className="row" style={{ gap: 6 }}>{pref.enabled ? <Bell size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}Recevoir les notifications du module {label}</b>
            <span className="small muted">Dans la cloche de l’ERP et du dashboard, avec badge et son. Coupées, les tâches restent visibles dans le module (compteurs du menu, listes à traiter).</span>
          </span>
        </label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="small muted" htmlFor={`son-${module}`}>Son des notifications du module</label>
          <select id={`son-${module}`} className="select" style={{ width: 'auto', maxWidth: '100%' }} disabled={!pref.enabled} value={pref.sound || ''}
            onChange={e => { const sound = e.target.value || null; playSound(sound || d.sound); save({ ...pref, sound }); }}>
            <option value="">Son général : {d.sounds[d.sound]}</option>
            {Object.entries(d.sounds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!pref.enabled || effective === 'aucun'} onClick={() => playSound(effective)}><Volume2 size={16} />Écouter</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Le son général se règle dans la cloche, en haut à droite ; il vaut pour les modules laissés sur « Son général ».</p>
      </div>
    </Card>
  );
}

/**
 * Page Réglages d'un module : « Mes notifications » pour tout compte du module, puis les paramètres du module pour
 * les comptes qui y ont droit (`allowed`).
 */
export function SettingsShell({ module, allowed, who, children }) {
  return (
    <div className="stack">
      <NotificationPrefs module={module} />
      {allowed ? children : <p className="small muted">Les paramètres du module sont réglés par {who}.</p>}
    </div>
  );
}
