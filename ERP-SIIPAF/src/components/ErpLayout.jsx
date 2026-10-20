import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutGrid, LifeBuoy, LayoutDashboard, ClipboardList, ClipboardCheck, CalendarClock, LogOut, Menu, ExternalLink } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { useRevealOnScroll } from '@admin/lib/reveal';
import { ROLE_LABELS } from '@admin/lib/domain';
import { initials } from '@admin/lib/format';

// Navigation de chaque module ; les modules suivants (comptabilité, RH…) viendront s'ajouter ici
const MODULES = {
  sav: {
    label: 'Client & SAV', icon: LifeBuoy, perm: 'sav:read',
    items: [
      { to: '/sav', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
      { to: '/sav/reclamations', label: 'Réclamations', icon: ClipboardList, badge: 'open' },
      { to: '/sav/reserves', label: 'Réserves de livraison', icon: ClipboardCheck },
      { to: '/sav/interventions', label: 'Interventions', icon: CalendarClock },
    ],
  },
};

const TITLES = {
  '/': 'Modules', '/sav': 'Client & SAV', '/sav/reclamations': 'Réclamations', '/sav/reserves': 'Réserves de livraison', '/sav/interventions': 'Interventions',
};

// Le dashboard est sur admin.siipaf.com quand l'ERP est sur erp.siipaf.com (admin.localhost en local)
const dashboardUrl = () => `${window.location.protocol}//${window.location.host.replace(/^erp\./, 'admin.')}/`;

export default function ErpLayout() {
  const { user, logout, can } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const moduleId = pathname.split('/')[1];
  const mod = MODULES[moduleId];
  const stats = useResource(mod && moduleId === 'sav' ? '/admin/erp/sav/stats' : null, [pathname]);
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
        {mod && can(mod.perm) && (
          <div className="nav-group">
            <div className="nav-group-title">{mod.label}</div>
            {mod.items.map(i => {
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
