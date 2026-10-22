/**
 * Paramètres : listes de référence (menus déroulants et cases à cocher des projets),
 * réglages généraux et thème d'affichage du compte.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2, ArrowUp, ArrowDown, Archive, ArchiveRestore, MapPin, Building, Building2, Dumbbell, Store, Construction, Home, SlidersHorizontal, Palette } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast, useSaved } from '../lib/app-context';
import { Card, Field, ErrorBox, Skeleton, Badge, Empty } from '../components/ui';

const ICONS = { ville: Building, localisation: MapPin, equipement: Dumbbell, commodite: Store, viabilisation: Construction, type_projet: Building2, type_bien: Home };
const HELP = {
  ville: 'Villes proposées dans la fiche projet.',
  localisation: 'Quartiers, communes ou sites, rattachés à une ville : la fiche projet ne propose que ceux de la ville choisie.',
  equipement: 'Équipements du programme (cases à cocher dans la fiche projet), affichés sur le site.',
  commodite: 'Commodités à proximité (écoles, marché, santé…), affichées sur le site.',
  viabilisation: 'Travaux de viabilisation d’un lotissement : chaque élément coché porte son état (prévu, en cours, réalisé), visible par les acheteurs.',
  type_projet: 'Type de projet affiché sur la fiche projet (informatif). Un type dont le nom contient « lotissement » range le projet dans Projets › Lotissements sur le site.',
  type_bien: 'Type de biens du projet et de sa grille de prix. Cochez les types de projet concernés : la fiche projet ne propose que ceux-là (lotissement → terrains…). Il donne aussi le libellé du bouton de création dans Biens & disponibilités (villa, appartement, lot…).',
};

export default function Settings() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const refs = useResource('/admin/refs');
  const section = params.get('section') || 'ville';
  const go = s => setParams({ section: s }, { replace: true });

  if (refs.loading && !refs.data) return <Skeleton h={400} />;
  if (refs.error) return <ErrorBox error={refs.error} />;
  const { kinds, items } = refs.data;
  const count = k => items.filter(i => i.kind === k && !i.archived).length;

  return (
    <div className="settings-layout">
      <nav className="card settings-nav" aria-label="Rubriques des paramètres">
        {Object.entries(kinds).map(([k, meta]) => {
          const Icon = ICONS[k] || SlidersHorizontal;
          return <button key={k} aria-current={section === k} onClick={() => go(k)}><Icon aria-hidden="true" />{meta.label}<span className="n">{count(k)}</span></button>;
        })}
        <div className="sep" />
        <button aria-current={section === 'general'} onClick={() => go('general')}><SlidersHorizontal aria-hidden="true" />Réglages généraux</button>
        <button aria-current={section === 'affichage'} onClick={() => go('affichage')}><Palette aria-hidden="true" />Affichage</button>
      </nav>
      <div className="stack">
        {kinds[section] && <RefList kind={section} data={refs.data} editable={can('settings:write')} reload={refs.reload} />}
        {section === 'general' && <General editable={can('settings:write')} />}
        {section === 'affichage' && <Display />}
      </div>
    </div>
  );
}

function RefList({ kind, data, editable, reload }) {
  const toast = useToast();
  const meta = data.kinds[kind];
  const parentKind = meta.parent;
  const featureKinds = Object.keys(data.kinds).filter(k => data.kinds[k].feature);
  const parents = data.items.filter(i => i.kind === parentKind);
  const [label, setLabel] = useState('');
  const [parentId, setParentId] = useState('');
  const [filter, setFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState(null);

  const all = useMemo(() => data.items.filter(i => i.kind === kind), [data.items, kind]);
  const archivedCount = all.filter(i => i.archived).length;
  const rows = all.filter(i => (showArchived || !i.archived) && (!filter || String(i.parent_id) === filter));
  const parentName = id => parents.find(p => p.id === id)?.label || '—';

  const run = async (fn, ok) => {
    setError(null);
    try { await fn(); if (ok) toast(ok); await reload(); } catch (e) { setError(e); }
  };
  const add = e => {
    e.preventDefault();
    if (!label.trim()) return;
    const pid = Number(parentId || filter) || null;
    run(async () => { await api.post('/admin/refs', { kind, label, parent_id: pid }); setLabel(''); }, `« ${label.trim()} » ajouté`);
  };
  const rename = (item, value) => {
    if (!value.trim() || value.trim() === item.label) return;
    run(() => api.patch(`/admin/refs/${item.id}`, { label: value }), 'Renommé — les projets concernés sont à jour');
  };
  const move = (i, d) => {
    const ids = all.map(x => x.id);
    const a = ids.indexOf(rows[i].id), b = ids.indexOf(rows[i + d].id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    run(() => api.put('/admin/refs/order', { ids }));
  };
  // Type de biens : types de projet auxquels il s'applique (la fiche projet ne propose que ceux-là)
  const scopes = meta.scope ? data.items.filter(i => i.kind === meta.scope && !i.archived) : [];
  const setScope = (item, scopeId, on) => {
    const current = item.project_types || [];
    const next = on ? [...current, scopeId] : current.filter(x => x !== scopeId);
    run(() => api.patch(`/admin/refs/${item.id}`, { project_types: next }));
  };
  const remove = item => {
    if (!window.confirm(`Supprimer « ${item.label} » ?`)) return;
    run(() => api.del(`/admin/refs/${item.id}`), 'Supprimé');
  };

  return (
    <Card title={meta.label} bodyClass="" actions={archivedCount > 0 && (
      <label className="checkbox small"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Afficher les archivés ({archivedCount})</label>
    )}>
      <p className="small muted" style={{ padding: '12px 16px 0' }}>{HELP[kind]}</p>
      {error && <div style={{ padding: '10px 16px 0' }}><ErrorBox error={error} /></div>}
      {parentKind && (
        <div style={{ padding: '12px 16px 0', maxWidth: 360 }}>
          <Field label={`Filtrer par ${data.kinds[parentKind].one}`}>
            <select className="select" value={filter} onChange={e => { setFilter(e.target.value); setParentId(e.target.value); }}>
              <option value="">Toutes</option>
              {parents.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
        </div>
      )}
      {editable && (
        <form className="ref-add" onSubmit={add}>
          <input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder={`Nouvelle valeur (${meta.one})`} aria-label={`Nouveau ${meta.one}`} maxLength={120} />
          {parentKind && (
            <select className="select" style={{ flex: '0 1 220px' }} value={parentId} onChange={e => setParentId(e.target.value)} aria-label={data.kinds[parentKind].one} required>
              <option value="">— {data.kinds[parentKind].one} —</option>
              {parents.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          <button className="btn btn-primary" disabled={!label.trim() || (parentKind && !(parentId || filter))}><Plus />Ajouter</button>
        </form>
      )}
      {!rows.length ? <Empty>Aucune valeur.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th>Libellé</th>
              {parentKind && <th>{data.kinds[parentKind].one}</th>}
              {editable && featureKinds.includes(kind) && <th>Liste</th>}
              {meta.scope && <th>Proposé pour les projets</th>}
              <th>Utilisation</th>
              {editable && <th className="right">Actions</th>}
            </tr></thead>
            <tbody>
              {rows.map((item, i) => (
                <tr key={item.id} className={`ref-row ${item.archived ? 'archived' : ''}`}>
                  <td style={{ minWidth: 200 }}>
                    {editable
                      ? <input className="input ref-label-input" defaultValue={item.label} key={item.label} aria-label="Libellé"
                          onBlur={e => rename(item, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                      : item.label}
                    {item.archived && <Badge>Archivé</Badge>}
                  </td>
                  {parentKind && <td>{parentName(item.parent_id)}</td>}
                  {editable && featureKinds.includes(kind) && (
                    <td>
                      <select className="select" style={{ height: 32, minWidth: 150 }} value={kind} aria-label="Déplacer vers la liste"
                        onChange={e => run(() => api.patch(`/admin/refs/${item.id}`, { kind: e.target.value }), `Déplacé vers « ${data.kinds[e.target.value].label} »`)}>
                        {featureKinds.map(k => <option key={k} value={k}>{data.kinds[k].label}</option>)}
                      </select>
                    </td>
                  )}
                  {meta.scope && (
                    <td>
                      {/* Types de projet auxquels ce type de biens s'applique (aucune case = tous) */}
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {scopes.map(s => {
                          const on = (item.project_types || []).includes(s.id);
                          return (
                            <label key={s.id} className="checkbox small" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '2px 8px' }}>
                              <input type="checkbox" checked={on} disabled={!editable} onChange={() => setScope(item, s.id, !on)} />{s.label}
                            </label>
                          );
                        })}
                        {!(item.project_types || []).length && <span className="small muted">Tous les projets</span>}
                      </div>
                    </td>
                  )}
                  <td className="small muted nowrap">
                    {item.used ? `${item.used} projet${item.used > 1 ? 's' : ''}` : 'Non utilisé'}
                    {item.children > 0 && ` · ${item.children} localisation${item.children > 1 ? 's' : ''}`}
                  </td>
                  {editable && (
                    <td className="right nowrap">
                      <button className="btn btn-sm btn-ghost btn-icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter"><ArrowUp /></button>
                      <button className="btn btn-sm btn-ghost btn-icon" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Descendre"><ArrowDown /></button>
                      {item.archived
                        ? <button className="btn btn-sm btn-ghost btn-icon" title="Restaurer" aria-label="Restaurer" onClick={() => run(() => api.patch(`/admin/refs/${item.id}`, { archived: false }), 'Restauré')}><ArchiveRestore /></button>
                        : <button className="btn btn-sm btn-ghost btn-icon" title="Archiver : n’est plus proposé, reste sur les projets qui l’ont" aria-label="Archiver" onClick={() => run(() => api.patch(`/admin/refs/${item.id}`, { archived: true }), 'Archivé')}><Archive /></button>}
                      <button className="btn btn-sm btn-ghost btn-icon btn-danger" disabled={item.used > 0 || item.children > 0}
                        title={item.used > 0 ? 'Utilisé par un projet : archivez-le plutôt' : item.children > 0 ? 'A encore des localisations' : 'Supprimer'}
                        aria-label="Supprimer" onClick={() => remove(item)}><Trash2 /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function General({ editable }) {
  const toast = useToast();
  const saved = useSaved();
  const settings = useResource('/admin/settings');
  const [values, setValues] = useState(null);
  const [error, setError] = useState(null);
  if (settings.loading && !settings.data) return <Skeleton h={160} />;
  if (settings.error) return <ErrorBox error={settings.error} />;
  const v = values || settings.data.values;
  const save = async () => {
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]));
      await api.put('/admin/settings', body);
      saved('Réglages enregistrés');
      setValues(null); settings.reload();
    } catch (e) { setError(e); }
  };
  return (
    <Card title="Réglages généraux" actions={editable && <button className="btn btn-primary btn-sm" onClick={save} disabled={!values}>Enregistrer</button>}>
      <ErrorBox error={error} />
      <fieldset disabled={!editable} style={{ border: 'none' }} className="form-grid">
        {Object.entries(settings.data.fields).map(([k, f]) => (
          <Field key={k} label={f.label} hint={k === 'option_days_default' ? 'S’applique aux projets dont la fiche ne précise pas de durée (site et dashboard).' : null}>
            <input className="input" type="number" min={f.min} max={f.max} value={v[k] ?? ''} onChange={e => setValues({ ...v, [k]: e.target.value })} />
          </Field>
        ))}
      </fieldset>
    </Card>
  );
}

function Display() {
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
