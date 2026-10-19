import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../lib/app-context';
import { Field, ErrorBox } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await login(email, password); } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="login-art" aria-hidden="true">
        <div>
          <h2>Gérez vos programmes, vos lots et vos clients au même endroit.</h2>
          <p style={{ opacity: .8 }}>SIIPAF SA — Promoteur & Aménageur agréé MCLU</p>
        </div>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <img src="/logo-siipaf.png" alt="SIIPAF SA" />
          <div>
            <h1>Connexion</h1>
            <p className="muted">Espace d’administration réservé à l’équipe SIIPAF.</p>
          </div>
          <ErrorBox error={error} />
          <Field label="Adresse e-mail">
            <input className="input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label="Mot de passe">
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          <button className="btn btn-primary" disabled={busy} style={{ height: 44 }}>
            <LogIn />{busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
