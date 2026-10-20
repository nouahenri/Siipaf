import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useAuth } from '@admin/lib/app-context';
import ErpLayout from './components/ErpLayout';
import Login from './pages/Login';
import Launcher from './pages/Launcher';
import SavDashboard from './pages/sav/SavDashboard';
import Tickets from './pages/sav/Tickets';
import Reserves from './pages/sav/Reserves';
import Interventions from './pages/sav/Interventions';
import CommercialDashboard from './pages/commercial/CommercialDashboard';
import Pipeline from './pages/commercial/Pipeline';
import Activities from './pages/commercial/Activities';
import Appointments from './pages/commercial/Appointments';
import Property from './pages/commercial/Property';
import Sales from './pages/commercial/Sales';
import Vefa from './pages/commercial/Vefa';
import Targets from './pages/commercial/Targets';
import '@admin/styles.css';
import './erp.css';

function Guard({ perm, children }) {
  const { can } = useAuth();
  return [].concat(perm).some(can) ? children : <Navigate to="/" replace />;
}

function App() {
  const { loading, user } = useAuth();
  if (loading) return null;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<ErpLayout />}>
        <Route index element={<Launcher />} />
        <Route path="commercial" element={<Guard perm="commercial:read"><CommercialDashboard /></Guard>} />
        <Route path="commercial/pipeline" element={<Guard perm="leads:read"><Pipeline /></Guard>} />
        <Route path="commercial/activites" element={<Guard perm="commercial:read"><Activities /></Guard>} />
        <Route path="commercial/rendez-vous" element={<Guard perm="appointments:read"><Appointments /></Guard>} />
        <Route path="commercial/parc" element={<Guard perm="lots:read"><Property /></Guard>} />
        <Route path="commercial/ventes" element={<Guard perm="sales:read"><Sales /></Guard>} />
        <Route path="commercial/vefa" element={<Guard perm={['commercial:read', 'vefa:write']}><Vefa /></Guard>} />
        <Route path="commercial/objectifs" element={<Guard perm="commercial:read"><Targets /></Guard>} />
        <Route path="sav" element={<Guard perm="sav:read"><SavDashboard /></Guard>} />
        <Route path="sav/reclamations" element={<Guard perm="sav:read"><Tickets /></Guard>} />
        <Route path="sav/reserves" element={<Guard perm="sav:read"><Reserves /></Guard>} />
        <Route path="sav/interventions" element={<Guard perm="sav:read"><Interventions /></Guard>} />
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
