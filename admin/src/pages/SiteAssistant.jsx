import { useEffect, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useResource, useSaved } from '../lib/app-context';
import { fcfa } from '../lib/format';
import { Card, Field, ErrorBox, Skeleton, Badge } from '../components/ui';
import { MediaPicker } from '../components/MediaLibrary';

const DAYS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Jeu'], [5, 'Ven'], [6, 'Sam'], [7, 'Dim']];
const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

/**
 * Onglet « Assistante du site » (Contenu du site) : réglages de Sita, la conseillère IA du site public — identité, accueil et ton,
 * activation et horaires, budget de l’IA. Le dashboard est l’outil de saisie ; le suivi des conversations est dans l’ERP
 * (Service commercial › Conversations de Sita). Les clés de l’IA (Claude, Gemini) restent dans server/.env : seule leur présence est affichée.
 */
export default function SiteAssistant() {
  const res = useResource('/admin/assistant');
  const saved = useSaved();
  const [form, setForm] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (res.data) { setForm(structuredClone(res.data.settings)); setPhoto(res.data.photo_url); }
  }, [res.data]);

  if (res.error) return <ErrorBox error={res.error} />;
  if (!res.data || !form) return <Skeleton h={400} />;
  const { defaults, meta, usage } = res.data;
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const num = (k, v) => set({ [k]: v === '' ? 0 : Number(v) });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.put('/admin/assistant', form);
      res.setData(data);
      saved('Assistante du site enregistrée');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const pct = usage.pct;
  return (
    <div className="stack">
      <ErrorBox error={error} />

      <Card title="Activation" actions={<Badge tone={form.enabled ? 'ok' : ''}>{form.enabled ? 'Active sur le site' : 'Désactivée'}</Badge>}>
        <div className="stack" style={{ gap: 12 }}>
          <label className="checkbox"><input type="checkbox" checked={form.enabled} onChange={e => set({ enabled: e.target.checked })} />Afficher {form.name || 'l’assistante'} sur le site public (bulle en bas à droite)</label>
          <Field label="Pages où la bulle apparaît">
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              {Object.entries(meta.pages).map(([id, label]) => (
                <label key={id} className="checkbox small"><input type="checkbox" checked={form.pages.includes(id)} onChange={() => set({ pages: toggle(form.pages, id) })} />{label}</label>
              ))}
            </div>
          </Field>
          <div className="form-grid">
            <Field label="Numéro WhatsApp de relais" hint={`Quand Sita passe la main. Laissez vide pour utiliser celui du site (actuellement ${meta.relay}). Format international, sans « + ».`}>
              <input className="input" inputMode="numeric" value={form.whatsapp_relay} onChange={e => set({ whatsapp_relay: e.target.value })} placeholder={meta.relay} />
            </Field>
            <Field label="Présence humaine (heure d’Abidjan)" hint="Annoncée au visiteur quand l’équipe doit le rappeler.">
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {DAYS.map(([d, l]) => <label key={d} className="checkbox small"><input type="checkbox" checked={form.human_hours.days.includes(d)} onChange={() => set({ human_hours: { ...form.human_hours, days: toggle(form.human_hours.days, d).sort() } })} />{l}</label>)}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <input className="input" style={{ maxWidth: 110 }} type="time" value={form.human_hours.from} onChange={e => set({ human_hours: { ...form.human_hours, from: e.target.value } })} aria-label="De" />
                <span>à</span>
                <input className="input" style={{ maxWidth: 110 }} type="time" value={form.human_hours.to} onChange={e => set({ human_hours: { ...form.human_hours, to: e.target.value } })} aria-label="À" />
              </div>
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Identité">
        <div className="form-grid">
          <Field label="Prénom de l’assistante"><input className="input" maxLength={30} value={form.name} onChange={e => set({ name: e.target.value })} /></Field>
          <Field label="Femme ou homme" hint="Les accords (« ravie », « conseillère ») suivent ce choix.">
            <select className="select" value={form.gender} onChange={e => set({ gender: e.target.value })}>
              {Object.entries(meta.genders).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Titre affiché" hint={`Vide : « ${form.gender === 'homme' ? 'Votre conseiller immobilier SIIPAF' : 'Votre conseillère immobilière SIIPAF'} ».`}>
            <input className="input" maxLength={80} value={form.title} onChange={e => set({ title: e.target.value })} placeholder={defaults.title} />
          </Field>
          <Field label="Photo ou avatar" hint="Choisie dans la médiathèque (image carrée). Sans photo, l’avatar du site s’affiche : la conseillère en veste noire et écharpe rouge, ou le conseiller en casquette rouge, selon le choix « Femme ou homme ».">
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="slide-thumb" style={{ width: 64, height: 64, borderRadius: '50%', backgroundImage: photo ? `url(${photo})` : undefined }} onClick={() => setPicker(true)} aria-label="Choisir la photo">{!photo && <ImagePlus />}</button>
              {photo && <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => { set({ photo_media_id: null }); setPhoto(null); }}><Trash2 />Retirer</button>}
            </div>
          </Field>
        </div>
        {picker && <MediaPicker selectedId={form.photo_media_id} onPick={m => { set({ photo_media_id: m.id }); setPhoto(`/uploads/by-id/${m.id}`); }} onClose={() => setPicker(false)} />}
      </Card>

      <Card title="Accueil et ton">
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Message d’accueil" hint="{nom} est remplacé par le prénom. Vide : message par défaut.">
            <textarea className="textarea" rows={3} maxLength={500} value={form.greeting} onChange={e => set({ greeting: e.target.value })} placeholder={defaults.greeting} />
          </Field>
          <div className="form-grid">
            <Field label="Invitation sur une page sans programme" hint="Petite bulle au-dessus du bouton, avec « Démarrer la conversation → ».">
              <input className="input" maxLength={220} value={form.invitation_default} onChange={e => set({ invitation_default: e.target.value })} placeholder={defaults.invitation_default} />
            </Field>
            <Field label="Invitation sur la page d’un programme" hint="{programme} est remplacé par le nom du programme consulté.">
              <input className="input" maxLength={220} value={form.invitation_programme} onChange={e => set({ invitation_programme: e.target.value })} placeholder={defaults.invitation_programme} />
            </Field>
            <Field label="Délai avant l’invitation (secondes)"><input className="input" style={{ maxWidth: 120 }} type="number" min="0" max="120" value={form.invitation_delay_s} onChange={e => num('invitation_delay_s', e.target.value)} /></Field>
            <Field label="Son à l’apparition" hint="Carillon discret, une fois par visite. Les navigateurs bloquent le son tant que le visiteur n’a ni cliqué ni touché la page : il est alors joué à son premier clic, si l’invitation est encore affichée.">
              <label className="checkbox"><input type="checkbox" checked={form.sound} onChange={e => set({ sound: e.target.checked })} />Jouer un carillon quand l’invitation de {form.name || 'Sita'} apparaît</label>
            </Field>
          </div>
          {!!meta.projects.length && (
            <Field label="Invitation propre à un programme (facultatif)" hint="Laissez vide pour utiliser l’invitation ci-dessus.">
              <div className="stack" style={{ gap: 6 }}>
                {meta.projects.map(p => (
                  <div key={p.slug} className="row" style={{ gap: 8 }}>
                    <span style={{ minWidth: 170 }}>{p.name}</span>
                    <input className="input" style={{ flex: 1 }} maxLength={220} value={form.invitations[p.slug] || ''} onChange={e => set({ invitations: { ...form.invitations, [p.slug]: e.target.value } })} />
                  </div>
                ))}
              </div>
            </Field>
          )}
          <div className="form-grid">
            <Field label="Ton">
              <select className="select" value={form.tone} onChange={e => set({ tone: e.target.value })}>
                {Object.entries(meta.tones).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Langues">
              <div className="row" style={{ gap: 14 }}>
                {Object.entries(meta.languages).map(([k, l]) => <label key={k} className="checkbox small"><input type="checkbox" checked={form.languages.includes(k)} disabled={k === 'fr'} onChange={() => set({ languages: toggle(form.languages, k) })} />{l}</label>)}
              </div>
            </Field>
          </div>
          <Field label="Consignes de la marque (facultatif)" hint="Précisions de style données à l’IA (ex. vouvoiement, expressions à privilégier). Elles ne peuvent pas lever les règles de sécurité : faits publiés uniquement, aucun prix inventé, aucune promesse de gain, aucune remise.">
            <textarea className="textarea" rows={2} maxLength={600} value={form.tone_notes} onChange={e => set({ tone_notes: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card title="Budget de l’IA" actions={<Badge tone={usage.mode === 'ia' ? 'ok' : 'warn'}>{usage.mode === 'ia' ? 'IA active' : 'Mode démonstration'}</Badge>}>
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{fcfa(usage.spent_fcfa)} dépensés ce mois-ci</strong>
              <span className="muted">plafond {fcfa(usage.cap_fcfa)} · {usage.calls} réponse(s) de l’IA · {usage.conversations} conversation(s)</span>
            </div>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" style={{ marginTop: 6 }}><div style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--danger, #c0392b)' : undefined }} /></div>
          </div>
          <div className="small muted stack" style={{ gap: 4 }}>
            {Object.entries(meta.providers).map(([p, label]) => (
              <span key={p}>
                <Badge tone={usage.keys[p].present ? 'ok' : undefined}>{label}</Badge>{' '}
                {usage.keys[p].present ? `clé présente sur le serveur (se terminant par ${usage.keys[p].last4})` : 'aucune clé sur le serveur'}
              </span>
            ))}
            <span>
              {usage.mode === 'ia'
                ? `Chaque clé est l’alternative de l’autre : le modèle choisi répond${usage.keys.anthropic.present && usage.keys.gemini.present ? ' et, s’il est en panne, l’autre IA prend le relais' : ''}.`
                : 'Sita répond en mode démonstration, à partir des faits publiés, sans aucun coût.'}
              {usage.mode_reason ? ` ${usage.mode_reason}` : ''} Les clés se règlent dans le fichier server/.env (ANTHROPIC_API_KEY, GEMINI_API_KEY) et n’apparaissent jamais ici.
            </span>
          </div>
          <div className="form-grid">
            <Field label="Plafond mensuel (FCFA)" hint="Au-delà, Sita ne répond plus avec l’IA : elle oriente les visiteurs vers l’équipe (WhatsApp). 0 bloque l’IA.">
              <input className="input" type="number" min="0" step="1000" value={form.cap_fcfa} onChange={e => num('cap_fcfa', e.target.value)} />
            </Field>
            <Field label="Modèle de l’IA" hint="Claude ou Gemini. Si la clé du modèle choisi manque, Sita prend le modèle par défaut de l’autre IA.">
              <select className="select" value={form.model} onChange={e => set({ model: e.target.value })}>
                {Object.entries(meta.providers).map(([p, label]) => (
                  <optgroup key={p} label={`${label}${usage.keys[p].present ? '' : ' — clé absente'}`}>
                    {Object.entries(meta.models).filter(([, m]) => m.provider === p).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Alerte à (% du plafond)" hint="La Direction générale est prévenue à ce seuil, puis au plafond.">
              <input className="input" type="number" min="10" max="100" value={form.alert_pct} onChange={e => num('alert_pct', e.target.value)} />
            </Field>
            <Field label="Taux dollar → FCFA" hint="Anthropic et Google facturent en dollars.">
              <input className="input" type="number" min="300" max="1500" value={form.usd_fcfa} onChange={e => num('usd_fcfa', e.target.value)} />
            </Field>
            <Field label="Longueur maximale d’une réponse (jetons)" hint="Borne le coût d’une réponse.">
              <input className="input" type="number" min="200" max="2000" step="100" value={form.max_output_tokens} onChange={e => num('max_output_tokens', e.target.value)} />
            </Field>
          </div>
          <label className="checkbox"><input type="checkbox" checked={form.emergency_stop} onChange={e => set({ emergency_stop: e.target.checked })} /><span><strong>Arrêt d’urgence</strong> : suspend l’IA de Sita tout de suite (elle répond alors en mode démonstration, sans coût).</span></label>
        </div>
      </Card>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}
