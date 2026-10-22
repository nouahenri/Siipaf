import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Mail, Send, Lock, Paperclip, FileText, Check, Undo2, Ban, Pencil, Reply, Search, CircleAlert } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Drawer, Modal, Badge } from '@admin/components/ui';
import { date, dateTime } from '@admin/lib/format';
import { today, formData } from '../../lib/rh';

const URL = '/admin/erp/courrier';
// Le rouge reste réservé au retard et à l'urgence
const TONES = { enregistre: 'warn', affecte: '', traite: 'ok', envoye: 'ok', annule: '' };
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Courrier arrivée / départ (choix du client du 22/10) : le secrétariat enregistre avec le scan (n° d'ordre par sens
 * et par an), la direction affecte (destinataire, suite à donner selon la nature, délai), le destinataire donne la
 * suite ou répond par un courrier départ lié. Confidentiel : n° d'ordre seul pour les autres comptes du registre.
 */
export default function Courrier() {
  const { can } = useAuth();
  const registry = ['courrier:read', 'courrier:write', 'courrier:assign'].some(can);
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState(registry ? (can('courrier:assign') ? 'todo' : 'arrivee') : 'mine');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // { direction, mail?, replyTo? }
  const refs = useResource(`${URL}/refs`);
  const badges = useResource(`${URL}/badges`);
  const filter = scope === 'todo' ? { status: 'enregistre', direction: 'arrivee' } : scope === 'mine' ? { mine: '1', status: status || 'affecte' }
    : scope === 'late' ? { late: '1' } : { direction: scope, status };
  const list = useResource(`${URL}${qs({ ...filter, q })}`);
  const open = Number(params.get('fiche')) || null;
  const setOpen = id => setParams(id ? { fiche: String(id) } : {}, { replace: true });
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const reload = () => { list.reload(); badges.reload(); };
  const b = badges.data || {};
  const rows = list.data || [];

  const tabs = [
    can('courrier:assign') && ['todo', 'À affecter', b.to_assign],
    ['mine', 'À traiter par moi', b.mine],
    registry && ['arrivee', 'Arrivée'],
    registry && ['depart', 'Départ'],
    (registry || b.late > 0) && ['late', 'En retard', b.late],
  ].filter(Boolean);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="Affichage">
            {tabs.map(([k, label, n]) => (
              <button key={k} className={scope === k ? 'active' : ''} onClick={() => { setScope(k); setStatus(''); }}>
                {label}{n > 0 && <span className="seg-count"> {n}</span>}
              </button>
            ))}
          </div>
          {['arrivee', 'depart', 'mine'].includes(scope) && refs.data && (
            <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut">
              <option value="">{scope === 'mine' ? 'En cours' : 'Tous les statuts'}</option>
              {Object.entries(refs.data.statuses).filter(([k]) => scope === 'depart' ? ['envoye', 'annule'].includes(k) : k !== 'envoye').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          <label className="input-icon" style={{ position: 'relative' }}>
            <Search aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, opacity: 0.5 }} />
            <input className="input" style={{ paddingLeft: 32, width: 220 }} type="search" placeholder="N°, objet, correspondant…" value={text} onChange={e => setText(e.target.value)} aria-label="Rechercher" />
          </label>
        </div>
        {can('courrier:write') && (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={() => setForm({ direction: 'arrivee' })}><Plus />Courrier arrivé</button>
            <button className="btn" onClick={() => setForm({ direction: 'depart' })}><Send />Courrier départ</button>
          </div>
        )}
      </div>
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !rows.length ? (
          <div className="card-body"><Empty icon={Mail}>{scope === 'todo' ? 'Aucun courrier à affecter.' : scope === 'mine' ? 'Aucun courrier à traiter pour vous.' : scope === 'late' ? 'Aucun courrier en retard.' : 'Aucun courrier.'}</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N° d’ordre</th><th>Date</th><th>{scope === 'depart' ? 'Destinataire' : 'Correspondant'}</th><th>Objet</th><th>Affecté à</th><th>Délai</th><th>Statut</th></tr></thead>
            <tbody>{rows.map(m => m.masked ? (
              <tr key={m.id}>
                <td className="small tabular nowrap">{m.number}</td><td className="small nowrap">{date(m.date)}</td>
                <td colSpan={3} className="muted small"><Lock aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: -2 }} /> Courrier confidentiel — visible du destinataire et de la direction</td>
                <td /><td><Badge tone={TONES[m.status]}>{m.status_label}</Badge></td>
              </tr>
            ) : (
              <tr key={m.id} className="clickable" onClick={() => setOpen(m.id)}>
                <td className="small tabular nowrap"><b>{m.number}</b></td>
                <td className="small nowrap">{date(m.date)}</td>
                <td>{m.correspondent}{m.letter_ref && <div className="small muted">Réf. {m.letter_ref}</div>}</td>
                <td>
                  {m.subject}
                  <div className="row" style={{ gap: 6, marginTop: 2 }}>
                    <span className="small muted">{m.direction === 'depart' ? 'Départ' : m.nature_label}</span>
                    {m.confidential && <Badge>Confidentiel</Badge>}{m.urgent && <Badge tone="danger">Urgent</Badge>}
                    {m.reply_to_number && <span className="small muted">en réponse à {m.reply_to_number}</span>}
                  </div>
                </td>
                <td className="small">{m.assigned_to_name || m.assigned_department_label || '—'}{m.suite_label && <div className="muted">{m.suite_label}</div>}</td>
                <td className={`small nowrap ${m.late ? 'text-danger' : ''}`}>{m.due_date ? date(m.due_date) : '—'}{m.late && <div><CircleAlert aria-hidden="true" style={{ width: 13, height: 13, verticalAlign: -2 }} /> en retard</div>}</td>
                <td><Badge tone={TONES[m.status]}>{m.status_label}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {open && refs.data && <MailDrawer id={open} refs={refs.data} onClose={() => setOpen(null)} onChange={reload} onEdit={mail => setForm({ direction: mail.direction, mail })} onReply={replyTo => setForm({ direction: 'depart', replyTo })} />}
      {form && refs.data && <MailForm {...form} refs={refs.data} onClose={() => setForm(null)} onSaved={m => { setForm(null); reload(); setOpen(m.id); }} />}
    </div>
  );
}

function MailDrawer({ id, refs, onClose, onChange, onEdit, onReply }) {
  const { can } = useAuth();
  const toast = useToast();
  const x = useResource(`${URL}/${id}`);
  const d = x.data;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const act = async (action, body, message) => {
    setBusy(true);
    try { x.setData(await api.post(`${URL}/${id}/${action}`, body)); onChange(); toast(message); setNote(''); setReason(''); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const canEdit = d && !d.masked && d.status !== 'annule' && (can('courrier:write') || can('courrier:assign'));
  const canAct = d && d.status === 'affecte' && (d.is_recipient || can('courrier:assign'));
  const doneLabel = { information: 'J’ai pris connaissance', traitement: 'Marquer traité', avis: 'Donner mon avis' }[d?.suite] || 'Marquer traité';
  return (
    <Drawer title={d ? `${d.number} · ${d.direction_label}` : 'Courrier'} onClose={onClose}>
      {!d ? <Skeleton h={300} /> : d.masked ? (
        <Empty icon={Lock}>Courrier confidentiel : seuls le destinataire et la direction en voient le contenu.</Empty>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={TONES[d.status]}>{d.status_label}</Badge>
            {d.confidential && <Badge><Lock style={{ width: 12, height: 12 }} /> Confidentiel</Badge>}
            {d.urgent && <Badge tone="danger">Urgent</Badge>}
            {d.late && <Badge tone="danger">En retard</Badge>}
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px' }}>{d.subject}</h3>
            <div className="kv"><span>{d.direction === 'depart' ? 'Destinataire' : 'Expéditeur'}</span><b>{d.correspondent}</b></div>
            <div className="kv"><span>{d.direction === 'depart' ? 'Envoyé le' : 'Arrivé le'}</span><b>{date(d.date)} · {d.channel_label}</b></div>
            {d.letter_date && <div className="kv"><span>Date du courrier</span><b>{date(d.letter_date)}</b></div>}
            {d.letter_ref && <div className="kv"><span>Référence</span><b>{d.letter_ref}</b></div>}
            <div className="kv"><span>Nature</span><b>{d.nature_label}</b></div>
            {d.reply_to_number && <div className="kv"><span>En réponse à</span><b>{d.reply_to_number}</b></div>}
            <div className="kv"><span>Enregistré par</span><b>{d.created_by_name || '—'} · {dateTime(d.created_at)}</b></div>
          </div>
          {d.notes && <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{d.notes}</p>}
          {d.scan_url
            ? <a className="btn" style={{ alignSelf: 'start' }} href={d.scan_url} target="_blank" rel="noreferrer"><FileText />Ouvrir le scan{d.scan_name ? ` (${d.scan_name})` : ''}</a>
            : <p className="small muted" style={{ margin: 0 }}>Aucun scan joint.</p>}

          {d.direction === 'arrivee' && d.suite && (
            <div className="erp-panel">
              <div className="kv"><span>Affecté à</span><b>{[d.assigned_to_name, d.assigned_department_label && `service ${d.assigned_department_label}`].filter(Boolean).join(' · ') || '—'}</b></div>
              <div className="kv"><span>Suite à donner</span><b>{d.suite_label}</b></div>
              {d.due_date && <div className="kv"><span>Délai</span><b className={d.late ? 'text-danger' : ''}>{date(d.due_date)}</b></div>}
              {d.instructions && <div className="kv"><span>Instructions</span><b style={{ whiteSpace: 'pre-wrap' }}>{d.instructions}</b></div>}
              <div className="kv"><span>Par</span><b>{d.assigned_by_name} · {dateTime(d.assigned_at)}</b></div>
              {d.done_at && <div className="kv"><span>Suite donnée</span><b style={{ whiteSpace: 'pre-wrap' }}>{d.done_note}<div className="small muted">{d.done_by_name} · {dateTime(d.done_at)}</div></b></div>}
            </div>
          )}
          {d.status === 'annule' && <div className="alert">{d.done_note}</div>}
          {d.replies?.length > 0 && <div className="small">Réponse(s) : {d.replies.map(r => `${r.number} du ${date(r.date)}`).join(', ')}</div>}

          {canAct && (
            <div className="erp-panel stack" style={{ gap: 10 }}>
              <Field label={d.suite === 'avis' ? 'Votre avis' : 'Commentaire (facultatif)'}><textarea className="textarea" rows={3} value={note} onChange={e => setNote(e.target.value)} /></Field>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" disabled={busy || (d.suite === 'avis' && !note.trim())} onClick={() => act('done', note.trim() ? { note: note.trim() } : {}, 'Suite enregistrée')}><Check />{doneLabel}</button>
                {d.suite === 'traitement' && (d.is_recipient || can('courrier:write')) && <button className="btn" disabled={busy} onClick={() => onReply(d)}><Reply />Répondre par un courrier départ</button>}
              </div>
            </div>
          )}
          {can('courrier:assign') && d.direction === 'arrivee' && ['enregistre', 'affecte'].includes(d.status) && <AssignPanel d={d} refs={refs} busy={busy} onAssign={body => act('assign', body, 'Courrier affecté — le destinataire est prévenu par e-mail')} />}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {canEdit && <button className="btn btn-ghost" onClick={() => onEdit(d)}><Pencil />Corriger l’enregistrement</button>}
            {d.status === 'traite' && d.direction === 'arrivee' && can('courrier:assign') && <button className="btn btn-ghost" disabled={busy} onClick={() => act('reopen', {}, 'Courrier rouvert')}><Undo2 />Rouvrir</button>}
          </div>
          {d.status !== 'annule' && (can('courrier:assign') || (can('courrier:write') && ['enregistre', 'envoye'].includes(d.status))) && (
            <details className="small">
              <summary className="muted" style={{ cursor: 'pointer' }}>Annuler cet enregistrement</summary>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <input className="input" placeholder="Motif (doublon, erreur…)" value={reason} onChange={e => setReason(e.target.value)} />
                <button className="btn" disabled={busy || !reason.trim()} onClick={() => act('cancel', { reason: reason.trim() }, 'Enregistrement annulé (le n° d’ordre reste au registre)')}><Ban />Annuler</button>
              </div>
            </details>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** Affectation : la suite proposée découle de la nature du courrier, le délai de la suite (modifiables). */
function AssignPanel({ d, refs, busy, onAssign }) {
  const initialSuite = d.suite || refs.natures[d.nature]?.suite || 'traitement';
  const dueFor = suite => (refs.suites[suite]?.days ? addDays(today() > d.date ? today() : d.date, refs.suites[suite].days) : '');
  const [f, setF] = useState({
    suite: initialSuite, assigned_to: d.assigned_to || '', assigned_department: d.assigned_department || '',
    due_date: d.due_date || dueFor(initialSuite), instructions: d.instructions || '',
  });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const classement = f.suite === 'classement';
  const needsDue = ['traitement', 'avis'].includes(f.suite);
  const ready = classement || ((f.assigned_to || f.assigned_department) && (!needsDue || f.due_date));
  return (
    <div className="erp-panel form-grid">
      <div className="full"><b>{d.status === 'affecte' ? 'Réaffecter' : 'Affecter'}</b></div>
      <Field label="Suite à donner" hint={`Proposée pour : ${refs.natures[d.nature]?.label || d.nature}`}>
        <select className="select" value={f.suite} onChange={e => { const suite = e.target.value; setF(x => ({ ...x, suite, due_date: dueFor(suite) })); }}>
          {Object.entries(refs.suites).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
      </Field>
      {!classement && (
        <>
          <Field label={`Délai${needsDue ? '' : ' (facultatif)'}`}><input className="input" type="date" min={d.date} value={f.due_date} onChange={set('due_date')} /></Field>
          <Field label="Destinataire"><select className="select" value={f.assigned_to} onChange={set('assigned_to')}><option value="">— Aucune personne —</option>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="Service" hint="Sans personne, tout le service le voit"><select className="select" value={f.assigned_department} onChange={set('assigned_department')}><option value="">—</option>{Object.entries(refs.departments).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Instructions" className="full"><textarea className="textarea" rows={2} value={f.instructions} onChange={set('instructions')} placeholder="Préparer une réponse, voir avec le notaire…" /></Field>
        </>
      )}
      <div className="full">
        <button className="btn btn-primary" disabled={busy || !ready} onClick={() => onAssign({
          suite: f.suite, assigned_to: classement ? null : Number(f.assigned_to) || null, assigned_department: classement ? null : f.assigned_department || null,
          due_date: classement ? null : f.due_date || null, instructions: f.instructions.trim() || null,
        })}><Check />{classement ? 'Classer' : d.status === 'affecte' ? 'Réaffecter' : 'Affecter'}</button>
      </div>
    </div>
  );
}

function MailForm({ direction, mail, replyTo, refs, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    date: mail?.date || today(), letter_date: mail?.letter_date || '', letter_ref: mail?.letter_ref || '',
    correspondent: mail?.correspondent || replyTo?.correspondent || '', subject: mail?.subject || (replyTo ? `Réponse : ${replyTo.subject}` : ''),
    nature: mail?.nature || 'lettre', channel: mail?.channel || 'poste', confidential: mail?.confidential ?? !!replyTo?.confidential, urgent: mail?.urgent || false, notes: mail?.notes || '',
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const arrivee = direction === 'arrivee';
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      // Champ vidé : « null » efface la valeur enregistrée
      const fields = { ...f, letter_date: f.letter_date || 'null', letter_ref: f.letter_ref || 'null', notes: f.notes || 'null' };
      const body = formData(mail ? fields : { ...fields, direction, reply_to_id: replyTo?.id }, { scan: file });
      const m = mail ? await api.patch(`${URL}/${mail.id}`, body) : await api.post(URL, body);
      toast(mail ? 'Enregistrement corrigé' : `Courrier enregistré sous le n° ${m.number}`);
      onSaved(m);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={mail ? `Corriger ${mail.number}` : replyTo ? `Réponse à ${replyTo.number}` : arrivee ? 'Courrier arrivé' : 'Courrier départ'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="mail-form" disabled={busy}><Check />{mail ? 'Enregistrer' : 'Enregistrer et numéroter'}</button></>}>
      <form id="mail-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} />{!mail && <p className="small muted" style={{ margin: 0 }}>Le n° d’ordre ({arrivee ? 'A' : 'D'}-{f.date.slice(0, 4)}-…) est attribué à l’enregistrement.</p>}</div>
        <Field label={arrivee ? 'Arrivé le' : 'Envoyé le'}><input className="input" type="date" required max={today()} value={f.date} onChange={set('date')} /></Field>
        <Field label={arrivee ? 'Reçu par' : 'Envoyé par'}><select className="select" value={f.channel} onChange={set('channel')}>{Object.entries(refs.channels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label={arrivee ? 'Expéditeur' : 'Destinataire'} className="full"><input className="input" required minLength={2} maxLength={200} value={f.correspondent} onChange={set('correspondent')} placeholder={arrivee ? 'Mairie de Bingerville, Cabinet Me Koné…' : 'Nom de la personne ou de l’organisme'} /></Field>
        <Field label="Objet" className="full"><input className="input" required minLength={3} maxLength={300} value={f.subject} onChange={set('subject')} /></Field>
        <Field label="Nature" hint={arrivee ? `Suite proposée : ${refs.suites[refs.natures[f.nature]?.suite]?.label}` : undefined}><select className="select" value={f.nature} onChange={set('nature')}>{Object.entries(refs.natures).map(([k, n]) => <option key={k} value={k}>{n.label}</option>)}</select></Field>
        <Field label="Date du courrier"><input className="input" type="date" value={f.letter_date} onChange={set('letter_date')} /></Field>
        <Field label="Référence" hint={arrivee ? 'Celle de l’expéditeur' : 'Votre référence'}><input className="input" maxLength={100} value={f.letter_ref} onChange={set('letter_ref')} /></Field>
        <Field label="Scan" hint="PDF ou photo, 20 Mo au plus">
          <label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : mail?.scan_url ? 'Remplacer le scan' : 'Joindre le scan'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></label>
        </Field>
        <div className="full row" style={{ gap: 20, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.confidential} onChange={set('confidential')} />Confidentiel <span className="small muted">(destinataire et direction seulement)</span></label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.urgent} onChange={set('urgent')} />Urgent</label>
        </div>
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}
