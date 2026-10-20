import { useEffect, useRef, useState } from 'react';
import { Camera, CalendarClock, ChevronRight, LifeBuoy, Plus, SendHorizontal, Star, X } from 'lucide-react';
import { api } from '../lib/api';
import { useResource, useSession } from '../lib/session';
import { SAV_STATUS } from '../lib/domain';
import { dayLabel, shortDate, time } from '../lib/format';
import { Alert, Badge, Empty, ErrorState, PageHead, PageSkeleton, Sheet, Spinner, useToast } from '../components/ui';

const status = s => SAV_STATUS[s] || SAV_STATUS.nouveau;

/** Service après-vente : signaler un problème, suivre son traitement, donner son avis. */
export default function Demandes() {
  const { dossiers } = useSession();
  const list = useResource('sav', () => api.get('/sav'));
  const meta = useResource('sav-meta', () => api.get('/sav/meta'));
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [toast, say] = useToast();

  if (list.loading) return <PageSkeleton />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  const rows = list.data || [];
  const open = rows.filter(t => status(t.status).step < 2);

  return (
    <>
      <PageHead eyebrow="Service après-vente" title="Mes demandes"
        sub="Un souci dans votre logement ? Signalez-le avec une photo : l’équipe SAV vous répond ici et organise l’intervention.">
        {dossiers.length > 0 && <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setCreating(true)}><Plus aria-hidden="true" />Signaler un problème</button>}
      </PageHead>

      {rows.length === 0 ? (
        <div className="card reveal reveal-2">
          <Empty icon={LifeBuoy} title="Aucune demande" text="Fuite, fissure, porte qui ferme mal, équipement en panne… Décrivez le problème et joignez une photo, nous revenons vers vous rapidement." />
        </div>
      ) : (
        <div className="card reveal reveal-2">
          {open.length > 0 && <div className="row-group">En cours · {open.length}</div>}
          {[...open, ...rows.filter(t => status(t.status).step === 2)].map((t, i) => {
            const st = status(t.status);
            return (
              <div key={t.id}>
                {i === open.length && open.length > 0 && <div className="row-group">Terminées</div>}
                <button className="row row-btn" onClick={() => setOpenId(t.id)}>
                  <span className={`row-icon${st.step === 2 ? ' done' : ''}`}><LifeBuoy aria-hidden="true" /></span>
                  <span className="row-main">
                    <span className="row-title">{t.title}</span>
                    <span className="row-sub" style={{ display: 'block' }}>{t.ref} · {shortDate(t.created_at)}{t.lot_code ? ` · lot ${t.lot_code}` : ''}</span>
                  </span>
                  <span className="row-end"><Badge tone={st.tone}>{st.label}</Badge></span>
                  <ChevronRight aria-hidden="true" className="row-chevron" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <NewRequest meta={meta.data} onClose={() => setCreating(false)}
          onCreated={t => { setCreating(false); list.reload(); setOpenId(t.id); say('Demande envoyée à l’équipe SAV'); }} />
      )}
      {openId && <Detail id={openId} onClose={() => setOpenId(null)} onChange={list.reload} say={say} />}
      {toast}
    </>
  );
}

/** Photos jointes : envoyées dès qu'elles sont choisies (6 au plus). */
function PhotoField({ value, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = async files => {
    const list = [...files].slice(0, 6 - value.length);
    if (!list.length) return;
    const form = new FormData();
    list.forEach(f => form.append('files', f));
    setBusy(true); setError('');
    try { onChange([...value, ...(await api.upload('/sav/files', form))]); } catch (e) { setError(e.message); }
    setBusy(false);
    if (input.current) input.current.value = '';
  };
  return (
    <>
      {error && <Alert>{error}</Alert>}
      <div className="photo-row">
        {value.map(p => (
          <span key={p.id} className="photo">
            {p.mime?.startsWith('image/') ? <img src={p.url} alt="" /> : <span className="photo-video">Vidéo</span>}
            <button type="button" onClick={() => onChange(value.filter(x => x.id !== p.id))} aria-label="Retirer la photo"><X aria-hidden="true" /></button>
          </span>
        ))}
        {value.length < 6 && (
          <button type="button" className="photo photo-add" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Spinner /> : <Camera aria-hidden="true" />}<span>{busy ? 'Envoi…' : 'Photo'}</span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime" multiple hidden onChange={e => add(e.target.files)} />
    </>
  );
}

function NewRequest({ meta, onClose, onCreated }) {
  const { dossiers, selected } = useSession();
  const [form, setForm] = useState({ sale_id: selected?.id || dossiers[0]?.id, category: '', title: '', location: '', description: '' });
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      onCreated(await api.post('/sav', {
        sale_id: Number(form.sale_id), category: form.category, title: form.title,
        location: form.location || undefined, description: form.description || undefined, media_ids: photos.map(p => p.id),
      }));
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Sheet title="Signaler un problème" onClose={onClose} footer={(
      <button className="btn btn-primary btn-block" form="sav-new" disabled={busy || !form.category || form.title.trim().length < 3}>
        {busy ? <Spinner /> : <SendHorizontal aria-hidden="true" />}Envoyer la demande
      </button>
    )}>
      <form id="sav-new" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        {dossiers.length > 1 && (
          <label className="field">
            <span className="field-label">Bien concerné</span>
            <select className="input" value={form.sale_id} onChange={set('sale_id')}>
              {dossiers.map(d => <option key={d.id} value={d.id}>Lot {d.property.lot_code} · {d.property.project.name}</option>)}
            </select>
          </label>
        )}
        <div className="field">
          <span className="field-label">Type de problème</span>
          <div className="chips wrap" role="group" aria-label="Type de problème">
            {meta && Object.entries(meta.categories).map(([k, l]) => (
              <button key={k} type="button" className="chip" aria-pressed={form.category === k} onClick={() => setForm(f => ({ ...f, category: k }))}>{l}</button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">En quelques mots</span>
          <input className="input" required minLength={3} maxLength={160} value={form.title} onChange={set('title')} placeholder="Ex. Fuite sous l’évier de la cuisine" />
        </label>
        <label className="field">
          <span className="field-label">Où dans le logement ?</span>
          <input className="input" maxLength={120} value={form.location} onChange={set('location')} placeholder="Cuisine, chambre 2, façade…" />
        </label>
        <label className="field">
          <span className="field-label">Détails (facultatif)</span>
          <textarea className="input" rows={4} maxLength={5000} value={form.description} onChange={set('description')} placeholder="Depuis quand, à quel moment, ce que vous avez constaté…" />
        </label>
        <div className="field">
          <span className="field-label">Photos</span>
          <PhotoField value={photos} onChange={setPhotos} />
          <p className="hint">Une photo du problème aide nos équipes à préparer l’intervention.</p>
        </div>
      </form>
    </Sheet>
  );
}

function Detail({ id, onClose, onChange, say }) {
  const [t, setT] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => { api.get(`/sav/${id}`).then(setT).catch(setError); }, [id]);
  const done = out => { setT(out); onChange(); };

  const reply = async e => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setSendError('');
    try { done(await api.post(`/sav/${id}/comments`, { body: text.trim(), media_ids: photos.map(p => p.id) })); setText(''); setPhotos([]); } catch (err) { setSendError(err.message); }
    setBusy(false);
  };

  const st = t && status(t.status);
  const upcoming = t?.interventions.filter(i => i.status === 'planifiee') || [];
  const canReply = t && !['clos', 'rejete'].includes(t.status);
  let lastDay = null;

  return (
    <Sheet title={t ? t.title : 'Ma demande'} onClose={onClose}>
      {error && <Alert>{error.message}</Alert>}
      {!t && !error && <div style={{ display: 'grid', placeItems: 'center', padding: 30 }}><Spinner /></div>}
      {t && (
        <div className="sav-detail">
          <div className="sav-status">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span className="muted small">{t.ref}{t.lot_code ? ` · lot ${t.lot_code}` : ''}</span>
          </div>
          <div className="doc-steps" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className={i <= st.step ? 'on' : ''} />)}</div>
          <p className="hint" style={{ marginTop: 8 }}>{st.hint}</p>

          {upcoming.map(i => (
            <div key={i.id} className="callout info" style={{ marginTop: 12 }}>
              <span className="callout-icon"><CalendarClock aria-hidden="true" /></span>
              <span className="callout-body">
                <span className="callout-title">Intervention le {dayLabel(i.scheduled_at).toLowerCase()} à {time(i.scheduled_at)}</span>
                <span className="callout-text" style={{ display: 'block' }}>Durée prévue : environ {i.duration_min} minutes. Merci d’être présent ou de nous prévenir ici.</span>
              </span>
            </div>
          ))}

          {['resolu', 'clos'].includes(t.status) && !t.satisfaction && <Rating id={id} onDone={out => { done(out); say('Merci pour votre avis'); }} />}
          {t.satisfaction && (
            <p className="small" style={{ marginTop: 12 }}>Votre avis : <span className="stars-show" aria-label={`${t.satisfaction} sur 5`}>{[1, 2, 3, 4, 5].map(n => <Star key={n} className={n <= t.satisfaction ? 'on' : ''} aria-hidden="true" />)}</span></p>
          )}

          <div className="sav-thread">
            {t.description && (
              <div className="bubble me">{t.description}<PhotoStrip files={t.media} /><span className="bubble-meta">{shortDate(t.created_at)}</span></div>
            )}
            {!t.description && t.media.length > 0 && <div className="bubble me"><PhotoStrip files={t.media} /></div>}
            {t.events.map(e => {
              const day = dayLabel(e.created_at);
              const showDay = day !== lastDay;
              lastDay = day;
              if (e.kind !== 'comment') {
                return <div key={e.id}>{showDay && <div className="chat-day">{day}</div>}<div className="sav-event">{e.body}</div></div>;
              }
              const mine = e.author === 'client';
              return (
                <div key={e.id} style={{ display: 'contents' }}>
                  {showDay && <div className="chat-day">{day}</div>}
                  <div className={`bubble ${mine ? 'me' : 'them'}`}>
                    {!mine && <span className="bubble-author">{e.user_name || 'Équipe SIIPAF'}</span>}
                    {e.body}
                    <PhotoStrip files={e.media} />
                    <span className="bubble-meta">{time(e.created_at)}</span>
                  </div>
                </div>
              );
            })}
            {t.interventions.filter(i => i.status === 'realisee' && i.media_after.length).map(i => (
              <div key={i.id} className="bubble them"><span className="bubble-author">Après intervention</span><PhotoStrip files={i.media_after} /></div>
            ))}
          </div>

          {canReply && (
            <form onSubmit={reply} className="sav-reply">
              {sendError && <Alert>{sendError}</Alert>}
              <textarea className="input" rows={2} maxLength={4000} value={text} onChange={e => setText(e.target.value)} placeholder="Ajouter une précision, une photo…" aria-label="Votre message" />
              <PhotoField value={photos} onChange={setPhotos} />
              <button className="btn btn-dark btn-sm" disabled={busy || !text.trim()}><SendHorizontal aria-hidden="true" />Envoyer</button>
            </form>
          )}
        </div>
      )}
    </Sheet>
  );
}

function PhotoStrip({ files }) {
  if (!files?.length) return null;
  return (
    <span className="photo-row" style={{ marginTop: 8 }}>
      {files.map(f => (
        <a key={f.id} className="photo" href={f.url} target="_blank" rel="noreferrer">
          {f.mime?.startsWith('image/') ? <img src={f.url} alt="Photo jointe" loading="lazy" /> : <span className="photo-video">Vidéo</span>}
        </a>
      ))}
    </span>
  );
}

function Rating({ id, onDone }) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setBusy(true); setError('');
    try { onDone(await api.post(`/sav/${id}/rating`, { satisfaction: score, comment: comment || undefined })); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="card card-pad sav-rate">
      <strong>Le problème est-il bien réglé ?</strong>
      <p className="hint" style={{ marginTop: 2 }}>Notez l’intervention. Si ce n’est pas réglé, répondez plutôt dans le fil ci-dessous.</p>
      {error && <Alert>{error}</Alert>}
      <div className="stars-input" role="radiogroup" aria-label="Note sur 5">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" role="radio" aria-checked={score === n} aria-label={`${n} sur 5`} className={n <= score ? 'on' : ''} onClick={() => setScore(n)}><Star aria-hidden="true" /></button>
        ))}
      </div>
      {score > 0 && (
        <>
          <textarea className="input" rows={2} maxLength={500} value={comment} onChange={e => setComment(e.target.value)} placeholder="Un commentaire ? (facultatif)" aria-label="Commentaire" style={{ marginTop: 10 }} />
          <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={send}>Envoyer mon avis</button>
        </>
      )}
    </div>
  );
}
