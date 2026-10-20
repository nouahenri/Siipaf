import { useState } from 'react';
import { Card } from '../components/ui';
import { MediaGrid } from '../components/MediaLibrary';
import { useAuth } from '../lib/app-context';
import SiteImageAssignments from '../components/SiteImageAssignments';

export default function Media() {
  const [type, setType] = useState('');
  const { can } = useAuth();
  const [section, setSection] = useState('files');
  const [candidate, setCandidate] = useState(null);
  return (
    <div className="stack">
      {can('content:write') && <div className="tabs" role="tablist" aria-label="Médiathèque">
        <button className={`tab ${section === 'files' ? 'active' : ''}`} role="tab" aria-selected={section === 'files'} onClick={() => { setSection('files'); setCandidate(null); }}>Fichiers</button>
        <button className={`tab ${section === 'placements' ? 'active' : ''}`} role="tab" aria-selected={section === 'placements'} onClick={() => setSection('placements')}>Images du site</button>
      </div>}
      {section === 'placements' && can('content:write') ? <SiteImageAssignments candidate={candidate} onConsumed={() => setCandidate(null)} /> : (
    <Card
      title="Images, plans et vidéos"
      actions={
        <div className="seg">
          {[['', 'Tout'], ['image', 'Images'], ['pdf', 'PDF']].map(([k, v]) => (
            <button key={k} className={type === k ? 'active' : ''} onClick={() => setType(k)}>{v}</button>
          ))}
        </div>
      }
    >
      <MediaGrid key={type} type={type} onAssign={can('content:write') ? m => { setCandidate(m); setSection('placements'); } : undefined} />
    </Card>
      )}
    </div>
  );
}
