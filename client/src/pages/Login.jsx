import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import PasswordInput from '../components/PasswordInput';
import { Alert, Spinner } from '../components/ui';
import { useSession } from '../lib/session';

export default function Login() {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const client = await login(code, password);
      navigate(client.must_change_password ? '/premiere-connexion' : location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="auth-title">Bienvenue</h1>
      <p className="auth-sub">Connectez-vous avec votre code client ou votre numéro de téléphone, et le mot de passe reçu de SIIPAF.</p>
      <form onSubmit={submit} noValidate>
        <Alert>{error}</Alert>
        <label className="field" htmlFor="code">
          <span className="field-label">Code client ou téléphone</span>
          <input id="code" className="input code" value={code} onChange={e => setCode(e.target.value)} placeholder="SIIPAF-2026-0001 ou 07 08 97 26 71"
            autoComplete="username" autoCapitalize="characters" spellCheck={false} required autoFocus />
        </label>
        <PasswordInput label="Mot de passe" value={password} onChange={setPassword} />
        <button className="btn btn-primary btn-block" disabled={busy || !code || !password}>
          {busy ? <Spinner /> : <>Se connecter <ArrowRight aria-hidden="true" /></>}
        </button>
      </form>
      <p className="auth-foot"><Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link></p>
    </AuthShell>
  );
}
