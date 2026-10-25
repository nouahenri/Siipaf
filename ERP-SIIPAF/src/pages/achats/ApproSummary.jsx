import { Link } from 'react-router-dom';
import { ClipboardList, PackageCheck, AlertTriangle, Wallet } from 'lucide-react';
import { fcfa } from '@admin/lib/format';
import { Kpi } from '../commercial/CommercialDashboard';

/** Même synthèse dans le module et dans la Vue Direction. */
export default function ApproSummary({ data: d }) {
  return <>
    <div className="grid grid-4">
      <Kpi to="/achats/commandes?statut=a_valider,attente_direction" icon={ClipboardList} label="Commandes à valider" count={d.orders_waiting} foot="validateur désigné ou Direction" tint={d.orders_waiting ? 'amber' : undefined} />
      <Kpi to="/achats/commandes?statut=confirmee,partielle" icon={PackageCheck} label="Commandes à réceptionner" count={d.to_receive} foot="confirmées ou partiellement reçues" />
      <Kpi to="/achats/stocks" icon={AlertTriangle} label="Stocks à réapprovisionner" count={d.low_stock.length} foot="articles au seuil ou en rupture" tint={d.low_stock.length ? 'amber' : undefined} />
      <Kpi to="/achats/commandes" icon={Wallet} label="Engagement restant" count={d.committed_fcfa} format={fcfa} foot="TTC commandé non encore réceptionné" />
    </div>
    <div className="row small muted"><Link to="/achats/besoins" className="link">{d.needs} besoin(s) à traiter</Link><span>·</span><Link to="/achats/prix" className="link">{d.quotes_waiting} demande(s) de prix en cours</Link><span>· Plafond Direction : {fcfa(d.settings.direction_threshold)} TTC</span></div>
  </>;
}
