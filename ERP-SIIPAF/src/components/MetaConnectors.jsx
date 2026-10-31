/**
 * Marketing › Réglages › Connecteurs Meta (Direction générale, droit marketing:settings).
 * Canaux officiels de Meta uniquement (formulaires de publicité, messages et commentaires de la page, pixel, audiences) : aucune
 * identité n'est collectée sur d'autres pages. Tant que rien n'est saisi, tout reste « non connecté » et le site fonctionne normalement.
 * Les secrets sont chiffrés sur le serveur et ne reviennent JAMAIS ici : « présent …4 derniers caractères » seulement ; laisser un
 * champ vide conserve la valeur enregistrée.
 */
import { useEffect, useState } from 'react';
import { Check, PlugZap, RefreshCw, Link2, Wand2, Trash2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useSaved } from '@admin/lib/app-context';
import { Badge, Card, ErrorBox, Field, Skeleton } from '@admin/components/ui';
import { dateTime } from '@admin/lib/format';
import { MK, CopyButton } from '../lib/marketing';

const STATE = { non_configure: ['À brancher', ''], a_tester: ['Renseigné, à tester', 'warn'], ok: ['Connecté', 'ok'], erreur: ['Erreur', 'danger'] };
const EVENT_TONES = { ok: 'ok', ignore: '', erreur: 'danger', recu: 'warn' };

const randomToken = () => {
  const a = new Uint8Array(24);
  window.crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
};

export default function MetaConnectors() {
  const saved = useSaved();
  const res = useResource(`${MK}/meta/settings`);
  const events = useResource(`${MK}/meta/events?limit=20`);
  const [f, setF] = useState(null);
  const [secrets, setSecrets] = useState({});
  const [clear, setClear] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const d = res.data;
  useEffect(() => {
    if (d) { setF({ ...d.values, comment_reply_max_per_hour: String(d.values.comment_reply_max_per_hour) }); setSecrets({}); setClear({}); }
  }, [d]);
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d || !f) return <Skeleton h={300} />;

  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const flag = k => e => setF(v => ({ ...v, [k]: e.target.checked }));
  const act = async (call, message) => {
    setBusy(true); setError(null);
    try { const out = await call(); await res.reload(); await events.reload(); if (message) saved(message); return out; } catch (err) { setError(err); return null; } finally { setBusy(false); }
  };
  const save = e => {
    e.preventDefault();
    const body = {
      app_id: f.app_id, page_id: f.page_id, instagram_id: f.instagram_id, ad_account_id: f.ad_account_id, pixel_id: f.pixel_id, graph_version: f.graph_version,
      comment_reply_text: f.comment_reply_text, comment_reply_max_per_hour: Number(f.comment_reply_max_per_hour),
      ...Object.fromEntries(Object.keys(d.labels.flags).map(k => [k, !!f[k]])),
    };
    for (const k of Object.keys(d.labels.secrets)) {
      if (clear[k]) body[k] = null;
      else if (secrets[k]) body[k] = secrets[k].trim();
    }
    act(() => api.put(`${MK}/meta/settings`, body), 'Connecteurs Meta enregistrés');
  };
  const test = () => act(() => api.post(`${MK}/meta/test`), 'Test de connexion terminé');
  const subscribe = () => act(() => api.post(`${MK}/meta/subscribe`), 'Page abonnée aux événements');

  return (
    <Card title="Connecteurs Meta (Facebook, Instagram, publicités)" actions={<span className="row" style={{ gap: 8 }}>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={test}><PlugZap />Tester la connexion</button></span>}>
      <div className="stack" style={{ gap: 14 }}>
        {!d.connected && (
          <div className="callout-erp"><PlugZap aria-hidden="true" /><span className="small"><b>Non connecté.</b> Rien n’est encore branché à Meta : le site, Sita et le Marketing fonctionnent normalement. Dès que les identifiants ci-dessous sont saisis puis testés, les formulaires de publicité, les messages et commentaires de la page, le pixel et les audiences s’activent. Seuls les canaux officiels de Meta sont utilisés : aucune identité n’est collectée sur d’autres pages.</span></div>
        )}
        <ErrorBox error={error} />
        {d.last_error && <div className="alert" role="alert"><b>Dernière erreur ({d.last_error.where}) :</b> {d.last_error.message} <span className="small muted">— {dateTime(d.last_error.at)}</span></div>}

        <ul className="list">
          {d.connectors.map(c => (
            <li key={c.key} className="list-row" style={{ alignItems: 'flex-start' }}>
              <span style={{ minWidth: 0, flex: 1 }}><strong>{c.label}</strong><span className="small muted" style={{ display: 'block' }}>{c.used_for}</span>{c.detail && <span className="small" style={{ display: 'block' }}>{c.detail}</span>}</span>
              <Badge tone={STATE[c.state][1]}>{STATE[c.state][0]}</Badge>
            </li>
          ))}
        </ul>
        {d.last_test && <p className="small muted" style={{ margin: 0 }}>Dernier test : {dateTime(d.last_test.at)}</p>}

        <form className="stack" onSubmit={save} style={{ gap: 14 }}>
          <div className="form-grid">
            {Object.entries(d.labels.ids).map(([k, l]) => (
              <Field key={k} label={l} hint={k === 'ad_account_id' ? 'Avec ou sans « act_ »' : undefined}><input className="input" inputMode="numeric" pattern="\d*" maxLength={30} value={f[k]} onChange={set(k)} autoComplete="off" /></Field>
            ))}
            {Object.entries(d.labels.secrets).map(([k, l]) => {
              const s = d.secrets[k];
              return (
                <Field key={k} label={l} className={k === 'page_token' ? 'full' : ''} hint={s.unreadable ? 'Valeur enregistrée illisible (clé de chiffrement changée) : saisissez-la de nouveau.' : s.present ? `Présent …${s.last4} — laissez vide pour conserver` : 'Non renseigné'}>
                  <span className="row" style={{ gap: 6 }}>
                    <input className="input" type="password" autoComplete="new-password" spellCheck="false" disabled={!!clear[k]} placeholder={s.present ? `…${s.last4}` : ''} value={secrets[k] || ''} onChange={e => setSecrets(v => ({ ...v, [k]: e.target.value }))} />
                    {k === 'verify_token' && <button type="button" className="btn btn-ghost btn-sm" title="Générer un jeton aléatoire (à copier aussi dans la console Meta)" onClick={() => setSecrets(v => ({ ...v, verify_token: randomToken() }))}><Wand2 />Générer</button>}
                    {s.present && <button type="button" className={`btn btn-ghost btn-sm ${clear[k] ? 'on' : ''}`} aria-pressed={!!clear[k]} title="Effacer cette valeur à l’enregistrement" onClick={() => setClear(v => ({ ...v, [k]: !v[k] }))}><Trash2 />{clear[k] ? 'Sera effacé' : 'Effacer'}</button>}
                  </span>
                  {k === 'verify_token' && secrets.verify_token && <span className="small" style={{ display: 'block' }}>Jeton à saisir dans Meta : <code>{secrets.verify_token}</code> <CopyButton text={secrets.verify_token} label="Copier" /></span>}
                </Field>
              );
            })}
            <Field label="Version de l’API Graph" hint="Ex. v23.0 ; à relever quand Meta retire une ancienne version"><input className="input" value={f.graph_version} onChange={set('graph_version')} style={{ maxWidth: 140 }} /></Field>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            {Object.entries(d.labels.flags).map(([k, l]) => (
              <label key={k} className="row small" style={{ gap: 8 }}><input type="checkbox" checked={!!f[k]} onChange={flag(k)} />{l}</label>
            ))}
            <p className="small muted" style={{ margin: 0 }}>Les réponses aux messages passent par Sita (réglages, plafond en FCFA et arrêt d’urgence dans Contenu du site › Assistante du site ; Sita doit être activée). Le pixel ne se charge que si un identifiant est saisi et activé ; avec la case « accord du visiteur », une mention discrète s’affiche sur le site.</p>
          </div>

          <div className="form-grid">
            <Field label="Réponse publique aux commentaires" className="full" hint="Message court qui invite à écrire en privé. Jamais de donnée personnelle, jamais d’IA : ce texte fixe est envoyé tel quel aux commentaires principaux (pas aux réponses ni aux liens).">
              <textarea className="textarea" rows={2} minLength={10} maxLength={300} value={f.comment_reply_text} onChange={set('comment_reply_text')} />
            </Field>
            <Field label="Réponses publiques maximum par heure"><input className="input" type="number" min={1} max={200} value={f.comment_reply_max_per_hour} onChange={set('comment_reply_max_per_hour')} style={{ maxWidth: 120 }} /></Field>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" disabled={busy}><Check />Enregistrer</button>
            <button type="button" className="btn" disabled={busy || !d.connectors.find(c => c.key === 'page')?.configured} onClick={subscribe}><RefreshCw />Abonner la page aux événements</button>
          </div>
        </form>

        <div className="stack" style={{ gap: 6 }}>
          <b><Link2 size={15} aria-hidden="true" /> À déclarer dans la console Meta (Webhooks)</b>
          <p className="small" style={{ margin: 0 }}>URL de rappel : <code>{d.webhook.url}</code> <CopyButton text={d.webhook.url} label="Copier" /></p>
          <p className="small" style={{ margin: 0 }}>Jeton de vérification : celui saisi ci-dessus ({d.secrets.verify_token.present ? `présent …${d.secrets.verify_token.last4}` : 'à saisir'}). Signature : {d.secrets.app_secret.present ? 'secret de l’application présent, les événements sont authentifiés' : 'secret de l’application manquant, tous les événements seront refusés'}.</p>
          <p className="small muted" style={{ margin: 0 }}>Page : {d.webhook.fields.page.join(', ')} · Instagram : {d.webhook.fields.instagram.join(', ')}.</p>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <b>Journal des échanges avec Meta</b>
          {!events.data ? <Skeleton h={60} /> : !events.data.length ? <p className="small muted" style={{ margin: 0 }}>Aucun échange pour le moment.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Type</th><th>Canal</th><th>Issue</th><th>Détail</th></tr></thead>
              <tbody>{events.data.map(e => (
                <tr key={e.id}><td className="nowrap">{dateTime(e.created_at)}</td><td>{e.kind_label}{e.user_name ? ` · ${e.user_name}` : ''}</td><td>{e.channel || '—'}</td>
                  <td><Badge tone={EVENT_TONES[e.status]}>{e.status_label}</Badge></td><td className="small">{e.detail || '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </Card>
  );
}
