/** ERP · Juridique : adresse de l'API, jours restants avant une échéance, références du module. */
import { Badge } from '@admin/components/ui';

export const JUR = '/admin/erp/juridique';
export const LIT_TONES = { amiable: '', mise_en_demeure: 'warn', huissier: 'warn', avocat: 'brand', audience: 'brand', jugement: 'brand', clos: 'ok' };
export const GAR_TONES = { active: 'ok', liberee: '', appelee: 'danger', expiree: '' };

/** Jours restants : rouge si dépassé ou aujourd'hui, or à 7 jours, neutre au-delà. */
export function DaysLeft({ n }) {
  if (n == null) return null;
  if (n < 0) return <Badge tone="danger">dépassée de {-n} j</Badge>;
  if (n === 0) return <Badge tone="danger">aujourd’hui</Badge>;
  return <Badge tone={n <= 7 ? 'warn' : ''}>dans {n} j</Badge>;
}
