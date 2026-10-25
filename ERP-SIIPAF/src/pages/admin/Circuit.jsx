/**
 * Administration générale › Circuit d'information : pour chaque événement d'un module (étape de chantier déclarée,
 * situation validée, vente ouverte, acte signé…), les services prévenus par la cloche, en plus des personnes
 * directement concernées (conducteur, commercial de l'acquéreur, valideurs). Réglé par la Direction générale et
 * l'administrateur ; consultable par la Direction des exploitations.
 */
import { useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw, Info, Share2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Empty } from '@admin/components/ui';

const URL = '/admin/erp/notifications/circuit';
const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));

export default function Circuit() {
  const res = useResource(URL);
  const saved = useSaved();
  const toast = useToast();
  const [routes, setRoutes] = useState(null);
  const [saving, setSaving] = useState(false);
  const d = res.data;
  useEffect(() => { if (d) setRoutes(Object.fromEntries(d.events.map(e => [e.key, e.audiences]))); }, [d]);

  const audiences = d ? Object.entries(d.audiences) : [];
  const byModule = useMemo(() => {
    if (!d) return [];
    const groups = {};
    for (const e of d.events) (groups[e.module] = groups[e.module] || []).push(e);
    return Object.entries(groups).map(([m, events]) => ({ module: m, label: d.modules[m] || m, events }));
  }, [d]);
  const dirty = d && routes && d.events.some(e => !same(e.audiences, routes[e.key] || []));

  if (res.error) return <ErrorBox error={res.error} />;
  if (!d || !routes) return <Skeleton h={320} />;

  const toggle = (event, a) => setRoutes(r => ({ ...r, [event]: r[event].includes(a) ? r[event].filter(x => x !== a) : [...r[event], a] }));
  const save = async () => {
    setSaving(true);
    try {
      await api.put(URL, routes);
      saved('Circuit d’information enregistré');
      res.reload();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <div className="callout-erp"><Info /><span className="small">
        Chaque événement prévient par la cloche (badge et son) <b>les personnes directement concernées</b> — le conducteur qui a signalé l’étape,
        le commercial de l’acquéreur, les comptes qui valident — <b>et les services cochés ici</b>. Un compte présent dans plusieurs services ne reçoit qu’une notification,
        et personne n’est prévenu de sa propre action. Le dashboard affiche les mêmes notifications dans sa cloche.
      </span></div>
      <Card title="Qui est prévenu de quoi" bodyClass=""
        actions={d.can_edit && (
          <span className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost" disabled={!dirty || saving} onClick={() => setRoutes(Object.fromEntries(d.events.map(e => [e.key, e.audiences])))}><RotateCcw />Annuler</button>
            <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}><Save />Enregistrer</button>
          </span>
        )}>
        {!d.events.length ? <div className="card-body"><Empty icon={Share2}>Aucun événement.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>Événement</th>
                {audiences.map(([k, a]) => <th key={k} className="center" title={a.hint}><span className="small">{a.label}</span></th>)}
                {d.can_edit && <th />}
              </tr>
            </thead>
            {byModule.map(g => (
              <tbody key={g.module}>
                <tr><th colSpan={audiences.length + (d.can_edit ? 2 : 1)} className="small muted" style={{ background: 'var(--surface-2)' }}>{g.label}</th></tr>
                {g.events.map(e => {
                  const list = routes[e.key] || [];
                  const isDefault = same(list, e.defaults);
                  return (
                    <tr key={e.key}>
                      <td style={{ minWidth: 260 }}>{e.label}{!isDefault && <div className="small muted">modifié (par défaut : {e.defaults.map(a => d.audiences[a]?.label).join(', ') || 'personne'})</div>}</td>
                      {audiences.map(([k, a]) => (
                        <td key={k} className="center">
                          <input type="checkbox" checked={list.includes(k)} disabled={!d.can_edit} onChange={() => toggle(e.key, k)} aria-label={`${e.label} : prévenir ${a.label}`} />
                        </td>
                      ))}
                      {d.can_edit && (
                        <td className="right">
                          {!isDefault && <button className="btn btn-ghost btn-sm" onClick={() => setRoutes(r => ({ ...r, [e.key]: e.defaults }))} title="Revenir au réglage par défaut"><RotateCcw size={14} />Défaut</button>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table></div>
        )}
      </Card>
      <Card title="Les services">
        <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
          {audiences.map(([k, a]) => <li key={k} className="small"><b>{a.label}</b> : {a.hint}.</li>)}
        </ul>
        <p className="small muted" style={{ marginTop: 10 }}>Les comptes de chaque service se règlent dans Rôles et privilèges : un service regroupe les comptes qui ont ses droits.</p>
      </Card>
    </div>
  );
}
