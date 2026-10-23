/**
 * Juridique › Litiges (choix du client du 23/10) : origine (SAV, impayé, fournisseur, sous-traitant, employé, autre),
 * partie adverse, montant en jeu, étapes datées jusqu'à la clôture avec son issue, prochaine échéance (alerte la
 * veille et le jour), pièces. Confidentiel : Juridique, Direction, juriste en charge et service concerné.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Scale, Search, Check, Pencil, Undo2, Paperclip, FileText, Flag } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Drawer, Modal, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { today, formData } from '../../lib/rh';
import { JUR, LIT_TONES, DaysLeft } from '../../lib/juridique';

export default function Litiges() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('ouvert');
  const [origin, setOrigin] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const refs = useResource(`${JUR}/refs`);
  const list = useResource(`${JUR}/litiges${qs({ status, origin, q })}`);
  const open = Number(params.get('fiche')) || null;
  // Depuis Juridique › Impayés : « Ouvrir un litige » pré-remplit l'origine, la vente, la partie adverse et le montant
  const preset = params.get('nouveau') === 'impaye' ? { origin: 'impaye', sale_id: params.get('vente') || '', opponent: params.get('client') || '', amount_fcfa: params.get('montant') || '', title: 'Recouvrement d’échéances impayées' } : null;
  const [form, setForm] = useState(preset ? { litigation: null, preset } : null);
  const setOpen = id => setParams(id ? { fiche: String(id) } : {}, { replace: true });
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const write = can('juridique:write');

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="Statut">
            {[['ouvert', 'En cours'], ['clos', 'Clos'], ['', 'Tous']].map(([k, l]) => <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}
          </div>
          <select className="select" style={{ width: 'auto' }} value={origin} onChange={e => setOrigin(e.target.value)} aria-label="Origine">
            <option value="">Toutes les origines</option>{refs.data && Object.entries(refs.data.origins).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label style={{ position: 'relative' }}>
            <Search aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, opacity: 0.5 }} />
            <input className="input" style={{ paddingLeft: 32, width: 220 }} type="search" placeholder="Référence, objet, partie adverse…" value={text} onChange={e => setText(e.target.value)} aria-label="Rechercher" />
          </label>
        </div>
        {write && <button className="btn btn-primary" onClick={() => setForm({ litigation: null })}><Plus />Nouveau litige</button>}
      </div>

      <Card bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !list.data.length ? (
          <div className="card-body"><Empty icon={Scale}>Aucun litige.</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Référence</th><th>Litige</th><th>Partie adverse</th><th className="right">Montant en jeu</th><th>Étape</th><th>Prochaine échéance</th></tr></thead>
            <tbody>{list.data.map(l => (
              <tr key={l.id} className="clickable" onClick={() => setOpen(l.id)}>
                <td className="small tabular nowrap"><b>{l.reference}</b><div className="muted">ouvert le {date(l.opened_on)}</div></td>
                <td>{l.title}<div className="small muted">{l.origin_label}{l.owner_name ? ` · ${l.owner_name}` : ''}</div></td>
                <td>{l.opponent}</td>
                <td className="right tabular">{l.amount_fcfa ? fcfa(l.amount_fcfa) : '—'}</td>
                <td><Badge tone={LIT_TONES[l.stage]}>{l.status === 'clos' ? `Clos · ${l.outcome_label || ''}` : l.stage_label}</Badge></td>
                <td className="small">{l.next_date ? <>{l.next_label || 'Échéance'}<div className="nowrap">{date(l.next_date)} <DaysLeft n={l.days_left} /></div></> : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      {open && refs.data && <LitigationDrawer id={open} refs={refs.data} onClose={() => setOpen(null)} onChange={() => list.reload()} onEdit={l => setForm({ litigation: l })} />}
      {form && refs.data && (
        <LitigationForm litigation={form.litigation} preset={form.preset} refs={refs.data}
          onClose={() => { setForm(null); if (form.preset) setParams({}, { replace: true }); }}
          onSaved={l => { setForm(null); list.reload(); setOpen(l.id); }} />
      )}
    </div>
  );
}

function LitigationDrawer({ id, refs, onClose, onChange, onEdit }) {
  const { can } = useAuth();
  const saved = useSaved();
  const x = useResource(`${JUR}/litiges/${id}`);
  const l = x.data;
  const [step, setStep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const write = can('juridique:write');
  const reopen = async () => {
    setBusy(true);
    try { x.setData(await api.post(`${JUR}/litiges/${id}/reopen`)); onChange(); saved('Litige rouvert'); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer title={l ? `${l.reference} · ${l.origin_label}` : 'Litige'} onClose={onClose}>
      {x.error ? <ErrorBox error={x.error} /> : !l ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <ErrorBox error={error} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={LIT_TONES[l.stage]}>{l.status === 'clos' ? 'Clos' : l.stage_label}</Badge>
            {l.outcome_label && <Badge>{l.outcome_label}</Badge>}
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px' }}>{l.title}</h3>
            <div className="kv"><span>Partie adverse</span><b>{l.opponent}</b></div>
            {l.amount_fcfa ? <div className="kv"><span>Montant en jeu</span><b>{fcfa(l.amount_fcfa)}</b></div> : null}
            <div className="kv"><span>Juriste en charge</span><b>{l.owner_name || '—'}</b></div>
            {l.department_label && <div className="kv"><span>Service concerné</span><b>{l.department_label}</b></div>}
            {l.lawyer && <div className="kv"><span>Avocat, huissier</span><b>{l.lawyer}</b></div>}
            {l.court && <div className="kv"><span>Juridiction</span><b>{l.court}</b></div>}
            {l.sale_label && <div className="kv"><span>Dossier de vente</span><b>{l.sale_label}</b></div>}
            {l.sav_label && <div className="kv"><span>Réclamation SAV</span><b>{l.sav_label}</b></div>}
            {l.supplier_name && <div className="kv"><span>Fournisseur</span><b>{l.supplier_name}</b></div>}
            {l.contract_label && <div className="kv"><span>Contrat</span><b>{l.contract_label}</b></div>}
            {l.employee_name && <div className="kv"><span>Employé</span><b>{l.employee_name}</b></div>}
            <div className="kv"><span>Ouvert le</span><b>{date(l.opened_on)}{l.closed_on ? ` · clos le ${date(l.closed_on)}` : ''}</b></div>
            {l.next_date && <div className="kv"><span>{l.next_label || 'Prochaine échéance'}</span><b className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{date(l.next_date)} <DaysLeft n={l.days_left} /></b></div>}
          </div>
          {l.notes && <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{l.notes}</p>}

          <div className="erp-panel">
            <div className="row-between"><b>Étapes</b>{write && l.status === 'ouvert' && !step && <button className="btn btn-ghost" onClick={() => setStep({ stage: l.stage === 'amiable' ? 'mise_en_demeure' : l.stage, date: today(), note: '', outcome: '', next_date: l.next_date || '', next_label: l.next_label || '' })}><Flag />Nouvelle étape</button>}</div>
            {step && <StepForm id={id} step={step} setStep={setStep} refs={refs} onSaved={data => { x.setData(data); setStep(null); onChange(); }} />}
            <ol className="deed-steps" style={{ marginTop: 10 }}>
              {l.events.map(e => (
                <li key={e.id} className="done">
                  <span className="deed-dot" aria-hidden="true"><Check size={12} /></span>
                  <div className="deed-body">
                    <div className="row-between" style={{ gap: 8 }}>
                      <span><b>{e.stage_label}</b><span className="small muted"> · {date(e.date)}{e.created_by_name ? ` · ${e.created_by_name}` : ''}</span></span>
                      {e.file_url && <a className="btn btn-ghost btn-icon" href={e.file_url} target="_blank" rel="noreferrer" aria-label={`Ouvrir la pièce de l’étape ${e.stage_label}`}><FileText /></a>}
                    </div>
                    {e.note && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{e.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {write && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {l.status === 'ouvert' && <button className="btn" onClick={() => onEdit(l)}><Pencil />Modifier</button>}
              {l.status !== 'ouvert' && <button className="btn btn-ghost" disabled={busy} onClick={reopen}><Undo2 />Rouvrir</button>}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function StepForm({ id, step, setStep, refs, onSaved }) {
  const saved = useSaved();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = k => e => setStep(s => ({ ...s, [k]: e.target.value }));
  const closing = step.stage === 'clos';
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const fields = { stage: step.stage, date: step.date, note: step.note.trim() };
      if (closing) fields.outcome = step.outcome;
      else Object.assign(fields, { next_date: step.next_date || 'null', next_label: step.next_label.trim() || 'null' });
      const data = await api.post(`${JUR}/litiges/${id}/etapes`, formData(fields, { file }));
      saved(closing ? 'Litige clos' : 'Étape enregistrée');
      onSaved(data);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <form className="form-grid" style={{ marginTop: 10 }} onSubmit={save}>
      <div className="full"><ErrorBox error={error} /></div>
      <Field label="Étape"><select className="select" value={step.stage} onChange={set('stage')}>{Object.entries(refs.stages).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Date"><input className="input" type="date" required value={step.date} onChange={set('date')} /></Field>
      {closing ? (
        <Field label="Issue du litige" className="full"><select className="select" required value={step.outcome} onChange={set('outcome')}><option value="">— Choisir —</option>{Object.entries(refs.outcomes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      ) : (
        <>
          <Field label="Prochaine échéance" hint="Alerte la veille et le jour (vide : aucune)"><input className="input" type="date" value={step.next_date} onChange={set('next_date')} /></Field>
          <Field label="Objet de l’échéance"><input className="input" maxLength={160} value={step.next_label} onChange={set('next_label')} placeholder="Audience, fin du délai de réponse…" /></Field>
        </>
      )}
      <Field label="Compte rendu" className="full"><textarea className="textarea" rows={2} value={step.note} onChange={set('note')} /></Field>
      <Field label="Pièce" className="full" hint="PDF ou photo, 20 Mo au plus">
        <label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : 'Joindre une pièce'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></label>
      </Field>
      <div className="full row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={busy}><Check />{closing ? 'Clore le litige' : 'Enregistrer l’étape'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setStep(null)}>Annuler</button>
      </div>
    </form>
  );
}

function LitigationForm({ litigation: l, preset, refs, onClose, onSaved }) {
  const saved = useSaved();
  const links = useResource(`${JUR}/liens`);
  const init = { ...(l || {}), ...(preset || {}) };
  const [f, setF] = useState({
    origin: init.origin || 'fournisseur', title: init.title || '', opponent: init.opponent || '', amount_fcfa: init.amount_fcfa ?? '',
    stage: l ? l.stage : 'amiable', department: init.department || '', owner_id: init.owner_id || '', lawyer: init.lawyer || '', court: init.court || '',
    sale_id: init.sale_id || '', sav_ticket_id: init.sav_ticket_id || '', supplier_id: init.supplier_id || '', contract_id: init.contract_id || '', employee_id: init.employee_id || '',
    next_date: init.next_date || '', next_label: init.next_label || '', opened_on: init.opened_on || today(), notes: init.notes || '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
      for (const k of ['amount_fcfa', 'owner_id', 'sale_id', 'sav_ticket_id', 'supplier_id', 'contract_id', 'employee_id']) body[k] = body[k] == null ? null : Number(body[k]);
      if (l) delete body.stage; // l'étape avance par « Nouvelle étape »
      const data = l ? await api.patch(`${JUR}/litiges/${l.id}`, body) : await api.post(`${JUR}/litiges`, body);
      saved(l ? 'Litige modifié' : `Litige ouvert sous la référence ${data.reference}`);
      onSaved(data);
    } catch (err) { setError(err); setBusy(false); }
  };
  const L = links.data;
  const opt = (list, k) => <select className="select" value={f[k]} onChange={set(k)}><option value="">— Aucun —</option>{(list || []).map(o => <option key={o.id} value={o.id}>{o.label || o.name}</option>)}</select>;
  return (
    <Modal title={l ? `Modifier ${l.reference}` : 'Nouveau litige'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="litigation-form" disabled={busy}><Check />Enregistrer</button></>}>
      <form id="litigation-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error || links.error} /></div>
        <Field label="Origine"><select className="select" value={f.origin} onChange={set('origin')}>{Object.entries(refs.origins).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Field>
        {!l ? <Field label="Étape de départ"><select className="select" value={f.stage} onChange={set('stage')}>{Object.entries(refs.stages).filter(([k]) => k !== 'clos').map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Field> : <div />}
        <Field label="Objet" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} placeholder="Malfaçons, recouvrement, rupture de contrat…" /></Field>
        <Field label="Partie adverse"><input className="input" required minLength={2} maxLength={200} value={f.opponent} onChange={set('opponent')} /></Field>
        <Field label="Montant en jeu (FCFA)"><input className="input" type="number" min="0" value={f.amount_fcfa} onChange={set('amount_fcfa')} /></Field>
        <Field label="Juriste en charge" hint="Reçoit les alertes d’échéance"><select className="select" value={f.owner_id} onChange={set('owner_id')}><option value="">—</option>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Service concerné" hint="Ses membres voient le dossier"><select className="select" value={f.department} onChange={set('department')}><option value="">—</option>{Object.entries(refs.departments).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Field>
        <Field label="Avocat, huissier"><input className="input" maxLength={160} value={f.lawyer} onChange={set('lawyer')} /></Field>
        <Field label="Juridiction"><input className="input" maxLength={160} value={f.court} onChange={set('court')} placeholder="Tribunal de commerce d’Abidjan…" /></Field>

        {f.origin === 'impaye' || f.sale_id ? <Field label="Dossier de vente" className="full">{opt(L?.sales, 'sale_id')}</Field> : null}
        {f.origin === 'sav' || f.sav_ticket_id ? <Field label="Réclamation SAV" className="full">{opt(L?.tickets, 'sav_ticket_id')}</Field> : null}
        {['fournisseur', 'sous_traitant'].includes(f.origin) || f.supplier_id ? <Field label="Fournisseur">{opt(refs.suppliers, 'supplier_id')}</Field> : null}
        {['fournisseur', 'sous_traitant'].includes(f.origin) || f.contract_id ? <Field label="Contrat">{opt(L?.contracts, 'contract_id')}</Field> : null}
        {f.origin === 'employe' || f.employee_id ? <Field label="Employé" className="full">{opt(L?.employees, 'employee_id')}</Field> : null}

        <Field label="Prochaine échéance" hint="Alerte la veille et le jour"><input className="input" type="date" value={f.next_date} onChange={set('next_date')} /></Field>
        <Field label="Objet de l’échéance"><input className="input" maxLength={160} value={f.next_label} onChange={set('next_label')} placeholder="Audience, fin du délai de réponse…" /></Field>
        {!l && <Field label="Ouvert le"><input className="input" type="date" value={f.opened_on} onChange={set('opened_on')} /></Field>}
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}
