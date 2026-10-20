import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, ImagePlus, Map, FileText, PenTool } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Card, Field, ErrorBox, Skeleton, Badge, Empty } from '../components/ui';
import { MediaPicker } from '../components/MediaLibrary';
import { Modal } from '../components/ui';
import PlanImport from '../components/PlanImport';
import PlanManage from '../components/PlanManage';
import ProjectActions from '../components/ProjectActions';
import { fcfa } from '../lib/format';
import { PROJECT_CATEGORIES } from '../lib/domain';

const FIELDS = ['name', 'slug', 'city_id', 'location_id', 'location_detail', 'tagline', 'description', 'category', 'delivery', 'option_days', 'published', 'cover_media_id'];
const FEATURES = ['equipement', 'commodite', 'viabilisation'];

export default function ProjectEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const project = useResource(`/admin/projects/${id}`);
  const lists = useResource('/admin/refs');
  const [form, setForm] = useState(null);
  const [offers, setOffers] = useState([]);
  const [picker, setPicker] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const editable = can('projects:write');

  useEffect(() => {
    if (!project.data) return;
    const p = project.data;
    // Cases cochées : id → état (l'état ne sert qu'à la viabilisation)
    const checked = {};
    for (const k of FEATURES) for (const r of p.refs?.[k] || []) checked[r.id] = r.state || null;
    setForm({ ...Object.fromEntries(FIELDS.map(k => [k, p[k] ?? ''])), checked, published: !!p.published });
    setOffers(p.offers.map(o => ({ ...o })));
  }, [project.data]);

  if ((project.loading && !project.data) || (lists.loading && !lists.data)) return <Skeleton h={400} />;
  if (project.error || lists.error) return <ErrorBox error={project.error || lists.error} />;
  if (!form) return null;

  // Valeurs proposées : non archivées, plus celles que le projet a déjà
  const items = lists.data.items;
  const offered = (kind, keep = []) => items.filter(i => i.kind === kind && (!i.archived || keep.includes(i.id)));
  const cities = offered('ville', [Number(form.city_id)]);
  const places = offered('localisation', [Number(form.location_id)]).filter(i => String(i.parent_id) === String(form.city_id));
  const toggle = (refId, on, state = null) => setForm(f => {
    const checked = { ...f.checked };
    if (on) checked[refId] = state; else delete checked[refId];
    return { ...f, checked };
  });
  const canLists = can('settings:write');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setOffer = (i, k, v) => setOffers(list => list.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  const moveOffer = (i, d) => setOffers(list => { const l = [...list]; [l[i], l[i + d]] = [l[i + d], l[i]]; return l; });
  const intOrNull = v => (v === '' || v == null ? null : Math.round(Number(String(v).replace(/[\s ]/g, ''))));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...form,
        option_days: form.option_days === '' ? null : Number(form.option_days),
        cover_media_id: form.cover_media_id || null,
        city_id: Number(form.city_id) || null,
        location_id: Number(form.location_id) || null,
        refs: Object.entries(form.checked).map(([refId, state]) => ({ id: Number(refId), state: state || null })),
      };
      delete body.checked;
      for (const k of ['location_detail', 'tagline', 'description', 'category', 'delivery']) body[k] = body[k] || null;
      await api.patch(`/admin/projects/${id}`, body);
      await api.put(`/admin/projects/${id}/offers`, offers.filter(o => o.label.trim()).map(o => ({
        id: o.id, label: o.label, surface: o.surface || null, price_fcfa: intOrNull(o.price_fcfa), diaspora_price_fcfa: intOrNull(o.diaspora_price_fcfa),
      })));
      toast('Projet enregistré');
      project.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const togglePlan = async pl => {
    try { await api.patch(`/admin/plans/${pl.id}`, { published: !pl.published }); project.reload(); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <Link to="/projets" className="btn btn-ghost"><ArrowLeft />Projets</Link>
        {editable && <div className="row">
          <ProjectActions project={project.data} disabled={busy} onBusyChange={setBusy} onChanged={project.reload} onDeleted={() => navigate('/projets')} />
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>}
      </div>
      <ErrorBox error={error} />
      {project.data.archived_at && <p className="alert alert-info">Projet archivé : il est retiré du site. Restaurez-le pour pouvoir le republier.</p>}

      <fieldset disabled={!editable} style={{ border: 'none' }} className="stack">
        <div className="grid edit-grid">
          <Card title="Informations">
            <div className="form-grid">
              <Field label="Nom" className="full"><input className="input" value={form.name} onChange={set('name')} /></Field>
              <Field label="Identifiant (adresse)"><input className="input" value={form.slug} onChange={set('slug')} /></Field>
              <Field label="Ville" hint={canLists && <Link className="list-link" to="/parametres?section=ville">Gérer la liste des villes</Link>}>
                <select className="select" value={form.city_id || ''} onChange={e => setForm(f => ({ ...f, city_id: e.target.value, location_id: '' }))}>
                  <option value="">— Choisir —</option>
                  {cities.map(c => <option key={c.id} value={c.id}>{c.label}{c.archived ? ' (archivée)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Type de projet" hint="Lotissement ou promotion, chaque projet peut avoir sa carte interactive (Plans de masse, plus bas). « Lotissement » le range dans Projets › Lotissements sur le site.">
                <select className="select" value={form.category || ''} onChange={set('category')}>
                  <option value="">— Non précisé —</option>
                  {Object.entries(PROJECT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Localisation" hint={form.city_id ? (canLists && <Link className="list-link" to="/parametres?section=localisation">Gérer les localisations</Link>) : 'Choisissez d’abord la ville.'}>
                <select className="select" value={form.location_id || ''} onChange={set('location_id')} disabled={!form.city_id}>
                  <option value="">— Choisir —</option>
                  {places.map(c => <option key={c.id} value={c.id}>{c.label}{c.archived ? ' (archivée)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Précision d’accès" className="full" hint="Facultatif, affiché après la localisation : « Axe Abidjan–Alépé, 20 min de Cocody »."><input className="input" value={form.location_detail} onChange={set('location_detail')} maxLength={255} /></Field>
              <Field label="Accroche" className="full" hint="Phrase courte affichée sous le nom."><input className="input" value={form.tagline} onChange={set('tagline')} /></Field>
              <Field label="Description" className="full"><textarea className="textarea" value={form.description} onChange={set('description')} /></Field>
              <Field label="Délai de livraison"><input className="input" value={form.delivery} onChange={set('delivery')} placeholder="30 mois" /></Field>
              <Field label="Durée d’une option (jours)" hint="Vide = durée par défaut (Paramètres › Réglages généraux)."><input className="input" type="number" min="1" max="60" value={form.option_days} onChange={set('option_days')} /></Field>
            </div>
          </Card>
          <div className="stack">
            <Card title="Publication">
              <label className="checkbox"><input type="checkbox" checked={form.published} onChange={set('published')} disabled={!!project.data.archived_at} />Visible sur le site</label>
            </Card>
            <Card title="Image principale">
              <button type="button" className="slide-thumb" style={{ width: '100%', backgroundImage: form.cover_media_id ? `url(/uploads/by-id/${form.cover_media_id})` : undefined, border: '1px solid var(--border)' }} onClick={() => setPicker('cover')} aria-label="Choisir l’image principale">
                {!form.cover_media_id && <ImagePlus />}
              </button>
            </Card>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {FEATURES.map(kind => {
            const meta = lists.data.kinds[kind];
            const choices = offered(kind, Object.keys(form.checked).map(Number));
            return (
              <Card key={kind} title={meta.label} actions={canLists && <Link className="list-link" to={`/parametres?section=${kind}`}>Gérer la liste</Link>}>
                {!choices.length ? <p className="small muted">Liste vide : ajoutez des valeurs dans Paramètres.</p> : meta.states ? (
                  <div>
                    {choices.map(c => {
                      const on = c.id in form.checked;
                      return (
                        <div key={c.id} className="viab-row">
                          <label className="checkbox"><input type="checkbox" checked={on} onChange={e => toggle(c.id, e.target.checked, 'prevu')} />{c.label}</label>
                          {on && (
                            <select className="select" value={form.checked[c.id] || 'prevu'} onChange={e => toggle(c.id, true, e.target.value)} aria-label={`État : ${c.label}`}>
                              {Object.entries(lists.data.states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="check-grid">
                    {choices.map(c => (
                      <label key={c.id} className="checkbox"><input type="checkbox" checked={c.id in form.checked} onChange={e => toggle(c.id, e.target.checked)} />{c.label}</label>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <Card title="Grille de prix" bodyClass="" actions={editable && <button type="button" className="btn btn-sm" onClick={() => setOffers(o => [...o, { label: '', surface: '', price_fcfa: '', diaspora_price_fcfa: '' }])}><Plus />Ajouter une ligne</button>}>
          {!offers.length ? <Empty>Aucun type de bien.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Type de bien</th><th>Surface</th><th className="right">Prix (FCFA)</th><th className="right">Prix Diaspora (FCFA)</th><th /></tr></thead>
                <tbody>
                  {offers.map((o, i) => (
                    <tr key={o.id || `new-${i}`}>
                      <td style={{ minWidth: 220 }}><input className="input" list="types-de-biens" value={o.label} onChange={e => setOffer(i, 'label', e.target.value)} aria-label="Type de bien" /></td>
                      <td style={{ minWidth: 140 }}><input className="input" value={o.surface || ''} onChange={e => setOffer(i, 'surface', e.target.value)} aria-label="Surface" /></td>
                      <td style={{ minWidth: 150 }}><input className="input right tabular" inputMode="numeric" value={o.price_fcfa ?? ''} onChange={e => setOffer(i, 'price_fcfa', e.target.value)} aria-label="Prix" title={fcfa(o.price_fcfa)} /></td>
                      <td style={{ minWidth: 150 }}><input className="input right tabular" inputMode="numeric" value={o.diaspora_price_fcfa ?? ''} onChange={e => setOffer(i, 'diaspora_price_fcfa', e.target.value)} aria-label="Prix Diaspora" /></td>
                      <td className="nowrap">
                        <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={i === 0} onClick={() => moveOffer(i, -1)} aria-label="Monter"><ArrowUp /></button>
                        <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={i === offers.length - 1} onClick={() => moveOffer(i, 1)} aria-label="Descendre"><ArrowDown /></button>
                        <button type="button" className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => setOffers(l => l.filter((_, j) => j !== i))} aria-label="Supprimer la ligne"><Trash2 /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="types-de-biens">{offered('type_bien').map(t => <option key={t.id} value={t.label} />)}</datalist>
            </div>
          )}
        </Card>
      </fieldset>

      <Card title="Plans de masse" actions={can('plans:write') && <button className="btn btn-sm" onClick={() => setPicker('plan')}><Plus />Ajouter un plan</button>} bodyClass="">
        {(() => {
          const plans = project.data.plans;
          const active = plans.filter(pl => !pl.archived_at);
          const archived = plans.filter(pl => pl.archived_at);
          const rows = showArchived ? [...active, ...archived] : active;
          return <>
            {!active.length && <Empty icon={Map}>Aucun plan actif. Ajoutez le plan de masse (AutoCAD, ZIP, HTML, PDF ou image) : il devient la carte interactive du projet sur le site.</Empty>}
            {rows.length > 0 && (
              <div className="table-wrap"><table className="table"><tbody>
                {rows.map(pl => (
                  <tr key={pl.id} className={`plan-row ${pl.archived_at ? 'archived' : ''}`}>
                    <td style={{ width: 64 }}><div className="slide-thumb" style={{ width: 56, backgroundImage: pl.media_id ? `url(/uploads/by-id/${pl.media_id})` : undefined }}>{!pl.width && <FileText size={18} />}</div></td>
                    <td><strong>{pl.name}</strong><div className="small muted">{pl.width ? `${pl.width} × ${pl.height} px` : 'Sans image'}</div></td>
                    <td>{pl.archived_at ? <Badge>Archivé</Badge> : pl.published ? <Badge tone="ok">Publié</Badge> : <Badge>Brouillon</Badge>}</td>
                    <td className="right nowrap">
                      {can('plans:write') && !pl.archived_at && <button className="btn btn-sm btn-ghost" onClick={() => togglePlan(pl)}>{pl.published ? 'Dépublier' : 'Publier'}</button>}{' '}
                      <Link className="btn btn-sm" to={`/plans/${pl.id}`}><PenTool />{can('plans:write') ? 'Dessiner les lots' : 'Voir'}</Link>{' '}
                      {can('plans:write') && <PlanManage plan={pl} projectId={Number(id)} onChanged={project.reload} onDeleted={project.reload} />}
                    </td>
                  </tr>
                ))}
              </tbody></table></div>
            )}
            {archived.length > 0 && (
              <div style={{ padding: '10px 16px' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowArchived(v => !v)}>{showArchived ? 'Masquer' : 'Afficher'} les plans archivés ({archived.length})</button>
              </div>
            )}
          </>;
        })()}
      </Card>

      {picker === 'cover' && <MediaPicker selectedId={form.cover_media_id} onPick={m => setForm(f => ({ ...f, cover_media_id: m.id }))} onClose={() => setPicker(null)} />}
      {picker === 'plan' && <AddPlanModal projectId={Number(id)} onClose={() => setPicker(null)} onDone={() => { setPicker(null); project.reload(); }} />}
    </div>
  );
}

/** Ajout d'un plan : AutoCAD, ZIP, HTML/SVG, PDF ou image (voir PlanImport). */
function AddPlanModal({ projectId, onClose, onDone }) {
  const navigate = useNavigate();
  return (
    <Modal title="Ajouter un plan de masse" onClose={onClose}>
      <PlanImport projectId={projectId} onDone={plan => { onDone(); navigate(`/plans/${plan.id}`); }} />
    </Modal>
  );
}
