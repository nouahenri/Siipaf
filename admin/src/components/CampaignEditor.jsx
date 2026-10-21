/** Newsletter : rédaction d'une campagne (aperçu réel de l'e-mail), e-mail de test, lancement et suivi de l'envoi. */
import { useEffect, useState } from 'react';
import { ArrowLeft, Copy, ImagePlus, Pause, Play, Send, Trash2, X, Ban, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Card, Field, Badge, ErrorBox, Skeleton, Modal } from './ui';
import { MediaPicker } from './MediaLibrary';
import { dateTime, num } from '../lib/format';

export const CAMPAIGN_TONES = { brouillon: '', en_cours: 'brand', pause: 'warn', envoyee: 'ok', annulee: 'danger' };
const FIELDS = ['subject', 'preheader', 'heading', 'body', 'image_media_id', 'cta_label', 'cta_url'];
const pick = c => Object.fromEntries(FIELDS.map(k => [k, c[k] ?? (k === 'image_media_id' ? null : '')]));

export function CampaignProgress({ c, wide }) {
  const pct = c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;
  return (
    <div className={`advance ${wide ? 'advance-wide' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Avancement de l’envoi">
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>
      <span className="small tabular">{num(c.sent)} / {num(c.total)}</span>
    </div>
  );
}

export default function CampaignEditor({ id, statuses, onBack, onChanged }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const res = useResource(`/admin/newsletter/campaigns/${id}`);
  const c = res.data;
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null); // dernière version enregistrée (pour savoir s'il reste des changements)
  const [busy, setBusy] = useState('');
  const [picker, setPicker] = useState(false);
  const [image, setImage] = useState(null);
  const [testTo, setTestTo] = useState(user?.email || '');
  const [confirm, setConfirm] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    if (!c) return;
    if (!form || c.id !== form._id) { const f = { ...pick(c), _id: c.id }; setForm(f); setSaved(f); }
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suivi de l'envoi : rafraîchi toutes les 10 secondes tant qu'il tourne
  const live = c?.status === 'en_cours';
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => res.reload(), 10000);
    return () => clearInterval(t);
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  if (res.error) return <ErrorBox error={res.error} />;
  if (!c || !form) return <Skeleton h={400} />;

  const draft = c.status === 'brouillon';
  const editable = draft && can('newsletter:write');
  const dirty = FIELDS.some(k => (form[k] ?? '') !== (saved[k] ?? ''));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const call = async (key, fn, ok) => {
    setBusy(key);
    try { const out = await fn(); if (ok) toast(ok); return out; } catch (e) { toast(e.message, 'err'); return null; } finally { setBusy(''); }
  };
  const save = async () => {
    const body = { ...pick(form) };
    for (const k of ['preheader', 'heading', 'cta_label', 'cta_url']) body[k] = body[k] || null;
    const out = await call('save', () => api.patch(`/admin/newsletter/campaigns/${id}`, body), 'Campagne enregistrée');
    if (out) { res.setData(out); const f = { ...pick(out), _id: out.id }; setForm(f); setSaved(f); setPreviewKey(k => k + 1); onChanged(); }
    return out;
  };
  const sendTest = async () => {
    if (dirty && !(await save())) return;
    const out = await call('test', () => api.post(`/admin/newsletter/campaigns/${id}/test`, { to: testTo }));
    if (out) toast(`E-mail de test envoyé à ${testTo}`);
  };
  const launch = async () => {
    const out = await call('launch', () => api.post(`/admin/newsletter/campaigns/${id}/launch`), null);
    if (out) { setConfirm(false); res.setData(out.campaign); onChanged(); toast(`Envoi lancé vers ${num(out.total)} abonnés`); }
  };
  const action = async (a, ok) => {
    if (a === 'cancel' && !window.confirm('Annuler l’envoi ? Les abonnés qui ne l’ont pas encore reçue ne la recevront pas.')) return;
    const out = await call(a, () => api.post(`/admin/newsletter/campaigns/${id}/${a}`), ok);
    if (out) { res.setData(out); onChanged(); }
  };
  const duplicate = async () => {
    const out = await call('dup', () => api.post(`/admin/newsletter/campaigns/${id}/duplicate`), 'Campagne dupliquée');
    if (out) { onChanged(); onBack(out.id); }
  };
  const remove = async () => {
    if (!window.confirm(`Supprimer la campagne « ${c.subject} » ?`)) return;
    const out = await call('del', () => api.del(`/admin/newsletter/campaigns/${id}`), 'Campagne supprimée');
    if (out) { onChanged(); onBack(null); }
  };

  const counts = c.counts || {};
  const imageName = image?.id === form.image_media_id ? image.original_name || image.filename : (form.image_media_id === c.image_media_id ? c.image_name || c.image_filename : null);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <button className="btn btn-ghost" onClick={() => (dirty && !window.confirm('Des modifications ne sont pas enregistrées : quitter quand même ?') ? null : onBack(null))}><ArrowLeft />Campagnes</button>
          <Badge tone={CAMPAIGN_TONES[c.status]}>{statuses?.[c.status] || c.status}</Badge>
        </div>
        <div className="row">
          {can('newsletter:write') && <button className="btn btn-ghost" onClick={duplicate} disabled={!!busy}><Copy />Dupliquer</button>}
          {can('newsletter:write') && ['brouillon', 'annulee'].includes(c.status) && <button className="btn btn-ghost" onClick={remove} disabled={!!busy}><Trash2 />Supprimer</button>}
          {editable && <button className="btn" onClick={save} disabled={!dirty || !!busy}><Save />{busy === 'save' ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}</button>}
        </div>
      </div>

      {!draft && (
        <Card title="Envoi" actions={can('newsletter:send') && (
          <div className="row">
            {c.status === 'en_cours' && <button className="btn btn-sm" onClick={() => action('pause', 'Envoi suspendu')} disabled={!!busy}><Pause />Suspendre</button>}
            {c.status === 'pause' && <button className="btn btn-sm btn-primary" onClick={() => action('resume', 'Envoi repris')} disabled={!!busy}><Play />Reprendre</button>}
            {['en_cours', 'pause'].includes(c.status) && <button className="btn btn-sm btn-ghost" onClick={() => action('cancel', 'Envoi annulé')} disabled={!!busy}><Ban />Annuler l’envoi</button>}
          </div>
        )}>
          <CampaignProgress c={c} wide />
          <div className="grid grid-4" style={{ marginTop: 16 }}>
            <Stat label="Envoyés" value={num(counts.envoye || 0)} />
            <Stat label="En attente" value={num((counts.en_attente || 0) + (counts.envoi || 0))} hint={c.eta_minutes ? `fin estimée dans ${c.eta_minutes < 60 ? `${c.eta_minutes} min` : `${Math.round(c.eta_minutes / 6) / 10} h`}` : null} />
            <Stat label="Échecs" value={num(counts.echec || 0)} />
            <Stat label="Ignorés" value={num(counts.ignore || 0)} hint="désinscrits pendant l’envoi" />
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            Lancée {dateTime(c.started_at)}{c.launched_by_name ? ` par ${c.launched_by_name}` : ''}{c.finished_at ? ` · terminée ${dateTime(c.finished_at)}` : ''}.
            {c.status === 'en_cours' && ' Les e-mails partent petit à petit pour respecter les limites de l’hébergeur ; vous pouvez fermer cette page.'}
          </p>
          {c.last_error && c.status === 'pause' && <div className="alert" style={{ marginTop: 12 }}>{c.last_error}</div>}
          {!!c.failures?.length && (
            <details style={{ marginTop: 12 }}>
              <summary className="small">Adresses en échec ({c.failures.length}{c.failures.length === 50 ? ' dernières' : ''})</summary>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>E-mail</th><th>Erreur</th><th>Le</th></tr></thead>
                <tbody>{c.failures.map(f => <tr key={f.email}><td>{f.email}</td><td className="small muted">{f.error}</td><td className="small muted">{dateTime(f.sent_at)}</td></tr>)}</tbody>
              </table></div>
            </details>
          )}
        </Card>
      )}

      <div className="grid campaign-grid">
        <Card title={editable ? 'Rédaction' : 'Contenu'}>
          <fieldset disabled={!editable} className="form-grid" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <Field label="Objet de l’e-mail" className="full"><input className="input" value={form.subject} maxLength={160} onChange={e => set('subject', e.target.value)} /></Field>
            <Field label="Texte d’aperçu" hint="Affiché après l’objet dans la boîte de réception" className="full"><input className="input" value={form.preheader} maxLength={200} onChange={e => set('preheader', e.target.value)} /></Field>
            <Field label="Titre" className="full"><input className="input" value={form.heading} maxLength={200} onChange={e => set('heading', e.target.value)} /></Field>
            <Field label="Image" className="full">
              {editable ? (
                <div className="row">
                  <button type="button" className="btn btn-sm" onClick={() => setPicker(true)}><ImagePlus />{form.image_media_id ? 'Changer l’image' : 'Choisir dans la médiathèque'}</button>
                  {form.image_media_id && <><span className="small muted">{imageName || 'Image choisie'}</span><button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label="Retirer l’image" onClick={() => set('image_media_id', null)}><X /></button></>}
                </div>
              ) : <span className="small muted">{form.image_media_id ? imageName || 'Image choisie' : 'Aucune'}</span>}
            </Field>
            <Field label="Message" className="full" hint={editable ? 'Ligne vide = nouveau paragraphe · **gras** · [texte du lien](https://…) · une ligne commençant par « - » = liste' : null}>
              <textarea className="textarea" rows={12} value={form.body} maxLength={20000} onChange={e => set('body', e.target.value)} />
            </Field>
            <Field label="Texte du bouton"><input className="input" value={form.cta_label} maxLength={60} placeholder="Ex. Découvrir le programme" onChange={e => set('cta_label', e.target.value)} /></Field>
            <Field label="Lien du bouton"><input className="input" value={form.cta_url} maxLength={500} placeholder="https://siipaf.com/…" onChange={e => set('cta_url', e.target.value)} /></Field>
          </fieldset>

          {editable && (
            <div className="stack" style={{ marginTop: 20, gap: 12 }}>
              <div className="row">
                <input className="input" style={{ flex: '1 1 220px' }} type="email" value={testTo} onChange={e => setTestTo(e.target.value)} aria-label="Adresse de l’e-mail de test" />
                <button className="btn" onClick={sendTest} disabled={!testTo || !!busy}><Send />{busy === 'test' ? 'Envoi…' : 'Envoyer un test'}</button>
              </div>
              {can('newsletter:send') && (
                <button className="btn btn-primary" onClick={async () => { if (!dirty || (await save())) setConfirm(true); }} disabled={!!busy}>
                  <Send />Envoyer à tous les abonnés ({num(c.active_subscribers)})
                </button>
              )}
            </div>
          )}
        </Card>

        <Card title="Aperçu" bodyClass="">
          <iframe key={previewKey} className="campaign-preview" title="Aperçu de l’e-mail" src={`/api/admin/newsletter/campaigns/${id}/preview?v=${previewKey}`} />
          {dirty && <p className="small muted card-body" style={{ paddingTop: 8 }}>Enregistrez pour mettre l’aperçu à jour.</p>}
        </Card>
      </div>

      {picker && <MediaPicker selectedId={form.image_media_id} onPick={m => { setImage(m); set('image_media_id', m.id); }} onClose={() => setPicker(false)} />}
      {confirm && (
        <Modal title="Envoyer la campagne" onClose={() => setConfirm(false)} footer={(
          <><button className="btn btn-ghost" onClick={() => setConfirm(false)}>Retour</button>
            <button className="btn btn-primary" onClick={launch} disabled={!!busy}><Send />{busy === 'launch' ? 'Lancement…' : `Envoyer à ${num(c.active_subscribers)} abonnés`}</button></>
        )}>
          <p>« <strong>{form.subject}</strong> » va partir vers les <strong>{num(c.active_subscribers)}</strong> abonnés actifs.</p>
          <p className="small muted" style={{ marginTop: 8 }}>Une fois lancée, la campagne ne se modifie plus. L’envoi se fait par petits lots (réglage « Débit d’envoi ») et peut être suspendu à tout moment. Pensez à vous envoyer un test avant.</p>
        </Modal>
      )}
    </div>
  );
}

const Stat = ({ label, value, hint }) => (
  <div><div className="small muted">{label}</div><div className="tabular" style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>{hint && <div className="small muted">{hint}</div>}</div>
);
