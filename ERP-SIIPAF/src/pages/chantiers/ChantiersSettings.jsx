/**
 * Chantiers › Réglages : seuil d'alerte du budget, heures de travail par mois (coût horaire tiré du salaire).
 * Distincts des Paramètres du dashboard ; modifiables par les gestionnaires des chantiers.
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Field } from '@admin/components/ui';
import { CH } from '../../lib/chantiers';

export default function ChantiersSettings() {
  const { can } = useAuth();
  const saved = useSaved();
  const refs = useResource(`${CH}/refs`);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (refs.data) setF(Object.fromEntries(Object.entries(refs.data.settings).map(([k, v]) => [k, String(v)]))); }, [refs.data]);
  if (refs.error) return <ErrorBox error={refs.error} />;
  if (!refs.data || !f) return <Skeleton h={200} />;
  const fields = refs.data.setting_fields;
  const write = can('chantiers:write');
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const out = await api.put(`${CH}/reglages`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])));
      setF(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, String(v)])));
      saved('Réglages enregistrés');
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Card title="Réglages des chantiers">
      <form className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        {Object.entries(fields).map(([k, x]) => (
          <Field key={k} label={x.label} hint={`${x.hint} (de ${x.min} à ${x.max} ; par défaut ${x.default})`} className="full">
            <input className="input" type="number" required min={x.min} max={x.max} disabled={!write} value={f[k]} onChange={e => setF(v => ({ ...v, [k]: e.target.value }))} style={{ maxWidth: 160 }} />
          </Field>
        ))}
        {write && <div className="full"><button className="btn btn-primary" disabled={busy}><Check />Enregistrer</button></div>}
      </form>
    </Card>
  );
}
