/**
 * Réglages d'un module sans page de réglages propre (Service commercial, Client & SAV, Administration générale) :
 * « Mes notifications » pour chaque compte, puis les paramètres du module (lib/domain.js : MODULE_SETTINGS), groupés,
 * chacun modifiable par les comptes qui en ont le droit. Valeurs par défaut = règles en place avant le réglage.
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useSaved } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Field } from '@admin/components/ui';
import NotificationPrefs from '../components/NotificationPrefs';

export default function ModuleSettings({ module }) {
  const url = `/admin/erp/reglages/${module}`;
  const res = useResource(url);
  const saved = useSaved();
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = res.data;
  useEffect(() => { if (d) setF(Object.fromEntries(Object.entries(d.values).map(([k, v]) => [k, String(v)]))); }, [d]);

  const groups = [];
  if (d) for (const [k, x] of Object.entries(d.fields)) {
    let g = groups.find(y => y.title === x.group);
    if (!g) groups.push(g = { title: x.group, fields: [] });
    g.fields.push([k, x]);
  }
  const editable = d ? Object.entries(d.fields).filter(([, x]) => x.can_edit) : [];

  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const out = await api.put(url, Object.fromEntries(editable.map(([k]) => [k, Number(f[k])])));
      setF(Object.fromEntries(Object.entries(out.values).map(([k, v]) => [k, String(v)])));
      saved('Réglages enregistrés');
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <NotificationPrefs module={module} />
      {res.error ? <ErrorBox error={res.error} /> : !d || !f ? <Skeleton h={220} /> : groups.length > 0 && (
        <form className="stack" onSubmit={save}>
          <ErrorBox error={error} />
          {groups.map(g => (
            <Card key={g.title} title={g.title}>
              <div className="form-grid">
                {g.fields.map(([k, x]) => (
                  <Field key={k} label={x.label} className="full"
                    hint={`${x.hint} (de ${x.min.toLocaleString('fr-FR')} à ${x.max.toLocaleString('fr-FR')} ; par défaut ${x.default.toLocaleString('fr-FR')})${x.can_edit ? '' : ` — réglé par ${x.who}`}`}>
                    <input className="input" type="number" required min={x.min} max={x.max} disabled={!x.can_edit} value={f[k]} onChange={e => setF(v => ({ ...v, [k]: e.target.value }))} style={{ maxWidth: 160 }} />
                  </Field>
                ))}
              </div>
            </Card>
          ))}
          {editable.length > 0 && <div><button className="btn btn-primary" disabled={busy}><Check />Enregistrer les paramètres</button></div>}
        </form>
      )}
    </div>
  );
}
