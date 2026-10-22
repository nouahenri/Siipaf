/**
 * Gestion de l'espace client depuis la fiche lot : échéancier, accès de l'acquéreur,
 * journal de chantier et messagerie. Utilisé aussi par la rubrique « Messagerie clients ».
 */
import { useEffect, useRef, useState } from 'react';
import { KeyRound, Copy, MessageCircle, RefreshCw, Plus, Trash2, Eye, EyeOff, ImagePlus, Send, X, Video } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Card, Field, Badge, Skeleton, ErrorBox, Empty } from './ui';
import { MediaPicker } from './MediaLibrary';
import { INSTALLMENT_STATUS, SITE_STAGES, FINANCING } from '../lib/domain';
import { fcfa, date, dateTime } from '../lib/format';

/** Adresse de l'espace client vue depuis le dashboard (admin.siipaf.com → client.siipaf.com). */
export const clientSpaceUrl = () => window.location.origin.replace('://admin.localhost', '://localhost').replace('://admin.', '://client.');
const stageLabel = id => SITE_STAGES.find(s => s.id === id)?.label || id;

// ─── Échéancier ─────────────────────────────────────────────
export function ScheduleTab({ sale, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const s = sale.schedule || { lines: [] };
  const editable = can('schedule:write') && sale.status !== 'desiste';
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ start_date: '', months: '', deposit_pct: '', deposit_fcfa: '' });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  // Apport en montant (ex. 2 600 000 déjà versés) : prime sur le pourcentage
  const depositAmount = f.deposit_fcfa === '' ? null : Math.round(Number(String(f.deposit_fcfa).replace(/[\s  ]/g, '')));
  const price = Number(sale.price_fcfa) || 0;
  const monthsPreview = f.months !== '' ? Number(f.months) : null;

  const generate = async () => {
    setError(null);
    const body = {};
    if (f.start_date) body.start_date = f.start_date;
    if (f.months !== '') body.months = Number(f.months);
    if (depositAmount != null && Number.isFinite(depositAmount)) body.deposit_fcfa = depositAmount;
    else if (f.deposit_pct !== '') body.deposit_pct = Number(f.deposit_pct);
    try {
      onChange(await api.post(`/admin/sales/${sale.id}/schedule/generate`, body));
      setOpen(false);
      toast('Échéancier recalculé');
    } catch (e) { setError(e); }
  };

  return (
    <div className="stack">
      <div className="grid grid-3" style={{ gap: 12 }}>
        <div className="card kpi"><span className="kpi-label">Financement</span><span className="kpi-value" style={{ fontSize: 14 }}>{s.financing_label || FINANCING[sale.financing] || 'Non défini'}</span></div>
        <div className="card kpi"><span className="kpi-label">Prochaine échéance</span><span className="kpi-value" style={{ fontSize: 15 }}>{s.next_due ? <>{fcfa(s.next_due.remaining_fcfa)}<div className="small muted">{date(s.next_due.due_date)}</div></> : '—'}</span></div>
        <div className="card kpi"><span className="kpi-label">En retard</span><span className="kpi-value" style={{ fontSize: 15, color: s.overdue_count ? 'var(--danger)' : undefined }}>{s.overdue_count ? <>{fcfa(s.overdue_fcfa)}<div className="small muted">{s.overdue_count} échéance{s.overdue_count > 1 ? 's' : ''}</div></> : 'Aucun'}</span></div>
      </div>

      {editable && (
        open ? (
          <Card title="Recalculer l’échéancier" actions={<button className="btn btn-sm btn-ghost btn-icon" onClick={() => setOpen(false)} aria-label="Fermer"><X /></button>}>
            <ErrorBox error={error} />
            <p className="small muted" style={{ marginBottom: 10 }}>L’échéancier type est recalculé selon le financement du dossier ; les versements déjà enregistrés sont conservés et réimputés. Laissez vide pour garder les valeurs par défaut.</p>
            <div className="form-grid">
              <Field label="Date de départ"><input className="input" type="date" value={f.start_date} onChange={set('start_date')} /></Field>
              <Field label="Nombre de mensualités"><input className="input tabular" inputMode="numeric" value={f.months} onChange={set('months')} placeholder="36" /></Field>
              <Field label="Apport (%)"><input className="input tabular" inputMode="numeric" value={f.deposit_pct} onChange={set('deposit_pct')} placeholder="30" disabled={depositAmount != null} /></Field>
              <Field label="Ou apport en montant (FCFA)" hint={sale.paid_fcfa > 0
                ? <button type="button" className="list-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setF(x => ({ ...x, deposit_fcfa: String(sale.paid_fcfa) }))}>Reprendre le déjà versé : {fcfa(sale.paid_fcfa)}</button>
                : 'Prime sur le pourcentage.'}>
                <input className="input tabular" inputMode="numeric" value={f.deposit_fcfa} onChange={set('deposit_fcfa')} placeholder="Ex. 2 600 000" />
              </Field>
            </div>
            {depositAmount != null && price > 0 && (
              depositAmount > price
                ? <p className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>L’apport dépasse le prix du bien ({fcfa(price)}).</p>
                : <p className="small muted" style={{ marginTop: 8 }}>
                    Apport {fcfa(depositAmount)} ({String(Math.round((depositAmount / price) * 1000) / 10).replace('.', ',')} % de {fcfa(price)}) · reste {fcfa(price - depositAmount)}
                    {monthsPreview ? ` en ${monthsPreview} mensualités d’environ ${fcfa(Math.round((price - depositAmount) / monthsPreview))}` : ' réparti selon le financement du dossier'}.
                  </p>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={generate}><RefreshCw />Recalculer</button>
            </div>
          </Card>
        ) : <div><button className="btn btn-sm" onClick={() => setOpen(true)} disabled={!sale.financing} title={sale.financing ? '' : 'Indiquez d’abord le financement du dossier'}><RefreshCw />Recalculer l’échéancier</button></div>
      )}

      <Card title={`Échéances (${s.lines.length})`} bodyClass="">
        {!s.lines.length ? <Empty>{sale.financing ? 'Pas encore d’échéancier pour ce dossier : cliquez sur « Recalculer l’échéancier » pour le créer.' : 'Aucun échéancier : indiquez d’abord le mode de financement du dossier.'}</Empty> : (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table"><tbody>
              {s.lines.map(l => (
                <tr key={l.seq}>
                  <td className="nowrap">{date(l.due_date)}</td>
                  <td>{l.label}</td>
                  <td className="right tabular nowrap"><strong>{fcfa(l.amount_fcfa)}</strong>{l.status === 'partielle' || (l.status === 'en_retard' && l.paid_fcfa > 0) ? <div className="small muted">reste {fcfa(l.remaining_fcfa)}</div> : null}</td>
                  <td style={{ width: 110 }}><Badge tone={INSTALLMENT_STATUS[l.status].tone} dot>{INSTALLMENT_STATUS[l.status].label}</Badge></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Accès à l'espace client ────────────────────────────────
export function AccessTab({ sale }) {
  const { can } = useAuth();
  const toast = useToast();
  const lead = sale.lead;
  const access = useResource(`/admin/leads/${lead.id}/client-access`);
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);
  const editable = can('client_access:write');
  const a = access.data?.access;
  const url = clientSpaceUrl();

  const grant = async () => {
    if (a && !window.confirm('Générer un nouveau mot de passe provisoire ? L’ancien ne fonctionnera plus.')) return;
    setBusy(true);
    try {
      const out = await api.post(`/admin/leads/${lead.id}/client-access`, { notify: true });
      setIssued(out);
      access.setData({ access: out.access });
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const toggle = async () => {
    try { access.setData(await api.patch(`/admin/leads/${lead.id}/client-access`, { active: !a.active })); toast(a.active ? 'Accès suspendu' : 'Accès réactivé'); } catch (e) { toast(e.message, 'err'); }
  };

  const message = issued && [
    `Bonjour ${lead.name},`,
    `Votre espace client SIIPAF est ouvert : ${url}`,
    `Code client : ${lead.client_code}`,
    `Mot de passe provisoire : ${issued.temporary_password}`,
    'Vous choisirez votre mot de passe personnel à la première connexion.',
  ].join('\n');
  const phone = (lead.phone || '').replace(/[^\d]/g, '');
  const copy = async text => { try { await navigator.clipboard.writeText(text); toast('Copié'); } catch { toast('Copie impossible', 'err'); } };

  if (access.loading) return <Skeleton h={160} />;
  return (
    <div className="stack">
      <Card title="Accès de l’acquéreur">
        <dl className="dl">
          <dt>Code client</dt><dd><strong className="tabular">{lead.client_code}</strong></dd>
          <dt>Adresse</dt><dd><a href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, '')}</a></dd>
          <dt>État</dt>
          <dd>{!a ? <Badge>Pas encore ouvert</Badge> : !a.active ? <Badge tone="danger" dot>Suspendu</Badge> : a.must_change_password ? <Badge tone="warn" dot>Ouvert — mot de passe provisoire</Badge> : <Badge tone="ok" dot>Actif</Badge>}</dd>
          {a && <><dt>Dernière connexion</dt><dd>{a.last_login_at ? dateTime(a.last_login_at) : 'Jamais'}</dd></>}
        </dl>
        {editable && (
          <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={grant} disabled={busy}><KeyRound />{a ? 'Nouveau mot de passe provisoire' : 'Ouvrir l’accès'}</button>
            {a && <button className="btn btn-sm" onClick={toggle}>{a.active ? <><EyeOff />Suspendre l’accès</> : <><Eye />Réactiver l’accès</>}</button>}
          </div>
        )}
      </Card>

      {issued && (
        <Card title="À transmettre au client">
          <p className="small muted" style={{ marginBottom: 10 }}>
            Ce mot de passe provisoire n’est affiché qu’une fois. {issued.emailed ? 'Il a aussi été envoyé par e-mail.' : 'Il n’a pas pu être envoyé par e-mail : transmettez-le par WhatsApp ou par téléphone.'}
          </p>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <code className="tabular" style={{ fontSize: 18, padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}>{issued.temporary_password}</code>
            <button className="btn btn-sm" onClick={() => copy(issued.temporary_password)}><Copy />Copier</button>
          </div>
          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => copy(message)}><Copy />Copier le message</button>
            {phone && <a className="btn btn-sm" href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><MessageCircle />Envoyer par WhatsApp</a>}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Journal de chantier ────────────────────────────────────
export function SiteTab({ lot }) {
  const { can } = useAuth();
  const toast = useToast();
  const updates = useResource(`/admin/lots/${lot.id}/site-updates`);
  const editable = can('site_updates:write');
  const [form, setForm] = useState(false);

  const patch = async (u, body) => {
    try { await api.patch(`/admin/site-updates/${u.id}`, body); updates.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async u => {
    if (!window.confirm(`Supprimer « ${u.title} » ?`)) return;
    try { await api.del(`/admin/site-updates/${u.id}`); updates.reload(); toast('Point supprimé'); } catch (e) { toast(e.message, 'err'); }
  };
  const scopeLabel = u => (u.scope === 'lot' ? `Lot ${u.lot_code || lot.code}` : u.scope === 'ilot' ? `Îlot ${u.ilot}` : 'Tout le projet');

  return (
    <div className="stack">
      <p className="small muted">Ce que l’acquéreur de ce lot voit dans son espace : les points du projet entier, de son îlot{lot.ilot ? ` (${lot.ilot})` : ''} et de son lot.</p>
      {editable && (form
        ? <SiteUpdateForm lot={lot} onDone={() => { setForm(false); updates.reload(); }} onCancel={() => setForm(false)} />
        : <div><button className="btn btn-primary btn-sm" onClick={() => setForm(true)}><Plus />Publier un point d’avancement</button></div>)}
      {updates.loading ? <Skeleton h={120} /> : !updates.data?.length ? <Empty>Aucun point d’avancement publié.</Empty> : (
        <ol className="stack" style={{ listStyle: 'none', gap: 12 }}>
          {updates.data.map(u => (
            <li key={u.id} className="card" style={{ padding: 14, opacity: u.visible_client ? 1 : 0.7 }}>
              <div className="row-between" style={{ gap: 8 }}>
                <div>
                  <strong>{u.title}</strong>
                  <div className="small muted">{date(u.published_at)} · {u.stage_label} · {u.progress_pct} % · {scopeLabel(u)}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {!u.visible_client && <Badge>Masqué</Badge>}
                  {editable && <button className="btn btn-sm btn-ghost btn-icon" onClick={() => patch(u, { visible_client: !u.visible_client })} aria-label={u.visible_client ? 'Masquer au client' : 'Montrer au client'} title={u.visible_client ? 'Masquer au client' : 'Montrer au client'}>{u.visible_client ? <EyeOff /> : <Eye />}</button>}
                  {editable && <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => remove(u)} aria-label="Supprimer"><Trash2 /></button>}
                </div>
              </div>
              {u.body && <p className="small" style={{ marginTop: 6, whiteSpace: 'pre-line' }}>{u.body}</p>}
              {!!u.media.length && (
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {u.media.map(m => m.kind === 'video'
                    ? <video key={m.id} src={m.url} style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6 }} muted />
                    : <img key={m.id} src={m.url} alt={m.alt || ''} style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6 }} loading="lazy" />)}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SiteUpdateForm({ lot, onDone, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ scope: 'lot', stage: 'gros_oeuvre', progress_pct: '', title: '', body: '', visible_client: true, published_at: today });
  const [media, setMedia] = useState([]);
  const [picker, setPicker] = useState(null); // 'image' | 'video'
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/admin/projects/${lot.project_id}/site-updates`, {
        stage: f.stage, progress_pct: Math.min(100, Math.max(0, Number(f.progress_pct) || 0)), title: f.title.trim(),
        body: f.body.trim() || null, visible_client: f.visible_client, published_at: f.published_at, media: media.map(m => m.id),
        ...(f.scope === 'lot' ? { lot_id: lot.id } : f.scope === 'ilot' ? { ilot: lot.ilot } : {}),
      });
      onDone();
    } catch (e) { setError(e); }
    setBusy(false);
  };

  return (
    <Card title="Nouveau point d’avancement" actions={<button className="btn btn-sm btn-ghost btn-icon" onClick={onCancel} aria-label="Fermer"><X /></button>}>
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="Concerne">
          <select className="select" value={f.scope} onChange={set('scope')}>
            <option value="lot">Ce lot ({lot.code})</option>
            {lot.ilot && <option value="ilot">Tout l’îlot {lot.ilot}</option>}
            <option value="projet">Tout le projet</option>
          </select>
        </Field>
        <Field label="Étape"><select className="select" value={f.stage} onChange={set('stage')}>{SITE_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        <Field label="Avancement (%)"><input className="input tabular" inputMode="numeric" value={f.progress_pct} onChange={set('progress_pct')} placeholder="45" /></Field>
        <Field label="Date"><input className="input" type="date" value={f.published_at} onChange={set('published_at')} /></Field>
        <Field label="Titre" className="full"><input className="input" value={f.title} onChange={set('title')} placeholder="Ex. : Élévation des murs terminée" /></Field>
        <Field label="Détails (facultatif)" className="full"><textarea className="textarea" rows={3} value={f.body} onChange={set('body')} /></Field>
      </div>
      <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {media.map(m => (
          <span key={m.id} style={{ position: 'relative' }}>
            {m.mime?.startsWith('video/') ? <video src={m.url} style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6 }} muted /> : <img src={m.url} alt="" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6 }} />}
            <button className="btn btn-sm btn-icon" style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, minHeight: 0, padding: 0 }} onClick={() => setMedia(x => x.filter(y => y.id !== m.id))} aria-label="Retirer"><X size={12} /></button>
          </span>
        ))}
        <button className="btn btn-sm" onClick={() => setPicker('image')}><ImagePlus />Ajouter des photos</button>
        <button className="btn btn-sm" onClick={() => setPicker('video')}><Video />Ajouter une vidéo</button>
      </div>
      <div className="row-between" style={{ marginTop: 12 }}>
        <label className="checkbox small"><input type="checkbox" checked={f.visible_client} onChange={set('visible_client')} />Visible par les clients</label>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || f.title.trim().length < 2}><Plus />Publier</button>
      </div>
      {picker && <MediaPicker type={picker} onPick={m => setMedia(x => (x.some(y => y.id === m.id) ? x : [...x, m]))} onClose={() => setPicker(null)} />}
      <p className="small muted" style={{ marginTop: 8 }}>Photos JPG / PNG / WebP, vidéos MP4, MOV (iPhone) ou WebM jusqu’à 200 Mo. Dans la fenêtre qui s’ouvre, déposez le fichier puis cliquez dessus pour l’ajouter.</p>
    </Card>
  );
}

// ─── Messagerie ─────────────────────────────────────────────
export function MessageThread({ leadId, saleId, onRead }) {
  const { can } = useAuth();
  const toast = useToast();
  const thread = useResource(`/admin/leads/${leadId}/messages`, [leadId]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const writable = can('client_messages');

  useEffect(() => { if (thread.data) { end.current?.scrollIntoView({ block: 'end' }); onRead?.(); } }, [thread.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const m = await api.post(`/admin/leads/${leadId}/messages`, { body: body.trim(), ...(saleId ? { sale_id: saleId } : {}) });
      thread.setData(x => [...(x || []), m]);
      setBody('');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  if (thread.loading && !thread.data) return <Skeleton h={200} />;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="card" style={{ padding: 12, maxHeight: 420, overflowY: 'auto', background: 'var(--surface-2)' }}>
        {!thread.data?.length ? <Empty>Aucun message pour l’instant.</Empty> : (
          <div className="stack" style={{ gap: 8 }}>
            {thread.data.map(m => {
              const mine = m.sender === 'equipe';
              return (
                <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                  <div style={{ background: mine ? 'var(--ink)' : 'var(--surface)', color: mine ? '#fff' : 'var(--ink)', border: mine ? 0 : '1px solid var(--border)', borderRadius: 12, padding: '8px 12px', whiteSpace: 'pre-line' }}>{m.body}</div>
                  <div className="small muted" style={{ textAlign: mine ? 'right' : 'left', marginTop: 2 }}>{mine ? (m.author || 'Équipe') : 'Client'} · {dateTime(m.created_at)}</div>
                </div>
              );
            })}
            <div ref={end} />
          </div>
        )}
      </div>
      {writable && (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <textarea className="textarea" rows={2} style={{ flex: 1 }} value={body} onChange={e => setBody(e.target.value)} placeholder="Votre réponse…" aria-label="Votre réponse"
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }} />
          <button className="btn btn-primary" onClick={send} disabled={busy || !body.trim()}><Send />Envoyer</button>
        </div>
      )}
      <p className="small muted">Le client est prévenu par e-mail (sans le contenu) et lit la réponse dans son espace.</p>
    </div>
  );
}
