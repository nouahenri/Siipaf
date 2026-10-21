import { useState } from 'react';
import { Phone, Mail, Lock, Send, CalendarPlus, CheckCircle2, XCircle, Star, User, Wrench } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Drawer, Field, Skeleton, ErrorBox, Badge } from '@admin/components/ui';
import { date, dateTime, fcfa, relative } from '@admin/lib/format';
import { useSavMeta, SavStatus, Priority, Overdue } from '../../components/SavBits';
import { PhotoPicker, Thumbs } from '../../components/Photos';
import { SOURCE_LABELS, WARRANTY_SHORT, INTERVENTION_LABELS } from '../../lib/sav';

// Libellé des boutons de passage de statut
const ACTION_LABELS = {
  qualifie: 'Qualifier', planifie: 'Marquer planifiée', en_cours: 'Démarrer le traitement', resolu: 'Marquer résolue',
  clos: 'Clore', rejete: 'Rejeter', nouveau: 'Remettre en nouveau',
};

export default function TicketDrawer({ id, onClose, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const meta = useSavMeta();
  const t = useResource(`/admin/erp/sav/tickets/${id}`);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const write = can('sav:handle');

  const run = async (fn, okMessage) => {
    setBusy(true); setError(null);
    try {
      const out = await fn();
      if (out && out.id === id && out.events) t.setData(out); else await t.reload();
      if (okMessage) toast(okMessage);
      onChange?.();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const status = to => run(() => api.post(`/admin/erp/sav/tickets/${id}/status`, { status: to }), 'Statut mis à jour');
  const patch = body => run(() => api.patch(`/admin/erp/sav/tickets/${id}`, body), 'Réclamation mise à jour');

  const d = t.data;
  return (
    <Drawer title={d ? `${d.ref} · ${d.title}` : 'Réclamation'} onClose={onClose}>
      {!d ? <Skeleton h={400} /> : (
        <div className="stack" style={{ gap: 18 }}>
          <ErrorBox error={error || t.error} />
          <div className="row" style={{ gap: 8 }}>
            <SavStatus status={d.status} meta={meta} />
            <Priority priority={d.priority} meta={meta} />
            {d.overdue && <Overdue />}
            <Badge>{meta?.categories[d.category] || d.category}</Badge>
            {d.warranty && <Badge tone={d.warranty === 'hors_garantie' ? '' : 'ok'}>{WARRANTY_SHORT[d.warranty]}</Badge>}
          </div>

          {write && (meta?.transitions[d.status] || []).length > 0 && (
            <div className="row" style={{ gap: 8 }}>
              {meta.transitions[d.status].map(to => (
                <button key={to} className={`btn btn-sm ${to === 'resolu' ? 'btn-primary' : ''} ${to === 'rejete' ? 'btn-danger' : ''}`} disabled={busy} onClick={() => status(to)}>
                  {ACTION_LABELS[to] || meta.status_labels[to]}
                </button>
              ))}
            </div>
          )}

          <section className="erp-panel">
            <dl className="dl">
              <dt>Client</dt>
              <dd>
                <b>{d.client_name || '—'}</b> {d.client_code && <span className="muted small">({d.client_code})</span>}
                <div className="row small" style={{ gap: 12, marginTop: 2 }}>
                  {d.client_phone && <a href={`tel:${d.client_phone}`} className="link"><Phone aria-hidden="true" className="ico" />{d.client_phone}</a>}
                  {d.client_email && <a href={`mailto:${d.client_email}`} className="link"><Mail aria-hidden="true" className="ico" />{d.client_email}</a>}
                </div>
              </dd>
              <dt>Bien</dt><dd>{d.project_name || '—'}{d.lot_code ? ` · lot ${d.lot_code}` : ''}{d.location ? ` · ${d.location}` : ''}</dd>
              <dt>Livraison</dt><dd>{d.delivered_at ? date(d.delivered_at) : <span className="muted">non saisie</span>}</dd>
              <dt>Origine</dt><dd>{SOURCE_LABELS[d.source]} · {dateTime(d.created_at)}</dd>
              <dt>Échéance</dt><dd>{dateTime(d.due_at)} {meta?.open_statuses.includes(d.status) && <span className="muted small">({relative(d.due_at)})</span>}</dd>
              {d.resolved_at && <><dt>Résolue</dt><dd>{dateTime(d.resolved_at)}</dd></>}
              {d.satisfaction && <><dt>Avis client</dt><dd><span className="stars" aria-label={`${d.satisfaction} sur 5`}>{[1, 2, 3, 4, 5].map(n => <Star key={n} className={n <= d.satisfaction ? 'on' : ''} aria-hidden="true" />)}</span> {d.satisfaction_comment}</dd></>}
            </dl>
          </section>

          {write && (
            <div className="form-grid">
              <Field label="Responsable">
                <select className="select" value={d.assigned_to || ''} disabled={busy} onChange={e => patch({ assigned_to: Number(e.target.value) || null })}>
                  <option value="">— Personne —</option>
                  {meta?.technicians.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Priorité" hint={meta ? `Délai de traitement : ${meta.priorities[d.priority].hours} h` : undefined}>
                <select className="select" value={d.priority} disabled={busy} onChange={e => patch({ priority: e.target.value })}>
                  {meta && Object.entries(meta.priorities).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Type de problème">
                <select className="select" value={d.category} disabled={busy} onChange={e => patch({ category: e.target.value })}>
                  {meta && Object.entries(meta.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="Garantie applicable">
                <select className="select" value={d.warranty || ''} disabled={busy} onChange={e => patch({ warranty: e.target.value || null })}>
                  <option value="">— À déterminer —</option>
                  {Object.entries(WARRANTY_SHORT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            </div>
          )}

          {(d.description || d.media.length > 0) && (
            <section>
              <h3 className="erp-h3">Description</h3>
              {d.description && <p className="prewrap">{d.description}</p>}
              <Thumbs files={d.media} />
            </section>
          )}

          <Interventions ticket={d} write={can('sav:interventions')} onDone={() => run(() => Promise.resolve(), null)} />

          <section>
            <h3 className="erp-h3">Échanges</h3>
            <ol className="thread">
              {d.events.map(e => (
                <li key={e.id} className={`ev ev-${e.author} ${e.internal ? 'ev-internal' : ''} ${e.kind !== 'comment' ? 'ev-system' : ''}`}>
                  <div className="ev-head">
                    {e.internal && <Lock aria-label="Note interne" className="ico" />}
                    <b>{e.author === 'client' ? d.client_name || 'Client' : e.user_name || (e.author === 'systeme' ? 'Système' : 'Équipe')}</b>
                    <span className="muted small">{dateTime(e.created_at)}</span>
                  </div>
                  {e.body && <p className="prewrap">{e.body}</p>}
                  <Thumbs files={e.media} size={64} />
                </li>
              ))}
            </ol>
            {write && <Reply ticket={d} onSent={out => { t.setData(out); onChange?.(); }} />}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function Reply({ ticket, onSent }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const send = async e => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const out = await api.post(`/admin/erp/sav/tickets/${ticket.id}/comments`, { body, internal, media_ids: photos.map(p => p.id) });
      setBody(''); setPhotos([]);
      onSent(out);
      toast(internal ? 'Note interne ajoutée' : 'Réponse envoyée au client');
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <form className={`reply ${internal ? 'internal' : ''}`} onSubmit={send}>
      <textarea className="textarea" rows={3} value={body} onChange={e => setBody(e.target.value)}
        placeholder={internal ? 'Note visible par l’équipe uniquement…' : 'Réponse visible par le client dans son espace…'} aria-label="Message" />
      <PhotoPicker value={photos} onChange={setPhotos} leadId={internal ? null : ticket.lead_id} />
      <div className="row-between">
        <label className="checkbox small"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} /><Lock className="ico" aria-hidden="true" />Note interne</label>
        <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}><Send />{internal ? 'Ajouter la note' : 'Envoyer au client'}</button>
      </div>
    </form>
  );
}

function Interventions({ ticket, write, onDone }) {
  const toast = useToast();
  const meta = useSavMeta();
  const [planning, setPlanning] = useState(false);
  const [closing, setClosing] = useState(null);
  const [form, setForm] = useState({ scheduled_at: '', duration_min: 60, technician_id: '', contractor: '' });
  const [report, setReport] = useState({ report: '', cost_fcfa: '', media_after: [] });
  const [busy, setBusy] = useState(false);

  const plan = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/admin/erp/sav/interventions', {
        ticket_id: ticket.id, scheduled_at: new Date(form.scheduled_at).toISOString(), duration_min: Number(form.duration_min) || 60,
        technician_id: Number(form.technician_id) || null, contractor: form.contractor || null,
      });
      setPlanning(false); setForm({ scheduled_at: '', duration_min: 60, technician_id: '', contractor: '' });
      toast('Intervention planifiée');
      onDone();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  const finish = async (iv, status) => {
    setBusy(true);
    try {
      await api.patch(`/admin/erp/sav/interventions/${iv.id}`, status === 'realisee'
        ? { status, report: report.report || null, cost_fcfa: report.cost_fcfa === '' ? null : Number(report.cost_fcfa), media_after: report.media_after.map(m => m.id) }
        : { status });
      setClosing(null); setReport({ report: '', cost_fcfa: '', media_after: [] });
      toast(status === 'realisee' ? 'Intervention réalisée' : 'Intervention annulée');
      onDone();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  const open = meta?.open_statuses.includes(ticket.status);
  if (!ticket.interventions.length && !(write && open)) return null;
  return (
    <section>
      <div className="row-between">
        <h3 className="erp-h3">Interventions</h3>
        {write && open && !planning && <button className="btn btn-sm" onClick={() => setPlanning(true)}><CalendarPlus />Planifier</button>}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {ticket.interventions.map(iv => (
          <div key={iv.id} className="erp-panel">
            <div className="row-between">
              <span className="row" style={{ gap: 8 }}>
                <Wrench className="ico" aria-hidden="true" />
                <b>{dateTime(iv.scheduled_at)}</b>
                <span className="muted small">{iv.duration_min} min</span>
              </span>
              <Badge tone={iv.status === 'realisee' ? 'ok' : iv.status === 'annulee' ? '' : 'warn'}>{INTERVENTION_LABELS[iv.status]}</Badge>
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              <User className="ico" aria-hidden="true" />{iv.technician_name || iv.contractor || 'Intervenant à désigner'}
              {iv.technician_name && iv.contractor ? ` · ${iv.contractor}` : ''}
              {iv.cost_fcfa != null && ` · ${fcfa(iv.cost_fcfa)}`}
            </div>
            {iv.report && <p className="prewrap small" style={{ marginTop: 6 }}>{iv.report}</p>}
            <Thumbs files={[...iv.media_before, ...iv.media_after]} size={56} />
            {write && iv.status === 'planifiee' && closing !== iv.id && (
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={() => setClosing(iv.id)}><CheckCircle2 />Compte rendu</button>
                <button className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => finish(iv, 'annulee')}><XCircle />Annuler</button>
              </div>
            )}
            {closing === iv.id && (
              <div className="stack" style={{ gap: 10, marginTop: 10 }}>
                <Field label="Travaux réalisés"><textarea className="textarea" rows={3} value={report.report} onChange={e => setReport(r => ({ ...r, report: e.target.value }))} /></Field>
                <Field label="Coût (FCFA)" hint="Facultatif : pièces, main-d’œuvre, sous-traitant"><input className="input" type="number" min="0" value={report.cost_fcfa} onChange={e => setReport(r => ({ ...r, cost_fcfa: e.target.value }))} /></Field>
                <Field label="Photos après travaux"><PhotoPicker value={report.media_after} onChange={m => setReport(r => ({ ...r, media_after: m }))} leadId={ticket.lead_id} /></Field>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => finish(iv, 'realisee')}>Valider l’intervention</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setClosing(null)}>Fermer</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {planning && (
          <form className="erp-panel stack" style={{ gap: 12 }} onSubmit={plan}>
            <div className="form-grid">
              <Field label="Date et heure"><input className="input" type="datetime-local" required value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} /></Field>
              <Field label="Durée (minutes)"><input className="input" type="number" min="15" step="15" value={form.duration_min} onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))} /></Field>
              <Field label="Technicien SIIPAF">
                <select className="select" value={form.technician_id} onChange={e => setForm(f => ({ ...f, technician_id: e.target.value }))}>
                  <option value="">—</option>
                  {meta?.technicians.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Artisan / sous-traitant"><input className="input" value={form.contractor} onChange={e => setForm(f => ({ ...f, contractor: e.target.value }))} placeholder="Ex. Plomberie Express" /></Field>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm btn-primary" disabled={busy}>Planifier</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPlanning(false)}>Annuler</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
