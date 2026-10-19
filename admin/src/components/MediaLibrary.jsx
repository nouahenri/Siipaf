import { useRef, useState } from 'react';
import { FileText, Upload, Trash2, Film } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Modal, Empty, Skeleton } from './ui';

/** Lit largeur/hauteur d'une image côté navigateur avant l'envoi. */
const imageSize = file => new Promise(resolve => {
  if (!file.type.startsWith('image/')) return resolve({});
  const img = new Image();
  img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
  img.onerror = () => resolve({});
  img.src = URL.createObjectURL(file);
});

export function useUpload(onDone) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const upload = async files => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      const meta = [];
      for (const f of files) {
        if (f.size > 40 * 1024 * 1024) throw new Error(`${f.name} dépasse 40 Mo.`);
        form.append('files', f);
        meta.push(await imageSize(f));
      }
      form.append('meta', JSON.stringify(meta));
      const out = await api.post('/admin/media', form);
      toast(`${out.length} fichier(s) ajouté(s)`);
      onDone?.(out);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return { upload, busy };
}

export function Dropzone({ onFiles, busy, accept = 'image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/quicktime,video/webm' }) {
  const input = useRef();
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`} role="button" tabIndex={0}
      onClick={() => input.current.click()} onKeyDown={e => e.key === 'Enter' && input.current.click()}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}
    >
      <Upload style={{ margin: '0 auto 6px', display: 'block' }} aria-hidden="true" />
      {busy ? 'Envoi en cours…' : <>Glissez vos fichiers ici ou <u>parcourez</u><div className="small">JPG, PNG, WebP, PDF, MP4 — 40 Mo max. Pensez à compresser les photos (2000 px de large suffisent).</div></>}
      <input ref={input} type="file" multiple accept={accept} hidden onChange={e => { onFiles([...e.target.files]); e.target.value = ''; }} />
    </div>
  );
}

export function MediaThumb({ m, selected, onClick, children }) {
  const isImg = m.mime.startsWith('image/');
  return (
    <div className={`media-item ${selected ? 'selected' : ''}`}>
      <button type="button" className="thumb" style={{ width: '100%', border: 'none', cursor: onClick ? 'pointer' : 'default', backgroundImage: isImg ? `url(${m.url})` : undefined }} onClick={onClick} aria-label={m.original_name}>
        {!isImg && (m.mime === 'application/pdf' ? <FileText /> : <Film />)}
      </button>
      <div className="cap" title={m.original_name}>{m.original_name}</div>
      {children}
    </div>
  );
}

export function MediaGrid({ type, onPick, selectedId }) {
  const { can } = useAuth();
  const toast = useToast();
  const media = useResource(`/admin/media${type ? `?type=${type}` : ''}`);
  const { upload, busy } = useUpload(() => media.reload());

  const remove = async m => {
    if (!window.confirm(`Supprimer « ${m.original_name} » ?`)) return;
    try { await api.del(`/admin/media/${m.id}`); media.reload(); toast('Fichier supprimé'); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      {can('media:write') && <Dropzone onFiles={upload} busy={busy} accept={type === 'image' ? 'image/jpeg,image/png,image/webp' : type === 'video' ? 'video/mp4,video/quicktime,video/webm' : undefined} />}
      {media.loading && !media.data ? <Skeleton h={160} />
        : !media.data?.length ? <Empty>Aucun fichier pour l’instant.</Empty>
        : (
          <div className="media-grid">
            {media.data.map(m => (
              <MediaThumb key={m.id} m={m} selected={selectedId === m.id} onClick={onPick ? () => onPick(m) : () => window.open(m.url, '_blank')}>
                {!onPick && can('media:write') && (
                  <button className="btn btn-sm btn-ghost btn-danger" style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(255,255,255,.9)' }} onClick={() => remove(m)} aria-label={`Supprimer ${m.original_name}`}><Trash2 /></button>
                )}
              </MediaThumb>
            ))}
          </div>
        )}
    </div>
  );
}

export function MediaPicker({ type = 'image', onPick, onClose, selectedId }) {
  return (
    <Modal title={type === 'video' ? 'Choisir une vidéo' : type === 'image' ? 'Choisir une photo' : 'Choisir un fichier'} onClose={onClose}>
      <MediaGrid type={type} selectedId={selectedId} onPick={m => { onPick(m); onClose(); }} />
    </Modal>
  );
}
