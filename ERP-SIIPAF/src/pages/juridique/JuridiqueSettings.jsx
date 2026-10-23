/**
 * Juridique › Réglages (choix du client du 23/10 : réglables dans l'ERP, pas dans le dashboard) : seuil de transmission
 * des impayés, délai de garantie des retenues, sortes de cautions (ajout, renommage, archivage).
 */
import { useEffect, useState } from 'react';
import { Check, Plus, Archive, Undo2, Pencil } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Field, Badge } from '@admin/components/ui';
import { JUR } from '../../lib/juridique';

const HINTS = {
  legal_unpaid_days: 'Le commercial est prévenu dès le premier jour de retard ; à partir de ce nombre de jours, le dossier apparaît dans Juridique › Impayés et le juriste est prévenu.',
  legal_warranty_months: 'Date de libération proposée pour une retenue de garantie, comptée depuis la réception des travaux (modifiable sur chaque retenue).',
};

export default function JuridiqueSettings() {
  const { can } = useAuth();
  const write = can('juridique:write');
  const saved = useSaved();
  const toast = useToast();
  const refs = useResource(`${JUR}/refs`);
  const [values, setValues] = useState(null);
  const [kind, setKind] = useState({ label: '', direction: 'recue' });
  const [editing, setEditing] = useState(null); // { id, label }
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (refs.data && !values) setValues(Object.fromEntries(Object.entries(refs.data.settings).map(([k, v]) => [k, String(v)]))); }, [refs.data, values]);
  if (refs.error) return <ErrorBox error={refs.error} />;
  if (!refs.data || !values) return <Skeleton h={300} />;
  const r = refs.data;

  const saveSettings = async e => {
    e.preventDefault(); setBusy(true);
    try {
      const data = await api.put(`${JUR}/reglages`, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])));
      refs.setData(x => ({ ...x, settings: data }));
      setValues(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])));
      saved('Réglages enregistrés');
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  const kinds = async (call, message) => {
    setBusy(true);
    try { const list = await call(); refs.setData(x => ({ ...x, guarantee_kinds: list.map(k => ({ ...k, active: !!k.active })) })); saved(message); return true; } catch (err) { toast(err.message, 'err'); return false; } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <Card title="Seuils et délais">
        <form className="form-grid" onSubmit={saveSettings}>
          {Object.entries(r.setting_fields).map(([k, s]) => (
            <Field key={k} label={s.label} hint={`${HINTS[k]} Par défaut : ${s.default}.`}>
              <input className="input" type="number" min={s.min} max={s.max} required disabled={!write} value={values[k]} onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))} />
            </Field>
          ))}
          {write && <div className="full"><button className="btn btn-primary" disabled={busy}><Check />Enregistrer</button></div>}
        </form>
      </Card>

      <Card title="Sortes de cautions et garanties" bodyClass="">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Sorte</th><th>Sens</th><th>État</th>{write && <th />}</tr></thead>
          <tbody>{r.guarantee_kinds.map(k => (
            <tr key={k.id}>
              <td>{editing?.id === k.id ? (
                <form className="row" style={{ gap: 6 }} onSubmit={async e => { e.preventDefault(); if (await kinds(() => api.patch(`${JUR}/sortes/${k.id}`, { label: editing.label }), 'Sorte renommée')) setEditing(null); }}>
                  <input className="input" required minLength={2} maxLength={120} value={editing.label} onChange={e => setEditing(x => ({ ...x, label: e.target.value }))} aria-label="Nouveau nom" />
                  <button className="btn btn-sm btn-primary" disabled={busy}><Check /></button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Annuler</button>
                </form>
              ) : k.label}</td>
              <td className="small">{r.directions[k.direction]}</td>
              <td>{k.active ? <Badge tone="ok">Proposée</Badge> : <Badge>Archivée</Badge>}</td>
              {write && (
                <td className="right nowrap">
                  <button className="btn btn-ghost btn-icon" onClick={() => setEditing({ id: k.id, label: k.label })} aria-label={`Renommer ${k.label}`}><Pencil /></button>
                  <button className="btn btn-ghost btn-icon" disabled={busy} onClick={() => kinds(() => api.patch(`${JUR}/sortes/${k.id}`, { active: !k.active }), k.active ? 'Sorte archivée' : 'Sorte rétablie')} aria-label={k.active ? `Archiver ${k.label}` : `Rétablir ${k.label}`} title={k.active ? 'Archiver (n’est plus proposée)' : 'Rétablir'}>{k.active ? <Archive /> : <Undo2 />}</button>
                </td>
              )}
            </tr>
          ))}</tbody>
        </table></div>
        {write && (
          <form className="card-body form-grid" onSubmit={async e => { e.preventDefault(); if (await kinds(() => api.post(`${JUR}/sortes`, kind), 'Sorte ajoutée')) setKind({ label: '', direction: 'recue' }); }}>
            <Field label="Nouvelle sorte"><input className="input" required minLength={2} maxLength={120} value={kind.label} onChange={e => setKind(x => ({ ...x, label: e.target.value }))} placeholder="Caution de paiement, garantie à première demande…" /></Field>
            <Field label="Sens" hint="Ne change plus une fois des cautions enregistrées"><select className="select" value={kind.direction} onChange={e => setKind(x => ({ ...x, direction: e.target.value }))}>{Object.entries(r.directions).map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></Field>
            <div className="full"><button className="btn" disabled={busy}><Plus />Ajouter la sorte</button></div>
          </form>
        )}
      </Card>
    </div>
  );
}
