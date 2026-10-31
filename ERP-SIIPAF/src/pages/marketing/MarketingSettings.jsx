/**
 * Marketing & Communication › Réglages (Direction générale) : état de l'IA (clé présente ou non, jamais la clé), arrêt
 * d'urgence, modèle, plafond mensuel en FCFA et taux de conversion, préparation hebdomadaire, ton de la marque, mots interdits.
 * La clé se saisit dans server/.env (ANTHROPIC_API_KEY), jamais dans l'écran.
 * Plus bas : connecteurs Meta (identifiants, jetons chiffrés côté serveur, test de connexion, journal) et audiences hachées.
 */
import { useEffect, useState } from 'react';
import { Check, Siren, Play, KeyRound } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useSaved } from '@admin/lib/app-context';
import { Badge, Card, ErrorBox, Field, Skeleton } from '@admin/components/ui';
import { fcfa } from '@admin/lib/format';
import { MK } from '../../lib/marketing';
import MetaConnectors from '../../components/MetaConnectors';
import MetaAudiences from '../../components/MetaAudiences';

export default function MarketingSettings() {
  const saved = useSaved();
  const res = useResource(`${MK}/settings`);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = res.data;
  useEffect(() => {
    if (d) setF({
      ...Object.fromEntries(Object.entries(d.values).map(([k, v]) => [k, String(v)])),
      model: d.text.model, tone: d.text.tone, brand_notes: d.text.brand_notes, banned_words: d.text.banned_words.join(', '), channels: d.text.channels,
    });
  }, [d]);
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d || !f) return <Skeleton h={400} />;
  const u = d.usage;

  const groups = [];
  for (const [k, x] of Object.entries(d.fields)) {
    let g = groups.find(y => y.title === x.group);
    if (!g) groups.push(g = { title: x.group, fields: [] });
    g.fields.push([k, x]);
  }
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.put(`${MK}/settings`, {
        ...Object.fromEntries(Object.keys(d.fields).map(k => [k, Number(f[k])])),
        model: f.model, tone: f.tone, brand_notes: f.brand_notes, channels: f.channels,
        banned_words: f.banned_words.split(/[,\n]/).map(w => w.trim()).filter(Boolean),
      });
      await res.reload(); saved('Réglages enregistrés');
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const stop = async active => {
    setBusy(true); setError(null);
    try { await api.post(`${MK}/settings/emergency-stop`, { active }); await res.reload(); saved(active ? 'Arrêt d’urgence activé' : 'Arrêt d’urgence levé'); } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <Card title="État de l’IA">
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <KeyRound size={16} aria-hidden="true" />
            {d.key.present ? <b>Clé présente (…{d.key.last4})</b> : <b>Aucune clé enregistrée</b>}
            <Badge tone={u.mode === 'ia' ? 'ok' : ''}>{u.mode === 'ia' ? 'IA active' : 'Mode démonstration'}</Badge>
            {u.emergency_stop && <Badge tone="danger">Arrêt d’urgence</Badge>}
          </div>
          <p className="small muted" style={{ margin: 0 }}>La clé n’est jamais affichée ni enregistrée ici : elle se saisit sur le serveur (fichier server/.env, variable ANTHROPIC_API_KEY, par le script set-anthropic-key.ps1). {u.mode_reason}</p>
          <p className="small" style={{ margin: 0 }}>Dépense du mois : <b>{fcfa(u.spent_fcfa)}</b> sur {fcfa(u.cap_fcfa)} ({u.pct} %) · {u.calls} appel(s).</p>
          <div>
            {u.emergency_stop
              ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => stop(false)}><Play />Lever l’arrêt d’urgence</button>
              : <button type="button" className="btn" disabled={busy} onClick={() => stop(true)}><Siren />Arrêt d’urgence de l’IA</button>}
            <span className="small muted"> Suspend toute préparation (à la demande et chaque semaine) ; reprise à la levée.</span>
          </div>
        </div>
      </Card>

      <form className="stack" onSubmit={save}>
        <Card title="Modèle de l’IA">
          <div className="form-grid">
            <Field label="Modèle" className="full" hint="Sonnet convient à l’usage courant ; Opus rédige plus finement mais coûte davantage ; Haiku est le plus économique. Le plafond de dépense s’applique quel que soit le modèle.">
              <select className="select" value={f.model} onChange={set('model')}>{Object.entries(d.models).map(([k, m]) => <option key={k} value={k}>{m.label} — {m.in} $ / {m.out} $ par million de jetons (entrée / sortie)</option>)}</select>
            </Field>
          </div>
        </Card>

        {groups.map(g => (
          <Card key={g.title} title={g.title}>
            <div className="form-grid">
              {g.fields.map(([k, x]) => (
                <Field key={k} label={x.label} hint={`${x.hint} (de ${x.min.toLocaleString('fr-FR')} à ${x.max.toLocaleString('fr-FR')} ; par défaut ${x.default.toLocaleString('fr-FR')})`}>
                  <input className="input" type="number" required min={x.min} max={x.max} value={f[k]} onChange={set(k)} style={{ maxWidth: 180 }} />
                </Field>
              ))}
            </div>
          </Card>
        ))}

        <Card title="Marque et canaux">
          <div className="form-grid">
            <Field label="Ton de la marque" className="full" hint="Professionnel, clair, rassurant et précis par défaut ; précisez si besoin"><input className="input" maxLength={400} value={f.tone} onChange={set('tone')} /></Field>
            <Field label="Consignes de la marque" className="full" hint="Données données à l’IA (jamais des ordres de sécurité) : vocabulaire, formules à privilégier, sujets à éviter"><textarea className="textarea" rows={3} maxLength={1500} value={f.brand_notes} onChange={set('brand_notes')} /></Field>
            <Field label="Mots et expressions interdits" className="full" hint="Séparés par des virgules. Tout contenu qui en contient est bloqué avant validation."><input className="input" value={f.banned_words} onChange={set('banned_words')} /></Field>
            <Field label="Canaux proposés par défaut" className="full">
              <div className="chip-pick" role="group" aria-label="Canaux">
                {Object.entries(d.channels).map(([k, l]) => (
                  <button type="button" key={k} className={`chip-opt ${f.channels.includes(k) ? 'on' : ''}`} aria-pressed={f.channels.includes(k)}
                    onClick={() => setF(v => ({ ...v, channels: v.channels.includes(k) ? v.channels.filter(x => x !== k) : [...v.channels, k] }))}>{l}</button>
                ))}
              </div>
            </Field>
          </div>
        </Card>
        <div><button className="btn btn-primary" disabled={busy || !f.channels.length}><Check />Enregistrer les réglages</button></div>
      </form>

      <MetaConnectors />
      <MetaAudiences />
    </div>
  );
}
