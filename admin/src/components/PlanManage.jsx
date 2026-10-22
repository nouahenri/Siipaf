/**
 * Actions sur un plan de masse existant : renommer, reconvertir (nouveau fichier), archiver ou restaurer,
 * supprimer. Utilisé dans la fiche projet et dans l'éditeur de plan.
 * Règles (serveur) : archiver retire le plan du site ; un plan publié ne se supprime pas
 * (on le retire du site d'abord, avec l'accord de l'utilisateur) ; les lots ne sont jamais perdus.
 */
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, RefreshCw, Archive, ArchiveRestore, Trash2, Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api';
import { useToast, useSaved } from '../lib/app-context';
import { Modal, Field, ErrorBox } from './ui';
import PlanImport from './PlanImport';

export default function PlanManage({ plan, projectId, onChanged, onDeleted, showPublish = false }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [pos, setPos] = useState(null);
  const wrap = useRef(null);
  const archived = !!plan.archived_at;

  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (e.type === 'keydown' ? e.key === 'Escape' : !wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const act = fn => () => { setOpen(false); fn(); };
  const patch = async (body, message) => {
    try { await api.patch(`/admin/plans/${plan.id}`, body); toast(message); onChanged?.(); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button className="btn btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={e => {
        // Position fixe sous le bouton : le menu n'est pas coupé par un tableau qui défile (sur téléphone : en bas de l'écran)
        const r = e.currentTarget.getBoundingClientRect();
        setPos(window.innerWidth > 600 ? { position: 'fixed', top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : null);
        setOpen(o => !o);
      }}><MoreHorizontal />Gérer</button>
      {open && (
        <div className="menu-pop" role="menu" style={pos || undefined}>
          {showPublish && !archived && (
            <button role="menuitem" onClick={act(() => patch({ published: !plan.published }, plan.published ? 'Plan retiré du site' : 'Plan publié sur le site'))}>
              {plan.published ? <><EyeOff />Retirer du site</> : <><Eye />Publier sur le site</>}
            </button>
          )}
          <button role="menuitem" onClick={act(() => setDialog('rename'))}><Pencil />Renommer</button>
          <button role="menuitem" onClick={act(() => setDialog('convert'))}><RefreshCw />Reconvertir / remplacer le fichier</button>
          <hr />
          {archived
            ? <button role="menuitem" onClick={act(() => patch({ archived: false }, 'Plan restauré (brouillon)'))}><ArchiveRestore />Restaurer</button>
            : <button role="menuitem" onClick={act(() => setDialog('archive'))}><Archive />Archiver</button>}
          <button role="menuitem" className="danger" onClick={act(() => setDialog('delete'))}><Trash2 />Supprimer</button>
        </div>
      )}

      {dialog === 'rename' && <RenameDialog plan={plan} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged?.(); }} />}
      {dialog === 'convert' && (
        <Modal title={`Reconvertir « ${plan.name} »`} onClose={() => setDialog(null)}>
          <p className="small muted" style={{ marginBottom: 12 }}>Importez la nouvelle version du plan : les lots sont mis à jour par leur numéro, leur statut et leurs dossiers sont conservés.</p>
          <PlanImport projectId={projectId} planId={plan.id} onDone={() => { setDialog(null); onChanged?.(); }} />
        </Modal>
      )}
      {dialog === 'archive' && (
        <Modal title={`Archiver « ${plan.name} » ?`} onClose={() => setDialog(null)} footer={<>
          <button className="btn" onClick={() => setDialog(null)}>Annuler</button>
          <button className="btn btn-primary" onClick={() => { setDialog(null); patch({ archived: true }, 'Plan archivé'); }}><Archive />Archiver</button>
        </>}>
          <p>Le plan est retiré du site et rangé dans les plans archivés. Ses lots et leurs formes sont conservés ; vous pourrez le restaurer à tout moment.</p>
        </Modal>
      )}
      {dialog === 'delete' && <DeleteDialog plan={plan} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onDeleted?.(); }} />}
    </div>
  );
}

function RenameDialog({ plan, onClose, onDone }) {
  const toast = useToast();
  const saved = useSaved();
  const [name, setName] = useState(plan.name);
  const [error, setError] = useState(null);
  const save = async e => {
    e?.preventDefault();
    try { await api.patch(`/admin/plans/${plan.id}`, { name }); saved('Plan renommé'); onDone(); } catch (err) { setError(err); }
  };
  return (
    <Modal title="Renommer le plan" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Enregistrer</button>
    </>}>
      <ErrorBox error={error} />
      <form onSubmit={save}><Field label="Nom du plan" hint="Affiché sur le site au-dessus de la carte."><input className="input" value={name} maxLength={160} onChange={e => setName(e.target.value)} autoFocus /></Field></form>
    </Modal>
  );
}

function DeleteDialog({ plan, onClose, onDone }) {
  const toast = useToast();
  const [withLots, setWithLots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    setBusy(true); setError(null);
    try {
      // Règle : un plan publié n'est pas supprimé tel quel ; il est d'abord retiré du site
      if (plan.published) await api.patch(`/admin/plans/${plan.id}`, { published: false });
      const r = await api.del(`/admin/plans/${plan.id}${withLots ? '?delete_lots=1' : ''}`);
      toast(['Plan supprimé', r.deleted ? `${r.deleted} lot(s) libre(s) supprimé(s)` : null, r.unplaced ? `${r.unplaced} lot(s) à placer` : null].filter(Boolean).join(' — '));
      onDone();
    } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Modal title={`Supprimer « ${plan.name} » ?`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={busy} onClick={remove}><Trash2 />{busy ? 'Suppression…' : 'Supprimer définitivement'}</button>
    </>}>
      <ErrorBox error={error} />
      <div className="stack" style={{ gap: 12 }}>
        {plan.published && <p className="alert alert-info">Ce plan est publié : il sera d’abord retiré du site.</p>}
        <p>Le plan et son tracé disparaissent. Les lots restent dans le projet, dans « Lots à placer » : vous pourrez les redessiner sur un autre plan.</p>
        <label className="checkbox"><input type="checkbox" checked={withLots} onChange={e => setWithLots(e.target.checked)} />
          <span>Supprimer aussi les lots <strong>libres</strong> de ce plan<br /><span className="small muted">Disponibles ou non commercialisés, sans pré-réservation ni dossier — utile après une conversion ratée. Les autres lots sont toujours conservés.</span></span>
        </label>
      </div>
    </Modal>
  );
}
