import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutGrid, LifeBuoy, LayoutDashboard, ClipboardList, ClipboardCheck, CalendarClock, LogOut, Menu, ExternalLink,
  Briefcase, Columns3, ListTodo, CalendarDays, Building2, FileSignature, Landmark, Target,
  Calculator, BookOpen, ShoppingCart, FileBarChart, ListTree, Settings2, Contact, Banknote,
  Users, UserRound, Palmtree, Fingerprint, Receipt, UserPlus, GraduationCap, ShieldCheck, UserCog, Building, Mail, FileClock, Truck, BookOpenCheck, Inbox,
} from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { useRevealOnScroll } from '@admin/lib/reveal';
import { ROLE_LABELS } from '@admin/lib/domain';
import { initials } from '@admin/lib/format';
import NotificationCenter from './NotificationCenter';

const COURRIER = ['courrier:read', 'courrier:write', 'courrier:assign'];
const CONTRATS = ['contrats:read', 'contrats:write'];
const PARC = ['parc:read', 'parc:write'];
const DEMANDES = ['demandes:handle', 'demandes:dg'];
export const ADMIN_SHOW = b => b?.mine > 0 || b?.contracts_owned > 0 || !!b?.docs_can_publish || b?.requests_to_approve > 0;

// Navigation de chaque module ; les modules suivants (comptabilité, RH…) viendront s'ajouter ici
const MODULES = {
  commercial: {
    label: 'Service commercial', icon: Briefcase, perm: ['commercial:read', 'vefa:write'],
    items: [
      { to: '/commercial', label: 'Tableau de bord', icon: LayoutDashboard, end: true, perm: 'commercial:read' },
      { to: '/commercial/pipeline', label: 'Pipeline', icon: Columns3, perm: 'leads:read' },
      { to: '/commercial/activites', label: 'Mes activités', icon: ListTodo, badge: 'late_activities', perm: 'commercial:read' },
      { to: '/commercial/rendez-vous', label: 'Rendez-vous', icon: CalendarDays, perm: 'appointments:read' },
      { to: '/commercial/parc', label: 'Parc immobilier', icon: Building2, perm: 'lots:read' },
      { to: '/commercial/ventes', label: 'Dossiers de vente', icon: FileSignature, perm: 'sales:read' },
      { to: '/commercial/vefa', label: 'Appels de fonds VEFA', icon: Landmark, perm: ['commercial:read', 'vefa:write'] },
      { to: '/commercial/objectifs', label: 'Objectifs et performance', icon: Target, perm: 'commercial:read' },
      { to: '/commercial/acces', label: 'Rôles et privilèges', icon: ShieldCheck, perm: 'users:read' },
    ],
  },
  compta: {
    label: 'Comptabilité', icon: Calculator, perm: ['compta:read', 'paie:read', 'rh:read'],
    items: [
      { to: '/compta', label: 'Tableau de bord', icon: LayoutDashboard, end: true, perm: 'compta:read' },
      { to: '/compta/ecritures', label: 'Écritures', icon: BookOpen, badge: 'drafts', perm: 'compta:read' },
      { to: '/compta/achats', label: 'Achats et fournisseurs', icon: ShoppingCart, perm: 'compta:read' },
      { to: '/compta/paie', label: 'Paie', icon: Banknote, perm: 'paie:read' },
      { to: '/compta/employes', label: 'Employés', icon: Contact, perm: ['paie:read', 'rh:read'] },
      { to: '/compta/etats', label: 'États et export', icon: FileBarChart, perm: 'compta:read' },
      { to: '/compta/plan', label: 'Plan comptable', icon: ListTree, perm: 'compta:read' },
      { to: '/compta/parametres', label: 'Paramètres', icon: Settings2, perm: 'compta:read' },
      { to: '/compta/acces', label: 'Rôles et privilèges', icon: ShieldCheck, perm: 'users:read' },
    ],
  },
  // RH : chaque employé relié à un compte y trouve « Mon espace » ; les responsables, leur équipe
  rh: {
    label: 'Ressources humaines', icon: Users, perm: null,
    items: [
      { to: '/rh', label: 'Tableau de bord', icon: LayoutDashboard, end: true, perm: 'rh:read' },
      { to: '/rh/moi', label: 'Mon espace', icon: UserRound, show: b => b?.has_employee },
      { to: '/rh/personnel', label: 'Personnel', icon: Contact, perm: 'rh:read' },
      { to: '/rh/conges', label: 'Congés et absences', icon: Palmtree, badge: 'approvals', perm: 'rh:read', show: b => b?.team_size > 0 || b?.approvals > 0 },
      { to: '/rh/presences', label: 'Présences', icon: Fingerprint, perm: ['rh:read', 'presence:write'] },
      { to: '/rh/frais', label: 'Notes de frais', icon: Receipt, badge: 'expenses', perm: ['rh:read', 'compta:read'], show: b => b?.team_size > 0 || b?.expenses > 0 },
      { to: '/rh/recrutement', label: 'Recrutement', icon: UserPlus, perm: 'rh:read' },
      { to: '/rh/competences', label: 'Compétences et formations', icon: GraduationCap, perm: 'rh:read' },
      { to: '/rh/objectifs', label: 'Performance et entretiens', icon: Target, perm: 'rh:read', show: b => b?.team_size > 0 },
      { to: '/rh/reglages', label: 'Réglages', icon: Settings2, perm: 'rh:read' },
      { to: '/rh/acces', label: 'Rôles et privilèges', icon: ShieldCheck, perm: 'users:read' },
    ],
  },
  // Administration générale : vue Direction, courrier, contrats, parc, documents internes, demandes internes.
  // Le destinataire d'un courrier, le responsable d'un contrat, un chef de service ou un valideur y accède pour les siens.
  administration: {
    label: 'Administration générale', icon: Building, perm: ['direction:read', ...COURRIER, ...CONTRATS, ...PARC, ...DEMANDES], show: ADMIN_SHOW,
    items: [
      { to: '/administration', label: 'Vue Direction', icon: LayoutDashboard, end: true, perm: 'direction:read' },
      { to: '/administration/courrier', label: 'Courrier', icon: Mail, badge: 'count', perm: COURRIER, show: b => b?.mine > 0 },
      { to: '/administration/contrats', label: 'Contrats et échéances', icon: FileClock, badge: 'contracts_due', perm: CONTRATS, show: b => b?.contracts_owned > 0 },
      { to: '/administration/parc', label: 'Parc auto et matériel', icon: Truck, badge: 'parc_count', perm: PARC },
      { to: '/administration/documents', label: 'Documents internes', icon: BookOpenCheck, perm: 'docs:publish', show: b => b?.docs_can_publish },
      { to: '/administration/demandes', label: 'Demandes internes', icon: Inbox, badge: 'requests_count', perm: DEMANDES, show: b => b?.requests_to_approve > 0 },
      { to: '/administration/acces', label: 'Rôles et privilèges', icon: ShieldCheck, perm: 'users:read' },
    ],
  },
  sav: {
    label: 'Client & SAV', icon: LifeBuoy, perm: 'sav:read',
    items: [
      { to: '/sav', label: 'Tableau de bord', icon: LayoutDashboard, end: true, perm: 'sav:read' },
      { to: '/sav/reclamations', label: 'Réclamations', icon: ClipboardList, badge: 'open', perm: 'sav:read' },
      { to: '/sav/reserves', label: 'Réserves de livraison', icon: ClipboardCheck, perm: 'sav:read' },
      { to: '/sav/interventions', label: 'Interventions', icon: CalendarClock, perm: 'sav:read' },
      { to: '/sav/acces', label: 'Rôles et privilèges', icon: ShieldCheck, perm: 'users:read' },
    ],
  },
};

const TITLES = {
  '/': 'Modules', '/commercial': 'Service commercial', '/commercial/pipeline': 'Pipeline commercial', '/commercial/activites': 'Mes activités',
  '/commercial/rendez-vous': 'Rendez-vous', '/commercial/parc': 'Parc immobilier', '/commercial/ventes': 'Dossiers de vente',
  '/commercial/vefa': 'Appels de fonds VEFA', '/commercial/objectifs': 'Objectifs et performance', '/administration': 'Vue Direction', '/administration/courrier': 'Courrier arrivée et départ', '/administration/contrats': 'Contrats et échéances', '/administration/parc': 'Parc auto et matériel', '/administration/documents': 'Documents internes', '/administration/demandes': 'Demandes internes', '/administration/acces': 'Rôles et privilèges — Administration générale',
  '/compta': 'Comptabilité', '/compta/ecritures': 'Écritures comptables', '/compta/achats': 'Achats et fournisseurs', '/compta/etats': 'États comptables',
  '/compta/plan': 'Plan comptable SYSCOHADA', '/compta/parametres': 'Paramètres comptables', '/compta/paie': 'Paie', '/compta/employes': 'Employés', '/rh': 'Ressources humaines', '/rh/moi': 'Mon espace', '/rh/personnel': 'Personnel', '/rh/conges': 'Congés et absences', '/rh/presences': 'Présences', '/rh/borne': 'Borne de pointage', '/rh/frais': 'Notes de frais', '/rh/recrutement': 'Recrutement', '/rh/competences': 'Compétences et formations', '/rh/objectifs': 'Performance et entretiens', '/rh/reglages': 'Réglages RH', '/commercial/acces': 'Rôles et privilèges — Service commercial', '/compta/acces': 'Rôles et privilèges — Comptabilité', '/rh/acces': 'Rôles et privilèges — Ressources humaines', '/sav/acces': 'Rôles et privilèges — Client & SAV', '/comptes': 'Comptes utilisateurs', '/sav': 'Client & SAV', '/sav/reclamations': 'Réclamations', '/sav/reserves': 'Réserves de livraison', '/sav/interventions': 'Interventions',
};

// Le dashboard est sur admin.siipaf.com quand l'ERP est sur erp.siipaf.com (admin.localhost en local)
const dashboardUrl = () => `${window.location.protocol}//${window.location.host.replace(/^erp\./, 'admin.')}/`;

export default function ErpLayout() {
  const { user, logout, can: canOne } = useAuth();
  const can = perm => (perm == null ? true : Array.isArray(perm) ? perm.some(canOne) : canOne(perm));
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const moduleId = pathname.split('/')[1];
  const mod = MODULES[moduleId];
  const statsUrl = moduleId === 'sav' && can('sav:read') ? '/admin/erp/sav/stats' : moduleId === 'commercial' && can('commercial:read') ? '/admin/erp/commercial/dashboard' : moduleId === 'compta' && can('compta:read') ? '/admin/erp/compta/dashboard' : moduleId === 'rh' ? '/admin/erp/rh/badges' : moduleId === 'administration' ? '/admin/erp/direction/badges' : null;
  const stats = useResource(statsUrl, [pathname]);
  const contentRef = useRef(null);
  useRevealOnScroll(contentRef, [pathname]);

  useEffect(() => setOpen(false), [pathname]);
  const title = TITLES[pathname] || (mod ? mod.label : 'ERP');
  useEffect(() => { document.title = `${title} — SIIPAF ERP`; }, [title]);

  return (
    <div className="shell">
      {open && <div className="overlay" onClick={() => setOpen(false)} />}
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Navigation principale">
        <div className="sidebar-logo"><img src="/logo-siipaf.png" alt="SIIPAF SA" /><span className="erp-tag">ERP</span></div>
        <div className="nav-group">
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><LayoutGrid aria-hidden="true" />Tous les modules</NavLink>
        </div>
        {mod && (can(mod.perm) || can('users:read') || mod.show?.(stats.data)) && (
          <div className="nav-group">
            <div className="nav-group-title">{mod.label}</div>
            {mod.items.filter(i => (i.perm && can(i.perm)) || (i.show && i.show(stats.data)) || (!i.perm && !i.show)).map(i => {
              const count = i.badge && stats.data ? stats.data[i.badge] : 0;
              return (
                <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <i.icon aria-hidden="true" />{i.label}
                  {count > 0 && <span className="count" aria-label={`${count} en cours`}>{count}</span>}
                </NavLink>
              );
            })}
          </div>
        )}
        <div className="sidebar-foot">
          {can('users:read') && <NavLink to="/comptes" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><UserCog aria-hidden="true" />Comptes utilisateurs</NavLink>}
          <a href={dashboardUrl()} className="nav-item"><ExternalLink aria-hidden="true" />Dashboard du site</a>
          <button className="nav-item btn-ghost" style={{ width: '100%', border: 'none', cursor: 'pointer' }} onClick={logout}>
            <LogOut aria-hidden="true" />Déconnexion
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" onClick={() => setOpen(true)} aria-label="Ouvrir le menu"><Menu /></button>
          <h1>{title}</h1>
          <div className="spacer" />
          <NotificationCenter />
          <div className="user-chip">
            <div className="right">
              <strong>{user.name}</strong>
              <small>{user.role_label || ROLE_LABELS[user.role] || user.role}</small>
            </div>
            <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
          </div>
        </header>
        <main className="content" ref={contentRef}>
          <Outlet context={{ stats }} />
        </main>
      </div>
    </div>
  );
}

export { MODULES };
