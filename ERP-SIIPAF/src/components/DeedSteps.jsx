/**
 * Circuit d'une vente jusqu'à l'acte (six étapes datées, choix du client du 23/10). Le juriste (juridique:write) date
 * chaque étape, choisit le notaire et note le n° d'acte ; le commercial et la Direction voient l'avancement.
 * L'acte signé fait passer le lot « vendu » et prévient le commercial, le comptable, la Direction et le client.
 */
import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { ErrorBox, Field, Skeleton } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { JUR } from '../lib/juridique';
import { today } from '../lib/rh';

export default function DeedSteps({ saleId, notaries = null, onChange }) {
  const { can } = useAuth();
  const write = can('juridique:write');
  const x = useResource(`${JUR}/actes/${saleId}`);
  // Ouvert ailleurs que dans Juridique › Ventes et actes : la liste des notaires est chargée ici
  const refs = useResource(write && !notaries ? `${JUR}/refs` : null);
  const notaryList = notaries || (refs.data ? refs.data.suppliers.filter(s => s.kind === 'notaire').concat(refs.data.suppliers.filter(s => s.kind !== 'notaire')) : []);
  const [edit, setEdit] = useState(null); // { key, date, notary_supplier_id, notary_ref, deed_number }
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const saved = useSaved();
  const d = x.data;
  if (x.error) return <ErrorBox error={x.error} />;
  if (!d) return <Skeleton h={160} />;

  const save = async (body, message) => {
    setBusy(true);
    try { x.setData(await api.post(`${JUR}/actes/${saleId}`, body)); setEdit(null); saved(message); onChange?.(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const open = s => setEdit({ key: s.key, date: s.date || today(), notary_supplier_id: d.notary_supplier_id || '', notary_ref: d.notary_ref || '', deed_number: d.deed_number || '' });
  const confirmAndSave = () => {
    const body = { key: edit.key, date: edit.date };
    if (edit.key === 'notaire') Object.assign(body, { notary_supplier_id: Number(edit.notary_supplier_id) || null, notary_ref: edit.notary_ref.trim() || null });
    if (edit.key === 'acte') body.deed_number = edit.deed_number.trim() || null;
    const first = edit.key === 'acte' && !d.steps.find(s => s.key === 'acte').date;
    if (first && !window.confirm('Acte signé : le lot passera « Vendu », et le commercial, le comptable, la Direction et le client (e-mail) seront prévenus. Confirmer ?')) return;
    save(body, first ? 'Acte enregistré, lot vendu' : 'Étape enregistrée');
  };
  const nextKey = d.current;
  // Dossier repris avec l'acte déjà signé : les étapes d'avant restent à dater, dans l'ordre
  const firstUndated = d.steps.find(s => !s.date)?.key;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <ol className="deed-steps">
        {d.steps.map((s, i) => {
          const editing = edit?.key === s.key;
          const canEdit = write && (s.date || s.key === nextKey || s.key === firstUndated);
          return (
            <li key={s.key} className={s.date ? 'done' : s.key === nextKey ? 'current' : ''}>
              <span className="deed-dot" aria-hidden="true">{s.date ? <Check size={12} /> : i + 1}</span>
              <div className="deed-body">
                <div className="row-between" style={{ gap: 8 }}>
                  <span><b>{s.label}</b>{s.date && <span className="small muted"> · {date(s.date)}</span>}</span>
                  {canEdit && !editing && <button className="btn btn-sm btn-ghost" onClick={() => open(s)}>{s.date ? <><Pencil />Corriger</> : 'Dater'}</button>}
                </div>
                {s.key === 'notaire' && d.notary_name && <div className="small muted">{d.notary_name}{d.notary_ref ? ` · dossier ${d.notary_ref}` : ''}</div>}
                {s.key === 'acte' && d.deed_number && <div className="small muted">Acte n° {d.deed_number}</div>}
                {editing && (
                  <div className="form-grid" style={{ marginTop: 8 }}>
                    <Field label="Date"><input className="input" type="date" value={edit.date} onChange={e => setEdit(v => ({ ...v, date: e.target.value }))} /></Field>
                    {s.key === 'notaire' && (
                      <>
                        <Field label="Notaire" hint="Fiche fournisseur de catégorie « Notaire » (Comptabilité › Achats et fournisseurs)">
                          <select className="select" value={edit.notary_supplier_id} onChange={e => setEdit(v => ({ ...v, notary_supplier_id: e.target.value }))}>
                            <option value="">— Choisir —</option>
                            {notaryList.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Référence du dossier à l’étude" className="full"><input className="input" maxLength={100} value={edit.notary_ref} onChange={e => setEdit(v => ({ ...v, notary_ref: e.target.value }))} /></Field>
                      </>
                    )}
                    {s.key === 'acte' && <Field label="N° de l’acte"><input className="input" maxLength={60} value={edit.deed_number} onChange={e => setEdit(v => ({ ...v, deed_number: e.target.value }))} /></Field>}
                    <div className="full row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-primary btn-sm" disabled={busy || !edit.date} onClick={confirmAndSave}><Check />Enregistrer</button>
                      {s.date && s.key !== 'acte' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save({ key: s.key, date: null }, 'Étape effacée')}><X />Effacer la date</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>Annuler</button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!write && <p className="small muted" style={{ margin: 0 }}>Étapes datées par le service juridique.</p>}
    </div>
  );
}
