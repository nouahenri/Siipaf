/**
 * Marketing & Communication › un contenu : la carte (copie en un clic) et la fiche (relire, ajuster, valider, planifier,
 * marquer publié). Aucune publication automatique : la responsable copie le texte et publie elle-même, puis le marque publié.
 */
import { useEffect, useState } from 'react';
import { Check, X, CalendarClock, Send, Bot, Archive, Mail, Save, History, Link2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Badge, Drawer, ErrorBox, Field, Skeleton } from '@admin/components/ui';
import { dateTime } from '@admin/lib/format';
import { MK, CopyButton, OriginBadge, Warnings, contentStatus, fullText, fr, frDay, todayIso, addDays } from '../lib/marketing';

const ACTIONS = { propose: 'Préparé', edit: 'Modifié', submit: 'Soumis', validate: 'Validé', reject: 'Refusé', schedule: 'Planifié', publish: 'Publié', archive: 'Archivé' };

export function ContentCard({ c, refs, onOpen, showCampaign = true }) {
  const label = refs?.channels?.[c.channel]?.label || c.channel_label;
  return (
    <article className="card mk-card">
      <div className="card-body stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6 }}>
          <Badge tone="brand">{label}</Badge>
          <span className="small muted">{c.kind_label}</span>
          {contentStatus(c, refs)}
          <OriginBadge origin={c.origin} />
          {c.warnings.length > 0 && <Badge tone="danger">{c.warnings.length} avertissement{c.warnings.length > 1 ? 's' : ''}</Badge>}
          <span className="spacer" style={{ flex: 1 }} />
          <span className="small muted nowrap">{c.scheduled_for ? frDay(c.scheduled_for) : 'Sans date'}</span>
        </div>
        <div>
          <b>{c.title}</b>
          {showCampaign && <div className="small muted">{c.campaign_name} · version {c.version_no}</div>}
        </div>
        <p className="small mk-excerpt">{c.body}</p>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => onOpen(c.id)}>Ouvrir</button>
          <CopyButton text={fullText(c)} label="Copier le texte" />
          <CopyButton text={c.link} label="Copier le lien suivi" />
        </div>
      </div>
    </article>
  );
}

export function ContentDrawer({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const res = useResource(`${MK}/contents/${id}`);
  const refs = useResource(`${MK}/refs`).data;
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null); // 'reject' | 'schedule' | 'publish' | 'regenerate'
  const [extra, setExtra] = useState({ reason: '', scheduled_for: addDays(todayIso(), 1), published_url: '', instruction: '', demo: false });
  const c = res.data;
  useEffect(() => {
    if (c) setF({ title: c.title, subject: c.subject || '', body: c.body, hashtags: (c.hashtags || []).join(' '), cta: c.cta || '', visual_idea: c.visual_idea || '', scheduled_for: c.scheduled_for || '' });
  }, [c]);
  if (res.error) return <Drawer title="Contenu" onClose={onClose}><ErrorBox error={res.error} /></Drawer>;
  if (!c || !f) return <Drawer title="Contenu" onClose={onClose}><Skeleton h={300} /></Drawer>;

  const limit = refs?.channels?.[c.channel]?.limit;
  const editable = can('marketing:generate') && !['publie', 'archive'].includes(c.status);
  const dirty = f.title !== c.title || f.subject !== (c.subject || '') || f.body !== c.body || f.hashtags !== (c.hashtags || []).join(' ') || f.cta !== (c.cta || '') || f.visual_idea !== (c.visual_idea || '') || f.scheduled_for !== (c.scheduled_for || '');

  const act = async (call, message) => {
    setBusy(true); setError(null);
    try { const out = await call(); await res.reload(); onChanged?.(); setPanel(null); saved(message); return out; } catch (e) { setError(e); return null; } finally { setBusy(false); }
  };
  const post = (path, body, message) => act(() => api.post(`${MK}/contents/${id}/${path}`, body || {}), message);
  const save = () => act(() => api.patch(`${MK}/contents/${id}`, {
    title: f.title, body: f.body, subject: f.subject || null, cta: f.cta || null, visual_idea: f.visual_idea || null, scheduled_for: f.scheduled_for || null,
    hashtags: f.hashtags.split(/[\s,]+/).filter(Boolean),
  }), c.status === 'valide' || c.status === 'planifie' ? 'Nouvelle version enregistrée : à valider de nouveau' : 'Enregistré');
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const warnings = error?.details?.warnings;

  return (
    <Drawer title={c.title} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          <Badge tone="brand">{c.channel_label}</Badge>{contentStatus(c, refs)}<OriginBadge origin={c.origin} />
          <span className="small muted">version {c.version_no} · campagne « {c.campaign_name} »</span>
        </div>
        {c.reject_reason && c.status === 'brouillon' && <div className="alert" role="alert"><b>Refusé :</b> {c.reject_reason}</div>}
        <Warnings list={warnings || c.warnings} />
        {error && !warnings && <ErrorBox error={error} />}
        {c.campaign_status !== 'validee' && <p className="small muted">La campagne n’est pas encore validée par la Direction générale : ce contenu pourra être validé mais pas planifié ni marqué publié.</p>}

        <div className="form-grid">
          <Field label="Titre (interne)" className="full"><input className="input" disabled={!editable} value={f.title} onChange={set('title')} maxLength={200} /></Field>
          {c.channel === 'email' && <Field label="Objet de l’e-mail" className="full"><input className="input" disabled={!editable} value={f.subject} onChange={set('subject')} maxLength={200} /></Field>}
          <Field label="Texte à publier" className="full" hint={`${f.body.length}${limit ? ` / ${limit} caractères usuels` : ''}${c.status === 'valide' || c.status === 'planifie' ? ' — modifier un contenu validé crée une nouvelle version et le remet à valider' : ''}`}>
            <textarea className="textarea" rows={9} disabled={!editable} value={f.body} onChange={set('body')} maxLength={4000} />
          </Field>
          <Field label="Hashtags" hint="Séparés par des espaces"><input className="input" disabled={!editable} value={f.hashtags} onChange={set('hashtags')} /></Field>
          <Field label="Appel à l’action"><input className="input" disabled={!editable} value={f.cta} onChange={set('cta')} maxLength={200} /></Field>
          <Field label="Idée de visuel" className="full" hint="À partir de visuels déjà approuvés (photos de chantier publiées, plan de masse, illustrations)"><textarea className="textarea" rows={2} disabled={!editable} value={f.visual_idea} onChange={set('visual_idea')} maxLength={800} /></Field>
          <Field label="Jour prévu"><input className="input" type="date" disabled={!editable} value={f.scheduled_for} onChange={set('scheduled_for')} /></Field>
          <Field label="Lien suivi (prospects mesurés par campagne)"><div className="row" style={{ gap: 4 }}><input className="input" readOnly value={c.link} style={{ flex: 1 }} /><CopyButton text={c.link} label="Copier" /></div></Field>
        </div>

        <div className="row" style={{ gap: 8 }}>
          {editable && <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}><Save />Enregistrer</button>}
          <CopyButton text={fullText({ ...c, body: f.body })} label="Copier le texte" small={false} />
          {c.status === 'brouillon' && can('marketing:generate') && <button className="btn" disabled={busy || dirty} onClick={() => post('submit', null, 'Soumis à validation')}><Send />Soumettre à validation</button>}
          {c.status === 'a_valider' && can('marketing:validate') && <button className="btn btn-primary" disabled={busy || dirty} onClick={() => post('validate', null, 'Contenu validé')}><Check />Valider</button>}
          {['a_valider', 'valide'].includes(c.status) && can('marketing:validate') && <button className="btn" onClick={() => setPanel(panel === 'reject' ? null : 'reject')}><X />Refuser</button>}
          {['valide', 'planifie'].includes(c.status) && can('marketing:validate') && <button className="btn" onClick={() => setPanel(panel === 'schedule' ? null : 'schedule')}><CalendarClock />{c.status === 'planifie' ? 'Replanifier' : 'Marquer planifié'}</button>}
          {['valide', 'planifie'].includes(c.status) && can('marketing:validate') && <button className="btn btn-primary" onClick={() => setPanel(panel === 'publish' ? null : 'publish')}><Check />Marquer publié</button>}
        </div>
        {dirty && editable && <p className="small muted">Enregistrez vos modifications avant de soumettre ou de valider.</p>}

        {panel === 'reject' && (
          <div className="card"><div className="card-body stack">
            <Field label="Motif du refus (transmis au proposant et à l’IA pour la suite)"><textarea className="textarea" rows={2} value={extra.reason} onChange={e => setExtra(v => ({ ...v, reason: e.target.value }))} maxLength={500} /></Field>
            <div><button className="btn btn-primary" disabled={busy || extra.reason.trim().length < 3} onClick={() => post('reject', { reason: extra.reason.trim() }, 'Contenu refusé')}>Refuser le contenu</button></div>
          </div></div>
        )}
        {panel === 'schedule' && (
          <div className="card"><div className="card-body stack">
            <Field label="Jour de publication prévu" hint="Rien n’est publié automatiquement : vous publiez à la main ou dans votre outil, puis vous marquez le contenu publié."><input className="input" type="date" value={extra.scheduled_for} onChange={e => setExtra(v => ({ ...v, scheduled_for: e.target.value }))} /></Field>
            <div><button className="btn btn-primary" disabled={busy || !extra.scheduled_for} onClick={() => post('schedule', { scheduled_for: extra.scheduled_for }, 'Contenu planifié')}>Planifier le {fr(extra.scheduled_for)}</button></div>
          </div></div>
        )}
        {panel === 'publish' && (
          <div className="card"><div className="card-body stack">
            <Field label="Adresse de la publication (facultatif)"><input className="input" type="url" placeholder="https://www.facebook.com/…" value={extra.published_url} onChange={e => setExtra(v => ({ ...v, published_url: e.target.value }))} /></Field>
            <div><button className="btn btn-primary" disabled={busy} onClick={() => post('publish', { published_url: extra.published_url || null }, 'Contenu marqué publié')}>Confirmer : publié</button></div>
          </div></div>
        )}

        {editable && can('marketing:generate') && (
          <div className="card"><div className="card-body stack">
            <b className="row" style={{ gap: 6 }}><Bot size={16} aria-hidden="true" />Demander une autre version à l’IA</b>
            <input className="input" placeholder="Consigne (ex. plus court, mettre en avant la livraison, ton plus chaleureux)" value={extra.instruction} onChange={e => setExtra(v => ({ ...v, instruction: e.target.value }))} maxLength={500} />
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={extra.demo} onChange={e => setExtra(v => ({ ...v, demo: e.target.checked }))} />Mode démonstration (gabarit, sans coût)</label>
            <div><button className="btn" disabled={busy} onClick={() => post('regenerate', { instruction: extra.instruction || undefined, mode: extra.demo ? 'demo' : undefined }, 'Nouvelle version préparée')}><Bot />Générer une nouvelle version</button></div>
          </div></div>
        )}

        <div className="row" style={{ gap: 8 }}>
          {c.channel === 'email' && ['valide', 'planifie', 'publie'].includes(c.status) && can('marketing:generate') && can('newsletter:campaigns') && (
            <button className="btn" disabled={busy} onClick={async () => { const out = await post('newsletter', null, 'Brouillon de newsletter créé'); if (out) toast(`Brouillon n° ${out.newsletter_id} créé dans la Newsletter du dashboard (l’envoi s’y fait, avec désinscription).`); }}><Mail />Créer le brouillon de newsletter</button>
          )}
          {can('marketing:validate') && c.status !== 'archive' && <button className="btn btn-ghost" disabled={busy} onClick={() => post('archive', null, 'Contenu archivé')}><Archive />Archiver</button>}
        </div>

        <details>
          <summary className="row" style={{ cursor: 'pointer', gap: 6 }}><History size={16} aria-hidden="true" /><b>Versions ({c.versions.length}) et journal</b></summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {c.versions.map(v => (
              <div key={v.id} className="card"><div className="card-body stack" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 6 }}><b>Version {v.version_no}</b><OriginBadge origin={v.origin} /><span className="small muted">{dateTime(v.created_at)}{v.edited_by_name ? ` · ${v.edited_by_name}` : ''}</span></div>
                <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{v.body}</p>
              </div></div>
            ))}
            <ul className="list">
              {c.events.map((e, i) => (
                <li key={i} className="list-row"><span><b>{ACTIONS[e.action] || e.action}</b> {e.is_ai ? 'par l’IA' : e.user_name ? `par ${e.user_name}` : ''}{e.note ? ` — ${e.note}` : ''}</span><span className="small muted nowrap">{dateTime(e.created_at)}</span></li>
              ))}
            </ul>
          </div>
        </details>
        <p className="small muted row" style={{ gap: 6 }}><Link2 size={14} aria-hidden="true" />Les demandes issues de ce lien portent la campagne : le Service commercial les voit dans « Prospects par campagne ».</p>
      </div>
    </Drawer>
  );
}
