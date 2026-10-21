/** Historique d'attribution d'un prospect à un commercial (fiche prospect) : transferts, conversion, perte. */
import { useResource } from '../lib/app-context';
import { date } from '../lib/format';

export default function PortfolioHistory({ leadId }) {
  const res = useResource(`/admin/leads/${leadId}/portefeuille`);
  if (!res.data?.length) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <h3 className="small" style={{ fontWeight: 600, marginBottom: 8 }}>Portefeuille commercial</h3>
      <ul className="small" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        {res.data.map(e => (
          <li key={e.id} className="row" style={{ gap: 8 }}>
            <span className="muted nowrap tabular">{date(e.at)}</span>
            <span>{e.label}{e.user_name ? ` · ${e.user_name}` : ''}{e.reason_label ? <span className="muted"> ({e.reason_label.toLowerCase()})</span> : null}{e.by_name ? <span className="muted"> — par {e.by_name}</span> : null}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
