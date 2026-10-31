/**
 * Marketing › Réglages › Audiences Meta (Direction générale, droit marketing:settings).
 * - Audience similaire : liste de clients et de prospects HACHÉE en SHA-256 (e-mail et téléphone normalisés au format Meta), à télécharger
 *   ou à envoyer au compte publicitaire ; aucune donnée en clair ne quitte le serveur. Chaque export est journalisé (qui, quand, combien).
 * - Audiences d'interaction : construites par Meta (visiteurs du site, personnes ayant interagi avec la page ou Instagram) ; aucune identité reçue.
 * - Les centres d'intérêt et les textes d'annonce sont proposés par l'IA dans chaque campagne.
 */
import { useState } from 'react';
import { Download, Upload, Users, Sparkles } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useSaved } from '@admin/lib/app-context';
import { Badge, Card, ErrorBox, Skeleton } from '@admin/components/ui';
import { dateTime, num } from '@admin/lib/format';
import { MK } from '../lib/marketing';

const KINDS = { liste: 'Liste hachée', interaction: 'Interaction', similaire: 'Similaire' };

export default function MetaAudiences() {
  const saved = useSaved();
  const res = useResource(`${MK}/meta/audiences`);
  const [scope, setScope] = useState('clients');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const d = res.data;
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d) return <Skeleton h={200} />;
  const sc = d.scopes[scope];

  const act = async (call, message) => {
    setBusy(true); setError(null);
    try { await call(); await res.reload(); saved(message); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Card title="Audiences Meta">
      <div className="stack" style={{ gap: 14 }}>
        <p className="small muted" style={{ margin: 0 }}>Le ciblage par centres d’intérêt immobilier et les textes d’annonce sont proposés par l’IA dans chaque campagne. Ici : la liste de clients et de prospects pour une audience similaire (SHA-256 uniquement, rien en clair) et les audiences d’interaction construites par Meta.</p>
        <ErrorBox error={error} />

        <div className="stack" style={{ gap: 8 }}>
          <b><Users size={15} aria-hidden="true" /> Liste hachée pour une audience similaire</b>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="select" style={{ width: 'auto' }} value={scope} onChange={e => setScope(e.target.value)} aria-label="Périmètre de la liste">
              {Object.entries(d.scopes).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
            <span className="small">{num(sc.usable)} personne(s) exploitable(s) sur {num(sc.people)} ({num(sc.with_email)} avec e-mail, {num(sc.with_phone)} avec téléphone)</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <a className={`btn ${sc.usable ? '' : 'disabled'}`} aria-disabled={!sc.usable} href={sc.usable ? `/api${MK}/meta/audiences/export.csv?scope=${scope}` : undefined} download onClick={() => setTimeout(res.reload, 1500)}><Download />Télécharger le fichier haché (CSV)</a>
            <button className="btn" disabled={busy || !sc.usable || !d.connected} title={d.connected ? '' : 'Compte publicitaire non connecté'} onClick={() => act(() => api.post(`${MK}/meta/audiences/upload`, { scope }), 'Liste envoyée au compte publicitaire')}><Upload />Envoyer au compte publicitaire</button>
          </div>
          {!d.connected && <p className="small muted" style={{ margin: 0 }}>Compte publicitaire non connecté : téléchargez le fichier, puis importez-le dans le Gestionnaire de publicités (Audiences › Créer › Liste de clients). L’envoi direct s’active dès que l’identifiant du compte publicitaire et un jeton sont saisis.</p>}
          <p className="small muted" style={{ margin: 0 }}>Adresses normalisées (minuscules) et numéros au format international (225…) avant hachage. Seules les personnes dont la fiche n’est pas « perdue » sont incluses. Vérifiez que votre politique de confidentialité prévoit cet usage (loi 2013-450). Chaque export est journalisé et la Direction générale en est informée. Meta exige au moins {d.min_lookalike} personnes pour créer une audience similaire.</p>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <b><Sparkles size={15} aria-hidden="true" /> Audiences d’interaction (construites par Meta)</b>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {d.interactions.map(i => (
              <button key={i.key} className="btn btn-sm" disabled={busy || !d.connected || !i.ready} title={!d.connected ? 'Compte publicitaire non connecté' : !i.ready ? `Renseignez : ${i.needs}` : ''}
                onClick={() => act(() => api.post(`${MK}/meta/audiences/interaction`, { preset: i.key }), 'Audience créée')}>{i.label}</button>
            ))}
          </div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <b>Audiences créées</b>
          {!d.audiences.length ? <p className="small muted" style={{ margin: 0 }}>Aucune audience envoyée à Meta pour le moment.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Audience</th><th>Type</th><th className="right">Personnes</th><th>Par</th><th /></tr></thead>
              <tbody>{d.audiences.map(a => (
                <tr key={a.id}><td className="nowrap">{dateTime(a.created_at)}</td><td>{a.name}</td><td><Badge>{KINDS[a.kind] || a.kind}</Badge></td><td className="right tabular">{a.kind === 'liste' ? num(a.size) : '—'}</td><td>{a.created_by_name || '—'}</td>
                  <td>{a.kind === 'liste' && <button className="btn btn-sm" disabled={busy || a.size < d.min_lookalike} title={a.size < d.min_lookalike ? `Au moins ${d.min_lookalike} personnes requises` : ''} onClick={() => act(() => api.post(`${MK}/meta/audiences/${a.id}/lookalike`, { country: 'CI', ratio: 0.01 }), 'Audience similaire créée')}>Créer l’audience similaire (CI, 1 %)</button>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </Card>
  );
}
