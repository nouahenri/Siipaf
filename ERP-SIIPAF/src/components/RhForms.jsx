/** Formulaires partagés du module RH : demande d'absence (libre-service ou saisie RH), note de frais. */
import { useEffect, useState } from 'react';
import { Send, Paperclip, CircleAlert, CalendarCheck } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useToast, useSaved } from '@admin/lib/app-context';
import { Modal, Field, ErrorBox, Badge } from '@admin/components/ui';
import { fcfa } from '@admin/lib/format';
import { RH, today, days, formData, useRhMeta, EXPENSE_TONES } from '../lib/rh';

export function LeaveBadge({ leave, meta }) {
  const st = meta?.statuses[leave.status];
  return <Badge tone={st?.tone}>{st?.label || leave.status}</Badge>;
}

export function TypeDot({ type, meta }) {
  return <span className="type-dot" style={{ background: meta?.leave_types[type]?.color || 'var(--border-strong)' }} aria-hidden="true" />;
}

/**
 * Demande d'absence. `employee` absent : demande de l'employé connecté (libre-service) ; présent : saisie par le
 * service RH pour cet employé, avec approbation immédiate possible. Le nombre de jours et les contrôles
 * (solde, plafonds, chevauchements) sont calculés par le serveur à chaque modification.
 */
export function LeaveForm({ employee = null, onClose, onSaved }) {
  const { meta } = useRhMeta();
  const toast = useToast();
  const saved = useSaved();
  const hr = !!employee;
  const [f, setF] = useState({ type: 'conge_annuel', event: '', start_date: today(), end_date: today(), start_half: false, end_half: false, reason: '', approve: true });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const type = meta?.leave_types[f.type];
  const body = () => ({
    type: f.type, event: f.type === 'permission' ? f.event || null : null, start_date: f.start_date, end_date: f.end_date < f.start_date ? f.start_date : f.end_date,
    start_half: f.start_half, end_half: f.end_half, reason: f.reason || null, ...(hr ? { employee_id: employee.id } : {}),
  });

  // Durée d'une permission : la date de fin suit l'événement choisi
  useEffect(() => {
    if (f.type !== 'permission' || !f.event || !meta) return;
    const n = meta.events[f.event].days;
    const d = new Date(`${f.start_date}T00:00:00Z`);
    let left = n - 1;
    while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (meta.settings.working_days.includes(d.getUTCDay())) left--; }
    setF(x => ({ ...x, end_date: d.toISOString().slice(0, 10) }));
  }, [f.type, f.event, f.start_date, meta]);

  useEffect(() => {
    if (f.type === 'permission' && !f.event) { setPreview(null); return; }
    const t = setTimeout(() => {
      api.post(hr ? `${RH}/leaves/preview` : `${RH}/me/leaves/preview`, body()).then(p => setPreview({ ...p, error: null })).catch(e => setPreview({ error: e.message }));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.type, f.event, f.start_date, f.end_date, f.start_half, f.end_half]);

  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      let document_id = null;
      if (file) {
        const doc = await api.post(hr ? `${RH}/employees/${employee.id}/documents` : `${RH}/me/documents`, formData({ kind: f.type === 'maladie' || f.type === 'accident_travail' ? 'certificat_medical' : 'attestation', label: `Justificatif — ${type?.label}` }, { file }));
        document_id = doc.id;
      }
      const r = await api.post(hr ? `${RH}/leaves` : `${RH}/me/leaves`, { ...body(), document_id, ...(hr ? { approve: f.approve } : {}) });
      saved(r.leave.status === 'approuvee' ? 'Absence enregistrée et approuvée' : 'Demande envoyée pour approbation');
      onSaved(r.leave);
    } catch (err) { setError(err); setBusy(false); }
  };

  const types = Object.entries(meta?.leave_types || {}).filter(([, t]) => hr || !t.hr_only);
  return (
    <Modal title={hr ? `Absence — ${employee.last_name} ${employee.first_name}` : 'Demander un congé ou une absence'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="leave-form" disabled={busy || !!preview?.error}><Send />{hr && f.approve ? 'Enregistrer' : 'Envoyer la demande'}</button></>}>
      <form id="leave-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Type" className="full">
          <select className="select" value={f.type} onChange={set('type')}>{types.map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select>
        </Field>
        {f.type === 'permission' && (
          <Field label="Événement familial" className="full" hint={meta ? `Après ${meta.settings.permission_min_months} mois de présence, ${meta.settings.permission_max_days} jours par an au plus, sans retenue sur salaire ni sur les congés` : undefined}>
            <select className="select" required value={f.event} onChange={set('event')}>
              <option value="">— Choisir —</option>
              {meta && Object.entries(meta.events).map(([k, ev]) => <option key={k} value={k}>{ev.label} ({days(ev.days)})</option>)}
            </select>
          </Field>
        )}
        <Field label="Du"><input className="input" type="date" required value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="Au"><input className="input" type="date" required min={f.start_date} value={f.end_date} onChange={set('end_date')} disabled={f.type === 'permission'} /></Field>
        {type?.count === 'ouvrables' && f.type !== 'permission' && (
          <div className="full row" style={{ gap: 16 }}>
            <label className="checkbox small"><input type="checkbox" checked={f.start_half} onChange={set('start_half')} />Commence l’après-midi</label>
            <label className="checkbox small"><input type="checkbox" checked={f.end_half} onChange={set('end_half')} />Se termine à midi</label>
          </div>
        )}
        <Field label="Motif / précisions" className="full"><textarea className="textarea" rows={2} maxLength={500} value={f.reason} onChange={set('reason')} /></Field>
        {(type?.needs_document || f.type === 'permission') && (
          <Field label="Justificatif" className="full" hint="Certificat médical, acte de mariage, extrait de naissance… (PDF ou photo)">
            <label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : 'Joindre un fichier'}<input type="file" hidden accept="application/pdf,image/*" onChange={e => setFile(e.target.files[0] || null)} /></label>
          </Field>
        )}
        {hr && <label className="checkbox full"><input type="checkbox" checked={f.approve} onChange={set('approve')} />Approuver immédiatement (saisie par le service RH)</label>}
        <div className="full">
          {preview?.error ? <div className="alert" role="alert"><CircleAlert className="ico" />{preview.error}</div> : preview && (
            <div className="erp-panel">
              <div className="row" style={{ gap: 8 }}><CalendarCheck className="ico" /><b>{days(preview.days)}</b> <span className="muted small">{type?.count === 'calendaires' ? 'calendaires' : 'ouvrables (hors dimanches et jours fériés)'}{type?.deducts ? ' décomptés du solde de congés' : ''}</span></div>
              {preview.warnings.map(w => <p key={w} className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>{w}</p>)}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** Note de frais : saisie ou modification d'un brouillon, avec la photo du reçu. */
export function ExpenseForm({ expense = null, onClose, onSaved }) {
  const { meta } = useRhMeta();
  const toast = useToast();
  const saved = useSaved();
  const [f, setF] = useState({
    date: expense?.date || today(), category: expense?.category || 'deplacement', label: expense?.label || '', amount: expense?.amount || '',
    vat_rate: expense?.vat_rate ?? 0, paid_by: expense?.paid_by || 'employe', project_id: expense?.project_id || '',
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const projects = meta?.projects || [];
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async (e, submit = false) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = formData({ ...f, project_id: f.project_id || 'null' }, { receipt: file });
      let x = expense ? await api.patch(`${RH}/expenses/${expense.id}`, body) : await api.post(`${RH}/me/expenses`, body);
      if (submit) x = await api.post(`${RH}/expenses/${x.id}/submit`);
      saved(submit ? 'Note de frais soumise pour approbation' : 'Brouillon enregistré');
      onSaved(x);
    } catch (err) { setError(err); setBusy(false); }
  };
  const cats = meta?.settings.expense_categories || {};
  const vat = Number(f.vat_rate) ? Math.round(f.amount - f.amount / (1 + f.vat_rate / 100)) : 0;
  return (
    <Modal title={expense ? `Note de frais ${expense.reference}` : 'Nouvelle note de frais'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn" form="exp-form" disabled={busy}>Enregistrer le brouillon</button><button className="btn btn-primary" disabled={busy || (!file && !expense?.receipt_url)} onClick={e => save(e, true)} title={!file && !expense?.receipt_url ? 'Joignez le reçu' : undefined}><Send />Soumettre</button></>}>
      <form id="exp-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} />{expense?.refusal_reason && <div className="alert">Refusée : {expense.refusal_reason}</div>}</div>
        <Field label="Date de la dépense"><input className="input" type="date" required max={today()} value={f.date} onChange={set('date')} /></Field>
        <Field label="Catégorie"><select className="select" value={f.category} onChange={set('category')}>{Object.entries(cats).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></Field>
        <Field label="Description" className="full"><input className="input" required minLength={3} maxLength={200} value={f.label} onChange={set('label')} placeholder="Carburant visite de chantier, déjeuner client…" /></Field>
        <Field label="Montant TTC (FCFA)"><input className="input" type="number" min="1" required value={f.amount} onChange={set('amount')} /></Field>
        <Field label="TVA incluse" hint={vat ? `dont TVA ${fcfa(vat)}` : 'Facture sans TVA : laissez 0'}><select className="select" value={f.vat_rate} onChange={set('vat_rate')}><option value="0">0 %</option><option value="9">9 %</option><option value="18">18 %</option></select></Field>
        <Field label="Payé par"><select className="select" value={f.paid_by} onChange={set('paid_by')}><option value="employe">Moi (à me rembourser)</option><option value="societe">La société (caisse, carte)</option></select></Field>
        <Field label="Programme concerné" hint="Pour imputer la dépense au chantier"><select className="select" value={f.project_id} onChange={set('project_id')}><option value="">Frais généraux</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Reçu ou facture" className="full" hint="Photo ou PDF, obligatoire pour soumettre">
          <label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : expense?.receipt_url ? 'Remplacer le reçu' : 'Joindre le reçu'}<input type="file" hidden accept="application/pdf,image/*" capture="environment" onChange={e => setFile(e.target.files[0] || null)} /></label>
        </Field>
      </form>
    </Modal>
  );
}

export const ExpenseBadge = ({ x }) => <Badge tone={EXPENSE_TONES[x.status]}>{x.status_label}</Badge>;
