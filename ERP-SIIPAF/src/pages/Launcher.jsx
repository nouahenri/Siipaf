import { Link } from 'react-router-dom';
import { LifeBuoy, Calculator, Users, Scale, Building, HardHat, Boxes, Briefcase, ArrowRight } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';

// Feuille de route de l'ERP (passation.md §5 quinquies) : seuls les modules livrés sont ouverts
const MODULES = [
  { id: 'commercial', to: '/commercial', label: 'Service commercial', text: 'Parc immobilier, pipeline de la prospection au notaire, ventes, appels de fonds VEFA, objectifs.', icon: Briefcase, perm: ['commercial:read', 'vefa:write'], color: '#d2101e' },
  { id: 'sav', to: '/sav', label: 'Client & SAV', text: 'Après la vente : réserves de livraison, réclamations (maisons et terrains), interventions, satisfaction.', icon: LifeBuoy, perm: 'sav:read', color: '#2a78d6' },
  { id: 'compta', to: '/compta', label: 'Comptabilité', text: 'SYSCOHADA : écritures automatiques des ventes et versements, achats par programme, paie, trésorerie, états, export Sage.', icon: Calculator, perm: ['compta:read', 'paie:read'], color: '#1baf7a' },
  { id: 'rh', to: '/rh', label: 'Ressources humaines', text: 'Mon espace (pointage, congés, notes de frais), personnel, présences, recrutement, compétences et formations, entretiens.', icon: Users, color: '#eb6834' },
  { id: 'chantiers', label: 'Chantiers', text: 'Planning (Gantt), feuilles de temps, situations de travaux.', icon: HardHat, color: '#eda100' },
  { id: 'achats', label: 'Achats & stocks', text: 'Commandes, sous-traitance, dépôt ↔ chantier.', icon: Boxes, color: '#e87ba4' },
  { id: 'juridique', label: 'Juridique', text: 'Contrats, notaires, actes et échéances.', icon: Scale, color: '#6d28d9' },
  { id: 'admin', to: '/administration', label: 'Administration générale', text: 'Vue Direction de tous les services, courrier arrivée et départ ; puis contrats et échéances, parc, documents internes, demandes.', icon: Building, perm: ['direction:read', 'courrier:read', 'courrier:write', 'courrier:assign', 'contrats:read', 'contrats:write'], show: b => b?.mine > 0 || b?.contracts_owned > 0, color: '#5b6170' },
];

export default function Launcher() {
  const { can, user } = useAuth();
  // Le destinataire d'un courrier ou le responsable d'un contrat entre dans l'Administration générale pour les siens
  const mail = useResource('/admin/erp/direction/badges');
  return (
    <div className="stack">
      <div>
        <h2 className="erp-hello">Bonjour {user.name.split(' ')[0]}</h2>
        <p className="muted">Choisissez un module. Les autres ouvriront au fil de leur mise en service.</p>
      </div>
      <div className="module-grid">
        {MODULES.map(m => {
          const ready = m.to && (!m.perm || [].concat(m.perm).some(can) || !!m.show?.(mail.data));
          const body = (
            <>
              <span className="module-icon" style={{ '--c': m.color }}><m.icon aria-hidden="true" /></span>
              <span className="module-name">{m.label}</span>
              <span className="module-text">{m.text}</span>
              <span className="module-foot">
                {ready ? <>Ouvrir <ArrowRight aria-hidden="true" /></> : m.to ? 'Accès non autorisé' : 'À venir'}
              </span>
            </>
          );
          return ready
            ? <Link key={m.id} to={m.to} className="card module-tile">{body}</Link>
            : <div key={m.id} className="card module-tile off" aria-disabled="true">{body}</div>;
        })}
      </div>
    </div>
  );
}
