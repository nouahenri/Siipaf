/** ERP · Marketing & Communication : adresse de l'API, teintes des statuts, bandeau du mode de l'IA, copie en un clic. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Copy, Check, PenLine, FlaskConical, TriangleAlert } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Badge } from '@admin/components/ui';

export const MK = '/admin/erp/marketing';
export const CONTENT_TONES = { brouillon: '', a_valider: 'warn', valide: 'ok', planifie: 'brand', publie: 'ok', archive: '' };
export const CAMPAIGN_TONES = { brouillon: '', a_valider: 'warn', validee: 'ok', archivee: '' };

export const useMarketingRefs = () => useResource(`${MK}/refs`);

export const contentStatus = (c, refs) => <Badge tone={CONTENT_TONES[c.status]}>{refs?.content_statuses?.[c.status] || c.status_label || c.status}</Badge>;

/** Qui a préparé le texte : l'IA, un gabarit de démonstration ou une personne. */
export function OriginBadge({ origin }) {
  if (origin === 'ia') return <Badge tone="brand"><Bot size={12} aria-hidden="true" /> Préparé par l’IA</Badge>;
  if (origin === 'demo') return <Badge><FlaskConical size={12} aria-hidden="true" /> Démonstration</Badge>;
  return <Badge><PenLine size={12} aria-hidden="true" /> Rédigé à la main</Badge>;
}

/** Bandeau tant que l'IA n'est pas active : gabarits sur les vrais faits, coût nul. */
export function ModeBanner({ mode, reason }) {
  if (mode !== 'demo') return null;
  return (
    <div className="callout-erp"><FlaskConical aria-hidden="true" /><span className="small">
      <b>Mode démonstration.</b> {reason || 'L’IA n’est pas active.'} Les contenus sont des gabarits construits sur les vraies données du catalogue (prix, livraison, avancement publié) : ils coûtent 0 FCFA et restent à relire et valider comme les autres.
    </span></div>
  );
}

export function Warnings({ list }) {
  if (!list?.length) return null;
  return (
    <div className="alert alert-warn" role="alert">
      <b className="row" style={{ gap: 6 }}><TriangleAlert size={16} aria-hidden="true" />À corriger avant de soumettre</b>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{list.map(w => <li key={w} className="small">{w}</li>)}</ul>
    </div>
  );
}

/** Copie le texte (accroche, texte, hashtags, lien suivi) pour le coller dans le réseau social ou la messagerie. */
export function CopyButton({ text, label = 'Copier', small = true }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const area = document.createElement('textarea');
      area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1800);
  };
  return <button type="button" className={`btn btn-ghost ${small ? 'btn-sm' : ''}`} onClick={copy}>{done ? <Check size={15} /> : <Copy size={15} />}{done ? 'Copié' : label}</button>;
}

/** Texte complet d'un contenu, prêt à coller : objet, texte, appel à l'action, hashtags. */
export const fullText = c => [c.subject && `Objet : ${c.subject}`, c.body, c.hashtags?.length ? c.hashtags.join(' ') : null].filter(Boolean).join('\n\n');

export const fr = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
export const frDay = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Sans date');
export const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const mondayOf = d => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
export const todayIso = () => new Date().toISOString().slice(0, 10);

export const CampaignLink = ({ c }) => <Link className="link" to={`/marketing/campagnes/${c.campaign_id}`}>{c.campaign_name}</Link>;
