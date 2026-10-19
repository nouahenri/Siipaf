import { Mail, Phone } from 'lucide-react';
import { CONTACT } from '../lib/domain';

/** Écran d'accès : photo du projet à gauche (en haut sur mobile), formulaire à droite. */
export default function AuthShell({ children }) {
  const base = import.meta.env.BASE_URL;
  return (
    <div className="auth">
      <div className="auth-visual" aria-hidden="true">
        <img src={`${base}connexion.jpg`} alt="" />
        <div className="auth-visual-text">
          <div className="eyebrow">Espace client</div>
          <h2>Votre bien, suivi pas à pas.</h2>
          <p>Avancement du chantier, documents, échéancier et échanges avec nos équipes : tout est réuni ici, où que vous soyez.</p>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-form">
          <img className="auth-logo" src={`${base}logo-siipaf.png`} alt="SIIPAF" />
          {children}
        </div>
        <div className="auth-help">
          <a href={CONTACT.phoneHref}><Phone aria-hidden="true" />{CONTACT.phone}</a>
          <a href={`mailto:${CONTACT.email}`}><Mail aria-hidden="true" />{CONTACT.email}</a>
        </div>
      </div>
    </div>
  );
}
