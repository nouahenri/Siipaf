import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Check, ChevronDown, FileText, HardHat, Home, LifeBuoy, MessageCircle, Wallet } from 'lucide-react';
import { useSession } from '../lib/session';
import { initials } from '../lib/format';

const NAV = [
  { to: '/', label: 'Accueil', icon: Home, end: true },
  { to: '/chantier', label: 'Chantier', icon: HardHat },
  { to: '/paiements', label: 'Paiements', icon: Wallet },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/demandes', label: 'SAV', icon: LifeBuoy },
  { to: '/messages', label: 'Messages', icon: MessageCircle, badge: true },
];

function DossierSwitcher() {
  const { dossiers, selected, select } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (dossiers.length < 2 || !selected) return null;
  return (
    <div className="switcher" ref={ref}>
      <button className="switcher-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu">
        <span>Lot {selected.property.lot_code}</span><ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="switcher-menu" role="menu">
          {dossiers.map(d => (
            <button key={d.id} role="menuitemradio" aria-checked={d.id === selected.id} onClick={() => { select(d.id); setOpen(false); }}>
              <div>
                <strong>Lot {d.property.lot_code}{d.property.ilot ? ` · Îlot ${d.property.ilot}` : ''}</strong>
                <small>{d.property.project.name}</small>
              </div>
              {d.id === selected.id && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { client, refreshMe } = useSession();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); refreshMe(); }, [pathname, refreshMe]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const unread = client?.unread_messages || 0;
  const badge = item => item.badge && unread > 0 && <span className="tab-badge" aria-label={`${unread} non lus`}>{unread > 9 ? '9+' : unread}</span>;

  return (
    <div className="app">
      <header className={`topbar${scrolled ? ' scrolled' : ''}`}>
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="Accueil de l’espace client">
            <img src={`${import.meta.env.BASE_URL}logo-siipaf.png`} alt="SIIPAF" />
            <span className="brand-label">Espace client</span>
          </Link>
          <nav className="topnav" aria-label="Navigation principale">
            {NAV.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end}>{item.label}{badge(item)}</NavLink>
            ))}
          </nav>
          <div className="topbar-end">
            <DossierSwitcher />
            <Link to="/profil" className="avatar" aria-label="Mon profil">{initials(client?.name)}</Link>
          </div>
        </div>
      </header>

      <main className="page" id="contenu">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Navigation">
        {NAV.map(item => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} end={item.end} className="tab">
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
              {badge(item)}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
