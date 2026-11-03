/** Affichage (clair, système, sombre) du compte : Dashboard › Paramètres et ERP › Paramètres (même préférence, PATCH /auth/preferences). */
import { useEffect, useState } from 'react';
import { useAuth, useToast, useSaved } from '../lib/app-context';
import { Card } from './ui';

export default function DisplaySettings() {
  const { theme, setTheme } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const [saving, setSaving] = useState(false);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const followSystem = theme === 'systeme';
  const dark = followSystem ? systemDark : theme === 'sombre';
  const pick = async value => {
    if (saving) return;
    setSaving(true);
    try { await setTheme(value); saved('Affichage enregistré pour votre compte'); } catch (e) { toast(e.message, 'err'); }
    finally { setSaving(false); }
  };
  return (
    <Card title="Affichage">
      <p className="small muted" style={{ marginBottom: 14 }}>Préférences d’affichage propres à votre compte.</p>
      <div className="display-settings" role="group" aria-label="Thème" aria-busy={saving}>
        <div className="display-setting">
          <div className="display-setting-copy">
            <strong id="display-system-label">Suivre le système</strong>
            <p id="display-system-help" className="small muted">Utilise le thème clair ou sombre de votre ordinateur ou téléphone.</p>
          </div>
          <button type="button" className="display-switch" role="switch" aria-checked={followSystem}
            aria-labelledby="display-system-label" aria-describedby="display-system-help" disabled={saving}
            onClick={() => pick(followSystem ? (dark ? 'sombre' : 'clair') : 'systeme')}>
            <span aria-hidden="true" />
          </button>
        </div>
        <div className="display-setting">
          <div className="display-setting-copy">
            <strong id="display-dark-label">Mode sombre</strong>
            <p id="display-dark-help" className="small muted">{followSystem ? 'Désactivez « Suivre le système » pour choisir manuellement.' : 'Désactivez pour utiliser le mode clair.'}</p>
          </div>
          <button type="button" className="display-switch" role="switch" aria-checked={dark}
            aria-labelledby="display-dark-label" aria-describedby="display-dark-help" disabled={saving || followSystem}
            onClick={() => pick(dark ? 'clair' : 'sombre')}>
            <span aria-hidden="true" />
          </button>
        </div>
      </div>
    </Card>
  );
}
