import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImagePlus, RotateCcw, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useResource, useToast } from '../lib/app-context';
import { Card, ErrorBox, Field, Skeleton } from './ui';
import { MediaPicker } from './MediaLibrary';

export default function SiteImageAssignments({ candidate, onConsumed }) {
  const resource = useResource('/admin/media-placements');
  const toast = useToast();
  const [page, setPage] = useState('home');
  const [section, setSection] = useState('');
  const [slotId, setSlotId] = useState('');
  const [chosen, setChosen] = useState(null);
  const [alt, setAlt] = useState('');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);
  const data = resource.data;
  const slots = data?.slots.filter(s => s.page === page) || [];
  const sections = [...new Set(slots.map(s => s.section))];
  const selectedSection = sections.includes(section) ? section : sections[0];
  const positions = slots.filter(s => s.section === selectedSection);
  const slot = positions.find(s => s.id === slotId) || positions[0];
  const assignment = data?.assignments[slot?.id];

  useEffect(() => {
    setChosen(candidate || assignment?.media || null);
    setAlt(candidate ? candidate.alt || '' : assignment?.alt || '');
    setDirty(!!candidate);
    setError(null);
  }, [slot?.id, assignment, candidate]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const saved = await api.put(`/admin/media-placements/${slot.id}`, { media_id: chosen?.id || null, alt });
      resource.setData(previous => ({ ...previous, assignments: { ...previous.assignments, [slot.id]: saved } }));
      onConsumed(); setDirty(false);
      toast(chosen ? 'Image affectée à cet emplacement' : 'Image d’origine rétablie');
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  if (!data) return resource.error ? <ErrorBox error={resource.error} /> : <Skeleton h={300} />;
  const pageLabel = data.pages.find(p => p.id === page)?.label;
  const defaultUrl = `/api/admin/media-placements/default/${slot.id}`;
  return <Card title="Images du site">
    <div className="stack" style={{ gap: 20 }}>
      <p className="small muted">Choisissez la page, sa section et l’emplacement, puis affectez une image de la médiathèque. L’image d’origine reste disponible.</p>
      <div className="form-grid">
        <Field label="Page"><select className="select" value={page} disabled={busy} onChange={e => { setPage(e.target.value); setSection(''); setSlotId(''); }}>
          {data.pages.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select></Field>
        <Field label="Section"><select className="select" value={selectedSection} disabled={busy} onChange={e => { setSection(e.target.value); setSlotId(''); }}>
          {sections.map(s => <option key={s}>{s}</option>)}
        </select></Field>
        <Field label="Emplacement" className="full"><select className="select" value={slot.id} disabled={busy} onChange={e => setSlotId(e.target.value)}>
          {positions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select></Field>
      </div>
      {page === 'home' && <p className="small muted">Les images du diaporama se choisissent dans <Link className="list-link" to="/contenu">Contenu du site → Diaporama d’accueil</Link>.</p>}
      <div className="site-image-assignment">
        <div className={`site-image-preview${page === 'shared' || slot.section === 'Partenaires' ? ' contain' : ''}`}>
          <img src={chosen?.url || defaultUrl} alt={alt || `${pageLabel} — ${slot.label}`} />
          <span className="badge">{chosen ? 'Image choisie' : 'Image d’origine'}</span>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <div><strong>{pageLabel} · {selectedSection}</strong><p className="small muted">{slot.label}</p></div>
          <p className="small tabular">{chosen?.original_name || 'Aucune image de la médiathèque affectée.'}</p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => setPicker(true)}><ImagePlus />{chosen ? 'Changer l’image' : 'Choisir une image'}</button>
            {chosen && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setChosen(null); setAlt(''); setDirty(true); }}><RotateCcw />Image d’origine</button>}
          </div>
          <Field label="Description de l’image" hint="Texte alternatif pour les images informatives. Facultatif pour un fond décoratif.">
            <input className="input" value={alt} maxLength={255} disabled={!chosen || busy} onChange={e => { setAlt(e.target.value); setDirty(true); }} />
          </Field>
          <ErrorBox error={error} />
          <div><button className="btn btn-primary" disabled={busy || !dirty} onClick={save}><Save />{busy ? 'Enregistrement…' : 'Enregistrer l’affectation'}</button></div>
          <p className="small muted">Les pages du site utilisent cette affectation à leur prochain chargement.</p>
        </div>
      </div>
    </div>
    {picker && <MediaPicker selectedId={chosen?.id} onClose={() => setPicker(false)} onPick={m => { setChosen(m); setDirty(true); }} />}
  </Card>;
}
