import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useAuth } from '@admin/lib/app-context';
import ErpLayout, { JURIDIQUE } from './components/ErpLayout';
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
import Contrats from './pages/admin/Contrats';
import Parc from './pages/admin/Parc';
import Documents from './pages/admin/Documents';
import Demandes from './pages/admin/Demandes';
import Lieux from './pages/admin/Lieux';
import Circuit from './pages/admin/Circuit';
import JuridiqueDashboard from './pages/juridique/JuridiqueDashboard';
import Actes from './pages/juridique/Actes';
import Litiges from './pages/juridique/Litiges';
import Cautions from './pages/juridique/Cautions';
import Impayes from './pages/juridique/Impayes';
import JuridiqueSettings from './pages/juridique/JuridiqueSettings';
import Chantiers from './pages/chantiers/Chantiers';
import Chantier from './pages/chantiers/Chantier';
import ChantiersSettings from './pages/chantiers/ChantiersSettings';
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
import Onboarding from './pages/Onboarding';
import '@admin/styles.css';
import './erp.css';
import { installScrollers } from '@admin/lib/scrollers';
import { SettingsShell } from './components/NotificationPrefs';
import ModuleSettings from './pages/ModuleSettings';
import { ApproDashboard, ApproDocuments, ApproStock, ApproArticles, ApproNeeds, ApproPartners, ApproSettings, ApproPrint } from './pages/achats/Achats';

function Guard({ perm, children }) {
  const { can } = useAuth();
  return [].concat(perm).some(can) ? children : <Navigate to="/" replace />;
}

/** Réglages d'un module : « Mes notifications » pour tout compte, paramètres du module pour les droits donnés. */
function Settings({ module, perm, who, children }) {
  const { can } = useAuth();
  return <SettingsShell module={module} allowed={[].concat(perm).some(can)} who={who}>{children}</SettingsShell>;
}

/** Entrée du module RH : le tableau de bord pour le service RH, « Mon espace » pour les autres. */
function RhHome() {
  const { can } = useAuth();
  return can('rh:read') ? <RhDashboard /> : <Navigate to="/rh/moi" replace />;
}

/** Entrée de l'Administration générale : la vue Direction, sinon la première partie ouverte au compte. */
function AdminHome() {
  const { can } = useAuth();
  if (can('direction:read')) return <Direction />;
  const first = [
    [['courrier:read', 'courrier:write', 'courrier:assign'], '/administration/courrier'], [['contrats:read', 'contrats:write'], '/administration/contrats'],
    [['parc:read', 'parc:write'], '/administration/parc'], [['demandes:handle', 'demandes:dg'], '/administration/demandes'], [['docs:publish'], '/administration/documents'], [['lieux:write'], '/administration/lieux'],
    [['users:write', 'demandes:dg'], '/administration/circuit'],
  ].find(([perms]) => perms.some(can));
  return <Navigate to={first ? first[1] : '/administration/courrier'} replace />;
}

/** Entrée du Juridique : le tableau de bord, sinon les litiges du juriste en charge ou du service concerné. */
function JuridiqueHome() {
  const { can } = useAuth();
  if (JURIDIQUE.some(can)) return <JuridiqueDashboard />;
  return <Navigate to={can('compta:read') ? '/juridique/cautions' : '/juridique/litiges'} replace />;
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
        <Route path="achats" element={<Guard perm="appro:read"><ApproDashboard /></Guard>} />
        <Route path="achats/besoins" element={<Guard perm="appro:read"><ApproNeeds /></Guard>} />
        <Route path="achats/prix" element={<Guard perm="appro:read"><ApproDocuments key="quotes" kind="quote" /></Guard>} />
        <Route path="achats/prix/:id/impression" element={<Guard perm="appro:read"><ApproPrint kind="quote" /></Guard>} />
        <Route path="achats/commandes" element={<Guard perm="appro:read"><ApproDocuments key="orders" kind="order" /></Guard>} />
        <Route path="achats/commandes/:id/impression" element={<Guard perm="appro:read"><ApproPrint kind="order" /></Guard>} />
        <Route path="achats/stocks" element={<Guard perm="appro:read"><ApproStock /></Guard>} />
        <Route path="achats/articles" element={<Guard perm="appro:read"><ApproArticles /></Guard>} />
        <Route path="achats/fournisseurs" element={<Guard perm="appro:read"><ApproPartners /></Guard>} />
        <Route path="achats/reglages" element={<Guard perm="appro:read"><ApproSettings /></Guard>} />
        <Route path="achats/acces" element={<Guard perm="appro:read"><Guard perm="users:read"><ModuleAccess module="achats" label="Achats & stocks" /></Guard></Guard>} />
        <Route path="commercial" element={<Guard perm="commercial:read"><CommercialDashboard /></Guard>} />
        <Route path="commercial/pipeline" element={<Guard perm="leads:read"><Pipeline /></Guard>} />
        <Route path="commercial/activites" element={<Guard perm="commercial:read"><Activities /></Guard>} />
        <Route path="commercial/rendez-vous" element={<Guard perm="appointments:read"><Appointments /></Guard>} />
        <Route path="commercial/parc" element={<Guard perm="commercial:read"><Guard perm="lots:read"><Property /></Guard></Guard>} />
        <Route path="commercial/ventes" element={<Guard perm="commercial:read"><Guard perm="sales:read"><Sales /></Guard></Guard>} />
        <Route path="commercial/vefa" element={<Guard perm={['commercial:read', 'vefa:write']}><Vefa /></Guard>} />
        <Route path="commercial/objectifs" element={<Guard perm="commercial:read"><Targets /></Guard>} />
        <Route path="commercial/reglages" element={<ModuleSettings module="commercial" />} />
        <Route path="compta" element={<Guard perm="compta:read"><ComptaDashboard /></Guard>} />
        <Route path="compta/ecritures" element={<Guard perm="compta:read"><Entries /></Guard>} />
        <Route path="compta/achats" element={<Guard perm="compta:read"><Purchases /></Guard>} />
        <Route path="compta/etats" element={<Guard perm="compta:read"><Reports /></Guard>} />
        <Route path="compta/plan" element={<Guard perm="compta:read"><Chart /></Guard>} />
        <Route path="compta/parc" element={<Guard perm="compta:read"><Parc /></Guard>} />
        <Route path="compta/paie" element={<Guard perm="paie:read"><Payroll /></Guard>} />
        <Route path="compta/paie/:id" element={<Guard perm="paie:read"><PayrollRun /></Guard>} />
        <Route path="compta/employes" element={<Guard perm={['paie:read', 'rh:read']}><Employees /></Guard>} />
        <Route path="compta/parametres" element={<Settings module="compta" perm="compta:read" who="la Comptabilité"><ComptaSettings /></Settings>} />
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
        <Route path="rh/reglages" element={<Settings module="rh" perm="rh:read" who="le service des ressources humaines"><RhSettings /></Settings>} />
        <Route path="comptes" element={<Guard perm="users:read"><Accounts /></Guard>} />
        <Route path="demarrer" element={<Guard perm={['users:read', 'rh:read']}><Onboarding /></Guard>} />
        <Route path="commercial/acces" element={<Guard perm="users:read"><ModuleAccess module="commercial" label="Service commercial" /></Guard>} />
        <Route path="administration" element={<AdminHome />} />
        <Route path="administration/courrier" element={<Courrier />} />
        <Route path="administration/contrats" element={<Contrats />} />
        <Route path="administration/parc" element={<Guard perm={['parc:read', 'parc:write']}><Parc /></Guard>} />
        <Route path="administration/documents" element={<Documents />} />
        <Route path="administration/demandes" element={<Demandes />} />
        <Route path="administration/lieux" element={<Guard perm={['lieux:write', 'direction:read']}><Lieux /></Guard>} />
        <Route path="administration/reglages" element={<ModuleSettings module="administration" />} />
        <Route path="administration/circuit" element={<Guard perm={['users:write', 'demandes:dg', 'direction:read']}><Circuit /></Guard>} />
        <Route path="administration/acces" element={<Guard perm="users:read"><ModuleAccess module="administration" label="Administration générale" /></Guard>} />
        <Route path="juridique" element={<JuridiqueHome />} />
        <Route path="juridique/actes" element={<Guard perm={JURIDIQUE}><Actes /></Guard>} />
        <Route path="juridique/litiges" element={<Litiges />} />
        <Route path="juridique/cautions" element={<Guard perm={[...JURIDIQUE, 'compta:read']}><Cautions /></Guard>} />
        <Route path="juridique/impayes" element={<Guard perm={JURIDIQUE}><Impayes /></Guard>} />
        <Route path="juridique/contrats" element={<Contrats />} />
        <Route path="juridique/reglages" element={<Settings module="juridique" perm={JURIDIQUE} who="le service juridique"><JuridiqueSettings /></Settings>} />
        <Route path="juridique/acces" element={<Guard perm="users:read"><ModuleAccess module="juridique" label="Juridique" /></Guard>} />
        <Route path="chantiers" element={<Navigate to="/chantiers/liste" replace />} />
        <Route path="chantiers/liste" element={<Chantiers />} />
        <Route path="chantiers/reglages" element={<Settings module="chantiers" perm={['chantiers:read', 'chantiers:write', 'chantiers:direction', 'direction:read']} who="les gestionnaires des chantiers"><ChantiersSettings /></Settings>} />
        <Route path="chantiers/:id" element={<Chantier />} />
        <Route path="chantiers/acces" element={<Guard perm="users:read"><ModuleAccess module="chantiers" label="Chantiers" /></Guard>} />
        <Route path="compta/acces" element={<Guard perm="users:read"><ModuleAccess module="compta" label="Comptabilité et paie" /></Guard>} />
        <Route path="rh/acces" element={<Guard perm="users:read"><ModuleAccess module="rh" label="Ressources humaines" /></Guard>} />
        <Route path="sav/acces" element={<Guard perm="users:read"><ModuleAccess module="sav" label="Client & SAV" /></Guard>} />
        <Route path="sav" element={<Guard perm="sav:read"><SavDashboard /></Guard>} />
        <Route path="sav/reclamations" element={<Guard perm="sav:read"><Tickets /></Guard>} />
        <Route path="sav/reserves" element={<Guard perm="sav:read"><Reserves /></Guard>} />
        <Route path="sav/interventions" element={<Guard perm="sav:read"><Interventions /></Guard>} />
        <Route path="sav/reglages" element={<ModuleSettings module="sav" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// Onglets et bandes qui défilent : molette et onglet choisi ramené en vue
installScrollers();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
