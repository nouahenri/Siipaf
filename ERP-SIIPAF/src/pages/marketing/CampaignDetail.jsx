/**
 * Marketing & Communication › une campagne : brief, concept proposé par l'IA, préparation du calendrier et des contenus,
 * contenus de la campagne, résultats (prospects, clients, ventes par canal), faits transmis à l'IA et journal.
 * Brief → faits → concept → calendrier → contenus : l'IA propose, la responsable de la communication valide, la Direction
 * générale valide la campagne.
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Bot, Send, Check, Archive, Sparkles, Plus, Pencil, Eye } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Badge, Card, Empty, ErrorBox, Field, Skeleton } from '@admin/components/ui';
import { dateTime, num } from '@admin/lib/format';
import { MK, CAMPAIGN_TONES, ModeBanner, fr } from '../../lib/marketing';
import { ContentCard, ContentDrawer } from '../../components/MarketingContent';
import CampaignTargeting from '../../components/CampaignTargeting';

const GEN_LABELS = { ok: 'Réussie', invalide: 'Sortie invalide', erreur: 'Erreur', refuse_plafond: 'Refusée (plafond)', en_cours: 'En cours' };

export default function CampaignDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const saved = useSaved();
  const res = useResource(`${MK}/campaigns/${id}`);
  const refs = useResource(`${MK}/refs`).data;
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [gen, setGen] = useState({ channels: null, weeks: 1, count: '', demo: false });
  const [editing, setEditing] = useState(null);
  const [manual, setManual] = useState(null);
  const [showFacts, setShowFacts] = useState(false);
  const c = res.data;
  const facts = useResource(showFacts && c ? `${MK}/facts${c.project_id ? `?project_id=${c.project_id}` : ''}` : null);
  useEffect(() => { if (refs && !gen.channels) setGen(g => ({ ...g, channels: refs.default_channels })); }, [refs, gen.channels]);
  if (res.error) return <ErrorBox error={res.error} />;
  if (!c || !refs || !gen.channels) return <Skeleton h={400} />;

  const run = async (call, message) => {
    setBusy(true); setError(null); setResult(null);
    try { const out = await call(); await res.reload(); if (message) saved(message); return out; } catch (e) { setError(e); return null; } finally { setBusy(false); }
  };
  const generate = async step => {
    const out = await run(() => api.post(`${MK}/campaigns/${id}/generate`, {
      step, ...(step === 'contenus' ? { channels: gen.channels, weeks: Number(gen.weeks), ...(gen.count ? { count: Number(gen.count) } : {}) } : {}), ...(gen.demo ? { mode: 'demo' } : {}),
    }));
    if (out) setResult(step === 'concept' ? 'Concept préparé.' : `${out.created.length} contenu(s) préparé(s) du ${fr(out.from)} au ${fr(out.to)} (${out.to_validate} à valider) — ${out.mode === 'ia' ? 'par l’IA' : 'gabarits de démonstration'}.`);
  };
  const toggleChannel = k => setGen(g => ({ ...g, channels: g.channels.includes(k) ? g.channels.filter(x => x !== k) : [...g.channels, k] }));
  const saveEdit = async e => {
    e.preventDefault();
    await run(() => api.patch(`${MK}/campaigns/${id}`, { name: editing.name, objective: editing.objective || null, cta_label: editing.cta_label || null, landing_path: editing.landing_path, starts_on: editing.starts_on || null, ends_on: editing.ends_on || null }), 'Campagne modifiée');
    setEditing(null);
  };
  const addManual = async e => {
    e.preventDefault();
    const out = await run(() => api.post(`${MK}/campaigns/${id}/contents`, { channel: manual.channel, title: manual.title, body: manual.body }), 'Brouillon créé');
    if (out) { setManual(null); setOpen(out.id); }
  };
  const perf = c.performance;
  const cc = c.concept;

  return (
    <div className="stack">
      <ModeBanner mode={refs.mode} reason={refs.mode_reason} />
      <div className="row-between">
        <div className="row" style={{ gap: 8 }}>
          <Link className="small" to="/marketing/campagnes">← Campagnes</Link>
          <Badge tone={CAMPAIGN_TONES[c.status]}>{c.status_label}</Badge>
          {c.permanent && <Badge>Ligne éditoriale permanente</Badge>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {c.status === 'brouillon' && can('marketing:generate') && <button className="btn" disabled={busy} onClick={() => run(() => api.post(`${MK}/campaigns/${id}/submit`), 'Campagne soumise à la Direction générale')}><Send />Soumettre à la Direction</button>}
          {['brouillon', 'a_valider'].includes(c.status) && can('marketing:settings') && <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.post(`${MK}/campaigns/${id}/validate`), 'Campagne validée')}><Check />Valider la campagne</button>}
          {c.status !== 'archivee' && can('marketing:settings') && <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.post(`${MK}/campaigns/${id}/archive`), 'Campagne archivée')}><Archive />Archiver</button>}
        </div>
      </div>
      <ErrorBox error={error} />
      {c.status !== 'validee' && c.status !== 'archivee' && <p className="small muted">Les contenus peuvent être préparés et validés, mais ne seront planifiables ou publiables qu’une fois la campagne validée par la Direction générale.</p>}

      <Card title={c.name} actions={can('marketing:generate') && c.status !== 'archivee' ? <button className="btn btn-ghost btn-sm" onClick={() => setEditing(editing ? null : { name: c.name, objective: c.objective || '', cta_label: c.cta_label || '', landing_path: c.landing_path, starts_on: c.starts_on || '', ends_on: c.ends_on || '' })}><Pencil />Modifier le brief</button> : null}>
        {editing ? (
          <form className="form-grid" onSubmit={saveEdit}>
            <Field label="Nom" className="full"><input className="input" required minLength={3} value={editing.name} onChange={e => setEditing(v => ({ ...v, name: e.target.value }))} /></Field>
            <Field label="Objectif" className="full"><textarea className="textarea" rows={2} value={editing.objective} onChange={e => setEditing(v => ({ ...v, objective: e.target.value }))} /></Field>
            <Field label="Appel à l’action"><input className="input" value={editing.cta_label} onChange={e => setEditing(v => ({ ...v, cta_label: e.target.value }))} /></Field>
            <Field label="Page du site visée"><input className="input" value={editing.landing_path} onChange={e => setEditing(v => ({ ...v, landing_path: e.target.value }))} /></Field>
            <Field label="Début"><input className="input" type="date" value={editing.starts_on} onChange={e => setEditing(v => ({ ...v, starts_on: e.target.value }))} /></Field>
            <Field label="Fin"><input className="input" type="date" value={editing.ends_on} onChange={e => setEditing(v => ({ ...v, ends_on: e.target.value }))} /></Field>
            <div className="full"><button className="btn btn-primary" disabled={busy}>Enregistrer</button>{c.status === 'validee' && !c.permanent && <span className="small muted"> Modifier le brief d’une campagne validée la renvoie à la Direction.</span>}</div>
          </form>
        ) : (
          <dl className="mk-brief">
            <dt>Segment</dt><dd>{c.segment_label}</dd>
            <dt>Objectif</dt><dd>{c.objective || '—'}</dd>
            <dt>Appel à l’action</dt><dd>{c.cta_label || '—'} · page {c.landing_path}</dd>
            <dt>Période</dt><dd>{c.starts_on || c.ends_on ? `${fr(c.starts_on)} → ${fr(c.ends_on)}` : 'Sans limite'}</dd>
            <dt>Code de suivi</dt><dd><code>utm_campaign={c.code}</code></dd>
          </dl>
        )}
      </Card>

      <Card title="Concept de campagne" actions={can('marketing:generate') && c.status !== 'archivee' ? <button className="btn btn-sm" disabled={busy} onClick={() => generate('concept')}><Bot />{cc ? 'Proposer un autre concept' : 'Faire proposer le concept'}</button> : null}>
        {!cc ? <Empty icon={Sparkles}>Pas encore de concept. L’IA le propose à partir du brief et des faits du catalogue.</Empty> : (
          <dl className="mk-brief">
            <dt>Angle</dt><dd>{cc.angle}</dd><dt>Message clé</dt><dd>{cc.key_message}</dd><dt>Public</dt><dd>{cc.audience}</dd>
            <dt>Preuves</dt><dd><ul style={{ margin: 0, paddingLeft: 18 }}>{cc.proof_points.map(p => <li key={p}>{p}</li>)}</ul></dd>
            <dt>Appel à l’action</dt><dd>{cc.cta}</dd>{cc.hashtags?.length > 0 && <><dt>Hashtags</dt><dd>{cc.hashtags.join(' ')}</dd></>}
          </dl>
        )}
      </Card>

      {can('marketing:generate') && c.status !== 'archivee' && (
        <Card title="Préparer le calendrier et les contenus">
          <div className="stack" style={{ gap: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>L’IA prépare aussi, seule, la semaine suivante chaque semaine pour les campagnes validées. Ici, vous pouvez lui demander des contenus tout de suite. Elle n’utilise que les faits du catalogue publié et ne publie jamais.</p>
            <div className="chip-pick" role="group" aria-label="Canaux">
              {Object.entries(refs.channels).map(([k, ch]) => <button type="button" key={k} className={`chip-opt ${gen.channels.includes(k) ? 'on' : ''}`} aria-pressed={gen.channels.includes(k)} onClick={() => toggleChannel(k)}>{ch.label}</button>)}
            </div>
            <div className="row" style={{ gap: 12 }}>
              <label className="row small" style={{ gap: 6 }}>Semaines<select className="select" style={{ width: 'auto' }} value={gen.weeks} onChange={e => setGen(g => ({ ...g, weeks: e.target.value }))}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
              <label className="row small" style={{ gap: 6 }}>Nombre de contenus<input className="input" type="number" min={1} max={30} placeholder="selon réglage" style={{ width: 120 }} value={gen.count} onChange={e => setGen(g => ({ ...g, count: e.target.value }))} /></label>
              <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={gen.demo} onChange={e => setGen(g => ({ ...g, demo: e.target.checked }))} />Mode démonstration (sans coût)</label>
              <button className="btn btn-primary" disabled={busy || !gen.channels.length} onClick={() => generate('contenus')}><Bot />Préparer les contenus</button>
              <button className="btn" onClick={() => setManual(manual ? null : { channel: gen.channels[0] || 'facebook', title: '', body: '' })}><Plus />Rédiger à la main</button>
            </div>
            {result && <p className="small" role="status" style={{ margin: 0 }}><b>{result}</b></p>}
            {manual && (
              <form className="form-grid" onSubmit={addManual}>
                <Field label="Canal"><select className="select" value={manual.channel} onChange={e => setManual(v => ({ ...v, channel: e.target.value }))}>{Object.entries(refs.channels).map(([k, ch]) => <option key={k} value={k}>{ch.label}</option>)}</select></Field>
                <Field label="Titre (interne)"><input className="input" required minLength={3} value={manual.title} onChange={e => setManual(v => ({ ...v, title: e.target.value }))} /></Field>
                <Field label="Texte" className="full"><textarea className="textarea" rows={4} required minLength={10} value={manual.body} onChange={e => setManual(v => ({ ...v, body: e.target.value }))} /></Field>
                <div className="full"><button className="btn btn-primary" disabled={busy}>Créer le brouillon</button></div>
              </form>
            )}
          </div>
        </Card>
      )}

      <div className="stack" style={{ gap: 12 }}>
        <h3 style={{ margin: 0 }}>Contenus de la campagne ({c.contents.length})</h3>
        {!c.contents.length ? <Empty icon={Sparkles}>Aucun contenu. Demandez à l’IA de préparer le calendrier ci-dessus.</Empty> : (
          <div className="mk-grid">{c.contents.map(x => <ContentCard key={x.id} c={x} refs={refs} showCampaign={false} onOpen={setOpen} />)}</div>
        )}
      </div>

      <CampaignTargeting campaignId={c.id} campaignOpen={c.status !== 'archivee'} mode={refs.mode} />

      <Card title="Résultats de la campagne">
        <div className="grid grid-3">
          <div><span className="small muted">Prospects</span><div className="kpi-value">{num(perf.prospects)}</div></div>
          <div><span className="small muted">Devenus clients</span><div className="kpi-value">{num(perf.clients)}</div></div>
          <div><span className="small muted">Dossiers de vente</span><div className="kpi-value">{num(perf.sales)}</div></div>
        </div>
        {perf.by_medium.length > 0 && <p className="small" style={{ marginBottom: 0 }}>Par canal : {perf.by_medium.map(m => `${m.medium} ${m.prospects}`).join(' · ')}</p>}
        <p className="small muted" style={{ marginBottom: 0 }}>Mesure par le lien suivi de chaque contenu (premier contact du visiteur, conservé 30 jours). Les visites ne sont pas comptées : seules les demandes reçues le sont.</p>
      </Card>

      <Card title="Faits transmis à l’IA" actions={<button className="btn btn-ghost btn-sm" onClick={() => setShowFacts(s => !s)}><Eye />{showFacts ? 'Masquer' : 'Voir'}</button>}>
        <p className="small muted" style={{ margin: 0 }}>Seulement des données publiques du catalogue : programmes publiés, offres et prix, lots comptés par statut, points d’avancement visibles par les clients, témoignages publiés (nom abrégé). Jamais de prospects, de clients, de ventes ni de montants encaissés.</p>
        {showFacts && (facts.data ? <pre className="mk-facts">{JSON.stringify(facts.data.facts, null, 2)}</pre> : <Skeleton h={120} />)}
      </Card>

      <Card title="Journal de la campagne" bodyClass="">
        <ul className="list">
          {c.generations.map(g => <li key={`g${g.id}`} className="list-row"><span>Préparation « {g.step_label} » — {g.mode === 'ia' ? `IA (${g.model})` : 'démonstration'} : {GEN_LABELS[g.status] || g.status}</span><span className="small muted nowrap">{dateTime(g.created_at)}</span></li>)}
          {c.events.map((e, i) => <li key={`e${i}`} className="list-row"><span>{e.note || e.action} {e.is_ai ? '(IA)' : e.user_name ? `· ${e.user_name}` : ''}</span><span className="small muted nowrap">{dateTime(e.created_at)}</span></li>)}
          {!c.generations.length && !c.events.length && <li className="list-row"><span className="muted">Rien pour l’instant.</span></li>}
        </ul>
      </Card>
      {open && <ContentDrawer id={open} onClose={() => setOpen(null)} onChanged={res.reload} />}
    </div>
  );
}
