import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, ImagePlus, Map, FileText, PenTool } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Card, Field, ErrorBox, Skeleton, Badge, Empty } from '../components/ui';
import { MediaPicker, Dropzone } from '../components/MediaLibrary';
import { Modal } from '../components/ui';
import { pdfToImage } from '../lib/pdf';
import CadImport from '../components/CadImport';
import { fcfa } from '../lib/format';

const FIELDS = ['name', 'slug', 'city', 'location', 'tagline', 'description', 'category', 'delivery', 'option_days', 'published', 'cover_media_id', 'amenities'];

export default function ProjectEdit() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const project = useResource(`/admin/projects/${id}`);
  const [form, setForm] = useState(null);
  const [offers, setOffers] = useState([]);
  const [picker, setPicker] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const editable = can('projects:write');

  useEffect(() => {
    if (!project.data) return;
    const p = project.data;
    setForm({ ...Object.fromEntries(FIELDS.map(k => [k, p[k] ?? ''])), amenities: (p.amenities || []).join('\n'), published: !!p.published });
    setOffers(p.offers.map(o => ({ ...o })));
  }, [project.data]);

  if (project.loading && !project.data) return <Skeleton h={400} />;
  if (project.error) return <ErrorBox error={project.error} />;
  if (!form) return null;

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
        amenities: form.amenities.split('\n').map(s => s.trim()).filter(Boolean),
      };
      for (const k of ['city', 'location', 'tagline', 'description', 'category', 'delivery']) body[k] = body[k] || null;
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
        {editable && <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </div>
      <ErrorBox error={error} />

      <fieldset disabled={!editable} style={{ border: 'none' }} className="stack">
        <div className="grid edit-grid">
          <Card title="Informations">
            <div className="form-grid">
              <Field label="Nom" className="full"><input className="input" value={form.name} onChange={set('name')} /></Field>
              <Field label="Identifiant (adresse)"><input className="input" value={form.slug} onChange={set('slug')} /></Field>
              <Field label="Ville"><input className="input" value={form.city} onChange={set('city')} /></Field>
              <Field label="Localisation" className="full"><input className="input" value={form.location} onChange={set('location')} /></Field>
              <Field label="Accroche" className="full" hint="Phrase courte affichée sous le nom."><input className="input" value={form.tagline} onChange={set('tagline')} /></Field>
              <Field label="Description" className="full"><textarea className="textarea" value={form.description} onChange={set('description')} /></Field>
              <Field label="Délai de livraison"><input className="input" value={form.delivery} onChange={set('delivery')} placeholder="30 mois" /></Field>
              <Field label="Durée d’une option (jours)" hint="Vide = 7 jours par défaut."><input className="input" type="number" min="1" max="60" value={form.option_days} onChange={set('option_days')} /></Field>
              <Field label="Équipements" className="full" hint="Un par ligne (écoles, piscine…)."><textarea className="textarea" value={form.amenities} onChange={set('amenities')} /></Field>
            </div>
          </Card>
          <div className="stack">
            <Card title="Publication">
              <label className="checkbox"><input type="checkbox" checked={form.published} onChange={set('published')} />Visible sur le site</label>
            </Card>
            <Card title="Image principale">
              <button type="button" className="slide-thumb" style={{ width: '100%', backgroundImage: form.cover_media_id ? `url(/uploads/by-id/${form.cover_media_id})` : undefined, border: '1px solid var(--border)' }} onClick={() => setPicker('cover')} aria-label="Choisir l’image principale">
                {!form.cover_media_id && <ImagePlus />}
              </button>
            </Card>
          </div>
        </div>

        <Card title="Grille de prix" bodyClass="" actions={editable && <button type="button" className="btn btn-sm" onClick={() => setOffers(o => [...o, { label: '', surface: '', price_fcfa: '', diaspora_price_fcfa: '' }])}><Plus />Ajouter une ligne</button>}>
          {!offers.length ? <Empty>Aucun type de bien.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Type de bien</th><th>Surface</th><th className="right">Prix (FCFA)</th><th className="right">Prix Diaspora (FCFA)</th><th /></tr></thead>
                <tbody>
                  {offers.map((o, i) => (
                    <tr key={o.id || `new-${i}`}>
                      <td style={{ minWidth: 220 }}><input className="input" value={o.label} onChange={e => setOffer(i, 'label', e.target.value)} aria-label="Type de bien" /></td>
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
            </div>
          )}
        </Card>
      </fieldset>

      <Card title="Plans de masse" actions={can('plans:write') && <button className="btn btn-sm" onClick={() => setPicker('plan')}><Plus />Ajouter un plan</button>} bodyClass="">
        {!project.data.plans.length ? <Empty icon={Map}>Aucun plan. Ajoutez l’image ou le PDF du plan de masse, puis dessinez les lots dans l’éditeur.</Empty> : (
          <table className="table"><tbody>
            {project.data.plans.map(pl => (
              <tr key={pl.id}>
                <td style={{ width: 64 }}><div className="slide-thumb" style={{ width: 56, backgroundImage: pl.media_id ? `url(/uploads/by-id/${pl.media_id})` : undefined }}>{!pl.width && <FileText size={18} />}</div></td>
                <td><strong>{pl.name}</strong><div className="small muted">{pl.width ? `${pl.width} × ${pl.height} px` : 'Document PDF'}</div></td>
                <td>{pl.published ? <Badge tone="ok">Publié</Badge> : <Badge>Brouillon</Badge>}</td>
                <td className="right nowrap">
                  {can('plans:write') && <button className="btn btn-sm btn-ghost" onClick={() => togglePlan(pl)}>{pl.published ? 'Dépublier' : 'Publier'}</button>}{' '}
                  <Link className="btn btn-sm" to={`/plans/${pl.id}`}><PenTool />{can('plans:write') ? 'Dessiner les lots' : 'Voir'}</Link>
                </td>
              </tr>
            ))}
          </tbody></table>
        )}
      </Card>

      {picker === 'cover' && <MediaPicker selectedId={form.cover_media_id} onPick={m => setForm(f => ({ ...f, cover_media_id: m.id }))} onClose={() => setPicker(null)} />}
      {picker === 'plan' && <AddPlanModal projectId={Number(id)} onClose={() => setPicker(null)} onDone={() => { setPicker(null); project.reload(); }} />}
    </div>
  );
}

/** Ajout d'un plan : image, ou PDF converti en image dans le navigateur. */
function AddPlanModal({ projectId, onClose, onDone }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [cad, setCad] = useState(false);

  const handle = async files => {
    const file = files[0];
    if (!file) return;
    try {
      let upload = file, width, height;
      if (file.type === 'application/pdf') {
        setBusy('Conversion du PDF en image…');
        ({ file: upload, width, height } = await pdfToImage(file));
      } else {
        ({ width, height } = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => reject(new Error('Image illisible.'));
          img.src = URL.createObjectURL(file);
        }));
      }
      setBusy('Envoi…');
      const form = new FormData();
      form.append('files', upload);
      form.append('meta', JSON.stringify([{ width, height, alt: 'Plan de masse' }]));
      const [m] = await api.post('/admin/media', form);
      await api.post('/admin/plans', { project_id: projectId, name: name || file.name.replace(/.[^.]+$/, ''), media_id: m.id, width, height });
      toast('Plan ajouté — vous pouvez dessiner les lots');
      onDone();
    } catch (e) { toast(e.message, 'err'); setBusy(''); }
  };

  return (
    <Modal title={cad ? 'Convertir un plan AutoCAD en carte interactive' : 'Ajouter un plan de masse'} onClose={onClose}>
      {cad ? <CadImport projectId={projectId} onCancel={() => setCad(false)} onDone={plan => { onDone(); navigate(`/plans/${plan.id}`); }} /> : <>
      <Field label="Nom du plan" hint="Ex. : Tranche 1, Îlots A à D…"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>
      {busy ? <p className="muted">{busy}</p> : <Dropzone onFiles={handle} busy={false} accept="image/jpeg,image/png,image/webp,application/pdf" />}
      <p className="small muted">Image (JPG, PNG) ou PDF : la première page du PDF est convertie en image haute définition. Les lots se dessinent ensuite à la main.</p>
      {!busy && (
        <div className="card" style={{ padding: 14, marginTop: 6, background: 'var(--surface-2)' }}>
          <strong>Vous avez le plan AutoCAD (DWG ou DXF) ?</strong>
          <p className="small muted" style={{ margin: '4px 0 10px' }}>Les parcelles et leurs numéros sont reconnus automatiquement : la carte interactive et les lots sont créés en une fois.</p>
          <button className="btn btn-primary btn-sm" onClick={() => setCad(true)}><PenTool />Convertir un plan AutoCAD</button>
        </div>
      )}
      </>}
    </Modal>
  );
}
