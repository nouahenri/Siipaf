import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/app-context';
import { Field, ErrorBox } from './ui';

/**
 * Premier accès avec un mot de passe provisoire (compte créé ou mot de passe réinitialisé par un administrateur) :
 * la personne choisit son propre mot de passe avant d'accéder au dashboard ou à l'ERP (le serveur bloque le reste).
 */
export default function ForcePassword() {
  const { user, logout, markPasswordChanged } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setError(null);
    if (form.next !== form.confirm) return setError(new Error('Les deux mots de passe ne correspondent pas.'));
    setBusy(true);
    try { await api.post('/auth/password', { current: form.current, next: form.next }); markPasswordChanged(); } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <div className="force-password">
      <form className="card stack" style={{ gap: 14, padding: 28, width: 'min(440px, 100%)' }} onSubmit={save}>
        <div className="row" style={{ gap: 10 }}><KeyRound aria-hidden="true" /><h1 style={{ fontSize: 20 }}>Choisissez votre mot de passe</h1></div>
        <p className="small muted">Bonjour {user.name}. Votre compte a un mot de passe provisoire : remplacez-le par un mot de passe connu de vous seul pour continuer.</p>
        <ErrorBox error={error} />
        <Field label="Mot de passe provisoire"><input className="input" type="password" autoComplete="current-password" required value={form.current} onChange={set('current')} autoFocus /></Field>
        <Field label="Nouveau mot de passe" hint="10 caractères minimum."><input className="input" type="password" autoComplete="new-password" required minLength={10} value={form.next} onChange={set('next')} /></Field>
        <Field label="Confirmer"><input className="input" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} /></Field>
        <button className="btn btn-primary" disabled={busy}>Enregistrer et continuer</button>
        <button type="button" className="btn btn-ghost" onClick={logout}><LogOut />Se déconnecter</button>
      </form>
    </div>
  );
}
