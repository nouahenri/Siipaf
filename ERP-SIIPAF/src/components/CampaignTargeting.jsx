/**
 * Marketing & Communication › une campagne › Ciblage Meta et annonces : l'IA PROPOSE les paramètres de ciblage (zones, âges, langues,
 * centres d'intérêt immobilier, diaspora, audiences) et les textes d'annonce ; la responsable de la communication relit, ajuste et valide.
 * Rien n'est appliqué automatiquement dans Meta : on copie les paramètres et les textes dans le Gestionnaire de publicités.
 */
import { useState } from 'react';
import { Bot, Check, Send, X, Archive, Pencil, Megaphone } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Badge, Card, Empty, ErrorBox, Field, Skeleton } from '@admin/components/ui';
import { MK, CopyButton, OriginBadge, Warnings } from '../lib/marketing';

const TONES = { brouillon: '', a_valider: 'warn', valide: 'ok', refuse: 'danger', archive: '' };
const BUTTONS = { LEARN_MORE: 'En savoir plus', CONTACT_US: 'Nous contacter', SEND_MESSAGE: 'Envoyer un message', BOOK_TRAVEL: 'Réserver', GET_QUOTE: 'Demander un devis' };
const KINDS = { interaction: 'Audience d’interaction', centres_interet: 'Centres d’intérêt immobilier', similaire: 'Audience similaire' };
const list = a => (a || []).join(', ');

/** Texte à coller dans le Gestionnaire de publicités. */
function plainText(t) {
  const p = t.params;
  return [
    `Public : ${p.summary}`,
    `Zones : ${p.zones.map(z => z.label).join(', ')}`,
    `Âge : ${p.age_min} à ${p.age_max} ans · Langues : ${p.languages.join(', ')}`,
    `Centres d’intérêt : ${list(p.interests)}`,
    p.diaspora.enabled ? `Diaspora : ${list(p.diaspora.countries)}` : null,
    p.audiences.length ? `Audiences : ${p.audiences.map(a => `${KINDS[a.kind] || a.kind} — ${a.description}`).join(' | ')}` : null,
    p.exclusions.length ? `Exclusions : ${list(p.exclusions)}` : null,
    '',
    ...t.ads.map((a, i) => `Annonce ${i + 1}\nTitre : ${a.headline}\nTexte : ${a.primary_text}${a.description ? `\nDescription : ${a.description}` : ''}\nBouton : ${BUTTONS[a.cta_button] || a.cta_button}`),
  ].filter(l => l !== null).join('\n');
}

function Editor({ t, onCancel, onSave, busy }) {
  const [f, setF] = useState(() => ({
    summary: t.params.summary, zones: t.params.zones.map(z => z.label).join('\n'), age_min: t.params.age_min, age_max: t.params.age_max,
    interests: list(t.params.interests), diaspora: t.params.diaspora.enabled, countries: list(t.params.diaspora.countries), ads: t.ads.map(a => ({ ...a, description: a.description || '' })),
  }));
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const setAd = (i, k) => e => setF(v => ({ ...v, ads: v.ads.map((a, j) => (j === i ? { ...a, [k]: e.target.value } : a)) }));
  const submit = e => {
    e.preventDefault();
    const split = s => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    const kindOf = label => t.params.zones.find(z => z.label === label)?.kind || 'ville';
    onSave({
      params: {
        ...t.params, summary: f.summary, age_min: Number(f.age_min), age_max: Number(f.age_max), interests: split(f.interests),
        zones: split(f.zones.replace(/\n/g, ',')).map(label => ({ label, kind: kindOf(label), note: t.params.zones.find(z => z.label === label)?.note || null })),
        diaspora: { ...t.params.diaspora, enabled: f.diaspora, countries: f.diaspora ? split(f.countries) : [] },
      },
      ads: f.ads.map(a => ({ headline: a.headline, primary_text: a.primary_text, description: a.description || null, cta_button: a.cta_button })),
    });
  };
  return (
    <form className="form-grid" onSubmit={submit}>
      <Field label="Public visé" className="full"><textarea className="textarea" rows={2} required maxLength={400} value={f.summary} onChange={set('summary')} /></Field>
      <Field label="Zones (une par ligne)"><textarea className="textarea" rows={3} required value={f.zones} onChange={set('zones')} /></Field>
      <Field label="Centres d’intérêt (séparés par des virgules)"><textarea className="textarea" rows={3} required value={f.interests} onChange={set('interests')} /></Field>
      <Field label="Âge minimal"><input className="input" type="number" min={18} max={65} required value={f.age_min} onChange={set('age_min')} /></Field>
      <Field label="Âge maximal"><input className="input" type="number" min={18} max={65} required value={f.age_max} onChange={set('age_max')} /></Field>
      <Field label="Diaspora" className="full">
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.diaspora} onChange={e => setF(v => ({ ...v, diaspora: e.target.checked }))} />Cibler la diaspora</label>
        {f.diaspora && <input className="input" placeholder="Pays de résidence, séparés par des virgules" value={f.countries} onChange={set('countries')} />}
      </Field>
      {f.ads.map((a, i) => (
        <div key={i} className="full stack" style={{ gap: 6, borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 8 }}>
          <b className="small">Annonce {i + 1}</b>
          <Field label="Titre (40 caractères au plus)"><input className="input" required maxLength={40} value={a.headline} onChange={setAd(i, 'headline')} /></Field>
          <Field label="Texte principal (500 caractères au plus)"><textarea className="textarea" rows={3} required minLength={10} maxLength={500} value={a.primary_text} onChange={setAd(i, 'primary_text')} /></Field>
          <Field label="Description (facultative)"><input className="input" maxLength={60} value={a.description} onChange={setAd(i, 'description')} /></Field>
          <Field label="Bouton"><select className="select" value={a.cta_button} onChange={setAd(i, 'cta_button')}>{Object.entries(BUTTONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
      ))}
      <div className="full row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={busy}>Enregistrer (revient en brouillon)</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

function TargetingView({ t, campaignOpen, reload }) {
  const { can } = useAuth();
  const saved = useSaved();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const p = t.params;
  const run = async (call, message) => {
    setBusy(true); setError(null);
    try { await call(); await reload(); if (message) saved(message); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); }
  };
  const post = (action, body, message) => run(() => api.post(`${MK}/targetings/${t.id}/${action}`, body), message);
  const editable = campaignOpen && !['valide', 'archive'].includes(t.status);

  return (
    <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 12 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <b>Proposition n° {t.version_no}</b>
        <Badge tone={TONES[t.status]}>{t.status_label}</Badge>
        <OriginBadge origin={t.origin} />
        {t.validated_by_name && <span className="small muted">validé par {t.validated_by_name}</span>}
        <span style={{ flex: 1 }} />
        <CopyButton text={plainText(t)} label="Copier le ciblage et les annonces" />
      </div>
      <ErrorBox error={error} />
      <Warnings list={t.warnings} />
      {t.notes.length > 0 && <div className="alert" role="note"><ul style={{ margin: 0, paddingLeft: 18 }}>{t.notes.map(n => <li key={n} className="small">{n}</li>)}</ul></div>}
      {t.reject_reason && <p className="small" style={{ margin: 0 }}><b>Motif du refus :</b> {t.reject_reason}</p>}
      {editing ? <Editor t={t} busy={busy} onCancel={() => setEditing(false)} onSave={async body => { if (await run(() => api.patch(`${MK}/targetings/${t.id}`, body), 'Ciblage modifié')) setEditing(false); }} /> : (
        <>
          <dl className="mk-brief">
            <dt>Public</dt><dd>{p.summary}</dd>
            <dt>Zones</dt><dd>{p.zones.map(z => z.label).join(', ')}</dd>
            <dt>Âge et langues</dt><dd>{p.age_min} à {p.age_max} ans · {p.languages.join(', ')}</dd>
            <dt>Centres d’intérêt</dt><dd>{list(p.interests)}</dd>
            <dt>Diaspora</dt><dd>{p.diaspora.enabled ? list(p.diaspora.countries) || 'Oui' : 'Non'}{p.diaspora.note ? ` — ${p.diaspora.note}` : ''}</dd>
            {p.audiences.length > 0 && <><dt>Audiences</dt><dd><ul style={{ margin: 0, paddingLeft: 18 }}>{p.audiences.map(a => <li key={a.description}><b>{KINDS[a.kind] || a.kind}</b> : {a.description}</li>)}</ul></dd></>}
            {p.exclusions.length > 0 && <><dt>Exclusions</dt><dd>{list(p.exclusions)}</dd></>}
            {t.rationale && <><dt>Justification</dt><dd>{t.rationale}</dd></>}
          </dl>
          <div className="stack" style={{ gap: 8 }}>
            {t.ads.map((a, i) => (
              <article key={i} className="card"><div className="card-body stack" style={{ gap: 4 }}>
                <div className="row" style={{ gap: 6 }}><b>{a.headline}</b><Badge>{BUTTONS[a.cta_button] || a.cta_button}</Badge><span style={{ flex: 1 }} /><CopyButton text={`${a.headline}\n\n${a.primary_text}${a.description ? `\n\n${a.description}` : ''}`} label="Copier" /></div>
                <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.primary_text}</p>
                {a.description && <span className="small muted">{a.description}</span>}
              </div></article>
            ))}
          </div>
        </>
      )}
      {!editing && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {editable && can('marketing:generate') && <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}><Pencil />Modifier</button>}
          {t.status === 'brouillon' && can('marketing:generate') && campaignOpen && <button className="btn btn-sm" disabled={busy} onClick={() => post('submit', undefined, 'Ciblage soumis à validation')}><Send />Soumettre à validation</button>}
          {t.status === 'a_valider' && can('marketing:validate') && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => post('validate', undefined, 'Ciblage validé')}><Check />Valider</button>}
          {['a_valider', 'valide'].includes(t.status) && can('marketing:validate') && <button className="btn btn-sm" disabled={busy} onClick={() => setRejecting(rejecting === null ? '' : null)}><X />Refuser</button>}
          {t.status !== 'archive' && can('marketing:validate') && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => post('archive', undefined, 'Ciblage archivé')}><Archive />Archiver</button>}
        </div>
      )}
      {rejecting !== null && (
        <form className="row" style={{ gap: 8 }} onSubmit={async e => { e.preventDefault(); if (await post('reject', { reason: rejecting }, 'Ciblage refusé')) setRejecting(null); }}>
          <input className="input" required minLength={3} maxLength={500} placeholder="Motif du refus (l’IA en tient compte)" value={rejecting} onChange={e => setRejecting(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-sm" disabled={busy}>Refuser</button>
        </form>
      )}
    </div>
  );
}

export default function CampaignTargeting({ campaignId, campaignOpen, mode }) {
  const { can } = useAuth();
  const saved = useSaved();
  const res = useResource(`${MK}/campaigns/${campaignId}/targetings`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [demo, setDemo] = useState(false);
  const generate = async () => {
    setBusy(true); setError(null);
    try { const out = await api.post(`${MK}/campaigns/${campaignId}/targetings/generate`, demo ? { mode: 'demo' } : {}); await res.reload(); saved(`Ciblage ${out.mode === 'ia' ? 'préparé par l’IA' : 'de démonstration préparé'}`); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Ciblage Meta et annonces" actions={can('marketing:generate') && campaignOpen ? <span className="row" style={{ gap: 8 }}>
      <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={demo || mode === 'demo'} disabled={mode === 'demo'} onChange={e => setDemo(e.target.checked)} />Démonstration</label>
      <button className="btn btn-sm" disabled={busy} onClick={generate}><Bot />Faire proposer un ciblage</button></span> : null}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>L’IA propose les paramètres de ciblage et les textes d’annonce à partir du brief et des faits publiés ; la responsable de la communication les relit et les valide. Rien n’est envoyé automatiquement à Meta : copiez les paramètres dans le Gestionnaire de publicités. Aucune identité n’est collectée sur d’autres pages.</p>
        <ErrorBox error={error || res.error} />
        {!res.data ? <Skeleton h={80} /> : !res.data.length ? <Empty icon={Megaphone}>Aucun ciblage proposé pour le moment.</Empty> : res.data.map(t => <TargetingView key={t.id} t={t} campaignOpen={campaignOpen} reload={res.reload} />)}
      </div>
    </Card>
  );
}
