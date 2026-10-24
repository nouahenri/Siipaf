import { Link } from 'react-router-dom';
import { LifeBuoy, Calculator, Users, Scale, Building, HardHat, Boxes, Briefcase, ArrowRight } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { useErpNotifications } from '../components/NotificationCenter';
import { ADMIN_SHOW, JURIDIQUE, JURIDIQUE_SHOW } from '../components/ErpLayout';
import { CHANTIERS, CHANTIERS_SHOW } from '../lib/chantiers';

// Feuille de route de l'ERP (passation.md §5 quinquies) : seuls les modules livrés sont ouverts
const MODULES = [
  { id: 'commercial', to: '/commercial', label: 'Service commercial', text: 'Parc immobilier, pipeline de la prospection au notaire, ventes, appels de fonds VEFA, objectifs.', icon: Briefcase, perm: ['commercial:read', 'vefa:write'], color: '#d2101e' },
  { id: 'sav', to: '/sav', label: 'Client & SAV', text: 'Après la vente : réserves de livraison, réclamations (maisons et terrains), interventions, satisfaction.', icon: LifeBuoy, perm: 'sav:read', color: '#2a78d6' },
  { id: 'compta', to: '/compta', label: 'Comptabilité', text: 'SYSCOHADA : écritures automatiques des ventes et versements, achats par programme, paie, trésorerie, états, export Sage.', icon: Calculator, perm: ['compta:read', 'paie:read'], color: '#1baf7a' },
  { id: 'rh', to: '/rh', label: 'Ressources humaines', text: 'Mon espace (pointage, congés, notes de frais), personnel, présences, recrutement, compétences et formations, entretiens.', icon: Users, color: '#eb6834' },
  { id: 'chantiers', to: '/chantiers', label: 'Chantiers', text: 'Plusieurs chantiers par programme : planning (Gantt), phases, tâches, budget par poste.', icon: HardHat, perm: CHANTIERS, show: CHANTIERS_SHOW, badges: 'chantiers', color: '#eda100' },
  { id: 'achats', label: 'Achats & stocks', text: 'Commandes, sous-traitance, dépôt ↔ chantier.', icon: Boxes, color: '#e87ba4' },
  { id: 'juridique', to: '/juridique', label: 'Juridique', text: 'Ventes jusqu’à l’acte notarié, litiges, cautions et retenues de garantie, impayés transmis, contrats et échéances.', icon: Scale, perm: [...JURIDIQUE, 'compta:read'], show: JURIDIQUE_SHOW, badges: 'juridique', color: '#6d28d9' },
  { id: 'admin', module: 'administration', to: '/administration', label: 'Administration générale', text: 'Vue Direction de tous les services, courrier arrivée et départ, contrats et échéances, parc auto et matériel, documents internes, demandes internes.', icon: Building, perm: ['direction:read', 'courrier:read', 'courrier:write', 'courrier:assign', 'contrats:read', 'contrats:write', 'parc:read', 'parc:write', 'demandes:handle', 'demandes:dg'], show: ADMIN_SHOW, color: '#5b6170' },
];

export default function Launcher() {
  const { can, user } = useAuth();
  // Le destinataire d'un courrier ou le responsable d'un contrat entre dans l'Administration générale pour les siens
  const mail = useResource('/admin/erp/direction/badges');
  // Le juriste en charge d'un litige ou un membre du service concerné entre dans le Juridique pour les siens
  const legal = useResource('/admin/erp/juridique/badges');
  // Le conducteur nommé sur un chantier entre dans le module Chantiers pour les siens
  const works = useResource('/admin/erp/chantiers/badges');
  const extra = { juridique: legal.data, chantiers: works.data };
  // Pastille : notifications non lues du module (centre de notifications commun)
  const unread = useErpNotifications().data?.by_module || {};
  return (
    <div className="stack">
      <div>
        <h2 className="erp-hello">Bonjour {user.name.split(' ')[0]}</h2>
        <p className="muted">Choisissez un module. Les autres ouvriront au fil de leur mise en service.</p>
      </div>
      <div className="module-grid">
        {MODULES.map(m => {
          const ready = m.to && (!m.perm || [].concat(m.perm).some(can) || !!m.show?.(m.badges ? extra[m.badges] : mail.data));
          const count = ready ? unread[m.module || m.id] || 0 : 0;
          const body = (
            <>
              {count > 0 && <span className="module-badge" aria-label={`${count} notification${count > 1 ? 's' : ''} non lue${count > 1 ? 's' : ''}`}>{count > 99 ? '99+' : count}</span>}
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
