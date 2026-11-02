import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useToast } from '@admin/lib/app-context';
import { Modal, Field } from '@admin/components/ui';
import { usePaieMeta } from '../lib/paie';
import { RH } from '../lib/rh';

/**
 * Reprise du personnel déjà présent (RH › Personnel) : une fiche par compte du dashboard choisi ; nom, e-mail, poste et service
 * repris du compte. La Comptabilité fixe ensuite le salaire (Comptabilité › Employés).
 */
export default function EmployeesFromUsers({ onClose, onDone }) {
  const toast = useToast();
  const { meta, reload } = usePaieMeta();
  const free = (meta?.users || []).filter(u => !u.employee_id);
  const [ids, setIds] = useState([]);
  const [hire, setHire] = useState(new Date().toISOString().slice(0, 10));
  const save = async () => {
    try { const r = await api.post(`${RH}/employees/from-users`, { user_ids: ids, hire_date: hire }); toast(`${r.created} fiche(s) créée(s) : complétez le contrat ; la Comptabilité fixe le salaire`); reload(); onDone(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Créer les fiches depuis les comptes du dashboard" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!ids.length} onClick={save}><UserPlus />Créer {ids.length || ''}</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="small">Nom, e-mail et service sont repris du compte ; la fiche reste reliée au compte (même personne dans le dashboard et l’ERP).</p>
        {!free.length ? <p className="muted small">Tous les comptes ont déjà une fiche.</p> : (
          <ul className="pick-list">
            {free.map(u => <li key={u.id}><label className="checkbox" style={{ padding: '8px 12px', width: '100%' }}><input type="checkbox" checked={ids.includes(u.id)} onChange={e => setIds(s => (e.target.checked ? [...s, u.id] : s.filter(x => x !== u.id)))} /><b>{u.name}</b> <span className="small muted">{u.email}</span></label></li>)}
          </ul>
        )}
        <Field label="Date d’entrée"><input className="input" type="date" value={hire} onChange={e => setHire(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
