import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import PasswordInput from '../components/PasswordInput';
import { Alert, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { PASSWORD_MIN } from '../lib/domain';
import { firstName } from '../lib/format';

function checkNew(next, confirm) {
  if (next.length < PASSWORD_MIN) return `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`;
  if (next !== confirm) return 'Les deux mots de passe ne sont pas identiques.';
  return '';
}

/** Première connexion : remplacer le mot de passe provisoire. */
export function FirstPassword() {
  const { client, accept, logout } = useSession();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const problem = checkNew(next, confirm);
    if (problem) return setError(problem);
    setError('');
    setBusy(true);
    try {
      const r = await api.post('/password', { current, next });
      await accept(r.client);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="auth-title">Bonjour {firstName(client?.name)}</h1>
      <p className="auth-sub">Pour sécuriser votre espace, choisissez votre mot de passe personnel. Il remplace le mot de passe provisoire reçu.</p>
      <form onSubmit={submit} noValidate>
        <Alert>{error}</Alert>
        <PasswordInput label="Mot de passe provisoire" value={current} onChange={setCurrent} autoFocus />
        <PasswordInput label="Nouveau mot de passe" value={next} onChange={setNext} autoComplete="new-password" strength
          hint={`${PASSWORD_MIN} caractères minimum. Une phrase courte est facile à retenir.`} />
        <PasswordInput label="Confirmez le nouveau mot de passe" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <button className="btn btn-primary btn-block" disabled={busy || !current || !next || !confirm}>
          {busy ? <Spinner /> : <><Check aria-hidden="true" /> Enregistrer et continuer</>}
        </button>
      </form>
      <p className="auth-foot"><button type="button" className="link" onClick={logout}>Se déconnecter</button></p>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [code, setCode] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.post('/password/forgot', { login: code });
      setDone(r.message);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <AuthShell>
      <h1 className="auth-title">Mot de passe oublié</h1>
      <p className="auth-sub">Indiquez votre code client ou votre numéro de téléphone : nous vous enverrons un lien pour choisir un nouveau mot de passe, à l’adresse e-mail de votre dossier.</p>
      {done ? (
        <>
          <Alert tone="ok">{done}</Alert>
          <p className="hint">Pas d’e-mail ? Vérifiez vos courriers indésirables, ou contactez votre conseiller SIIPAF.</p>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <Alert>{error}</Alert>
          <label className="field" htmlFor="code">
            <span className="field-label">Code client ou téléphone</span>
            <input id="code" className="input code" value={code} onChange={e => setCode(e.target.value)} placeholder="SIIPAF-2026-0001 ou 07 08 97 26 71"
              autoComplete="username" autoCapitalize="characters" spellCheck={false} required autoFocus />
          </label>
          <button className="btn btn-primary btn-block" disabled={busy || code.trim().length < 4}>{busy ? <Spinner /> : 'Recevoir le lien'}</button>
        </form>
      )}
      <p className="auth-foot"><Link to="/connexion"><ArrowLeft size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Retour à la connexion</Link></p>
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('jeton') || '';
  const { accept } = useSession();
  const navigate = useNavigate();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const problem = checkNew(next, confirm);
    if (problem) return setError(problem);
    setError('');
    setBusy(true);
    try {
      const r = await api.post('/password/reset', { token, password: next });
      await accept(r.client);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="auth-title">Nouveau mot de passe</h1>
      {!token ? (
        <Alert>Ce lien est incomplet. Ouvrez le lien reçu par e-mail, ou refaites une demande.</Alert>
      ) : (
        <>
          <p className="auth-sub">Choisissez votre nouveau mot de passe. Vous serez connecté aussitôt après.</p>
          <form onSubmit={submit} noValidate>
            <Alert>{error}</Alert>
            <PasswordInput label="Nouveau mot de passe" value={next} onChange={setNext} autoComplete="new-password" strength autoFocus
              hint={`${PASSWORD_MIN} caractères minimum.`} />
            <PasswordInput label="Confirmez le mot de passe" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            <button className="btn btn-primary btn-block" disabled={busy || !next || !confirm}>{busy ? <Spinner /> : 'Enregistrer'}</button>
          </form>
        </>
      )}
      <p className="auth-foot"><Link to="/mot-de-passe-oublie">Refaire une demande</Link></p>
    </AuthShell>
  );
}
