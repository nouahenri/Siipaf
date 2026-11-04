/**
 * Onglet « Mon espace » : connexion à l'espace client (code client ou téléphone + mot de passe reçu de SIIPAF), comme
 * client.siipaf.com. Connecté, le client ouvre son espace d'un toucher (Face ID / empreinte demandés si activés).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { ArrowRight, LogOut, ScanFace } from 'lucide-react-native';
import { AppHeader } from '@/components/ui/AppHeader';
import { Alert, Button, Card, Field, Txt } from '@/components/ui';
import { useSite } from '@/lib/content';
import { firstName } from '@/lib/format';
import { whatsapp } from '@/lib/links';
import { useSession } from '@/providers/session';
import { useT } from '@/providers/preferences';
import { useTheme } from '@/theme';

export default function Espace() {
  const t = useT();
  const { c, space, fonts } = useTheme();
  const { contact } = useSite();
  const { status, client, login, logout, unlock, biometric, notice } = useSession();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const cl = await login(code, password);
      setPassword('');
      router.push(cl.must_change_password ? '/connexion/premiere' : '/espace-client');
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const connected = status === 'ready' || status === 'locked' || status === 'pending';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AppHeader title={t('Mon espace')} subtitle={connected && client ? `Bonjour ${firstName(client.name)}` : t('Chantier, paiements et documents de votre acquisition')} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xxxl }}>
        <View style={{ padding: space.lg }}>
          {connected ? (
            <Card>
              <Txt variant="h3">{client ? client.name : t('Votre espace client')}</Txt>
              {client ? <Txt variant="small" style={{ marginBottom: space.lg }}>Code client {client.client_code}</Txt> : <View style={{ height: space.md }} />}
              {status === 'locked' ? (
                <Button label={`Déverrouiller avec ${biometric.label}`} icon={ScanFace} block haptic onPress={async () => { if (await unlock()) router.push('/espace-client'); }} />
              ) : (
                <Button label={t('Ouvrir mon espace client')} iconRight={ArrowRight} block onPress={() => router.push(status === 'pending' ? '/connexion/premiere' : '/espace-client')} />
              )}
              <Button label={t('Se déconnecter')} icon={LogOut} variant="ghost" block style={{ marginTop: space.sm }} onPress={logout} />
            </Card>
          ) : (
            <Card>
              <Txt variant="h2">{t('Connexion')}</Txt>
              <Txt variant="small" style={{ marginTop: 4, marginBottom: space.lg }}>{t('Avec votre code client ou votre numéro de téléphone, et le mot de passe reçu de SIIPAF.')}</Txt>
              <Alert tone="warn">{notice}</Alert>
              <Alert>{error}</Alert>
              <Field label={t('Code client ou téléphone')} value={code} onChangeText={setCode} placeholder="SIIPAF-2026-0001 ou 07 08 97 26 71" autoCapitalize="characters" autoCorrect={false} autoComplete="username" textContentType="username" returnKeyType="next" />
              <Field label={t('Mot de passe')} value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
              <Button label={t('Se connecter')} iconRight={ArrowRight} block haptic loading={busy} disabled={code.trim().length < 4 || !password} onPress={submit} />
              <Pressable onPress={() => router.push('/connexion/oubli')} accessibilityRole="link" style={{ alignSelf: 'center', paddingVertical: space.md, marginTop: space.sm }}>
                <Txt style={{ fontFamily: fonts.semibold, color: c.primary }}>{t('Mot de passe oublié ?')}</Txt>
              </Pressable>
              {biometric.available ? <Txt variant="tiny" center>Vous resterez connecté 30 jours. L’accès sera protégé par {biometric.label}.</Txt> : <Txt variant="tiny" center>{t('Vous resterez connecté 30 jours sur ce téléphone.')}</Txt>}
            </Card>
          )}

          {!connected && (
            <Pressable onPress={() => whatsapp(contact.whatsapp, 'Bonjour SIIPAF, je souhaite recevoir mon accès à l’espace client.')} accessibilityRole="button"
              style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: space.md }}>
              <Txt style={{ fontFamily: fonts.semibold, color: c.primary, fontSize: 14.5 }}>{t('Pas encore d’accès ? Le demander sur WhatsApp')}</Txt>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
