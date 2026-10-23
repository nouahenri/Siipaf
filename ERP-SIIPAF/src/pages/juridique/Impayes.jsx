/**
 * Juridique › Impayés : ventes en retard de paiement. Le commercial est prévenu dès le premier jour de retard ; au-delà
 * du seuil réglé dans Juridique › Réglages (90 jours par défaut), le dossier est transmis au Juridique, qui ouvre un
 * litige de recouvrement.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlarmClock, Scale } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { qs } from '@admin/lib/api';
import { JUR } from '../../lib/juridique';

export default function Impayes() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const res = useResource(`${JUR}/impayes`);
  const d = res.data;
  const rows = d ? d.items.filter(u => all || u.transmitted) : [];
  const litigate = u => navigate(`/juridique/litiges${qs({ nouveau: 'impaye', vente: u.sale_id, client: u.client_name, montant: u.overdue_fcfa })}`);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="seg" role="group" aria-label="Affichage">
          <button className={!all ? 'active' : ''} onClick={() => setAll(false)}>Transmis au Juridique</button>
          <button className={all ? 'active' : ''} onClick={() => setAll(true)}>Tous les retards</button>
        </div>
        {d && <span className="small muted">Transmis à partir de {d.threshold} jours de retard {can('juridique:write') && <>· <Link to="/juridique/reglages">régler le seuil</Link></>}</span>}
      </div>
      <Card bodyClass="">
        <ErrorBox error={res.error} />
        {!d ? <div className="card-body"><Skeleton h={220} /></div> : !rows.length ? (
          <div className="card-body"><Empty icon={AlarmClock}>{all ? 'Aucun retard de paiement.' : 'Aucun impayé transmis au Juridique.'}</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Client</th><th>Bien</th><th>Commercial</th><th className="right">En retard</th><th>Depuis</th><th>Suite</th></tr></thead>
            <tbody>{rows.map(u => (
              <tr key={u.sale_id}>
                <td>{u.client_name}<div className="small muted">{[u.client_code, u.client_phone].filter(Boolean).join(' · ')}</div></td>
                <td>{u.project_name}<div className="small muted">lot {u.lot_code}</div></td>
                <td className="small">{u.commercial_name || '—'}</td>
                <td className="right tabular">{fcfa(u.overdue_fcfa)}<div className="small muted">{u.overdue_count} échéance(s)</div></td>
                <td className="small nowrap">{date(u.oldest_due)}<div><Badge tone={u.transmitted ? 'danger' : 'warn'}>{u.days_late} jours</Badge></div></td>
                <td>{u.litigation ? <Link to={`/juridique/litiges?fiche=${u.litigation.id}`}>{u.litigation.reference}</Link>
                  : can('juridique:write') ? <button className="btn btn-sm" onClick={() => litigate(u)}><Scale />Ouvrir un litige</button> : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
