/**
 * Fiche employé : le même formulaire dans Ressources humaines (dossier) et Comptabilité (employés), demande du client du 29/10.
 * Mêmes champs partout ; chacun n'est modifiable qu'avec le droit qui le gouverne (même règle côté serveur, services/employees) :
 * identité, contrat, responsable → dossiers du personnel ou fiches salariés ; salaire et paiement → fiches salariés ;
 * solde de congés repris → gérer les absences. Poste et service d'une fiche existante : « Changer de poste » (date d'effet, historique).
 */
import { useState } from 'react';
import { ArrowRightLeft, FileText, Trash2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { ErrorBox, Modal, Field } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { usePaieMeta } from '../lib/paie';
import { RH, directionOf } from '../lib/rh';
import { PositionSelect, usePositions, ChangePositionModal } from './Positions';

const PAY = ['base_salary', 'housing_allowance', 'transport_allowance', 'other_allowance', 'site_hourly_rate', 'accident_rate', 'pay_method', 'bank_account', 'tax_parts', 'expatriate'];
const LEAVE = ['leave_opening_days', 'leave_opening_date'];
const NUMBERS = ['children', 'tax_parts', 'base_salary', 'housing_allowance', 'transport_allowance', 'other_allowance', 'site_hourly_rate', 'accident_rate', 'project_id', 'user_id', 'position_id', 'manager_id', 'leave_opening_days'];
const BLANK = {
  matricule: '', last_name: '', first_name: '', gender: '', birth_date: '', birth_place: '', nationality: 'Ivoirienne', expatriate: false, phone: '', email: '', address: '',
  id_type: '', id_number: '', cnps_number: '', emergency_contact: '', user_id: '',
  job_title: '', position_id: '', department: 'administratif', category: '', contract_type: 'cdi', hire_date: new Date().toISOString().slice(0, 10), trial_end_date: '', end_date: '',
  manager_id: '', project_id: '', active: true, leave_opening_days: '', leave_opening_date: '',
  marital_status: 'celibataire', children: 0, tax_parts: '',
  base_salary: '', housing_allowance: 0, transport_allowance: 0, other_allowance: 0, site_hourly_rate: '', accident_rate: '', pay_method: 'virement', bank_account: '', notes: '',
};

export default function EmployeeForm({ employee, onClose, onSaved }) {
  const { can } = useAuth();
  const saved = useSaved();
  const { meta, reload } = usePaieMeta();
  const positions = usePositions();
  const staff = useResource('/admin/erp/paie/employees?active=1');
  const isNew = !employee.id;
  // Salaire inconnu (fiche lue sans le droit paie) : jamais renvoyé, pour ne pas l'écraser
  const seePay = isNew || employee.base_salary !== undefined, canPay = can('paie:salary') && seePay, canLeave = can('conges:adjust'), canLink = isNew || can('users:edit'); // changer le compte d'une fiche existante : « Modifier un compte »
  // Fiche existante : poste et service changent par « Changer de poste » (date d'effet, motif, historique) quand on tient les dossiers RH
  const viaChange = !isNew && can('rh:files');
  // Matricule attribué par le service RH (jamais numéroté automatiquement) : identifiant à la borne et code de tiers en Comptabilité
  const canMatricule = can('rh:files');
  const [initial] = useState(() => Object.fromEntries(Object.entries(BLANK).map(([k, v]) => [k, employee[k] ?? v])));
  const [f, setF] = useState(initial);
  const [error, setError] = useState(null);
  const [change, setChange] = useState(false);
  const [idFiles, setIdFiles] = useState({ complet: null, recto: null, verso: null }); // pièce d'identité à envoyer à l'enregistrement
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const suggested = Math.min(5, 1 + (f.marital_status === 'marie' ? 1 : 0) + 0.5 * (Number(f.children) || 0));
  const save = async e => {
    e.preventDefault(); setError(null);
    const body = {};
    for (const [k, v] of Object.entries(f)) {
      if ((PAY.includes(k) && !canPay) || (LEAVE.includes(k) && !canLeave) || (k === 'user_id' && !canLink)) continue;
      if (viaChange && ['job_title', 'position_id', 'department'].includes(k)) continue;
      if (k === 'matricule' && !canMatricule) continue;
      if (!isNew && v === initial[k]) continue; // fiche existante : seuls les champs modifiés sont envoyés
      body[k] = NUMBERS.includes(k) ? (v === '' || v == null ? null : Number(v)) : typeof v === 'string' && v === '' ? null : v;
    }
    if (body.matricule) body.matricule = body.matricule.trim().toUpperCase();
    for (const k of ['children', 'housing_allowance', 'transport_allowance', 'other_allowance', 'base_salary']) if (k in body) body[k] = body[k] ?? 0;
    const sides = ['complet', 'recto', 'verso'].filter(s => idFiles[s]);
    if (!isNew && !Object.keys(body).length && !sides.length) { onClose(); return; }
    if (!body.position_id) delete body.position_id;
    if (isNew) delete body.active;
    let id = employee.id;
    try {
      if (isNew) id = (await api.post(`${RH}/employees`, body)).id; // création : service RH
      else if (Object.keys(body).length) await api.patch(`${RH}/employees/${employee.id}`, body);
    } catch (err) { setError(err); return; }
    // Pièce d'identité choisie : envoyée une fois la fiche enregistrée ; un échec n'annule pas la fiche (à renvoyer en la modifiant)
    let idError = null;
    for (const side of sides) {
      try { const fd = new FormData(); fd.append('file', idFiles[side]); await api.put(`${RH}/employees/${id}/identity/${side}`, fd); } catch (err) { idError = err; }
    }
    // Sortie : le bilan de départ (compte, matériel, dossiers) est dans la fiche RH, les responsables sont prévenus
    const leaving = !isNew && employee.active && !f.active;
    reload();
    saved(idError ? `Fiche enregistrée, mais la pièce d’identité n’a pas été envoyée : ${idError.message}`
      : leaving ? 'Sortie enregistrée : le bilan de départ est dans la fiche RH (Ressources humaines › Personnel)' : isNew ? 'Fiche créée : la Comptabilité est prévenue pour la paie' : 'Fiche employé enregistrée');
    onSaved();
  };
  const users = (meta?.users || []).filter(u => !u.employee_id || u.employee_id === employee.id);
  const options = obj => obj && Object.entries(obj).map(([k, v]) => <option key={k} value={k}>{v}</option>);
  const payHint = canPay ? undefined : 'Réservé au droit « Salaire et paiement » (Comptabilité)';
  return (
    <Modal title={isNew ? 'Nouvel employé' : `${employee.last_name} ${employee.first_name} · ${employee.matricule}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="emp-form">Enregistrer</button></>}>
      <form id="emp-form" className="stack wide-form" style={{ gap: 14 }} onSubmit={save}>
        <ErrorBox error={error} />
        <h3 className="erp-h3">Identité</h3>
        <div className="form-grid">
          <Field label="Matricule" hint={canMatricule ? (isNew ? 'Attribué par le service RH : 3 à 20 caractères (lettres, chiffres, tirets). Sert aussi à pointer à la borne.' : 'Le changer prévient l’employé : c’est son identifiant à la borne de pointage.') : 'Attribué par le service RH'}>
            <input className="input" style={{ textTransform: 'uppercase' }} required={isNew} readOnly={!canMatricule} minLength={3} maxLength={20} pattern="[A-Za-z0-9][A-Za-z0-9\-]{2,19}" title="3 à 20 caractères : lettres, chiffres, tirets" value={f.matricule} onChange={set('matricule')} autoFocus={isNew} />
          </Field>
          <Field label="Nom"><input className="input" required value={f.last_name} onChange={set('last_name')} /></Field>
          <Field label="Prénoms"><input className="input" required value={f.first_name} onChange={set('first_name')} /></Field>
          <Field label="Sexe"><select className="select" value={f.gender} onChange={set('gender')}><option value="">—</option><option value="F">Femme</option><option value="M">Homme</option></select></Field>
          <Field label="Nationalité"><input className="input" value={f.nationality} onChange={set('nationality')} /></Field>
          <Field label="Date de naissance"><input className="input" type="date" value={f.birth_date} onChange={set('birth_date')} /></Field>
          <Field label="Lieu de naissance"><input className="input" value={f.birth_place} onChange={set('birth_place')} /></Field>
          <Field label="Téléphone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Adresse" className="full"><input className="input" value={f.address} onChange={set('address')} /></Field>
          <Field label="Type de pièce d’identité"><select className="select" value={f.id_type} onChange={set('id_type')}><option value="">—</option>{meta && Object.entries(meta.id_types || {}).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select></Field>
          <Field label={meta?.id_types?.[f.id_type]?.number || 'N° de la pièce d’identité'}><input className="input" value={f.id_number} onChange={set('id_number')} /></Field>
          <Field label="N° CNPS"><input className="input" value={f.cnps_number} onChange={set('cnps_number')} /></Field>
          <IdentityFiles employeeId={employee.id} idType={f.id_type} idTypes={meta?.id_types} files={idFiles} onPick={(side, file) => setIdFiles(x => ({ ...x, [side]: file }))} />
          <Field label="Contact en cas d’urgence"><input className="input" value={f.emergency_contact} onChange={set('emergency_contact')} placeholder="Nom, lien, téléphone" /></Field>
          <Field label="Compte du dashboard" hint={canLink ? 'Relie la fiche au compte de connexion de la même personne' : 'Réservé au droit « Modifier un compte »'}>
            <select className="select" disabled={!canLink} value={f.user_id || ''} onChange={set('user_id')}><option value="">— Aucun —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select>
          </Field>
        </div>
        <h3 className="erp-h3">Poste et contrat</h3>
        <div className="form-grid">
          {viaChange ? (
            <>
              <Field label="Poste et service" hint="Nouveau poste ou autre service : date d’effet, motif et historique">
                <div className="row" style={{ gap: 8 }}>
                  <input className="input" disabled value={`${employee.job_title} · ${meta?.departments[employee.department] || employee.department}`} />
                  {employee.active && <button type="button" className="btn" onClick={() => setChange(true)}><ArrowRightLeft />Changer de poste</button>}
                </div>
              </Field>
              <Field label="Direction" hint="Direction du service d’appartenance"><input className="input" disabled value={directionOf(meta, employee.department)} /></Field>
            </>
          ) : (
            <>
              <Field label="Poste"><PositionSelect value={f.job_title} positions={positions.data?.positions} onPick={p => setF(x => ({ ...x, job_title: p.title, position_id: p.id, department: p.department, category: x.category || p.category || '' }))} /></Field>
              <Field label="Service"><select className="select" value={f.department} onChange={set('department')}>{options(meta?.departments)}</select></Field>
              <Field label="Direction" hint="Suit le service choisi (RH › Réglages)"><input className="input" disabled value={directionOf(meta, f.department)} /></Field>
            </>
          )}
          <Field label="Contrat"><select className="select" value={f.contract_type} onChange={set('contract_type')}>{options(meta?.contract_types)}</select></Field>
          <Field label="Catégorie professionnelle"><input className="input" value={f.category} onChange={set('category')} /></Field>
          <Field label="Date d’entrée"><input className="input" type="date" required value={f.hire_date} onChange={set('hire_date')} /></Field>
          <Field label="Fin de la période d’essai"><input className="input" type="date" value={f.trial_end_date} onChange={set('trial_end_date')} /></Field>
          <Field label="Date de sortie / fin de contrat"><input className="input" type="date" value={f.end_date} onChange={set('end_date')} /></Field>
          <Field label="Responsable direct" hint="Premier niveau d’accord des congés et des notes de frais">
            <select className="select" value={f.manager_id ?? ''} onChange={set('manager_id')}><option value="">— Aucun —</option>{(staff.data || []).filter(x => x.id !== employee.id).map(x => <option key={x.id} value={x.id}>{x.last_name} {x.first_name}</option>)}</select>
          </Field>
          <Field label="Affectation (programme)" hint="Ventile le coût salarial sur le chantier (analytique)">
            <select className="select" value={f.project_id || ''} onChange={set('project_id')}><option value="">Frais généraux (siège)</option>{meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Field>
          {!isNew && <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={f.active} onChange={set('active')} />En poste</label>}
          <Field label="Solde de congés repris (jours)" hint={canLeave ? 'Solde de l’ancienne gestion, à la date ci-contre' : 'Réservé au droit « Ajuster les soldes »'}><input className="input" type="number" step="0.5" disabled={!canLeave} value={f.leave_opening_days ?? ''} onChange={set('leave_opening_days')} /></Field>
          <Field label="Date de reprise du solde" hint="L’acquisition de 2,2 j / mois repart de cette date"><input className="input" type="date" disabled={!canLeave} value={f.leave_opening_date ?? ''} onChange={set('leave_opening_date')} /></Field>
        </div>
        <h3 className="erp-h3">Famille (ITS et CMU)</h3>
        <div className="form-grid">
          <Field label="Situation de famille"><select className="select" value={f.marital_status} onChange={set('marital_status')}>{options(meta?.marital)}</select></Field>
          <Field label="Enfants à charge" hint="Compte pour les jours de congé supplémentaires et la paie"><input className="input" type="number" min="0" max="20" value={f.children} onChange={set('children')} /></Field>
          {seePay && <Field label="Parts fiscales" hint={canPay ? `Proposé : ${suggested} (à confirmer par le comptable)` : payHint}><input className="input" type="number" min="1" max="5" step="0.5" disabled={!canPay} value={f.tax_parts ?? ''} onChange={set('tax_parts')} placeholder={String(suggested)} /></Field>}
        </div>
        <h3 className="erp-h3">Rémunération mensuelle</h3>
        {!seePay ? <p className="small muted">Salaire, indemnités et moyen de paiement : tenus par la Comptabilité (droit « Salaire et paiement »).</p> : (
          <fieldset className="form-grid" disabled={!canPay} style={{ border: 0, padding: 0, margin: 0 }}>
            {!canPay && <p className="small muted full">{payHint}.</p>}
            <Field label="Salaire de base (FCFA)" hint={meta?.settings ? `SMIG : ${fcfa(meta.settings.smig)}` : undefined}><input className="input" type="number" min="0" required={canPay} value={f.base_salary ?? ''} onChange={set('base_salary')} /></Field>
            <Field label="Indemnité de logement"><input className="input" type="number" min="0" value={f.housing_allowance ?? ''} onChange={set('housing_allowance')} /></Field>
            <Field label="Indemnité de transport" hint={meta?.settings ? `Non imposable jusqu’à ${fcfa(meta.settings.transport_exempt_ceiling)}` : undefined}><input className="input" type="number" min="0" value={f.transport_allowance ?? ''} onChange={set('transport_allowance')} /></Field>
            <Field label="Autres primes fixes"><input className="input" type="number" min="0" value={f.other_allowance ?? ''} onChange={set('other_allowance')} /></Field>
            <Field label="Coût horaire de chantier (FCFA)" hint="Journaliers, intérim : coût d’une heure pointée sur un chantier. Vide : tiré du salaire et des charges de la paie (ERP › Chantiers › Réglages)"><input className="input" type="number" min="0" value={f.site_hourly_rate ?? ''} onChange={set('site_hourly_rate')} placeholder="Tiré du salaire" /></Field>
            <Field label="Taux accident du travail (%)" hint={meta?.settings ? `Barème : ${meta.settings.accident_rate} % (chantier : souvent plus élevé)` : undefined}><input className="input" type="number" min="0" max="10" step="0.5" value={f.accident_rate ?? ''} onChange={set('accident_rate')} placeholder="Barème" /></Field>
            <Field label="Paiement"><select className="select" value={f.pay_method} onChange={set('pay_method')}>{options(meta?.pay_methods)}</select></Field>
            <Field label="RIB / n° Mobile Money"><input className="input" value={f.bank_account ?? ''} onChange={set('bank_account')} /></Field>
            <label className="checkbox full"><input type="checkbox" checked={!!f.expatriate} onChange={set('expatriate')} />Personnel expatrié (contribution employeur majorée)</label>
          </fieldset>
        )}
        <Field label="Notes internes"><textarea className="textarea" rows={2} value={f.notes ?? ''} onChange={set('notes')} /></Field>
      </form>
      {change && <ChangePositionModal d={{ employee, user: (meta?.users || []).find(u => u.id === employee.user_id) || null }} onClose={() => setChange(false)} onSaved={() => { setChange(false); onSaved(); }} />}
    </Modal>
  );
}

const ID_FILE_TYPES = { 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPG' };
const ID_MAX = 10 * 1024 * 1024;
const ID_SLOTS = { un: [['complet', 'Recto et verso (un seul fichier)']], deux: [['recto', 'Recto'], ['verso', 'Verso']] };
const SIDE_NAMES = { complet: 'la pièce', recto: 'le recto', verso: 'le verso' };

/**
 * Pièce d'identité (demandes du client des 02 et 03/11) : PDF, PNG ou JPG, en un seul fichier (recto et verso dans le même
 * fichier, ou page unique du passeport) ou en deux fichiers (recto, verso) ; envoyée à l'enregistrement de la fiche, une forme
 * remplace l'autre. Dépôt : « Joindre et supprimer des pièces » ; consultation : « Voir les pièces du dossier ».
 */
function IdentityFiles({ employeeId, idType, idTypes, files, onPick }) {
  const { can } = useAuth();
  const toast = useToast();
  const write = can('rh:documents_write');
  const current = useResource(employeeId ? `${RH}/employees/${employeeId}/identity` : null);
  const [error, setError] = useState(null);
  const [chosen, setChosen] = useState(null);
  const saved = current.data;
  if (!write && !saved) return null;
  // Forme : celle déjà déposée, sinon celle d'usage pour le type de pièce (passeport, attestation : un seul fichier)
  const mode = chosen || (saved?.complet ? 'un' : saved?.recto || saved?.verso ? 'deux' : idTypes?.[idType]?.single ? 'un' : 'deux');
  const setMode = m => { setChosen(m); for (const [side] of ID_SLOTS[m === 'un' ? 'deux' : 'un']) onPick(side, null); };
  const pick = side => e => {
    const file = e.target.files?.[0] || null;
    setError(null);
    if (file && !ID_FILE_TYPES[file.type]) { setError('Pièce d’identité : choisissez un PDF, un PNG ou un JPG.'); e.target.value = ''; return; }
    if (file && file.size > ID_MAX) { setError('Fichier trop lourd : 10 Mo au plus.'); e.target.value = ''; return; }
    onPick(side, file);
  };
  const remove = async side => {
    if (!window.confirm(`Retirer ${SIDE_NAMES[side]} de la pièce d’identité du dossier ?`)) return;
    try { current.setData({ ...saved, ...(await api.del(`${RH}/employees/${employeeId}/identity/${side}`)) }); toast('Pièce retirée'); } catch (err) { toast(err.message, 'err'); }
  };
  const other = mode === 'un' ? (saved?.recto || saved?.verso) : saved?.complet;
  return (
    <div className="full stack" style={{ gap: 8 }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="small" style={{ fontWeight: 500 }}>Fichier de la pièce d’identité — PDF, PNG ou JPG, 10 Mo au plus</span>
        {write && (
          <div className="seg" role="group" aria-label="Forme du fichier">
            <button type="button" className={mode === 'un' ? 'active' : ''} onClick={() => setMode('un')}>Un seul fichier</button>
            <button type="button" className={mode === 'deux' ? 'active' : ''} onClick={() => setMode('deux')}>Recto et verso séparés</button>
          </div>
        )}
      </div>
      <div className="form-grid">
        {ID_SLOTS[mode].map(([side, label]) => {
          const doc = saved?.[side];
          return (
            <div key={side} className={`stack ${mode === 'un' ? 'full' : ''}`} style={{ gap: 6 }}>
              <span className="small muted">{label}</span>
              {doc && (
                <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <FileText className="ico" aria-hidden="true" />
                  {saved.can_view ? <a className="link" href={doc.url} target="_blank" rel="noreferrer">{doc.original_name || 'Pièce déposée'}</a> : <span>{doc.original_name || 'Pièce déposée'}</span>}
                  <span className="muted">déposée le {date(doc.uploaded_at)}</span>
                  {write && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(side)} aria-label={`Retirer ${SIDE_NAMES[side]}`}><Trash2 /></button>}
                </div>
              )}
              {write && <input className="input" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={pick(side)} aria-label={`Pièce d’identité, ${label.toLowerCase()}`} />}
              {files[side] && <span className="small muted">{doc || other ? 'Remplacera la pièce actuelle' : 'Sera envoyée'} à l’enregistrement : {files[side].name}</span>}
            </div>
          );
        })}
      </div>
      {other && write && <span className="small muted">Une pièce est déjà déposée sous l’autre forme ({mode === 'un' ? 'recto et verso séparés' : 'un seul fichier'}) : un nouvel envoi la remplacera.</span>}
      {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
      {!write && <span className="small muted">Dépôt réservé au droit « Joindre et supprimer des pièces ».</span>}
    </div>
  );
}
