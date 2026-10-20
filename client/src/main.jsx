import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { SessionProvider, useSession } from './lib/session';
import Layout from './components/Layout';
import Login from './pages/Login';
import { FirstPassword, ForgotPassword, ResetPassword } from './pages/Password';
import Home from './pages/Home';
import Chantier from './pages/Chantier';
import Paiements from './pages/Paiements';
import Receipt from './pages/Receipt';
import Documents from './pages/Documents';
import Messages from './pages/Messages';
import Demandes from './pages/Demandes';
import Profile from './pages/Profile';

function Splash() {
  return <div className="splash" aria-busy="true" aria-label="Chargement"><img src={`${import.meta.env.BASE_URL}logo-siipaf.png`} alt="SIIPAF" /></div>;
}

/** Aiguillage selon l'état de la session. */
function Guard({ need, children }) {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (need === 'ready') {
    if (status === 'anon') return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
    if (status === 'pending') return <Navigate to="/premiere-connexion" replace />;
  }
  if (need === 'pending') {
    if (status === 'anon') return <Navigate to="/connexion" replace />;
    if (status === 'ready') return <Navigate to="/" replace />;
  }
  if (need === 'anon' && status !== 'anon') return <Navigate to={status === 'pending' ? '/premiere-connexion' : '/'} replace />;
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<Guard need="anon"><Login /></Guard>} />
      <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
      <Route path="/reinitialiser" element={<ResetPassword />} />
      <Route path="/premiere-connexion" element={<Guard need="pending"><FirstPassword /></Guard>} />
      <Route element={<Guard need="ready"><Layout /></Guard>}>
        <Route index element={<Home />} />
        <Route path="chantier" element={<Chantier />} />
        <Route path="paiements" element={<Paiements />} />
        <Route path="paiements/recu/:paymentId" element={<Receipt />} />
        <Route path="documents" element={<Documents />} />
        <Route path="messages" element={<Messages />} />
        <Route path="demandes" element={<Demandes />} />
        <Route path="profil" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
