import { useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/app-context';
import { Modal, Field, ErrorBox } from './ui';

export default function ProjectActions({ project, onChanged, onDeleted, onBusyChange, disabled = false }) {
  const toast = useToast();
  const [dialog, setDialog] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const archived = !!project.archived_at;
  const open = action => { setError(null); setConfirmation(''); setDialog(action); };
  const close = () => { if (!busy) setDialog(null); };
  const apply = async () => {
    if (busy || (dialog === 'delete' && confirmation !== project.name)) return;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      if (dialog === 'delete') {
        await api.del(`/admin/projects/${project.id}`);
        toast('Projet supprimé');
        onDeleted();
      } else {
        await api.patch(`/admin/projects/${project.id}`, { archived: !archived });
        toast(archived ? 'Projet restauré (non publié)' : 'Projet archivé');
        onChanged();
      }
      setDialog(null);
    } catch (e) { setError(e); }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  const deleting = dialog === 'delete';

  return <>
    <button className="btn" disabled={disabled || busy} onClick={() => open('archive')}>
      {archived ? <ArchiveRestore /> : <Archive />}{archived ? 'Restaurer' : 'Archiver'}
    </button>
    <button className="btn btn-danger" disabled={disabled || busy} onClick={() => open('delete')}><Trash2 />Supprimer</button>
    {dialog && <Modal
      title={`${deleting ? 'Supprimer' : archived ? 'Restaurer' : 'Archiver'} le projet`}
      onClose={close}
      footer={<>
        <button className="btn" onClick={close} disabled={busy}>Annuler</button>
        <button className={`btn ${deleting ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (deleting && confirmation !== project.name)} onClick={apply}>
          {busy ? 'Traitement…' : deleting ? 'Supprimer définitivement' : archived ? 'Restaurer' : 'Archiver'}
        </button>
      </>}
    >
      <div className="stack">
        <ErrorBox error={error} />
        <p><strong>{project.name}</strong></p>
        {deleting ? <>
          <p>Cette suppression est définitive. Elle supprime aussi les lots ({project.lot_count || 0}), les plans ({project.plans?.length || 0}) et la grille de prix du projet.</p>
          <p className="small muted">Un projet lié à des contacts, des ventes ou un suivi client ne peut pas être supprimé : utilisez l’archivage pour conserver son historique. Les fichiers de la médiathèque sont conservés.</p>
          <Field label="Retapez le nom du projet pour confirmer">
            <input className="input" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" disabled={busy} />
          </Field>
        </> : <p>{archived
          ? 'Le projet revient dans la liste active, sans être publié. Vous pourrez ensuite le republier depuis sa fiche.'
          : 'Le projet sera retiré du site et rangé dans les projets archivés. Ses lots, dossiers et versements sont conservés. Vous pourrez le restaurer à tout moment.'}</p>}
      </div>
    </Modal>}
  </>;
}
