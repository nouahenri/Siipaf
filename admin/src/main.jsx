import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useAuth } from './lib/app-context';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Clients from './pages/Clients';
import Appointments from './pages/Appointments';
import Lots from './pages/Lots';
import Projects from './pages/Projects';
import ProjectEdit from './pages/ProjectEdit';
import PlanEditor from './pages/PlanEditor';
import SiteContent from './pages/SiteContent';
import Media from './pages/Media';
import Messages from './pages/Messages';
import ClientMessages from './pages/ClientMessages';
import Newsletter from './pages/Newsletter';
import Testimonials from './pages/Testimonials';
import UsersPage from './pages/Users';
import Roles from './pages/Roles';
import Account from './pages/Account';
import Settings from './pages/Settings';
import './styles.css';

function Guard({ perm, children }) {
  const { can } = useAuth();
  return can(perm) ? children : <Navigate to="/" replace />;
}

function App() {
  const { loading, user } = useAuth();
  if (loading) return null;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="prospects" element={<Guard perm="leads:read"><Leads /></Guard>} />
        <Route path="clients" element={<Guard perm="sales:read"><Clients /></Guard>} />
        <Route path="rendez-vous" element={<Guard perm="appointments:read"><Appointments /></Guard>} />
        <Route path="lots" element={<Guard perm="lots:read"><Lots /></Guard>} />
        <Route path="projets" element={<Guard perm="projects:read"><Projects /></Guard>} />
        <Route path="projets/:id" element={<Guard perm="projects:read"><ProjectEdit /></Guard>} />
        <Route path="plans/:id" element={<Guard perm="lots:read"><PlanEditor /></Guard>} />
        <Route path="contenu" element={<Guard perm="content:write"><SiteContent /></Guard>} />
        <Route path="medias" element={<Guard perm="projects:read"><Media /></Guard>} />
        <Route path="messages" element={<Guard perm="contacts:read"><Messages /></Guard>} />
        <Route path="messagerie-clients" element={<Guard perm="client_messages"><ClientMessages /></Guard>} />
        <Route path="temoignages" element={<Guard perm="testimonials:write"><Testimonials /></Guard>} />
        <Route path="newsletter" element={<Guard perm="newsletter:read"><Newsletter /></Guard>} />
        <Route path="utilisateurs" element={<Guard perm="users:read"><UsersPage /></Guard>} />
        <Route path="roles" element={<Guard perm="users:read"><Roles /></Guard>} />
        <Route path="compte" element={<Account />} />
        <Route path="parametres" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
