/** Commercial qui a converti le prospect en client, mis en évidence sur la fiche client et la fiche du bien (dashboard et ERP). */
import { UserCheck } from 'lucide-react';

export default function ConvertedBy({ name }) {
  if (!name) return null;
  return <span className="converted-by"><UserCheck aria-hidden="true" />Converti par <b>{name}</b></span>;
}
