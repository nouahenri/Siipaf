/**
 * Marketing & Communication › Bibliothèque de contenus : tous les contenus préparés (par l'IA, un gabarit de démonstration ou
 * à la main), filtrés par état, canal et campagne ; copie en un clic ; fiche pour relire, ajuster et valider.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Library as LibraryIcon } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Empty, ErrorBox, Skeleton } from '@admin/components/ui';
import { qs } from '@admin/lib/api';
import { MK, ModeBanner } from '../../lib/marketing';
import { ContentCard, ContentDrawer } from '../../components/MarketingContent';

export default function Library() {
  const [params, setParams] = useSearchParams();
  const status = params.get('statut') || '';
  const channel = params.get('canal') || '';
  const campaign = params.get('campagne') || '';
  const open = Number(params.get('fiche')) || null;
  const refs = useResource(`${MK}/refs`).data;
  const campaigns = useResource(`${MK}/campaigns`).data;
  const res = useResource(`${MK}/contents${qs({ status, channel, campaign_id: campaign })}`);
  const [, force] = useState(0);
  const set = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  if (res.error) return <ErrorBox error={res.error} />;

  return (
    <div className="stack">
      {refs && <ModeBanner mode={refs.mode} reason={refs.mode_reason} />}
      <div className="row" style={{ gap: 10 }}>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={e => set('statut', e.target.value)} aria-label="État">
          <option value="">Tous les états</option>{Object.entries(refs?.content_statuses || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={channel} onChange={e => set('canal', e.target.value)} aria-label="Canal">
          <option value="">Tous les canaux</option>{Object.entries(refs?.channels || {}).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={campaign} onChange={e => set('campagne', e.target.value)} aria-label="Campagne">
          <option value="">Toutes les campagnes</option>{(campaigns || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="small muted">{res.data ? `${res.data.length} contenu(s)` : ''}</span>
      </div>
      {!res.data ? <Skeleton h={300} /> : !res.data.length ? <Empty icon={LibraryIcon}>Aucun contenu pour ces filtres.</Empty> : (
        <div className="mk-grid">{res.data.map(c => <ContentCard key={c.id} c={c} refs={refs} onOpen={id => set('fiche', String(id))} />)}</div>
      )}
      {open && <ContentDrawer id={open} onClose={() => { set('fiche', ''); force(n => n + 1); }} onChanged={res.reload} />}
    </div>
  );
}
