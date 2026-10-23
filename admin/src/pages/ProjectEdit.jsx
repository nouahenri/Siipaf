import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, ImagePlus, Map, FileText, PenTool, MapPin } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast, useSaveAndReturn } from '../lib/app-context';
import { Card, Field, ErrorBox, Skeleton, Badge, Empty } from '../components/ui';
import { MediaPicker } from '../components/MediaLibrary';
import { Modal } from '../components/ui';
import PlanImport from '../components/PlanImport';
import PlanManage from '../components/PlanManage';
import ProjectActions from '../components/ProjectActions';
import { fcfa } from '../lib/format';
import { bienKind } from '../lib/domain';

const FIELDS = ['name', 'slug', 'city_id', 'location_id', 'location_detail', 'tagline', 'description', 'project_type_id', 'property_type_id', 'delivery', 'option_days', 'deposit_fcfa', 'balance_months', 'published', 'cover_media_id'];
const FEATURES = ['equipement', 'commodite', 'viabilisation', 'document'];

/**
 * Position GPS saisie librement : « 5.3601, -4.0083 » (copié depuis Google Maps), « 5,3601 ; -4,0083 »
 * ou un lien Google Maps (…/@5.3601,-4.0083,17z ou ?q=5.3601,-4.0083). Renvoie { lat, lng }, null si vide, false si illisible.
 */
function parseGps(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    || t.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return false;
  const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : false;
}
const gpsText = p => (p.latitude != null && p.longitude != null ? `${Number(p.latitude)}, ${Number(p.longitude)}` : '');
// Un type de biens s'applique aux types de projet cochés dans Paramètres (aucun = tous)
const fitsProject = (t, projectTypeId) => !projectTypeId || !t.project_types?.length || t.project_types.includes(Number(projectTypeId));

export default function ProjectEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const saveAndReturn = useSaveAndReturn('/projets');
  const project = useResource(`/admin/projects/${id}`);
  const lists = useResource('/admin/refs');
  const settings = useResource('/admin/settings');
  const [form, setForm] = useState(null);
  const [offers, setOffers] = useState([]);
  const [picker, setPicker] = useState(null);
  const [termsOpen, setTermsOpen] = useState(false);
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
    setForm({ ...Object.fromEntries(FIELDS.map(k => [k, p[k] ?? ''])), checked, published: !!p.published, gps: gpsText(p) });
    setOffers(p.offers.map(o => ({ ...o })));
  }, [project.data]);

  if ((project.loading && !project.data) || (lists.loading && !lists.data) || (settings.loading && !settings.data)) return <Skeleton h={400} />;
  if (project.error || lists.error || settings.error) return <ErrorBox error={project.error || lists.error || settings.error} />;
  if (!form) return null;

  // Conditions de paiement : la fiche, sinon Paramètres › Réglages généraux ; mensualité Diaspora = (prix − acompte) ÷ délai
  const defaults = settings.data.values;
  const choices = String(defaults.balance_months_choices).split(/[^\d]+/).map(Number).filter(Boolean);
  const terms = {
    deposit: form.deposit_fcfa === '' || form.deposit_fcfa == null ? Number(defaults.deposit_default || 0) : Number(form.deposit_fcfa),
    months: Number(form.balance_months) || Number(defaults.balance_months_default) || 36,
  };
  const monthly = price => Math.round(Math.max(0, price - terms.deposit) / terms.months);

  // Valeurs proposées : non archivées, plus celles que le projet a déjà
  const items = lists.data.items;
  const offered = (kind, keep = []) => items.filter(i => i.kind === kind && (!i.archived || keep.includes(i.id)));
  const cities = offered('ville', [Number(form.city_id)]);
  const places = offered('localisation', [Number(form.location_id)]).filter(i => String(i.parent_id) === String(form.city_id));
  const projectTypes = offered('type_projet', [Number(form.project_type_id)]);
  // Types de biens du type de projet choisi (lotissement → terrains, logement social → appartements, villas sociales…)
  const propertyTypes = offered('type_bien', [Number(form.property_type_id)])
    .filter(t => fitsProject(t, form.project_type_id) || String(t.id) === String(form.property_type_id));
  const propertyLabel = propertyTypes.find(t => String(t.id) === String(form.property_type_id))?.label;
  // Changer de type de projet : le type de biens suit (seul choix possible sélectionné d'office, sinon à choisir)
  const pickProjectType = e => {
    const value = e.target.value;
    setForm(f => {
      const fit = offered('type_bien').filter(t => fitsProject(t, value));
      const keep = fit.some(t => String(t.id) === String(f.property_type_id));
      return { ...f, project_type_id: value, property_type_id: keep ? f.property_type_id : fit.length === 1 ? String(fit[0].id) : '' };
    });
  };
  const gps = parseGps(form.gps);
  const locate = () => navigator.geolocation?.getCurrentPosition(
    pos => setForm(f => ({ ...f, gps: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}` })),
    () => toast('Position indisponible : autorisez la localisation dans le navigateur.', 'err'),
    { enableHighAccuracy: true, timeout: 15000 },
  );
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
  // Équivalent en euros affiché sur le site : parité fixe du franc CFA (1 € = 655,957 FCFA)
  const eur = v => { const n = intOrNull(v); return n > 0 ? `≈ ${Math.round(n / 655.957).toLocaleString('fr-FR')} €` : null; };

  const save = async () => {
    if (gps === false) return setError(new Error('Position GPS illisible : collez « latitude, longitude » (ex. 5.3601, -4.0083) ou un lien Google Maps.'));
    setBusy(true);
    setError(null);
    try {
      const body = {
        latitude: gps ? gps.lat : null,
        longitude: gps ? gps.lng : null,
        ...form,
        option_days: form.option_days === '' ? null : Number(form.option_days),
        deposit_fcfa: form.deposit_fcfa === '' || form.deposit_fcfa == null ? null : intOrNull(form.deposit_fcfa),
        balance_months: Number(form.balance_months) || null,
        cover_media_id: form.cover_media_id || null,
        city_id: Number(form.city_id) || null,
        location_id: Number(form.location_id) || null,
        project_type_id: Number(form.project_type_id) || null,
        property_type_id: Number(form.property_type_id) || null,
        refs: Object.entries(form.checked).map(([refId, state]) => ({ id: Number(refId), state: state || null })),
      };
      delete body.checked;
      delete body.gps;
      for (const k of ['location_detail', 'tagline', 'description', 'delivery']) body[k] = body[k] || null;
      await api.patch(`/admin/projects/${id}`, body);
      await api.put(`/admin/projects/${id}/offers`, offers.filter(o => o.label?.trim()).map(o => ({
        id: o.id, label: o.label, designation: o.designation?.trim() || null, surface: o.surface || null, price_fcfa: intOrNull(o.price_fcfa), diaspora_price_fcfa: intOrNull(o.diaspora_price_fcfa),
      })));
      // Fiche enregistrée : retour à la page précédente (liste des projets) avec l'accusé
      saveAndReturn(`Projet « ${form.name || project.data?.name || ''} » enregistré`);
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
              <Field label="Type de projet" hint={<>Un type dont le nom contient « lotissement » range le projet dans Projets › Lotissements sur le site.{canLists && <> <Link className="list-link" to="/parametres?section=type_projet">Gérer la liste</Link></>}</>}>
                <select className="select" value={form.project_type_id || ''} onChange={pickProjectType}>
                  <option value="">— Non précisé —</option>
                  {projectTypes.map(t => <option key={t.id} value={t.id}>{t.label}{t.archived ? ' (archivé)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Type de biens" hint={<>Bouton de création dans Biens & disponibilités : « {bienKind(propertyLabel).create} ».{canLists && <> <Link className="list-link" to="/parametres?section=type_bien">Gérer la liste</Link></>}</>}>
                <select className="select" value={form.property_type_id || ''} onChange={set('property_type_id')}>
                  <option value="">— Non précisé —</option>
                  {propertyTypes.map(t => <option key={t.id} value={t.id}>{t.label}{t.archived ? ' (archivé)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Localisation" hint={form.city_id ? (canLists && <Link className="list-link" to="/parametres?section=localisation">Gérer les localisations</Link>) : 'Choisissez d’abord la ville.'}>
                <select className="select" value={form.location_id || ''} onChange={set('location_id')} disabled={!form.city_id}>
                  <option value="">— Choisir —</option>
                  {places.map(c => <option key={c.id} value={c.id}>{c.label}{c.archived ? ' (archivée)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Précision d’accès" className="full" hint="Facultatif, affiché après la localisation : « Axe Abidjan–Alépé, 20 min de Cocody »."><input className="input" value={form.location_detail} onChange={set('location_detail')} maxLength={255} /></Field>
              <Field label="Position GPS du projet" className="full"
                hint={gps === false ? <span style={{ color: 'var(--danger)' }}>Illisible : « latitude, longitude » (ex. 5.3601, -4.0083) ou lien Google Maps.</span>
                  : gps ? <>Sur le site : icône carte et bouton « Itinéraire ». <a className="list-link" href={`https://www.google.com/maps/search/?api=1&query=${gps.lat},${gps.lng}`} target="_blank" rel="noreferrer">Vérifier sur Google Maps</a></>
                  : 'Dans Google Maps, clic droit sur l’entrée du site → cliquez sur les coordonnées pour les copier, puis collez-les ici (ou collez le lien du lieu).'}>
                <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <input className="input tabular" value={form.gps} onChange={set('gps')} placeholder="5.3601, -4.0083" aria-label="Latitude, longitude" />
                  <button type="button" className="btn" onClick={locate} title="Utiliser la position de cet appareil (sur place)"><MapPin />Ma position</button>
                </div>
              </Field>
              <Field label="Accroche" className="full" hint="Phrase courte affichée sous le nom."><input className="input" value={form.tagline} onChange={set('tagline')} /></Field>
              <Field label="Description" className="full"><textarea className="textarea" value={form.description} onChange={set('description')} /></Field>
              <Field label="Délai de livraison"><input className="input" value={form.delivery} onChange={set('delivery')} placeholder="30 mois" /></Field>
              <Field label="Durée d’une option (jours)" hint="Vide = durée par défaut (Paramètres › Réglages généraux)."><input className="input" type="number" min="1" max="60" value={form.option_days} onChange={set('option_days')} /></Field>
              <Field label="Délai de solde" hint={<>Mensualités pour solder le bien (formule Diaspora). {canLists && <Link className="list-link" to="/parametres?section=general">Régler les durées proposées</Link>}</>}>
                <select className="select" value={form.balance_months || ''} onChange={set('balance_months')}>
                  <option value="">Par défaut ({defaults.balance_months_default} mois)</option>
                  {[...new Set([...choices, Number(form.balance_months)].filter(Boolean))].sort((a, b) => a - b).map(m => <option key={m} value={m}>{m} mois</option>)}
                </select>
              </Field>
              <Field label="Acompte (FCFA)" hint={`Affiché sur la tuile du projet. Vide = acompte par défaut (${fcfa(defaults.deposit_default || 0)}).`}>
                <input className="input tabular" inputMode="numeric" value={form.deposit_fcfa ?? ''} onChange={set('deposit_fcfa')} placeholder={String(defaults.deposit_default || 0)} />
              </Field>
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
            if (!meta) return null;
            const choices = offered(kind, Object.keys(form.checked).map(Number));
            // États de la liste : viabilisation (prévu, en cours, réalisé), documents (à obtenir, en cours, obtenu)
            const states = meta.state_labels || lists.data.states;
            const first = meta.default_state || 'prevu';
            return (
              <Card key={kind} title={meta.label} actions={canLists && <Link className="list-link" to={`/parametres?section=${kind}`}>Gérer la liste</Link>}>
                {!choices.length ? <p className="small muted">Liste vide : ajoutez des valeurs dans Paramètres.</p> : meta.states ? (
                  <div>
                    {choices.map(c => {
                      const on = c.id in form.checked;
                      return (
                        <div key={c.id} className="viab-row">
                          <label className="checkbox"><input type="checkbox" checked={on} onChange={e => toggle(c.id, e.target.checked, first)} />{c.label}</label>
                          {on && (
                            <select className="select" value={form.checked[c.id] || first} onChange={e => toggle(c.id, true, e.target.value)} aria-label={`État : ${c.label}`}>
                              {Object.entries(states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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

        <Card title="Grille de prix" bodyClass="" actions={editable && <button type="button" className="btn btn-sm" onClick={() => setOffers(o => [...o, { label: propertyLabel || '', designation: '', surface: '', price_fcfa: '', diaspora_price_fcfa: '' }])}><Plus />Ajouter une ligne</button>}>
          {!offers.length ? <Empty>Aucun type de bien.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Type de bien</th><th>Désignation</th><th>Surface</th><th className="right">Prix (FCFA)</th><th className="right">Prix Diaspora (FCFA)</th><th /></tr></thead>
                <tbody>
                  {offers.map((o, i) => (
                    <tr key={o.id || `new-${i}`}>
                      <td style={{ minWidth: 220 }}>
                        {/* Types de biens de Paramètres (filtrés par type de projet) ; un libellé ancien hors liste reste proposé */}
                        <select className="select" value={o.label} onChange={e => setOffer(i, 'label', e.target.value)} aria-label="Type de bien">
                          <option value="">— Choisir —</option>
                          {o.label && !propertyTypes.some(t => t.label === o.label) && <option value={o.label}>{o.label} (hors liste)</option>}
                          {propertyTypes.map(t => <option key={t.id} value={t.label}>{t.label}</option>)}
                        </select>
                      </td>
                      <td style={{ minWidth: 160 }}><input className="input" value={o.designation || ''} onChange={e => setOffer(i, 'designation', e.target.value)} placeholder="2 pièces, comptant…" aria-label="Désignation" maxLength={120} /></td>
                      <td style={{ minWidth: 140 }}><input className="input" value={o.surface || ''} onChange={e => setOffer(i, 'surface', e.target.value)} aria-label="Surface" /></td>
                      <td style={{ minWidth: 150 }}>
                        <input className="input right tabular" inputMode="numeric" value={o.price_fcfa ?? ''} onChange={e => setOffer(i, 'price_fcfa', e.target.value)} aria-label="Prix" title={fcfa(o.price_fcfa)} />
                        {eur(o.price_fcfa) && <div className="small muted right tabular" style={{ marginTop: 4 }}>{eur(o.price_fcfa)}</div>}
                      </td>
                      <td style={{ minWidth: 150 }}>
                        <input className="input right tabular" inputMode="numeric" value={o.diaspora_price_fcfa ?? ''} onChange={e => setOffer(i, 'diaspora_price_fcfa', e.target.value)} aria-label="Prix Diaspora" />
                        {intOrNull(o.diaspora_price_fcfa) > 0 && (
                          <button type="button" className="terms-link small tabular" onClick={() => setTermsOpen(true)} title="Acompte et délai de solde du projet">
                            {terms.deposit > 0 && <>{fcfa(terms.deposit)} puis </>}{fcfa(monthly(intOrNull(o.diaspora_price_fcfa)))} / mois × {terms.months}
                          </button>
                        )}
                      </td>
                      <td className="nowrap">
                        <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={i === 0} onClick={() => moveOffer(i, -1)} aria-label="Monter"><ArrowUp /></button>
                        <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={i === offers.length - 1} onClick={() => moveOffer(i, 1)} aria-label="Descendre"><ArrowDown /></button>
                        <button type="button" className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => setOffers(l => l.filter((_, j) => j !== i))} aria-label="Supprimer la ligne"><Trash2 /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted" style={{ padding: '8px 16px' }}>
                Cette grille alimente le tableau des prix du site : équivalent en euros calculé automatiquement, ligne « Option Diaspora » avec sa mensualité
                ({terms.deposit > 0 ? `acompte de ${fcfa(terms.deposit)}, puis ` : ''}{terms.months} mois). Cliquez sur une mensualité pour régler l’acompte et le délai de solde.
                {canLists && <> Types proposés : ceux du type de projet choisi. <Link className="list-link" to="/parametres?section=type_bien">Gérer les types de biens</Link></>}
              </p>
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
      {termsOpen && (
        <PaymentTermsModal form={form} defaults={defaults} choices={choices} offers={offers} editable={editable} canLists={canLists}
          onApply={patch => { setForm(f => ({ ...f, ...patch })); setTermsOpen(false); }} onClose={() => setTermsOpen(false)} />
      )}
    </div>
  );
}

/**
 * Conditions de paiement du projet (clic sur une mensualité de la grille) : acompte à verser et délai de solde,
 * avec la mensualité de chaque ligne Diaspora. S'appliquent à la fiche, enregistrées avec le projet ; les valeurs
 * par défaut et les durées proposées se règlent dans Paramètres › Réglages généraux.
 */
function PaymentTermsModal({ form, defaults, choices, offers, editable, canLists, onApply, onClose }) {
  const [deposit, setDeposit] = useState(form.deposit_fcfa ?? '');
  const [months, setMonths] = useState(form.balance_months || '');
  const dep = deposit === '' ? Number(defaults.deposit_default || 0) : Math.max(0, Math.round(Number(String(deposit).replace(/[\s ]/g, '')) || 0));
  const m = Number(months) || Number(defaults.balance_months_default) || 36;
  const lines = offers.filter(o => Number(o.diaspora_price_fcfa) > 0);
  const label = o => [o.label, o.designation, o.surface && `${o.surface}${/^\d+$/.test(String(o.surface).trim()) ? ' m²' : ''}`].filter(Boolean).join(' · ');
  return (
    <Modal title="Conditions de paiement du projet" onClose={onClose}
      footer={<>
        {canLists && <Link className="btn btn-ghost" to="/parametres?section=general" style={{ marginRight: 'auto' }}>Valeurs par défaut</Link>}
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        {editable && <button className="btn btn-primary" onClick={() => onApply({ deposit_fcfa: deposit, balance_months: months })}>Appliquer</button>}
      </>}>
      <div className="form-grid">
        <Field label="Acompte à verser (FCFA)" hint={`Vide = ${fcfa(defaults.deposit_default || 0)} (par défaut).`}>
          <input className="input tabular" inputMode="numeric" value={deposit} onChange={e => setDeposit(e.target.value)} placeholder={String(defaults.deposit_default || 0)} disabled={!editable} autoFocus />
        </Field>
        <Field label="Délai de solde">
          <select className="select" value={months} onChange={e => setMonths(e.target.value)} disabled={!editable}>
            <option value="">Par défaut ({defaults.balance_months_default} mois)</option>
            {[...new Set([...choices, Number(form.balance_months)].filter(Boolean))].sort((a, b) => a - b).map(x => <option key={x} value={x}>{x} mois</option>)}
          </select>
        </Field>
      </div>
      {lines.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="table">
            <thead><tr><th>Option Diaspora</th><th className="right">Prix</th><th className="right">Mensualité</th></tr></thead>
            <tbody>{lines.map((o, i) => {
              const price = Number(String(o.diaspora_price_fcfa).replace(/[\s ]/g, ''));
              return <tr key={o.id || i}><td>{label(o)}</td><td className="right tabular">{fcfa(price)}</td><td className="right tabular"><strong>{fcfa(Math.round(Math.max(0, price - dep) / m))}</strong> × {m}</td></tr>;
            })}</tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>Mensualité = (prix Diaspora − acompte) ÷ délai de solde. Affichés sur la tuile et la fiche du projet du site après enregistrement du projet.</p>
    </Modal>
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
