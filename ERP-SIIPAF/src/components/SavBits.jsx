import { useEffect, useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { api } from '@admin/lib/api';
import { Badge } from '@admin/components/ui';
import { STATUS_COLORS, PRIORITY_TONES } from '../lib/sav';

// Référentiels du SAV, chargés une fois par session
let cache = null;
export function useSavMeta() {
  const [meta, setMeta] = useState(cache);
  useEffect(() => {
    if (cache) return;
    api.get('/admin/erp/sav/meta').then(m => { cache = m; setMeta(m); }).catch(() => {});
  }, []);
  return meta;
}

export const SavStatus = ({ status, meta }) => (
  <span className="badge status-badge"><i style={{ background: STATUS_COLORS[status] }} />{meta?.status_labels?.[status] || status}</span>
);

export const Priority = ({ priority, meta }) => (
  <Badge tone={PRIORITY_TONES[priority]}>{meta?.priorities?.[priority]?.label || priority}</Badge>
);

export const Overdue = () => <Badge tone="danger"><AlarmClock aria-hidden="true" style={{ width: 13, height: 13 }} />En retard</Badge>;
