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
import '@admin/styles.css';
import './erp.css';

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
      <Route element={<ErpLayout />}>
        <Route index element={<Launcher />} />
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
