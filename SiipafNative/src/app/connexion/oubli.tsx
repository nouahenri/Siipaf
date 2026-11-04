/** Mot de passe oublié : lien de réinitialisation envoyé à l'adresse e-mail du dossier (même circuit que le site). */
import { useState } from 'react';
import { Alert, Button, Field, Screen, Txt } from '@/components/ui';
import { clientApi } from '@/lib/api';
import { useTheme } from '@/theme';

export default function Oubli() {
  const { space } = useTheme();
  const [code, setCode] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try { const r = await clientApi.post<{ message: string }>('/password/forgot', { login: code.trim() }); setDone(r.message); } catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Screen>
      <Txt style={{ marginBottom: space.lg }}>Indiquez votre code client ou votre numéro de téléphone : nous vous envoyons un lien pour choisir un nouveau mot de passe, à l’adresse e-mail de votre dossier. Ouvrez-le sur ce téléphone, puis reconnectez-vous ici.</Txt>
      {done ? (
        <>
          <Alert tone="ok">{done}</Alert>
          <Txt variant="small">Pas d’e-mail ? Vérifiez vos courriers indésirables, ou contactez votre conseiller SIIPAF.</Txt>
        </>
      ) : (
        <>
          <Alert>{error}</Alert>
          <Field label="Code client ou téléphone" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} autoComplete="username" placeholder="SIIPAF-2026-0001" returnKeyType="send" onSubmitEditing={submit} />
          <Button label="Recevoir le lien" block loading={busy} disabled={code.trim().length < 4} onPress={submit} />
        </>
      )}
    </Screen>
  );
}
