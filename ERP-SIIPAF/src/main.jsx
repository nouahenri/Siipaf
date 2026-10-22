import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useAuth } from '@admin/lib/app-context';
import ErpLayout from './components/ErpLayout';
import Login from './pages/Login';
import ForcePassword from '@admin/components/ForcePassword';
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
import Direction from './pages/admin/Direction';
import Courrier from './pages/admin/Courrier';
import ComptaDashboard from './pages/compta/ComptaDashboard';
import Entries from './pages/compta/Entries';
import Purchases from './pages/compta/Purchases';
import Reports from './pages/compta/Reports';
import Chart from './pages/compta/Chart';
import ComptaSettings from './pages/compta/Settings';
import Employees from './pages/compta/Employees';
import Payroll, { PayrollRun } from './pages/compta/Payroll';
import RhDashboard from './pages/rh/RhDashboard';
import MySpace from './pages/rh/MySpace';
import Staff from './pages/rh/Staff';
import EmployeeFile from './pages/rh/EmployeeFile';
import Leaves from './pages/rh/Leaves';
import Attendance from './pages/rh/Attendance';
import Kiosk from './pages/rh/Kiosk';
import Expenses from './pages/rh/Expenses';
import Recruitment from './pages/rh/Recruitment';
import Skills from './pages/rh/Skills';
import Reviews from './pages/rh/Reviews';
import RhSettings from './pages/rh/RhSettings';
import ModuleAccess from './components/ModuleAccess';
import Accounts from './pages/Accounts';
import '@admin/styles.css';
import './erp.css';

function Guard({ perm, children }) {
  const { can } = useAuth();
  return [].concat(perm).some(can) ? children : <Navigate to="/" replace />;
}

/** Entrée du module RH : le tableau de bord pour le service RH, « Mon espace » pour les autres. */
function RhHome() {
  const { can } = useAuth();
  return can('rh:read') ? <RhDashboard /> : <Navigate to="/rh/moi" replace />;
}

/** Entrée de l'Administration générale : la vue Direction, sinon le courrier (secrétariat, destinataires). */
function AdminHome() {
  const { can } = useAuth();
  return can('direction:read') ? <Direction /> : <Navigate to="/administration/courrier" replace />;
}

function App() {
  const { loading, user } = useAuth();
  if (loading) return null;
  if (!user) return <Login />;
  if (user.must_change_password) return <ForcePassword />;
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
        <Route path="compta" element={<Guard perm="compta:read"><ComptaDashboard /></Guard>} />
        <Route path="compta/ecritures" element={<Guard perm="compta:read"><Entries /></Guard>} />
        <Route path="compta/achats" element={<Guard perm="compta:read"><Purchases /></Guard>} />
        <Route path="compta/etats" element={<Guard perm="compta:read"><Reports /></Guard>} />
        <Route path="compta/plan" element={<Guard perm="compta:read"><Chart /></Guard>} />
        <Route path="compta/paie" element={<Guard perm="paie:read"><Payroll /></Guard>} />
        <Route path="compta/paie/:id" element={<Guard perm="paie:read"><PayrollRun /></Guard>} />
        <Route path="compta/employes" element={<Guard perm={['paie:read', 'rh:read']}><Employees /></Guard>} />
        <Route path="compta/parametres" element={<Guard perm="compta:read"><ComptaSettings /></Guard>} />
        <Route path="rh" element={<RhHome />} />
        <Route path="rh/moi" element={<MySpace />} />
        <Route path="rh/personnel" element={<Guard perm="rh:read"><Staff /></Guard>} />
        <Route path="rh/personnel/:id" element={<EmployeeFile />} />
        <Route path="rh/conges" element={<Leaves />} />
        <Route path="rh/presences" element={<Guard perm={['rh:read', 'presence:write']}><Attendance /></Guard>} />
        <Route path="rh/borne" element={<Guard perm="presence:write"><Kiosk /></Guard>} />
        <Route path="rh/frais" element={<Expenses />} />
        <Route path="rh/recrutement" element={<Guard perm="rh:read"><Recruitment /></Guard>} />
        <Route path="rh/competences" element={<Guard perm="rh:read"><Skills /></Guard>} />
        <Route path="rh/objectifs" element={<Reviews />} />
        <Route path="rh/reglages" element={<Guard perm="rh:read"><RhSettings /></Guard>} />
        <Route path="comptes" element={<Guard perm="users:read"><Accounts /></Guard>} />
        <Route path="commercial/acces" element={<Guard perm="users:read"><ModuleAccess module="commercial" label="Service commercial" /></Guard>} />
        <Route path="administration" element={<AdminHome />} />
        <Route path="administration/courrier" element={<Courrier />} />
        <Route path="administration/acces" element={<Guard perm="users:read"><ModuleAccess module="administration" label="Administration générale" /></Guard>} />
        <Route path="compta/acces" element={<Guard perm="users:read"><ModuleAccess module="compta" label="Comptabilité et paie" /></Guard>} />
        <Route path="rh/acces" element={<Guard perm="users:read"><ModuleAccess module="rh" label="Ressources humaines" /></Guard>} />
        <Route path="sav/acces" element={<Guard perm="users:read"><ModuleAccess module="sav" label="Client & SAV" /></Guard>} />
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
