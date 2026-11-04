/**
 * Première connexion : remplacer le mot de passe provisoire (10 caractères au moins). Le serveur renvoie un nouveau jeton
 * (les autres appareils sont déconnectés), puis l'application propose Face ID / l'empreinte.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Check } from 'lucide-react-native';
import { Alert, Button, Field, Screen, Txt } from '@/components/ui';
import { PASSWORD_MIN } from '@/config';
import { clientApi } from '@/lib/api';
import { firstName } from '@/lib/format';
import type { ClientProfile } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

export default function Premiere() {
  const { space } = useTheme();
  const { client, accept, logout } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next.length < PASSWORD_MIN) return setError(`Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`);
    if (next !== confirm) return setError('Les deux mots de passe ne sont pas identiques.');
    setBusy(true); setError(null);
    try {
      const r = await clientApi.post<{ client: ClientProfile; token?: string }>('/password', { current, next });
      await accept(r);
      router.replace('/espace-client');
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <Screen footer={<Button label="Enregistrer et continuer" icon={Check} block loading={busy} disabled={!current || !next || !confirm} onPress={submit} />}>
      <Txt variant="h2">Bonjour {firstName(client?.name)}</Txt>
      <Txt style={{ marginTop: space.sm, marginBottom: space.lg }}>Pour sécuriser votre espace, choisissez votre mot de passe personnel. Il remplace le mot de passe provisoire reçu.</Txt>
      <Alert>{error}</Alert>
      <Field label="Mot de passe provisoire" value={current} onChangeText={setCurrent} secure autoComplete="current-password" />
      <Field label="Nouveau mot de passe" value={next} onChangeText={setNext} secure autoComplete="new-password" textContentType="newPassword" hint={`${PASSWORD_MIN} caractères minimum. Une phrase courte est facile à retenir.`} />
      <Field label="Confirmez le nouveau mot de passe" value={confirm} onChangeText={setConfirm} secure autoComplete="new-password" textContentType="newPassword" />
      <Button label="Se déconnecter" variant="ghost" size="sm" onPress={async () => { await logout(); router.replace('/espace'); }} />
    </Screen>
  );
}
