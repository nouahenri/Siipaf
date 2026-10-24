import { useEffect, useState } from 'react';
import { Phone, Mail, MessageCircle, Star, CheckCircle2, Trash2, CalendarPlus, FileSignature, XCircle, RotateCcw, Send, Clock, Building2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Drawer, Modal, Field, Skeleton, ErrorBox, Badge, Empty, Advance } from '@admin/components/ui';
import { dateTime, fcfa, relative, toLocalInput } from '@admin/lib/format';
import { useCommercialMeta, ACTIVITY_STATE, STAGE_COLORS, compact } from '../../lib/commercial';

const HISTORY_ICONS = { etape: '◆', note: '✎', activite: '✓', rdv: '◷', option: '◇', vente: '€', paiement: '₣', message: '✉', espace_client: '✉', sav: '⚑' };
const waLink = phone => `https://wa.me/${String(phone || '').replace(/\D/g, '').replace(/^0/, '225')}`;

export default function LeadDrawer({ id, onClose, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const meta = useCommercialMeta();
  const lead = useResource(`/admin/erp/commercial/leads/${id}`);
  const [lost, setLost] = useState(false);
  const [selling, setSelling] = useState(false);
  const [appt, setAppt] = useState(false);
  const [error, setError] = useState(null);
  const write = can('leads:write');
  const refresh = () => { lead.reload(); onChange?.(); };

  const stage = async to => {
    if (to === 'perdu') { setLost(true); return; }
    setError(null);
    try { await api.post(`/admin/erp/commercial/leads/${id}/stage`, { stage: to }); toast('Étape mise à jour'); refresh(); } catch (e) { setError(e); }
  };

  const l = lead.data;
  return (
    <Drawer title={l ? l.name : 'Prospect'} onClose={onClose}>
      {!l ? <Skeleton h={420} /> : (
        <div className="stack" style={{ gap: 18 }}>
          <ErrorBox error={error || lead.error} />
          {/* Barre d'étapes cliquable (comme la barre de statut Odoo) */}
          <div className="stagebar" role="group" aria-label="Étape du circuit">
            {meta?.pipeline_stages.map(s => {
              const info = meta.stages.find(x => x.id === s);
              const on = l.stage === s;
              return (
                <button key={s} className={on ? 'on' : ''} style={on ? { background: STAGE_COLORS[s], borderColor: STAGE_COLORS[s] } : undefined}
                  disabled={!write || on} onClick={() => stage(s)} aria-pressed={on}>{info.label}</button>
              );
            })}
          </div>
          {l.stage === 'perdu' && (
            <div className="alert" role="status">Perdu{l.lost_reason ? ` — ${meta?.lost_reasons[l.lost_reason]}` : ''}{l.lost_note ? ` : ${l.lost_note}` : ''}</div>
          )}
          {['livraison', 'sav'].includes(l.stage) && <Badge tone="ok">Client livré — suivi dans « Client & SAV »</Badge>}

          <div className="row" style={{ gap: 8 }}>
            {l.phone && <a className="btn btn-sm" href={`tel:${l.phone}`}><Phone />Appeler</a>}
            {l.phone && <a className="btn btn-sm" href={waLink(l.phone)} target="_blank" rel="noreferrer"><MessageCircle />WhatsApp</a>}
            {l.email && <a className="btn btn-sm" href={`mailto:${l.email}`}><Mail />E-mail</a>}
            {can('appointments:write') && l.stage !== 'perdu' && <button className="btn btn-sm" onClick={() => setAppt(true)}><CalendarPlus />Rendez-vous</button>}
            {can('sales:write') && l.stage !== 'perdu' && <button className="btn btn-sm btn-primary" onClick={() => setSelling(true)}><FileSignature />Ouvrir une vente</button>}
            {write && (l.stage === 'perdu'
              ? <button className="btn btn-sm" onClick={() => stage('prospection')}><RotateCcw />Relancer</button>
              : <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setLost(true)}><XCircle />Marquer perdu</button>)}
          </div>

          <LeadInfo lead={l} meta={meta} write={write} onSaved={refresh} />

          {l.client_progress && (
            <section>
              <h3 className="erp-h3">Avancement du chantier{l.client_code ? <span className="muted small" style={{ fontWeight: 400 }}> · {l.client_code}</span> : null}</h3>
              <div className="erp-panel row-between">
                <Advance value={l.client_progress.progress_pct} />
                <span className="small muted">{l.client_progress.stage_label || (l.sales.length ? 'Aucun point publié' : 'Sans dossier : lot à rattacher')}</span>
              </div>
            </section>
          )}

          {l.sales.length > 0 && (
            <section>
              <h3 className="erp-h3">Dossiers de vente</h3>
              <div className="stack" style={{ gap: 8 }}>
                {l.sales.map(s => (
                  <div key={s.id} className="erp-panel row-between">
                    <span><b>{s.project_name} · lot {s.lot_code}</b>{s.vefa && <Badge tone="brand"> VEFA</Badge>}<div className="small muted">{fcfa(s.price_fcfa)} · payé {s.percent_paid} % · chantier {s.progress_pct} %</div></span>
                    <Badge tone={s.status === 'solde' ? 'ok' : s.status === 'desiste' ? 'danger' : 'warn'}>{s.status === 'solde' ? 'Soldé' : s.status === 'desiste' ? 'Désisté' : 'En cours'}</Badge>
                  </div>
                ))}
              </div>
            </section>
          )}

          <Activities lead={l} meta={meta} write={write} onChange={refresh} />
          <History lead={l} write={write} onChange={refresh} />
        </div>
      )}
      {lost && l && <LostModal lead={l} onClose={() => setLost(false)} onDone={() => { setLost(false); refresh(); }} />}
      {appt && l && <ApptModal lead={l} onClose={() => setAppt(false)} onDone={() => { setAppt(false); refresh(); toast('Rendez-vous planifié'); }} />}
      {selling && l && <NewSale lead={l} onClose={() => setSelling(false)} onDone={() => { setSelling(false); refresh(); toast('Dossier de vente ouvert'); }} />}
    </Drawer>
  );
}

function LeadInfo({ lead, meta, write, onSaved }) {
  const toast = useToast();
  const saved = useSaved();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => setForm({
    name: lead.name, phone: lead.phone || '', email: lead.email || '', country: lead.country || '', kind: lead.kind || '',
    priority: lead.priority || 0, expected_revenue_fcfa: lead.expected_revenue_fcfa ?? '', financing: lead.financing || '',
    project_id: lead.project_id || '', assigned_to: lead.assigned_to || '', is_diaspora: lead.is_diaspora,
  }), [lead]);
  if (!form) return null;
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault(); setError(null);
    try {
      await api.patch(`/admin/erp/commercial/leads/${lead.id}`, {
        name: form.name, phone: form.phone || null, email: form.email || null, country: form.country || null, kind: form.kind || null,
        priority: Number(form.priority), expected_revenue_fcfa: form.expected_revenue_fcfa === '' ? null : Number(form.expected_revenue_fcfa),
        financing: form.financing || null, project_id: Number(form.project_id) || null, assigned_to: Number(form.assigned_to) || null, is_diaspora: form.is_diaspora,
      });
      saved('Fiche enregistrée'); onSaved();
    } catch (err) { setError(err); }
  };
  return (
    <form className="erp-panel stack" style={{ gap: 12 }} onSubmit={save}>
      <ErrorBox error={error} />
      <div className="row-between">
        <span className="small muted">{lead.client_code ? `Client ${lead.client_code} · ` : ''}Créé {relative(lead.created_at)} · probabilité {lead.probability} %</span>
        <span className="stars-input-sm" role="radiogroup" aria-label="Priorité">
          {[1, 2, 3].map(n => (
            <button key={n} type="button" disabled={!write} role="radio" aria-checked={Number(form.priority) === n} aria-label={`Priorité ${n}`}
              className={n <= form.priority ? 'on' : ''} onClick={() => setForm(f => ({ ...f, priority: Number(f.priority) === n ? 0 : n }))}><Star aria-hidden="true" /></button>
          ))}
        </span>
      </div>
      <fieldset disabled={!write} className="form-grid">
        <Field label="Nom"><input className="input" required value={form.name} onChange={set('name')} /></Field>
        <Field label="Type">
          <select className="select" value={form.kind} onChange={set('kind')}>
            <option value="">—</option>
            {meta && Object.entries(meta.lead_kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Téléphone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Programme">
          <select className="select" value={form.project_id} onChange={set('project_id')}>
            <option value="">—</option>
            {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Montant attendu (FCFA)" hint={lead.lot ? `Lot ${lead.lot.code} : ${fcfa(lead.lot.price_fcfa)}` : 'Budget ou prix visé'}>
          <input className="input" type="number" min="0" step="100000" value={form.expected_revenue_fcfa} onChange={set('expected_revenue_fcfa')} />
        </Field>
        <Field label="Financement envisagé">
          <select className="select" value={form.financing} onChange={set('financing')}>
            <option value="">—</option>
            {meta && Object.entries(meta.financings).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Commercial">
          <select className="select" value={form.assigned_to} onChange={set('assigned_to')}>
            <option value="">— Non attribué —</option>
            {meta?.sellers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Pays de résidence"><input className="input" value={form.country} onChange={set('country')} /></Field>
        <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={form.is_diaspora} onChange={set('is_diaspora')} />Diaspora</label>
      </fieldset>
      {write && <div><button className="btn btn-sm btn-primary">Enregistrer la fiche</button></div>}
    </form>
  );
}

/** Formulaire d'activité (création ou « planifier la suivante »). */
function ActivityForm({ meta, initial, onSubmit, onCancel, submitLabel }) {
  const [f, setF] = useState(initial || { kind: 'appel', summary: '', due_at: toLocalInput(new Date(Date.now() + 864e5)), note: '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="form-grid">
        <Field label="Activité">
          <select className="select" value={f.kind} onChange={set('kind')}>
            {meta && Object.entries(meta.activity_kinds).filter(([k]) => k !== 'note').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Échéance"><input className="input" type="datetime-local" required value={f.due_at} onChange={set('due_at')} /></Field>
        <Field label="Objet" className="full"><input className="input" maxLength={200} value={f.summary} onChange={set('summary')} placeholder="Ex. Envoyer la grille de prix, confirmer la visite…" /></Field>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onSubmit({ kind: f.kind, summary: f.summary || null, due_at: new Date(f.due_at).toISOString(), note: f.note || null })}>{submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Annuler</button>}
      </div>
    </div>
  );
}

function Activities({ lead, meta, write, onChange }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(null);
  const [outcome, setOutcome] = useState('');
  const [chain, setChain] = useState(false);

  const add = async body => {
    try { await api.post(`/admin/erp/commercial/leads/${lead.id}/activities`, body); setAdding(false); toast('Activité planifiée'); onChange(); } catch (e) { toast(e.message, 'err'); }
  };
  const done = async (a, next) => {
    try {
      await api.post(`/admin/erp/commercial/activities/${a.id}/done`, { outcome: outcome || null, ...(next ? { next } : {}) });
      setClosing(null); setOutcome(''); setChain(false); toast(next ? 'Fait — activité suivante planifiée' : 'Activité réalisée'); onChange();
    } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async a => { try { await api.del(`/admin/erp/commercial/activities/${a.id}`); onChange(); } catch (e) { toast(e.message, 'err'); } };

  return (
    <section>
      <div className="row-between">
        <h3 className="erp-h3">Activités planifiées</h3>
        {write && !adding && lead.stage !== 'perdu' && <button className="btn btn-sm" onClick={() => setAdding(true)}><CalendarPlus />Planifier</button>}
      </div>
      {adding && <div className="erp-panel" style={{ marginBottom: 10 }}><ActivityForm meta={meta} onSubmit={add} onCancel={() => setAdding(false)} submitLabel="Planifier" /></div>}
      {!lead.activities.length && !adding && <p className="small muted">Aucune activité prévue. Planifiez la prochaine action pour ne pas perdre le contact.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {lead.activities.map(a => {
          const st = ACTIVITY_STATE[a.state];
          return (
            <div key={a.id} className="erp-panel">
              <div className="row-between">
                <span className="row" style={{ gap: 8 }}>
                  <Clock className="ico" aria-hidden="true" style={{ color: st?.color }} />
                  <b>{a.label}</b><span className="small">{a.summary !== a.label ? a.summary : ''}</span>
                </span>
                <span className="small" style={{ color: st?.color }}>{dateTime(a.due_at)}</span>
              </div>
              {a.assigned_name && <div className="small muted">{a.assigned_name}</div>}
              {write && closing !== a.id && (
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={() => { setClosing(a.id); setChain(false); }}><CheckCircle2 />Fait</button>
                  <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => remove(a)} aria-label="Supprimer l’activité"><Trash2 /></button>
                </div>
              )}
              {closing === a.id && (
                <div className="stack" style={{ gap: 10, marginTop: 10 }}>
                  <Field label="Compte rendu"><textarea className="textarea" rows={2} value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="Ce qui a été dit, décidé…" /></Field>
                  {!chain ? (
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => done(a)}>Valider</button>
                      <button className="btn btn-sm" onClick={() => setChain(true)}>Fait & planifier la suivante</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setClosing(null)}>Annuler</button>
                    </div>
                  ) : <ActivityForm meta={meta} onSubmit={next => done(a, next)} onCancel={() => setChain(false)} submitLabel="Valider et planifier" />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function History({ lead, write, onChange }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const send = async e => {
    e.preventDefault();
    if (!note.trim()) return;
    try { await api.post(`/admin/erp/commercial/leads/${lead.id}/activities`, { kind: 'note', note }); setNote(''); onChange(); } catch (err) { toast(err.message, 'err'); }
  };
  return (
    <section>
      <h3 className="erp-h3">Historique des échanges</h3>
      {write && (
        <form className="reply" onSubmit={send} style={{ marginBottom: 12 }}>
          <textarea className="textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Consigner un échange, une information…" aria-label="Note" />
          <div><button className="btn btn-sm btn-primary" disabled={!note.trim()}><Send />Ajouter au fil</button></div>
        </form>
      )}
      {!lead.history.length ? <Empty>Pas encore d’échange enregistré.</Empty> : (
        <ol className="timeline">
          {lead.history.map((h, i) => (
            <li key={i} className={`tl-${h.type}`}>
              <span className="tl-dot" aria-hidden="true">{HISTORY_ICONS[h.type] || '•'}</span>
              <div>
                <div className="row-between" style={{ gap: 8 }}><b className="small">{h.title}</b><span className="small muted nowrap">{dateTime(h.at)}</span></div>
                {h.body && <p className="small prewrap" style={{ color: 'var(--ink-2)' }}>{h.body}</p>}
                {h.user && <span className="small muted">{h.user}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function LostModal({ lead, onClose, onDone }) {
  const meta = useCommercialMeta();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    setError(null);
    try { await api.post(`/admin/erp/commercial/leads/${lead.id}/stage`, { stage: 'perdu', lost_reason: reason, lost_note: note || null }); onDone(); } catch (e) { setError(e); }
  };
  return (
    <Modal title={`Marquer « ${lead.name} » comme perdu`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!reason} onClick={submit}>Confirmer</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <ErrorBox error={error} />
        <Field label="Motif de la perte">
          <select className="select" value={reason} onChange={e => setReason(e.target.value)} autoFocus>
            <option value="">— Choisir —</option>
            {meta && Object.entries(meta.lost_reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Précision (facultatif)"><input className="input" maxLength={255} value={note} onChange={e => setNote(e.target.value)} /></Field>
        <p className="small muted">Les activités prévues sont annulées. Le prospect pourra être relancé plus tard.</p>
      </div>
    </Modal>
  );
}

/** Ouvre un dossier de vente sur un lot disponible du programme (échéancier classique ou appels de fonds VEFA). */
export function NewSale({ lead, onClose, onDone, lot: fixedLot }) {
  const meta = useCommercialMeta();
  const [projectId, setProjectId] = useState(fixedLot?.project_id || lead?.project_id || '');
  const property = useResource(projectId && !fixedLot ? `/admin/erp/commercial/property?project_id=${projectId}` : null);
  const [lotId, setLotId] = useState(fixedLot?.id || lead?.lot?.id || '');
  const [form, setForm] = useState({ price_fcfa: '', mode: 'echeancier', financing: lead?.financing || 'apport', reserved_at: new Date().toISOString().slice(0, 10), signed_at: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const free = (property.data?.lots || []).filter(l => ['disponible', 'desistement', 'option'].includes(l.status));
  const lot = fixedLot || free.find(l => l.id === Number(lotId));
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post(`/admin/lots/${lot.id}/sale`, {
        lead_id: lead.id, price_fcfa: form.price_fcfa ? Number(form.price_fcfa) : undefined,
        ...(form.mode === 'vefa' ? { vefa: true, signed_at: form.signed_at || undefined } : { financing: form.financing }),
        reserved_at: form.reserved_at,
      });
      onDone();
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={`Ouvrir une vente — ${lead.name}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="new-sale" disabled={busy || !lot}>Ouvrir le dossier</button></>}>
      <form id="new-sale" className="stack" style={{ gap: 12 }} onSubmit={submit}>
        <ErrorBox error={error} />
        {!fixedLot && (
          <div className="form-grid">
            <Field label="Programme">
              <select className="select" value={projectId} onChange={e => { setProjectId(e.target.value); setLotId(''); }} required>
                <option value="">— Choisir —</option>
                {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Lot disponible" hint={projectId && property.data ? `${free.length} lot(s) disponible(s)` : undefined}>
              <select className="select" value={lotId} onChange={e => setLotId(e.target.value)} required>
                <option value="">— Choisir —</option>
                {free.map(l => <option key={l.id} value={l.id}>{l.ilot ? `Îlot ${l.ilot} · ` : ''}Lot {l.code}{l.property_type ? ` · ${l.property_type}` : ''}{l.price_fcfa ? ` · ${compact(l.price_fcfa)}` : ''}{l.status === 'option' ? ' (option)' : ''}</option>)}
              </select>
            </Field>
          </div>
        )}
        {lot && <p className="small muted"><Building2 className="ico" aria-hidden="true" />Lot {lot.code}{lot.surface_m2 ? ` · ${lot.surface_m2} m²` : ''} · prix catalogue {lot.price_fcfa ? fcfa(lot.price_fcfa) : 'non renseigné'}</p>}
        <div className="form-grid">
          <Field label="Prix convenu (FCFA)" hint="Laisser vide pour le prix catalogue"><input className="input" type="number" min="0" step="1000" value={form.price_fcfa} onChange={set('price_fcfa')} /></Field>
          <Field label="Date de réservation"><input className="input" type="date" value={form.reserved_at} onChange={set('reserved_at')} /></Field>
        </div>
        <div className="seg" role="radiogroup" aria-label="Mode de paiement">
          <button type="button" className={form.mode === 'echeancier' ? 'active' : ''} onClick={() => setForm(f => ({ ...f, mode: 'echeancier' }))}>Échéancier</button>
          <button type="button" className={form.mode === 'vefa' ? 'active' : ''} onClick={() => setForm(f => ({ ...f, mode: 'vefa' }))}>VEFA (appels de fonds)</button>
        </div>
        {form.mode === 'echeancier' ? (
          <Field label="Financement">
            <select className="select" value={form.financing} onChange={set('financing')}>
              {meta && Object.entries(meta.financings).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Date de signature de l’acte notarié" hint="Premier appel de fonds à cette date (art. 121 : aucun versement avant la signature, hors dépôt de garantie)">
              <input className="input" type="date" value={form.signed_at} onChange={set('signed_at')} />
            </Field>
            <p className="small muted">Les appels suivants partiront automatiquement à chaque étape achevée du chantier, selon le plan du programme (Appels de fonds VEFA).</p>
          </>
        )}
      </form>
    </Modal>
  );
}

const APPT_KINDS = { visite: 'Visite sur site', appel: 'Appel', bureau: 'Rendez-vous au bureau', visio: 'Visio' };

/** Planifie un rendez-vous (visite du site, appel, bureau, visio) ; une visite effectuée fait passer le prospect à « Visite ». */
function ApptModal({ lead, onClose, onDone }) {
  const meta = useCommercialMeta();
  const [f, setF] = useState({ kind: 'visite', starts_at: toLocalInput(new Date(Date.now() + 2 * 864e5)), duration_min: 60, assigned_to: lead.assigned_to || '', notes: '' });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setError(null);
    try {
      await api.post('/admin/appointments', {
        lead_id: lead.id, kind: f.kind, status: 'confirme', starts_at: new Date(f.starts_at).toISOString(), duration_min: Number(f.duration_min) || 60,
        assigned_to: Number(f.assigned_to) || null, project_id: lead.project_id || null, lot_id: lead.lot_id || null, notes: f.notes || null,
      });
      onDone();
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={`Rendez-vous avec ${lead.name}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="appt">Planifier</button></>}>
      <form id="appt" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Type">
          <select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(APPT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Date et heure"><input className="input" type="datetime-local" required value={f.starts_at} onChange={set('starts_at')} /></Field>
        <Field label="Durée (minutes)"><input className="input" type="number" min="5" max="480" value={f.duration_min} onChange={set('duration_min')} /></Field>
        <Field label="Commercial">
          <select className="select" value={f.assigned_to} onChange={set('assigned_to')}>
            <option value="">—</option>
            {meta?.sellers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Notes" className="full"><input className="input" value={f.notes} onChange={set('notes')} placeholder="Lieu de rendez-vous, documents à apporter…" /></Field>
      </form>
    </Modal>
  );
}
