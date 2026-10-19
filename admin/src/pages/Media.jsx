import { useState } from 'react';
import { Card } from '../components/ui';
import { MediaGrid } from '../components/MediaLibrary';

export default function Media() {
  const [type, setType] = useState('');
  return (
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
      <MediaGrid key={type} type={type} />
    </Card>
  );
}
