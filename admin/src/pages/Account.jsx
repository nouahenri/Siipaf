import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth, useToast } from '../lib/app-context';
import { Card, Field, ErrorBox } from '../components/ui';
import { ROLE_LABELS } from '../lib/domain';

export default function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setError(null);
    if (form.next !== form.confirm) return setError(new Error('Les deux nouveaux mots de passe ne correspondent pas.'));
    try {
      await api.post('/auth/password', { current: form.current, next: form.next });
      setForm({ current: '', next: '', confirm: '' });
      toast('Mot de passe modifié');
    } catch (err) { setError(err); }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Mon profil">
        <dl className="dl">
          <dt>Nom</dt><dd>{user.name}</dd>
          <dt>E-mail</dt><dd>{user.email}</dd>
          <dt>Rôle</dt><dd>{user.role_label || ROLE_LABELS[user.role] || user.role}</dd>
        </dl>
      </Card>
      <Card title="Changer mon mot de passe">
        <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
          <ErrorBox error={error} />
          <Field label="Mot de passe actuel"><input className="input" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required /></Field>
          <Field label="Nouveau mot de passe" hint="10 caractères minimum."><input className="input" type="password" autoComplete="new-password" value={form.next} onChange={set('next')} required minLength={10} /></Field>
          <Field label="Confirmer"><input className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required /></Field>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Enregistrer</button>
        </form>
      </Card>
    </div>
  );
}
