import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useToast } from '@admin/lib/app-context';
import { Modal, Field } from '@admin/components/ui';
import { usePaieMeta } from '../lib/paie';
import { RH } from '../lib/rh';

/**
 * Reprise du personnel déjà présent (RH › Personnel) : une fiche par compte du dashboard choisi ; nom, e-mail, poste et service
 * repris du compte ; le matricule est saisi par le service RH pour chacun (jamais numéroté automatiquement, demande du 03/11).
 * La Comptabilité fixe ensuite le salaire (Comptabilité › Employés).
 */
export default function EmployeesFromUsers({ onClose, onDone }) {
  const toast = useToast();
  const { meta, reload } = usePaieMeta();
  const free = (meta?.users || []).filter(u => !u.employee_id);
  const [codes, setCodes] = useState({}); // compte choisi -> matricule saisi
  const ids = Object.keys(codes).map(Number);
  const ready = ids.length > 0 && ids.every(id => codes[id].trim().length >= 3);
  const [hire, setHire] = useState(new Date().toISOString().slice(0, 10));
  const save = async () => {
    try { const r = await api.post(`${RH}/employees/from-users`, { people: ids.map(id => ({ user_id: id, matricule: codes[id].trim().toUpperCase() })), hire_date: hire }); toast(`${r.created} fiche(s) créée(s) : complétez le contrat ; la Comptabilité fixe le salaire`); reload(); onDone(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Créer les fiches depuis les comptes du dashboard" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!ready} onClick={save}><UserPlus />Créer {ids.length || ''}</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="small">Nom, e-mail et service sont repris du compte ; la fiche reste reliée au compte (même personne dans le dashboard et l’ERP). Saisissez le matricule attribué à chaque personne choisie.</p>
        {!free.length ? <p className="muted small">Tous les comptes ont déjà une fiche.</p> : (
          <ul className="pick-list">
            {free.map(u => (
              <li key={u.id} className="row" style={{ gap: 8, alignItems: 'center', paddingRight: 8 }}>
                <label className="checkbox" style={{ padding: '8px 12px', flex: 1, minWidth: 0 }}><input type="checkbox" checked={u.id in codes} onChange={e => setCodes(c => { const n = { ...c }; if (e.target.checked) n[u.id] = ''; else delete n[u.id]; return n; })} /><b>{u.name}</b> <span className="small muted">{u.email}</span></label>
                {u.id in codes && <input className="input" style={{ width: 140, textTransform: 'uppercase' }} required maxLength={20} placeholder="Matricule" aria-label={`Matricule de ${u.name}`} value={codes[u.id]} onChange={e => setCodes(c => ({ ...c, [u.id]: e.target.value }))} />}
              </li>
            ))}
          </ul>
        )}
        <Field label="Date d’entrée"><input className="input" type="date" value={hire} onChange={e => setHire(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
