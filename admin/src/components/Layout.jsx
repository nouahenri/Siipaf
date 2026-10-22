import { useEffect, useRef, useState } from 'react';
import { useRevealOnScroll } from '../lib/reveal';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Map, Users, CalendarDays, Mail, Newspaper, Image, PanelsTopLeft, UserCog, LogOut, Menu, KeyRound, MessageSquareQuote, ShieldCheck, MessagesSquare, UserCheck, SlidersHorizontal, LayoutGrid,
} from 'lucide-react';
import { useAuth, useResource } from '../lib/app-context';
import { ROLE_LABELS } from '../lib/domain';
import { initials } from '../lib/format';
import NotificationBell, { useNotifications } from './NotificationBell';

const NAV = [
  { group: null, items: [{ to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true }] },
  { group: 'Ventes', items: [
    { to: '/prospects', label: 'Prospects', icon: Users, perm: 'leads:read', badge: 'new_leads' },
    { to: '/clients', label: 'Clients', icon: UserCheck, perm: 'sales:read' },
    { to: '/rendez-vous', label: 'Rendez-vous', icon: CalendarDays, perm: 'appointments:read' },
    { to: '/messagerie-clients', label: 'Messagerie clients', icon: MessagesSquare, perm: 'client_messages', badge: 'unread_client_messages' },
  ] },
  { group: 'Catalogue', items: [
    { to: '/projets', label: 'Projets', icon: Building2, perm: 'projects:read' },
    { to: '/lots', label: 'Biens & disponibilités', icon: Map, perm: 'lots:read' },
  ] },
  { group: 'Site web', items: [
    { to: '/contenu', label: 'Contenu du site', icon: PanelsTopLeft, perm: 'content:write' },
    { to: '/medias', label: 'Médiathèque', icon: Image, perm: 'projects:read' },
    { to: '/messages', label: 'Messages', icon: Mail, perm: 'contacts:read', badge: 'new_messages' },
    { to: '/temoignages', label: 'Témoignages', icon: MessageSquareQuote, perm: 'testimonials:write', badge: 'pending_testimonials' },
    { to: '/newsletter', label: 'Newsletter', icon: Newspaper, perm: 'newsletter:read' },
  ] },
  { group: 'Administration', items: [
    { to: '/utilisateurs', label: 'Utilisateurs', icon: UserCog, perm: 'users:read' },
    { to: '/roles', label: 'Rôles & privilèges', icon: ShieldCheck, perm: 'users:read' },
    { to: '/parametres', label: 'Paramètres', icon: SlidersHorizontal },
  ] },
];

// L'ERP (erp.siipaf.com, erp.localhost en local) partage la base du dashboard : mêmes prospects, clients, lots et ventes
const erpUrl = () => `${window.location.protocol}//${window.location.host.replace(/^admin\./, 'erp.')}/`;
const ERP_PERMS = ['commercial:read', 'vefa:write', 'sav:read'];

const TITLES = {
  '/': 'Tableau de bord', '/prospects': 'Prospects', '/clients': 'Clients', '/rendez-vous': 'Rendez-vous', '/lots': 'Biens & disponibilités',
  '/projets': 'Projets', '/contenu': 'Contenu du site', '/medias': 'Médiathèque', '/messages': 'Messages', '/messagerie-clients': 'Messagerie clients',
  '/newsletter': 'Newsletter', '/temoignages': 'Témoignages', '/plans': 'Plan de masse', '/utilisateurs': 'Utilisateurs', '/roles': 'Rôles & privilèges', '/parametres': 'Paramètres', '/compte': 'Mon compte',
};

export default function Layout() {
  const { user, logout, can } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const stats = useResource('/admin/stats', [pathname]);
  const notif = useNotifications(can('leads:read'));
  const contentRef = useRef(null);
  useRevealOnScroll(contentRef, [pathname]);

  useEffect(() => setOpen(false), [pathname]);
  const title = TITLES[pathname] || TITLES['/' + pathname.split('/')[1]] || 'Administration';
  const unread = notif.data?.unread || 0;
  useEffect(() => { document.title = `${unread ? `(${unread}) ` : ''}${title} — SIIPAF Admin`; }, [title, unread]);

  return (
    <div className="shell">
      {open && <div className="overlay" onClick={() => setOpen(false)} />}
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Navigation principale">
        <div className="sidebar-logo"><img src="/logo-siipaf.png" alt="SIIPAF SA" /></div>
        {NAV.map(g => {
          const items = g.items.filter(i => !i.perm || can(i.perm));
          if (!items.length) return null;
          return (
            <div className="nav-group" key={g.group || 'main'}>
              {g.group && <div className="nav-group-title">{g.group}</div>}
              {items.map(i => {
                // Prospects : compteur rafraîchi avec la cloche (toutes les 30 s), les autres au changement de page
                const count = i.badge === 'new_leads' && notif.data ? notif.data.new_leads : i.badge && stats.data ? stats.data[i.badge] : 0;
                return (
                  <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <i.icon aria-hidden="true" />{i.label}
                    {count > 0 && <span className="count" aria-label={`${count} nouveaux`}>{count}</span>}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
        <div className="sidebar-foot">
          {ERP_PERMS.some(can) && <a href={erpUrl()} className="nav-item"><LayoutGrid aria-hidden="true" />ERP SIIPAF</a>}
          <NavLink to="/compte" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><KeyRound aria-hidden="true" />Mon compte</NavLink>
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
          {can('leads:read') && <NotificationBell notif={notif} />}
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
