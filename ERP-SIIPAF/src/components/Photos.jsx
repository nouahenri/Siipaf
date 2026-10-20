import { useRef, useState } from 'react';
import { Camera, X, FileVideo } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useToast } from '@admin/lib/app-context';
import { isImage } from '../lib/sav';

/** Vignettes cliquables (ouverture en grand dans un nouvel onglet). */
export function Thumbs({ files, size = 72 }) {
  if (!files?.length) return null;
  return (
    <div className="thumbs">
      {files.map(f => (
        <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="thumb" style={{ width: size, height: size }} title={f.name || 'Photo'}>
          {isImage(f) ? <img src={f.url} alt={f.name || 'Photo jointe'} loading="lazy" /> : <FileVideo aria-label="Vidéo" />}
        </a>
      ))}
    </div>
  );
}

/** Ajout de photos (6 au plus) : téléversées tout de suite, `onChange` reçoit la liste à joindre. */
export function PhotoPicker({ value, onChange, leadId, max = 6 }) {
  const input = useRef(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const add = async list => {
    const files = [...list].slice(0, max - value.length);
    if (!files.length) return;
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    if (leadId) form.append('lead_id', String(leadId));
    setBusy(true);
    try {
      const saved = await api.post('/admin/erp/sav/files', form);
      onChange([...value, ...saved]);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  return (
    <div className="thumbs">
      {value.map(f => (
        <div key={f.id} className="thumb">
          {isImage(f) ? <img src={f.url} alt={f.name || 'Photo jointe'} /> : <FileVideo aria-label="Vidéo" />}
          <button type="button" className="thumb-del" onClick={() => onChange(value.filter(x => x.id !== f.id))} aria-label="Retirer la photo"><X /></button>
        </div>
      ))}
      {value.length < max && (
        <button type="button" className="thumb thumb-add" onClick={() => input.current?.click()} disabled={busy}>
          <Camera aria-hidden="true" /><span>{busy ? 'Envoi…' : 'Photo'}</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime" multiple hidden onChange={e => add(e.target.files)} />
    </div>
  );
}
